<#
.SYNOPSIS
  Fold the progress events of one run (<run>.jsonl) into the run state and print it as JSON.
.DESCRIPTION
  Reference reducer of ADR 0001 ("Projection"). Input: schema/progress-event.schema.json, one event per line, from -Path or
  the pipeline. Output: schema/deliver-run-state.schema.json. The fold is a pure function of the event list and -Now; the
  only other input is the pid check of a run without run.finished (-NoPidCheck turns it off).
  Rules: current from the last issue.started and step.finished, reset by issue.finished; delivered, blocked and paused from
  issue.finished (the latest outcome of an issue wins); needsYou from attention with needsYou: true and the open RC test
  of release.updated (reason 'RC test', until an issue.finished for the test issue); closed/total from milestone.progress;
  release from release.updated; result from run.finished, else running, or abandoned when the pid does not live or the
  last ts is older than one hour. Unknown types and fields are ignored, an incomplete last line is skipped, a gap in seq
  is reported on stderr and folded anyway.
.PARAMETER Path
  The event file <run>.jsonl.
.PARAMETER Now
  ISO 8601 time the age rule compares against (default: the current time). Tests and fixtures pass it.
.PARAMETER NoPidCheck
  Skip the pid test of a run without run.finished (fixtures, a run of another host).
#>
[CmdletBinding()]
param(
  [string]$Path,
  [Parameter(ValueFromPipeline)][string[]]$InputObject,
  [string]$Now,
  [switch]$NoPidCheck
)
begin {
  $ErrorActionPreference = 'Stop'
  $lines = [System.Collections.Generic.List[string]]::new()
}
process {
  foreach ($l in $InputObject) { if ($null -ne $l) { foreach ($p in ($l -split "`r?`n")) { $lines.Add($p) } } }
}
end {
  # System.Text.Json instead of ConvertFrom-Json: timestamps stay the strings of the file (no DateTime conversion)
  function ConvertFrom-JsonElement([System.Text.Json.JsonElement]$e) {
    switch ($e.ValueKind.ToString()) {
      'Object' { $h = @{}; foreach ($p in $e.EnumerateObject()) { $h[$p.Name] = ConvertFrom-JsonElement $p.Value }; return $h }
      'Array' { return , @(foreach ($x in $e.EnumerateArray()) { ConvertFrom-JsonElement $x }) }
      'String' { return $e.GetString() }
      'Number' { $n = 0L; if ($e.TryGetInt64([ref]$n)) { return $n }; return $e.GetDouble() }
      'True' { return $true }
      'False' { return $false }
    }
    return $null
  }
  function Write-Note([string]$text) { Write-Error "ConvertFrom-ProgressEvents: $text" -ErrorAction Continue }
  function Test-Int($v) { $v -is [long] -or $v -is [int] }

  if ($Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Write-Note "no event file '$Path'"; exit 1 }
    foreach ($p in ([System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).ProviderPath) -split "`r?`n")) { $lines.Add($p) }
  }
  $nonEmpty = @(for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim()) { $i } })
  $events = [System.Collections.Generic.List[hashtable]]::new()
  foreach ($i in $nonEmpty) {
    $ev = $null
    try {
      $doc = [System.Text.Json.JsonDocument]::Parse($lines[$i])
      try { if ($doc.RootElement.ValueKind.ToString() -eq 'Object') { $ev = ConvertFrom-JsonElement $doc.RootElement } } finally { $doc.Dispose() }
    } catch { $ev = $null }
    if ($null -eq $ev) {
      # the last line may still be written (append in progress): skipped without a note
      if ($i -ne $nonEmpty[-1]) { Write-Note "line $($i + 1) is not a JSON object, skipped" }
      continue
    }
    $events.Add($ev)
  }
  if (-not $events.Count) { Write-Note 'no progress events'; exit 1 }

  $known = 'run.started', 'milestone.progress', 'issue.started', 'step.finished', 'attention', 'issue.finished', 'release.updated', 'run.finished'
  $results = 'done', 'max reached', 'blocked', 'no progress'
  $stepNumbers = @{ select = 1; resume = 2; implement = 3; review = 4; fix = 5; pr = 6; ci = 7; merge = 7; merged = 7; cleanup = 7 }
  $tsPattern = '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'

  $s = @{
    run = $null; harness = $null; model = $null; repository = $null; milestone = $null; closed = 0; total = 0
    current = $null; startedAt = $null; updatedAt = $null; result = $null; pid = $null; lastTs = $null
  }
  $delivered = [ordered]@{}; $blocked = [ordered]@{}; $paused = [ordered]@{}; $needs = [ordered]@{}
  $release = [ordered]@{ reviewRound = $null; prUrl = $null; rcUrl = $null; rcVersion = $null; testIssue = $null }
  $titles = @{}; $urls = @{}; $prs = @{}

  function Get-IssueUrl([int]$n) {
    if ($urls.ContainsKey($n)) { return $urls[$n] }
    if ($s.repository) { return "https://github.com/$($s.repository)/issues/$n" }
    return "#$n"
  }
  function ConvertTo-Current([int]$n) {
    [ordered]@{
      number = $n
      title = $(if ($titles.ContainsKey($n)) { $titles[$n] } else { "#$n" })
      url = (Get-IssueUrl $n)
      step = [ordered]@{ n = 1; total = 7; text = 'select' }
      prUrl = $(if ($prs.ContainsKey($n)) { $prs[$n] } else { $null })
    }
  }
  function Set-Step($cur, $step) {
    if ($step -isnot [hashtable] -or -not $step.name) { return }
    $n = if (Test-Int $step.n) { [int]$step.n } elseif ($stepNumbers.ContainsKey([string]$step.name)) { $stepNumbers[[string]$step.name] } else { $cur.step.n }
    $cur.step = [ordered]@{
      n = [Math]::Min(7, [Math]::Max(1, $n))
      total = 7
      text = $(if ($step.text) { "$($step.name): $($step.text)" } else { [string]$step.name })
    }
  }
  function ConvertTo-StateItem([int]$n, $reason) { [ordered]@{ number = $n; url = (Get-IssueUrl $n); reason = [string]$reason } }

  $prevSeq = $null
  foreach ($e in $events) {
    if (Test-Int $e.seq) {
      $expected = if ($null -eq $prevSeq) { 1 } else { $prevSeq + 1 }
      if ($e.seq -ne $expected) { Write-Note "seq gap: expected $expected, got $($e.seq)" }
      $prevSeq = [long]$e.seq
    }
    $type = [string]$e.type
    if ($type -notin $known) { continue }

    if (-not $s.run -and $e.run) { $s.run = [string]$e.run }
    if ($e.ts -is [string] -and $e.ts -match $tsPattern) {
      $s.updatedAt = $e.ts
      if (-not $s.startedAt) { $s.startedAt = $e.ts }
      $s.lastTs = [DateTimeOffset]::Parse($e.ts, [Globalization.CultureInfo]::InvariantCulture)
    }
    $nr = 0
    if ($e.issue -is [hashtable] -and (Test-Int $e.issue.number) -and $e.issue.number -ge 1) {
      $nr = [int]$e.issue.number
      if ($e.issue.title) { $titles[$nr] = [string]$e.issue.title }
      if ($e.issue.url) { $urls[$nr] = [string]$e.issue.url }
      if ($e.prUrl -and $type -ne 'release.updated') { $prs[$nr] = [string]$e.prUrl }
    }
    $isCurrent = $nr -and $s.current -and $s.current.number -eq $nr

    switch ($type) {
      'run.started' {
        foreach ($k in 'harness', 'model', 'repository') { if ($e[$k]) { $s[$k] = [string]$e[$k] } }
        if ($e.milestone -is [hashtable]) {
          $s.milestone = [ordered]@{ key = [string]$e.milestone.key; title = [string]$e.milestone.title; url = [string]$e.milestone.url }
        }
        if (Test-Int $e.pid) { $s.pid = [int]$e.pid }
        if ($e.ts -is [string] -and $e.ts -match $tsPattern) { $s.startedAt = $e.ts }
      }
      'milestone.progress' {
        if (Test-Int $e.closed) { $s.closed = [int]$e.closed }
        if (Test-Int $e.total) { $s.total = [int]$e.total }
      }
      'issue.started' {
        if ($nr) { $s.current = ConvertTo-Current $nr; Set-Step $s.current $e.step }
      }
      'step.finished' {
        if ($nr -and -not $isCurrent) { $s.current = ConvertTo-Current $nr }
        if ($nr -or $s.current) {
          Set-Step $s.current $e.step
          if ($e.prUrl) { $s.current.prUrl = [string]$e.prUrl }
        }
      }
      'attention' {
        if ($isCurrent -and $e.prUrl) { $s.current.prUrl = [string]$e.prUrl }
        if ($nr -and $e.needsYou -eq $true) {
          $reason = if ($e.kind -eq 'release_test') { 'RC test' } elseif ($e.reason) { $e.reason } else { 'needs you' }
          $needs["$nr"] = ConvertTo-StateItem $nr $reason
        }
      }
      'issue.finished' {
        if (-not $nr) { break }
        if ($needs.Contains("$nr") -and $needs["$nr"].reason -eq 'RC test') { $needs.Remove("$nr") }
        switch ([string]$e.outcome) {
          'delivered' {
            $delivered["$nr"] = [ordered]@{ pbi = $nr; url = (Get-IssueUrl $nr); prUrl = $(if ($prs.ContainsKey($nr)) { $prs[$nr] } else { Get-IssueUrl $nr }) }
            $blocked.Remove("$nr"); $paused.Remove("$nr"); $needs.Remove("$nr")
          }
          'skipped' { $blocked.Remove("$nr"); $paused.Remove("$nr"); $needs.Remove("$nr") }
          'blocked' { $paused.Remove("$nr"); $blocked["$nr"] = ConvertTo-StateItem $nr $(if ($e.reason) { $e.reason } else { 'blocked' }) }
          'paused' { $blocked.Remove("$nr"); $paused["$nr"] = ConvertTo-StateItem $nr $(if ($e.reason) { $e.reason } else { 'paused' }) }
        }
        if ($isCurrent) { $s.current = $null }
      }
      'release.updated' {
        foreach ($k in 'prUrl', 'rcUrl', 'rcVersion') { if ($e[$k]) { $release[$k] = [string]$e[$k] } }
        if ((Test-Int $e.reviewRound) -and $e.reviewRound -ge 1) { $release.reviewRound = [int]$e.reviewRound }
        if ($e.testIssue -is [hashtable] -and (Test-Int $e.testIssue.number) -and $e.testIssue.number -ge 1) {
          $t = [int]$e.testIssue.number
          if ($e.testIssue.url) { $urls[$t] = [string]$e.testIssue.url }
          $old = $release.testIssue
          if ($old -and $old.number -ne $t -and $needs.Contains("$($old.number)") -and $needs["$($old.number)"].reason -eq 'RC test') { $needs.Remove("$($old.number)") }
          $release.testIssue = [ordered]@{ number = $t; url = (Get-IssueUrl $t) }
          $needs["$t"] = ConvertTo-StateItem $t 'RC test'
        }
      }
      'run.finished' {
        $s.result = if ([string]$e.result -in $results) { [string]$e.result } else { 'done' }
      }
    }
  }

  if (-not $s.result) {
    $s.result = 'running'
    $nowAt = if ($Now) { [DateTimeOffset]::Parse($Now, [Globalization.CultureInfo]::InvariantCulture) } else { [DateTimeOffset]::UtcNow }
    if ($s.lastTs -and ($nowAt - $s.lastTs).TotalHours -gt 1) { $s.result = 'abandoned' }
    elseif ($s.pid -and -not $NoPidCheck -and -not (Get-Process -Id $s.pid -ErrorAction SilentlyContinue)) { $s.result = 'abandoned' }
  }
  if ($s.result -ne 'running') { $s.current = $null }

  $state = [ordered]@{
    run = $s.run
    harness = $s.harness
    model = $(if ($s.model) { $s.model } else { 'default' })
    repository = $s.repository
    milestone = $s.milestone
    closed = $s.closed
    total = $s.total
    current = $s.current
    delivered = @($delivered.Values)
    blocked = @($blocked.Values)
    paused = @($paused.Values)
    needsYou = @($needs.Values)
    release = $release
    startedAt = $s.startedAt
    updatedAt = $s.updatedAt
    result = $s.result
  }
  $state | ConvertTo-Json -Depth 8
  exit 0
}
