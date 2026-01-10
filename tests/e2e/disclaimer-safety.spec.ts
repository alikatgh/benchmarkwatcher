/**
 * tests/e2e/disclaimer-safety.spec.ts
 * 
 * Playwright runtime check for forbidden vocabulary terms
 * Scans main content area (excludes footer disclaimer which legitimately uses some terms)
 * 
 * Forbidden terms defined in docs/ui-vocabulary.md
 */

import { test, expect } from '@playwright/test';

// Forbidden terms for MAIN UI text - not including disclaimer areas
// Note: 'investment', 'return' excluded as they appear in legitimate disclaimers
const FORBIDDEN_IN_MAIN = [
    'performance',
    'trend',
    'signal',
    'forecast',
    'prediction',
    'outperform',
    'underperform',
    'buy',
    'sell',
    'trade',
    'recommend',
    'suggest',
    'profit',
    'loss'
];

function makeRegex(term: string): RegExp {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

test.describe('UI vocabulary safety', () => {
    test('main content does not contain forbidden terms', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Get text from main content area only (exclude footer disclaimer)
        const mainContent = await page.evaluate(() => {
            const main = document.querySelector('main, #grid-view, #compact-view');
            return main?.textContent || '';
        });

        const found: string[] = [];
        for (const term of FORBIDDEN_IN_MAIN) {
            if (makeRegex(term).test(mainContent)) {
                found.push(term);
            }
        }
        expect(
            found,
            `Found forbidden terms in main content: ${found.join(', ')}\nSee docs/ui-vocabulary.md`
        ).toEqual([]);
    });

    test('commodity cards use observational language', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#grid-cards-container', { state: 'visible', timeout: 5000 }).catch(() => { });

        const cardText = await page.locator('#grid-cards-container').innerText().catch(() => '');

        // These terms specifically should never appear in commodity cards
        expect(cardText.toLowerCase()).not.toContain('trend');
        expect(cardText.toLowerCase()).not.toContain('signal');
        expect(cardText.toLowerCase()).not.toContain('forecast');
    });
});
