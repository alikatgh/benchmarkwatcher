import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// These journeys exercise the shipped template, event handlers, browser storage,
// and native dialogs. They do not need benchmark fetch fixtures: all entries here
// are authored locally and source requests remain the application's normal flow.
const storageKey = 'bw.research.workspace.v1';

async function openResearch(page: Page) {
    const response = await page.goto('/?workspace=research');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('#research-workspace')).toBeVisible();
    await expect(page.locator('#research-heading')).toHaveText('Research');
}

async function newEntry(page: Page, title: string) {
    await page.locator('#research-workspace [data-rw-action="new"]').first().click();
    await expect(page.locator('#rw-editor')).toBeVisible();
    await page.locator('#rw-editor [name="title"]').fill(title);
}

async function finishEntry(page: Page) {
    await page.locator('#rw-editor').getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('#rw-editor')).not.toBeVisible();
    await expect(page.locator('#rw-save-state')).toHaveText('Saved in this browser');
}

test.describe('Local research workspace', () => {
    test('creates an entry, edits fields, persists across reload, and finds it through search', async ({ page }) => {
        await openResearch(page);
        await newEntry(page, 'Check observation revisions');
        await page.locator('#rw-editor [name="notes"]').fill('Compare publication dates with the original source.');
        await page.locator('#rw-editor [name="tags"]').fill('Methodology, Monthly');
        await page.locator('#rw-editor [name="status"]').selectOption('In progress');
        await finishEntry(page);
        await page.reload();
        await expect(page.locator('#research-workspace')).toBeVisible();
        await page.locator('#rw-search').fill('publication dates');
        await expect(page.locator('#rw-count')).toHaveText('1 entry');
        await page.locator('#rw-table-body').getByRole('button', { name: 'Check observation revisions' }).click();
        await expect(page.locator('#rw-editor [name="notes"]')).toHaveValue('Compare publication dates with the original source.');
        await expect(page.locator('#rw-editor [name="status"]')).toHaveValue('In progress');
        await expect(page.locator('#rw-editor [name="tags"]')).toHaveValue('Methodology, Monthly');
    });

    test('adds a typed personal property with a unit and restores its value after reload', async ({ page }) => {
        await openResearch(page);
        await page.locator('#research-workspace').getByRole('button', { name: 'Properties', exact: true }).click();
        const properties = page.locator('#rw-properties-dialog');
        await properties.getByLabel('Name', { exact: true }).fill('Reporting lag');
        await properties.getByLabel('Property type', { exact: true }).selectOption('number');
        await properties.getByLabel('Unit (optional)', { exact: true }).fill('days');
        await properties.getByRole('button', { name: 'Add property', exact: true }).click();
        await properties.getByRole('button', { name: 'Close properties' }).click();
        await newEntry(page, 'Monthly observation context');
        await page.locator('#rw-editor').getByLabel('Reporting lag', { exact: true }).fill('3.5');
        await finishEntry(page);
        await expect(page.locator('#rw-table-body tr').first()).toContainText('3.5 days');
        await page.reload();
        await page.locator('#rw-table-body').getByRole('button', { name: 'Monthly observation context' }).click();
        await expect(page.locator('#rw-editor').getByLabel('Reporting lag', { exact: true })).toHaveValue('3.5');
    });

    test('archives and restores an entry without losing notes', async ({ page }) => {
        await openResearch(page);
        await newEntry(page, 'A recoverable note');
        await page.locator('#rw-editor [name="notes"]').fill('Retain this context when archived.');
        await page.locator('#rw-editor').getByRole('button', { name: 'Archive', exact: true }).click();
        await expect(page.locator('#rw-count')).toHaveText('0 entries');
        await page.locator('#rw-views').getByRole('button', { name: 'Archived', exact: true }).click();
        await page.locator('#rw-table-body').getByRole('button', { name: 'A recoverable note' }).click();
        await expect(page.locator('#rw-editor [name="notes"]')).toHaveValue('Retain this context when archived.');
        await page.locator('#rw-editor').getByRole('button', { name: 'Restore entry', exact: true }).click();
        await page.locator('#rw-views').getByRole('button', { name: 'All entries', exact: true }).click();
        await expect(page.locator('#rw-table-body').getByRole('button', { name: 'A recoverable note' })).toBeVisible();
    });

    test('previews a backup without applying it and keeps the current workspace when canceled', async ({ page }) => {
        await openResearch(page);
        await newEntry(page, 'Keep the local entry');
        await finishEntry(page);
        const backup = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
        backup.entries[0].title = 'Imported replacement';
        backup.entries[0].updatedAt = '2030-01-01T00:00:00.000Z';
        await page.locator('#rw-import-file').setInputFiles({
            name: 'research-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
        });
        await expect(page.locator('#rw-import-dialog')).toBeVisible();
        await expect(page.locator('#rw-import-summary')).toContainText('1 matching existing IDs');
        await page.locator('#rw-import-dialog').getByRole('button', { name: 'Close import' }).click();
        await expect(page.locator('#rw-table-body')).toContainText('Keep the local entry');
        await expect(page.locator('#rw-table-body')).not.toContainText('Imported replacement');
        await page.reload();
        await expect(page.locator('#rw-table-body')).toContainText('Keep the local entry');
    });

    test('supports keyboard open, Escape field cancel, dialog close, and focus restoration', async ({ page }) => {
        await openResearch(page);
        await newEntry(page, 'Keyboard research');
        await finishEntry(page);
        const entry = page.locator('#rw-table-body').getByRole('button', { name: 'Keyboard research' });
        await entry.focus();
        await page.keyboard.press('Enter');
        const title = page.locator('#rw-editor [name="title"]');
        await title.focus();
        await title.fill('Unfinished title');
        await page.keyboard.press('Escape');
        await expect(title).toHaveValue('Keyboard research');
        await expect(page.locator('#rw-editor')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#rw-editor')).not.toBeVisible();
        await expect(entry).toBeFocused();
    });

    test('keeps a 390px research editor readable, contained, and labeled', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openResearch(page);
        await newEntry(page, 'A long research title remains editable on a small screen');
        await page.locator('#rw-editor [name="notes"]').fill('Source observations remain separate from personal notes.');
        const layout = await page.evaluate(() => {
            const dialog = document.querySelector<HTMLDialogElement>('#rw-editor')!;
            const bounds = dialog.getBoundingClientRect();
            return { pageOverflow: document.documentElement.scrollWidth > innerWidth, dialogOverflow: dialog.scrollWidth > dialog.clientWidth + 1, left: bounds.left, right: bounds.right, width: innerWidth };
        });
        expect(layout.pageOverflow).toBe(false);
        expect(layout.dialogOverflow).toBe(false);
        expect(layout.left).toBeGreaterThanOrEqual(0);
        expect(layout.right).toBeLessThanOrEqual(layout.width);
        const result = await new AxeBuilder({ page }).include('#rw-editor').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
        await finishEntry(page);
        await expect(page.locator('#rw-table-body').getByRole('button', { name: 'A long research title remains editable on a small screen' })).toBeVisible();
    });
});
