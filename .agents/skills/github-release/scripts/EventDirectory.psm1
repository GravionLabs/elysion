# Where run files live and which may go (GravionLabs/agent-events, bindings/jsonl-file.md): one directory
# per user, `origin` of `run.started`, retention per origin repository. The TypeScript twin of this file
# is deliver `scripts/event-dir.mts`; both are tested against the same cases.
$ErrorActionPreference = 'Stop'
$script:keep = 100

# AGENT_EVENTS_DIR, else the per-user default of the platform; $null when there is none
function Get-AgentEventsDirectory {
  param([bool]$Windows = $IsWindows, [string]$HomeDirectory = $HOME)
  if ($env:AGENT_EVENTS_DIR) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:AGENT_EVENTS_DIR) }
  if ($Windows) {
    if ($env:LOCALAPPDATA) { return Join-Path $env:LOCALAPPDATA 'agent-events' }
    return $null
  }
  # a relative XDG_STATE_HOME is ignored, as the XDG specification requires
  if ($env:XDG_STATE_HOME -and $env:XDG_STATE_HOME.StartsWith('/')) { return Join-Path $env:XDG_STATE_HOME 'agent-events' }
  if ($HomeDirectory) { return Join-Path $HomeDirectory '.local' 'state' 'agent-events' }
  return $null
}

# owner/repo of a remote URL that names a host; $null for a local path or a file: URL
function Get-RepositoryOfUrl([string]$Url) {
  $found = $null
  if ($Url -match '^([a-z][a-z0-9+.-]*)://[^/]+/(.*)$') {
    if ($Matches[1] -ne 'file') { $found = $Matches[2] }
  } elseif ($Url -match '^(?:[^/\\:]+@)?[^/\\:@]{2,}:(?!//)(.*)$') {
    # scp form [user@]host:path; one letter before the colon is a Windows drive
    $found = $Matches[1]
  }
  if (-not $found) { return $null }
  $found = $found.Trim('/') -creplace '\.git$', ''
  if ($found) { return $found }
  return $null
}

function Invoke-GitLine([string[]]$GitArgs) {
  $out = & git @GitArgs 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  return @($out)[0]
}

function Get-CommonDirectory {
  $dir = Invoke-GitLine @('rev-parse', '--path-format=absolute', '--git-common-dir')
  if ($dir) { return [System.IO.Path]::GetFullPath($dir) }
  return $null
}

# the origin of run.started for a writer in the current location; a field that does not exist is left out
function Get-RunOrigin {
  $origin = [ordered]@{}
  $common = Get-CommonDirectory
  if ($common) {
    $url = Invoke-GitLine @('remote', 'get-url', 'origin')
    $repo = if ($url) { Get-RepositoryOfUrl $url }
    if (-not $repo) { $repo = if ((Split-Path $common -Leaf) -ceq '.git') { Split-Path $common -Parent } else { $common } }
    $origin.repo = $repo
  }
  $branch = Invoke-GitLine @('symbolic-ref', '--quiet', '--short', 'HEAD')
  if ($branch) { $origin.branch = $branch }
  $worktree = Invoke-GitLine @('rev-parse', '--show-toplevel')
  if ($worktree) { $origin.worktree = [System.IO.Path]::GetFullPath($worktree) }
  $hostName = [System.Net.Dns]::GetHostName()
  if ($hostName) { $origin.host = $hostName }
  return $origin
}

function Read-Run([System.IO.FileInfo]$File, [datetime]$Now) {
  $age = $Now - $File.LastWriteTimeUtc
  $started = $null
  $finished = $false
  # the last element is empty or an incomplete line
  $lines = [System.IO.File]::ReadAllText($File.FullName).Split("`n")
  for ($i = 0; $i -lt $lines.Count - 1; $i++) {
    try { $e = $lines[$i] | ConvertFrom-Json -AsHashtable } catch { continue }
    if ($e -isnot [System.Collections.IDictionary]) { continue }
    if ($e['type'] -ceq 'run.started' -and -not $started) { $started = $e }
    if ($e['type'] -ceq 'run.finished') { $finished = $true }
  }
  $origin = if ($started) { $started['origin'] }
  $writer = if ($started -and $started['host']) { $started['host']['jsonl-file.pid'] -as [int] }
  $here = -not ($origin -and $origin['host']) -or $origin['host'] -eq [System.Net.Dns]::GetHostName()
  $dead = $here -and $writer -gt 0 -and -not (Get-Process -Id $writer -ErrorAction SilentlyContinue)
  [pscustomobject]@{ file = $File.FullName; age = $age; origin = $origin; done = ($finished -or $dead -or $age.TotalHours -gt 1) }
}

function Select-Expired([object[]]$Runs, [int]$Days, [int]$Excess) {
  $i = 0
  foreach ($r in @($Runs | Where-Object done | Sort-Object age -Descending)) {
    if ($r.age.TotalDays -gt $Days -or $i -lt $Excess) { $r.file }
    $i++
  }
}

# the run files a writer of -Repository MAY delete: its own and those without origin, never a running one
function Get-ExpiredRun {
  param([Parameter(Mandatory)][string]$Directory, [string]$Repository, [datetime]$Now = [datetime]::UtcNow)
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { return }
  $runs = @(foreach ($f in Get-ChildItem -LiteralPath $Directory -File) {
      if ($f.LinkType -or $f.Name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.jsonl$') { continue }
      # gone or unreadable: it stays
      try { Read-Run $f $Now.ToUniversalTime() } catch { Write-Verbose "not judged: $_" }
    })
  $own = @($runs | Where-Object { $_.origin -and [string]$_.origin['repo'] -ceq $Repository })
  $old = @($runs | Where-Object { -not $_.origin })
  Select-Expired $own 30 (@($own | Where-Object done).Count - $script:keep)
  Select-Expired $old 7 ($old.Count - $script:keep)
}

function Resolve-Directory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkTarget) { return $item.ResolveLinkTarget($true).FullName }
  return [System.IO.Path]::GetFullPath($Path)
}

# deletes the expired runs; nothing in the legacy directory of the repository of the current location
function Remove-ExpiredRun {
  [CmdletBinding(SupportsShouldProcess)]
  param([Parameter(Mandatory)][string]$Directory, [string]$Repository)
  $common = Get-CommonDirectory
  if ($common -and (Resolve-Directory $Directory) -ceq (Resolve-Directory (Join-Path $common '.agents' 'events'))) { return }
  foreach ($file in @(Get-ExpiredRun -Directory $Directory -Repository $Repository)) {
    if ($PSCmdlet.ShouldProcess($file, 'delete run file')) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  }
}

Export-ModuleMember -Function Get-AgentEventsDirectory, Get-RepositoryOfUrl, Get-RunOrigin, Get-ExpiredRun, Remove-ExpiredRun
