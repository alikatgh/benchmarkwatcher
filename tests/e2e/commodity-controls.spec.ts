import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function load(page) {
  await page.goto('/commodity/gold');
  await expect(page.locator('#chart-skeleton')).toHaveCount(0);
  await expect(page.locator('#priceChart svg')).toBeVisible();
}

async function choose(lab, value: string) {
  await lab.getByRole('button', {name: /^Visualization:/}).click();
  await lab.locator(`.bw-visual-options input[value="${value}"]`).click();
  await expect(lab.getByRole('button', {name: /^Visualization:/})).toHaveAttribute('aria-expanded', 'false');
}

test('desktop quote and source stay left while native plot/value segments change the D3 chart', async ({page}, info) => {
  await page.setViewportSize({width:1440,height:1000});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await load(page);
  const summary = (await page.locator('.commodity-summary').boundingBox())!, chart = (await page.locator('.chart-panel').boundingBox())!;
  expect(summary.x + summary.width).toBeLessThan(chart.x);
  expect(Math.abs(summary.y - chart.y)).toBeLessThan(2);
  for (const [label, value] of [['Area','area'],['Step','step'],['Bars','bar'],['Dots','scatter'],['Line','line']]) {
    await page.getByRole('group', {name:'Plot', exact:true}).getByRole('radio',{name:label,exact:true}).check();
    await expect.poll(() => page.evaluate(() => (window as any).BW.Commodity.currentChartType)).toBe(value);
    expect(await page.locator('#priceChart svg').innerHTML()).not.toMatch(/NaN|Infinity/);
  }
  await page.getByRole('radio',{name:'Line',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio',{name:'Area',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:'% change',exact:true}).check();
  await page.locator('#priceChart svg').press('Home');
  await expect(page.locator('#crosshair-price')).toContainText('0 %');
  await expect.poll(()=>page.locator('#priceChart .bw-d3-line').evaluate(node=>Number(node.parentElement!.getAttribute('opacity') ?? 1))).toBe(1);
  await page.screenshot({path:info.outputPath('commodity-desktop.png'),animations:'disabled'});
  const axe = await new AxeBuilder({page}).include('.commodity-overview').analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [320,390]) {
  test(`phone ${width}px starts with bounded chart, all modes/ranges fit, and custom dates work`, async ({page},info) => {
    await page.setViewportSize({width,height:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    await load(page);
    const svg = (await page.locator('#priceChart svg').boundingBox())!, summary = (await page.locator('.commodity-summary').boundingBox())!, chart = (await page.locator('.chart-panel').boundingBox())!;
    expect(svg.y).toBeLessThan(360);
    expect(svg.height).toBeLessThanOrEqual(301);
    expect(svg.y + svg.height).toBeLessThan(710);
    expect(summary.y).toBeGreaterThan(chart.y + chart.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const show = (await page.locator('#chart-view-controls').boundingBox())!, dateButton = (await page.locator('#chart-date-picker>summary').boundingBox())!;
    expect(show.x + show.width).toBeLessThan(dateButton.x);
    const track = page.locator('#chart-type-controls .chart-segmented-track');
    expect(await track.evaluate(node => getComputedStyle(node.querySelector('.chart-segmented-indicator')!).transitionDuration)).toBe('0s');
    await page.locator('#chart-date-picker>summary').click();
    const dates = await page.locator('#chart-date-end').evaluate(input => {
      const end = (input as HTMLInputElement).max;
      const start = new Date(end + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 2);
      return {end,start:start.toISOString().slice(0,10)};
    });
    await page.locator('#chart-date-start').fill(dates.start);
    await page.locator('#chart-date-end').fill(dates.end);
    await page.getByRole('button',{name:'Apply dates',exact:true}).click();
    await expect(page.locator('#stat-points')).toHaveText('3');
    await page.getByRole('radio',{name:'Bars',exact:true}).check();
    await expect(page.locator('#priceChart .bw-d3-bar')).toHaveCount(3);
    await page.screenshot({path:info.outputPath(`commodity-phone-${width}.png`),animations:'disabled'});
    await expect(page.locator('.commodity-summary')).toContainText('Synthetic test data');
    await page.addStyleTag({content:'#commodity-page .chart-segmented label span{font-size:18px;white-space:normal} #commodity-page .chart-segmented legend{font-size:16px;width:auto}'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('settings has contained opaque panels, keyboard tabs, real D3 effects and persistent explicit height', async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await load(page);
  await page.locator('#chart-settings-btn').click();
  const modal = page.getByRole('dialog',{name:'Chart settings',exact:true});
  await expect(modal).toBeVisible();
  const panel = await page.locator('.chart-settings-panel').evaluate(node => ({rect:node.getBoundingClientRect().toJSON(),background:getComputedStyle(node).backgroundColor,opacity:getComputedStyle(node).opacity,animation:getComputedStyle(node).animationName}));
  expect(panel.rect.y).toBe(0); expect(panel.rect.height).toBe(844); expect(panel.background).toBe('rgb(255, 255, 255)'); expect(panel.opacity).toBe('1'); expect(panel.animation).toBe('none');
  for (const name of ['appearance','scales','statusline','tooltip','interaction']) {
    await page.locator('#tab-'+name).click();
    const content = page.locator('#content-'+name);
    await expect(content).toBeVisible();
    const body = (await page.locator('.chart-settings-scroll').boundingBox())!, first = (await content.locator('legend').first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(body.y);
    expect(await page.locator('.chart-settings-panel').evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    await modal.screenshot({path:info.outputPath(`settings-phone-${name}.png`),animations:'disabled'});
  }
  await page.locator('#tab-appearance').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-scales')).toHaveAttribute('aria-selected','true');
  await page.locator('#setting-showHGrid').uncheck();
  await expect(page.locator('#priceChart .bw-d3-grid')).toHaveCount(0);
  await page.locator('#setting-yAxisPosition').selectOption('left');
  await expect(page.locator('#priceChart .bw-d3-axis').first()).toHaveAttribute('transform','translate(70,0)');
  await page.locator('#tab-appearance').click();
  await page.locator('#setting-lineWidth').press('Home'); await page.locator('#setting-lineWidth').press('ArrowRight'); await page.locator('#setting-lineWidth').press('ArrowRight'); await page.locator('#setting-lineWidth').press('ArrowRight');
  await expect(page.locator('#priceChart .bw-d3-line')).toHaveAttribute('stroke-width','4');
  await page.locator('#tab-tooltip').click();
  await page.locator('#setting-tooltipPadding').press('End');
  await page.locator('#tab-interaction').click();
  await page.locator('#setting-chartHeight').press('End'); await page.locator('#setting-chartHeight').press('ArrowLeft'); await page.locator('#setting-chartHeight').press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden(); await expect(page.locator('#chart-settings-btn')).toBeFocused();
  await expect.poll(async()=> (await page.locator('#priceChart svg').boundingBox())!.height).toBe(500);
  await page.reload(); await expect(page.locator('#chart-skeleton')).toHaveCount(0);
  await expect(page.locator('#priceChart .bw-d3-line')).toHaveAttribute('stroke-width','4');
  await expect.poll(async()=> (await page.locator('#priceChart svg').boundingBox())!.height).toBe(500);
  await page.locator('#chart-settings-btn').click();
  const axe = await new AxeBuilder({page}).include('#chart-settings-modal').analyze(); expect(axe.violations).toEqual([]);
});

test('grouped explorer keeps all twelve views, native keyboard choice, escape and PNG export', async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  await load(page);
  const lab=page.getByRole('region',{name:'Visual explorer',exact:true});
  for (const value of ['line','area','step','bar','scatter','change','histogram','cumulative','box','monthly','heatmap','coverage']) {
    await choose(lab,value);
    await expect(lab.locator('.bw-visual-stage svg')).toBeVisible();
    expect(await lab.locator('.bw-visual-stage svg').innerHTML()).not.toMatch(/NaN|Infinity/);
    await expect(lab.locator('table')).toHaveCount(1);
  }
  const trigger = lab.getByRole('button',{name:/^Visualization:/});
  await trigger.click();
  await page.keyboard.press('ArrowLeft');
  await expect(lab.getByRole('radio',{name:'Year × month heatmap',exact:true})).toBeChecked();
  await expect(trigger).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('ArrowDown');
  await expect(lab.getByRole('radio',{name:'Observation coverage',exact:true})).toBeChecked();
  await expect(trigger).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused(); await expect(trigger).toHaveAttribute('aria-expanded','false');
  await trigger.click();
  const panel=lab.getByRole('dialog',{name:'Choose visualization'});
  const bounds=(await panel.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await panel.evaluate(node=>node.scrollTop=0);
  await panel.screenshot({path:info.outputPath('explorer-grouped-chooser.png'),animations:'disabled'});
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await page.mouse.click(5,60);
  await expect(trigger).toHaveAttribute('aria-expanded','false');
  const download=page.waitForEvent('download'); await lab.getByRole('button',{name:'Download PNG'}).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  const axe=await new AxeBuilder({page}).include('.bw-visual-lab').analyze(); expect(axe.violations).toEqual([]);
});

test('dark desktop and phone settings remain contained with visible selected controls', async ({page},info) => {
  await page.setViewportSize({width:1440,height:1000});
  await load(page);
  await page.getByRole('button',{name:'Toggle light and dark mode'}).click();
  await page.locator('#chart-settings-btn').click();
  await page.getByRole('dialog',{name:'Chart settings',exact:true}).screenshot({path:info.outputPath('settings-desktop-dark.png'),animations:'disabled'});
  await page.setViewportSize({width:320,height:844});
  await expect(page.locator('.chart-settings-panel')).toBeVisible();
  await page.getByRole('dialog',{name:'Chart settings',exact:true}).screenshot({path:info.outputPath('settings-phone-dark.png'),animations:'disabled'});
  const panel=await page.locator('.chart-settings-panel').evaluate(node=>({rect:node.getBoundingClientRect().toJSON(),bg:getComputedStyle(node).backgroundColor,overflow:node.scrollWidth-node.clientWidth}));
  expect(panel.rect.width).toBe(320); expect(panel.overflow).toBeLessThanOrEqual(1); expect(panel.bg).not.toBe('rgba(0, 0, 0, 0)');
  const axe=await new AxeBuilder({page}).include('#chart-settings-modal').analyze(); expect(axe.violations).toEqual([]);
});
