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

describe('Commodity compare list lifecycle', () => {
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
      <div id="compare-menu" class=""></div>
      <button id="compare-menu-btn" aria-expanded="true"></button>
      <input id="compare-search" value="" />
      <div id="compare-list"></div>
    `;

    originalFetch = global.fetch;

    global.BW = {
      Utils: {
        buildCommoditiesApiUrl: () => '/api/commodities',
        getCommoditiesFromApiResponse: response => response.data || []
      }
    };

    loadCommodityScript();
    BW.Commodity.commodityId = 'wti_oil';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('does not render compare list after menu close invalidates pending request', async () => {
    const deferred = createDeferred();
    global.fetch = jest.fn().mockImplementation(() => deferred.promise);

    const renderSpy = jest.spyOn(BW.Commodity, 'renderCompareList').mockImplementation(() => {});

    BW.Commodity.loadCompareList();
    BW.Commodity.closeCompareMenu();

    deferred.resolve({
      json: () => Promise.resolve({
        data: [{ id: 'gold', name: 'Gold', category: 'Metals' }]
      })
    });

    await flushPromises();

    expect(renderSpy).not.toHaveBeenCalled();
  });

  test('dedupes concurrent compare list loads while request is in flight', () => {
    const deferred = createDeferred();
    global.fetch = jest.fn().mockImplementation(() => deferred.promise);

    BW.Commodity.loadCompareList();
    BW.Commodity.loadCompareList();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
