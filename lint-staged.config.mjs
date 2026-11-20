// Pre-commit: runs only on staged files, so it takes seconds. C# files are not checked here
// (the JetBrains formatter needs about 40 seconds for the solution); `pnpm lint` and CI cover them.
// Each TypeScript project lints with its own `.oxlintrc.json`, which extends the root one (#918).
const OXLINT_PROJECTS = [
  'apps/bff',
  'apps/realtime',
  'apps/frontend',
  'apps/frontend-canvas',
  'apps/e2e',
  'apps/load',
  'apps/site',
  'packages/node-logging',
  'packages/shared-types',
];

export default {
  // oxfmt skips the files it does not format (C#, images) and those of .oxfmtrc.json's ignorePatterns.
  '*': 'oxfmt --no-error-on-unmatched-pattern',
  ...Object.fromEntries(
    OXLINT_PROJECTS.map((project) => [
      `${project}/**/*.{ts,tsx,mts,vue}`,
      // A file of the config's ignorePatterns (the frontend's lint probe) leaves oxlint with nothing to lint.
      (files) =>
        `oxlint --deny-warnings --no-error-on-unmatched-pattern -c ${project}/.oxlintrc.json ${files.join(' ')}`,
    ]),
  ),
  // The Angular templates; ESLint runs in the frontend so that it finds its config and plugins.
  'apps/frontend/src/**/*.html': (files) =>
    `pnpm --filter @elysion/frontend exec eslint ${files.join(' ')}`,
};
