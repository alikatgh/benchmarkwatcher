/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadCommodityScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'commodity.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('Commodity comparison race handling', () => {
  let originalFetch;
  let renderList;

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function flushPromises() {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="compare-search" value="" />
      <div id="compare-tags"></div>
      <div id="compare-bar" class="hidden"></div>
      <div id="compare-list"></div>
      <p id="compare-status"></p>
    `;

    global.BW = {
      Utils: {
        buildCommoditiesApiUrl: () => '/api/commodities'
      }
    };

    originalFetch = global.fetch;
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/vendor/d3.v7.9.0.min.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/core/visuals.js'), 'utf8'));
    loadCommodityScript();
    renderList = BW.Commodity.renderCompareList;

    BW.Commodity.updateChart = jest.fn();
    BW.Commodity.updateCompareBar = jest.fn();
    BW.Commodity.renderCompareList = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('does not re-add comparison when response resolves after removal', async () => {
    const deferred = createDeferred();
    global.fetch = jest.fn().mockImplementation(() => deferred.promise);

    BW.Commodity.addComparison('gold', 'Gold');
    BW.Commodity.removeComparison('gold');
    const renderedAfterRemoval = BW.Commodity.renderCompareList.mock.calls.length;

    deferred.resolve({
      json: () => Promise.resolve({ data: { history: [{ date: '2025-01-01', price: 1 }] } })
    });

    await flushPromises();

    expect(BW.Commodity.comparisonData.gold).toBeUndefined();
    expect(BW.Commodity.comparisonPendingSeq.gold).toBeUndefined();

    expect(BW.Commodity.updateChart).toHaveBeenCalledTimes(1);
    expect(BW.Commodity.updateCompareBar).toHaveBeenCalledTimes(1);
    expect(BW.Commodity.renderCompareList).toHaveBeenCalledTimes(renderedAfterRemoval);
  });

  test('rejects failed or empty histories with visible retry feedback and can recover', async () => {
    const valid = { data: { history: [{ date: '2025-01-01', price: 20 }] } };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => valid })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { history: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => valid });
    for (let i = 0; i < 2; i++) {
      BW.Commodity.addComparison('gold', 'Gold'); await flushPromises();
      expect(BW.Commodity.comparisonData.gold).toBeUndefined();
      expect(BW.Commodity.comparisonPendingSeq.gold).toBeUndefined();
      expect(document.getElementById('compare-status').textContent).toContain('Select it again to retry');
    }
    BW.Commodity.addComparison('gold', 'Gold'); await flushPromises();
    expect(BW.Commodity.comparisonData.gold.history).toEqual(valid.data.history);
    expect(BW.Commodity.currentViewMode).toBe('percent');
    expect(document.getElementById('compare-status').textContent).toBe('');
  });

  test('pending requests count toward the four-line limit and cancellation releases a slot', () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    ['one', 'two', 'three', 'four'].forEach(id => BW.Commodity.addComparison(id, id));
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(document.getElementById('compare-status').textContent).toContain('Remove a line');
    BW.Commodity.removeComparison('two'); BW.Commodity.addComparison('four', 'four');
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(new Set(Object.values(BW.Commodity.comparisonAssignedColors)).size).toBe(3);
  });

  test('a superseded response cannot replace a re-added series', async () => {
    const old = createDeferred(), current = createDeferred();
    global.fetch = jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    BW.Commodity.addComparison('gold', 'Gold'); BW.Commodity.removeComparison('gold');
    BW.Commodity.addComparison('gold', 'Gold');
    current.resolve({ok:true, json:async () => ({data:{history:[{date:'2025-01-01',price:20}]}})});
    await flushPromises();
    old.resolve({ok:true,json:async () => ({data:{history:[{date:'2025-01-01',price:999}]}})});
    await flushPromises();
    expect(BW.Commodity.comparisonData.gold.history[0].price).toBe(20);
  });

  test('selection keeps the picker open and restores option focus through asynchronous redraws', async () => {
    document.body.innerHTML = '<div id="compare-menu-container"><button id="compare-menu-btn" aria-expanded="true"></button><div id="compare-menu" aria-hidden="false"><input id="compare-search"><p id="compare-status"></p><div id="compare-list"></div></div></div>';
    const deferred = createDeferred(); global.fetch = jest.fn(() => deferred.promise);
    BW.Commodity.renderCompareList = renderList;
    BW.Commodity.allCommoditiesList = [{id:'oil',name:'Oil',category:'energy'}];
    BW.Commodity.renderCompareList('');
    const option = document.querySelector('[data-compare-id="oil"]'); option.focus(); option.click();
    expect(document.getElementById('compare-menu').getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement.dataset.compareId).toBe('oil');
    deferred.resolve({ok:true,json:async () => ({data:{history:[{date:'2025-01-01',price:20}]}})});
    await flushPromises();
    expect(document.getElementById('compare-menu').getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement.dataset.compareId).toBe('oil');
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
  });
});
