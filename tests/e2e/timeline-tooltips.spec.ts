import { test, expect, type Page, type Locator } from '@playwright/test';

test.use({hasTouch:true});

const observations = [5.83,5.76,5.79,5.89,5.51,5.86,5.73,5.70,5.86,5.70,5.74,5.72,5.86].map((price,index) => ({date:new Date(Date.UTC(2025,7+index,1)).toISOString().slice(0,10),price}));

async function openHistory(page: Page, width: number, theme = 'ft') {
  await page.setViewportSize({width,height:900});
  await page.route('**/api/commodity/gold', route => route.fulfill({json:{data:{id:'gold',name:'Monthly sample',category:'agricultural',currency:'USD',unit:'bushel',frequency:'monthly',is_daily:false,price:5.86,date:'2026-08-01',history:observations,source_name:'Synthetic tooltip review data'}}}));
  await page.goto('/?view=compact&range=ALL');
  await page.addStyleTag({content:'*,:before,:after {transition:none!important;animation:none!important}'});
  await page.evaluate(theme => (window as any).setTheme(theme),theme);
  await page.locator('#table-body a[data-benchmark-id="gold"]:visible, #tw-mobile-list a[data-benchmark-id="gold"]:visible').click();
  await expect(page.locator('#benchmark-detail')).toBeVisible();
  const chart = page.locator('#benchmark-detail .benchmark-detail-plot');
  await expect(chart.locator('.bw-d3-point')).toHaveCount(13);
  await chart.scrollIntoViewIfNeeded();
  return chart;
}

async function pointPosition(chart: Locator, index: number) {
  return chart.evaluate((svg,index) => {
    const circle = svg.querySelectorAll<SVGCircleElement>('.bw-d3-point')[index];
    const point = new DOMPoint(circle.cx.baseVal.value,circle.cy.baseVal.value);
    const screen = point.matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return {x:screen.x,y:screen.y};
  },index);
}

async function expectPopupContained(chart: Locator) {
  const popup = chart.locator('.bw-d3-tooltip');
  await expect(popup).toHaveAttribute('visibility','visible');
  const problems = await chart.evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('.bw-d3-tooltip,.bw-d3-tooltip text')].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.left < bounds.left-1 || rect.right > bounds.right+1 || rect.top < bounds.top-1 || rect.bottom > bounds.bottom+1;
    }).map(node => ({text:node.textContent,rect:node.getBoundingClientRect().toJSON(),bounds:bounds.toJSON()}));
  });
  expect(problems).toEqual([]);
  const mergedValues = await popup.evaluate(group => [...group.querySelectorAll('text')].flatMap(line => {
    const parts = [...line.querySelectorAll('tspan')];
    return parts.slice(1).filter((part,index) => part.getBoundingClientRect().left - parts[index].getBoundingClientRect().right < 4).map(part => line.textContent);
  }));
  expect(mergedValues,'Inline dates and values need a visible reading gap').toEqual([]);
  const description = await chart.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  await expect(popup).toHaveAttribute('id',description!);
  return popup;
}

test('timeline hover anchors exact first and last observation dates and values; keyboard Escape keeps details open',async({page},testInfo) => {
  const chart = await openHistory(page,1440);
  const first = await pointPosition(chart,0), last = await pointPosition(chart,12);
  await page.mouse.move(first.x,first.y);
  let popup = await expectPopupContained(chart);
  await expect(popup).toContainText('Aug 1, 2025');
  await expect(popup).toContainText('5.83');
  await expect(popup).toContainText('USD / bushel');
  await chart.screenshot({path:testInfo.outputPath('timeline-first-desktop.png')});
  await page.mouse.move(last.x,last.y);
  popup = await expectPopupContained(chart);
  await expect(popup).toContainText('Aug 1, 2026');
  await expect(popup).toContainText('5.86');
  await chart.screenshot({path:testInfo.outputPath('timeline-last-desktop.png')});
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(popup).toContainText('5.83');
  await page.keyboard.press('ArrowRight');
  await expect(popup).toContainText('Sep 1, 2025');
  await expect(popup).toContainText('5.76');
  await page.keyboard.press('End');
  await expect(popup).toContainText('Aug 1, 2026');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveAttribute('visibility','hidden');
  await expect(chart).not.toHaveAttribute('aria-describedby',/.+/);
  await expect(page.locator('#benchmark-detail')).toBeVisible();
});

for (const theme of ['ft','dark']) {
  test(`320px ${theme} timeline taps keep popups inside the chart with actual dates`,async({page},testInfo) => {
    const chart = await openHistory(page,320,theme);
    const first = await pointPosition(chart,0), last = await pointPosition(chart,12);
    await page.touchscreen.tap(first.x,first.y);
    let popup = await expectPopupContained(chart);
    await expect(popup).toContainText('Aug 1, 2025');
    await expect(popup).toContainText('5.83');
    await chart.screenshot({path:testInfo.outputPath(`timeline-first-320-${theme}.png`)});
    await page.touchscreen.tap(last.x,last.y);
    popup = await expectPopupContained(chart);
    await expect(popup).toContainText('Aug 1, 2026');
    await expect(popup).toContainText('5.86');
    const colors = await popup.evaluate(group => ({surface:getComputedStyle(group.querySelector('rect')!).fill,text:getComputedStyle(group.querySelector('text')!).fill}));
    expect(colors.surface).not.toBe(colors.text);
    expect(await page.locator('#benchmark-detail').evaluate(el => el.scrollWidth <= el.clientWidth+1)).toBe(true);
    await chart.screenshot({path:testInfo.outputPath(`timeline-last-320-${theme}.png`)});
    await chart.focus();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveAttribute('visibility','hidden');
    await expect(page.locator('#benchmark-detail')).toBeVisible();
  });
}

async function renderSharedScenario(page: Page, series: any[], width = 280, height = 230) {
  await page.setViewportSize({width:320,height:900});
  await page.goto('/?view=compact&range=ALL');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).BW?.Visuals))).toBe(true);
  await page.evaluate(({series,width,height}) => {
    const host = document.createElement('section'); host.id = 'tooltip-review-scenario'; host.style.cssText = `width:${width}px;margin:16px auto;background:var(--theme-surface)`;
    document.getElementById('main-content')!.prepend(host);
    (window as any).BW.Visuals.timeSeries(host,series,{width,height,finance:true,yAxisPosition:'right',label:'Synthetic public timeline tooltip regression'});
  },{series,width,height});
  const chart = page.locator('#tooltip-review-scenario svg');
  await chart.scrollIntoViewIfNeeded();
  await chart.focus(); await page.keyboard.press('Home');
  return chart;
}

test('fiscal period popup retains its actual end date and unscaled source precision',async({page},testInfo) => {
  const chart = await renderSharedScenario(page,[{name:'Gross margin',unit:'%',points:[{date:'2026-07-26',period:'TTM Q2 2027',value:74.712345},{date:'2026-10-25',period:'TTM Q3 2027',value:75.1}]}]);
  const popup = await expectPopupContained(chart);
  await expect(popup).toContainText('Jul 26, 2026');
  await expect(popup).toContainText('TTM Q2 2027');
  await expect(popup).toContainText('74.712345%');
  await chart.screenshot({path:testInfo.outputPath('timeline-fiscal-actual-date.png')});
});

test('multiple-unit timelines inspect each line inside a phone plot; one arrow advances one actual date',async({page},testInfo) => {
  const series = [
    {name:'Gold',unit:'USD / troy oz',points:[{date:'2026-07-01',value:4218.7},{date:'2026-08-01',value:4300}]},
    {name:'Copper',unit:'USD / metric ton',points:[{date:'2026-07-01',value:13542.82},{date:'2026-08-01',value:14000}]},
    {name:'Brent crude oil',unit:'USD / barrel',points:[{date:'2026-07-01',value:83.73},{date:'2026-08-01',value:85}]},
    {name:'Natural gas',unit:'USD / million British thermal units',points:[{date:'2026-07-01',value:2.96},{date:'2026-08-01',value:3.1}]},
  ];
  const chart = await renderSharedScenario(page,series);
  let popup = await expectPopupContained(chart);
  for (const value of ['Jul 1, 2026','Gold','4,218.7','troy oz']) await expect(popup).toContainText(value);
  for (const values of [['Copper','13,542.82','metric ton'],['Brent crude oil','83.73','barrel'],['Natural gas','2.96','British thermal units']]) {
    await page.keyboard.press('ArrowDown');
    popup = await expectPopupContained(chart);
    for (const value of values) await expect(popup).toContainText(value);
    await expect(popup).toContainText('Jul 1, 2026');
  }
  await chart.screenshot({path:testInfo.outputPath('timeline-multiple-units-first.png')});
  await page.keyboard.press('ArrowUp');
  await expect(popup).toContainText('Brent crude oil');
  await page.keyboard.press('ArrowRight');
  popup = await expectPopupContained(chart);
  await expect(popup).toContainText('Aug 1, 2026');
});

test('long unit tokens and large source values stay inside the popup surface',async({page},testInfo) => {
  const chart = await renderSharedScenario(page,[{name:'Series',unit:'unit_identifier_without_any_breaking_spaces_012345678901234567890',points:[{date:'2026-07-01',value:987654321987654321987654321},{date:'2026-08-01',value:999999999999999999999999999}]}]);
  await expectPopupContained(chart);
  await chart.screenshot({path:testInfo.outputPath('timeline-long-unit-large-value.png')});
});
