// Pre-commit: runs only on staged files, so it takes seconds. C# files are not checked here
// (the JetBrains formatter needs about 40 seconds for the solution); `pnpm lint` and CI cover them.
const OXLINT_APPS = [
  'apps/bff',
  'apps/realtime',
  'apps/frontend',
  'apps/frontend-canvas',
  'apps/e2e',
  'apps/load',
];

export default {
  '*': 'prettier --write --ignore-unknown',
  ...Object.fromEntries(
    OXLINT_APPS.map((app) => [
      `${app}/**/*.{ts,tsx}`,
      (files) => `oxlint --deny-warnings -c ${app}/oxlint.json ${files.join(' ')}`,
    ]),
  ),
};
