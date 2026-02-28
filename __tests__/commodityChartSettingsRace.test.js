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

describe('Commodity chart settings delayed focus lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();

    document.body.innerHTML = `
      <button id="settings-trigger">Open chart settings</button>
      <div id="chart-settings-modal" class="hidden" aria-hidden="true">
        <button id="tab-appearance" class="chart-settings-tab">Appearance</button>
        <div id="content-appearance" class="chart-settings-content"></div>
      </div>
    `;

    global.BW = {};
    loadCommodityScript();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not focus hidden chart settings tab after immediate close', () => {
    const trigger = document.getElementById('settings-trigger');
    const modal = document.getElementById('chart-settings-modal');

    trigger.focus();

    BW.Commodity.openChartSettings();
    BW.Commodity.closeChartSettings();

    expect(document.activeElement).toBe(trigger);

    jest.runOnlyPendingTimers();

    expect(modal.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });
});
