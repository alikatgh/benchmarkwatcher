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

describe('Commodity global listener idempotency', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="download-menu-container"></div>
      <div id="compare-menu-container"></div>
    `;

    delete window.__bwCommodityGlobalHandlersBound;
    delete window.__bwCommodityGlobalKeydownBound;

    global.BW = {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Escape key handler fires once even when script is loaded twice', () => {
    loadCommodityScript();
    loadCommodityScript();

    const closeDownloadSpy = jest.spyOn(BW.Commodity, 'closeDownloadMenu').mockImplementation(() => {});
    const closeCompareSpy = jest.spyOn(BW.Commodity, 'closeCompareMenu').mockImplementation(() => {});
    const closeSettingsSpy = jest.spyOn(BW.Commodity, 'closeChartSettings').mockImplementation(() => {});

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closeDownloadSpy).toHaveBeenCalledTimes(1);
    expect(closeCompareSpy).toHaveBeenCalledTimes(1);
    expect(closeSettingsSpy).toHaveBeenCalledTimes(1);
  });
});
