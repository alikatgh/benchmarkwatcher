import { test, expect, type Page } from '@playwright/test';

async function openDashboard(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto('/?view=compact&range=6M');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).BW?.TableWorkspace?.ready))).toBe(true);
  // Representative long public labels and large values exercise the same renderer
  // without depending on production data, external feeds, or private workbooks.
  await page.evaluate(() => {
    const workspace = (window as any).BW.Workspace;
    workspace.catalog = [
      { id: 'crude_oil_brent', name: 'Crude Oil (Brent, FRED)', price: 83.73, currency: 'USD', unit: 'barrel', date: '2026-07-01' },
      { id: 'gold', name: 'Gold', price: 4218.7, currency: 'USD', unit: 'troy oz', date: '2026-10-02' },
      { id: 'copper', name: 'Copper (Global benchmark)', price: 13542.82, currency: 'USD', unit: 'metric ton', date: '2026-07-01' },
    ];
    workspace.renderOverview();
    (window as any).BW.TableWorkspace.setControlsCollapsed(false, true);
  });
}

async function expectContainedControls(page: Page) {
  const problems = await page.locator('.tw-control-heading .tw-button, .tw-view-picker select, .tw-search, .tw-tools .tw-button, #tw-range-select, .tw-context .range-btn, #tw-visual-actions button').evaluateAll(elements => {
    const visible = elements.filter(el => el.getClientRects().length);
    const issues: string[] = [];
    visible.forEach(el => {
      const rect = el.getBoundingClientRect();
      const container = el.closest('.tw-control-shell')!.getBoundingClientRect();
      if (rect.left < container.left - 1 || rect.right > container.right + 1 || el.scrollWidth > el.clientWidth + 1) issues.push(`${el.id}: clipped`);
      if (container.width <= 767 && (rect.height < 44 || rect.width < 44)) issues.push(`${el.id || el.className}: small touch target`);
    });
    visible.forEach((a, index) => visible.slice(index + 1).forEach(b => {
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) issues.push(`${a.id}/${b.id}: overlap`);
    }));
    return issues;
  });
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function expectConsistentControls(page: Page) {
  const geometry = await page.evaluate(() => {
    const selectors = ['#tw-view-select', '#tw-more-button', '.tw-search', '#tw-filter-button', '#tw-visual-actions button', '#tw-range-select', '#tw-filter-chips .tw-chip'];
    return selectors.map(selector => {
      const element = document.querySelector(selector)!;
      const style = getComputedStyle(element);
      const text = getComputedStyle(selector === '.tw-search' ? element.querySelector('input')! : element);
      return {selector, height: element.getBoundingClientRect().height, radius: style.borderRadius, font: text.fontSize, weight: text.fontWeight, line: text.lineHeight, border: style.borderTopWidth};
    }).filter(item => item.height > 0);
  });
  expect(geometry.map(item => item.height)).toEqual(geometry.map(() => 44));
  expect(new Set(geometry.map(item => item.radius)).size).toBe(1);
  expect(geometry.map(item => item.font)).toEqual(geometry.map(() => '16px'));
  expect(geometry.map(item => item.weight)).toEqual(geometry.map(() => '400'));
  expect(geometry.map(item => item.line)).toEqual(geometry.map(() => '20px'));
  expect(geometry.map(item => item.border)).toEqual(geometry.map(() => '1px'));
  await expect(page.locator('#tw-filter-count')).toBeHidden();
  const textStyles = await page.locator('#tw-compact-count, .tw-chip-label, #tw-filter-chips .tw-button').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element); return [style.fontSize, style.fontWeight, style.lineHeight];
  }));
  for (const style of textStyles) expect(style).toEqual(['16px', '400', '20px']);
  const chevrons = await page.locator('.tw-view-picker, .tw-range-picker').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element, '::after'); return [style.width, style.height, style.right];
  }));
  expect(chevrons).toEqual([['16px', '16px', '12px'], ['16px', '16px', '12px']]);

  // Reserve the live catalog's wider count, which the three-row fixture cannot expose.
  const viewLabelSpace = await page.evaluate(() => {
    const select = document.querySelector('#tw-view-select') as HTMLSelectElement;
    const count = document.querySelector('#tw-compact-count')!;
    const style = getComputedStyle(select);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = style.font;
    const labelWidth = context.measureText(select.selectedOptions[0].textContent!).width;
    const originalCount = count.textContent;
    count.textContent = '17/93';
    const available = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    count.textContent = originalCount;
    return available - labelWidth;
  });
  expect(viewLabelSpace).toBeGreaterThanOrEqual(0);

  const gaps = await page.locator('.tw-toolbar, .tw-data-controls, .tw-chip-items').evaluateAll(elements => elements.map(element => getComputedStyle(element).columnGap));
  expect(new Set(gaps).size).toBe(1);
}

async function moreCommand(page: Page, command: string) {
  await page.locator('#tw-more-button').click();
  await page.locator(`#tw-more-menu [data-tw-command="${command}"]`).click();
}

async function expectCompactHierarchy(page: Page) {
  await expect(page.locator('#tw-view-select')).toBeVisible();
  await expect(page.locator('#tw-new-view')).toBeHidden();
  await expect(page.locator('#tw-sort-button')).toBeHidden();
  await expect(page.locator('#tw-range-select')).toBeVisible();
  await expect(page.locator('#tw-range-select')).toHaveAccessibleName('Observation range');
  await expect(page.locator('.tw-context .range-tabs')).toBeHidden();
  await expect(page.locator('#tw-compact-count')).toBeVisible();
  expect(await page.locator('.tw-control-shell').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(168);
  const distance = await page.evaluate(() => {
    const root = document.getElementById('table-workspace')!.getBoundingClientRect();
    const rows = document.querySelector('#tw-mobile-list .tw-mobile-row') || document.querySelector('.tw-table-region');
    return rows!.getBoundingClientRect().top - root.top;
  });
  expect(distance).toBeLessThanOrEqual(240);
}

for (const width of [320, 390]) {
  test(`phone dashboard keeps full reference values and every control usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openDashboard(page);
    const firstValue = await page.locator('#tw-mobile-list .tw-mobile-price').first().boundingBox();
    expect(firstValue!.y + firstValue!.height).toBeLessThanOrEqual(844);
    const navigationIssues = await page.locator('.bw-destinations a').evaluateAll(links => links.filter(link => {
      const rect = link.getBoundingClientRect();
      return rect.left < 0 || rect.right > innerWidth + 1 || link.scrollWidth > link.clientWidth + 1 || rect.height < 44;
    }).map(link => link.textContent?.trim()));
    expect(navigationIssues).toEqual([]);
    await page.locator('.bw-destinations').screenshot({ path: testInfo.outputPath(`dashboard-navigation-${width}.png`) });
    const overview = page.locator('#bw-overview');
    await expect(overview).toBeHidden();
    await page.locator('#bw-featured summary').click();
    await expect(overview).toBeVisible();
    await expect(overview.locator('.bw-observation')).toHaveCount(3);
    const overviewIssues = await overview.evaluate(el => [...el.querySelectorAll('.bw-observation, .bw-observation-heading span:first-child, .bw-observation-value strong')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className || node.textContent));
    expect(overviewIssues).toEqual([]);
    await expect(overview.locator('.bw-observation').nth(2)).toContainText('13,542.82');
    await expectCompactHierarchy(page);
    await expect(page.locator('#tw-mobile-list .tw-mobile-row')).toHaveCount(3);
    await expect(page.locator('#tw-mobile-list .tw-mobile-meta').first()).toContainText('Observed');
    await expect(page.locator('#tw-mobile-list .tw-mobile-price small').first()).toContainText('USD /');
    await expectContainedControls(page);
    await overview.screenshot({ path: testInfo.outputPath(`dashboard-overview-${width}.png`) });
    await page.locator('#bw-featured summary').click();
    await page.locator('.tw-control-shell').screenshot({ path: testInfo.outputPath(`dashboard-controls-${width}.png`) });

    await page.locator('#tw-filter-button').click();
    await expect(page.locator('#tw-tool-sheet')).toHaveAttribute('open', '');
    await expect(page.locator('#tw-sheet-heading')).toBeFocused();
    await page.locator('#tw-category').selectOption('precious');
    await expect(page.locator('#tw-filter-count')).toHaveText('(1)');
    await expect(page.locator('#tw-sheet-done')).toHaveText('Show 1 result');
    await page.locator('#tw-tool-sheet').screenshot({path:testInfo.outputPath(`dashboard-filter-sheet-${width}.png`)});
    await page.goBack();
    await expect(page.locator('#tw-tool-sheet')).toBeHidden();
    await expect(page.locator('#tw-filter-button')).toBeFocused();
    await expect(page.locator('#tw-mobile-list .tw-mobile-row')).toHaveCount(1);
    await expect(page).toHaveURL(/category=precious/);
    await expectCompactHierarchy(page);
    await page.locator('#table-workspace').screenshot({ path: testInfo.outputPath(`dashboard-filtered-${width}.png`) });
    await page.locator('#tw-range-select').selectOption('ALL');
    await expect(page.locator('#tw-range-select')).toHaveValue('ALL');
    await expect(page.locator('#range-ALL')).toHaveAttribute('aria-pressed', 'true');
    await expectContainedControls(page);
    await expect(page.locator('#data-table')).toHaveAttribute('aria-busy', 'false');
    expect(await page.locator('#tw-mobile-list .tw-mobile-change').evaluateAll(elements => elements.every(element => /^[+-]?\d+(?:\.\d+)?%$|^—$/.test(element.textContent!.trim())))).toBe(true);
    await expect(page.locator('#tw-filter-chips').getByRole('button', { name: 'Clear all view filters' })).toHaveCount(0);
    await page.locator('#tw-filter-chips').getByRole('button', { name: /^Remove Category filter:/ }).click();

    await moreCommand(page, 'sort');
    await page.locator('#tw-sort-rules select').first().selectOption('price');
    await page.locator('#tw-sort-rules select').nth(1).selectOption('desc');
    await page.locator('#tw-sheet-done').click();
    await expect(page.locator('#tw-tool-sheet')).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.historyClosing)).toBe(false);
    const prices = await page.locator('#tw-mobile-list .tw-mobile-row').evaluateAll(rows => rows.map(row => Number(document.querySelector(`#table-body tr[data-id="${(row as HTMLElement).dataset.mobileId}"]`)!.getAttribute('data-price'))));
    expect(prices).toEqual([...prices].sort((a,b) => b-a));

    await moreCommand(page, 'new-view');
    const longName = 'Precious metals and monthly observations source review';
    await page.locator('#tw-view-name').fill(longName);
    await page.locator('#tw-view-submit').click();
    await expect(page.locator('#tw-view-menu')).toBeHidden();
    await expect(page.locator('#tw-view-select option:checked')).toHaveText(longName);
    await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.historyClosing)).toBe(false);
    await moreCommand(page, 'view-settings');
    await expect(page.locator('#tw-view-name')).toHaveValue(longName);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tw-view-menu')).toBeHidden();
    await expect(page.locator('#tw-more-button')).toBeFocused();
    await page.reload();
    await expect(page.locator('#tw-view-select option:checked')).toHaveText(longName);
    await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.current.sorts[0])).toEqual({key:'price',direction:'desc'});
    await expect(page.locator('#tw-controls')).toBeVisible();
    await expectContainedControls(page);
    await page.locator('#table-workspace').screenshot({ path: testInfo.outputPath(`dashboard-toolbar-${width}.png`) });
  });
}

for (const width of [320, 390, 600]) {
  test(`compact toolbar keeps three usable rows with one filter at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openDashboard(page);
    await expectCompactHierarchy(page);
    await expect(page.locator('#tw-range-select')).toHaveValue('6M');
    expect(await page.locator('#tw-range-select option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['1W', '1M', '3M', '6M', '1Y', 'ALL']);
    await expect(page.locator('#tw-compact-count')).toHaveText('3/3');
    await expect(page.locator('#tw-compact-count')).toHaveAccessibleName('3 of 3 benchmarks');
    await expect(page.locator('#tw-more-button')).toHaveAccessibleName('More view options');

    await page.locator('#tw-filter-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tw-sheet-heading')).toBeFocused();
    await page.locator('#tw-category').selectOption('precious');
    await page.locator('#tw-sheet-done').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tw-tool-sheet')).toBeHidden();
    await expect(page.locator('#tw-filter-button')).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.historyClosing)).toBe(false);
    await expect(page.locator('#tw-filter-button')).toHaveAccessibleName('Filter, 1 active filter');
    await expect(page.locator('#tw-filter-count')).toHaveText('(1)');
    await expect(page.locator('#tw-compact-count')).toHaveText('1/3');
    await expect(page.locator('#tw-compact-count')).toHaveAccessibleName('1 of 3 benchmarks');
    await expect(page.locator('#tw-filter-chips').getByRole('button', { name: 'Clear all view filters' })).toHaveCount(0);
    await expectCompactHierarchy(page);
    await expectContainedControls(page);
    await expectConsistentControls(page);
    const rows = await page.evaluate(() => {
      const center = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      return [
        ['#tw-view-select', '#tw-compact-count', '#tw-more-button'].map(center),
        ['.tw-search', '#tw-filter-button', '#tw-visual-actions button'].map(center),
        ['#tw-range-select', '#tw-filter-chips .tw-chip'].map(center),
      ];
    });
    for (const row of rows) expect(Math.max(...row) - Math.min(...row)).toBeLessThanOrEqual(1);
    expect(rows[0][0]).toBeLessThan(rows[1][0]);
    expect(rows[1][0]).toBeLessThan(rows[2][0]);
    await page.locator('.tw-control-shell').screenshot({ path: testInfo.outputPath(`compact-toolbar-filtered-${width}.png`) });
  });
}

test('compact range changes keep data, URL and desktop range buttons together after resize and a failed request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  await expect(page.locator('#tw-range-select')).toHaveValue('6M');
  await page.locator('#tw-range-select').selectOption('1M');
  await expect.poll(() => page.evaluate(() => (window as any).BW.CompactTable.loadedRange)).toBe('1M');
  await expect(page).toHaveURL(/range=1M/);
  await expect(page.locator('#tw-range-select')).toHaveValue('1M');
  await expect(page.locator('#range-1M')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#tw-query').fill('Gold');
  await page.locator('#tw-mobile-list input[aria-label="Select Gold"]').check();
  const observations = await page.locator('#table-body tr[data-id]').evaluateAll(rows => rows.map(row => ({ ...((row as HTMLElement).dataset) })));
  await page.route('**/api/commodities?*', route => new URL(route.request().url()).searchParams.get('range') === '3M' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
  await page.locator('#tw-range-select').selectOption('3M');
  await expect(page.locator('#tw-range-error')).toContainText('Previous observations are still shown');
  await expect(page.locator('#data-table')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#tw-range-select')).toHaveValue('1M');
  await expect(page.locator('#range-1M')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#range-3M')).toHaveAttribute('aria-pressed', 'false');
  await expect(page).toHaveURL(/range=1M/);
  expect(await page.locator('#table-body tr[data-id]').evaluateAll(rows => rows.map(row => ({ ...((row as HTMLElement).dataset) })))).toEqual(observations);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#tw-range-select')).toBeHidden();
  await expect(page.locator('#range-1M')).toBeVisible();
  await expect(page.locator('#tw-query')).toHaveValue('Gold');
  await expect(page.locator('#table-body input[aria-label="Select Gold"]')).toBeChecked();
  await expect(page.locator('#tw-result-count')).toHaveText('1 of 3 benchmarks');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#tw-range-select')).toHaveValue('1M');
  await expect(page.locator('#tw-query')).toHaveValue('Gold');
  await expect(page.locator('#tw-mobile-list input[aria-label="Select Gold"]')).toBeChecked();
  await expect(page.locator('#tw-compact-count')).toHaveText('1/3');
});

test('multiple compact filter chips scroll inside their row and remain removable by keyboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openDashboard(page);
  await page.locator('#tw-query').fill('Gold');
  await page.locator('#tw-filter-button').click();
  await page.locator('#tw-category').selectOption('precious');
  await page.locator('#tw-frequency').selectOption('daily');
  await page.locator('#tw-availability').selectOption('available');
  await page.locator('#tw-sheet-done').click();
  await expect(page.locator('#tw-tool-sheet')).toBeHidden();
  const strip = page.locator('#tw-filter-chips .tw-chip-items');
  expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expectCompactHierarchy(page);
  await expectContainedControls(page);
  const category = strip.getByRole('button', { name: /^Remove Category filter:/ });
  await category.focus();
  await page.keyboard.press('Enter');
  await expect(category).toHaveCount(0);
  await expect(page.locator('#tw-filter-count')).toHaveText('(2)');
  const clear = strip.getByRole('button', { name: 'Clear all view filters' });
  await expectConsistentControls(page);
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tw-filter-count')).toHaveText('');
  await expect(page.locator('#tw-query')).toHaveValue('');
  await expect(page.locator('#tw-filter-chips')).toBeHidden();
  await expect(page.locator('#tw-compact-count')).toHaveText('3/3');
  await page.locator('.tw-control-shell').screenshot({ path: testInfo.outputPath('compact-toolbar-cleared-320.png') });
});

test('desktop dashboard retains the overview strip and horizontal toolbar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDashboard(page);
  const cards = await page.locator('.bw-observation').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  expect(new Set(cards).size).toBe(1);
  const tools = await page.locator('.tw-tools .tw-button').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  expect(new Set(tools).size).toBe(1);
  await expect(page.locator('#tw-range-select')).toBeHidden();
  await expect(page.locator('.tw-context .range-tabs')).toBeVisible();
  await expect(page.locator('#tw-compact-count')).toBeHidden();
  await expectContainedControls(page);
  await page.locator('#benchmark-workspace').screenshot({ path: testInfo.outputPath('dashboard-desktop.png') });
});

test('a widened desktop details pane adapts the remaining dashboard by container width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDashboard(page);
  await page.locator('#table-body .commodity-name').first().click();
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  const resize = page.locator('#benchmark-detail-resize');
  await resize.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('#benchmark-detail').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(590);
  // Wait for the shared shell's padding transition before inspecting the final
  // content width; the pane itself reaches its width before that transition ends.
  await expect.poll(() => page.locator('#table-workspace').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(598);
  await expect.poll(() => page.locator('#table-workspace').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(605);
  await page.evaluate(() => (window as any).BW.TableWorkspace.setControlsCollapsed(false, true));
  await expectContainedControls(page);
  const remainingWidth = await page.locator('#table-workspace').evaluate(el => el.getBoundingClientRect().width);
  expect(remainingWidth).toBeLessThanOrEqual(605);
  await expectCompactHierarchy(page);
  await page.locator('#tw-query').fill('Gold');
  await expectConsistentControls(page);
  await page.locator('#tw-filter-button').click();
  const modal = await page.locator('#tw-tool-sheet').boundingBox();
  expect(modal?.x).toBeGreaterThan(400);
  expect(modal!.y + modal!.height).toBeLessThan(980);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tw-tool-sheet')).toBeHidden();
  const cardTops = await page.locator('.bw-observation').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  expect(new Set(cardTops).size).toBe(1);
  const overviewIssues = await page.locator('#bw-overview').evaluate(el => [...el.querySelectorAll('.bw-observation, .bw-observation-heading span:first-child, .bw-observation-value strong')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className || node.textContent));
  expect(overviewIssues).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop-wide-detail.png'), fullPage: true });
  await page.locator('#benchmark-detail [data-detail-action="close"]').click();
  await expect(page.locator('#benchmark-detail')).toBeHidden();
  await expect.poll(() => page.locator('#table-workspace').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(1000);
  await expect(page.locator('#tw-query')).toHaveValue('Gold');
  const restoredTops = await page.locator('.bw-observation').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  expect(new Set(restoredTops).size).toBe(1);
});

test('320px controls and long source labels remain usable with enlarged text', async ({page}, testInfo) => {
  await page.setViewportSize({width:320,height:844});
  await openDashboard(page);
  await page.evaluate(() => {
    const row = document.querySelector('#table-body tr[data-id]') as HTMLElement;
    row.dataset.name = 'Natural Gas (Henry Hub, Monthly public benchmark observations)';
    row.dataset.unit = 'million metric British thermal units';
    (window as any).BW.TableWorkspace.refresh();
  });
  await page.addStyleTag({content:'html {font-size:32px!important}'});
  await expectContainedControls(page);
  const rowIssues = await page.locator('#tw-mobile-list .tw-mobile-row').evaluateAll(rows => rows.flatMap(row => [...row.querySelectorAll('.tw-mobile-name,.tw-mobile-price,.tw-mobile-meta')].filter(el => el.scrollWidth > el.clientWidth+1).map(el => el.className)));
  expect(rowIssues).toEqual([]);
  await page.locator('#tw-filter-button').click();
  await expect(page.locator('#tw-sheet-heading')).toBeFocused();
  for (let index=0;index<10;index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('tw-tool-sheet')!.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#tw-filter-button')).toBeFocused();
  await page.locator('#table-workspace').screenshot({path:testInfo.outputPath('dashboard-enlarged-text-320.png')});
});

test('phone sheets close on resize without losing filters and a rapid detail opening survives sheet Back', async ({page},testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await openDashboard(page);
  await page.locator('#tw-filter-button').click();
  await page.locator('#tw-category').selectOption('precious');
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.locator('#tw-tool-sheet')).toBeHidden();
  await expect(page.locator('#tw-filters')).toBeHidden();
  await expect(page.locator('#tw-filter-count')).toHaveText('(1)');
  await expect(page.locator('#tw-filter-button')).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.historyClosing)).toBe(false);
  await page.setViewportSize({width:390,height:844});
  await moreCommand(page,'sort');
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.locator('#tw-tool-sheet')).toBeHidden();
  await expect(page.locator('#tw-sort-button')).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.historyClosing)).toBe(false);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#tw-filter-button').click();
  await page.evaluate(() => {
    document.getElementById('tw-sheet-done')!.click();
    (document.querySelector('#tw-mobile-list a[data-benchmark-id]') as HTMLAnchorElement)!.click();
  });
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).BW.TableWorkspace.historyClosing)).toBe(false);
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  await page.locator('#benchmark-detail [data-detail-action="close"]').click();
  await expect(page.locator('#tw-mobile-list .tw-mobile-row')).toHaveCount(1);
  await page.locator('#table-workspace').screenshot({path:testInfo.outputPath('dashboard-resize-return-390.png')});
});
