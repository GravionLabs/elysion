import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // Required by the app (the WS token check); a development value, as in .env.example.
    env: { WS_TOKEN_SECRET: 'test-only-ws-token-secret-0123456789abcdef' },
    include: ['**/*.spec.ts'],
  },
});
