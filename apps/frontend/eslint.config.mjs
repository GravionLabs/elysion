// @ts-check
// ESLint lints the Angular templates only, because oxlint cannot parse them (ADR 0006 of GravionLabs/skills, #918).
// TypeScript, including the Angular class rules, is linted by oxlint (`.oxlintrc.json`). Every component template is a
// `.html` file (`@angular-eslint/component-max-inline-declarations`), so no inline-template processor is needed.
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.angular/**',
      'node_modules/**',
      'public/**',
      // Deliberate violations; lint-probe/probe.test.mjs lints them with --no-ignore.
      'lint-probe/**',
    ],
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
);
