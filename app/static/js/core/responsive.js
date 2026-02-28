/**
 * BW.Responsive — Intelligent adaptive layout module
 *
 * Responsibilities:
 *   R2: Auto-select view mode on first visit based on device class
 *   R3: Auto-hide low-priority table columns on narrow viewports
 *
 * Device class breakpoints (set as data-device-class on <html>):
 *   xs   < 480px   (phones, portrait)
 *   sm   480-767   (phones landscape, small tablets)
 *   md   768-1199  (tablets, small laptops)
 *   lg   1200-1399 (laptops, standard desktops)
 *   xl   ≥ 1400    (large monitors, 4K)
 *
 * Contract with other modules:
 *   - Reads/writes BW.Settings (never raw localStorage)
 *   - Sets document.documentElement.dataset.deviceClass
 *   - BW.CompactTable.setColumnVisibility() must exist before applyColumnPriority() runs
 *   - Must be loaded before index.js
 */

window.BW = window.BW || {};

BW.Responsive = (function () {
    // ─── Constants ───────────────────────────────────────────────────────────
    const BREAKPOINTS = { xs: 480, sm: 768, md: 1200, lg: 1400 };

    // Columns to auto-hide on xs/sm (heaviest to render, smallest value on narrow screens)
    const PRIORITY_HIDE = {
        xs: ['trend', 'updated', 'source'],
        sm: ['trend', 'updated'],
        md: [],
        lg: [],
        xl: [],
    };

    // ─── Internal state ──────────────────────────────────────────────────────
    let _deviceClass = 'md';
    let _resizeObserver = null;
    let _isFirstVisit = false;

    // ─── Helpers ─────────────────────────────────────────────────────────────
    function getViewportWidth() {
        return window.innerWidth || document.documentElement.clientWidth || 768;
    }

    function computeDeviceClass(w) {
        if (w < BREAKPOINTS.xs) return 'xs';
        if (w < BREAKPOINTS.sm) return 'sm';
        if (w < BREAKPOINTS.md) return 'md';
        if (w < BREAKPOINTS.lg) return 'lg';
        return 'xl';
    }

    function isTouch() {
        try {
            return window.matchMedia('(pointer: coarse)').matches;
        } catch (e) {
            return false;
        }
    }

    function isFirstVisit() {
        // First visit = no stored view-mode preference
        if (window.BW && BW.Settings && typeof BW.Settings._getRaw === 'function') {
            const key = (BW.Settings.KEYS && BW.Settings.KEYS.VIEW_MODE) || 'view-mode';
            return BW.Settings._getRaw(key) === null;
        }

        try {
            return localStorage.getItem('view-mode') === null;
        } catch (e) {
            return true;
        }
    }

    // ─── Device class management ──────────────────────────────────────────────
    function updateDeviceClass() {
        const w = getViewportWidth();
        const dc = computeDeviceClass(w);
        if (dc !== _deviceClass) {
            _deviceClass = dc;
            document.documentElement.dataset.deviceClass = dc;
            window.dispatchEvent(new CustomEvent('bw.responsive.classchange', {
                detail: { deviceClass: dc, width: w }
            }));
        }
    }

    // ─── R2: Auto view-mode selection ─────────────────────────────────────────
    function autoSelectView() {
        if (!_isFirstVisit) return; // respect user's saved preference

        const w = getViewportWidth();
        const touch = isTouch();

        // Compact on phones/small devices or touch devices ≤ sm breakpoint
        const preferCompact = (w < BREAKPOINTS.sm) || (touch && w < BREAKPOINTS.md);

        const mode = preferCompact ? 'compact' : 'grid';

        // Write via BW.Settings so the emitted event is correct
        if (window.BW && BW.Settings) {
            BW.Settings.setViewMode(mode);
        } else {
            // Fallback: write directly (BW.Settings not yet loaded, rare)
            try { localStorage.setItem('view-mode', mode); } catch (e) { /* noop */ }
        }
    }

    // ─── R3: Priority column hiding on narrow viewports ───────────────────────
    function applyColumnPriority() {
        const colsToHide = PRIORITY_HIDE[_deviceClass] || [];

        // Wait for BW.CompactTable to be available
        if (!window.BW || !BW.CompactTable || typeof BW.CompactTable.setColumnVisibility !== 'function') {
            return; // will be retried via resize observer or manual call
        }

        // Restore all responsive-hidden columns first (clean slate on resize)
        const allCols = ['trend', 'updated', 'source', 'ytd', 'range'];
        allCols.forEach(col => {
            const header = document.querySelector(`th[data-col="${col}"]`);
            if (header && header.dataset.responsiveHidden === 'true') {
                BW.CompactTable.setColumnVisibility(col, true);
                header.dataset.responsiveHidden = '';
            }
        });

        // Hide priority columns for current device class
        colsToHide.forEach(col => {
            const header = document.querySelector(`th[data-col="${col}"]`);
            if (header && header.dataset.responsiveHidden !== 'true') {
                BW.CompactTable.setColumnVisibility(col, false);
                header.dataset.responsiveHidden = 'true';
            }
        });
    }

    // ─── ResizeObserver for continuous adaptation ────────────────────────────
    function setupResizeObserver() {
        if (typeof ResizeObserver === 'undefined') return;

        if (_resizeObserver && typeof _resizeObserver.disconnect === 'function') {
            _resizeObserver.disconnect();
        }

        _resizeObserver = new ResizeObserver(() => {
            updateDeviceClass();
            applyColumnPriority();
        });

        _resizeObserver.observe(document.documentElement);
    }

    // ─── Public API ──────────────────────────────────────────────────────────
    return {
        /**
         * autoApply() — call this BEFORE BW.Index.init() renders containers.
         * Sets device class, runs view-mode auto-selection.
         */
        autoApply: function () {
            _isFirstVisit = isFirstVisit();
            updateDeviceClass();
            autoSelectView();
        },

        /**
         * initAfterDOM() — call after DOMContentLoaded.
         * Sets up column priority hiding and resize observation.
         */
        initAfterDOM: function () {
            applyColumnPriority();
            setupResizeObserver();
        },

        getDeviceClass: function () { return _deviceClass; },
        isFirstVisit: function () { return _isFirstVisit; },

        // Manual trigger (for testing or external callers)
        applyColumnPriority: applyColumnPriority,
    };
})();

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// autoApply runs synchronously (called from index.js before containers render)
// initAfterDOM runs on DOMContentLoaded to wire up resize observer + columns
document.addEventListener('DOMContentLoaded', function () {
    BW.Responsive.initAfterDOM();
});
