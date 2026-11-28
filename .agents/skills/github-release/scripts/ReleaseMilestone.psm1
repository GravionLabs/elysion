# Shared by Get-ReleaseState.ps1 and New-ReleaseNext.ps1.

# The open M<nnn> milestone with the lowest number of the repository of the current directory (read-only).
# Returns read ($false: gh could not read the milestones, so nothing is known) and title ($null: no open M<nnn>).
function Get-OpenMilestone {
  $raw = & gh api 'repos/{owner}/{repo}/milestones?state=open&per_page=100' --paginate --slurp 2>$null
  if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ read = $false; title = $null } }
  # --slurp wraps the pages in an array; flatten it to the milestones
  $queue = [System.Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(($raw | Out-String | ConvertFrom-Json -NoEnumerate))
  $open = while ($queue.Count) {
    $x = $queue.Dequeue()
    if ($x -is [System.Collections.IList]) { foreach ($e in $x) { $queue.Enqueue($e) } }
    # the titles github-milestone counts as numbered: M<n>[.<m>] [<Topic>] [(x.y.z)]
    elseif ($x.title -cmatch '^M([0-9]{1,8}(?:\.[0-9]{1,8}){0,7})(?: [^()]+?)?(?: \([0-9]+\.[0-9]+\.[0-9]+\))?$') {
      [pscustomobject]@{ title = $x.title; key = (($Matches[1] -split '\.' | ForEach-Object { $_.PadLeft(8, '0') }) -join '.') }
    }
  }
  [pscustomobject]@{ read = $true; title = ($open | Sort-Object key | Select-Object -First 1).title }
}

Export-ModuleMember -Function Get-OpenMilestone
