<#
.SYNOPSIS
  State of the publish after a release merge: the workflow runs on the merge commit, the tag and the GitHub Release.
.DESCRIPTION
  Prints one JSON object: sha, runs[] (id, name, status, conclusion, url, attempt, failedJobs[]), tag, release, state, reason.
  state: ok (all runs green, tag and published GitHub Release exist), failed (a run failed, or tag or release are missing after
  green runs), pending (no run yet or a run is not completed). Exit 0 ok, 1 failed, 2 pending, 3 when gh cannot be read.
  The tag is v<-Version>, or without -Version a v<x.y.z> tag on the commit or on commits after it without a merge in between
  (the release job tags its changelog commit). Needs gh, run inside the repository.
.PARAMETER Sha
  The merge commit of the release PR (full SHA).
.PARAMETER Wait
  Poll until the state is no longer pending, at most -TimeoutMinutes.
.PARAMETER Rerun
  Re-run the failed jobs of a failed run once (`gh run rerun <id> --failed`); a run with attempt 2 or higher is not re-run.
.PARAMETER Version
  Released version x.y.z (with or without the leading v).
.PARAMETER Events
  Directory of the agent-events run this script writes (<run>.jsonl). Default: AGENT_EVENTS_DIR, else the
  per-user directory ($XDG_STATE_HOME/agent-events, else ~/.local/state/agent-events; Windows
  %LOCALAPPDATA%\agent-events). Opening a run deletes expired runs of this repository there.
.PARAMETER PollSeconds
  Pause between two polls.
.PARAMETER TimeoutMinutes
  Longest wait of -Wait.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Sha,
  [switch]$Wait,
  [switch]$Rerun,
  [string]$Version,
  [string]$Events,
  [ValidateRange(0, 3600)][int]$PollSeconds = 60,
  [ValidateRange(0, 360)][int]$TimeoutMinutes = 30
)
$ErrorActionPreference = 'Stop'
$green = @('success', 'skipped', 'neutral')
Import-Module (Join-Path $PSScriptRoot 'EventDirectory.psm1') -Force

# gh with stdout and stderr apart; a failure throws unless the caller reads the exit code itself
function Invoke-Gh([string[]]$GhArgs, [switch]$AllowFailure) {
  $all = @(& gh @GhArgs 2>&1)
  $code = $LASTEXITCODE
  $err = @($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join "`n"
  $out = @($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
  if ($code -ne 0 -and -not $AllowFailure) { throw "gh $($GhArgs -join ' ') failed: $err" }
  [pscustomobject]@{ code = $code; out = $out; err = $err }
}

function Read-GhJson([string[]]$GhArgs) { (Invoke-Gh $GhArgs).out | ConvertFrom-Json }

# --- agent-events (jsonl-file binding): this process is the only writer of its run, so seq is gapless; a write never fails the caller
$script:eventFile = $null
$script:seq = 0

function New-Uuid7 {
  $b = [byte[]]::new(16)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($b)
  $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  for ($i = 0; $i -lt 6; $i++) { $b[$i] = [byte](($ms -shr (8 * (5 - $i))) -band 0xff) }
  $b[6] = [byte](($b[6] -band 0x0f) -bor 0x70)
  $b[8] = [byte](($b[8] -band 0x3f) -bor 0x80)
  $h = [Convert]::ToHexString($b).ToLowerInvariant()
  '{0}-{1}-{2}-{3}-{4}' -f $h.Substring(0, 8), $h.Substring(8, 4), $h.Substring(12, 4), $h.Substring(16, 4), $h.Substring(20)
}

function Write-PublishEvent([string]$Type, [System.Collections.IDictionary]$Body, [string]$Tone = 'neutral') {
  if (-not $script:eventFile) { return }
  $script:seq++
  $line = [ordered]@{ v = 1; seq = $script:seq; ts = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); run = $script:runId; type = $Type; tone = $Tone }
  foreach ($k in $Body.Keys) { $line[$k] = $Body[$k] }
  try { [System.IO.File]::AppendAllText($script:eventFile, (($line | ConvertTo-Json -Depth 6 -Compress) + "`n")) }
  catch { Write-Verbose "event not written: $_" }
}

function Open-PublishRun {
  try {
    $dir = if ($Events) { $Events } else { Get-AgentEventsDirectory }
    if (-not $dir) { return }
    $dir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($dir)
    $null = New-Item -ItemType Directory -Force -Path $dir
    $origin = Get-RunOrigin
  } catch { Write-Verbose "no events: $_"; return }
  try { Remove-ExpiredRun -Directory $dir -Repository $origin['repo'] } catch { Write-Verbose "no retention: $_" }
  $script:runId = New-Uuid7
  $script:eventFile = Join-Path $dir "$script:runId.jsonl"
  $subject = [ordered]@{ kind = 'commit'; id = $Sha; title = $Sha.Substring(0, 7) }
  $r = Invoke-Gh @('repo', 'view', '--json', 'nameWithOwner,url') -AllowFailure
  if ($r.code -eq 0 -and $r.out) {
    $repo = $r.out | ConvertFrom-Json
    $subject.title = "$($repo.nameWithOwner)@$($Sha.Substring(0, 7))"
    if ($repo.url) { $subject.url = "$($repo.url)/commit/$Sha" }
  }
  Write-PublishEvent 'run.started' ([ordered]@{ profiles = @('ci@1'); origin = $origin; host = @{ 'jsonl-file.pid' = "$PID" }; subject = $subject }) 'info'
}

# --- state
function Find-ReleaseTag {
  if ($Version) {
    $name = "v$($Version -replace '^v', '')"
    $r = Invoke-Gh @('api', "repos/{owner}/{repo}/git/ref/tags/$name") -AllowFailure
    if ($r.code -eq 0) { return $name }
    if ($r.err -match 'Not Found|HTTP 404') { return $null }
    throw "gh api tag $name failed: $($r.err)"
  }
  $tags = @(Read-GhJson @('api', 'repos/{owner}/{repo}/tags?per_page=100') | ForEach-Object { $_ } |
      Where-Object { $_.name -match '^v\d+\.\d+\.\d+$' } |
      Sort-Object { [version]$_.name.Substring(1) } -Descending | Select-Object -First 10)
  foreach ($t in $tags) {
    if ($t.commit.sha -eq $Sha) { return $t.name }
    $c = Read-GhJson @('api', "repos/{owner}/{repo}/compare/$Sha...$($t.commit.sha)")
    # a later release contains a merge commit after $Sha, the changelog commit of this one does not
    if ($c.status -eq 'ahead' -and -not @($c.commits | Where-Object { @($_.parents).Count -gt 1 })) { return $t.name }
  }
  return $null
}

function Find-Release([string]$Tag) {
  $r = Invoke-Gh @('release', 'view', $Tag, '--json', 'isDraft,url') -AllowFailure
  if ($r.code -eq 0) { return $r.out | ConvertFrom-Json }
  if ($r.err -match 'release not found|HTTP 404') { return $null }
  throw "gh release view $Tag failed: $($r.err)"
}

# $Reran: run id -> attempt that was re-run; until gh shows a later attempt the run counts as pending
function Get-State([hashtable]$Reran) {
  $raw = @(Read-GhJson @('run', 'list', '--commit', $Sha, '--limit', '50', '--json', 'databaseId,workflowName,status,conclusion,url,attempt') | ForEach-Object { $_ })
  $runs = @(foreach ($r in $raw) {
      $id = "$($r.databaseId)"
      $stale = $Reran.ContainsKey($id) -and [int]$r.attempt -le $Reran[$id]
      [pscustomobject][ordered]@{
        id = $r.databaseId; name = $r.workflowName
        status = $(if ($stale) { 'queued' } else { $r.status }); conclusion = $(if ($stale -or -not $r.conclusion) { $null } else { $r.conclusion })
        url = $r.url; attempt = $r.attempt; failedJobs = @()
      }
    })
  $s = [ordered]@{ sha = $Sha; runs = $runs; tag = $null; release = $null; state = 'pending'; reason = $null }
  if (-not $runs) { $s.reason = 'no workflow run on the commit'; return $s }
  if (@($runs | Where-Object status -ne 'completed')) { $s.reason = 'workflow runs not completed'; return $s }
  $failed = @($runs | Where-Object { $_.conclusion -notin $green })
  foreach ($f in $failed) {
    $view = Read-GhJson @('run', 'view', "$($f.id)", '--json', 'jobs')
    $f.failedJobs = @($view.jobs | Where-Object { $_.conclusion -and $_.conclusion -notin $green } | ForEach-Object { $_.name })
  }
  $s.tag = Find-ReleaseTag
  $release = if ($s.tag) { Find-Release $s.tag }
  if ($release -and -not $release.isDraft) { $s.release = $release.url }
  $s.state = 'failed'
  if ($failed) { $s.reason = "failed: $(($failed | ForEach-Object { "$($_.name) [$($_.failedJobs -join ', ')] $($_.url)" }) -join '; ')" }
  elseif (-not $s.tag) { $s.reason = "tag $(if ($Version) { "v$($Version -replace '^v', '') " })missing after green runs" }
  elseif (-not $release) { $s.reason = "GitHub Release $($s.tag) missing after green runs" }
  elseif ($release.isDraft) { $s.reason = "GitHub Release $($s.tag) is a draft" }
  else { $s.state = 'ok' }
  return $s
}

function Write-Outcome([System.Collections.IDictionary]$State) {
  foreach ($r in @($State.runs | Where-Object status -eq 'completed')) {
    $tone = if ($r.conclusion -in $green) { 'success' } else { 'danger' }
    Write-PublishEvent 'ci.run.completed' ([ordered]@{ ci = [ordered]@{ name = $r.name; conclusion = $r.conclusion; url = $r.url } }) $tone
  }
  if ($State.state -eq 'ok') {
    Write-PublishEvent 'ci.publish.ok' ([ordered]@{ ci = [ordered]@{ tag = $State.tag; release = $State.release } }) 'success'
    Write-PublishEvent 'run.finished' ([ordered]@{ outcome = 'succeeded' }) 'success'
  } elseif ($State.state -eq 'failed') {
    $bad = @($State.runs | Where-Object { $_.conclusion -notin $green }) | Select-Object -First 1
    $url = if ($bad) { $bad.url } else { @($State.runs)[0].url }
    $job = if ($bad) { @($bad.failedJobs)[0] }
    Write-PublishEvent 'ci.publish.failed' ([ordered]@{ ci = [ordered]@{ job = $job; url = $url; text = $State.reason } }) 'danger'
    Write-PublishEvent 'run.finished' ([ordered]@{ outcome = 'failed'; reason = 'ci.publish-failed'; text = $State.reason }) 'danger'
  } else {
    Write-PublishEvent 'run.finished' ([ordered]@{ outcome = 'cancelled'; reason = 'ci.pending'; text = $State.reason }) 'warning'
  }
}

Open-PublishRun
$reran = @{}
$tried = @{}
$errors = 0
$deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
$state = $null
while ($true) {
  try {
    $state = Get-State $reran
    $errors = 0
    if ($Rerun -and $state.state -eq 'failed') {
      $again = @($state.runs | Where-Object { $_.conclusion -notin $green -and [int]$_.attempt -le 1 -and -not $tried.ContainsKey("$($_.id)") })
      $started = 0
      foreach ($r in $again) {
        $tried["$($r.id)"] = $true
        # a re-run gh refuses is not repeated: the run stays failed
        $res = Invoke-Gh @('run', 'rerun', "$($r.id)", '--failed') -AllowFailure
        if ($res.code -ne 0) { [Console]::Error.WriteLine("re-run of $($r.url) failed: $($res.err)"); continue }
        $reran["$($r.id)"] = [int]$r.attempt
        $started++
        [Console]::Error.WriteLine("re-running the failed jobs of $($r.url)")
      }
      if ($started) { $state = Get-State $reran }
    }
  } catch {
    $errors++
    # a short outage must not end a wait of half an hour
    if (-not $Wait -or $errors -ge 3 -or [DateTime]::UtcNow -ge $deadline) {
      Write-PublishEvent 'run.finished' ([ordered]@{ outcome = 'failed'; reason = 'ci.unreadable'; text = "$_" }) 'danger'
      [Console]::Error.WriteLine("$_")
      exit 3
    }
    [Console]::Error.WriteLine("retrying: $_")
    Start-Sleep -Seconds $PollSeconds
    continue
  }
  if (-not $Wait -or $state.state -ne 'pending' -or [DateTime]::UtcNow -ge $deadline) { break }
  Start-Sleep -Seconds $PollSeconds
}

Write-Outcome $state
$state | ConvertTo-Json -Depth 6
exit $(switch ($state.state) { 'ok' { 0 } 'failed' { 1 } default { 2 } })
