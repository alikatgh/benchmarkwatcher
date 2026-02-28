/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadCompactTableScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'compact_table.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('Compact table sparkline race handling', () => {
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
    document.body.innerHTML = `<table id="data-table"></table>`;

    originalFetch = global.fetch;

    global.BW = {
      Utils: {
        buildCommoditiesApiUrl: ({ range }) => `/api/commodities?range=${range}`,
        getCommoditiesFromApiResponse: response => response.data || []
      }
    };

    loadCompactTableScript();
    BW.CompactTable.initSparklines = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('ignores stale out-of-order sparkline response', async () => {
    const first = createDeferred();
    const second = createDeferred();

    global.fetch = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    BW.CompactTable.requestSparklineData('1W', null);
    BW.CompactTable.requestSparklineData('1M', null);

    first.resolve({
      json: () => Promise.resolve({ data: [{ commodity_id: 'old' }] })
    });
    await flushPromises();

    expect(BW.CompactTable.initSparklines).not.toHaveBeenCalled();

    second.resolve({
      json: () => Promise.resolve({ data: [{ commodity_id: 'new' }] })
    });
    await flushPromises();

    expect(BW.CompactTable.initSparklines).toHaveBeenCalledTimes(1);
    expect(BW.CompactTable.initSparklines).toHaveBeenCalledWith([{ commodity_id: 'new' }]);
  });
});
