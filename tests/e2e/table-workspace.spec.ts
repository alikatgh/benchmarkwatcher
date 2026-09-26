import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openTable(page: Page) {
    const response = await page.goto('/?view=compact');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#table-workspace')).toBeVisible();
    await expect(page.locator('#table-body tr[data-id]').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((window as any).BW?.TableWorkspace?.ready))).toBe(true);
}
const visibleRows = (page: Page) => page.locator('#table-body tr[data-id]:visible');

test.describe('Benchmark table workspace', () => {
    test('combines explicit filters with local search and resets them', async ({ page }) => {
        await openTable(page);
        const row = page.locator('#table-body tr[data-id]').first();
        const category = (await row.getAttribute('data-category'))!;
        const name = (await row.getAttribute('data-name'))!;
        await page.locator('#tw-filter-button').click();
        await page.locator('#tw-category').selectOption(category);
        await expect.poll(() => visibleRows(page).count()).toBeGreaterThan(0);
        const categories = await visibleRows(page).evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.category));
        expect(categories.every(value => value === category)).toBe(true);
        await page.locator('#tw-query').fill(name);
        await expect(visibleRows(page)).toHaveCount(1);
        await page.locator('#tw-query').fill('No matching benchmark 987654');
        await expect(page.locator('#tw-empty')).toBeVisible();
        await page.locator('#tw-reset-filters').click();
        await expect.poll(() => visibleRows(page).count()).toBeGreaterThan(1);
    });

    test('sorts numeric values correctly and adds an explicit second sort', async ({ page }) => {
        await openTable(page);
        await page.locator('th[data-col="price"] .tw-header-sort').click();
        await expect(page.locator('th[data-col="price"]')).toHaveAttribute('aria-sort', 'ascending');
        const prices = await visibleRows(page).evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.price).filter(value => value !== '').map(Number));
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
        await page.locator('th[data-col="updated"] .tw-header-sort').click({ modifiers: ['Shift'] });
        await page.locator('#tw-sort-button').click();
        await expect(page.locator('#tw-sort-rules .tw-sort-rule')).toHaveCount(2);
        await expect(page.locator('#tw-sort-rules select').nth(0)).toHaveValue('price');
        await expect(page.locator('#tw-sort-rules select').nth(2)).toHaveValue('updated');
    });

    test('saves a named view and restores its filters, density, columns and resized width', async ({ page }) => {
        await openTable(page);
        const name = (await page.locator('#table-body tr[data-id]').first().getAttribute('data-name'))!;
        await page.locator('#tw-query').fill(name);
        await page.locator('#tw-properties-button').click();
        await page.locator('#tw-density').selectOption('compact');
        await page.locator('#tw-property-list').getByLabel('History', { exact: true }).uncheck();
        await page.keyboard.press('Escape');
        const resize = page.locator('th[data-col="price"] .tw-resizer');
        await resize.focus(); await page.keyboard.press('ArrowRight');
        const expectedWidth = await page.locator('th[data-col="price"]').evaluate(el => getComputedStyle(el).width);
        await page.locator('#tw-new-view').click();
        await page.locator('#tw-view-name').fill('My source review');
        await page.locator('#tw-view-form').getByRole('button', { name: 'Save as new view' }).click();
        await page.reload();
        await expect(page.locator('#tw-views').getByRole('button', { name: 'My source review' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#tw-query')).toHaveValue(name);
        await expect(visibleRows(page)).toHaveCount(1);
        await expect(page.locator('#data-table')).toHaveAttribute('data-density', 'compact');
        await expect(page.locator('th[data-col="trend"]')).toBeHidden();
        await expect(page.locator('th[data-col="price"]')).toHaveCSS('width', expectedWidth);
    });

    test('selects only filtered results, discloses hidden selection and exports a scoped CSV', async ({ page }) => {
        await openTable(page);
        const firstName = (await page.locator('#table-body tr[data-id]').first().getAttribute('data-name'))!;
        await page.locator('#tw-query').fill(firstName);
        await expect(visibleRows(page)).toHaveCount(1);
        await page.locator('#tw-select-all').check();
        await expect(page.locator('#tw-selection-count')).toHaveText('1 selected');
        await page.locator('#tw-query').fill('No matching benchmark');
        await expect(page.locator('#tw-selection-count')).toHaveText('1 selected (1 outside filters)');
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#tw-export-selected').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toContain('benchmarks-selected-');
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(chunk);
        const csv = Buffer.concat(chunks).toString('utf8');
        expect(csv).toContain('Currency,Unit,Change,Change %,Observation date,Frequency,Source,Range');
        expect(csv).toContain(firstName);
        expect(csv.trim().split('\r\n')).toHaveLength(2);
    });

    test('keeps a saved filtered selection after observation range refresh', async ({ page }) => {
        await openTable(page);
        const name = (await page.locator('#table-body tr[data-id]').first().getAttribute('data-name'))!;
        await page.locator('#tw-query').fill(name);
        await page.locator('#tw-select-all').check();
        const response = page.waitForResponse(r => r.url().includes('/api/commodities') && r.url().includes('range=1M'));
        await page.locator('#range-1M').click(); await response;
        await expect(page.locator('#data-table')).toHaveAttribute('aria-busy', 'false');
        await expect(visibleRows(page)).toHaveCount(1);
        await expect(page.locator('#tw-selection-count')).toHaveText('1 selected');
        await expect(page.locator('#range-1M')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#tw-query')).toHaveValue(name);
    });

    for (const width of [390, 320]) {
        test(`contains ${width}px horizontal table scroll and keeps touch controls labeled`, async ({ page }) => {
            test.setTimeout(90_000);
            await page.setViewportSize({ width, height: 844 });
            await openTable(page);
            const before = await page.locator('.tw-table-region').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
            expect(before.scrollWidth).toBeGreaterThan(before.width);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.locator('.tw-table-region').evaluate(el => { el.scrollLeft = 450; });
            expect(await page.locator('.tw-table-region').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
            await page.locator('#tw-properties-button').click();
            await expect(page.locator('#tw-properties')).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            const a11y = await new AxeBuilder({ page }).include('#table-workspace').withTags(['wcag2a', 'wcag2aa']).analyze();
            expect(a11y.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
            await page.screenshot({ path: `/private/tmp/benchmark-table-${width}.png`, fullPage: true });
        });
    }
});
