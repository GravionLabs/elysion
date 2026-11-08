<#
.SYNOPSIS
  Toggles the deliver-log pane of the active herdr tab: closes it when open, else opens it again below the active pane.
.DESCRIPTION
  Bound to a herdr key (references/terminal-backends.md): `type = "shell"` sets HERDR_ACTIVE_TAB_ID, HERDR_ACTIVE_PANE_ID and
  HERDR_ACTIVE_PANE_CWD; a plugin action sets HERDR_TAB_ID and HERDR_PANE_ID. herdr has no hide, so the toggle closes the
  pane and reopens it on the same log: .agents/deliver-loop.ansi.log under the pane's cwd, else .agents/deliver-loop.log.
  Runs only in herdr: HERDR_ENV=1 or a HERDR_ACTIVE_* id (a shell keybinding may not set HERDR_ENV). Outside herdr (poimen: notice only), without
  a log or on a herdr failure it opens no pane and exits 0.
#>
[CmdletBinding()]
param()

$tab = if ($env:HERDR_ACTIVE_TAB_ID) { $env:HERDR_ACTIVE_TAB_ID } else { $env:HERDR_TAB_ID }
$pane = if ($env:HERDR_ACTIVE_PANE_ID) { $env:HERDR_ACTIVE_PANE_ID } else { $env:HERDR_PANE_ID }
. (Join-Path $PSScriptRoot 'TerminalBackend.ps1')

# a shell keybinding of herdr may not set HERDR_ENV: its HERDR_ACTIVE_* ids count as herdr
$backend = if ($env:HERDR_ACTIVE_TAB_ID -or $env:HERDR_ACTIVE_PANE_ID) { 'herdr' } else { Get-TerminalBackend }
if ($backend -eq 'none') { exit 0 }

$cwd = if ($env:HERDR_ACTIVE_PANE_CWD) { $env:HERDR_ACTIVE_PANE_CWD } else { (Get-Location).Path }
$candidates = @('.agents/deliver-loop.ansi.log', '.agents/deliver-loop.log') | ForEach-Object { Join-Path $cwd $_ }
try {
  $status = Switch-LogPane -Pane $pane -Tab $tab -LogCandidates $candidates -Backend $backend
} catch {
  [Console]::Error.WriteLine("deliver log: $_")
  exit 0
}
if ($status -eq 'nolog') { [Console]::Error.WriteLine("deliver log: no .agents/deliver-loop.log under $cwd") }
exit 0
