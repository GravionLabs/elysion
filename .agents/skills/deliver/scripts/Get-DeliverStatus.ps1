<#
.SYNOPSIS
  Status block of a milestone for deliver: progress, delivered, ready, waiting, what needs the user, release state.
.DESCRIPTION
  One read of the milestone (github-milestone Get-Milestones.ps1 -Mode issues -State all, REST: issues with their native
  blocked-by links, base URL, next open milestone) plus a lookup of the release PR (REST, no GraphQL). Blockers come from
  the native links; the "Blocked by"/"Depends on" lines of the body count only when the read has no blockedBy field. Prints JSON; -Text prints the block of at most 10 lines.
  Every issue is a full URL with its title. JSON: milestone, key, baseUrl, milestoneUrl, closed, total, delivered[], ready{count,next},
  baseUrl, milestoneUrl, tiers{fast,standard,strong} (open PBIs and Bugs; Tier: line, else size S/M/L, else standard), waiting[], needsYou[],
  release{state,round,pr}, next, lines[].
.PARAMETER Milestone
  Milestone name (M<n>, full title or legacy x.y.z).
.PARAMETER Delivered
  Issue numbers delivered in this run.
.PARAMETER Repo
  owner/repo for gh api; default {owner}/{repo}.
.PARAMETER BaseUrl
  https://github.com/<owner>/<repo>; default from the milestone read.
.PARAMETER ReleasePr
  URL of the open release PR; default looked up (REST). Pass an empty string to skip the lookup.
.PARAMETER Text
  Print the block as text instead of JSON.
.PARAMETER MilestonesScript
  Path of Get-Milestones.ps1; default: the sibling github-milestone skill.
#>
param(
  [Parameter(Mandatory)][string]$Milestone,
  [int[]]$Delivered = @(),
  [string]$Repo = '{owner}/{repo}',
  [string]$BaseUrl,
  [string]$ReleasePr,
  [switch]$Text,
  [string]$MilestonesScript = (Join-Path $PSScriptRoot '../../../github/github-milestone/scripts/Get-Milestones.ps1')
)
$ErrorActionPreference = 'Stop'
function Fail([string]$m) { Write-Error $m -ErrorAction Continue; exit 1 }

$raw = & pwsh -NoProfile -File $MilestonesScript -Mode issues -Name $Milestone -State all -Repo $Repo
if ($LASTEXITCODE -ne 0) { Fail "reading milestone '$Milestone' failed" }
$data = ($raw | Out-String) | ConvertFrom-Json
$all = @($data.issues)
$title = [string]$data.milestone.title
$key = if ($title -match '^(M[0-9]+(?:\.[0-9]+)*)') { $Matches[1] } else { $title }

if (-not $BaseUrl) { $BaseUrl = [string]$data.baseUrl }
if (-not $BaseUrl) { Fail 'repository URL not readable' }
$BaseUrl = $BaseUrl.TrimEnd('/')
function Get-Ref($i) { [ordered]@{ number = [int]$i.number; url = "$BaseUrl/issues/$($i.number)"; title = [string]$i.title } }
function Format-Ref($r) { "$($r.url) $($r.title)" }
function Test-Label($i, [string]$l) { @($i.labels) -contains $l }

$closed = @($all | Where-Object { $_.state -eq 'closed' })
$closedWork = @($closed | Where-Object { (Test-Label $_ 'pbi') -or (Test-Label $_ 'bug') })
$open = @($all | Where-Object { $_.state -eq 'open' })
$openNumbers = @($open | ForEach-Object { [int]$_.number })
$work = @($open | Where-Object { (Test-Label $_ 'pbi') -or (Test-Label $_ 'bug') })

$tiers = [ordered]@{ fast = 0; standard = 0; strong = 0 }
foreach ($i in $work) {
  $b = [string]$i.body
  $t = 'standard'
  if ($b -match '(?m)^\s*(?:[-*]\s*)?\**Tier:?\**:?\s*(fast|standard|strong)\b') { $t = $Matches[1] }
  elseif ($b -match '(?m)^\s*(?:[-*]\s*)?\**Size:?\**:?\s*([SML])\b') { $t = @{ S = 'fast'; M = 'standard'; L = 'strong' }[$Matches[1]] }
  $tiers[$t]++
}

$doneRefs = @($all | Where-Object { $_.state -eq 'closed' -and $Delivered -contains [int]$_.number } | ForEach-Object { Get-Ref $_ })
$ready = [System.Collections.Generic.List[object]]::new()
$waiting = [System.Collections.Generic.List[object]]::new()
$needs = [System.Collections.Generic.List[string]]::new()

$others = @($work | Where-Object { -not (Test-Label $_ 'release-test') })
foreach ($i in $work) {
  $ref = Get-Ref $i
  if ($null -ne $i.PSObject.Properties['blockedBy']) {
    $blockers = @($i.blockedBy | ForEach-Object { if ($_.repository) { "https://github.com/$($_.repository)/issues/$($_.number)" } else { "$BaseUrl/issues/$($_.number)" } })
  }
  else {
    $blockers = @([regex]::Matches([string]$i.body, '(?im)^\W*(?:Depends on|Blocked by)[:\s]+(.*)$') | ForEach-Object {
        [regex]::Matches($_.Groups[1].Value, '#(\d+)') | ForEach-Object { [int]$_.Groups[1].Value } } | Where-Object { $openNumbers -contains $_ } | ForEach-Object { "$BaseUrl/issues/$_" })
  }
  if (Test-Label $i 'release-test') {
    # one per milestone, always the last open item (an implicit blocked-by on all other open PBIs and Bugs)
    if ($others.Count) { $ref.reason = "release test, waits for $($others.Count) open items"; $waiting.Add($ref) }
    elseif (($i.PSObject.Properties['rcPosted'] -and $i.rcPosted) -or [string]$i.body -match '<!-- release-test-rc -->') { $needs.Add("RC test $(Format-Ref $ref)") }
    else { $ref.reason = 'release test'; $waiting.Add($ref) }
  }
  elseif (Test-Label $i 'needs-decision') { $needs.Add("decision: $(Format-Ref $ref)") }
  elseif (Test-Label $i 'interactive') { $needs.Add("interactive, run /deliver $($i.number) in a session: $(Format-Ref $ref)") }
  elseif (Test-Label $i 'manual-test') { $needs.Add("manual test: $(Format-Ref $ref)") }
  elseif (Test-Label $i 'needs-refinement') { $ref.reason = 'needs refinement'; $waiting.Add($ref) }
  elseif (@($i.assignees).Count) { $ref.reason = "claimed by $(@($i.assignees) -join ', ')"; $waiting.Add($ref) }
  elseif ($blockers.Count) { $ref.reason = 'blocked by ' + ($blockers -join ', '); $waiting.Add($ref) }
  else { $ready.Add($ref) }
}
# the pause marker of a round-3 release review: a closed PBI or Bug labeled needs-decision
foreach ($i in $closed) {
  if ((Test-Label $i 'needs-decision') -and ((Test-Label $i 'pbi') -or (Test-Label $i 'bug'))) { $needs.Add("decision on the release review: $(Format-Ref (Get-Ref $i))") }
}

$round = 1
foreach ($i in $all) {
  if ((Test-Label $i 'bug') -and [string]$i.body -match 'Found in release review round (\d+)') { $round = [math]::Max($round, 1 + [int]$Matches[1]) }
}

$pr = $ReleasePr
if (-not $PSBoundParameters.ContainsKey('ReleasePr')) {
  $owner = ($BaseUrl -split '/')[-2]
  $found = & gh api "repos/$Repo/pulls?base=main&head=${owner}:release/next&state=open" --jq '.[0].html_url' 2>$null
  $pr = if ($LASTEXITCODE -eq 0 -and $found) { [string]$found } else { $null }
}
$release = [ordered]@{ state = $null; round = $null; pr = $null }
if ($pr) { $release.state = 'release PR'; $release.pr = $pr; $needs.Add("merge the release PR: $pr") }
elseif ($work.Count -gt 0) { $release.state = 'not ready' }
else { $release.state = 'release review'; $release.round = $round }

$next = if ($data.nextMilestone) { [string]$data.nextMilestone } else { $null }

$total = $closedWork.Count + $work.Count
$cap = 3
function Join-Cap($items, [scriptblock]$fmt) {
  $a = @($items)
  if ($a.Count -le $cap) { return (($a | ForEach-Object { & $fmt $_ }) -join '; ') }
  (($a[0..($cap - 1)] | ForEach-Object { & $fmt $_ }) -join '; ') + "; +$($a.Count - $cap) more"
}
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("Milestone ${key}: $($closedWork.Count)/$total closed" + $(if ($work.Count) { ' · ' + (($tiers.Keys | Where-Object { $tiers[$_] } | ForEach-Object { "$_ $($tiers[$_])" }) -join ' · ') } else { '' }))
$lines.Add('Delivered: ' + $(if ($doneRefs.Count) { Join-Cap $doneRefs { param($r) Format-Ref $r } } else { '-' }))
$lines.Add("Ready: $($ready.Count)" + $(if ($ready.Count) { ", next $(Format-Ref $ready[0])" } else { '' }))
$lines.Add('Waiting: ' + $(if ($waiting.Count) { Join-Cap $waiting { param($r) "$(Format-Ref $r) ($($r.reason))" } } else { '-' }))
$lines.Add('Needs you:' + $(if ($needs.Count) { '' } else { ' -' }))
$shown = [math]::Min($needs.Count, 3)
for ($n = 0; $n -lt $shown; $n++) {
  $t = $needs[$n]
  if ($n -eq 2 -and $needs.Count -gt 3) { $t += " (+$($needs.Count - 3) more)" }
  $lines.Add("  $($n + 1). $t")
}
$lines.Add('Release: ' + $(switch ($release.state) { 'not ready' { 'not ready' } 'release review' { "ready for release review round $($release.round)" } default { $release.pr } }))
$lines.Add('Next milestone: ' + $(if ($next) { $next } else { '-' }))

if ($Text) { $lines -join "`n"; exit 0 }
[ordered]@{
  milestone = $title; key = $key; baseUrl = $BaseUrl; milestoneUrl = "$BaseUrl/milestone/$($data.milestone.number)"; closed = $closedWork.Count; total = $total
  tiers = $tiers
  delivered = $doneRefs
  ready = [ordered]@{ count = $ready.Count; next = $(if ($ready.Count) { $ready[0] } else { $null }) }
  waiting = @($waiting); needsYou = @($needs); release = $release; next = $next; lines = @($lines)
} | ConvertTo-Json -Depth 6
