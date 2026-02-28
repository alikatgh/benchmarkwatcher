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
    `;

    global.BW = {
      Utils: {
        buildCommoditiesApiUrl: () => '/api/commodities'
      }
    };

    originalFetch = global.fetch;
    loadCommodityScript();

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

    deferred.resolve({
      json: () => Promise.resolve({ data: { history: [{ date: '2025-01-01', price: 1 }] } })
    });

    await flushPromises();

    expect(BW.Commodity.comparisonData.gold).toBeUndefined();
    expect(BW.Commodity.comparisonPendingSeq.gold).toBeUndefined();

    expect(BW.Commodity.updateChart).toHaveBeenCalledTimes(1);
    expect(BW.Commodity.updateCompareBar).toHaveBeenCalledTimes(1);
    expect(BW.Commodity.renderCompareList).toHaveBeenCalledTimes(1);
  });
});
