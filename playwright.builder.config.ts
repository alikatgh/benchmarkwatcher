import { defineConfig, devices } from '@playwright/test';
const port = process.env.PLAYWRIGHT_PORT || '5792';
export default defineConfig({
  testDir:'./tests/e2e', testMatch:'visual-builder.spec.ts', workers:1, timeout:45000,
  reporter:'list', outputDir:process.env.BUILDER_TEST_OUTPUT || 'test-results/visual-builder',
  use:{channel:process.env.PLAYWRIGHT_CHANNEL,baseURL:`http://127.0.0.1:${port}`,screenshot:'only-on-failure'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
    {name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}
  ],
  webServer:{command:'.venv/bin/python -m tests.e2e.server --workbooks --companies --visual-builder',
    env:{PLAYWRIGHT_PORT:port},url:`http://127.0.0.1:${port}/health`,reuseExistingServer:false}
});
