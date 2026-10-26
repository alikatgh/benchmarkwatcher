/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
let frames, nextFrame;
const points = Array.from({length:7121}, (_, index) => ({
  date:new Date(Date.UTC(1999,0,4 + index)).toISOString().slice(0,10),
  value:index === 0 ? 0 : 0.9 + index / 100000,
}));
function flushFrame() {
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(callback => callback());
}
function render(options = {}) {
  return BW.Visuals.timeSeries(document.getElementById('chart'), [{name:'Euro/USD',unit:'USD per EUR',points}], {
    width:1000,height:320,finance:true,yAxisPosition:'right',dots:false,tooltipDate:point=>point.date,...options,
  });
}
beforeEach(() => {
  window.BW = {}; document.body.innerHTML = '<div id="chart"></div>';
  frames = new Map(); nextFrame = 0;
  jest.spyOn(window,'requestAnimationFrame').mockImplementation(callback => {frames.set(++nextFrame,callback);return nextFrame;});
  jest.spyOn(window,'cancelAnimationFrame').mockImplementation(id => frames.delete(id));
  for (const file of ['vendor/d3.v7.9.0.min.js','core/visuals.js']) {
    window.eval(fs.readFileSync(path.join(__dirname,'../app/static/js/',file),'utf8'));
  }
});
afterEach(() => jest.restoreAllMocks());

test('full history retains every line observation without invisible dot/title DOM', () => {
  const onInspect = jest.fn(), chart = render({onInspect});
  const path = chart.svg.querySelector('.bw-d3-line');
  expect(path.__data__.flat()).toHaveLength(7121);
  expect(path.getAttribute('d').match(/[ML]/g)).toHaveLength(7121);
  expect(chart.svg.querySelectorAll('.bw-d3-point')).toHaveLength(0);
  expect(chart.svg.querySelectorAll('title')).toHaveLength(0);
  expect(chart.svg.getAttribute('aria-label')).toContain('Historical observations');
  for (const [key,index] of [['Home',0],['ArrowRight',1],['End',7120]]) {
    chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
    expect(onInspect.mock.lastCall[0].date).toBe(points[index].date);
    expect(onInspect.mock.lastCall[0].value).toBe(points[index].value);
    expect(chart.svg.querySelector('.bw-d3-tooltip').textContent).toContain(points[index].date);
  }
});

test('pointer bursts inspect only the newest position each frame with logarithmic date lookup', () => {
  const onInspect = jest.fn(), chart = render({onInspect});
  let reads = 0;
  for (const point of chart.svg.querySelector('.bw-d3-line').__data__.flat()) {
    const time = point.time;
    Object.defineProperty(point,'time',{get() {reads++;return time;}});
  }
  onInspect.mockClear();
  for (let index=0; index<100; index++) {
    chart.svg.dispatchEvent(new MouseEvent('pointermove',{clientX:index === 99 ? 938 : 8,clientY:100}));
  }
  expect(onInspect).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  flushFrame();
  expect(onInspect).toHaveBeenCalledTimes(1);
  expect(onInspect.mock.lastCall[0].date).toBe(points.at(-1).date);
  expect(reads).toBeLessThan(100);
  chart.svg.dispatchEvent(new MouseEvent('pointermove',{clientX:8,clientY:100}));
  flushFrame();
  expect(onInspect.mock.lastCall[0].value).toBe(0);
});

test('tooltip sizing measures complete fitting labels and reuses their widths', () => {
  const measure = jest.fn(function () {return this.textContent.length*7;});
  const original = SVGElement.prototype.getComputedTextLength;
  SVGElement.prototype.getComputedTextLength = measure;
  try {
    const chart = render();
    chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    expect(measure.mock.calls.length).toBeLessThan(10);
    measure.mockClear();
    chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    expect(measure).not.toHaveBeenCalled();
  } finally {
    if (original) SVGElement.prototype.getComputedTextLength = original;
    else delete SVGElement.prototype.getComputedTextLength;
  }
});

test('pending pointer inspection cannot overwrite keyboard, taps, blur or destruction', () => {
  const onInspect = jest.fn(), chart = render({onInspect});
  const move = () => chart.svg.dispatchEvent(new MouseEvent('pointermove',{clientX:938,clientY:100}));
  move();
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  flushFrame();
  expect(onInspect.mock.lastCall[0].date).toBe(points[0].date);
  move();
  chart.svg.dispatchEvent(new MouseEvent('pointerdown',{clientX:8,clientY:100}));
  flushFrame();
  expect(onInspect.mock.lastCall[0].date).toBe(points[0].date);
  move();
  chart.svg.dispatchEvent(new FocusEvent('blur'));
  flushFrame();
  expect(chart.svg.querySelector('.bw-d3-tooltip').getAttribute('visibility')).toBe('hidden');
  move(); chart.destroy(); onInspect.mockClear(); flushFrame();
  expect(onInspect).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

test('scatter keeps visible observations when line dots are disabled', () => {
  const chart = render({type:'scatter'}), dots = [...chart.svg.querySelectorAll('.bw-d3-point')];
  expect(dots).toHaveLength(7121);
  expect(dots.every(dot => Number(dot.getAttribute('r')) > 0 && dot.getAttribute('fill') !== 'transparent')).toBe(true);
});

test('pointer inspection preserves duplicate replacement, missing dates and nearest comparison line', () => {
  const onInspect = jest.fn();
  const chart = BW.Visuals.timeSeries(document.getElementById('chart'), [
    {name:'First',points:[{date:'2025-01-01',value:1},{date:'2025-01-01',value:7},{date:'2025-01-02',value:null},{date:'2025-01-03',value:0}]},
    {name:'Second',points:[{date:'2025-01-01',value:3},{date:'2025-01-03',value:10}]},
  ], {width:1000,height:320,onInspect});
  const second = [...chart.svg.querySelectorAll('.point-1')].find(dot => dot.__data__.date === '2025-01-01');
  chart.svg.dispatchEvent(new MouseEvent('pointermove',{clientX:Number(second.getAttribute('cx')),clientY:Number(second.getAttribute('cy'))}));
  flushFrame();
  expect(onInspect.mock.lastCall[0]).toMatchObject({date:'2025-01-01',value:3});
  expect(onInspect.mock.lastCall[1].name).toBe('Second');
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  expect(onInspect.mock.lastCall[0]).toMatchObject({date:'2025-01-01',value:7});
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  expect(onInspect.mock.lastCall[0]).toMatchObject({date:'2025-01-03',value:0});
});

test('leave, cancellation and range replacement discard queued hover work', () => {
  const onInspect = jest.fn(), chart = render({onInspect});
  const move = () => chart.svg.dispatchEvent(new MouseEvent('pointermove',{clientX:8,clientY:100}));
  for (const type of ['pointerleave','pointercancel']) {
    move(); chart.svg.dispatchEvent(new MouseEvent(type)); flushFrame();
    expect(chart.svg.querySelector('.bw-d3-tooltip').getAttribute('visibility')).toBe('hidden');
    expect(onInspect.mock.lastCall[2].active).toBe(false);
  }
  move(); chart.destroy(); onInspect.mockClear();
  const replacementInspect = jest.fn();
  const replacement = BW.Visuals.timeSeries(document.getElementById('chart'), [{points:points.slice(-10)}], {onInspect:replacementInspect});
  flushFrame();
  expect(onInspect).not.toHaveBeenCalled();
  expect(replacementInspect).toHaveBeenCalledTimes(1);
  expect(replacementInspect.mock.lastCall[0].date).toBe(points.at(-1).date);
  expect(replacement.svg.querySelector('.bw-d3-tooltip').getAttribute('visibility')).toBe('hidden');
});

test('font completion refreshes cached tooltip metrics with one shared listener across charts', () => {
  const fonts = new EventTarget(), descriptor = Object.getOwnPropertyDescriptor(document,'fonts');
  const add = jest.spyOn(fonts,'addEventListener');
  Object.defineProperty(document,'fonts',{configurable:true,value:fonts});
  window.eval(fs.readFileSync(path.join(__dirname,'../app/static/js/core/visuals.js'),'utf8'));
  const original = SVGElement.prototype.getComputedTextLength;
  let glyphWidth = 7;
  const measure = jest.fn(function () {return this.textContent.length*glyphWidth;});
  SVGElement.prototype.getComputedTextLength = measure;
  let chart;
  try {
    chart = render();
    chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    const before = Number(chart.svg.querySelector('.bw-d3-tooltip rect').getAttribute('width'));
    glyphWidth = 10; measure.mockClear(); fonts.dispatchEvent(new Event('loadingdone'));
    chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    expect(Number(chart.svg.querySelector('.bw-d3-tooltip rect').getAttribute('width'))).toBeGreaterThan(before);
    expect(measure).toHaveBeenCalled();
    chart.destroy();
    for (let index=0; index<5; index++) render().destroy();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toBe('loadingdone');
  } finally {
    chart?.destroy();
    if (descriptor) Object.defineProperty(document,'fonts',descriptor);
    else delete document.fonts;
    if (original) SVGElement.prototype.getComputedTextLength = original;
    else delete SVGElement.prototype.getComputedTextLength;
  }
});
