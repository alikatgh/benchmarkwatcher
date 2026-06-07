import { defineConfig, devices } from '@playwright/test';

// Default to a distinctive, uncommon port. 5050 is a generic dev port that
// frequently collides with other local servers; because `reuseExistingServer`
// is enabled below for local (non-CI) runs, a collision makes Playwright
// silently reuse the *foreign* app already on the port and report phantom
// failures (every locator misses because it's the wrong app). Override with
// PLAYWRIGHT_PORT if 5781 is ever taken.
const e2ePort = process.env.PLAYWRIGHT_PORT || '5781';
const baseURL = `http://127.0.0.1:${e2ePort}`;
const flaskCommand = process.env.PLAYWRIGHT_FLASK_COMMAND || `python -m flask --app run:app run --host 127.0.0.1 --port ${e2ePort}`;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',

    use: {
        baseURL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Run local dev server before tests
    webServer: {
        command: flaskCommand,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
