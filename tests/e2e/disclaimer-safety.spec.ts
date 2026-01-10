/**
 * @jest-environment jsdom
 */

/**
 * tests/e2e/disclaimer-safety.spec.ts
 * 
 * Playwright runtime check for forbidden vocabulary terms
 * Scans rendered pages to catch runtime text that source scanning misses
 * 
 * Forbidden terms defined in docs/ui-vocabulary.md
 */

import { test, expect, Page } from '@playwright/test';

// Forbidden terms - must match docs/ui-vocabulary.md
const FORBIDDEN = [
    'return',
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
    'loss',
    'invest',
    'investment'
];

function makeRegex(term: string): RegExp {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

async function checkPageForForbiddenTerms(page: Page, url: string): Promise<string[]> {
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // Get visible text content (excludes hidden elements, scripts, styles)
    const content = await page.evaluate(() => {
        return document.body.innerText || '';
    });

    const found: string[] = [];
    for (const term of FORBIDDEN) {
        if (makeRegex(term).test(content)) {
            found.push(term);
        }
    }
    return found;
}

test.describe('UI vocabulary safety', () => {
    // Pages to check - add more as needed
    const pagesToCheck = [
        '/',
    ];

    for (const route of pagesToCheck) {
        test(`page ${route} does not contain forbidden terms`, async ({ page }) => {
            const found = await checkPageForForbiddenTerms(page, route);
            expect(
                found,
                `Found forbidden terms on ${route}: ${found.join(', ')}\nSee docs/ui-vocabulary.md`
            ).toEqual([]);
        });
    }

    test('settings modal does not contain forbidden terms', async ({ page }) => {
        await page.goto('/');

        // Try to open settings modal
        const settingsBtn = page.locator('#settings-button, [data-settings-toggle]');
        if (await settingsBtn.isVisible()) {
            await settingsBtn.click();
            await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 2000 }).catch(() => { });

            const modalText = await page.locator('#settings-modal').innerText().catch(() => '');
            const found: string[] = [];
            for (const term of FORBIDDEN) {
                if (makeRegex(term).test(modalText)) {
                    found.push(term);
                }
            }
            expect(found, `Settings modal contains forbidden terms: ${found.join(', ')}`).toEqual([]);
        }
    });

    test('commodity cards use observational language', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#grid-cards-container', { state: 'visible', timeout: 5000 }).catch(() => { });

        // Check that cards don't use "trend" or "signal"
        const cardText = await page.locator('#grid-cards-container').innerText().catch(() => '');

        expect(cardText.toLowerCase()).not.toContain('trend');
        expect(cardText.toLowerCase()).not.toContain('signal');
    });
});
