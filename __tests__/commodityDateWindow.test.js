/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
beforeEach(() => {
  document.body.innerHTML = '<input id="chart-date-start"><input id="chart-date-end"><p id="chart-date-error"></p><button id="range-custom"></button><details id="chart-date-picker"></details>';
  global.BW = {};
  window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/components/commodity.js'), 'utf8'));
});
test('calendar month ends clamp without rolling into the following month', () => {
  const rows = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-31'].map(date => ({date, price: 1}));
  expect(BW.Commodity.filterDataByRange(rows, '1M').map(p => p.date)).toEqual(['2024-02-29', '2024-03-01', '2024-03-31']);
});
test('year presets clamp leap dates and YTD starts on January 1', () => {
  const c = BW.Commodity;
  const rows = ['2019-02-28', '2023-02-28', '2023-12-31', '2024-01-01', '2024-02-29'].map(date => ({date, price: 1}));
  expect(c.filterDataByRange(rows, '1Y')[0].date).toBe('2023-02-28');
  expect(c.filterDataByRange(rows, '5Y')[0].date).toBe('2019-02-28');
  expect(c.filterDataByRange(rows, 'YTD')[0].date).toBe('2024-01-01');
});
test('comparison series uses the primary observation window', () => {
  BW.Commodity.fullHistoryData = [{date:'2026-09-25',price:1}];
  expect(BW.Commodity.filterDataByRange([{date:'2026-07-01',price:1}], '1M')).toEqual([]);
});
test('custom inclusive dates work and invalid/empty windows preserve the previous chart', () => {
  const c = BW.Commodity;
  c.fullHistoryData = [{date:'2024-01-01',price:1},{date:'2024-02-01',price:2},{date:'2024-03-01',price:3}];
  c.updateChart = jest.fn();
  document.getElementById('chart-date-start').value='2024-01-01';
  document.getElementById('chart-date-end').value='2024-02-01';
  expect(c.applyCustomDates()).toBe(true);
  expect(c.filterDataByRange(c.fullHistoryData,c.currentRange)).toHaveLength(2);
  document.getElementById('chart-date-start').value='2024-02-30';
  expect(c.applyCustomDates()).toBe(false);
  document.getElementById('chart-date-start').value='2024-03-01';
  expect(c.applyCustomDates()).toBe(false);
  document.getElementById('chart-date-start').value='2024-02-02';
  document.getElementById('chart-date-end').value='2024-02-20';
  expect(c.applyCustomDates()).toBe(false);
  expect(c.updateChart).toHaveBeenCalledTimes(1);
  expect(c.customDateWindow).toEqual({start:'2024-01-01',end:'2024-02-01'});
});
