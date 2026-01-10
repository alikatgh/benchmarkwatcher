/**
 * BenchmarkWatcher - Settings Module (hardened)
 * - safe JSON parse/stringify
 * - in-memory fallback when localStorage is unavailable
 * - deep merge of defaults (preserves nested properties)
 * - emits a CustomEvent 'bw.settings.changed' on saves
 */

window.BW = window.BW || {};

BW.Settings = (function () {
    // in-memory fallback store used when localStorage is unavailable
    const _memoryStore = {};

    // Utility: safe JSON parse
    function safeParse(str) {
        try {
            return str == null ? null : JSON.parse(str);
        } catch (e) {
            console.warn('BW.Settings: JSON parse failed, returning null.', e);
            return null;
        }
    }

    // Utility: safe stringify (handles circular by throwing and catching)
    function safeStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            console.warn('BW.Settings: JSON stringify failed.', e);
            return null;
        }
    }

    // Utility: deep merge (source -> target), returns new object
    function deepMerge(target, source) {
        if (!source) return JSON.parse(JSON.stringify(target));
        const out = Array.isArray(target) ? target.slice() : { ...target };
        Object.keys(source).forEach(key => {
            const srcVal = source[key];
            const tgtVal = out[key];
            if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
                out[key] = deepMerge(tgtVal, srcVal);
            } else {
                out[key] = srcVal;
            }
        });
        return out;
    }

    function isPlainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v);
    }

    // Safe wrappers around localStorage (fall back to in-memory store)
    function lsGetItem(key) {
        try {
            if (typeof localStorage === 'undefined') throw new Error('localStorage undefined');
            return localStorage.getItem(key);
        } catch (e) {
            // fallback
            return _memoryStore[key] ?? null;
        }
    }

    function lsSetItem(key, value) {
        try {
            if (typeof localStorage === 'undefined') throw new Error('localStorage undefined');
            localStorage.setItem(key, value);
        } catch (e) {
            _memoryStore[key] = value;
            console.warn('BW.Settings: localStorage.setItem failed, used in-memory store.', e);
        }
    }

    function lsRemoveItem(key) {
        try {
            if (typeof localStorage === 'undefined') throw new Error('localStorage undefined');
            localStorage.removeItem(key);
        } catch (e) {
            delete _memoryStore[key];
            console.warn('BW.Settings: localStorage.removeItem failed, used in-memory store.', e);
        }
    }

    // Emit change event so other modules can listen
    function emitChange(key, value) {
        try {
            const ev = new CustomEvent('bw.settings.changed', { detail: { key, value } });
            window.dispatchEvent(ev);
        } catch (e) {
            // ignore if CustomEvent blocked
        }
    }

    // Public API
    return {
        // Storage keys (frozen to avoid accidental mutation)
        KEYS: Object.freeze({
            TABLE: 'table-settings',
            GRID: 'grid-settings',
            THEME: 'theme',
            MARKET_THEME: 'market-theme',
            VIEW_MODE: 'view-mode'
        }),

        // Default table settings (unchanged shape, used via deep merge)
        TABLE_DEFAULTS: {
            dataRange: 'ALL',
            panelOpen: false,
            columns: {
                commodity: true,
                trend: true,
                price: true,
                chg: true,
                pct: true,
                updated: true
            },
            commodity: { display: 'full', icon: 'initials' },
            trend: { type: 'area', points: '30', showMA: false, showHighLow: false },
            price: { format: 'default', currency: 'below', precision: '2' },
            chg: { format: 'arrow', color: 'colored' },
            pct: { style: 'badge', decimals: '2' },
            updated: { format: 'iso', time: 'no' }
        },

        // Low-level get (returns raw string or null)
        _getRaw: function (key) {
            return lsGetItem(key);
        },

        // Low-level set (accepts string)
        _setRaw: function (key, str) {
            lsSetItem(key, str);
        },

        // Low-level remove
        _removeRaw: function (key) {
            lsRemoveItem(key);
        },

        // Get parsed JSON safely
        _getParsed: function (key) {
            const raw = this._getRaw(key);
            return safeParse(raw);
        },

        // Save object as JSON safely
        _saveObject: function (key, obj) {
            const raw = safeStringify(obj);
            if (raw === null) {
                // If stringify failed, don't write corrupted data
                console.warn('BW.Settings: not saving because stringify failed for key:', key);
                return false;
            }
            this._setRaw(key, raw);
            emitChange(key, obj);
            return true;
        },

        // Get table settings merged with defaults (deep merge)
        getTableSettings: function () {
            const parsed = this._getParsed(this.KEYS.TABLE);
            if (!parsed) return JSON.parse(JSON.stringify(this.TABLE_DEFAULTS));
            return deepMerge(this.TABLE_DEFAULTS, parsed);
        },

        // Save table settings (object)
        saveTableSettings: function (settings) {
            if (!isPlainObject(settings)) {
                console.warn('BW.Settings.saveTableSettings: expected object');
                return false;
            }
            return this._saveObject(this.KEYS.TABLE, settings);
        },

        // Get grid settings (safe fallback shape)
        getGridSettings: function () {
            const parsed = this._getParsed(this.KEYS.GRID);
            if (!parsed) return { dataRange: 'ALL' };
            return parsed;
        },

        // Save grid settings
        saveGridSettings: function (settings) {
            if (!isPlainObject(settings)) {
                console.warn('BW.Settings.saveGridSettings: expected object');
                return false;
            }
            return this._saveObject(this.KEYS.GRID, settings);
        },

        // Theme helpers
        getTheme: function () {
            const val = this._getRaw(this.KEYS.THEME);
            return val === null ? 'light' : val;
        },

        setTheme: function (theme) {
            if (typeof theme !== 'string') {
                console.warn('BW.Settings.setTheme: theme should be string');
                return;
            }
            this._setRaw(this.KEYS.THEME, theme);
            emitChange(this.KEYS.THEME, theme);
        },

        // Market theme
        getMarketTheme: function () {
            const val = this._getRaw(this.KEYS.MARKET_THEME);
            return val === null ? 'western' : val;
        },

        setMarketTheme: function (theme) {
            if (typeof theme !== 'string') {
                console.warn('BW.Settings.setMarketTheme: theme should be string');
                return;
            }
            this._setRaw(this.KEYS.MARKET_THEME, theme);
            emitChange(this.KEYS.MARKET_THEME, theme);
        },

        // View mode
        getViewMode: function () {
            const val = this._getRaw(this.KEYS.VIEW_MODE);
            return val === null ? 'grid' : val;
        },

        setViewMode: function (mode) {
            if (typeof mode !== 'string') {
                console.warn('BW.Settings.setViewMode: mode should be string');
                return;
            }
            this._setRaw(this.KEYS.VIEW_MODE, mode);
            emitChange(this.KEYS.VIEW_MODE, mode);
        },

        // Reset table settings back to defaults (removes stored key)
        resetTableSettings: function () {
            this._removeRaw(this.KEYS.TABLE);
            emitChange(this.KEYS.TABLE, null);
        },

        // Convenience: clear all stored keys (useful for dev/testing)
        _clearAll: function () {
            Object.values(this.KEYS).forEach(k => this._removeRaw(k));
            emitChange('bw.settings.cleared', null);
        }
    };
})();
