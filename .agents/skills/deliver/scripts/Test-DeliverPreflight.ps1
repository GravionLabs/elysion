<#
.SYNOPSIS
  Preflight of `deliver`: repository skills, harness allowlist, stale worktrees; prints one JSON object (or lines with -Text).
.DESCRIPTION
  Three checks, each with status ok / fixed / action needed:
  - skills: the stack skills of `detect-techstack` (`<lang>-implementation`, `<lang>-test`) must be installed in the
    project (.claude/skills or .agents/skills) and not older than the same skill in the global install (SKILL.md write
    time). Missing or old: `fix` names the `skills-manage` call; nothing is installed here.
  - allowlist: `git`, `gh`, `pwsh <skill-dir>/scripts/*` and the verify commands in the code blocks of AGENTS.md must be
    allowed for -Harness (claude: permissions.allow of .claude/settings.json, settings.local.json, ~/.claude/settings.json;
    opencode: permission.bash of opencode.json; copilot: per-run flags, not checkable). Missing entries are listed in
    `missing` as exact settings lines; -AddAllowlist writes them to .claude/settings.json (claude) or opencode.json.
  - worktrees: worktrees (not the main or current one) on a PBI branch whose PR is merged or whose branch was deleted
    on origin (pushed once, absent now, no unpushed commits, ls-remote succeeded; one ls-remote for all) are removed with Remove-PbiWorktrees.ps1 (merged PR) or `git worktree remove` (clean, branch gone);
    the others are listed in `left`.
  Output: {actionNeeded, checks[{name, status, detail, fix, missing[], removed[], left[]}]}. Exit 1 only when the
  directory is not a git repository.
.PARAMETER ProjectRoot
  Repository to check (default: current directory).
.PARAMETER Harness
  claude (default), opencode or copilot.
.PARAMETER Unattended
  Only changes the wording of `fix` for skills (unattended: continue with the global skills).
.PARAMETER AddAllowlist
  Write the missing allowlist entries.
.PARAMETER Check
  Checks to run (default: skills, allowlist, worktrees).
.PARAMETER Text
  One line per check instead of JSON.
#>
param(
  [string]$ProjectRoot = (Get-Location).Path,
  [ValidateSet('claude', 'opencode', 'copilot')][string]$Harness = 'claude',
  [switch]$Unattended,
  [switch]$AddAllowlist,
  [ValidateSet('skills', 'allowlist', 'worktrees')][string[]]$Check = @('skills', 'allowlist', 'worktrees'),
  [switch]$Text
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSCommandPath
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
& git -C $root rev-parse --show-toplevel *> $null
if ($LASTEXITCODE -ne 0) { Write-Error 'not inside a git repository' -ErrorAction Continue; exit 1 }
$homeDir = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$name, [string]$status, [string]$detail, [hashtable]$extra = @{}) {
  $o = [ordered]@{ name = $name; status = $status; detail = $detail }
  foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] }
  $checks.Add($o)
}

# ---- skills ----
function Test-Skills {
  $det = @((Join-Path $here '../../detect-techstack/scripts/Detect-TechStack.ps1'), (Join-Path $here '../../../shared/detect-techstack/scripts/Detect-TechStack.ps1')) |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $det) { Add-Check 'skills' 'action needed' 'detect-techstack is not installed' @{ fix = '/skills-manage shared' }; return }
  $stack = (& pwsh -NoProfile -File $det -ProjectRoot $root) -join "`n" | ConvertFrom-Json
  $need = @(@($stack.implementation) + @($stack.test) | Where-Object { $_ } | Select-Object -Unique)
  if (-not $need) { Add-Check 'skills' 'ok' 'no stack skills needed'; return }
  $missing = @(); $old = @()
  foreach ($s in $need) {
    $proj = @('.claude/skills', '.agents/skills') | ForEach-Object { Join-Path $root "$_/$s/SKILL.md" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $proj) { $missing += $s; continue }
    $glob = @('.claude/skills', '.agents/skills') | ForEach-Object { Join-Path $homeDir "$_/$s/SKILL.md" } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($glob -and (Get-Item -LiteralPath $glob).LastWriteTimeUtc -gt (Get-Item -LiteralPath $proj).LastWriteTimeUtc) { $old += $s }
  }
  if (-not $missing -and -not $old) { Add-Check 'skills' 'ok' "$($need.Count) stack skills current"; return }
  $fix = if ($Unattended) { 'continue with the global skills' } else { "/skills-manage $(@($stack.languages) -join ' ')" }
  Add-Check 'skills' 'action needed' ('missing: {0}; older than global: {1}' -f ($missing -join ','), ($old -join ',')) @{ fix = $fix; missing = $missing; old = $old }
}

# ---- allowlist ----
# command prefixes of the code blocks of AGENTS.md: `pnpm test` -> "pnpm test", `pnpm run lint:ps` -> "pnpm run lint:ps"
function Get-VerifyPrefix {
  $f = Join-Path $root 'AGENTS.md'
  if (-not (Test-Path -LiteralPath $f)) { return @() }
  $in = $false; $out = [System.Collections.Generic.List[string]]::new()
  foreach ($l in (Get-Content -LiteralPath $f)) {
    if ($l -match '^\s*```') { $in = -not $in; continue }
    if (-not $in) { continue }
    $t = ($l -replace '\s#.*$', '').Trim()
    if ($t -match '^(pnpm|npm|yarn)\s+run\s+(\S+)') { $out.Add("$($Matches[1]) run $($Matches[2])") }
    elseif ($t -match '^(pnpm|npm|yarn|dotnet|cargo|go|uv|make|npx)\s+(\S+)') { $out.Add("$($Matches[1]) $($Matches[2])") }
    elseif ($t -match '^(pytest)\b') { $out.Add('pytest') }
  }
  return @($out | Select-Object -Unique)
}
function Test-Allowlist {
  if ($Harness -eq 'copilot') { Add-Check 'allowlist' 'ok' 'Copilot CLI: the allowlist is passed per run (references/permissions.md)'; return }
  $verify = Get-VerifyPrefix
  $entries = @()
  if ($Harness -eq 'claude') {
    foreach ($f in @((Join-Path $root '.claude/settings.json'), (Join-Path $root '.claude/settings.local.json'), (Join-Path $homeDir '.claude/settings.json'))) {
      if (Test-Path -LiteralPath $f) {
        try { $entries += @((Get-Content -LiteralPath $f -Raw | ConvertFrom-Json).permissions.allow) | Where-Object { $_ } } catch { Write-Verbose "unreadable $f" }
      }
    }
  } else {
    $f = Join-Path $root 'opencode.json'
    if (Test-Path -LiteralPath $f) {
      try { foreach ($p in (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json).permission.bash.PSObject.Properties) { if ($p.Value -eq 'allow') { $entries += $p.Name } } } catch { Write-Verbose 'unreadable opencode.json' }
    }
  }
  # each requirement: the line to add and the command prefix that satisfies it
  $req = [System.Collections.Generic.List[object]]::new()
  $cl = $Harness -eq 'claude'
  $req.Add(@($(if ($cl) { 'Bash(git:*)' } else { 'git *' }), 'git'))
  $req.Add(@($(if ($cl) { 'Bash(gh auth status)' } else { 'gh auth status' }), 'gh auth status'))
  foreach ($g in 'gh api', 'gh issue', 'gh pr') { $req.Add(@($(if ($cl) { "Bash($g`:*)" } else { "$g *" }), $g)) }
  $req.Add(@($(if ($cl) { 'Bash(pwsh .claude/skills/deliver/scripts/:*)' } else { 'pwsh *deliver/scripts/*' }), 'pwsh-deliver'))
  foreach ($v in $verify) { $req.Add(@($(if ($cl) { "Bash($v`:*)" } else { "$v *" }), $v)) }
  $miss = @()
  foreach ($r in $req) {
    $ok = $false
    foreach ($e in $entries) {
      $cmd = if ($cl) { ($e -replace '^Bash\(', '' -replace '\)$', '' -replace ':\*$', '') } else { ($e -replace '[\s]*\*$', '') }
      if ($r[1] -eq 'pwsh-deliver') { if ($e -match 'pwsh' -and $e -match 'deliver/scripts/(:\*|\*)') { $ok = $true } }
      elseif ($r[1] -eq 'git' -or $r[1] -match '^(gh|pnpm|npm|yarn|dotnet|cargo|go|uv|make|npx) ') {
        # an entry for the whole tool (`git`, `gh`, `pnpm`) or for the exact command satisfies it
        if ($cmd -eq $r[1] -or $cmd -eq ($r[1] -split ' ')[0] -or $r[1].StartsWith("$cmd ")) { $ok = $true }
      }
      elseif ($cmd -eq $r[1]) { $ok = $true }
    }
    if (-not $ok) { $miss += $r[0] }
  }
  if (-not $miss) { Add-Check 'allowlist' 'ok' "$($req.Count) entries present"; return }
  if ($AddAllowlist) {
    $file = Join-Path $root $(if ($cl) { '.claude/settings.json' } else { 'opencode.json' })
    $j = if (Test-Path -LiteralPath $file) { Get-Content -LiteralPath $file -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
    if ($cl) {
      if (-not $j.ContainsKey('permissions')) { $j['permissions'] = @{} }
      $j['permissions']['allow'] = @(@($j['permissions']['allow']) | Where-Object { $_ }) + $miss
    } else {
      if (-not $j.ContainsKey('permission')) { $j['permission'] = @{} }
      if (-not $j['permission'].ContainsKey('bash')) { $j['permission']['bash'] = [ordered]@{ '*' = 'ask' } }
      foreach ($m in $miss) { $j['permission']['bash'][$m] = 'allow' }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    ($j | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $file -Encoding utf8
    Add-Check 'allowlist' 'fixed' "added $($miss.Count) entries to $(Split-Path -Leaf $file)" @{ added = $miss }
    return
  }
  $target = if ($cl) { 'permissions.allow of .claude/settings.json' } else { 'permission.bash of opencode.json' }
  Add-Check 'allowlist' 'action needed' "missing: $($miss -join ', ')" @{ missing = $miss; fix = "add to $target, or run with -AddAllowlist" }
}

# ---- worktrees ----
function Test-Worktrees {
  $self = [IO.Path]::GetFullPath((& git -C $root rev-parse --show-toplevel))
  $wts = @(); $cur = $null
  foreach ($line in (& git -C $root worktree list --porcelain)) {
    if ($line -like 'worktree *') { $cur = [ordered]@{ path = $line.Substring(9); branch = $null }; $wts += $cur }
    elseif ($line -like 'branch refs/heads/*') { $cur.branch = $line.Substring(18) }
  }
  $rx = '^(?:[a-z]+/(\d+)-|wip-(\d+))'
  $cands = @($wts | Select-Object -Skip 1 | Where-Object { $_.branch -match $rx -and [IO.Path]::GetFullPath($_.path) -ne $self })
  if (-not $cands) { Add-Check 'worktrees' 'ok' 'no PBI worktrees'; return }
  # one network call for all branches; a failed call (offline, auth) never counts as "branch gone"
  $heads = @(& git -C $root ls-remote --heads origin 2>$null)
  $lsOk = $LASTEXITCODE -eq 0
  $onRemote = @($heads | ForEach-Object { ($_ -split "`t")[1] -replace '^refs/heads/', '' })
  $owner = try { ((& gh api 'repos/{owner}/{repo}' 2>$null) -join "`n" | ConvertFrom-Json).owner.login } catch { $null }
  $removed = @(); $left = @()
  $script = Join-Path $here 'Remove-PbiWorktrees.ps1'
  foreach ($w in $cands) {
    $null = $w.branch -match $rx
    $issue = [int]$(if ($Matches[1]) { $Matches[1] } else { $Matches[2] })
    $prs = @()
    # a merged PR needs a branch that was pushed once; never pushed: no api call
    $tracked = (& git -C $root rev-parse --verify --quiet "refs/remotes/origin/$($w.branch)" 2>$null)
    if ($owner -and ($tracked -or $onRemote -contains $w.branch)) {
      $list = try { (& gh api "repos/{owner}/{repo}/pulls?head=${owner}:$($w.branch)&state=closed" 2>$null) -join "`n" | ConvertFrom-Json } catch { @() }
      $prs = @($list | Where-Object { $_.merged_at } | ForEach-Object { $_.number })
    }
    # deleted = once on origin (tracking ref), ls-remote worked, absent now, nothing unpushed
    $deleted = $lsOk -and $tracked -and ($onRemote -notcontains $w.branch) -and
      ((& git -C $w.path rev-list --count "refs/remotes/origin/$($w.branch)..HEAD" 2>$null) -eq '0')
    $dirty = & git -C $w.path status --porcelain 2>$null
    if ($prs) {
      Push-Location $root
      try { $r = (& pwsh -NoProfile -File $script -Pr ([int]$prs[0]) -Issue $issue) -join "`n" | ConvertFrom-Json } finally { Pop-Location }
      $removed += @($r.removed)
      foreach ($l in @($r.left)) { if ($l) { $left += $l } }
    } elseif ($deleted -and -not $dirty) {
      & git -C $root worktree remove $w.path 2>$null
      if ($LASTEXITCODE -eq 0) { $removed += $w.path } else { $left += [ordered]@{ path = $w.path; reason = 'worktree remove failed'; command = "git worktree remove --force $($w.path)" } }
    } else {
      $left += [ordered]@{ path = $w.path; branch = $w.branch; reason = $(if ($dirty) { 'uncommitted changes' } elseif (-not $lsOk) { 'origin not reachable' } else { 'branch still open' }); command = "git worktree remove --force $($w.path)" }
    }
  }
  $status = if ($left.Count) { 'action needed' } elseif ($removed.Count) { 'fixed' } else { 'ok' }
  Add-Check 'worktrees' $status "$($removed.Count) removed, $($left.Count) left" @{ removed = $removed; left = $left }
}

if ($Check -contains 'skills') { Test-Skills }
if ($Check -contains 'allowlist') { Test-Allowlist }
if ($Check -contains 'worktrees') { Test-Worktrees }
if ($Text) {
  foreach ($c in $checks) { "preflight $($c.name): $($c.status) - $($c.detail)$(if ($c.fix) { " ($($c.fix))" })" }
} else {
  [ordered]@{ actionNeeded = [bool]@($checks | Where-Object { $_.status -eq 'action needed' }).Count; checks = $checks } | ConvertTo-Json -Depth 6
}
