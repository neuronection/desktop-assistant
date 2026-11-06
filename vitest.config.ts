import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  // The library is excluded from vitest's dep-optimizer: the pre-bundled
  // assistant-ui chunks produced undefined component bindings for some
  // import graphs (web-search-providers → provider-card — the "Element
  // type is invalid" crashes in the settings suites). The ESM package
  // loads fine un-optimized; only the CJS-transitive-dep concern of
  // vite.config.ts applies to the dev server, not vitest.
  optimizeDeps: {
    exclude: ['@neuronection/assistant-ui'],
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@packs': resolve(__dirname, 'src/packs'),
      'generated/prisma/client': resolve(__dirname, 'src/generated/prisma/client.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup/canvas.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxWorkers: 8,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/generated/**', 'src/main/resources/**'],
      reporter: ['text', 'json-summary'],
      // Plan 46 S2 floors — measured 2026-10-24 over the full suite
      // (v8, lines/branches) and rounded down to a stable floor:
      //   src/main/ai 85.1/76.8 · src/main/apps 68.5/61.0 · src/main/db 91.1/87.9
      //   src/main/services 79.2/72.6 · src/main/turns 90.3/81.7
      //   src/renderer 74.6/70.2 · src/shared 68.2/75.0 · src/packs 93.2/89.1
      //   src/preload 88.2/100
      // Floors are raised as suites grow and are never lowered without a
      // recorded reason in the commit. Electron-lifecycle shells are
      // deliberately NOT gated: src/main/ipc (registrars execute only
      // under the live register wrapper; parity is proven by the
      // ipc-structure/conformance source tests), window.ts, tray.ts,
      // main.ts and ipc-handlers.ts (exercised by the packaged --smoke
      // boot), src/generated (generated code).
      thresholds: {
        lines: 50,
        branches: 50,
        'src/main/ai/**': { lines: 82, branches: 74 },
        'src/main/apps/**': { lines: 65, branches: 58 },
        'src/main/db/**': { lines: 88, branches: 85 },
        'src/main/services/**': { lines: 75, branches: 70 },
        'src/main/turns/**': { lines: 88, branches: 79 },
        'src/renderer/**': { lines: 70, branches: 67 },
        'src/shared/**': { lines: 65, branches: 72 },
        'src/packs/**': { lines: 90, branches: 86 },
        'src/preload/**': { lines: 85, branches: 95 },
      },
    },
  },
});
