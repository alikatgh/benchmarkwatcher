import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
});

test('command search opens a benchmark by keyboard and restores focus after dismissal', async ({ page }) => {
  await page.goto('/?view=compact');
  await expect(page.locator('html')).toHaveAttribute('data-reui', 'ready');
  await page.locator('#bw-search-trigger').focus();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Search workspace', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Search workspace', exact: true }).fill('gold');
  await expect(page.locator('#bw-search-dialog a[href="/commodity/gold"]')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#bw-search-trigger').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#bw-search-dialog')).toHaveCount(0);
  await expect(page.locator('#bw-search-trigger')).toBeFocused();
});

test('command search has useful empty, retry, and navigation states', async ({ page }) => {
  await page.route('**/api/commodities?include_history=false', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/help');
  await page.locator('#bw-search-trigger').click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.unroute('**/api/commodities?include_history=false');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#bw-search-status')).toContainText('6 results shown');
  await page.getByRole('combobox', { name: 'Search workspace', exact: true }).fill('no-such-measure-xyz');
  await expect(page.locator('[data-slot="empty"]').getByText('No results found', { exact: true })).toBeVisible();
  await page.locator('[data-slot="empty"]').getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search workspace', exact: true }).fill('country data');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/data$/);
});

test('all display preferences persist and stay contained at phone widths', async ({ page }) => {
  await page.goto('/?view=compact');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#settings-button').click();
    const modal = page.locator('#settings-modal');
    await expect(page.locator('#view-compact')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#view-grid')).toHaveAttribute('aria-pressed', 'false');
    for (const theme of ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft']) {
      await page.locator('#theme-' + theme).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('#theme-' + theme)).toHaveAttribute('aria-checked', 'true');
      const box = (await modal.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await modal.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.locator('#market-asian').click();
    await expect(page.locator('html')).toHaveAttribute('data-market', 'asian');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('#settings-button')).toBeFocused();
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ft');
  await expect(page.locator('html')).toHaveAttribute('data-market', 'asian');
});

test('desktop filters and saved views keep their existing data and persistence contract', async ({ page }) => {
  await page.goto('/?view=compact');
  await page.locator('#tw-filter-button').click();
  await page.locator('[data-reui-select="tw-category"] [role="combobox"]').click();
  await page.getByRole('option', { name: 'Energy', exact: true }).click();
  await expect(page.locator('#tw-result-count')).toHaveText('1 of 3 benchmarks');
  await expect(page.locator('#table-body tr:visible')).toHaveCount(1);
  await page.locator('#tw-new-view').click();
  await page.locator('#tw-view-name').fill('Energy reference');
  await page.locator('#tw-view-submit').click();
  await page.reload();
  await expect(page.locator('#tw-result-count')).toHaveText('1 of 3 benchmarks');
  await page.locator('#tw-filter-button').click();
  await expect(page.locator('[data-reui-select="tw-category"] [role="combobox"]')).toContainText('Energy');
});

test('filter dropdown remains usable inside the native mobile sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=compact');
  await page.locator('#tw-filter-button').click();
  await expect(page.locator('#tw-tool-sheet')).toBeVisible();
  const category = page.locator('#tw-tool-sheet [data-reui-select="tw-category"] [role="combobox"]');
  await category.click();
  await expect(page.getByRole('option', { name: 'Energy', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Energy', exact: true }).click();
  await expect(category).toContainText('Energy');
  await page.locator('#tw-sheet-done').click();
  await expect(page.locator('#tw-mobile-list [role="listitem"]:visible')).toHaveCount(1);
  await page.locator('#tw-filter-button').click();
  await category.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tw-tool-sheet')).toBeVisible();
  await page.locator('#tw-sheet-done').click();
  await page.locator('#tw-filter-button').click();
  await category.click();
  await page.goBack();
  await expect(page.locator('#tw-tool-sheet')).toBeHidden();
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
  await page.locator('#bw-search-trigger').click();
  await expect(page.getByRole('combobox', { name: 'Search workspace', exact: true })).toBeFocused();
});

test('searchable saved views can select the second of two identically named views', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=compact');
  const ids = await page.evaluate(() => {
    const table = (window as any).BW.TableWorkspace;
    const duplicates: string[] = [];
    for (let index = 0; index < 13; index++) {
      table.saveView(index < 2 ? 'Energy' : 'View ' + index);
      if (index < 2) duplicates.push(table.views.at(-1).id);
    }
    return duplicates;
  });
  await page.locator('[data-reui-select="tw-view-select"] [role="combobox"]').click();
  const query = page.getByRole('combobox', { name: 'Find saved table view', exact: true });
  await query.fill('Energy');
  await expect(page.getByRole('option', { name: 'Energy', exact: true })).toHaveCount(2);
  await query.press('ArrowDown');
  await query.press('Enter');
  await expect(page.locator('#tw-view-select')).toHaveValue(ids[1]);
});

test('modified search links open their real destination without closing the original search', async ({ page }) => {
  await page.goto('/?view=compact');
  await page.locator('#bw-search-trigger').click();
  const link = page.locator('#bw-search-dialog a[href="/commodity/gold"]');
  const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
  const popupPromise = page.context().waitForEvent('page');
  await link.click({ modifiers: [modifier as 'Meta' | 'Control'] });
  const popup = await popupPromise;
  await popup.waitForURL('**/commodity/gold');
  await expect(page.locator('#bw-search-dialog')).toBeVisible();
  await popup.close();
});

test('library GET forms and longer searchable selectors preserve named values', async ({ page }) => {
  await page.goto('/data');
  await page.locator('[data-reui-select="source"] [role="combobox"]').click();
  await page.getByRole('option', { name: 'World Bank', exact: true }).click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/source=worldbank/);
  await expect(page.locator('[data-reui-select="source"] [role="combobox"]')).toContainText('World Bank');
  await page.goto('/references');
  const country = page.locator('[data-reui-select="country"] [role="combobox"]');
  await country.click();
  await expect(page.getByRole('dialog', { name: 'Find country / economy', exact: true })).toBeVisible();
  const pickerA11y = await new AxeBuilder({ page }).include('[data-slot="popover-content"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(pickerA11y.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  const search = page.getByRole('combobox', { name: 'Find country / economy', exact: true });
  await search.fill('United States');
  await page.getByRole('option', { name: 'United States', exact: true }).click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/country=US/);
});

test('reduced motion theme changes update open search colors immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=compact');
  await page.locator('#bw-search-trigger').click();
  for (const theme of ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft']) {
    const colors = await page.evaluate(value => {
      (window as any).setTheme(value);
      return ['.rui-search-result-name', '.rui-search-footer'].map(selector => {
        const element = document.querySelector(selector)!;
        const actual = getComputedStyle(element).color;
        const probe = document.createElement('span');
        probe.style.color = selector === '.rui-search-footer' ? 'var(--theme-text-muted)' : 'var(--theme-text)';
        element.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { selector, actual, expected };
      });
    }, theme);
    expect(colors.filter(item => item.actual !== item.expected), theme).toEqual([]);
  }
});

test('search and settings meet focused accessibility checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=compact');
  for (const trigger of ['#settings-button', '#bw-search-trigger']) {
    await page.locator(trigger).click();
    await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible();
    for (const theme of ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft']) {
      if (trigger === '#settings-button') {
        await page.locator('#theme-' + theme).click();
        await expect(page.locator('#theme-' + theme)).toHaveAttribute('aria-checked', 'true');
      }
      else await page.evaluate(value => (window as any).setTheme(value), theme);
      const results = await new AxeBuilder({ page }).include('[data-slot="dialog-content"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })), theme).toEqual([]);
    }
    await page.keyboard.press('Escape');
  }
});

test('native forms and original settings remain usable if the component bundle is unavailable', async ({ page }) => {
  await page.route('**/js/components/reui.js*', route => route.abort());
  await page.goto('/data');
  await expect(page.locator('select[name="source"]')).toBeVisible();
  await page.locator('select[name="source"]').selectOption('worldbank');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/source=worldbank/);
  await page.locator('#settings-button').click();
  await expect(page.getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
});


test('workspace search finds stocks, companies, currency pairs and saved country data', async ({ page }) => {
  await page.goto('/');
  await page.locator('#bw-search-trigger').click();
  const query = page.getByRole('combobox', { name: 'Search workspace', exact: true });
  await query.fill('Apple');
  await expect(page.locator('#bw-search-dialog a[href="/stocks/stock-XNAS-AAPL"]')).toBeVisible();
  await expect(page.locator('#bw-search-dialog a[href="/companies/320193"]')).toBeVisible();
  await query.fill('AAPL');
  await expect(page.locator('#bw-search-dialog a[href="/stocks/stock-XNAS-AAPL"]')).toBeVisible();
  await query.press('ArrowDown');
  await query.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/stock-XNAS-AAPL$/);
  await expect(page.getByRole('heading', { name: 'Apple', exact: true })).toBeVisible();
  await page.locator('#bw-search-trigger').click();
  await query.fill('USD/EUR');
  await expect(page.locator('#bw-search-dialog a[href="/exchange-rates/fx-USD-EUR"]')).toBeVisible();
  await query.fill('Sample North');
  await expect(page.locator('#bw-search-dialog a[href^="/data/worldbank_"]')).toBeVisible();
  await query.fill('Apple');
  await expect(page.locator('#bw-search-dialog a[href="/stocks/stock-XNAS-AAPL"]')).toBeVisible();
  const a11y = await new AxeBuilder({ page }).include('#bw-search-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map(item => item.id)).toEqual([]);
});

test('public search errors preserve local benchmark results and support retry', async ({ page }) => {
  await page.route('**/api/workspace-search?*', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/');
  await page.locator('#bw-search-trigger').click();
  const query = page.getByRole('combobox', { name: 'Search workspace', exact: true });
  await query.fill('gold');
  await expect(page.locator('#bw-search-dialog a[href="/commodity/gold"]')).toBeVisible();
  await expect(page.locator('#bw-search-dialog').getByRole('button', { name: /retry/i })).toBeVisible();
  await page.unroute('**/api/workspace-search?*');
  await query.fill('AAPL');
  await expect(page.locator('#bw-search-dialog a[href="/stocks/stock-XNAS-AAPL"]')).toBeVisible();
});


for (const width of [320,390,600]) {
  test(`benchmark controls group view/range/count above search at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844}); await page.goto('/?view=compact');
    const heading = (await page.locator('.tw-control-heading').boundingBox())!;
    const view = (await page.locator('[data-reui-select="tw-view-select"]').boundingBox())!;
    const range = (await page.locator('#tw-range-select').boundingBox())!;
    const search = (await page.locator('.tw-search').boundingBox())!;
    expect(Math.abs(view.y-range.y)).toBeLessThanOrEqual(1);
    expect(range.x).toBeGreaterThanOrEqual(view.x+view.width);
    expect(search.y).toBeGreaterThanOrEqual(heading.y+heading.height);
    expect((await page.locator('.tw-control-shell').boundingBox())!.height).toBeLessThanOrEqual(100);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await page.evaluate(()=> (window as any).BW.TableWorkspace.setCategory('energy'));
    await expect(page.getByRole('button',{name:'Remove Category filter: Energy',exact:true})).toBeVisible();
    expect((await page.locator('.tw-control-shell').boundingBox())!.height).toBeLessThanOrEqual(140);
    await page.getByRole('button',{name:'Remove Category filter: Energy',exact:true}).click();
    await expect(page.locator('#tw-filter-chips')).toBeHidden();
  });
}

test('short select menus separate checked state from a contained keyboard focus cue', async ({page}) => {
  await page.goto('/?view=compact'); await page.locator('#tw-filter-button').click();
  const trigger = page.locator('[data-reui-select="tw-frequency"] [role="combobox"]');
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  const menu = page.locator('[data-slot="select-content"]'); await expect(menu).toBeVisible();
  const states = await menu.locator('[data-slot="select-item"]').evaluateAll(items=>items.map(item=>{
    const style=getComputedStyle(item), rect=item.getBoundingClientRect();
    const indicator=item.querySelector('.cn-select-item-indicator')!.getBoundingClientRect();
    const text=item.querySelector('[data-slot="select-item-text"]')!.getBoundingClientRect();
    return {height:rect.height,inside:indicator.right<=rect.right,apart:text.right<=indicator.left,focus:style.outlineOffset};
  }));
  expect(states.every(state=>state.height>=32&&state.height<=36&&state.inside&&state.apart)).toBe(true);
  expect(states.some(state=>state.focus==='-1px')).toBe(true);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#tw-frequency')).toHaveValue('daily');
  await expect(trigger).toBeFocused();
  await expect(page.locator('#table-body tr:visible')).toHaveCount(3);
});
