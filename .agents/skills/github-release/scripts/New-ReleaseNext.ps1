<#
.SYNOPSIS
  The `cut` of `github-release`: creates origin/release/next from the default branch when it is missing and makes sure an open M<nnn> milestone exists; prints one JSON object.
.DESCRIPTION
  Reads `git ls-remote --heads origin release/next`. Present: the branch is left alone. Missing: the default branch
  (`gh api repos/{owner}/{repo} --jq .default_branch`) is fetched and pushed to `refs/heads/release/next`.
  Then, with the branch there (present or created), no open M<nnn> milestone: `Get-Milestones.ps1 -Mode create` of the
  github-milestone skill creates the next free number, so every merge has a milestone to land in (ADR 0010).
  Output: {status, default, detail, milestone}. `status`: present, created (`detail` = `release/next created from <default>`),
  refused (the push or the default-branch lookup failed; `detail` carries the git or gh error) or unreachable
  (origin cannot be read; nothing is created). `milestone`: null for refused and unreachable, else {status, title, detail}
  with `status` present (`title`: the lowest open M<nnn>; nothing is written), created (`detail` = `created M<nnn> for
  release/next`; `releaseTest` {created, number, url} when github-milestone made one) or failed (the milestones cannot be
  read, github-milestone is not installed or the create failed; `detail` says why). Exit 0 in all these cases, 1 outside a
  git repository.
.PARAMETER ProjectRoot
  Repository (default: current directory).
.PARAMETER NoReleaseTest
  Create the milestone without its release-test issue.
.PARAMETER MilestoneScript
  Path of Get-Milestones.ps1; default: the sibling github-milestone skill.
#>
param(
  [string]$ProjectRoot = (Get-Location).Path,
  [switch]$NoReleaseTest,
  [string]$MilestoneScript = (Join-Path $PSScriptRoot '../../github-milestone/scripts/Get-Milestones.ps1')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseMilestone.psm1') -Force
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
& git -C $root rev-parse --show-toplevel *> $null
if ($LASTEXITCODE -ne 0) { Write-Error 'not inside a git repository' -ErrorAction Continue; exit 1 }
function Out-State([string]$status, [string]$default, [string]$detail, $milestone = $null) {
  [ordered]@{ status = $status; default = $default; detail = $detail; milestone = $milestone } | ConvertTo-Json -Compress -Depth 4
  exit 0
}
function New-MilestoneState([string]$status, [string]$title, [string]$detail) {
  [ordered]@{ status = $status; title = $title; detail = $detail }
}
# runs in the repository: gh and github-milestone resolve it (and .agents/config.json) from the current directory
function Confirm-Milestone {
  $open = Get-OpenMilestone
  if (-not $open.read) { return New-MilestoneState 'failed' $null 'milestones cannot be read, none created' }
  if ($open.title) { return New-MilestoneState 'present' $open.title "$($open.title) is open" }
  if (-not (Test-Path -LiteralPath $MilestoneScript)) { return New-MilestoneState 'failed' $null 'no open milestone and github-milestone is not installed' }
  $out = & $MilestoneScript -Mode create -NoReleaseTest:$NoReleaseTest 2>&1
  if ($LASTEXITCODE -ne 0) { return New-MilestoneState 'failed' $null "creating the milestone failed: $((@($out) -join ' ').Trim())" }
  $res = $out | Out-String | ConvertFrom-Json
  $state = New-MilestoneState 'created' $res.milestone.title "created $($res.milestone.title) for release/next"
  if ($res.releaseTest) { $state.releaseTest = $res.releaseTest }
  $state
}
$ls = & git -C $root ls-remote --heads origin release/next 2>$null
if ($LASTEXITCODE -ne 0) { Out-State 'unreachable' $null 'origin not reachable' }
Push-Location $root
try {
  if (@($ls | Where-Object { $_ }).Count) { Out-State 'present' $null 'origin/release/next present' (Confirm-Milestone) }
  $default = ((& gh api 'repos/{owner}/{repo}' --jq .default_branch 2>&1) -join "`n").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $default) { Out-State 'refused' $null "default branch unknown: $default" }
  $err = (& git fetch -q origin $default 2>&1) -join ' '
  if ($LASTEXITCODE -ne 0) { Out-State 'refused' $default "fetch of $default failed: $err" }
  $err = (& git push -q origin "refs/remotes/origin/${default}:refs/heads/release/next" 2>&1) -join ' '
  if ($LASTEXITCODE -ne 0) { Out-State 'refused' $default "push to release/next refused: $($err.Trim())" }
  Out-State 'created' $default "release/next created from $default" (Confirm-Milestone)
} finally { Pop-Location }
