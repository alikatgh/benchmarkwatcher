import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

test.beforeEach(async({context,baseURL})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL ? route.continue() : route.abort());
});

test('320px shared header keeps Visual Builder and navigation controls reachable',async({page})=>{
  await page.setViewportSize({width:320,height:800});
  for(const path of ['/', '/?view=compact', '/data', '/help']) {
    await page.goto(path);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),path).toBeLessThanOrEqual(1);
    const controls=await page.locator('.bw-header a,.bw-header button').evaluateAll(elements=>elements.map(element=>{
      const rect=element.getBoundingClientRect();
      return {name:element.getAttribute('aria-label'),left:rect.left,right:rect.right};
    }));
    for(const control of controls) {
      expect(control.left,`${path}: ${control.name}`).toBeGreaterThanOrEqual(0);
      expect(control.right,`${path}: ${control.name}`).toBeLessThanOrEqual(320);
    }
    const trigger=page.getByRole('button',{name:'Open Visual Builder'});
    await trigger.click();
    const dialog=page.getByRole('dialog',{name:'Graphic builder'});
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeInViewport();
  }
});

test('Energy graphic opens an editable, saved and attributed export on desktop and mobile',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?category=energy&view=compact');
  const preview=page.locator('[data-category-preview]');
  await expect(preview.locator('svg')).toBeVisible();
  await expect(preview).toContainText('Oil');
  await expect(page.locator('#bw-featured')).toBeHidden();
  await page.getByRole('button',{name:'Edit this graphic',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Graphic builder'});
  await dialog.getByLabel('Headline',{exact:true}).fill('Energy reference history');
  await dialog.getByLabel('Subtitle',{exact:true}).fill('Saved observations · synthetic test fixture');
  await dialog.getByLabel('Graphic',{exact:true}).selectOption('line');
  await expect(dialog.locator('svg')).toContainText('Energy reference history');
  if(info.project.name === 'mobile') {
    await dialog.getByRole('button',{name:'Preview',exact:true}).click();
    await expect(dialog.locator('.bw-vb-preview')).toBeInViewport();
    await dialog.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(dialog.getByLabel('Graphic',{exact:true})).toBeFocused();
    await dialog.getByRole('button',{name:'Preview',exact:true}).click();
  }
  await dialog.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText(/saved/i);
  const svgDownload=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Export SVG',exact:true}).click();
  const xml=await readFile((await (await svgDownload).path())!,'utf8');
  expect(xml).toContain('Energy reference history');
  expect(xml).toContain('Synthetic test data');
  expect(xml).toContain('USD / test unit');
  expect(xml).not.toMatch(/NaN|Infinity/);
  const pngDownload=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Export PNG',exact:true}).click();
  const png=await readFile((await (await pngDownload).path())!);
  expect(png.subarray(1,4).toString()).toBe('PNG');
  const axe=await new AxeBuilder({page}).include('.bw-visual-builder').withTags(['wcag2a','wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(await dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('visual-builder-energy.png')});
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  await page.getByRole('button',{name:'Edit this graphic',exact:true}).click();
  await dialog.getByRole('button',{name:'Restore saved draft'}).click();
  await expect(dialog.getByLabel('Headline',{exact:true})).toHaveValue('Energy reference history');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Edit this graphic',exact:true})).toBeFocused();
  expect(errors).toEqual([]);
});

test('country ranking and history preserve source flags and the selected period',async({page},info)=>{
  await page.goto('/data');
  await page.getByRole('button',{name:'Visualize this page',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Graphic builder'});
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Synthetic wind capacity');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Sample North');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Sample South');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('2025');
  await dialog.locator('.bw-vb-data>summary').click();
  await expect(dialog.locator('tbody')).toContainText('E');
  await page.screenshot({path:info.outputPath('visual-builder-ranking.png')});
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  await page.getByRole('button',{name:'Create graphic for Sample North Synthetic wind capacity',exact:true}).click();
  await expect(dialog.getByLabel('Headline',{exact:true})).toHaveValue('Sample North · Synthetic wind capacity');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Original reporting periods');
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  await page.locator('.gr-reference-name a').first().click();
  await page.locator('#gr-range').selectOption('1');
  await page.locator('.gr-chart-controls').getByRole('button',{name:'Create graphic',exact:true}).click();
  await dialog.locator('.bw-vb-data>summary').click();
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
});

test('paste validation keeps the last valid graphic and GeoJSON produces a real map',async({page})=>{
  await page.goto('/help');
  await page.getByRole('button',{name:'Open Visual Builder'}).click();
  const dialog=page.getByRole('dialog',{name:'Graphic builder'});
  await dialog.locator('.bw-vb-paste>summary').click();
  await dialog.getByLabel('Source data',{exact:true}).fill('label,value,unit,period,status,source\nNorth,24,GW,2025,Estimated,Synthetic source\nSouth,12,GW,2025,Observed,Synthetic source');
  await dialog.getByRole('button',{name:'Validate and apply data'}).click();
  await dialog.getByLabel('Graphic',{exact:true}).selectOption('horizontal');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('North');
  await dialog.getByLabel('Source data',{exact:true}).fill('label,value\nNorth,not-a-number');
  await dialog.getByRole('button',{name:'Validate and apply data'}).click();
  await expect(dialog.getByRole('status')).toContainText('Data was not applied');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('North');
  await dialog.getByLabel('Graphic',{exact:true}).selectOption('map');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText(/GeoJSON/);
  const geo={type:'FeatureCollection',features:[
    {type:'Feature',properties:{name:'North'},geometry:{type:'Polygon',coordinates:[[[0,0],[0,5],[5,5],[5,0],[0,0]]]}},
    {type:'Feature',properties:{name:'South'},geometry:{type:'Polygon',coordinates:[[[0,-5],[0,0],[5,0],[5,-5],[0,-5]]]}}
  ]};
  await dialog.getByLabel('GeoJSON geography',{exact:true}).setInputFiles({name:'synthetic.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(geo))});
  await expect(dialog.locator('.bw-vb-preview svg path')).toHaveCount(2);
  expect(await dialog.locator('svg').innerHTML()).not.toMatch(/NaN|Infinity/);
});

test('benchmark pane and Research open the shared builder without losing modal keyboard focus',async({page})=>{
  await page.goto('/?view=compact');
  await page.locator('#table-body a[data-benchmark-id="gold"]:visible, #tw-mobile-list a[data-benchmark-id="gold"]:visible').click();
  const pane=page.locator('#benchmark-detail');
  await pane.getByRole('button',{name:'Create graphic',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Graphic builder'});
  await expect(dialog.getByLabel('Headline',{exact:true})).toHaveValue('Gold over time');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('button',{name:'Create graphic',exact:true})).toBeFocused();
  await pane.getByRole('button',{name:'Close benchmark details'}).click();
  await page.locator('#table-body input[type=checkbox][aria-label="Select Gold"]:visible, #tw-mobile-list input[aria-label="Select Gold"]:visible').check();
  await page.getByRole('button',{name:'Add to research',exact:true}).click();
  await page.locator('#rw-editor').getByRole('button',{name:'Close entry',exact:true}).click();
  await page.locator('#research-workspace').getByRole('button',{name:'Create graphic',exact:true}).click();
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Gold');
});

test('failed or empty selections cannot reopen a stale graphic',async({page},info)=>{
  await page.goto('/?category=energy&view=compact');
  await expect(page.getByRole('button',{name:'Edit this graphic',exact:true})).toBeVisible();
  if(info.project.name === 'desktop') await page.getByRole('link',{name:'Indices',exact:true}).click();
  else await page.goto('/?category=index&view=compact'); // Empty categories have no mobile filter option.
  await expect(page.locator('#bw-category-graphic > [role=status]')).toContainText('No saved benchmarks');
  await expect(page.getByRole('button',{name:'Edit this graphic',exact:true})).toBeHidden();
  await page.locator('#bw-visual-explorer>summary').click();
  const lab=page.getByRole('region',{name:'Visual explorer'});
  await expect(lab.getByRole('button',{name:'Create graphic',exact:true})).toBeEnabled();
  await page.route('**/api/commodity/oil',route=>route.fulfill({status:503,json:{error:'Synthetic outage'}}));
  await lab.getByLabel('Benchmark',{exact:true}).selectOption('oil');
  await expect(lab.locator('.bw-visual-note')).toContainText('Could not load');
  await expect(lab.getByRole('button',{name:'Create graphic',exact:true})).toBeDisabled();
});

test('workbook periods and company fiscal selections open with their own evidence',async({page})=>{
  await page.goto('/workspace/register');
  await page.getByLabel('Username',{exact:true}).fill('graphic-'+randomUUID().slice(0,8));
  await page.locator('#password').fill('synthetic graphics test password');
  await page.getByRole('button',{name:'Create private workspace'}).click();
  await page.getByRole('link',{name:'Continue to workspace'}).click();
  await page.getByRole('button',{name:'Minimize AI chat'}).click();
  await page.locator('.workspace-nav').getByRole('link',{name:'AI settings'}).click();
  const connection=page.locator('form:has(#key-typesafe)');
  await connection.locator('input[type=password]').fill('fixture-typesafe-key');
  await connection.locator('input[type=checkbox]').check();
  await connection.getByRole('button',{name:'Test and save key'}).click();
  await page.locator('.workspace-nav').getByRole('link',{name:'Workbook studio'}).click();
  await page.locator('.workbook-list').getByRole('link',{name:/Sample Company/}).click();
  await page.getByRole('button',{name:'Open AI chat'}).click();
  const chat=page.getByRole('complementary',{name:'Workbook AI chat'});
  await chat.getByRole('button',{name:'Show Operating Income across the available periods.',exact:true}).click();
  await chat.locator('.studio-chat-options>summary').click();
  await chat.locator('#provider-model').selectOption('typesafe:jev-latest');
  await chat.getByRole('button',{name:'Send message'}).click();
  await page.getByRole('button',{name:'Agree and send'}).click();
  await expect(chat.getByLabel('AI response',{exact:true})).toBeVisible();
  await chat.getByRole('link',{name:'View analysis'}).click();
  if(await page.getByRole('button',{name:'Minimize AI chat'}).isVisible()) await page.getByRole('button',{name:'Minimize AI chat'}).click();
  await page.locator('.studio-analysis-step[open]').getByRole('button',{name:'Create graphic',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Graphic builder'});
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Q124');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText('Sample Company.xlsx');
  await expect(dialog.locator('.bw-vb-preview svg')).toContainText(/source order|elapsed time/i);
  await dialog.getByRole('button',{name:'Close graphic builder'}).click();
  // Open a synthetic SEC report through the existing authenticated route.
  const csrf=await page.locator('input[name=csrf]').first().inputValue();
  const response=await page.request.post('/workspace/companies/open',{form:{csrf,cik:'0000000001'},headers:{Accept:'application/json'}});
  expect(response.ok()).toBe(true);
  await page.goto((await response.json()).url);
  await page.getByRole('button',{name:'Quarterly',exact:true}).click();
  await page.locator('.company-chart-toolbar').getByRole('button',{name:'Create graphic',exact:true}).click();
  await dialog.locator('.bw-vb-data>summary').click();
  await expect(dialog.locator('tbody tr')).toHaveCount(12);
  await expect(dialog.locator('tbody')).toContainText('Q4 2025');
  await expect(dialog.locator('tbody')).toContainText('sec.gov');
});
