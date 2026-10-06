import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // Required by the app (the WS token check); a development value, as in .env.example.
    env: {
      WS_TOKEN_SECRET: 'test-only-ws-token-secret-0123456789abcdef',
      INTERNAL_API_SECRET: 'test-only-internal-api-secret-0123456789abcdef',
    },
    include: ['**/*.e2e-spec.ts'],
  },
});
