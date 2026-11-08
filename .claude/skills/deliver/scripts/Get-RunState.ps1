<#
.SYNOPSIS
  Read the deliver runs of the events directory: list them, fold one, tail its events, or list the items that need you.
.DESCRIPTION
  Read-only reader for agents with a shell (ADR 0002, "Agents"); it never writes or deletes an event file. The events
  directory is resolved like Report-Progress.ps1: $env:AGENT_EVENTS_DIR, else <git-common-dir>/.agents/events.
  Exactly one mode:
  -List: the runs, newest first, JSON array of { run, startedAt, result, lastType, lastTs }; result is running, abandoned
  or the run.finished result (the fold of ConvertFrom-ProgressEvents.ps1). No events directory: [].
  -Run <id>: the fold of the run, the reducer's JSON (schema/deliver-run-state.schema.json).
  -Run <id> -After <seq>: the events with seq greater than <seq>, one JSON event per line (poll the tail).
  -NeedsAttention: the open needsYou items of all running runs, JSON array of { run, number, url, reason }.
  An unknown run ends with one line on stderr and exit 1. Usage errors exit 2.
.PARAMETER List
  List the runs.
.PARAMETER Run
  Run id: the name of the event file <run>.jsonl.
.PARAMETER After
  With -Run: the sequence number after which the events are printed.
.PARAMETER NeedsAttention
  List the open needs-you items of the running runs.
.PARAMETER Now
  ISO 8601 time the reducer's age rule compares against (default: the current time). Tests and fixtures pass it.
.PARAMETER NoPidCheck
  Skip the pid test of a run without run.finished (fixtures, a run of another host).
#>
[CmdletBinding()]
param(
  [switch]$List,
  [string]$Run,
  [long]$After,
  [switch]$NeedsAttention,
  [string]$Now,
  [switch]$NoPidCheck
)
$ErrorActionPreference = 'Stop'
$reducer = Join-Path $PSScriptRoot 'ConvertFrom-ProgressEvents.ps1'

function Exit-Usage([string]$Message) { [Console]::Error.WriteLine($Message); exit 2 }
function Exit-Unknown([string]$Message) { [Console]::Error.WriteLine($Message); exit 1 }

function Get-EventsDir {
  if ($env:AGENT_EVENTS_DIR) { return $env:AGENT_EVENTS_DIR }
  try { $common = @(& git -C (Get-Location).Path rev-parse --git-common-dir 2>$null)[0] } catch { return $null }
  if ($LASTEXITCODE -ne 0 -or -not $common) { return $null }
  return Join-Path ([System.IO.Path]::GetFullPath($common, (Get-Location).Path)) '.agents/events'
}

# Complete event lines of a file: a line that does not parse as a JSON object (an incomplete last line) is skipped.
function Get-Events([string]$File) {
  foreach ($line in [System.IO.File]::ReadAllLines($File)) {
    if (-not $line.Trim()) { continue }
    try { $root = [System.Text.Json.JsonDocument]::Parse($line).RootElement } catch { continue }
    if ($root.ValueKind -ne 'Object') { continue }
    $seq = $null
    $seqValue = Get-Prop $root 'seq'
    if ($null -ne $seqValue -and $seqValue.ValueKind -eq 'Number') { $seq = $seqValue.GetInt64() }
    [pscustomobject]@{ Line = $line; Seq = $seq; Type = (Get-Str $root 'type'); Ts = (Get-Str $root 'ts') }
  }
}

function Get-Prop($element, [string]$name) {
  foreach ($prop in $element.EnumerateObject()) { if ($prop.Name -eq $name) { return $prop.Value } }
  return $null
}

function Get-Str($element, [string]$name) {
  $value = Get-Prop $element $name
  if ($null -ne $value -and $value.ValueKind -eq 'String') { return $value.GetString() }
  return $null
}

# The reducer's JSON of one file, as a string, or $null when the reducer has no complete event to fold (it exits 1).
# The reducer writes to stderr only for a seq gap.
function Invoke-Fold([string]$File) {
  $reducerArgs = @{ Path = $File }
  if ($Now) { $reducerArgs['Now'] = $Now }
  if ($NoPidCheck) { $reducerArgs['NoPidCheck'] = $true }
  $json = (& $reducer @reducerArgs | Out-String)
  if ($LASTEXITCODE -ne 0) { return $null }
  return $json
}

function Get-Root([string]$Json) { return [System.Text.Json.JsonDocument]::Parse($Json).RootElement }

function Get-Ticks($Ts) {
  $when = [DateTimeOffset]::MinValue
  if ($Ts -and [DateTimeOffset]::TryParse([string]$Ts, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$when)) { return $when.UtcTicks }
  return 0
}

$modes = [int]$List.IsPresent + [int]$NeedsAttention.IsPresent + [int]$PSBoundParameters.ContainsKey('Run')
if ($modes -ne 1) {
  Exit-Usage 'give exactly one of -List, -Run <id>, -NeedsAttention'
}
if ($PSBoundParameters.ContainsKey('After') -and -not $PSBoundParameters.ContainsKey('Run')) { Exit-Usage '-After needs -Run <id>' }

$dir = Get-EventsDir
$files = @()
if ($dir -and (Test-Path -LiteralPath $dir -PathType Container)) {
  $files = @(Get-ChildItem -LiteralPath $dir -Filter '*.jsonl' -File)
}

if ($List) {
  $entries = foreach ($f in $files) {
    $json = Invoke-Fold $f.FullName
    if ($null -eq $json) { continue }
    $events = @(Get-Events $f.FullName)
    $root = Get-Root $json
    $last = $events | Select-Object -Last 1
    [pscustomobject][ordered]@{
      run = $f.BaseName
      startedAt = Get-Str $root 'startedAt'
      result = Get-Str $root 'result'
      lastType = if ($last) { $last.Type } else { $null }
      lastTs = if ($last) { $last.Ts } else { $null }
    }
  }
  $sorted = @($entries | Sort-Object -Property @{ Expression = { Get-Ticks $_.startedAt }; Descending = $true }, @{ Expression = { $_.run }; Descending = $true })
  Write-Output (ConvertTo-Json -InputObject $sorted -Depth 4)
  exit 0
}

if ($NeedsAttention) {
  $items = foreach ($f in $files) {
    $json = Invoke-Fold $f.FullName
    if ($null -eq $json) { continue }
    $root = Get-Root $json
    if ((Get-Str $root 'result') -ne 'running') { continue }
    foreach ($n in $root.GetProperty('needsYou').EnumerateArray()) {
      [pscustomobject][ordered]@{
        run = $f.BaseName
        number = $n.GetProperty('number').GetInt64()
        url = Get-Str $n 'url'
        reason = Get-Str $n 'reason'
      }
    }
  }
  Write-Output (ConvertTo-Json -InputObject @($items) -Depth 4)
  exit 0
}

# -Run <id>
$file = $null
if ($Run -match '^[\w.-]+$' -and $dir) { $file = Join-Path $dir "$Run.jsonl" }
if (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { Exit-Unknown "unknown run '$Run'" }
$events = @(Get-Events $file)
if (-not $events.Count) { Exit-Unknown "run '$Run' has no complete event" }
if ($PSBoundParameters.ContainsKey('After')) {
  foreach ($e in $events) { if ($null -ne $e.Seq -and $e.Seq -gt $After) { $e.Line } }
  exit 0
}
$json = Invoke-Fold $file
if ($null -eq $json) { Exit-Unknown "run '$Run' has no complete event" }
Write-Output $json
exit 0
