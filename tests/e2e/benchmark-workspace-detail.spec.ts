import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function browse(page: Page) {
    await page.goto('/?range=ALL');
    await expect(page.locator('#table-body a[data-benchmark-id]').first()).toBeVisible();
}

async function openFirst(page: Page) {
    const link = page.locator('#table-body a[data-benchmark-id]').first();
    const name = (await link.textContent())!.trim();
    const id = await link.getAttribute('data-benchmark-id');
    await link.click();
    await expect(page.locator('#benchmark-detail')).toBeVisible();
    await expect(page.locator('#benchmark-detail-title')).toHaveText(name);
    await expect(page.locator('.benchmark-detail-value')).toBeVisible();
    return { link, name, id };
}

test('desktop opens contextual source history, watches persistently, and returns focus to the table', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await browse(page);
    const { link, id } = await openFirst(page);
    await expect(page.locator('#benchmark-detail')).toHaveAttribute('role', 'complementary');
    await expect(page.locator('#benchmark-detail')).not.toHaveAttribute('aria-modal');
    await page.locator('#benchmark-detail [data-watch-id]').click();
    await expect(page.locator('#benchmark-detail [data-watch-id]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bw.watchlist.v1')!).ids)).toContain(id);
    await page.locator('#benchmark-detail').getByText(/^Observation table/).click();
    await expect(page.locator('#benchmark-detail-history table')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('benchmark-detail-desktop.png'), fullPage: false });
    await page.locator('#benchmark-detail [data-detail-action="close"]').click();
    await expect(link).toBeFocused();
    await page.reload();
    await openFirst(page);
    await expect(page.locator('#benchmark-detail [data-watch-id]')).toHaveAttribute('aria-pressed', 'true');
});

test('detail keeps history close to the quote and chart controls usable', async ({page}) => {
    await page.setViewportSize({width:1440,height:900});
    await browse(page);
    await openFirst(page);
    const detail = page.locator('#benchmark-detail');
    await expect(detail.getByRole('heading',{name:'Reference history'})).toBeInViewport();
    await detail.locator('#benchmark-chart-settings > summary').click();
    await expect(detail.locator('#benchmark-chart-start')).toBeVisible();
    await detail.locator('#benchmark-chart-style').selectOption('area');
    await expect(detail.locator('#benchmark-chart-settings')).toHaveAttribute('open','');
    await detail.locator('#benchmark-chart-dots').check();
    await expect(detail.locator('#benchmark-chart-dots')).toBeChecked();
    await detail.locator('.benchmark-detail-observations > summary').click();
    await expect(detail.locator('.benchmark-detail-observations table')).toBeVisible();
});

test('selected benchmarks compare with explicit sources, units, baseline dates, and real tables', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await browse(page);
    await page.locator('#table-body .tw-row-select').nth(0).check();
    await page.locator('#table-body .tw-row-select').nth(1).check();
    await page.locator('#tw-compare-selected').click();
    await expect(page.locator('#benchmark-detail-title')).toHaveText('Compare benchmarks');
    await expect(page.locator('.benchmark-detail-legend-item')).toHaveCount(2);
    await expect(page.locator('#benchmark-detail-body')).toContainText('Baseline dates may differ');
    await expect(page.locator('#benchmark-detail-body')).toContainText('Source:');
    await expect(page.locator('#benchmark-detail-body table')).toHaveCount(2);
    await page.locator('#benchmark-detail [data-detail-action="close"]').click();
    await expect(page.locator('#tw-selection-count')).toContainText('2');
});

test('a failed detail request offers retry and recovers without leaving the table', async ({ page }) => {
    await browse(page);
    let fail = true;
    await page.route('**/api/commodity/*', async route => {
        if (fail) { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); }
        else await route.continue();
    });
    await page.locator('#table-body a[data-benchmark-id]').first().click();
    await expect(page.locator('.benchmark-detail-error')).toBeVisible();
    await page.locator('.benchmark-detail-error').getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.benchmark-detail-value')).toBeVisible();
    await expect(page).toHaveURL(/\?range=ALL/);
});

test('390px details stay contained, close with focus restored, and transfer into editable research', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await browse(page);
    const { link, name } = await openFirst(page);
    const detail = page.locator('#benchmark-detail');
    await expect(detail).toHaveAttribute('aria-modal', 'true');
    const dimensions = await detail.evaluate(node => ({
        left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        detailOverflow: node.scrollWidth > node.clientWidth + 1,
        backgroundInert: !!document.querySelector('[inert]')
    }));
    expect(dimensions).toEqual({ left: 0, right: 390, pageOverflow: false, detailOverflow: false, backgroundInert: true });
    const accessibility = await new AxeBuilder({ page }).include('#benchmark-detail').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('benchmark-detail-mobile.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await expect(detail).not.toBeVisible();
    await expect(link).toBeFocused();
    await link.click();
    await expect(page.locator('.benchmark-detail-value')).toBeVisible();
    await detail.getByRole('button', { name: 'Add to research', exact: true }).click();
    await expect(detail).not.toBeVisible();
    await expect(page.locator('#research-workspace')).toBeVisible();
    await expect(page.locator('#rw-editor')).toBeVisible();
    await expect(page.locator('#rw-editor [name="title"]')).toHaveValue(name);
    await page.locator('#rw-editor [name="notes"]').fill('Check the original publication before using this observation.');
    await page.locator('#rw-editor').getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('#rw-save-state')).toHaveText('Saved in this browser');
});

test('320px dark details retain readable controls and a contained chart', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await browse(page);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.add('dark'); });
    await openFirst(page);
    const detail = page.locator('#benchmark-detail');
    expect(await detail.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(detail.getByRole('button', { name: 'Close benchmark details' })).toBeInViewport();
    const accessibility = await new AxeBuilder({ page }).include('#benchmark-detail').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('benchmark-detail-narrow-dark.png'), fullPage: false });
});

test('detail pane resizes by dragging and keyboard, keeps its chart state, and restores width after reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await browse(page); await openFirst(page);
    const detail = page.locator('#benchmark-detail');
    const handle = page.getByRole('separator', { name: 'Resize benchmark details' });
    const chart = detail.locator('.benchmark-detail-plot');
    await expect(handle).toHaveAttribute('aria-valuenow', '560');
    await detail.locator('.benchmark-detail-observations summary').click();
    const box = (await handle.boundingBox())!;
    const initialChartWidth = (await chart.boundingBox())!.width;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', '760');
    expect((await chart.boundingBox())!.width).toBeGreaterThan(initialChartWidth + 190);
    await expect(detail.locator('.benchmark-detail-observations')).toHaveAttribute('open', '');
    await expect(page.locator('body')).not.toHaveClass(/bw-detail-resizing/);
    await handle.focus(); await handle.press('ArrowLeft'); await expect(handle).toHaveAttribute('aria-valuenow', '784');
    await page.reload(); await openFirst(page); await expect(handle).toHaveAttribute('aria-valuenow', '784');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(handle).toBeHidden();
    expect((await detail.boundingBox())!.width).toBe(390);
    expect(await detail.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
});

test('detail chart custom dates and presentation settings remain usable at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await browse(page); await openFirst(page);
    const detail = page.locator('#benchmark-detail');
    const latest = (await detail.locator('.benchmark-detail-table tbody tr td').first().textContent())!.trim();
    await detail.getByRole('button', { name: 'Custom', exact: true }).click();
    await detail.getByLabel('From', { exact: true }).fill(latest);
    await detail.getByLabel('To', { exact: true }).fill(latest);
    await detail.getByRole('button', { name: 'Apply dates', exact: true }).click();
    await expect(detail.locator('[data-detail-range="CUSTOM"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(detail.locator('.benchmark-detail-table tbody tr')).toHaveCount(1);
    await expect(detail.locator('#benchmark-detail-observation')).toBeDisabled();
    await detail.getByLabel('Chart type', { exact: true }).selectOption('area');
    await detail.getByLabel('Observation dots', { exact: true }).uncheck();
    await expect(detail.getByLabel('Chart type', { exact: true })).toHaveValue('area');
    await expect(detail.getByLabel('Observation dots', { exact: true })).not.toBeChecked();
    await detail.getByLabel('From', { exact: true }).fill('2099-12-31');
    await detail.getByRole('button', { name: 'Apply dates', exact: true }).click();
    await expect(detail.locator('#benchmark-chart-date-error')).toContainText('on or before');
    expect(await detail.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
