/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadSettingsModalScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'components', 'settings_modal.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  window.eval(code);
}

describe('Settings modal init lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="settings-modal" class="opacity-0 pointer-events-none" aria-hidden="true">
        <div></div>
      </div>
      <button id="settings-button"></button>
    `;

    delete window.__bwSettingsModalDomReadyBound;

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    global.BW = {
      Settings: {
        getTheme: jest.fn(() => 'light'),
        getViewMode: jest.fn(() => 'grid'),
        getMarketTheme: jest.fn(() => 'western')
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('binds a single DOMContentLoaded init listener across duplicate script loads', () => {
    loadSettingsModalScript();
    loadSettingsModalScript();

    const initSpy = jest.fn();
    BW.SettingsModal.init = initSpy;

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  test('init is idempotent unless forced', () => {
    loadSettingsModalScript();

    const applySpy = jest.spyOn(BW.SettingsModal, 'applyTheme').mockImplementation(() => {});
    const uiSpy = jest.spyOn(BW.SettingsModal, 'updateUI').mockImplementation(() => {});

    BW.SettingsModal.init();
    BW.SettingsModal.init();

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(uiSpy).toHaveBeenCalledTimes(1);

    BW.SettingsModal.init(true);

    expect(applySpy).toHaveBeenCalledTimes(2);
    expect(uiSpy).toHaveBeenCalledTimes(2);
  });

  test('initializes immediately when script loads after DOM is ready', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'complete'
    });

    loadSettingsModalScript();

    expect(BW.SettingsModal._initialized).toBe(true);
  });
});
