/**
 * BenchmarkWatcher - Theme Module (robust)
 * 
 * NOTE: Prefer BW.Settings for all storage access. Falls back to safe
 * localStorage wrappers only if BW.Settings is not yet loaded.
 * 
 * - Uses data-active / aria-pressed for button states (no Tailwind class toggling)
 * - Reads CSS variables for sparkline colors when present
 * - Re-renders sparklines on theme change via BW.Sparkline.refresh()
 */

window.BW = window.BW || {};

BW.Theme = (function () {
    const root = document.documentElement;
    const THEME_KEY = 'theme';
    const MARKET_THEME_KEY = 'market-theme';
    const THEMES = ['system', 'light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft'];
    let _initialized = false;

    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) { /* noop */ }
    }

    function getStoredRaw(key, settingsKey) {
        try {
            if (BW.Settings && typeof BW.Settings._getRaw === 'function') return BW.Settings._getRaw(settingsKey || key);
        } catch (e) { /* use safe storage fallback */ }
        return safeGet(key);
    }

    function getPreference() {
        if (BW.Base && typeof BW.Base.getThemePreference === 'function') return BW.Base.getThemePreference();
        const stored = getStoredRaw(THEME_KEY, BW.Settings?.KEYS?.THEME);
        return THEMES.includes(stored) ? stored : 'system';
    }

    function isDarkThemeName(name) {
        return name === 'dark' || name === 'mono-dark' || name === 'bloomberg';
    }

    // Apply theme to root: set data-theme and toggle .dark for Tailwind utilities
    function applyTheme(preference, persist = true) {
        if (!THEMES.includes(preference)) return;
        if (BW.Base && typeof BW.Base.setTheme === 'function') {
            if (persist) BW.Base.setTheme(preference);
            else BW.Base.initTheme();
            updateThemeButtons(preference);
            return;
        }
        let theme = preference;
        if (theme === 'system') {
            try { theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
            catch (e) { theme = 'light'; }
        }

        // set attribute for CSS targeting
        root.setAttribute('data-theme-preference', preference);
        root.setAttribute('data-theme', theme);

        // toggle 'dark' class for Tailwind's dark: utilities
        if (isDarkThemeName(theme)) root.classList.add('dark');
        else root.classList.remove('dark');
        root.style.colorScheme = isDarkThemeName(theme) ? 'dark' : 'light';

        // persist (use BW.Settings if available)
        if (persist) {
            try {
                if (BW.Settings && typeof BW.Settings.setTheme === 'function') BW.Settings.setTheme(preference);
                else safeSet(THEME_KEY, preference);
            } catch (e) { /* appearance still works without persistence */ }
        }

        updateThemeButtons(preference);
        refreshVisuals();
    }

    function refreshVisuals(includeCommodity = true) {
        if (BW.VisualExplorer) requestAnimationFrame(() => BW.VisualExplorer.refresh());

        // Re-render sparklines with new theme colors
        if (window.BW && BW.Sparkline && typeof BW.Sparkline.refresh === 'function') {
            requestAnimationFrame(() => BW.Sparkline.refresh());
        }
        if (includeCommodity && BW.Commodity && BW.Commodity.chartElement) {
            BW.Commodity.setupColors();
            BW.Commodity.applyChartTheme(root.getAttribute('data-theme'));
        }
    }

    // Update theme buttons to be CSS-friendly and accessible
    function updateThemeButtons(activeTheme) {
        THEMES.forEach(t => {
            const btn = document.getElementById(`theme-${t}`);
            if (!btn) return;
            if (btn.getAttribute('role') === 'radio') return;
            const isActive = t === activeTheme;
            // Prefer data attribute + aria for styling
            if (isActive) {
                btn.setAttribute('data-active', 'true');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.removeAttribute('data-active');
                btn.setAttribute('aria-pressed', 'false');
            }
        });
    }

    // Apply market theme (western/asian/monochrome)
    function applyMarketTheme(theme, persist = true) {
        if (!['western', 'asian', 'monochrome'].includes(theme)) return;
        root.setAttribute('data-market', theme);

        if (persist) {
            try {
                if (BW.Settings && typeof BW.Settings.setMarketTheme === 'function') BW.Settings.setMarketTheme(theme);
                else safeSet(MARKET_THEME_KEY, theme);
            } catch (e) { /* colors still work without persistence */ }
        }

        updateMarketButtons(theme);
        refreshVisuals(false);
    }

    // Update market buttons in a CSS-friendly way
    function updateMarketButtons(activeMarket) {
        const markets = ['western', 'asian', 'monochrome'];
        markets.forEach(m => {
            const btn = document.getElementById(`market-${m}`);
            if (!btn) return;
            if (btn.getAttribute('role') === 'radio') return;
            const isActive = m === activeMarket;
            if (isActive) {
                btn.setAttribute('data-active', 'true');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.removeAttribute('data-active');
                btn.setAttribute('aria-pressed', 'false');
            }
        });
    }

    // Sparkline color lookup: prefer CSS variables, fall back to theme logic
    function getSparklineColors() {
        const cs = getComputedStyle(root);

        // try user-defined CSS variables first (recommended)
        const line = cs.getPropertyValue('--sparkline-line').trim();
        const gradientStart = cs.getPropertyValue('--sparkline-grad-start').trim();
        const gradientEnd = cs.getPropertyValue('--sparkline-grad-end').trim();
        const ma = cs.getPropertyValue('--sparkline-ma').trim();
        const up = cs.getPropertyValue('--color-up').trim() || cs.getPropertyValue('--market-up').trim();
        const down = cs.getPropertyValue('--color-down').trim() || cs.getPropertyValue('--market-down').trim();

        // CSS variables are now defined per-theme in base.html, so they should always be available
        const theme = root.getAttribute('data-theme')
            || (BW.Settings && typeof BW.Settings.getTheme === 'function' ? BW.Settings.getTheme() : null)
            || safeGet(THEME_KEY)
            || 'light';
        const isDark = root.classList.contains('dark') || theme === 'dark' || theme === 'mono-dark';
        const isBloomberg = theme === 'bloomberg';

        // Use CSS variables with per-theme fallbacks
        return {
            line: line || (isBloomberg ? '#ff9933' : (isDark ? '#1aecff' : '#0f5499')),
            gradientStart: gradientStart || (isBloomberg ? 'rgba(255,153,51,0.25)' : (isDark ? 'rgba(26,236,255,0.2)' : 'rgba(15,84,153,0.1)')),
            gradientEnd: gradientEnd || (isBloomberg ? 'rgba(255,153,51,0)' : (isDark ? 'rgba(26,236,255,0)' : 'rgba(15,84,153,0)')),
            ma: ma || (isBloomberg ? '#ff5555' : (isDark ? '#ff6b6b' : '#990f3d')),
            up: up || (isBloomberg ? '#00ff00' : '#0d7680'),
            down: down || (isBloomberg ? '#ff3333' : '#990f3d')
        };
    }

    // Initialization: apply saved or sensible defaults
    function init(force) {
        if (_initialized && !force) return;
        applyTheme(getPreference(), false);

        // market theme
        let market = 'western';
        try {
            if (BW.Settings && typeof BW.Settings.getMarketTheme === 'function') {
                market = BW.Settings.getMarketTheme() || market;
            } else {
                market = safeGet(MARKET_THEME_KEY) || market;
            }
        } catch (e) { /* ignore */ }

        applyMarketTheme(['western', 'asian', 'monochrome'].includes(market) ? market : 'western', false);
        _initialized = true;
    }

    // expose public API
    return {
        applyTheme,
        applyMarketTheme,
        updateThemeButtons,
        updateMarketButtons,
        getSparklineColors,
        getPreference,
        refreshVisuals,
        init
    };
})();

if (!window.__bwThemeChangeBound) {
    window.__bwThemeChangeBound = true;
    window.addEventListener('bw:theme-change', () => {
        BW.Theme.updateThemeButtons(BW.Theme.getPreference());
        BW.Theme.refreshVisuals();
    });
}

// Auto-init on DOMContentLoaded (bind once even if script is evaluated multiple times)
if (!window.__bwThemeDomReadyBound) {
    window.__bwThemeDomReadyBound = true;
    const runThemeInit = function () {
        if (BW.Theme && typeof BW.Theme.init === 'function') BW.Theme.init();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runThemeInit);
    } else {
        runThemeInit();
    }
}
