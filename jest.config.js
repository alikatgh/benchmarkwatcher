/** @type {import('jest').Config} */
module.exports = {
    // Only test __tests__ directory (Jest unit tests)
    testMatch: ['**/__tests__/**/*.js'],

    // Ignore Playwright E2E tests (they're run by Playwright, not Jest)
    testPathIgnorePatterns: [
        '/node_modules/',
        '/tests/e2e/'
    ],

    // Default test environment
    testEnvironment: 'node',

    testEnvironmentOptions: {
        // Node v25 introduced a native localStorage global (WebStorage API) with
        // a getter that warns when accessed without --localstorage-file. Jest 30's
        // cross-test global cleanup iterates all globals and trips that getter.
        // 'off' disables the cleanup entirely — safe here because our tests don't
        // install globals that need scrubbing between suites.
        globalsCleanup: 'off',
    },
};
