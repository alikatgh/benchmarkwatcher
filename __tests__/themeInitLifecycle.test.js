/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadThemeScript() {
  const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'theme.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  eval(code);
}

describe('BW.Theme init lifecycle', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-market');

    delete window.__bwThemeDomReadyBound;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({ matches: false })),
    });

    global.BW = {
      Settings: {
        KEYS: { THEME: 'theme', MARKET_THEME: 'market-theme' },
        _getRaw: jest.fn(() => null),
        getTheme: jest.fn(() => 'light'),
        getMarketTheme: jest.fn(() => 'western'),
        setTheme: jest.fn(),
        setMarketTheme: jest.fn(),
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('binds a single DOMContentLoaded init call across duplicate script loads', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'loading'
    });

    loadThemeScript();
    loadThemeScript();

    const initSpy = jest.fn();
    BW.Theme.init = initSpy;

    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  test('init is idempotent unless forced', () => {
    loadThemeScript();

    const setThemeSpy = BW.Settings.setTheme;
    const setMarketSpy = BW.Settings.setMarketTheme;

    setThemeSpy.mockClear();
    setMarketSpy.mockClear();

    BW.Theme.init();
    BW.Theme.init();

    expect(setThemeSpy).toHaveBeenCalledTimes(1);
    expect(setMarketSpy).toHaveBeenCalledTimes(1);

    BW.Theme.init(true);

    expect(setThemeSpy).toHaveBeenCalledTimes(2);
    expect(setMarketSpy).toHaveBeenCalledTimes(2);
  });
});
