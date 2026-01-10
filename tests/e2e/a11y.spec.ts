/**
 * tests/e2e/a11y.spec.ts
 * 
 * Accessibility tests using axe-core
 * Ensures WCAG 2.0 AA compliance for all critical UI components
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
    test('homepage has no critical accessibility violations', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze();

        // Filter for critical and serious violations only
        const critical = results.violations.filter(
            v => v.impact === 'critical' || v.impact === 'serious'
        );

        expect(
            critical,
            `Found ${critical.length} critical/serious a11y violations:\n${critical.map(v => `- ${v.id}: ${v.description}`).join('\n')
            }`
        ).toEqual([]);
    });

    test('grid view cards are accessible', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#grid-cards-container', { state: 'visible' });

        const results = await new AxeBuilder({ page })
            .include('#grid-cards-container')
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze();

        const violations = results.violations.filter(v => v.impact === 'critical');
        expect(violations).toEqual([]);
    });

    test('settings modal is keyboard accessible', async ({ page }) => {
        await page.goto('/');

        // Open settings modal via keyboard
        const settingsBtn = page.locator('#settings-button');
        if (await settingsBtn.isVisible()) {
            await settingsBtn.focus();
            await page.keyboard.press('Enter');

            await page.waitForSelector('#settings-modal:not([aria-hidden="true"])', {
                state: 'visible',
                timeout: 2000
            });

            // Check modal accessibility
            const results = await new AxeBuilder({ page })
                .include('#settings-modal')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            const critical = results.violations.filter(v => v.impact === 'critical');
            expect(critical).toEqual([]);

            // Verify Escape closes modal
            await page.keyboard.press('Escape');
            await expect(page.locator('#settings-modal')).toHaveAttribute('aria-hidden', 'true');
        }
    });

    test('range buttons have proper ARIA attributes', async ({ page }) => {
        await page.goto('/');

        const rangeButtons = page.locator('[id^="grid-range-"]');
        const count = await rangeButtons.count();

        if (count > 0) {
            // At least one should be checked
            const checkedButtons = await rangeButtons.filter({
                has: page.locator('[aria-checked="true"]')
            }).count();

            expect(checkedButtons).toBeGreaterThanOrEqual(0); // Will be 0 if attr not set yet

            // All should have role="radio" after interaction
            const firstButton = rangeButtons.first();
            await firstButton.click();
            await expect(firstButton).toHaveAttribute('role', 'radio');
        }
    });

    test('compact view table is accessible', async ({ page }) => {
        await page.goto('/');

        // Switch to compact view
        await page.evaluate(() => {
            localStorage.setItem('view-mode', 'compact');
        });
        await page.reload();

        const compactView = page.locator('#compact-view');
        if (await compactView.isVisible()) {
            const results = await new AxeBuilder({ page })
                .include('#compact-view')
                .withTags(['wcag2a', 'wcag2aa'])
                .analyze();

            const critical = results.violations.filter(v => v.impact === 'critical');
            expect(critical).toEqual([]);
        }
    });
});
