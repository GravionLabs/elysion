<#
.SYNOPSIS
  Append one progress event of a run to <git-common-dir>/.agents/events/<run>.jsonl (or $AGENT_EVENTS_DIR/<run>.jsonl).
.DESCRIPTION
  Schema: schema/progress-event.schema.json. The run id is AGENT_EVENTS_RUN. Without it, -Type run.started creates one
  (yyyyMMdd-HHmmss-<4 hex>) and prints `AGENT_EVENTS_RUN=<id>`; every other type without a run does nothing (exit 0).
  `seq` counts up per run without gaps (the file is locked while the line is counted and appended). The line is written
  whole in one write call. `tone` is decided here from type, step, result and kind (Get-Tone, table in the schema).
  The host (POIMEN_TERMINAL_ID, HERDR_PANE_ID) is read from the environment, never passed by the agent.
  Terminal sink: after the append the event is shown in the terminal (tokens and agent state through TerminalBackend.ps1,
  mapping checked by the token fixtures test/skills/delivery/fixtures/progress-events/*.tokens.json). Only the outermost emitter reports: the process that writes run.started
  prints `AGENT_EVENTS_TERMINAL=owner` next to the run id (this script only prints the line). The owner, whoever wrote
  run.started, must export AGENT_EVENTS_RUN and AGENT_EVENTS_TERMINAL=owner and must override or unset AGENT_EVENTS_TERMINAL
  for every child process it starts. An emitter reports when it has no AGENT_EVENTS_RUN (no run owner, interactive /deliver),
  created the run, or has `owner`; an emitter with a run but without `owner` (a nested one) skips the sink. An interactive
  session that exports only AGENT_EVENTS_RUN is therefore treated as nested. Backend none or a failing call: no-op, the event is written anyway.
  Retention: -Type run.started deletes finished and abandoned runs older than AGENT_EVENTS_KEEP_DAYS (default 7) and all
  beyond the newest AGENT_EVENTS_KEEP (default 100), in the events dir and in .agents/deliver-loop/<run>/ (ProgressRetention.ps1).
  Running runs (live pid) and the current run are kept.
  Never fails the caller: an I/O error prints one line to stderr and the exit code is 0.
.PARAMETER Type
  run.started, milestone.progress, issue.started, step.finished, attention, issue.finished, release.updated or run.finished.
.PARAMETER Kind
  attention kind: pr_opened, review_fix, ci_red, paused, blocked, needs_you or release_test.
.PARAMETER Outcome
  issue.finished: delivered, blocked, paused or skipped.
.PARAMETER ReviewRound
  release.updated: the round of the release review (1, 2, ...).
.PARAMETER RunResult
  run.finished result: done, max reached, blocked, no progress, ...
.PARAMETER SinkEvent
  JSON of an event already written: only the terminal sink shows it (used by Invoke-DeliverLoop.ps1 for the events of the harness).
.PARAMETER Run
  Run id to write to; the fallback is AGENT_EVENTS_RUN. An interactive session passes the id printed by run.started with
  every later call (Bash calls share no shell state, and an env prefix would not match the permission allowlist). -Run
  alone does not make the emitter nested: without AGENT_EVENTS_RUN it still reports to the terminal.
#>
param(
  [Parameter(Mandatory)][string]$Type,
  [int]$Issue,
  [string]$Title,
  [string]$Url,
  [string]$Step,
  [int]$StepN,
  [int]$StepTotal,
  [string]$Result,
  [string]$Pr,
  [string]$Kind,
  [string]$Reason,
  [string]$Outcome,
  [int]$Closed = -1,
  [int]$Total = -1,
  [string]$RunResult,
  [string]$Source,
  [string]$Harness,
  [string]$Model,
  [string]$Repository,
  [string]$Milestone,
  [string]$MilestoneTitle,
  [string]$MilestoneUrl,
  [string]$RcUrl,
  [string]$RcVersion,
  [int]$TestIssue,
  [string]$TestIssueUrl,
  [string]$PrUrl,
  [int]$ReviewRound,
  [string]$Run,
  [string]$SinkEvent
)
$ErrorActionPreference = 'Stop'

# Tone: neutral, info, success, warning, danger. The only place of the tone rules (the loop colors by the tone of the event).
function Get-Tone([string]$type, [string]$step, [string]$result, [string]$kind, [string]$outcome, [string]$runResult) {
  switch ($type) {
    'attention' {
      switch ($kind) {
        'pr_opened' { return 'success' }
        { $_ -in 'review_fix', 'paused', 'needs_you', 'release_test' } { return 'warning' }
        { $_ -in 'ci_red', 'blocked' } { return 'danger' }
      }
      return 'neutral'
    }
    'issue.finished' {
      switch ($outcome) { 'delivered' { return 'success' } 'blocked' { return 'danger' } 'paused' { return 'warning' } }
      return 'neutral'
    }
    'run.finished' {
      switch ($runResult) { 'done' { return 'success' } 'no progress' { return 'warning' } 'blocked' { return 'danger' } }
      return 'neutral'
    }
    'step.finished' {
      if ($step -eq 'done') { return 'success' }
      if ($result -match '\bblocked\b' -or $step -eq 'blocked') { return 'danger' }
      if ($result -match '\bpaused\b' -or $step -eq 'paused') { return 'warning' }
      switch -Regex ($step) {
        '^pr$' { return 'success' }
        '^merge(d)?$' { return 'success' }
        '^review$' { if ($result -match 'fix') { return 'warning' } }
        '^ci$' { if ($result -match 'red|fail') { return 'danger' } }
      }
      return 'neutral'
    }
  }
  return 'neutral'
}

. (Join-Path $PSScriptRoot 'TerminalBackend.ps1')
. (Join-Path $PSScriptRoot 'ProgressRetention.ps1')

# Terminal sink: tokens and agent state of one event. Mapping: the token fixtures (references/terminal-backends.md).
# Deprecated (ADR 0002): DELIVER_TERMINAL_SINK=0 switches it off; unset or any other value keeps it.
function Send-TerminalSink($ev, [string]$prUrl) {
  if ($env:DELIVER_TERMINAL_SINK -eq '0') { return }
  $backend = Get-TerminalBackend
  if ($backend -eq 'none') { return }
  $pane = Get-LoopPane $backend
  $script:SinkConflict = $null
  # Evaluated lazily: only an event that sets or releases an agent state asks the pane for another agent.
  $conflict = { if ($null -eq $script:SinkConflict) { $script:SinkConflict = [bool](Test-LoopAgentConflict -Pane $pane -Backend $backend) }; $script:SinkConflict }
  $state = { param($s) if (-not (& $conflict)) { Set-LoopAgentState -Pane $pane -State $s -Backend $backend } }
  switch ($ev.type) {
    'step.finished' {
      $t = [ordered]@{}
      if ($ev.issue) { $t['deliver'] = "#$($ev.issue.number)" }
      if ($ev.step) {
        $text = "$($ev.step.name)"
        if ($ev.step.n -and $ev.step.total) { $text = "$($ev.step.n)/$($ev.step.total) $text" }
        if ($ev.step.text) { $text += ": $($ev.step.text)" }
        if ($text.Length -gt 80) { $text = $text.Substring(0, 80) }
        $t['deliver_step'] = $text
      }
      if ($prUrl -match '(\d+)/?$') { $t['deliver_pr'] = "#$($Matches[1])" }
      $t['deliver_tone'] = $ev.tone
      Set-LoopTokens -Pane $pane -Token $t -Backend $backend
    }
    'milestone.progress' {
      if ($null -ne $ev.closed -and $null -ne $ev.total) { Set-LoopTokens -Pane $pane -Token ([ordered]@{ deliver_progress = "$($ev.closed)/$($ev.total)" }) -Backend $backend }
    }
    'issue.started' { & $state 'working' }
    'attention' { if ($ev.kind -in 'paused', 'blocked') { & $state 'blocked' } }
    'run.finished' {
      Clear-LoopTokens -Pane $pane -Name 'deliver', 'deliver_step', 'deliver_pr', 'deliver_progress', 'deliver_tone' -Backend $backend
      & $state $(if ($ev.result -in 'blocked', 'no progress') { 'blocked' } else { 'idle' })
      if (-not (& $conflict)) { Clear-LoopAgentState -Pane $pane -Backend $backend }
    }
  }
}

$stepNumbers = @{ select = 1; resume = 2; implement = 3; review = 4; fix = 5; pr = 6; ci = 7; merge = 7; merged = 7 }

function Add-If($h, [string]$k, $v) { if ($null -ne $v -and "$v" -ne '') { $h[$k] = $v } }

try {
  if ($SinkEvent) {
    # -SinkEvent <json of an existing event>: only the terminal sink, nothing appended (the loop shows the harness's events)
    Send-TerminalSink ($SinkEvent | ConvertFrom-Json) $Pr
    exit 0
  }
  $run = if ($Run) { $Run } else { $env:AGENT_EVENTS_RUN }
  # a nested emitter (inherited AGENT_EVENTS_RUN without the owner marker, no -Run) neither starts nor finishes the owner's run (#411)
  if (-not $PSBoundParameters.ContainsKey('Run') -and $env:AGENT_EVENTS_RUN -and $env:AGENT_EVENTS_TERMINAL -ne 'owner' -and $Type -in 'run.started', 'run.finished') { exit 0 }
  $created = $false
  if (-not $run) {
    if ($Type -ne 'run.started') { exit 0 }
    $run = '{0}-{1}' -f (Get-Date).ToString('yyyyMMdd-HHmmss'), ('{0:x4}' -f (Get-Random -Maximum 65536))
    $created = $true
  }
  if ($run -notmatch '^[\w.-]+$') { throw "invalid run id '$run'" }

  $dir = $env:AGENT_EVENTS_DIR
  if (-not $dir) {
    $common = @(& git -C (Get-Location).Path rev-parse --git-common-dir 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or -not $common) { throw 'not in a git repository and AGENT_EVENTS_DIR is not set' }
    $dir = Join-Path ([System.IO.Path]::GetFullPath($common, (Get-Location).Path)) '.agents/events'
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir "$run.jsonl"

  $tone = Get-Tone $Type $Step $Result $Kind $Outcome $RunResult
  $ev = [ordered]@{ v = 1; seq = 0; ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); run = $run; type = $Type; tone = $tone }

  if ($Type -eq 'run.started') {
    Add-If $ev source $Source
    Add-If $ev harness $Harness
    Add-If $ev model $Model
    if (-not $Repository) {
      $remote = @(& git -C (Get-Location).Path remote get-url origin 2>$null)[0]
      if ($LASTEXITCODE -eq 0 -and $remote -match '[:/]([^/:]+/[^/]+?)(\.git)?$') { $Repository = $Matches[1] }
    }
    Add-If $ev repository $Repository
    if ($Milestone -or $MilestoneTitle -or $MilestoneUrl) {
      $m = [ordered]@{}; Add-If $m key $Milestone; Add-If $m title $MilestoneTitle; Add-If $m url $MilestoneUrl; $ev.milestone = $m
    }
    # a session starts its run with a separate call: this process exits at once, so no pid (the one-hour rule covers it)
    if ($Source -ne 'session') { $ev.pid = $PID }
    $h = [ordered]@{}; Add-If $h poimenTerminal $env:POIMEN_TERMINAL_ID; Add-If $h herdrPane $env:HERDR_PANE_ID
    if ($h.Count) { $ev.host = $h }
  }
  if ($Issue) {
    $i = [ordered]@{ number = $Issue }; Add-If $i title $Title; Add-If $i url $Url; $ev.issue = $i
  }
  if ($Step) {
    $s = [ordered]@{ name = $Step }
    if (-not $StepN -and $stepNumbers.ContainsKey($Step)) { $StepN = $stepNumbers[$Step]; if (-not $StepTotal) { $StepTotal = 7 } }
    if ($StepN) { $s.n = $StepN }
    if ($StepTotal) { $s.total = $StepTotal }
    Add-If $s text $Result
    $ev.step = $s
  }
  Add-If $ev prUrl $Pr
  if ($Type -eq 'attention') {
    Add-If $ev kind $Kind
    if ($Kind -in 'needs_you', 'release_test') { $ev.needsYou = $true }
  }
  # the reason of an attention and of an issue.finished (blocked, paused: the projection's reason)
  if ($Type -in 'attention', 'issue.finished') { Add-If $ev reason $Reason }
  Add-If $ev outcome $Outcome
  if ($Closed -ge 0) { $ev.closed = $Closed }
  if ($Total -ge 0) { $ev.total = $Total }
  Add-If $ev result $RunResult
  if ($Type -eq 'release.updated') {
    Add-If $ev rcUrl $RcUrl; Add-If $ev rcVersion $RcVersion
    if ($TestIssue) { $t = [ordered]@{ number = $TestIssue }; Add-If $t url $TestIssueUrl; $ev.testIssue = $t }
    Add-If $ev prUrl $PrUrl
    if ($ReviewRound) { $ev.reviewRound = $ReviewRound }
  }

  # lock the file while the lines are counted and the new one is appended (seq without gaps), one write call
  $fs = $null
  for ($try = 0; $try -lt 50 -and -not $fs; $try++) {
    try { $fs = [System.IO.FileStream]::new($file, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) }
    catch [System.IO.IOException] { Start-Sleep -Milliseconds 20 }
  }
  if (-not $fs) { throw "cannot lock $file" }
  try {
    $bytes = [byte[]]::new($fs.Length)
    [void]$fs.Read($bytes, 0, $bytes.Length)
    $n = 0; foreach ($b in $bytes) { if ($b -eq 10) { $n++ } }
    $ev.seq = $n + 1
    $line = [System.Text.Encoding]::UTF8.GetBytes((($ev | ConvertTo-Json -Compress -Depth 6) + "`n"))
    $fs.Seek(0, [System.IO.SeekOrigin]::End) | Out-Null
    $fs.Write($line, 0, $line.Length)
    $fs.Flush()
  } finally { $fs.Dispose() }
  if ($Type -eq 'run.started') {
    # retention: old event files and stream recordings (next to the events dir and under the current directory)
    $loopDirs = @((Join-Path (Split-Path $dir -Parent) 'deliver-loop'), (Join-Path (Get-Location).Path '.agents/deliver-loop'))
    Invoke-ProgressRetention -EventsDir $dir -LoopDirs $loopDirs -CurrentRun $run
  }
  if ($created) { Write-Output "AGENT_EVENTS_RUN=$run"; Write-Output 'AGENT_EVENTS_TERMINAL=owner' }
  if (-not $env:AGENT_EVENTS_RUN -or $created -or $env:AGENT_EVENTS_TERMINAL -eq 'owner') {
    try { Send-TerminalSink ([pscustomobject]($ev | ConvertTo-Json -Depth 6 | ConvertFrom-Json)) $Pr } catch { Write-Verbose "terminal sink: $_" }
  }
} catch {
  [Console]::Error.WriteLine("Report-Progress: $($_.Exception.Message)")
}
exit 0
