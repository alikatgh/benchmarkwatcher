/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
function load(file) { window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/', file), 'utf8')); }
beforeEach(() => {
  window.BW = {}; document.body.innerHTML = '<div id="chart"></div><p id="note"></p><div id="values"></div>';
  load('vendor/d3.v7.9.0.min.js'); load('core/visuals.js'); load('components/visual_explorer.js');
});
test('missing values and calendar gaps do not become zero or joined observations', () => {
  const points = BW.Visuals.history([{date:'2025-01-01',price:0}, {date:'2025-01-02',price:null}, {date:'2025-01-03',price:5}, {date:'2025-02-30',price:50}, {date:'2025-04-01',price:10}]);
  expect(points.map(p => p.value)).toEqual([0, null, 5, 10]);
  expect(BW.Visuals.segments(points, 7).map(g => g.length)).toEqual([1, 1, 1]);
  for (const value of [null, undefined, '', ' ', false, [], {}, Infinity]) expect(BW.Visuals.numeric(value)).toBeNull();
});
test.each(['line','area','step','bar','scatter','change','histogram','cumulative','box','monthly','heatmap','coverage'])('%s supports constant, negative, single and missing values without invalid geometry', type => {
  for (const data of [[5,5,5],[-2,0,2],[7],[null,null]]) {
    const points = data.map((price, i) => ({date:`2025-01-0${i+1}`,price}));
    BW.VisualExplorer.render(document.getElementById('chart'), points, type, 'USD / unit', document.getElementById('note'), document.getElementById('values'));
    expect(document.querySelector('svg')).toBeTruthy();
    expect(document.getElementById('chart').innerHTML).not.toMatch(/NaN|Infinity/);
    expect(document.querySelector('table')).toBeTruthy();
  }
});
test('histogram counts all observations and cumulative values group duplicate observations', () => {
  const rows = [1,1,2,3].map((price,i) => ({date:`2025-01-0${i+1}`,price}));
  const args = [document.getElementById('chart'), rows];
  BW.VisualExplorer.render(...args, 'histogram', 'USD', document.getElementById('note'), document.getElementById('values'));
  expect([...document.querySelectorAll('tbody tr')].reduce((total,row) => total + Number(row.lastChild.textContent),0)).toBe(4);
  BW.VisualExplorer.render(...args, 'cumulative', 'USD', document.getElementById('note'), document.getElementById('values'));
  expect(document.querySelector('tbody tr').textContent).toContain('50.0%');
});
test('keyboard inspection reports only actual series dates and finite values', () => {
  const callback = jest.fn();
  const chart = BW.Visuals.timeSeries(document.getElementById('chart'), [{points:[{date:'2025-01-01',price:1},{date:'2025-01-03',price:3}]}], {onInspect:callback});
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  expect(callback.mock.lastCall[0].date).toBe('2025-01-01');
  chart.svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  expect(callback.mock.lastCall[0].date).toBe('2025-01-03');
});

test('isolated observations stay visible even when ordinary dots are disabled', () => {
  BW.Visuals.timeSeries(document.getElementById('chart'), [{gapDays:7, points:[{date:'2024-01-01',price:5},{date:'2024-02-01',price:6},{date:'2025-01-01',price:9}]}], {pointRadius:0, dots:false});
  const dots = [...document.querySelectorAll('.bw-d3-point')];
  expect(dots).toHaveLength(3);
  expect(dots.every(dot => Number(dot.getAttribute('r')) > 0 && dot.getAttribute('fill') !== 'transparent')).toBe(true);
});
