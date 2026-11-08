<#
.SYNOPSIS
  Terminal backend adapter of the deliver scripts: the only file that calls the terminal CLI (herdr, poimen-server).
.DESCRIPTION
  Dot-source it from Invoke-DeliverLoop.ps1, Start-LoopWorkspace.ps1 and Switch-LogPane.ps1. Backend by Get-TerminalBackend:
  DELIVER_TERMINAL_BACKEND (herdr, poimen, none) wins; else POIMEN_TERMINAL_ID and POIMEN_SOCKET -> poimen; HERDR_ENV=1 -> herdr;
  else none. Every function takes an optional -Backend (default: Get-TerminalBackend), so a caller that blanks HERDR_ENV for its
  children resolves the backend once. `none` and an operation the backend lacks are no-ops with one notice per run (stderr);
  a failing backend call is ignored (verbose message) and never fails the loop, except New-LoopWorkspace and Switch-LogPane, which
  throw so their caller can fall back. The function -> command table is in references/terminal-backends.md.
  DELIVER_LOOP_ASSUME_TTY=1 treats a redirected stdout as a terminal (tests only; see Test-LoopTerminal).
#>

$script:LogPaneLabel = 'deliver-log'
$script:BackendNoticed = $false
$script:PoimenWarned = $false

function Get-TerminalBackend {
  $forced = "$env:DELIVER_TERMINAL_BACKEND".Trim().ToLowerInvariant()
  if ($forced -in 'herdr', 'poimen', 'none') { return $forced }
  if ($env:POIMEN_TERMINAL_ID -and $env:POIMEN_SOCKET) { return 'poimen' }
  if ($env:HERDR_ENV -eq '1') { return 'herdr' }
  return 'none'
}

# The pane (herdr) or terminal (poimen) of this process; empty without a backend.
function Get-LoopPane([string]$Backend = (Get-TerminalBackend)) {
  switch ($Backend) {
    'herdr' { return [string]$env:HERDR_PANE_ID }
    'poimen' { return [string]$env:POIMEN_TERMINAL_ID }
    default { return '' }
  }
}

# One notice per run for a no-op (backend none or an operation the backend lacks).
function Write-BackendNotice([string]$Backend, [string]$Operation) {
  if ($script:BackendNoticed) { return }
  $script:BackendNoticed = $true
  [Console]::Error.WriteLine("deliver: terminal backend '$Backend' does not support $Operation; terminal display calls are skipped.")
}

# poimen-server call (terminal.report_tokens and friends): a missing binary, server or method warns once per run, the loop goes on.
function Invoke-Poimen([string[]]$PoimenArgs) {
  $failed = $false
  try {
    & poimen-server @PoimenArgs 2>$null | Out-Null
    $failed = $LASTEXITCODE -ne 0
  } catch { $failed = $true }
  if ($failed -and -not $script:PoimenWarned) {
    $script:PoimenWarned = $true
    [Console]::Error.WriteLine("deliver: poimen-server '$($PoimenArgs[0..1] -join ' ')' failed (server or method missing); poimen display calls may be skipped.")
  }
}

# "Terminal" for the loop: stdout is not redirected. DELIVER_LOOP_ASSUME_TTY=1 forces true (tests only).
function Test-LoopTerminal {
  return (-not [Console]::IsOutputRedirected) -or $env:DELIVER_LOOP_ASSUME_TTY -eq '1'
}

function Set-LoopTokens {
  [CmdletBinding()]
  param([string]$Pane, [Parameter(Mandatory)][System.Collections.IDictionary]$Token, [int]$TtlMs = 3600000, [string]$Backend = (Get-TerminalBackend))
  try {
    $tokenArgs = @($Token.Keys | ForEach-Object { '--token'; "$_=$($Token[$_])" })
    switch ($Backend) {
      'herdr' { if ($Pane) { & herdr pane report-metadata $Pane --source deliver @tokenArgs --ttl-ms $TtlMs 2>$null | Out-Null } }
      'poimen' {
        $pairs = @($Token.Keys | ForEach-Object { "$_=$($Token[$_])" })
        $ttlSec = [int][math]::Ceiling($TtlMs / 1000)
        Invoke-Poimen (@('report', 'tokens', '--source', 'deliver', '--ttl', "$ttlSec") + $pairs)
      }
      default { Write-BackendNotice $Backend 'tokens' }
    }
  } catch { Write-Verbose "$Backend failed: $_" }
}

function Clear-LoopTokens {
  [CmdletBinding()]
  param([string]$Pane, [Parameter(Mandatory)][string[]]$Name, [string]$Backend = (Get-TerminalBackend))
  try {
    $clearArgs = @($Name | ForEach-Object { '--clear-token'; $_ })
    switch ($Backend) {
      'herdr' { if ($Pane) { & herdr pane report-metadata $Pane --source deliver @clearArgs 2>$null | Out-Null } }
      'poimen' { Invoke-Poimen @('report', 'clear', '--source', 'deliver') }  # clears all tokens of the source
      default { Write-BackendNotice $Backend 'tokens' }
    }
  } catch { Write-Verbose "$Backend failed: $_" }
}

# True when another agent than `deliver` runs in the pane (herdr only; report-agent would replace it).
function Test-LoopAgentConflict([string]$Pane, [string]$Backend = (Get-TerminalBackend)) {
  if ($Backend -ne 'herdr' -or -not $Pane) { return $false }
  try {
    $out = & herdr pane get $Pane 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { return $false }
    $a = (($out -join "`n") | ConvertFrom-Json).result.pane.agent
    return [bool]$a -and $a -ne 'deliver'
  } catch { return $false }
}

# Live herdr (2026-11): the pane id must come right after the subcommand; release-agent rejects it as trailing positional.
function Set-LoopAgentState {
  [CmdletBinding()]
  param([string]$Pane, [Parameter(Mandatory)][ValidateSet('working', 'blocked', 'idle')][string]$State, [string]$Backend = (Get-TerminalBackend))
  try {
    switch ($Backend) {
      'herdr' { if ($Pane) { & herdr pane report-agent $Pane --state $State --source deliver-loop --agent deliver 2>$null | Out-Null } }
      'poimen' { Invoke-Poimen @('report', 'agent', '--state', $State, '--source', 'deliver-loop', '--agent', 'deliver') }
      default { Write-BackendNotice $Backend 'agent state' }
    }
  } catch { Write-Verbose "$Backend failed: $_" }
}

function Clear-LoopAgentState {
  [CmdletBinding()]
  param([string]$Pane, [string]$Backend = (Get-TerminalBackend))
  try {
    switch ($Backend) {
      'herdr' { if ($Pane) { & herdr pane release-agent $Pane --source deliver-loop --agent deliver 2>$null | Out-Null } }
      'poimen' { Invoke-Poimen @('report', 'agent', '--release', '--source', 'deliver-loop', '--agent', 'deliver') }
      default { Write-BackendNotice $Backend 'agent state' }
    }
  } catch { Write-Verbose "$Backend failed: $_" }
}

# Own workspace with a tab and a pane running -Command. Returns $true when started, $false for a backend without
# workspaces (notice). A failing backend call throws: the caller falls back to the current terminal.
function New-LoopWorkspace {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Cwd, [Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][string]$TabLabel,
    [Parameter(Mandatory)][string]$Command, [string]$Backend = (Get-TerminalBackend))
  if ($Backend -ne 'herdr') { Write-BackendNotice $Backend 'workspaces'; return $false }
  $r = (& herdr workspace create --cwd $Cwd --label $Label --no-focus | Out-String | ConvertFrom-Json).result
  $getId = {
    param($o, [string]$name)
    foreach ($k in @("${name}_id", 'id')) { if ($o.PSObject.Properties[$k]) { return [string]$o.$k } }
    return [string]$o
  }
  $tab = & $getId $r.tab 'tab'
  $pane = & $getId $r.root_pane 'pane'
  & herdr tab rename $tab $TabLabel | Out-Null
  & herdr pane run $pane $Command | Out-Null
  return $true
}

# Panes of one tab: -Tab, else the tab of -Pane; every pane when neither is known.
function Get-LogPaneTabPane {
  param([string]$Pane = $env:HERDR_PANE_ID, [string]$Tab)
  $out = & herdr pane list 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { throw 'herdr pane list failed' }
  $panes = @((($out -join "`n") | ConvertFrom-Json).result.panes)
  if (-not $Tab) {
    $own = $panes | Where-Object { $_.pane_id -eq $Pane } | Select-Object -First 1
    if ($own -and $own.PSObject.Properties['tab_id']) { $Tab = $own.tab_id }
  }
  if ($Tab) { return @($panes | Where-Object { $_.PSObject.Properties['tab_id'] -and $_.tab_id -eq $Tab }) }
  return $panes
}

function Get-LogPane {
  param([string]$Pane = $env:HERDR_PANE_ID, [string]$Tab)
  @(Get-LogPaneTabPane -Pane $Pane -Tab $Tab | Where-Object { $_.PSObject.Properties['label'] -and $_.label -eq $script:LogPaneLabel })
}

# Split pane labeled deliver-log below -Pane that tails -LogFile. Nothing when the tab has one, or without a terminal
# (unless -Detached: the caller checked). A backend failure is ignored: the caller runs on without a pane.
function Open-LogPane {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$LogFile, [string]$Pane, [string]$Tab, [switch]$Detached, [string]$Backend = (Get-TerminalBackend))
  if ($Backend -ne 'herdr') { Write-BackendNotice $Backend 'a log pane'; return }
  if (-not $Detached -and -not (Test-LoopTerminal)) { return }
  try {
    $lookup = if ($Pane) { $Pane } else { $env:HERDR_PANE_ID }
    if (Get-LogPane -Pane $lookup -Tab $Tab) { return }
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    if (-not (Test-Path -LiteralPath $LogFile)) { New-Item -ItemType File -Path $LogFile | Out-Null }
    $source = if ($Pane) { $Pane } else { '--current' }
    $out = & herdr pane split $source --direction down --ratio 0.7 --no-focus 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { throw 'herdr pane split failed' }
    $id = (($out -join "`n") | ConvertFrom-Json).result.pane.pane_id
    if (-not $id) { throw 'herdr pane split returned no pane_id' }
    $quoted = $LogFile.Replace("'", "''")
    & herdr pane run $id "pwsh -NoProfile -Command `"Get-Content -Tail 40 -Wait '$quoted'`"" 2>$null | Out-Null
    & herdr pane rename $id $script:LogPaneLabel 2>$null | Out-Null
  } catch { Write-Verbose "log pane not opened: $_" }
}

# Toggle: closes the deliver-log panes of the tab when open and returns 'closed'; else opens the first existing of
# -LogCandidates and returns 'opened', or 'nolog'. Returns 'noop' on a backend without panes (notice).
# A failing pane list throws (the caller reports it and exits 0).
function Switch-LogPane {
  [CmdletBinding()]
  param([string]$Pane, [string]$Tab, [string[]]$LogCandidates = @(), [string]$Backend = (Get-TerminalBackend))
  if ($Backend -ne 'herdr') { Write-BackendNotice $Backend 'a log pane'; return 'noop' }
  $open = Get-LogPane -Pane $Pane -Tab $Tab
  if ($open) {
    foreach ($p in $open) { & herdr pane close $p.pane_id 2>$null | Out-Null }
    return 'closed'
  }
  $log = $LogCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $log) { return 'nolog' }
  Open-LogPane -LogFile $log -Pane $Pane -Tab $Tab -Detached -Backend $Backend
  return 'opened'
}
