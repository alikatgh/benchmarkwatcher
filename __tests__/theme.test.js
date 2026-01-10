/**
 * @jest-environment jsdom
 */

/**
 * __tests__/theme.test.js
 * 
 * Tests for theme handling and persistence
 */

// ============================================================
// Mock localStorage for testing
// ============================================================

const mockStorage = {};

const mockLocalStorage = {
    getItem: jest.fn(key => mockStorage[key] || null),
    setItem: jest.fn((key, value) => { mockStorage[key] = value; }),
    removeItem: jest.fn(key => { delete mockStorage[key]; }),
    clear: jest.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); })
};

// ============================================================
// Mock theme functions for testing
// ============================================================

function isDarkThemeName(name) {
    return name === 'dark' || name === 'mono-dark' || name === 'bloomberg';
}

function applyTheme(theme, root = document.documentElement) {
    if (!theme) return;
    root.setAttribute('data-theme', theme);
    if (isDarkThemeName(theme)) {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
    mockLocalStorage.setItem('theme', theme);
}

function applyMarketTheme(theme, root = document.documentElement) {
    if (!theme) return;
    root.setAttribute('data-market', theme);
    mockLocalStorage.setItem('market-theme', theme);
}

function getSparklineColors(theme) {
    const isBloomberg = theme === 'bloomberg';
    const isDark = isDarkThemeName(theme);

    return {
        line: isBloomberg ? '#ff9933' : (isDark ? '#1aecff' : '#0f5499'),
        gradientStart: isBloomberg ? 'rgba(255,153,51,0.25)' : (isDark ? 'rgba(26,236,255,0.2)' : 'rgba(15,84,153,0.1)'),
        gradientEnd: isBloomberg ? 'rgba(255,153,51,0)' : (isDark ? 'rgba(26,236,255,0)' : 'rgba(15,84,153,0)'),
        ma: isBloomberg ? '#ff5555' : (isDark ? '#ff6b6b' : '#990f3d'),
        up: isBloomberg ? '#00ff00' : '#0d7680',
        down: isBloomberg ? '#ff3333' : '#990f3d'
    };
}

// ============================================================
// Tests
// ============================================================

describe('isDarkThemeName', () => {
    test('dark is a dark theme', () => {
        expect(isDarkThemeName('dark')).toBe(true);
    });

    test('mono-dark is a dark theme', () => {
        expect(isDarkThemeName('mono-dark')).toBe(true);
    });

    test('bloomberg is a dark theme', () => {
        expect(isDarkThemeName('bloomberg')).toBe(true);
    });

    test('light is not a dark theme', () => {
        expect(isDarkThemeName('light')).toBe(false);
    });

    test('mono-light is not a dark theme', () => {
        expect(isDarkThemeName('mono-light')).toBe(false);
    });

    test('ft is not a dark theme', () => {
        expect(isDarkThemeName('ft')).toBe(false);
    });
});

describe('applyTheme', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
        document.documentElement.className = '';
        document.documentElement.removeAttribute('data-theme');
    });

    test('sets data-theme attribute', () => {
        applyTheme('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('adds dark class for dark themes', () => {
        applyTheme('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    test('removes dark class for light themes', () => {
        document.documentElement.classList.add('dark');
        applyTheme('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    test('persists theme to storage', () => {
        applyTheme('bloomberg');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('theme', 'bloomberg');
    });

    test('does nothing for null theme', () => {
        applyTheme(null);
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
});

describe('applyMarketTheme', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
        document.documentElement.removeAttribute('data-market');
    });

    test('sets data-market attribute', () => {
        applyMarketTheme('asian');
        expect(document.documentElement.getAttribute('data-market')).toBe('asian');
    });

    test('persists market theme to storage', () => {
        applyMarketTheme('western');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('market-theme', 'western');
    });
});

describe('getSparklineColors', () => {
    test('returns light theme colors for light', () => {
        const colors = getSparklineColors('light');
        expect(colors.line).toBe('#0f5499');
    });

    test('returns dark theme colors for dark', () => {
        const colors = getSparklineColors('dark');
        expect(colors.line).toBe('#1aecff');
    });

    test('returns bloomberg-specific colors', () => {
        const colors = getSparklineColors('bloomberg');
        expect(colors.line).toBe('#ff9933');
        expect(colors.up).toBe('#00ff00');
        expect(colors.down).toBe('#ff3333');
    });

    test('mono-dark uses dark colors', () => {
        const colors = getSparklineColors('mono-dark');
        expect(colors.line).toBe('#1aecff');
    });

    test('all themes return up/down colors', () => {
        ['light', 'dark', 'bloomberg', 'ft'].forEach(theme => {
            const colors = getSparklineColors(theme);
            expect(colors.up).toBeDefined();
            expect(colors.down).toBeDefined();
        });
    });
});

describe('theme button state management', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="theme-light">Light</button>
            <button id="theme-dark">Dark</button>
            <button id="theme-bloomberg">Bloomberg</button>
        `;
    });

    function updateThemeButtons(activeTheme) {
        ['light', 'dark', 'bloomberg'].forEach(t => {
            const btn = document.getElementById(`theme-${t}`);
            if (!btn) return;
            const isActive = t === activeTheme;
            if (isActive) {
                btn.setAttribute('data-active', 'true');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.removeAttribute('data-active');
                btn.setAttribute('aria-pressed', 'false');
            }
        });
    }

    test('active theme has data-active=true', () => {
        updateThemeButtons('dark');
        expect(document.getElementById('theme-dark').hasAttribute('data-active')).toBe(true);
        expect(document.getElementById('theme-light').hasAttribute('data-active')).toBe(false);
    });

    test('active theme has aria-pressed=true', () => {
        updateThemeButtons('bloomberg');
        expect(document.getElementById('theme-bloomberg').getAttribute('aria-pressed')).toBe('true');
        expect(document.getElementById('theme-dark').getAttribute('aria-pressed')).toBe('false');
    });
});
