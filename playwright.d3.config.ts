import { defineConfig, devices } from '@playwright/test';
const port = process.env.PLAYWRIGHT_PORT || '5785';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'd3-visuals.spec.ts', workers: 1,
  reporter: 'list', outputDir: 'test-results/d3-migration', timeout: 45000,
  use: {channel: process.env.PLAYWRIGHT_CHANNEL, baseURL:`http://127.0.0.1:${port}`, screenshot:'only-on-failure'},
  projects: [
    {name:'desktop', use:{...devices['Desktop Chrome'], viewport:{width:1440,height:1000}}},
    {name:'mobile', use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}
  ],
  webServer:{command:'.venv/bin/python -m tests.e2e.server --workbooks', env:{PLAYWRIGHT_PORT:port}, url:`http://127.0.0.1:${port}/health`, reuseExistingServer:false}
});
