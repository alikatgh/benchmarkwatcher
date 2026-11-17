/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

function load(file) {
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', file), 'utf8'));
}

describe('appearance preference across startup, settings, and system changes', () => {
    let store;
    let media;
    let listeners;
    let windowListenerSpy;

    beforeEach(() => {
        store = {};
        listeners = new Set();
        media = {
            matches: true,
            addEventListener: jest.fn((_, callback) => listeners.add(callback)),
        };
        Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => media) });
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: jest.fn(key => store[key] ?? null),
                setItem: jest.fn((key, value) => { store[key] = value; }),
            },
        });
        Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
        document.documentElement.className = '';
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('data-theme-preference');
        document.documentElement.style.colorScheme = '';
        document.body.innerHTML = '<div id="settings-modal"><div><button id="theme-system"></button><button id="theme-dark"></button></div></div>';
        global.BW = {};
        ['__bwBaseThemeListenersBound', '__bwBaseDomReadyBound', '__bwThemeChangeBound', '__bwThemeDomReadyBound', '__bwSettingsModalDomReadyBound'].forEach(key => delete window[key]);
        windowListenerSpy = jest.spyOn(window, 'addEventListener');
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(); return 1; });
    });

    afterEach(() => {
        windowListenerSpy.mock.calls.forEach(([name, callback]) => window.removeEventListener(name, callback));
        jest.restoreAllMocks();
    });

    function start() {
        load('base.js');
        load('core/settings.js');
        load('theme.js');
        load('components/settings_modal.js');
    }

    function changeSystem(dark) {
        media.matches = dark;
        listeners.forEach(callback => callback({ matches: dark }));
    }

    test('first visit stays in system mode through all initializers without saving a manual choice', () => {
        start();
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(document.documentElement.dataset.themePreference).toBe('system');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(store.theme).toBeUndefined();
        expect(document.getElementById('theme-system').getAttribute('aria-pressed')).toBe('true');
        changeSystem(false);
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe('light');
        expect(store.theme).toBeUndefined();
    });

    test.each(['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft'])('preserves stored %s and ignores subsequent system changes', theme => {
        store.theme = theme;
        start();
        changeSystem(false);
        changeSystem(true);
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(document.documentElement.dataset.themePreference).toBe(theme);
        expect(document.documentElement.classList.contains('dark')).toBe(['dark', 'mono-dark', 'bloomberg'].includes(theme));
        expect(store.theme).toBe(theme);
    });

    test('settings can return to system mode, persist it, reload, and follow system changes', () => {
        store.theme = 'ft';
        start();
        document.getElementById('theme-system').click();
        expect(store.theme).toBe('system');
        expect(document.documentElement.dataset.theme).toBe('dark');
        changeSystem(false);
        expect(document.documentElement.dataset.theme).toBe('light');
        start();
        expect(document.documentElement.dataset.themePreference).toBe('system');
        expect(document.documentElement.dataset.theme).toBe('light');
        changeSystem(true);
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(media.addEventListener).toHaveBeenCalledTimes(1);
    });

    test('invalid saved values consistently fall back to system without overriding stored data', () => {
        store.theme = 'invalid';
        store['market-theme'] = 'invalid';
        start();
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(document.documentElement.dataset.themePreference).toBe('system');
        expect(document.documentElement.dataset.market).toBe('western');
        expect(store.theme).toBe('invalid');
        BW.Theme.applyTheme('invalid');
        BW.Theme.applyMarketTheme('invalid');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(document.documentElement.dataset.market).toBe('western');
    });

    test('blocked storage preserves working appearance selection in memory', () => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(start).not.toThrow();
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(() => BW.SettingsModal.setTheme('light')).not.toThrow();
        changeSystem(true);
        BW.SettingsModal.applyTheme();
        expect(document.documentElement.dataset.theme).toBe('light');
        BW.SettingsModal.setTheme('system');
        changeSystem(false);
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.documentElement.dataset.themePreference).toBe('system');
    });

    test('quota failures do not restore the previous readable stored preference during reinit', () => {
        store.theme = 'dark';
        window.localStorage.setItem.mockImplementation(() => { throw new Error('quota'); });
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        start();
        BW.SettingsModal.setTheme('light');
        BW.Theme.init(true);
        BW.SettingsModal.updateUI();
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.documentElement.dataset.themePreference).toBe('light');
        expect(store.theme).toBe('dark');
    });

    test('storage events apply choices from other tabs and removal restores system mode without writing back', () => {
        start();
        window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'ft' }));
        expect(document.documentElement.dataset.theme).toBe('ft');
        changeSystem(false);
        expect(document.documentElement.dataset.theme).toBe('ft');
        window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: null }));
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.documentElement.dataset.themePreference).toBe('system');
        expect(window.localStorage.setItem).not.toHaveBeenCalled();
    });

    test('system changes refresh existing charts with the resolved appearance', () => {
        start();
        BW.Commodity = { chartElement: document.createElement('div'), setupColors: jest.fn(), applyChartTheme: jest.fn() };
        BW.Sparkline = { refresh: jest.fn() };
        changeSystem(false);
        expect(BW.Commodity.applyChartTheme).toHaveBeenCalledWith('light');
        expect(BW.Sparkline.refresh).toHaveBeenCalledTimes(1);
    });

    test('reinitialization of an unchanged appearance does not overwrite existing chart colors', () => {
        start();
        BW.Commodity = { chartElement: document.createElement('div'), setupColors: jest.fn(), applyChartTheme: jest.fn() };
        BW.Theme.init(true);
        BW.SettingsModal.applyTheme();
        expect(BW.Commodity.applyChartTheme).not.toHaveBeenCalled();
    });

    test('sparkline changes follow the selected historical change palette and refresh on selection', () => {
        start();
        BW.Sparkline = { refresh: jest.fn() };
        const colors = { '--color-up': '#f28b82', '--color-down': '#81c995', '--market-up': '#0d7680' };
        jest.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: key => colors[key] || '' });
        BW.SettingsModal.setMarketTheme('asian');
        expect(store['market-theme']).toBe('asian');
        expect(BW.Theme.getSparklineColors().up).toBe('#f28b82');
        expect(BW.Theme.getSparklineColors().down).toBe('#81c995');
        expect(BW.Sparkline.refresh).toHaveBeenCalledTimes(1);
    });

    test.each(['western', 'asian', 'monochrome'])('historical change mode %s survives selection and reload', market => {
        start();
        BW.SettingsModal.setMarketTheme(market);
        expect(store['market-theme']).toBe(market);
        expect(document.documentElement.dataset.market).toBe(market);
        start();
        expect(document.documentElement.dataset.market).toBe(market);
    });

    test('supports legacy media-query listeners', () => {
        delete media.addEventListener;
        media.addListener = jest.fn(callback => listeners.add(callback));
        start();
        changeSystem(false);
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(media.addListener).toHaveBeenCalledTimes(1);
        BW.Base.setTheme('system');
        expect(store.theme).toBe('system');
    });

    test('unavailable media preferences fall back to light without breaking startup', () => {
        window.matchMedia.mockImplementation(() => { throw new Error('unavailable'); });
        expect(start).not.toThrow();
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(document.documentElement.dataset.themePreference).toBe('system');
    });
});
