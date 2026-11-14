# Retention of event files and stream recordings (ADR 0001, "Lifecycle and retention"). Dot-sourced by Report-Progress.ps1.
# Never throws: a failed read or delete is skipped silently.

function Test-RunLive([string]$eventFile, [datetime]$now) {
  # A run is live when it has no run.finished, its pid lives and the file changed within the last hour.
  try {
    if (-not (Test-Path -LiteralPath $eventFile)) { return $false }
    $text = Get-Content -LiteralPath $eventFile -Raw -ErrorAction Stop
    if ($text -match '"type"\s*:\s*"run\.finished"') { return $false }
    if ((Get-Item -LiteralPath $eventFile).LastWriteTimeUtc -lt $now.AddHours(-1)) { return $false }
    if ($text -notmatch '"pid"\s*:\s*(\d+)') { return $false }
    return [bool](Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)
  } catch { return $false }
}

function Invoke-ProgressRetention {
  param(
    [Parameter(Mandatory)][string]$EventsDir,
    [string[]]$LoopDirs = @(),
    [string]$CurrentRun
  )
  try {
    $now = [datetime]::UtcNow
    $days = 7; $keep = 100
    if ($env:AGENT_EVENTS_KEEP_DAYS -match '^\d+$') { $days = [int]$env:AGENT_EVENTS_KEEP_DAYS }
    if ($env:AGENT_EVENTS_KEEP -match '^\d+$') { $keep = [int]$env:AGENT_EVENTS_KEEP }
    $cutoff = $now.AddDays(-$days)

    # items: @{ Path; Name; Time; Live }, any order; the newest $keep stay, older than the cutoff go
    $prune = {
      param($items)
      $rank = 0
      foreach ($it in ($items | Sort-Object { $_.Time } -Descending)) {
        $rank++
        if ($it.Live -or $it.Name -eq $CurrentRun) { continue }
        if ($it.Time -lt $cutoff -or $rank -gt $keep) {
          try { Remove-Item -LiteralPath $it.Path -Recurse -Force -ErrorAction Stop } catch { Write-Verbose "retention: $_" }
        }
      }
    }

    $events = @(Get-ChildItem -LiteralPath $EventsDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue | ForEach-Object {
      @{ Path = $_.FullName; Name = $_.BaseName; Time = $_.LastWriteTimeUtc; Live = (Test-RunLive $_.FullName $now) }
    })
    & $prune $events

    foreach ($ld in ($LoopDirs | Select-Object -Unique)) {
      $runs = @(Get-ChildItem -LiteralPath $ld -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        @{ Path = $_.FullName; Name = $_.Name; Time = $_.LastWriteTimeUtc; Live = (Test-RunLive (Join-Path $EventsDir "$($_.Name).jsonl") $now) }
      })
      & $prune $runs
    }
  } catch { Write-Verbose "retention: $_" }
}
