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

describe('Commodity timer race handling', () => {
  let originalCreateElement;

  async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    jest.useFakeTimers();

    document.body.innerHTML = `
      <span id="copy-icon"></span>
      <span id="check-icon" class="hidden"></span>
    `;

    global.BW = {};

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: jest.fn().mockResolvedValue(undefined)
      },
      configurable: true
    });

    originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        el.click = jest.fn();
      }
      return el;
    });

    loadCommodityScript();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('copy feedback timer keeps latest copy visible until newest timeout', async () => {
    window.copyPrice('100');
    await flushPromises();

    expect(document.getElementById('copy-icon').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('check-icon').classList.contains('hidden')).toBe(false);

    jest.advanceTimersByTime(1000);

    window.copyPrice('200');
    await flushPromises();

    // Old timer boundary (1500ms from first call) should not reset latest feedback
    jest.advanceTimersByTime(500);
    expect(document.getElementById('copy-icon').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('check-icon').classList.contains('hidden')).toBe(false);

    // New timer boundary (1500ms from second call) performs reset
    jest.advanceTimersByTime(1000);
    expect(document.getElementById('copy-icon').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('check-icon').classList.contains('hidden')).toBe(true);
  });

  test('export image ignores stale delayed callback when called repeatedly', () => {
    const chartOld = { toBase64Image: jest.fn(() => 'data:image/png;base64,old') };
    const chartNew = { toBase64Image: jest.fn(() => 'data:image/png;base64,new') };

    BW.Commodity.priceChart = chartOld;
    BW.Commodity.exportImage();

    BW.Commodity.priceChart = chartNew;
    BW.Commodity.exportImage();

    jest.runAllTimers();

    expect(chartOld.toBase64Image).not.toHaveBeenCalled();
    expect(chartNew.toBase64Image).toHaveBeenCalledTimes(1);
  });
});
