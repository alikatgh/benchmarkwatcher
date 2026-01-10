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
    testEnvironment: 'node'
};
