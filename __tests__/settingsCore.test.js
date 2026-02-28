/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

function loadSettingsScript() {
    const scriptPath = path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'settings.js');
    const code = fs.readFileSync(scriptPath, 'utf8');
    window.eval(code);
}

describe('BW.Settings chart settings helpers', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: jest.fn((k) => window.__store[k] ?? null),
                setItem: jest.fn((k, v) => { window.__store[k] = v; }),
                removeItem: jest.fn((k) => { delete window.__store[k]; }),
            },
            configurable: true,
        });

        window.__store = {};
        window.BW = {};
        loadSettingsScript();
    });

    test('exposes CHART_SETTINGS key', () => {
        expect(BW.Settings.KEYS.CHART_SETTINGS).toBe('chart-settings');
    });

    test('saves and reads chart settings via canonical helpers', () => {
        const payload = { lineColor: '#112233', chartHeight: 480 };

        const saved = BW.Settings.saveChartSettings(payload);
        expect(saved).toBe(true);

        const loaded = BW.Settings.getChartSettings();
        expect(loaded).toEqual(payload);
    });

    test('returns null for missing chart settings', () => {
        expect(BW.Settings.getChartSettings()).toBeNull();
    });
});
