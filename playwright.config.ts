import { defineConfig } from 'playwright/test';

// Plan 46 S3 — the E2E smoke drives the REAL app (Electron via CDP) over
// the demo harness: fresh demo workspace, local scripted mocks, zero
// network. One worker: each test boots its own app instance serially.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'node_modules/.tmp/smoke-artifacts',
});
