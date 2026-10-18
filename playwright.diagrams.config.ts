import { defineConfig, devices } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT || '5795';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'pele-diagrams.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  outputDir: process.env.DIAGRAM_TEST_OUTPUT || 'test-results/diagrams',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'off',
    serviceWorkers: 'block',
  },
  projects: [{
    name: 'desktop',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
  }],
  webServer: {
    command: '.venv/bin/python -m tests.e2e.server --workbooks --companies --visual-builder',
    env: { PLAYWRIGHT_PORT: port },
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
