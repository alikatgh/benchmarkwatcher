import { defineConfig, devices } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT || '5782';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'workbook-chat.spec.ts',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/chat' }]],
  outputDir: 'test-results/chat',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL, baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview:fixture',
    env: { PLAYWRIGHT_PORT: port },
    url: `${baseURL}/workspace/login`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
