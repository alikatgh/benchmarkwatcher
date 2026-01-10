/**
 * tests/e2e/visual-grid.spec.ts
 * 
 * Visual regression tests for grid view across themes and card styles
 * Catches silent UI regressions when themes or layouts change
 */

import { test, expect } from '@playwright/test';

const THEMES = ['light', 'dark', 'bloomberg'];
const STYLES = ['card', 'minimal', 'dense'];

for (const theme of THEMES) {
    for (const style of STYLES) {
        test(`grid view – ${theme} / ${style}`, async ({ page }) => {
            await page.goto('/');

            // Set theme and card style via localStorage
            await page.evaluate(([t, s]) => {
                localStorage.setItem('theme', t);
                localStorage.setItem('grid-settings', JSON.stringify({
                    cardStyle: s,
                    dataRange: 'ALL'
                }));
            }, [theme, style]);

            await page.reload();

            // Wait for grid to load
            await page.waitForSelector('#grid-cards-container', { state: 'visible' });
            await page.waitForTimeout(500); // Allow animations to complete

            await expect(page.locator('#grid-cards-container')).toHaveScreenshot(
                `grid-${theme}-${style}.png`,
                { maxDiffPixelRatio: 0.02 }
            );
        });
    }
}

// Test compact view for each theme
for (const theme of THEMES) {
    test(`compact view – ${theme}`, async ({ page }) => {
        await page.goto('/');

        await page.evaluate((t) => {
            localStorage.setItem('theme', t);
            localStorage.setItem('view-mode', 'compact');
        }, theme);

        await page.reload();

        await page.waitForSelector('#compact-view', { state: 'visible' });
        await page.waitForTimeout(500);

        await expect(page.locator('#compact-view')).toHaveScreenshot(
            `compact-${theme}.png`,
            { maxDiffPixelRatio: 0.02 }
        );
    });
}
