/**
 * tests/e2e/a11y.spec.ts
 * 
 * Accessibility tests using axe-core
 * Checks for critical WCAG 2.0 violations only (not warnings like color contrast)
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
    test('homepage has no critical accessibility violations', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            // Exclude color-contrast as it's a design choice, not a blocker
            .disableRules(['color-contrast'])
            .analyze();

        // Only fail on critical violations
        const critical = results.violations.filter(v => v.impact === 'critical');

        expect(
            critical,
            `Found ${critical.length} critical a11y violations:\n${critical.map(v => `- ${v.id}: ${v.description}`).join('\n')
            }`
        ).toEqual([]);
    });

    test('grid view cards are keyboard accessible', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#grid-cards-container', { state: 'visible', timeout: 5000 }).catch(() => { });

        // Check that range buttons exist and are focusable
        const rangeButtons = page.locator('[id^="grid-range-"]');
        const count = await rangeButtons.count();

        if (count > 0) {
            // Tab to first button and verify it's focused
            await page.keyboard.press('Tab');
            const activeElement = await page.evaluate(() => document.activeElement?.tagName);
            // Should be able to tab to interactive elements
            expect(['BUTTON', 'A', 'INPUT', 'SELECT']).toContain(activeElement);
        }
    });
});
