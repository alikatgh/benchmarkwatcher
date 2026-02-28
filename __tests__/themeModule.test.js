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

describe('BW.Theme stored preference detection', () => {
    beforeEach(() => {
        document.documentElement.className = '';
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('data-market');

        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: jest.fn().mockImplementation(() => ({ matches: true })),
        });

        global.BW = {};
    });

    test('uses system dark mode when BW.Settings has no stored theme key', () => {
        const setTheme = jest.fn();
        const setMarketTheme = jest.fn();

        global.BW.Settings = {
            KEYS: { THEME: 'theme', MARKET_THEME: 'market-theme' },
            _getRaw: jest.fn((key) => (key === 'theme' ? null : null)),
            getTheme: jest.fn(() => 'light'),
            getMarketTheme: jest.fn(() => 'western'),
            setTheme,
            setMarketTheme,
        };

        loadThemeScript();
        BW.Theme.init();

        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(setTheme).toHaveBeenCalledWith('dark');
    });

    test('respects explicit stored theme even if system prefers dark', () => {
        const setTheme = jest.fn();
        const setMarketTheme = jest.fn();

        global.BW.Settings = {
            KEYS: { THEME: 'theme', MARKET_THEME: 'market-theme' },
            _getRaw: jest.fn((key) => (key === 'theme' ? 'light' : null)),
            getTheme: jest.fn(() => 'light'),
            getMarketTheme: jest.fn(() => 'western'),
            setTheme,
            setMarketTheme,
        };

        loadThemeScript();
        BW.Theme.init();

        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(setTheme).toHaveBeenCalledWith('light');
    });
});
