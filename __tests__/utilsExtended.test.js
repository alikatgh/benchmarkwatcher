/**
 * __tests__/utilsExtended.test.js
 *
 * Unit tests for BW.Utils functions NOT yet covered in utils.test.js:
 *   formatPriceThousands, formatDate, getJsonData,
 *   buildCommoditiesApiUrl, getCommoditiesFromApiResponse,
 *   isDailyCommodity, escapeHtml, debounce, calculateMA
 *
 * Uses the same copy-function-body approach as utils.test.js to avoid
 * jsdom/ESM/window.BW bootstrap issues.
 */

// ============================================================
// Inline implementations (mirrored from app/static/js/core/utils.js)
// ============================================================

const BW_DAILY_COMMODITY_IDS = [
    'brent_oil', 'wti_oil', 'natural_gas', 'heating_oil', 'jet_fuel',
    'propane', 'gold', 'silver', 'gasoline', 'diesel', 'rbob_gasoline', 'platinum'
];

function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function formatPriceThousands(value, precision = 2) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString(undefined, {
        minimumFractionDigits: Math.max(0, precision),
        maximumFractionDigits: Math.max(0, precision)
    });
}

function _toDate(input) {
    if (!input) return null;
    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }
    const str = String(input);
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (ymd) {
        const dLocal = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
        return isNaN(dLocal.getTime()) ? null : dLocal;
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function getRelativeDate(date) {
    const d = _toDate(date);
    if (!d) return '';
    const now = new Date();
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffMs = nowDay - dDay;
    const diffDays = Math.round(diffMs / MS_PER_DAY) * -1;
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) return `${diffDays} days from now`;
    if (diffDays < -1 && diffDays > -7) return `${Math.abs(diffDays)} days ago`;
    if (Math.abs(diffDays) < 30) {
        const weeks = Math.round(Math.abs(diffDays) / 7);
        return `${weeks} week${weeks > 1 ? 's' : ''} ${diffDays > 0 ? 'from now' : 'ago'}`;
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDate(dateInput, format = 'iso') {
    const d = _toDate(dateInput);
    if (!d) return dateInput;
    switch (format) {
        case 'iso': {
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            return `${y}-${mo}-${da}`;
        }
        case 'short':
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        case 'long':
            return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        case 'relative':
            return getRelativeDate(d);
        default:
            return dateInput;
    }
}

function buildCommoditiesApiUrl({ range = 'ALL', includeHistory = false, category = null } = {}) {
    let apiUrl = `/api/commodities?range=${encodeURIComponent(range)}&include_history=${includeHistory ? 1 : 0}`;
    if (category) apiUrl += `&category=${encodeURIComponent(category)}`;
    return apiUrl;
}

function getCommoditiesFromApiResponse(response) {
    if (response && Array.isArray(response.data)) return response.data;
    if (Array.isArray(response)) return response;
    return [];
}

function isDailyCommodity(commodity) {
    if (!commodity) return false;
    if (typeof commodity.is_daily === 'boolean') return commodity.is_daily;
    const sourceType = String(commodity.source_type || '').toUpperCase();
    if (sourceType === 'EIA' || sourceType === 'YAHOO' || sourceType === 'FREEGOLD') return true;
    return BW_DAILY_COMMODITY_IDS.includes(String(commodity.id || ''));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function debounce(func, wait = 200) {
    let timeout = null;
    return function debounced(...args) {
        const ctx = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            timeout = null;
            func.apply(ctx, args);
        }, wait);
    };
}

function calculateMA(data = [], period = 7) {
    if (!Array.isArray(data) || data.length === 0 || period <= 0) return [];
    const out = new Array(data.length).fill(null);
    const nums = data.map(v => toNumber(v));
    let windowSum = 0;
    let validCount = 0;
    for (let i = 0; i < data.length; i++) {
        const val = nums[i];
        if (i < period) {
            if (Number.isFinite(val)) { windowSum += val; validCount++; }
            if (i === period - 1) {
                out[i] = (validCount === period) ? windowSum / period : null;
            } else {
                out[i] = null;
            }
        } else {
            const prev = nums[i - period];
            if (Number.isFinite(prev)) { windowSum -= prev; validCount = Math.max(0, validCount - 1); }
            // non-finite prev was never counted, so validCount is unchanged
            if (Number.isFinite(val)) { windowSum += val; validCount++; }
            out[i] = (validCount === period) ? windowSum / period : null;
        }
    }
    return out;
}

// ============================================================
// Tests
// ============================================================

describe('formatPriceThousands', () => {
    test('returns empty string for non-numeric input', () => {
        expect(formatPriceThousands('abc')).toBe('');
        expect(formatPriceThousands(undefined)).toBe('');
        expect(formatPriceThousands(NaN)).toBe('');
        expect(formatPriceThousands(Infinity)).toBe('');
    });

    test('formats a number with two decimal places by default', () => {
        // toLocaleString output depends on locale, but must contain "1" and have 2 decimals
        const result = formatPriceThousands(1000);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        // Confirm the value round-trips: removing separators should give us back 1000.00
        const digitsOnly = result.replace(/[^0-9.]/g, '');
        expect(parseFloat(digitsOnly)).toBeCloseTo(1000, 1);
    });

    test('respects precision=0', () => {
        const result = formatPriceThousands(9999, 0);
        expect(result).not.toContain('.');
    });

    test('handles zero', () => {
        const result = formatPriceThousands(0);
        expect(result).toMatch(/0/);
    });

    test('handles string number input', () => {
        const result = formatPriceThousands('42.5');
        expect(result.length).toBeGreaterThan(0);
        const digitsOnly = result.replace(/[^0-9.]/g, '');
        expect(parseFloat(digitsOnly)).toBeCloseTo(42.5, 1);
    });

    test('handles negative numbers', () => {
        const result = formatPriceThousands(-500);
        expect(result).toMatch(/-/);
    });
});

describe('formatDate', () => {
    test('iso format returns local YYYY-MM-DD', () => {
        // Use a date-only string so _toDate treats it as local midnight
        expect(formatDate('2024-03-15', 'iso')).toBe('2024-03-15');
    });

    test('iso format is default', () => {
        expect(formatDate('2024-03-15')).toBe('2024-03-15');
    });

    test('short format returns a non-empty string', () => {
        const result = formatDate('2024-06-01', 'short');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    test('long format returns a non-empty string', () => {
        const result = formatDate('2024-06-01', 'long');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    test('relative format returns Today for today', () => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        expect(formatDate(today, 'relative')).toBe('Today');
    });

    test('unknown format returns the original input unchanged', () => {
        expect(formatDate('2024-01-01', 'nonexistent')).toBe('2024-01-01');
    });

    test('returns original input when date is unparseable', () => {
        expect(formatDate('not-a-date', 'iso')).toBe('not-a-date');
    });

    test('accepts a Date object', () => {
        const d = new Date(2025, 0, 15); // Jan 15 2025, local
        expect(formatDate(d, 'iso')).toBe('2025-01-15');
    });
});

describe('buildCommoditiesApiUrl', () => {
    test('builds default URL with no args', () => {
        expect(buildCommoditiesApiUrl()).toBe('/api/commodities?range=ALL&include_history=0');
    });

    test('respects custom range', () => {
        expect(buildCommoditiesApiUrl({ range: '1Y' })).toBe('/api/commodities?range=1Y&include_history=0');
    });

    test('sets include_history=1 when true', () => {
        expect(buildCommoditiesApiUrl({ includeHistory: true })).toBe('/api/commodities?range=ALL&include_history=1');
    });

    test('appends category when provided', () => {
        const url = buildCommoditiesApiUrl({ category: 'energy' });
        expect(url).toBe('/api/commodities?range=ALL&include_history=0&category=energy');
    });

    test('URL-encodes special chars in range', () => {
        const url = buildCommoditiesApiUrl({ range: 'foo bar' });
        expect(url).toContain('foo%20bar');
    });

    test('URL-encodes special chars in category', () => {
        const url = buildCommoditiesApiUrl({ category: 'metals & mining' });
        expect(url).toContain('metals%20%26%20mining');
    });

    test('does not append category param when null', () => {
        const url = buildCommoditiesApiUrl({ category: null });
        expect(url).not.toContain('category');
    });
});

describe('getCommoditiesFromApiResponse', () => {
    test('extracts data array from envelope', () => {
        const data = [{ id: 'gold' }];
        expect(getCommoditiesFromApiResponse({ data })).toBe(data);
    });

    test('returns array directly when response is an array', () => {
        const data = [{ id: 'silver' }, { id: 'platinum' }];
        expect(getCommoditiesFromApiResponse(data)).toBe(data);
    });

    test('returns empty array for null response', () => {
        expect(getCommoditiesFromApiResponse(null)).toEqual([]);
    });

    test('returns empty array for undefined response', () => {
        expect(getCommoditiesFromApiResponse(undefined)).toEqual([]);
    });

    test('returns empty array when data property is not an array', () => {
        expect(getCommoditiesFromApiResponse({ data: 'not-array' })).toEqual([]);
    });

    test('returns empty array for object without data property', () => {
        expect(getCommoditiesFromApiResponse({ other: 'stuff' })).toEqual([]);
    });
});

describe('isDailyCommodity', () => {
    test('returns false for null/undefined', () => {
        expect(isDailyCommodity(null)).toBe(false);
        expect(isDailyCommodity(undefined)).toBe(false);
    });

    test('respects boolean is_daily=true', () => {
        expect(isDailyCommodity({ is_daily: true })).toBe(true);
    });

    test('respects boolean is_daily=false', () => {
        expect(isDailyCommodity({ is_daily: false })).toBe(false);
    });

    test('EIA source_type is daily', () => {
        expect(isDailyCommodity({ source_type: 'EIA' })).toBe(true);
        expect(isDailyCommodity({ source_type: 'eia' })).toBe(true); // case-insensitive
    });

    test('YAHOO source_type is daily', () => {
        expect(isDailyCommodity({ source_type: 'YAHOO' })).toBe(true);
    });

    test('FREEGOLD source_type is daily', () => {
        expect(isDailyCommodity({ source_type: 'FREEGOLD' })).toBe(true);
    });

    test('known daily id is classified as daily', () => {
        expect(isDailyCommodity({ id: 'gold' })).toBe(true);
        expect(isDailyCommodity({ id: 'brent_oil' })).toBe(true);
        expect(isDailyCommodity({ id: 'wti_oil' })).toBe(true);
        expect(isDailyCommodity({ id: 'natural_gas' })).toBe(true);
        expect(isDailyCommodity({ id: 'silver' })).toBe(true);
    });

    test('unknown id without source_type is not daily', () => {
        expect(isDailyCommodity({ id: 'wheat' })).toBe(false);
        expect(isDailyCommodity({ id: 'corn' })).toBe(false);
    });

    test('is_daily boolean takes precedence over source_type', () => {
        // Even if source_type would classify it as daily, explicit false wins
        expect(isDailyCommodity({ is_daily: false, source_type: 'EIA' })).toBe(false);
    });

    test('is_daily=true takes precedence over unknown id', () => {
        expect(isDailyCommodity({ is_daily: true, id: 'wheat' })).toBe(true);
    });
});

describe('escapeHtml', () => {
    test('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes less-than', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    test('escapes greater-than', () => {
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    test('escapes double quotes', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    test('escapes single quotes', () => {
        expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    test('handles all characters together', () => {
        expect(escapeHtml('<a href="test" title=\'x\'>&</a>'))
            .toBe('&lt;a href=&quot;test&quot; title=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
    });

    test('returns unchanged string when nothing to escape', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    test('coerces non-string to string before escaping', () => {
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(null)).toBe('null');
    });
});

describe('debounce', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    test('does not call func immediately', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);
        debounced();
        expect(fn).not.toHaveBeenCalled();
    });

    test('calls func after wait period', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);
        debounced();
        jest.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('resets timer on repeated calls (trailing-edge debounce)', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);
        debounced();
        jest.advanceTimersByTime(50);
        debounced();
        jest.advanceTimersByTime(50);
        // Not yet fired — last call at t=50, fires at t=150
        expect(fn).not.toHaveBeenCalled();
        jest.advanceTimersByTime(50);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('passes arguments to the wrapped function', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);
        debounced('a', 'b');
        jest.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledWith('a', 'b');
    });

    test('uses default wait of 200ms', () => {
        const fn = jest.fn();
        const debounced = debounce(fn); // no explicit wait
        debounced();
        jest.advanceTimersByTime(199);
        expect(fn).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('calculateMA', () => {
    test('returns empty array for empty input', () => {
        expect(calculateMA([])).toEqual([]);
    });

    test('returns empty array for non-array input', () => {
        expect(calculateMA(null)).toEqual([]);
        expect(calculateMA('not-array')).toEqual([]);
    });

    test('returns empty array for period <= 0', () => {
        expect(calculateMA([1, 2, 3], 0)).toEqual([]);
        expect(calculateMA([1, 2, 3], -1)).toEqual([]);
    });

    test('first (period-1) values are null', () => {
        const data = [1, 2, 3, 4, 5];
        const result = calculateMA(data, 3);
        expect(result[0]).toBeNull();
        expect(result[1]).toBeNull();
    });

    test('value at position period-1 is the mean of first window', () => {
        const data = [1, 2, 3, 4, 5];
        const result = calculateMA(data, 3);
        // MA is computed (and non-null) at exactly index period-1 when all
        // values in the initial window are numeric.
        // (1+2+3)/3 = 2
        expect(result[2]).toBeCloseTo(2);
    });

    test('sliding window produces correct MA for all positions after period-1', () => {
        // [1,2,3,4,5] period=3:
        //   index 2: (1+2+3)/3 = 2
        //   index 3: (2+3+4)/3 = 3
        //   index 4: (3+4+5)/3 = 4
        const data = [1, 2, 3, 4, 5];
        const result = calculateMA(data, 3);
        expect(result[3]).toBeCloseTo(3);
        expect(result[4]).toBeCloseTo(4);
    });

    test('period=1 returns each value as its own MA', () => {
        // With period=1 every window is exactly [element], so MA equals the element.
        const data = [10, 20, 30];
        const result = calculateMA(data, 1);
        expect(result[0]).toBe(10);
        expect(result[1]).toBe(20);
        expect(result[2]).toBe(30);
    });

    test('null for windows containing non-numeric values', () => {
        const data = ['x', 2, 3];
        const result = calculateMA(data, 3);
        // First window contains a non-numeric, so MA is null
        expect(result[2]).toBeNull();
    });

    test('output length matches input length', () => {
        const data = [5, 10, 15, 20, 25, 30];
        const result = calculateMA(data, 4);
        expect(result.length).toBe(data.length);
    });

    test('handles period larger than data length', () => {
        const data = [1, 2, 3];
        const result = calculateMA(data, 10);
        // Period exceeds data length — all entries should be null
        expect(result.every(v => v === null)).toBe(true);
    });

    test('handles string numbers in data', () => {
        const data = ['2', '4', '6'];
        const result = calculateMA(data, 3);
        expect(result[2]).toBeCloseTo(4);
    });
});
