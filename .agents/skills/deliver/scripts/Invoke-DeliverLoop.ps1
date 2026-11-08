<#
.SYNOPSIS
  Runs `/deliver` in a fresh harness process per PBI until the targets are done, blocked, stalled or -Max is reached.
.DESCRIPTION
  A long unattended run in one session grows its context and dies with it. This loop starts
  `claude -p "/deliver <targets> --unattended --max 1"` (`-Harness claude`, the default) or `copilot -p` (`-Harness copilot`) once per PBI; deliver keeps all state in GitHub, so there is no
  queue file. Progress is read from GitHub before and after each iteration: the open PBIs of the targets without the
  labels needs-decision / needs-refinement / interactive (deliver skips interactive PBIs unattended). No change stops
  the loop ("no progress"); nothing open means done (unless a closed PBI of the milestone carries needs-decision, the paused release review: blocked); open PBIs that all wait on an open blocker or a label mean blocked.
  Observability: every stream record goes to .agents/deliver-loop/<run>/<nr>.jsonl (<nr> is the first PBI that was ready
  at the start of the iteration), a summary line per step to .agents/deliver-loop.log (plain) and stdout, the same line
  with ANSI colors to .agents/deliver-loop.ansi.log (long text is cut to the terminal width, 120 characters when redirected), desktop notifications for the attention steps (macOS osascript,
  Windows toast), progress events (Report-Progress.ps1: run.started, issue.started, step.finished, attention, milestone.progress,
  issue.finished, release.updated, run.finished; its terminal sink sets the pane tokens and the agent state), a progress line per step
  and status.json (deprecated; the projection of the events, -Milestone; references/loop.md) and, with -LogPane in herdr on a terminal,
  a split pane labeled deliver-log below the session that tails the log (TerminalBackend.ps1; never closed by the loop).
  Stdout carries the colors of the .ansi.log when it is a terminal and neither -NoColor nor NO_COLOR is set; otherwise it is plain.
  Machine-readable progress for a control session (`deliver` `references/control.md`): .agents/deliver-loop/<run>/progress.jsonl,
  one JSON object per line (`start`, `iteration-start`, `iteration-end`, `result`), and .agents/deliver-loop/latest.txt with the path of the newest run directory.
  Run it from the repository root. Exit code: 0 done or max reached, 1 no progress, 2 blocked, 64 bad arguments.
.PARAMETER Target
  Issue numbers (PBI, Feature or Epic), as for `/deliver`: `-Target 12,14` or `-Target 12 14` (a comma list also works
  under `pwsh -File`, which does not split it itself).
.PARAMETER Milestone
  Adds the open PBIs and bugs of this milestone (as `/deliver --milestone`): M<n> or a sub-number M<n>.<m> (also after close renamed it M<n> (x.y.z)) or a legacy title.
.PARAMETER Max
  Stop after this many iterations (PBIs delivered, blocked or paused in total).
.PARAMETER Model
  Model per PBI for every iteration. Without it, claude takes the model of the PBI's tier (fast haiku, standard sonnet,
  strong opus; the `Tier:` line of the body, else the size S/M/L, else standard; `references/roles.md`), and copilot uses auto.
.PARAMETER Harness
  claude (Claude Code, default) or copilot (GitHub Copilot CLI: `copilot -p … --model <model> --allow-all-tools
  --allow-all-paths --allow-all-urls --no-ask-user --output-format json`). Any other value fails before the first iteration.
.PARAMETER LogPane
  Opens the herdr log pane `deliver-log` (herdr, stdout a terminal). Off by default: toggle it with Switch-LogPane.ps1.
.PARAMETER NoPane
  Deprecated no-op (the pane is off by default); use -LogPane to open it.
.PARAMETER NoColor
  Writes no .ansi.log and colors no stdout (as does a non-empty NO_COLOR); the pane tails the plain log.
#>
[CmdletBinding()]
param(
  [string[]]$Target = @(),
  [string]$Milestone = '',
  [ValidateRange(1, 10000)][int]$Max = 0,
  [string]$Model = '',
  [string]$Harness = 'claude',
  [switch]$LogPane,
  [switch]$NoPane,
  [switch]$NoColor,
  [Parameter(ValueFromRemainingArguments)][string[]]$MoreTargets = @()
)
$ErrorActionPreference = 'Stop'

$Harnesses = @('claude', 'copilot')
if ($Harness -notin $Harnesses) {
  [Console]::Error.WriteLine("Unknown -Harness '$Harness'. Supported: $($Harnesses -join ', ').")
  exit 64
}

if ($NoPane) { [Console]::Error.WriteLine('deliver-loop: -NoPane is deprecated and does nothing (the log pane is off by default; -LogPane opens it).') }

if ($Harness -eq 'copilot' -and -not $Model) { $Model = 'auto' }

# Model per tier (references/roles.md): the tier decides the model of an iteration when -Model is not given.
$TierModels = @{ fast = 'haiku'; standard = 'sonnet'; strong = 'opus' }
function Get-PbiTier([int]$nr) {
  $issue = Get-Json @('api', "repos/{owner}/{repo}/issues/$nr")
  $body = [string]$issue.body
  $tier = $null; $from = 'default'
  if ($body -match '(?m)^\s*(?:[-*]\s*)?\**Tier:?\**:?\s*(fast|standard|strong)\b') { $tier = $Matches[1]; $from = 'Tier line' }
  elseif ($body -match '(?m)^\s*(?:[-*]\s*)?\**Size:?\**:?\s*([SML])\b') {
    $tier = @{ S = 'fast'; M = 'standard'; L = 'strong' }[$Matches[1]]; $from = "size $($Matches[1])"
  }
  if (-not $tier) { $tier = 'standard' }
  [pscustomobject]@{ Tier = $tier; Model = $TierModels[$tier]; From = $from }
}

$Nrs = @(($Target + $MoreTargets) | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
if (($Nrs | Where-Object { $_ -notmatch '^\d+$' }) -or ($Nrs.Count -eq 0 -and -not $Milestone)) {
  [Console]::Error.WriteLine('Give -Target <nr...> (issue numbers) and/or -Milestone <name>.')
  exit 64
}
$Nrs = @($Nrs | ForEach-Object { [int]$_ })

$Held = @('needs-decision', 'needs-refinement', 'interactive')
$LogFile = Join-Path (Get-Location) '.agents/deliver-loop.log'
$AnsiFile = if ($NoColor -or $env:NO_COLOR) { '' } else { Join-Path (Get-Location) '.agents/deliver-loop.ansi.log' }
$Esc = [char]27
$Ansi = @{ dim = "$Esc[2m"; cyan = "$Esc[36m"; red = "$Esc[31m"; yellow = "$Esc[33m"; green = "$Esc[32m"; reset = "$Esc[0m" }
# stdout gets the colors of the .ansi.log when it is a terminal (Test-LoopTerminal in TerminalBackend.ps1 defines "terminal").
. (Join-Path $PSScriptRoot 'TerminalBackend.ps1')
$ColorStdout = [bool]$AnsiFile -and (Test-LoopTerminal)
# named after the run id once run.started is written (Start-Run); the time stamp is the fallback
$RunDir = Join-Path (Get-Location) ".agents/deliver-loop/$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
$Progress = Join-Path $RunDir 'progress.jsonl'
$Recent = [System.Collections.Generic.List[string]]::new()
$AgentNames = @{}
# resolved once, for the log pane and the agent conflict notice; tokens and agent state go through the sink of Report-Progress.ps1
$Backend = Get-TerminalBackend
$Pane = Get-LoopPane $Backend

# One step: plain to the log; colored to the .ansi.log and a terminal stdout (time dim, $Tool cyan, the rest in $Color).
# $Tool is looked up from $ToolAt on (after the subagent prefix).
function Write-Step([string]$text, [string]$Color = '', [string]$Tool = '', [int]$ToolAt = 0) {
  $time = (Get-Date).ToString('HH:mm:ss')
  $line = "$time $text"
  New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
  [IO.File]::AppendAllText($LogFile, $line + "`n")
  $colored = $line
  if ($AnsiFile) {
    $body = if ($Color) { "$($Ansi[$Color])$text$($Ansi.reset)" } else { $text }
    $at = if ($Tool) { $text.IndexOf($Tool, $ToolAt) } else { -1 }
    if ($at -ge 0 -and -not $Color) { $body = $text.Substring(0, $at) + "$($Ansi.cyan)$Tool$($Ansi.reset)" + $text.Substring($at + $Tool.Length) }
    $colored = "$($Ansi.dim)$time$($Ansi.reset) $body"
    [IO.File]::AppendAllText($AnsiFile, $colored + "`n")
  }
  Write-Host $(if ($ColorStdout) { $colored } else { $line })
  $Recent.Add($line)
  if ($Recent.Count -gt 10) { $Recent.RemoveAt(0) }
}

# Urgency from the tone of the event: danger and warning get a sound on macOS, the rest is silent.
function Send-Notice([string]$text, [string]$Tone = '') {
  try {
    if ($IsMacOS) {
      $esc = $text.Replace('\', '\\').Replace('"', '\"')
      $sound = switch ($Tone) { 'danger' { ' sound name "Basso"' } 'warning' { ' sound name "Ping"' } default { '' } }
      & osascript -e "display notification `"$esc`" with title `"deliver loop`"$sound" 2>$null | Out-Null
    } elseif ($IsWindows) {
      [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
      $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent('ToastText02')
      $nodes = $xml.GetElementsByTagName('text')
      [void]$nodes.Item(0).AppendChild($xml.CreateTextNode('deliver loop'))
      [void]$nodes.Item(1).AppendChild($xml.CreateTextNode($text))
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PowerShell').Show([Windows.UI.Notifications.ToastNotification]::new($xml))
    }
  } catch { Write-Verbose "notification failed: $_" }
}

# Get-Milestones.ps1 of github-milestone: sibling skill (installed) or skills/github (repository)
$MilestoneScript = @('../../github-milestone', '../../../github/github-milestone' | ForEach-Object { Join-Path $PSScriptRoot "$_/scripts/Get-Milestones.ps1" }) |
  Where-Object { Test-Path $_ } | Select-Object -First 1

# Progress events (ADR 0001, #372): the loop opens the run (run.started), emits what it knows itself (issue.started,
# step.finished and attention followed from the harness's events, attention, milestone.progress and the waiting / needs-you items of
# Get-DeliverStatus.ps1, issue.finished from the GitHub state, run.finished) and is the owner of the terminal sink of
# Report-Progress.ps1: tokens and agent state come from there, never from the loop. The harness gets AGENT_EVENTS_RUN with an
# empty AGENT_EVENTS_TERMINAL (nested: its own events skip the sink). status.json (deprecated) is the projection
# (ConvertFrom-ProgressEvents.ps1) of the event file after every event; it needs -Milestone.
$ReportScript = Join-Path $PSScriptRoot 'Report-Progress.ps1'
$ReducerScript = Join-Path $PSScriptRoot 'ConvertFrom-ProgressEvents.ps1'
$StatusScript = Join-Path $PSScriptRoot 'Get-DeliverStatus.ps1'
$StatusFile = Join-Path (Get-Location) '.agents/deliver-loop/status.json'
# one events directory for the loop, Report-Progress and the harness: AGENT_EVENTS_DIR, else <git-common-dir>/.agents/events,
# outside a git repository .agents/events
if (-not $env:AGENT_EVENTS_DIR) {
  $common = try { @(& git rev-parse --git-common-dir 2>$null)[0] } catch { $null }
  $env:AGENT_EVENTS_DIR = if ($LASTEXITCODE -eq 0 -and $common) {
    Join-Path ([IO.Path]::GetFullPath($common, (Get-Location).Path)) '.agents/events'
  } else { Join-Path (Get-Location) '.agents/events' }
}
$LoopHerdrEnv = $env:HERDR_ENV
$RunId = ''
$EventFile = ''
$Finished = $false
$Projection = $null
$Block = $null
$Delivered = @()
$Prs = @{}
$LineOutcome = @{}
$Reported = @{}
$ReleaseKey = ''

function Get-RefNumber([string]$text) { if ($text -match '/(?:issues|pull)/(\d+)') { [int]$Matches[1] } else { 0 } }

function Get-BaseUrl {
  if ($Block -and $Block.baseUrl) { return ([string]$Block.baseUrl).TrimEnd('/') }
  if ($Projection -and $Projection.repository) { return "https://github.com/$($Projection.repository)" }
  return ''
}

function Get-PrUrl([string]$n) { $base = Get-BaseUrl; if ($base) { "$base/pull/$n" } else { "#$n" } }

# status.json: the projection of the event file plus schemaVersion 1; abandoned (a pid that no longer lives, e.g. of a
# nested run.started) becomes running, its old updatedAt marks it stale. Atomic: temp file, then rename.
function Update-Projection {
  if (-not $EventFile -or -not (Test-Path -LiteralPath $EventFile)) { return }
  try {
    $json = (@(& $ReducerScript -Path $EventFile 2>$null) -join "`n").Trim()
    if (-not $json.StartsWith('{')) { return }
    $script:Projection = $json | ConvertFrom-Json
    $p = $script:Projection
    if (-not $Milestone -or -not $p.milestone -or -not $p.milestone.title -or -not $p.repository) { return }
    $doc = "{`n  `"schemaVersion`": 1," + $json.Substring(1)
    $doc = $doc -replace '"result": "abandoned"(\s*)\}$', '"result": "running"$1}'
    New-Item -ItemType Directory -Force -Path (Split-Path $StatusFile) | Out-Null
    $tmp = "$StatusFile.tmp"
    [IO.File]::WriteAllText($tmp, $doc)
    Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
  } catch { Write-Verbose "status.json not written: $_" }
}

# One event through Report-Progress.ps1 (in-process, so run.started records the pid of the loop). The sink sees the
# loop's own HERDR_ENV and the owner marker, also while the harness runs with both blanked. Never throws into the loop.
function Send-Event([hashtable]$Fields) {
  if (-not $RunId -and $Fields.Type -ne 'run.started') { return }
  $herdr = $env:HERDR_ENV; $term = $env:AGENT_EVENTS_TERMINAL
  $env:HERDR_ENV = $LoopHerdrEnv
  $env:AGENT_EVENTS_TERMINAL = if ($RunId) { 'owner' } else { $null }
  $out = @()
  try { $out = @(& $ReportScript @Fields) } catch { Write-Verbose "event $($Fields.Type) not written: $_" }
  finally { $env:HERDR_ENV = $herdr; $env:AGENT_EVENTS_TERMINAL = $term }
  if ($Fields.Type -eq 'run.started') {
    $id = $out | Where-Object { "$_" -match '^AGENT_EVENTS_RUN=([\w.-]+)$' } | ForEach-Object { $Matches[1] } | Select-Object -First 1
    if (-not $id) { return }
    $script:RunId = $id
    $script:EventFile = Join-Path $env:AGENT_EVENTS_DIR "$id.jsonl"
    $env:AGENT_EVENTS_RUN = $id
    $env:AGENT_EVENTS_TERMINAL = 'owner'
    Update-Projection
  } elseif ($Milestone) { Update-Projection }
}

# One followed event through the terminal sink only (tokens and agent state), as Send-Event sets the environment.
function Send-SinkEvent([string]$Json, [string]$Pr) {
  if (-not $RunId -or $env:DELIVER_TERMINAL_SINK -eq '0') { return }
  $herdr = $env:HERDR_ENV; $term = $env:AGENT_EVENTS_TERMINAL
  $env:HERDR_ENV = $LoopHerdrEnv; $env:AGENT_EVENTS_TERMINAL = 'owner'
  try { & $ReportScript -Type step.finished -SinkEvent $Json -Pr $Pr | Out-Null } catch { Write-Verbose "sink event not shown: $_" }
  finally { $env:HERDR_ENV = $herdr; $env:AGENT_EVENTS_TERMINAL = $term }
}

function Start-Run {
  # the loop always opens its own run, whatever the calling shell exported
  $env:AGENT_EVENTS_RUN = $null; $env:AGENT_EVENTS_TERMINAL = $null
  $f = @{ Type = 'run.started'; Source = 'loop'; Harness = $Harness; Model = $Model }
  $base = Get-BaseUrl
  if ($base) { $f.Repository = (($base -split '/')[-2..-1] -join '/') }
  if ($Milestone) {
    $f.Milestone = if ($Block -and $Block.key) { [string]$Block.key } else { $Milestone }
    if ($Block) { $f.MilestoneTitle = [string]$Block.milestone; $f.MilestoneUrl = [string]$Block.milestoneUrl }
  }
  Send-Event $f
  if ($RunId) {
    $script:RunDir = Join-Path (Get-Location) ".agents/deliver-loop/$RunId"
    $script:Progress = Join-Path $script:RunDir 'progress.jsonl'
  }
}

# Exactly one run.finished per run: at the end of the loop, else in the finally (error, Ctrl+C).
function Stop-Run([string]$RunResult) {
  if ($Finished -or -not $RunId) { return }
  $script:Finished = $true
  Send-Event @{ Type = 'run.finished'; RunResult = $RunResult }
}

function Read-StatusBlock {
  if (-not $Milestone -or -not $MilestoneScript) { return }
  try {
    $raw = & $StatusScript -Milestone $Milestone -Delivered ([int[]]@($Delivered)) -MilestonesScript $MilestoneScript 2>$null
    # no $LASTEXITCODE test: the script ends after a native call (the release PR lookup) that may fail on its own
    if ($raw) { $script:Block = ($raw | Out-String) | ConvertFrom-Json }
  } catch { Write-Verbose "status block not read: $_" }
}

# The status block as events: milestone.progress, the waiting items as issue.finished blocked, the needs-you items as
# attention needs_you, the release round and PR as release.updated. Only changes are sent; an item that left the block
# without being delivered is reset with issue.finished skipped.
function Send-BlockEvents {
  $b = $Block
  if (-not $b) { return }
  Send-Event @{ Type = 'milestone.progress'; Closed = [int]$b.closed; Total = [int]$b.total }
  $now = [ordered]@{}
  foreach ($w in @($b.waiting)) {
    if ($w) { $now["$($w.number)"] = @{ Kind = 'blocked'; Reason = $(if ($w.reason) { [string]$w.reason } else { 'waiting' }); Url = [string]$w.url; Title = [string]$w.title } }
  }
  foreach ($t in @($b.needsYou)) {
    $n = Get-RefNumber $t
    if (-not $n) { continue }
    $reason = ($t -replace 'https://\S+', '').Trim(' :,')
    $now["$n"] = @{ Kind = 'needs'; Reason = $(if ($reason) { $reason } else { 'needs you' }); Url = [regex]::Match($t, 'https://\S+/(?:issues|pull)/\d+').Value }
  }
  foreach ($k in @($Reported.Keys)) {
    if ($now.Contains($k) -and $now[$k].Kind -eq $Reported[$k].Kind) { continue }
    if ($Delivered -notcontains [int]$k) { Send-Event @{ Type = 'issue.finished'; Issue = [int]$k; Outcome = 'skipped'; Reason = 'no longer waiting' } }
    $Reported.Remove($k)
  }
  foreach ($k in $now.Keys) {
    $x = $now[$k]
    if ($Reported.ContainsKey($k) -and $Reported[$k].Reason -eq $x.Reason) { continue }
    if ($x.Kind -eq 'needs') { Send-Event @{ Type = 'attention'; Kind = 'needs_you'; Issue = [int]$k; Url = $x.Url; Reason = $x.Reason } }
    else { Send-Event @{ Type = 'issue.finished'; Issue = [int]$k; Title = $x.Title; Url = $x.Url; Outcome = 'blocked'; Reason = $x.Reason } }
    $Reported[$k] = $x
  }
  $r = $b.release
  $key = "$($r.round)|$($r.pr)"
  if (($r.round -or $r.pr) -and $key -ne $ReleaseKey) {
    $f = @{ Type = 'release.updated' }
    if ($r.round) { $f.ReviewRound = [int]$r.round }
    if ($r.pr) { $f.PrUrl = [string]$r.pr }
    Send-Event $f
    $script:ReleaseKey = $key
  }
}

# Outcome of the iterated issue from GitHub: closed delivered; needs-decision or interactive paused; needs-refinement or an
# open blocker blocked; else the paused/blocked progress line, else skipped (still open and ready: no progress).
function Get-IssueOutcome([int]$nr, $after) {
  $line = $LineOutcome["$nr"]
  $labels = @($after.Labels[$nr])
  $held = @($labels | Where-Object { $_ -in 'needs-decision', 'interactive' })
  if ($held) { return @{ Outcome = 'paused'; Reason = $(if ($line) { $line.Reason } else { $held[0] }) } }
  if ($labels -contains 'needs-refinement') { return @{ Outcome = 'blocked'; Reason = 'needs refinement' } }
  if ($after.Eligible -contains $nr -and $after.Ready -notcontains $nr) { return @{ Outcome = 'blocked'; Reason = 'open blocker' } }
  if ($line) { return $line }
  return @{ Outcome = 'skipped'; Reason = 'no progress' }
}

function Send-IterationOutcome([int]$nr, [int[]]$gone, $after) {
  foreach ($g in $gone) { Send-Event @{ Type = 'issue.finished'; Issue = $g; Outcome = 'delivered'; Pr = [string]$Prs["$g"] } }
  if ($gone -contains $nr) { return }
  $o = Get-IssueOutcome $nr $after
  Send-Event @{ Type = 'issue.finished'; Issue = $nr; Outcome = $o.Outcome; Reason = $o.Reason; Pr = [string]$Prs["$nr"] }
  # the status block lists it as waiting with the same reason: not sent twice
  if ($o.Outcome -eq 'blocked') { $Reported["$nr"] = @{ Kind = 'blocked'; Reason = $o.Reason } }
}

# M5 ▓▓▓▓░░░░ 7/19 · #322 review · 1 blocked · 1 needs you (from the projection; needs a read milestone)
function Write-ProgressLine {
  $p = $Projection
  if (-not $Milestone -or -not $p -or -not $p.milestone -or -not $p.milestone.title) { return }
  $filled = if ($p.total -gt 0) { [Math]::Min(8, [int][Math]::Round(8 * $p.closed / $p.total)) } else { 0 }
  $parts = @("$($p.milestone.key) $('▓' * $filled)$('░' * (8 - $filled)) $($p.closed)/$($p.total)")
  if ($p.current) { $parts += "#$($p.current.number) $(([string]$p.current.step.text -split ':')[0])".TrimEnd() }
  if (@($p.blocked).Count) { $parts += "$(@($p.blocked).Count) blocked" }
  $needs = @($p.needsYou).Count + @($p.paused).Count
  if ($needs) { $parts += "$needs needs you" }
  Write-Step ($parts -join ' · ') 'cyan'
}

function Get-Json([string[]]$ghArgs, [switch]$Pwsh) {
  $out = if ($Pwsh) { & pwsh -NoProfile @ghArgs 2>$null } else { & gh @ghArgs 2>$null }
  if ($LASTEXITCODE -ne 0) { throw "$(if ($Pwsh) { 'pwsh' } else { 'gh' }) $($ghArgs -join ' ') failed" }
  if (-not $out) { return $null }
  return ($out -join "`n") | ConvertFrom-Json
}

# $ms: title of the --milestone when the walk started at a Feature or Epic of it; a PBI or Bug below it with no or another milestone
# is added to $skipped, not to $found (the same rule as deliver step 1: "select: outside M<n>, skipped").
function Add-Pbis([int]$nr, [hashtable]$seen, $found, [string]$ms = '', $skipped = $null) {
  if ($seen.ContainsKey($nr)) { return }
  $seen[$nr] = $true
  # REST per issue: `gh issue view` runs on the GraphQL budget (#117)
  $issue = Get-Json @('api', "repos/{owner}/{repo}/issues/$nr")
  $labels = @($issue.labels | ForEach-Object { $_.name })
  if ($labels -contains 'pbi' -or $labels -contains 'bug') {
    if ($issue.state -eq 'open') {
      if ($ms -and $issue.milestone.title -ne $ms) { $skipped.Add([pscustomobject]@{ Number = $nr; Milestone = $(if ($issue.milestone) { $issue.milestone.title } else { 'none' }) }) }
      else { $found.Add([pscustomobject]@{ Number = $nr; Labels = $labels }) }
    }
    return
  }
  foreach ($child in @(Get-Json @('api', "repos/{owner}/{repo}/issues/$nr/sub_issues?per_page=100"))) {
    if ($child) { Add-Pbis ([int]$child.number) $seen $found $ms $skipped }
  }
}

# State from GitHub: open PBIs of the targets; eligible = no hold label; ready = eligible and no open blocker.
function Get-State {
  $seen = @{}
  $found = [System.Collections.Generic.List[object]]::new()
  $skipped = [System.Collections.Generic.List[object]]::new()
  foreach ($nr in $Nrs) { Add-Pbis $nr $seen $found }
  if ($Milestone) {
    # one REST call lists the milestone (Get-Milestones.ps1 -Mode issues); PBIs and Bugs need no read of their own (#127)
    $list = Get-Json @('-File', $MilestoneScript, '-Mode', 'issues', '-Name', $Milestone, '-State', 'open') -Pwsh
    foreach ($item in @($list.issues)) {
      if (-not $item) { continue }
      if ($item.labels -contains 'pbi' -or $item.labels -contains 'bug') {
        if (-not $seen.ContainsKey([int]$item.number)) { $seen[[int]$item.number] = $true; $found.Add([pscustomobject]@{ Number = [int]$item.number; Labels = @($item.labels) }) }
      } else { Add-Pbis ([int]$item.number) $seen $found ([string]$list.milestone.title) $skipped }
    }
  }
  # release-test (the RC test of the milestone, always last and manual): not part of the stop-rule set, so it neither keeps the loop from done nor makes it blocked
  $found = [System.Collections.Generic.List[object]]::new(@($found | Where-Object { $_.Labels -notcontains 'release-test' }))
  # release-review pause (references/release-review.md): nothing open, but a closed PBI or Bug of the milestone carries needs-decision
  $paused = $false
  if ($Milestone -and $found.Count -eq 0) {
    $closed = Get-Json @('-File', $MilestoneScript, '-Mode', 'issues', '-Name', $Milestone, '-State', 'closed') -Pwsh
    $paused = [bool]@(@($closed.issues) | Where-Object { $_ -and $_.labels -contains 'needs-decision' -and ($_.labels -contains 'pbi' -or $_.labels -contains 'bug') })
  }
  $eligible = @($found | Where-Object { -not ($_.Labels | Where-Object { $Held -contains $_ }) })
  $ready = @($eligible | Where-Object {
      $blockers = @(Get-Json @('api', "repos/{owner}/{repo}/issues/$($_.Number)/dependencies/blocked_by?per_page=100"))
      -not ($blockers | Where-Object { $_ -and $_.state -eq 'open' })
    })
  $labelsOf = @{}
  foreach ($f in $found) { $labelsOf[[int]$f.Number] = @($f.Labels) }
  [pscustomobject]@{
    Open     = $found.Count
    OpenNrs  = @($found | ForEach-Object { $_.Number })
    Labels   = $labelsOf
    Skipped  = @($skipped)
    Paused   = $paused
    Eligible = @($eligible | ForEach-Object { $_.Number } | Sort-Object)
    Ready    = @($ready | ForEach-Object { $_.Number } | Sort-Object)
  }
}

function Get-StopReason($state) {
  if ($state.Open -eq 0) { return $(if ($state.Paused) { 'blocked' } else { 'done' }) }
  if ($state.Ready.Count -eq 0) { return 'blocked' }
  return $null
}

# Room for a cut text: the terminal width minus time, agent prefix and tool name (40); 120 when stdout is redirected.
function Get-LineWidth {
  if ([Console]::IsOutputRedirected) { return 120 }
  $w = try { [Console]::WindowWidth } catch { 0 }
  return [Math]::Max(120, $w - 40)
}

function Get-Short([string]$s, [int]$n = 0) {
  if ($n -le 0) { $n = Get-LineWidth }
  $first = (($s -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
  if (-not $first) { return '' }
  if ($first.Length -gt $n) { return $first.Substring(0, $n) + '…' }
  return $first
}

# Steps shared by both harnesses: a tool call, assistant text (with progress lines of deliver), a tool error.
function Write-ToolStep([string]$prefix, [string]$name, $in) {
  $what = ''
  foreach ($k in 'description', 'file_path', 'command', 'pattern', 'path') {
    if ($in.$k) { $what = Get-Short ([string]$in.$k); break }
  }
  Write-Step "$prefix$name $what" -Tool $name -ToolAt $prefix.Length
}

# Assistant text is logged uncolored and never parsed: steps, colors and notifications come from the events (Show-NewEvents).
function Write-TextStep([string]$prefix, [string]$text) {
  Write-Step "$prefix» $(Get-Short $text)"
}

$ToneColor = @{ success = 'green'; info = 'cyan'; warning = 'yellow'; danger = 'red' }
$AttentionText = @{ pr_opened = 'PR opened'; review_fix = 'review fix round'; ci_red = 'CI red'; paused = 'paused'; blocked = 'blocked' }
$EventOffset = 0

# The new events of the run's event file (written by the harness through Report-Progress.ps1 while it runs): one line
# `#<nr> <step>: <result>` each, colored by tone (the tone rules live in Report-Progress.ps1). Notifications come from
# attention and issue.finished delivered; the urgency from tone. Each event also goes through the terminal sink
# (Report-Progress.ps1 -SinkEvent), since the harness runs nested and reports nothing itself.
function Show-NewEvents {
  if (-not $EventFile -or -not (Test-Path -LiteralPath $EventFile)) { return }
  $text = ''
  for ($try = 0; $try -lt 10; $try++) {
    try {
      $fs = [IO.FileStream]::new($EventFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try {
        [void]$fs.Seek($script:EventOffset, [IO.SeekOrigin]::Begin)
        $bytes = [byte[]]::new([Math]::Max(0, $fs.Length - $script:EventOffset))
        [void]$fs.Read($bytes, 0, $bytes.Length)
        $text = [Text.Encoding]::UTF8.GetString($bytes)
      } finally { $fs.Dispose() }
      break
    } catch [IO.IOException] { Start-Sleep -Milliseconds 20 }
  }
  $end = $text.LastIndexOf("`n")
  if ($end -lt 0) { return }
  $script:EventOffset += [Text.Encoding]::UTF8.GetByteCount($text.Substring(0, $end + 1))
  $shown = $false
  foreach ($raw in ($text.Substring(0, $end) -split "`n")) {
    if (-not $raw.Trim()) { continue }
    try { $ev = $raw | ConvertFrom-Json } catch { continue }
    $nr = [int]$ev.issue.number
    $step = $null; $res = ''; $notice = $null
    switch ($ev.type) {
      'step.finished' { $step = [string]$ev.step.name; $res = [string]$ev.step.text }
      'attention' {
        if ($ev.kind -eq 'needs_you') { continue }
        $step = [string]$ev.kind; $res = [string]$ev.reason
        if ($AttentionText.ContainsKey($step)) { $notice = $AttentionText[$step] }
        if ($ev.kind -in 'paused', 'blocked' -and $nr) { $LineOutcome["$nr"] = @{ Outcome = [string]$ev.kind; Reason = $(if ($res) { $res } else { [string]$ev.kind }) } }
      }
      'issue.finished' { $step = [string]$ev.outcome; $res = [string]$ev.reason; if ($ev.outcome -eq 'delivered') { $notice = 'merged' } }
      default { continue }
    }
    if ($nr -and $ev.prUrl) { $Prs["$nr"] = [string]$ev.prUrl }
    $head = if ($nr) { "#$nr $step" } else { $step }
    Write-Step $(if ($res) { "${head}: $res" } else { $head }) $ToneColor[[string]$ev.tone]
    Send-SinkEvent $raw ([string]$ev.prUrl)
    if ($notice) { Send-Notice "$(if ($nr) { "#$nr " })$notice" -Tone ([string]$ev.tone) }
    $shown = $true
  }
  if ($shown) { if ($Milestone) { Update-Projection }; Write-ProgressLine }
}

# One stream-json record of Claude Code: summary line, progress lines of deliver (top level only), tool errors.
function Read-Record([string]$line) {
  try { $rec = $line | ConvertFrom-Json } catch { Write-Step "? $(Get-Short $line)"; return }
  $parent = $rec.parent_tool_use_id
  $prefix = if ($parent -and $AgentNames.ContainsKey($parent)) { "[$($AgentNames[$parent])] " } elseif ($parent) { '[subagent] ' } else { '' }
  foreach ($c in @($rec.message.content)) {
    if (-not $c) { continue }
    if ($rec.type -eq 'assistant' -and $c.type -eq 'tool_use') {
      if ($c.name -in 'Agent', 'Task') { $AgentNames[$c.id] = Get-Short ([string]$c.input.description) 60 }
      Write-ToolStep $prefix $c.name $c.input
    } elseif ($rec.type -eq 'assistant' -and $c.type -eq 'text') {
      Write-TextStep $prefix $c.text
    } elseif ($rec.type -eq 'user' -and $c.type -eq 'tool_result' -and $c.is_error) {
      $body = if ($c.content -is [string]) { $c.content } else { ($c.content | ForEach-Object { $_.text }) -join "`n" }
      Write-Step "$prefix✗ $(Get-Short $body)" 'red'
    }
  }
}

# One JSONL event of Copilot CLI (--output-format json): {type, data}. Tool calls come as tool.execution_start,
# failures as tool.execution_complete with success=false, text as assistant.message. Subagent steps get the
# agentDisplayName of subagent.started as prefix (events with a parentToolCallId; [subagent] if unknown). Unknown event types are ignored (only logged to the jsonl).
function Read-CopilotRecord([string]$line) {
  try { $rec = $line | ConvertFrom-Json } catch { Write-Step "? $(Get-Short $line)"; return }
  $d = $rec.data
  $prefix = if ($d.parentToolCallId -and $AgentNames.ContainsKey($d.parentToolCallId)) { "[$($AgentNames[$d.parentToolCallId])] " } elseif ($d.parentToolCallId) { '[subagent] ' } else { '' }
  switch ($rec.type) {
    'subagent.started' { if ($d.toolCallId) { $script:AgentNames[$d.toolCallId] = Get-Short ([string]($d.agentDisplayName ?? $d.agentName)) 60 } }
    'tool.execution_start' {
      Write-ToolStep $prefix $d.toolName $d.arguments
    }
    'assistant.message' { if ($d.content) { Write-TextStep $prefix ([string]$d.content) } }
    'tool.execution_complete' {
      if ($d.success -eq $false) {
        $body = if ($d.error.message) { [string]$d.error.message } elseif ($d.result.content) { [string]$d.result.content } else { 'tool failed' }
        Write-Step "$prefix✗ $(Get-Short $body)" 'red'
      }
    }
  }
}

# One machine-readable record for the control session (progress.jsonl); never throws into the loop.
function Write-ProgressRecord([string]$Name, [hashtable]$Data = @{}) {
  try {
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    $rec = [ordered]@{ event = $Name; time = (Get-Date).ToUniversalTime().ToString('o') }
    foreach ($k in $Data.Keys) { $rec[$k] = $Data[$k] }
    [IO.File]::AppendAllText($Progress, ($rec | ConvertTo-Json -Compress -Depth 4) + "`n")
    $latest = Join-Path (Split-Path $RunDir -Parent) 'latest.txt'
    [IO.File]::WriteAllText($latest, $RunDir)
  } catch { Write-Verbose "progress event not written: $_" }
}

function Invoke-Iteration([int]$n, [int]$total, $state) {
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
  $jsonl = Join-Path $RunDir "$($state.Ready[0]).jsonl"
  $targets = @($Nrs | ForEach-Object { "$_" })
  if ($Milestone) { $targets += @('--milestone', $Milestone) }
  $prompt = "/deliver $($targets -join ' ') --unattended --max 1"
  $iterModel = $Model
  if ($Harness -eq 'claude' -and -not $Model) {
    $t = Get-PbiTier ([int]$state.Ready[0])
    $iterModel = $t.Model
    Write-Step "#$($state.Ready[0]) tier $($t.Tier) ($($t.From)) → model $iterModel"
  }
  Write-Step "iteration $n/$total start: $prompt"
  Write-ProgressRecord 'iteration-start' @{ n = $n; total = $total; pbi = [int]$state.Ready[0]; open = $state.Open; model = $iterModel }
  $nr = [int]$state.Ready[0]
  $LineOutcome.Remove("$nr")
  $started = @{ Type = 'issue.started'; Issue = $nr }
  $base = Get-BaseUrl
  if ($base) { $started.Url = "$base/issues/$nr" }
  if ($Block -and $Block.ready.next -and [int]$Block.ready.next.number -eq $nr) { $started.Title = [string]$Block.ready.next.title; $started.Url = [string]$Block.ready.next.url }
  Send-Event $started
  $script:EventOffset = if ($EventFile -and (Test-Path -LiteralPath $EventFile)) { (Get-Item -LiteralPath $EventFile).Length } else { 0 }
  # the harness reports nothing to the terminal: HERDR_ENV empty, and nested for the sink (AGENT_EVENTS_RUN without the owner marker)
  $savedHerdr = $env:HERDR_ENV; $savedTerminal = $env:AGENT_EVENTS_TERMINAL
  $env:HERDR_ENV = ''; $env:AGENT_EVENTS_TERMINAL = ''
  try {
    $cli = if ($Harness -eq 'copilot') {
      @('-p', $prompt, '--model', $iterModel, '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--no-ask-user', '--output-format', 'json')
    } else {
      @('-p', $prompt, '--model', $iterModel, '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose')
    }
    & $Harness @cli 2>&1 | ForEach-Object {
      $line = "$_"
      if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Step "stderr $(Get-Short $line)" 'red'; return }
      [IO.File]::AppendAllText($jsonl, $line + "`n")
      if ($Harness -eq 'copilot') { Read-CopilotRecord $line } else { Read-Record $line }
      Show-NewEvents
    }
    Show-NewEvents
    $exit = $LASTEXITCODE
    if ($exit -ne 0) { Write-Step "$Harness exited with $exit" 'red' }
  } finally { $env:HERDR_ENV = $savedHerdr; $env:AGENT_EVENTS_TERMINAL = $savedTerminal }
}

$result = $null
$code = 0
$i = 0
$state = $null
try {
  if ($LogPane) { Open-LogPane -LogFile $(if ($AnsiFile) { $AnsiFile } else { $LogFile }) -Backend $Backend }
  # the sink checks this itself per event; the loop only says why the pane shows no state
  if (Test-LoopAgentConflict -Pane $Pane -Backend $Backend) {
    Write-Step 'agent state not reported: another agent runs in this pane (start the loop in its own pane)' 'yellow'
  }
  Read-StatusBlock
  Start-Run
  Send-BlockEvents
  $state = Get-State
  Write-ProgressLine
  Write-ProgressRecord 'start' @{ targets = @($Nrs); milestone = $Milestone; max = $Max; harness = $Harness; model = $Model; open = $state.Open }
  foreach ($sk in $state.Skipped) { Write-Step "#$($sk.Number) select: outside $Milestone (milestone: $($sk.Milestone)), skipped; set the milestone to deliver it" 'yellow' }
  $result = Get-StopReason $state
  $total = if ($Max -gt 0) { [Math]::Min($Max, $state.Eligible.Count) } else { $state.Eligible.Count }
  while (-not $result) {
    $i++
    Invoke-Iteration $i $total $state
    $after = Get-State
    # delivered = left the open set; a PBI that is only held (needs-decision) stays open and is paused (#346)
    $gone = @($state.Eligible | Where-Object { $after.Eligible -notcontains $_ -and $after.OpenNrs -notcontains $_ })
    $Delivered = @($Delivered) + $gone
    Send-IterationOutcome ([int]$state.Ready[0]) $gone $after
    Read-StatusBlock
    Send-BlockEvents
    Write-ProgressLine
    Write-ProgressRecord 'iteration-end' @{ n = $i; pbi = [int]$state.Ready[0]; delivered = ($gone -join ','); open = $after.Open }
    if (($after.Eligible -join ',') -eq ($state.Eligible -join ',')) {
      $result = 'no progress'
      Write-Step 'no progress: the open PBIs did not change. Last log lines:' 'yellow'
      foreach ($l in $Recent.ToArray()) { Write-Host "  $l" }
      break
    }
    $state = $after
    $result = Get-StopReason $state
    if (-not $result -and $Max -gt 0 -and $i -ge $Max) { $result = 'max reached' }
  }
  $code = switch ($result) { 'no progress' { 1 } 'blocked' { 2 } default { 0 } }
  $color = if ($result -in 'done', 'max reached') { 'green' } else { 'yellow' }
  Write-Step "loop result: $result ($i iteration(s), $($state.Open) PBI(s) open)" $color
  Stop-Run $result
  Write-ProgressRecord 'result' @{ result = $result; code = $code; iterations = $i; open = $state.Open }
  Send-Notice "loop result: $result"
} finally {
  # error or Ctrl+C: the run ends here, as no progress (the sink clears the tokens and releases the agent state)
  Stop-Run 'no progress'
}
exit $code
