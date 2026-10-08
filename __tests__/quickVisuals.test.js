/** @jest-environment node */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const checks = [];
function check(name, fn) {
  test(name, () => {
  const dom = new JSDOM('<div id="table-scroll"><button id="trigger">Quick visual</button><button id="other">Other visual</button></div>', {url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window;
  for (const path of ['vendor/d3.v7.9.0.min.js','core/visuals.js','components/visual_builder.js','components/quick_visuals.js']) w.eval(fs.readFileSync('app/static/js/' + path, 'utf8'));
  const B = w.BW, d = w.document, open = spec => B.QuickVisuals.open(spec,{trigger:d.getElementById('trigger')});
  const field = key => d.querySelector('[data-qv-field="' + key + '"]');
  const change = (key,value) => { field(key).value=value;field(key).dispatchEvent(new w.Event('change',{bubbles:true})); };
  try { fn({w,B,d,open,field,change}); checks.push(name); }
  finally { B.QuickVisuals.close(); B.VisualBuilder.close(); dom.window.close(); }
  });
}
const input = overrides => ({id:'clicked-oil',title:'Selected oil observations',unit:'USD / barrel',source:'Reference agency',frequency:'annual',
  series:[{id:'oil',name:'Oil',unit:'USD / barrel',source:'Reference agency',sourceUrl:'https://example.org/oil',points:[
    {period:'2022',value:0},{period:'2023',value:123.1234567890123,estimated:true,footnote:'Source estimate'},
    {period:'2024',value:null,status:'unavailable'},{period:'2025',value:8,planned:true}
  ]}],...overrides});
check('inert load, no fetch/render/draft',({w,B,d}) => {
  let calls=0;w.fetch=()=>{calls++;}; B.VisualBuilder.render=()=>{calls++;};B.VisualBuilder.readDraft=()=>{calls++;};
  w.eval(fs.readFileSync('app/static/js/components/quick_visuals.js','utf8'));
  assert.equal(calls,0); assert.equal(d.querySelector('dialog,svg'),null);
});
check('D3 marks, raw precision, gaps, flags, no poster, immutable input',({w,d,open,field})=>{
  const supplied=input(), before=JSON.stringify(supplied),controller=open(supplied),svg=controller.dialog.querySelector('svg');
  assert.ok(controller.dialog.open);assert.equal(d.querySelector('h2').textContent,'Quick visual');
  assert.equal(svg.querySelectorAll('.bw-vb-mark').length,3);assert.equal(svg.querySelectorAll('.bw-vb-line').length,2);
  assert.equal(svg.querySelector('.bw-vb-paper,image'),null);assert.ok(!svg.outerHTML.includes('Georgia'));
  assert.ok(d.querySelector('.bw-qv-notes').textContent.includes('estimated (1)'));assert.ok(d.querySelector('.bw-qv-notes').textContent.includes('planned (1)'));
  assert.ok(d.querySelector('.bw-qv-notes').textContent.includes('gaps remain open'));assert.equal(JSON.stringify(supplied),before);
  assert.equal(JSON.parse(svg.querySelector('metadata').textContent).series[0].points.length,4);assert.ok(field('unit').parentElement.hidden);
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true})); assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('0 USD / barrel'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('123.1234567890123 USD / barrel'));
  svg.querySelectorAll('.bw-vb-mark')[2].dispatchEvent(new w.MouseEvent('mouseenter'));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('8 USD / barrel'));
});
check('clicked dataset retained instead of first overview',({d,open,field,change})=>{
  const clicked=input(),overview=input({id:'overview',title:'Category overview',series:[{name:'Other oil',points:[{period:'2025',value:999}]}]});
  const controller=open({...clicked,datasets:[overview,clicked]});
  assert.equal(controller.getSpec().id,'clicked-oil'); assert.equal(field('dataset').value,'clicked-oil');assert.ok(!d.querySelector('.bw-vb-mark title').textContent.includes('999'));
  change('dataset','overview');assert.equal(controller.getSpec().title,'Category overview');assert.ok(d.querySelector('.bw-vb-mark title').textContent.includes('999'));
});
check('mixed and unknown units isolated',({d,open,field,change})=>{
  const controller=open(input({series:[
    {name:'Oil',unit:'USD / barrel',points:[{period:'2025',value:5}]},
    {name:'Gas',unit:'USD / MMBtu',points:[{period:'2025',value:3}]},
    {name:'Unknown',unit:'',points:[{period:'2025',value:999}]}
  ]}));
  assert.ok(!field('unit').parentElement.hidden); assert.equal(d.querySelectorAll('.bw-vb-mark').length,1);assert.ok(d.querySelector('.bw-qv-notes').textContent.includes('2 observations in other units excluded'));
  change('unit','USD / MMBtu');assert.ok(d.querySelector('.bw-vb-mark title').textContent.includes('3 USD / MMBtu'));
  change('unit','');assert.ok(d.querySelector('.bw-vb-mark title').textContent.includes('Unknown'));assert.equal(controller.getSpec().unit,'');
});
check('320px SVG, ordinal labels, no invented dates, tooltip clamp',({w,d,open})=>{
  w.innerWidth=320;const controller=open({title:'Workbook revenue',ordinal:true,unit:'USD',series:[{name:'Revenue',points:[{period:'Q1 2024',value:2},{period:'Q2 2024',value:null},{period:'FY25',value:9}]}]});
  const svg=controller.dialog.querySelector('svg'),box=svg.getAttribute('viewBox').split(' ').map(Number);
  assert.equal(box[2],272);assert.equal(box[3],250);assert.equal(svg.querySelectorAll('.bw-vb-mark').length,2);assert.equal(svg.querySelectorAll('.bw-vb-line').length,2);assert.ok(!/NaN|Infinity/.test(svg.outerHTML));
  assert.ok(d.querySelector('.bw-qv-notes').textContent.includes('do not represent elapsed time'));
  assert.deepEqual(JSON.parse(svg.querySelector('metadata').textContent).series[0].points.map(p=>p.date),['','','']);
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true})); assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('FY25'));assert.ok(parseFloat(d.querySelector('.bw-qv-tooltip').style.left)>=8);
});
for (const type of ['bar','scatter','horizontal']) check('exact categorical keyboard ' + type,({w,d,open})=>{
  const controller=open({type,unit:'units',rows:[{label:'Negative',value:-3.1234567890123,period:'2024',unit:'units'},{label:'Zero',value:0,unit:'units'}]}),svg=controller.dialog.querySelector('svg');
  assert.equal(svg.querySelectorAll('.bw-vb-mark').length,2); assert.ok(!/NaN|Infinity/.test(svg.outerHTML));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:type==='horizontal'?'End':'Home',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('-3.1234567890123 units'));
});
check('source details preserve missing values, flags, precision and links',({w,open})=>{
  const controller=open(input()),details=controller.dialog.querySelector('details');assert.equal(details.querySelector('table'),null);
  details.open=true;details.dispatchEvent(new w.Event('toggle'));assert.equal(details.querySelectorAll('tbody tr').length,4);
  assert.ok(details.querySelector('tbody').textContent.includes('123.1234567890123'));assert.ok(details.querySelector('tbody').textContent.includes('Unavailable'));assert.ok(details.querySelector('tbody').textContent.includes('estimated'));
  assert.equal(details.querySelector('a').rel,'noopener noreferrer');assert.equal(details.querySelector('a').href,'https://example.org/oil');
});
check('Escape restores original trigger and ancestor scroll',({w,d,open})=>{
  const scroller=d.getElementById('table-scroll');scroller.scrollTop=260;scroller.scrollLeft=75;d.getElementById('other').focus();const controller=open(input());scroller.scrollTop=0;scroller.scrollLeft=0;
  controller.dialog.querySelector('svg').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(d.querySelector('.bw-quick-visual'),null);assert.equal(d.activeElement.id,'trigger');assert.equal(scroller.scrollTop,260);assert.equal(scroller.scrollLeft,75);controller.close();
});
check('explicit customize keeps full editor export and source focus return',({B,d,open})=>{
  const scroller=d.getElementById('table-scroll');scroller.scrollTop=125;const controller=open(input());assert.equal(d.querySelector('.bw-visual-builder'),null);
  controller.dialog.querySelector('[data-qv-action=customize]').click();assert.equal(d.querySelector('.bw-quick-visual'),null);assert.ok(d.querySelector('.bw-visual-builder'));assert.equal(d.querySelector('[data-vb-field=title]').value,'Selected oil observations');
  assert.ok(B.VisualBuilder.serializeSVG(d.querySelector('.bw-vb-preview svg')).includes('fill="#fff1e5"'));
  scroller.scrollTop=0;d.querySelector('[data-vb-action=close]').click();assert.equal(d.activeElement.id,'trigger');assert.equal(scroller.scrollTop,125);
});
check('responsive observers disconnect and next opening uses only fresh source',({w,d,open})=>{
  let disconnected=0,observed=0;w.ResizeObserver=class {observe(){observed++;}disconnect(){disconnected++;}};
  const first=open(input());first.close();assert.equal(disconnected,1);assert.equal(observed,1);
  open({title:'Population',unit:'people',rows:[{label:'Region',value:500,unit:'people'}]});assert.equal(d.querySelectorAll('.bw-quick-visual').length,1);assert.ok(d.querySelector('.bw-vb-mark title').textContent.includes('500 people'));
});

check('map observations support exact hover and keyboard inspection at projected centroids',({w,d,open})=>{
  const controller=open({type:'map',title:'Regional observations',unit:'people',geoSource:'Source boundaries',geojson:{type:'FeatureCollection',features:[
    {type:'Feature',properties:{name:'North'},geometry:{type:'Polygon',coordinates:[[[10,10],[20,10],[20,20],[10,20],[10,10]]]}},
    {type:'Feature',properties:{name:'South'},geometry:{type:'Polygon',coordinates:[[[10,-10],[20,-10],[20,0],[10,0],[10,-10]]]}}
  ]},rows:[{label:'North',value:0,unit:'people',period:'2025'},{label:'South',value:123.1234567890123,unit:'people',period:'2025'}]});
  const svg=controller.dialog.querySelector('svg'),marks=svg.querySelectorAll('.bw-vb-geography');
  assert.equal(marks.length,2);for(const mark of marks){assert.ok(Number.isFinite(Number(mark.getAttribute('data-inspect-x'))));assert.ok(Number.isFinite(Number(mark.getAttribute('data-inspect-y'))));}
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('0 people'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('123.1234567890123 people'));
  marks[0].dispatchEvent(new w.MouseEvent('mouseenter'));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('North'));
});

check('missing D3 leaves no modal and restores source focus and scroll before reporting the error',({w,d,open})=>{
  const scroller=d.getElementById('table-scroll');scroller.scrollTop=187;d.getElementById('other').focus();delete w.d3;
  assert.throws(()=>open(input()),/D3 must load/);assert.equal(d.querySelector('.bw-quick-visual'),null);assert.equal(d.activeElement.id,'trigger');assert.equal(scroller.scrollTop,187);
});

check('a failed first renderer cleans up its partially created modal and allows recovery',({B,d,open})=>{
  const render=B.VisualBuilder.render;B.VisualBuilder.render=target=>{target.append(d.createElementNS('http://www.w3.org/2000/svg','svg'));throw new Error('Source renderer failed');};
  assert.throws(()=>open(input()),/Source renderer failed/);assert.equal(d.querySelector('.bw-quick-visual,svg'),null);assert.equal(d.activeElement.id,'trigger');
  B.VisualBuilder.render=render;assert.ok(open(input()).dialog.querySelector('svg'));
});

check('timeline inspection follows displayed dates even when source points are unsorted',({w,d,open})=>{
  const controller=open(input({series:[{name:'Oil',points:[{period:'2025',value:5},{period:'2023',value:3},{period:'2024',value:4}]}]})),svg=controller.dialog.querySelector('svg');
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Oil · 2023'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Oil · 2024'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Oil · 2025'));
});

check('multi-series timeline keys advance by displayed period with stable ties',({w,d,open})=>{
  const controller=open(input({series:[{name:'Oil',points:[{period:'2024',value:4},{period:'2023',value:3}]},{name:'Gas',points:[{period:'2024',value:14},{period:'2023',value:13}]}]})),svg=controller.dialog.querySelector('svg');
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Oil · 2023'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Gas · 2023'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Oil · 2024'));
  svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.ok(d.querySelector('.bw-qv-tooltip').textContent.includes('Gas · 2024'));
});
