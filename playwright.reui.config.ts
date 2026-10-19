import { defineConfig, devices } from '@playwright/test';
const port = process.env.PLAYWRIGHT_PORT || '5798';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'reui-ui.spec.ts', workers: 1, timeout: 30000,
  reporter: 'list', outputDir: process.env.REUI_TEST_OUTPUT || 'test-results/reui',
  use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: `http://127.0.0.1:${port}`, screenshot: 'only-on-failure' },
  webServer: { command: '.venv/bin/python -m tests.e2e.server --companies --visual-builder', env: { PLAYWRIGHT_PORT: port }, url: `http://127.0.0.1:${port}/health`, reuseExistingServer: false },
});
