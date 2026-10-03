import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('all D3 explorer views, keyboard inspection, range, export and responsive layout', async({page}, testInfo) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  const scripts:string[]=[];page.on('request',r=>{if(r.resourceType()==='script') scripts.push(r.url());});
  await page.goto('/commodity/gold');
  await expect(page.locator('#chart-skeleton')).toHaveCount(0);
  await expect(page.locator('#priceChart svg')).toBeVisible();
  await page.locator('#priceChart svg').press('Home');
  await expect(page.locator('#crosshair-price')).toContainText('2,000');
  await page.getByRole('button',{name:'1M',exact:true}).click();
  await expect(page.locator('#stat-points')).not.toHaveText('120');
  const lab=page.getByRole('region',{name:'Visual explorer'});
  for(const type of ['line','area','step','bar','scatter','change','histogram','cumulative','box','monthly','heatmap','coverage']) {
    await lab.getByLabel('Visualization',{exact:true}).selectOption(type);
    await expect(lab.locator('svg')).toBeVisible();
    expect(await lab.locator('svg').innerHTML()).not.toMatch(/NaN|Infinity/);
    await expect(lab.locator('table')).toHaveCount(1);
  }
  const download=page.waitForEvent('download');await lab.getByRole('button',{name:'Download PNG'}).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.screenshot({path:testInfo.outputPath('d3-detail.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const axe=await new AxeBuilder({page}).include('.bw-visual-lab').analyze();expect(axe.violations).toEqual([]);
  expect(scripts.some(s=>/chart\.umd|chartjs/.test(s))).toBe(false);
  expect(errors).toEqual([]);
});
test('dashboard D3 sparklines, explorer fetch, comparison and themes',async({page},testInfo)=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?view=compact');
  await page.addStyleTag({content:'*,:before,:after{transition:none!important;animation:none!important}'});
  await expect(page.locator('#sparkline-gold path').first()).toBeAttached();
  await expect(page.locator('#market-pulse-categories .bw-d3-distribution').first()).toBeAttached();
  expect(await page.locator('#market-pulse-categories .bw-d3-segment').count()).toBeGreaterThan(0);
  await page.locator('#bw-visual-explorer>summary').click();
  const lab=page.getByRole('region',{name:'Visual explorer'});
  await expect(lab.locator('.bw-visual-note')).toContainText('120 usable');
  await lab.getByLabel('Benchmark',{exact:true}).selectOption('oil');
  await expect(lab.locator('.bw-visual-note')).toContainText('USD / test unit');
  await lab.getByLabel('Visualization',{exact:true}).selectOption('monthly');
  await expect(lab.locator('.bw-d3-bar')).toHaveCount(5);
  await lab.getByLabel('Benchmark',{exact:true}).selectOption('__catalog__');
  await expect(lab.locator('.bw-visual-note')).toContainText('3 benchmarks');
  for (const type of ['ranking','map','categories','dates']) {
    await lab.getByLabel('Visualization',{exact:true}).selectOption(type);
    await expect(lab.locator('svg')).toBeVisible();
    expect(await lab.locator('svg').innerHTML()).not.toMatch(/NaN|Infinity/);
  }
  await page.getByRole('button',{name:'Toggle light and dark mode'}).click();
  await expect(lab.locator('svg')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('d3-dashboard-dark.png'),fullPage:true});
  await page.locator('#table-body a[data-benchmark-id="gold"]:visible, #tw-mobile-list a[data-benchmark-id="gold"]:visible').click();
  await expect(page.locator('.benchmark-detail-plot')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reference history keeps consistent sizing and synchronized inspection on desktop and touch', async ({page},testInfo) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const values=[5.83,5.76,5.79,5.89,5.51,5.86,5.73,5.70,5.86,5.70,5.74,5.72,5.86];
  const history=values.map((price,i)=>({date:new Date(Date.UTC(2025,7+i,1)).toISOString().slice(0,10),price}));
  await page.route('**/api/commodity/gold',route=>route.fulfill({json:{data:{id:'gold',name:'Monthly sample',category:'Agriculture',currency:'USD',unit:'bushel',frequency:'monthly',is_daily:false,price:5.86,date:'2026-08-01',history,source_name:'Synthetic review data'}}}));
  await page.goto('/?view=compact');
  await page.locator('#table-body a[data-benchmark-id="gold"]:visible, #tw-mobile-list a[data-benchmark-id="gold"]:visible').click();
  const panel=page.locator('#benchmark-detail'), chart=panel.locator('.benchmark-detail-plot');
  const readout=panel.locator('.benchmark-detail-readout'), slider=panel.getByLabel('Explore an observation');
  await expect(readout).toContainText('Latest');
  await chart.press('Home');await expect(slider).toHaveValue('0');await expect(readout).toContainText('5.83');
  await slider.press('ArrowRight');await expect(readout).toContainText('5.76');
  await expect(panel.locator('.benchmark-detail-range-change')).toContainText('-0.07');
  if(testInfo.project.name==='desktop') {
    await page.getByRole('separator',{name:'Resize benchmark details'}).press('End');
    await expect.poll(()=>chart.evaluate(svg=>Math.abs(svg.getBoundingClientRect().width-(svg as SVGSVGElement).viewBox.baseVal.width))).toBeLessThan(2);
    expect((await chart.boundingBox())!.height).toBeLessThanOrEqual(275);
    await expect(readout).toContainText('5.76');
    await chart.hover({position:{x:350,y:100}});await expect(readout).toContainText('Selected');
    await page.mouse.move(0,0);await expect(readout).toContainText('Latest');
  } else {
    await chart.tap();await expect(readout).toContainText('Selected');
  }
  await panel.getByRole('button',{name:'1Y',exact:true}).click();
  // Capture the complete section, including the exact-value table disclosure.
  await panel.locator('#benchmark-detail-history').screenshot({path:testInfo.outputPath('reference-history.png')});
  expect(await panel.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
  await panel.getByRole('button',{name:'Custom',exact:true}).click();
  await panel.getByLabel('From',{exact:true}).fill('2026-01-01');
  await panel.getByLabel('To',{exact:true}).fill('2026-08-01');
  await panel.getByRole('button',{name:'Apply dates'}).click();
  await expect(panel.locator('.benchmark-detail-chart-extent')).toContainText('8 observations');
  await panel.getByLabel('Chart type',{exact:true}).selectOption('area');
  await expect(panel.locator('.benchmark-detail-area')).toHaveCount(1);
  await panel.locator('#benchmark-chart-settings>summary').click();
  await chart.press('End');
  await expect(readout).toContainText('5.86');
  const axe=await new AxeBuilder({page}).include('#benchmark-detail-history').analyze();expect(axe.violations).toEqual([]);
  await panel.getByRole('button',{name:'Close benchmark details'}).click();
  await page.getByRole('button',{name:'Toggle light and dark mode'}).click();
  await page.locator('#table-body a[data-benchmark-id="gold"]:visible, #tw-mobile-list a[data-benchmark-id="gold"]:visible').click();
  await panel.locator('#benchmark-detail-history').screenshot({path:testInfo.outputPath('reference-history-dark.png')});
  expect(errors).toEqual([]);
});
