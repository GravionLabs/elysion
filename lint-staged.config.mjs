// Pre-commit: runs only on staged files, so it takes seconds. C# files are not checked here
// (`dotnet format` needs about eight seconds to load the solution); `pnpm lint` and CI cover them.
const OXLINT_APPS = ['apps/bff', 'apps/realtime', 'apps/frontend', 'apps/frontend-canvas'];

export default {
  '*': 'prettier --write --ignore-unknown',
  ...Object.fromEntries(
    OXLINT_APPS.map((app) => [
      `${app}/**/*.{ts,tsx}`,
      (files) => `oxlint --deny-warnings -c ${app}/oxlint.json ${files.join(' ')}`,
    ]),
  ),
};
