/**
 * BenchmarkWatcher - Base/Theme Initialization (improved)
 *
 * NOTE: This file runs early in <head> BEFORE BW.Settings is available,
 * so it has its own safe localStorage wrappers. This is the ONE exception
 * to the "use BW.Settings exclusively" rule, required to prevent FOUC.
 *
 * - defensive localStorage access
 * - fallback to prefers-color-scheme when no saved preference
 * - set data attributes (data-theme / data-market) and .dark class
 * - set aria-pressed and data-active on market buttons
 * - safe global aliases: BW.Base.setMarketTheme, BW.Base.setTheme
 *
 * Usage: include this early (in <head>) to avoid FOUC/flash.
 */

window.BW = window.BW || {};

(function (exports, doc) {
    const HTML = doc.documentElement;
    const MARKET_BTN_SELECTOR = '.market-btn';

    // Safe localStorage access
    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* noop */ }
    }

    // Normalize theme string
    function normalizeTheme(t) {
        if (!t) return null;
        t = String(t).trim();
        // whitelist known themes
        const allowed = ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft', 'mono'];
        return allowed.includes(t) ? t : null;
    }

    // Apply theme to document root immediately
    function applyTheme(theme) {
        if (!theme) return;
        HTML.setAttribute('data-theme', theme);

        const needDark = theme === 'dark' || theme === 'mono-dark' || theme === 'bloomberg';
        if (needDark) HTML.classList.add('dark'); else HTML.classList.remove('dark');
    }

    // Apply market theme to document root
    function applyMarketTheme(market) {
        if (!market) return;
        HTML.setAttribute('data-market', market);
        // update button states (if any exist on page)
        try {
            const btns = doc.querySelectorAll(MARKET_BTN_SELECTOR);
            btns.forEach(btn => {
                const id = btn.id || '';
                const isActive = id === `market-${market}`;
                // Prefer data attribute and ARIA for styling and accessibility
                btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                if (isActive) btn.setAttribute('data-active', 'true'); else btn.removeAttribute('data-active');
            });
        } catch (e) { /* ignore */ }
    }

    // Choose initial theme:
    // 1) stored localStorage
    // 2) prefers-color-scheme
    // 3) fallback 'light'
    function detectInitialTheme() {
        const stored = normalizeTheme(safeGet('theme'));
        if (stored) return stored;

        try {
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return prefersDark ? 'dark' : 'light';
        } catch (e) {
            return 'light';
        }
    }

    // Choose initial market theme (stored or 'western')
    function detectInitialMarket() {
        return safeGet('market-theme') || 'western';
    }

    // Public API: set market theme and persist
    function setMarketTheme(theme) {
        if (!theme) return;
        safeSet('market-theme', theme);
        applyMarketTheme(theme);
    }

    // Public API: set theme and persist
    function setTheme(theme) {
        const t = normalizeTheme(theme);
        if (!t) return;
        safeSet('theme', t);
        applyTheme(t);
    }

    // initTheme runs synchronously to prevent flash (call this immediately)
    function initTheme() {
        const initial = detectInitialTheme();
        applyTheme(initial);
    }

    // initMarketTheme runs synchronously to set data attribute (call this immediately)
    function initMarketTheme() {
        const initial = detectInitialMarket();
        HTML.setAttribute('data-market', initial);
    }

    // On DOM ready, ensure buttons reflect state and wire anything extra
    function initOnReady() {
        applyMarketTheme(safeGet('market-theme') || 'western');

        // If there are explicit market buttons, ensure an accessible role
        try {
            const btns = doc.querySelectorAll(MARKET_BTN_SELECTOR);
            btns.forEach(btn => {
                if (!btn.hasAttribute('role')) btn.setAttribute('role', 'button');
                if (!btn.hasAttribute('tabindex')) btn.setAttribute('tabindex', '0');

                // attach click handler that uses the public API
                btn.addEventListener('click', e => {
                    const id = btn.id || '';
                    const matches = id.match(/^market-(.+)$/);
                    if (matches) setMarketTheme(matches[1]);
                });
            });
        } catch (e) { /* ignore */ }
    }

    // Expose API
    exports.Base = exports.Base || {};
    exports.Base.setMarketTheme = setMarketTheme;
    exports.Base.setTheme = setTheme;
    exports.Base.initTheme = initTheme;
    exports.Base.initMarketTheme = initMarketTheme;
    exports.Base.initOnReady = initOnReady;

    // Run immediately to prevent flash
    initTheme();
    initMarketTheme();

    // Run DOM-ready initialization
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', initOnReady);
    } else {
        // already ready
        initOnReady();
    }
})(window.BW, document);

// Optional global helpers for inline onclicks
function setMarketTheme(t) { if (window.BW && window.BW.Base && window.BW.Base.setMarketTheme) window.BW.Base.setMarketTheme(t); }
function setTheme(t) { if (window.BW && window.BW.Base && window.BW.Base.setTheme) window.BW.Base.setTheme(t); }
