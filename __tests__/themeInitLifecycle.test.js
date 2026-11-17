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

    const getThemeSpy = BW.Settings._getRaw;
    const getMarketSpy = BW.Settings.getMarketTheme;

    getThemeSpy.mockClear();
    getMarketSpy.mockClear();

    BW.Theme.init();
    BW.Theme.init();

    expect(getThemeSpy).toHaveBeenCalledTimes(1);
    expect(getMarketSpy).toHaveBeenCalledTimes(1);
    expect(BW.Settings.setTheme).not.toHaveBeenCalled();
    expect(BW.Settings.setMarketTheme).not.toHaveBeenCalled();

    BW.Theme.init(true);

    expect(getThemeSpy).toHaveBeenCalledTimes(2);
    expect(getMarketSpy).toHaveBeenCalledTimes(2);
  });
});
