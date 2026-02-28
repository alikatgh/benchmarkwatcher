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

describe('Compact table bootstrap lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <table id="data-table">
        <tbody id="commodities-tbody"></tbody>
      </table>
      <div id="table-loading" class="hidden"></div>
    `;

    delete window.__bwCompactTableDomReadyBound;
    delete window.__bwCompactTableSortState;

    global.BW = {
      Settings: {
        getTableSettings: jest.fn(() => ({
          dataRange: 'ALL',
          panelOpen: false,
          columns: { commodity: true, trend: true, price: true, chg: true, pct: true, updated: true },
          commodity: { display: 'full', icon: 'initials' },
          trend: { type: 'area', points: '30', showMA: false, showHighLow: false },
          price: { format: 'default', currency: 'below', precision: '2' },
          chg: { format: 'arrow', color: 'colored' },
          pct: { style: 'badge', decimals: '2' },
          updated: { format: 'iso', time: 'no' }
        })),
        saveTableSettings: jest.fn()
      },
      Utils: {
        buildCommoditiesApiUrl: jest.fn(() => '/api/commodities'),
        getCommoditiesFromApiResponse: jest.fn(() => [])
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('DOMContentLoaded init runs once even when script is loaded twice', () => {
    loadCompactTableScript();
    loadCompactTableScript();

    const initSpy = jest.fn();
    BW.CompactTable.init = initSpy;

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  test('sort state is stored on window', () => {
    loadCompactTableScript();

    expect(window.__bwCompactTableSortState).toEqual({
      currentSortColumn: null,
      currentSortDirection: 'asc'
    });
  });
});
