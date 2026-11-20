// Lint probe (ADR 0006 of GravionLabs/skills, #918): oxlint runs the Angular class rules through an alpha JS plugin and
// the promise rules with type information (oxlint-tsgolint), ESLint the template rules. A tool update or a config change
// that silently drops a rule would still pass `pnpm lint`; this test lints the deliberate violations of this folder and
// expects every rule, so it fails instead. Run by `pnpm lint` of the frontend (`node --test lint-probe/probe.test.mjs`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('..', import.meta.url));
// oxlint is a devDependency of the repository root, ESLint one of the frontend.
// Both linters start a process and load their plugins; on a busy machine that takes a while.
const timeout = 120_000;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: frontend, encoding: 'utf8', timeout });
  assert.equal(result.error, undefined, `${command} did not run: ${result.error}`);
  // Both exit with 1 when they report errors; the report is on stdout either way.
  assert.ok(result.status === 0 || result.status === 1, `${command} failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('oxlint reports the Angular class rules and the type-aware promise rules', { timeout }, () => {
  const report = run('../../node_modules/.bin/oxlint', [
    '-c',
    'lint-probe/.oxlintrc.json',
    '-f',
    'json',
    'lint-probe/',
  ]);
  const codes = report.diagnostics.map((d) => d.code).sort();
  assert.deepEqual(codes, [
    '@angular-eslint(component-max-inline-declarations)',
    '@angular-eslint(component-selector)',
    '@angular-eslint(no-empty-lifecycle-method)',
    '@angular-eslint(no-output-native)',
    '@angular-eslint(no-output-on-prefix)',
    '@angular-eslint(prefer-inject)',
    '@angular-eslint(prefer-standalone)',
    '@angular-eslint(use-lifecycle-interface)',
    'typescript(await-thenable)',
    'typescript(no-floating-promises)',
    'typescript(no-misused-promises)',
  ]);
});

test('ESLint reports the template rules', { timeout }, () => {
  const [result] = run('node_modules/.bin/eslint', [
    '--no-ignore',
    '-f',
    'json',
    'lint-probe/probe.html',
  ]);
  const rules = result.messages.map((m) => m.ruleId ?? m.message).sort();
  assert.deepEqual(rules, [
    '@angular-eslint/template/alt-text',
    '@angular-eslint/template/banana-in-box',
    '@angular-eslint/template/click-events-have-key-events',
    '@angular-eslint/template/interactive-supports-focus',
  ]);
});
