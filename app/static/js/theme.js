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

    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) { /* noop */ }
    }

    function isDarkThemeName(name) {
        return name === 'dark' || name === 'mono-dark' || name === 'bloomberg';
    }

    // Apply theme to root: set data-theme and toggle .dark for Tailwind utilities
    function applyTheme(theme) {
        if (!theme) return;

        // set attribute for CSS targeting
        root.setAttribute('data-theme', theme);

        // toggle 'dark' class for Tailwind's dark: utilities
        if (isDarkThemeName(theme)) root.classList.add('dark');
        else root.classList.remove('dark');

        // persist (use BW.Settings if available)
        if (BW.Settings && typeof BW.Settings.setTheme === 'function') {
            BW.Settings.setTheme(theme);
        } else {
            safeSet('theme', theme);
        }

        updateThemeButtons(theme);

        // Re-render sparklines with new theme colors
        if (window.BW && BW.Sparkline && typeof BW.Sparkline.refresh === 'function') {
            requestAnimationFrame(() => BW.Sparkline.refresh());
        }
    }

    // Update theme buttons to be CSS-friendly and accessible
    function updateThemeButtons(activeTheme) {
        const themeButtons = ['light', 'dark', 'mono-light', 'mono-dark', 'bloomberg', 'ft'];
        themeButtons.forEach(t => {
            const btn = document.getElementById(`theme-${t}`);
            if (!btn) return;
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
    function applyMarketTheme(theme) {
        if (!theme) return;
        root.setAttribute('data-market', theme);

        if (BW.Settings && typeof BW.Settings.setMarketTheme === 'function') {
            BW.Settings.setMarketTheme(theme);
        } else {
            safeSet('market-theme', theme);
        }

        updateMarketButtons(theme);
    }

    // Update market buttons in a CSS-friendly way
    function updateMarketButtons(activeMarket) {
        const markets = ['western', 'asian', 'monochrome'];
        markets.forEach(m => {
            const btn = document.getElementById(`market-${m}`);
            if (!btn) return;
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
        const up = cs.getPropertyValue('--market-up').trim();
        const down = cs.getPropertyValue('--market-down').trim();

        if (line || gradientStart || gradientEnd || ma || up || down) {
            return {
                line: line || '#0f5499',
                gradientStart: gradientStart || 'rgba(15,84,153,0.1)',
                gradientEnd: gradientEnd || 'rgba(15,84,153,0)',
                ma: ma || '#990f3d',
                up: up || '#0d7680',
                down: down || '#990f3d'
            };
        }

        // fallback behavior based on theme attribute/class
        const theme = root.getAttribute('data-theme') || safeGet('theme') || 'light';
        const isDark = root.classList.contains('dark') || theme === 'dark' || theme === 'mono-dark';

        const isBloomberg = theme === 'bloomberg';
        return {
            line: isBloomberg ? '#ff9933' : (isDark ? '#1aecff' : '#0f5499'),
            gradientStart: isBloomberg ? 'rgba(255,153,51,0.25)' : (isDark ? 'rgba(26,236,255,0.2)' : 'rgba(15,84,153,0.1)'),
            gradientEnd: isBloomberg ? 'rgba(255,153,51,0)' : (isDark ? 'rgba(26,236,255,0)' : 'rgba(15,84,153,0)'),
            ma: isBloomberg ? '#ff5555' : (isDark ? '#ff6b6b' : '#990f3d'),
            up: isBloomberg ? '#00ff00' : '#0d7680',
            down: isBloomberg ? '#ff3333' : '#990f3d'
        };
    }

    // Initialization: apply saved or sensible defaults
    function init() {
        // pick theme from BW.Settings if present, otherwise from localStorage, otherwise fallback to system-preference
        let theme = 'light';
        try {
            if (BW.Settings && typeof BW.Settings.getTheme === 'function') {
                theme = BW.Settings.getTheme() || theme;
            } else {
                theme = safeGet('theme') || theme;
            }
        } catch (e) { /* ignore */ }

        // detect system preference if nothing explicit
        if (!theme || theme === 'light') {
            try {
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (prefersDark && (!safeGet('theme') && !(BW.Settings && BW.Settings.getTheme && BW.Settings.getTheme()))) {
                    theme = 'dark';
                }
            } catch (e) { /* ignore */ }
        }

        applyTheme(theme);

        // market theme
        let market = 'western';
        try {
            if (BW.Settings && typeof BW.Settings.getMarketTheme === 'function') {
                market = BW.Settings.getMarketTheme() || market;
            } else {
                market = safeGet('market-theme') || market;
            }
        } catch (e) { /* ignore */ }

        applyMarketTheme(market);
    }

    // expose public API
    return {
        applyTheme,
        applyMarketTheme,
        updateThemeButtons,
        updateMarketButtons,
        getSparklineColors,
        init
    };
})();

// Auto-init on DOMContentLoaded (safe to call even if Settings loads later)
document.addEventListener('DOMContentLoaded', function () {
    if (BW.Theme && typeof BW.Theme.init === 'function') BW.Theme.init();
});
