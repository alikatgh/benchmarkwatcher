/**
 * @jest-environment jsdom
 *
 * __tests__/settingsExtended.test.js
 *
 * Extended unit tests for BW.Settings covering:
 *   - Table settings (getTableSettings / saveTableSettings / resetTableSettings)
 *   - Grid settings  (getGridSettings / saveGridSettings)
 *   - Theme helpers  (getTheme / setTheme / getMarketTheme / setMarketTheme)
 *   - View mode      (getViewMode / setViewMode)
 *   - _clearAll
 *   - Memory-store fallback when localStorage is unavailable
 *   - Deep-merge behaviour in getTableSettings
 *   - bw.settings.changed event emission
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'settings.js');

function freshLoad() {
    // Reset BW namespace and reload the script so the IIFE re-executes.
    window.BW = {};
    const code = fs.readFileSync(SETTINGS_PATH, 'utf8');
    window.eval(code);
}

function makeStore() {
    const store = {};
    return {
        getItem: jest.fn(k => store[k] ?? null),
        setItem: jest.fn((k, v) => { store[k] = v; }),
        removeItem: jest.fn(k => { delete store[k]; }),
        _store: store,
    };
}

// ─── Helper: define a fresh localStorage mock for each describe block ─────────
function setupLocalStorage() {
    const ls = makeStore();
    Object.defineProperty(window, 'localStorage', {
        value: ls,
        configurable: true,
        writable: true,
    });
    return ls;
}

// =============================================================================
// Table settings
// =============================================================================
describe('BW.Settings — table settings', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('getTableSettings returns defaults when nothing is stored', () => {
        const s = BW.Settings.getTableSettings();
        expect(s.dataRange).toBe('1Y');
        expect(s.panelOpen).toBe(false);
        expect(s.columns.commodity).toBe(true);
    });

    test('saveTableSettings persists settings and getTableSettings returns them', () => {
        const settings = { ...BW.Settings.TABLE_DEFAULTS, dataRange: '6M' };
        const saved = BW.Settings.saveTableSettings(settings);
        expect(saved).toBe(true);

        const loaded = BW.Settings.getTableSettings();
        expect(loaded.dataRange).toBe('6M');
    });

    test('saveTableSettings rejects non-object input', () => {
        expect(BW.Settings.saveTableSettings('bad')).toBe(false);
        expect(BW.Settings.saveTableSettings(null)).toBe(false);
        expect(BW.Settings.saveTableSettings(42)).toBe(false);
    });

    test('getTableSettings deep-merges stored settings over defaults', () => {
        // Partial update: only change dataRange and one nested field
        BW.Settings.saveTableSettings({ dataRange: '3M', trend: { type: 'line', points: '30', showMA: false, showHighLow: false } });
        const loaded = BW.Settings.getTableSettings();
        // Changed field
        expect(loaded.dataRange).toBe('3M');
        expect(loaded.trend.type).toBe('line');
        // Fields from defaults that weren't stored should still be present
        expect(loaded.columns.commodity).toBe(true);
        expect(loaded.price.format).toBe('default');
    });

    test('resetTableSettings removes stored settings and returns defaults', () => {
        BW.Settings.saveTableSettings({ ...BW.Settings.TABLE_DEFAULTS, dataRange: '5Y' });
        BW.Settings.resetTableSettings();

        const s = BW.Settings.getTableSettings();
        expect(s.dataRange).toBe('1Y'); // back to defaults
    });

    test('TABLE_DEFAULTS is frozen-like (does not mutate between calls)', () => {
        const s1 = BW.Settings.getTableSettings();
        s1.dataRange = 'MUTATED';
        const s2 = BW.Settings.getTableSettings();
        // The original defaults should be intact
        expect(s2.dataRange).toBe('1Y');
    });
});

// =============================================================================
// Grid settings
// =============================================================================
describe('BW.Settings — grid settings', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('getGridSettings returns fallback when nothing is stored', () => {
        const s = BW.Settings.getGridSettings();
        expect(s).toEqual({ dataRange: '1Y' });
    });

    test('saveGridSettings persists and getGridSettings returns them', () => {
        const saved = BW.Settings.saveGridSettings({ dataRange: '6M', foo: 'bar' });
        expect(saved).toBe(true);

        const loaded = BW.Settings.getGridSettings();
        expect(loaded.dataRange).toBe('6M');
        expect(loaded.foo).toBe('bar');
    });

    test('saveGridSettings rejects non-object input', () => {
        expect(BW.Settings.saveGridSettings('oops')).toBe(false);
        expect(BW.Settings.saveGridSettings(null)).toBe(false);
    });
});

// =============================================================================
// Theme helpers
// =============================================================================
describe('BW.Settings — theme helpers', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('getTheme returns "light" by default', () => {
        expect(BW.Settings.getTheme()).toBe('light');
    });

    test('setTheme persists and getTheme returns it', () => {
        BW.Settings.setTheme('dark');
        expect(BW.Settings.getTheme()).toBe('dark');
    });

    test('setTheme ignores non-string values', () => {
        BW.Settings.setTheme(42); // should not throw; value not stored as a theme
        // getTheme still returns previous value (or 'light' default)
        const val = BW.Settings.getTheme();
        expect(typeof val).toBe('string');
    });

    test('getMarketTheme returns "western" by default', () => {
        expect(BW.Settings.getMarketTheme()).toBe('western');
    });

    test('setMarketTheme persists and getMarketTheme returns it', () => {
        BW.Settings.setMarketTheme('asian');
        expect(BW.Settings.getMarketTheme()).toBe('asian');
    });

    test('setMarketTheme ignores non-string values', () => {
        expect(() => BW.Settings.setMarketTheme(null)).not.toThrow();
    });
});

// =============================================================================
// View mode
// =============================================================================
describe('BW.Settings — view mode', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('getViewMode returns "compact" by default', () => {
        expect(BW.Settings.getViewMode()).toBe('compact');
    });

    test('setViewMode persists and getViewMode returns it', () => {
        BW.Settings.setViewMode('grid');
        expect(BW.Settings.getViewMode()).toBe('grid');
    });

    test('setViewMode ignores non-string values', () => {
        expect(() => BW.Settings.setViewMode(null)).not.toThrow();
        // After bad call the mode should still be a string
        const val = BW.Settings.getViewMode();
        expect(typeof val).toBe('string');
    });
});

// =============================================================================
// _clearAll
// =============================================================================
describe('BW.Settings — _clearAll', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('_clearAll removes all known keys', () => {
        BW.Settings.setTheme('dark');
        BW.Settings.setViewMode('grid');
        BW.Settings.saveGridSettings({ dataRange: '6M' });

        BW.Settings._clearAll();

        // After clearing, each getter should return its default
        expect(BW.Settings.getTheme()).toBe('light');
        expect(BW.Settings.getViewMode()).toBe('compact');
        expect(BW.Settings.getGridSettings()).toEqual({ dataRange: '1Y' });
    });
});

// =============================================================================
// bw.settings.changed event emission
// =============================================================================
describe('BW.Settings — event emission', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('saveTableSettings fires bw.settings.changed', () => {
        const handler = jest.fn();
        window.addEventListener('bw.settings.changed', handler);

        BW.Settings.saveTableSettings({ ...BW.Settings.TABLE_DEFAULTS });

        window.removeEventListener('bw.settings.changed', handler);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.key).toBe('table-settings');
    });

    test('setTheme fires bw.settings.changed with THEME key', () => {
        const handler = jest.fn();
        window.addEventListener('bw.settings.changed', handler);

        BW.Settings.setTheme('mono-dark');

        window.removeEventListener('bw.settings.changed', handler);
        expect(handler).toHaveBeenCalledTimes(1);
        const detail = handler.mock.calls[0][0].detail;
        expect(detail.key).toBe('theme');
        expect(detail.value).toBe('mono-dark');
    });

    test('resetTableSettings fires bw.settings.changed with null value', () => {
        const handler = jest.fn();
        window.addEventListener('bw.settings.changed', handler);

        BW.Settings.resetTableSettings();

        window.removeEventListener('bw.settings.changed', handler);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.value).toBeNull();
    });
});

// =============================================================================
// Memory-store fallback (localStorage unavailable)
// =============================================================================
describe('BW.Settings — memory-store fallback', () => {
    beforeEach(() => {
        // Simulate missing localStorage by making getItem/setItem throw
        Object.defineProperty(window, 'localStorage', {
            get: () => { throw new Error('localStorage blocked'); },
            configurable: true,
        });
        freshLoad();
    });

    afterEach(() => {
        // Restore a normal localStorage for subsequent tests
        const ls = makeStore();
        Object.defineProperty(window, 'localStorage', {
            value: ls,
            configurable: true,
            writable: true,
        });
    });

    test('setTheme succeeds via in-memory store', () => {
        expect(() => BW.Settings.setTheme('bloomberg')).not.toThrow();
        expect(BW.Settings.getTheme()).toBe('bloomberg');
    });

    test('setViewMode succeeds via in-memory store', () => {
        expect(() => BW.Settings.setViewMode('grid')).not.toThrow();
        expect(BW.Settings.getViewMode()).toBe('grid');
    });

    test('saveTableSettings succeeds via in-memory store', () => {
        const result = BW.Settings.saveTableSettings({ ...BW.Settings.TABLE_DEFAULTS, dataRange: '3M' });
        expect(result).toBe(true);
        expect(BW.Settings.getTableSettings().dataRange).toBe('3M');
    });
});

// =============================================================================
// KEYS constant is frozen / correct values
// =============================================================================
describe('BW.Settings — KEYS constant', () => {
    beforeEach(() => {
        setupLocalStorage();
        freshLoad();
    });

    test('KEYS exposes all expected keys', () => {
        expect(BW.Settings.KEYS.TABLE).toBe('table-settings');
        expect(BW.Settings.KEYS.GRID).toBe('grid-settings');
        expect(BW.Settings.KEYS.CHART_SETTINGS).toBe('chart-settings');
        expect(BW.Settings.KEYS.THEME).toBe('theme');
        expect(BW.Settings.KEYS.MARKET_THEME).toBe('market-theme');
        expect(BW.Settings.KEYS.VIEW_MODE).toBe('view-mode');
    });

    test('KEYS is frozen (mutation is silently rejected)', () => {
        // Object.freeze() in non-strict mode silently ignores assignment
        // attempts — no throw, but the value stays unchanged.
        const original = BW.Settings.KEYS.TABLE;
        try { BW.Settings.KEYS.TABLE = 'hacked'; } catch (e) { /* strict-mode host: ok */ }
        expect(BW.Settings.KEYS.TABLE).toBe(original);
    });
});
