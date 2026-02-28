/**
 * @jest-environment jsdom
 */

describe('CompactTable race handling', () => {
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
    jest.resetModules();
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });
    document.body.innerHTML = `
      <div id="table-loading" class="hidden"></div>
      <table id="data-table"><tbody id="commodities-tbody"></tbody></table>
      <button class="range-btn" data-range="1W"></button>
      <button class="range-btn" data-range="1M"></button>
      <div id="date-range-display"></div>
    `;

    originalFetch = global.fetch;

    window.BW = window.BW || {};
    window.BW.Utils = {
      buildCommoditiesApiUrl: (params = {}) => {
        const range = params.range || '1M';
        return `/api/commodities?range=${range}`;
      },
      getCommoditiesFromApiResponse: response => response.data || [],
      getCSRFToken: () => ''
    };
    window.BW.Settings = {
      getTableSettings: () => ({
        range: '1M',
        columns: ['commodity', 'trend', 'price', 'chg', 'pct', 'updated'],
        showFrequency: false,
        compactMode: false,
        density: 'normal',
        useRowHighlight: true,
        useHeatmap: true,
        colorBlindSafe: false,
        useMonochrome: false,
        showTrendBars: false,
        showDirectionalArrows: false,
        precision: 2,
        animationEnabled: true,
        zebraBanding: true,
        stickyHeader: true,
        showChangeBars: true,
        highlightNegatives: true,
        showTableBorders: false,
        minimalPalette: false,
        highContrastText: false
      }),
      saveTableSettings: () => {}
    };

    require('../app/static/js/components/compact_table.js');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('ignores stale out-of-order response when a newer range request exists', async () => {
    const first = createDeferred();
    const second = createDeferred();

    global.fetch = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const updateSpy = jest.spyOn(window.BW.CompactTable, 'updateTableData').mockImplementation(() => {});

    window.BW.CompactTable.setDataRange('1W');
    window.BW.CompactTable.setDataRange('1M');

    first.resolve({
      json: () => Promise.resolve({ data: [{ commodity_id: 'old' }] })
    });
    await flushPromises();

    expect(updateSpy).not.toHaveBeenCalled();

    second.resolve({
      json: () => Promise.resolve({ data: [{ commodity_id: 'new' }] })
    });
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith([{ commodity_id: 'new' }]);
  });
});
