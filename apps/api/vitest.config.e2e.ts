import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    /*
     * CP10. Every suite in here boots a whole Nest application and opens a
     * Postgres pool in `beforeAll`. Vitest's 10s default is enough on an
     * idle machine and not enough on a busy one -- the full suite failed
     * eight files with "Hook timed out in 10000ms" while every one of them
     * passed when run alone. A setup timeout that depends on how loaded the
     * machine is isn't a test result, it's a coin flip, and a suite that
     * flakes under load is a suite people learn to re-run instead of read.
     *
     * The test timeout is raised for the same reason: these exercise real
     * HTTP, real WebSockets and real transactions, not mocks.
     */
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
