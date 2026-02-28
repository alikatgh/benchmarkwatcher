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

describe('Commodity compare list async search behavior', () => {
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

  test('uses live search query when compare list fetch resolves', async () => {
    const deferred = createDeferred();
    global.fetch = jest.fn().mockImplementation(() => deferred.promise);

    const renderSpy = jest.spyOn(BW.Commodity, 'renderCompareList').mockImplementation(() => {});

    BW.Commodity.loadCompareList();
    document.getElementById('compare-search').value = 'go';

    deferred.resolve({
      json: () => Promise.resolve({
        data: [{ id: 'gold', name: 'Gold', category: 'Metals' }]
      })
    });

    await flushPromises();

    expect(renderSpy).toHaveBeenCalledWith('go');
  });
});
