/**
 * __tests__/utils.test.js
 *
 * Unit tests for BW.Utils pure functions
 * Uses copied function bodies to avoid jsdom/ESM issues (same pattern as commodity.test.js)
 */

// ============================================================
// Extract pure functions for testing (mirrors utils.js)
// ============================================================

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function formatCompact(value, precision = 2) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return '';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const p = Math.max(0, precision);

    if (abs >= 1_000_000_000_000) {
        return sign + (abs / 1_000_000_000_000).toFixed(p) + 'T';
    } else if (abs >= 1_000_000_000) {
        return sign + (abs / 1_000_000_000).toFixed(p) + 'B';
    } else if (abs >= 1_000_000) {
        return sign + (abs / 1_000_000).toFixed(p) + 'M';
    } else if (abs >= 1_000) {
        return sign + (abs / 1_000).toFixed(p) + 'K';
    }
    return sign + abs.toFixed(p);
}

function formatPrice(value, precision = 2) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return '';
    return n.toFixed(Math.max(0, precision));
}

function _toDate(input) {
    if (!input) return null;
    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }
    const d = new Date(String(input));
    return isNaN(d.getTime()) ? null : d;
}

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

function findHighLow(data = []) {
    if (!Array.isArray(data) || data.length === 0) {
        return { highIdx: null, lowIdx: null, high: null, low: null };
    }
    let high = -Infinity;
    let low = Infinity;
    let highIdx = null;
    let lowIdx = null;

    data.forEach((v, i) => {
        const n = toNumber(v);
        if (!Number.isFinite(n)) return;
        if (n > high) { high = n; highIdx = i; }
        if (n < low) { low = n; lowIdx = i; }
    });

    if (highIdx === null) {
        return { highIdx: null, lowIdx: null, high: null, low: null };
    }
    return { highIdx, lowIdx, high, low };
}

// ============================================================
// Tests
// ============================================================

describe('formatCompact', () => {
    test('formats thousands with K suffix', () => {
        expect(formatCompact(1500)).toBe('1.50K');
        expect(formatCompact(999999)).toBe('1000.00K');
    });

    test('formats millions with M suffix', () => {
        expect(formatCompact(1_000_000)).toBe('1.00M');
        expect(formatCompact(2_500_000)).toBe('2.50M');
    });

    test('formats billions with B suffix', () => {
        expect(formatCompact(1_000_000_000)).toBe('1.00B');
        expect(formatCompact(1_500_000_000)).toBe('1.50B');
    });

    test('formats trillions with T suffix', () => {
        expect(formatCompact(1_000_000_000_000)).toBe('1.00T');
        expect(formatCompact(2_300_000_000_000)).toBe('2.30T');
    });

    test('handles negative values', () => {
        expect(formatCompact(-1_500_000_000)).toBe('-1.50B');
        expect(formatCompact(-2500)).toBe('-2.50K');
    });

    test('returns empty string for non-numeric', () => {
        expect(formatCompact('abc')).toBe('');
        expect(formatCompact(NaN)).toBe('');
        expect(formatCompact(Infinity)).toBe('');
    });

    test('respects precision parameter', () => {
        expect(formatCompact(1234, 0)).toBe('1K');
        expect(formatCompact(1234, 1)).toBe('1.2K');
    });

    test('values below 1000 shown as-is', () => {
        expect(formatCompact(42)).toBe('42.00');
        expect(formatCompact(0)).toBe('0.00');
    });
});

describe('formatPrice', () => {
    test('formats number with default precision', () => {
        expect(formatPrice(123.456)).toBe('123.46');
    });

    test('returns empty string for non-numeric', () => {
        expect(formatPrice('abc')).toBe('');
        expect(formatPrice(undefined)).toBe('');
    });

    test('treats null as 0 (Number(null) === 0)', () => {
        expect(formatPrice(null)).toBe('0.00');
    });

    test('handles string numbers', () => {
        expect(formatPrice('99.9')).toBe('99.90');
    });
});

describe('getRelativeDate', () => {
    test('today returns Today', () => {
        expect(getRelativeDate(new Date())).toBe('Today');
    });

    test('yesterday returns Yesterday', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        expect(getRelativeDate(yesterday)).toBe('Yesterday');
    });

    test('does not mutate input Date', () => {
        const d = new Date('2024-06-15T12:30:00Z');
        const originalTime = d.getTime();
        getRelativeDate(d);
        expect(d.getTime()).toBe(originalTime);
    });

    test('returns empty string for invalid input', () => {
        expect(getRelativeDate(null)).toBe('');
        expect(getRelativeDate('')).toBe('');
    });

    test('handles string dates', () => {
        const today = new Date().toISOString().split('T')[0];
        expect(getRelativeDate(today)).toBe('Today');
    });
});

describe('findHighLow', () => {
    test('finds correct high and low', () => {
        const result = findHighLow([10, 5, 20, 15]);
        expect(result.high).toBe(20);
        expect(result.highIdx).toBe(2);
        expect(result.low).toBe(5);
        expect(result.lowIdx).toBe(1);
    });

    test('returns nulls for empty array', () => {
        const result = findHighLow([]);
        expect(result.high).toBeNull();
        expect(result.low).toBeNull();
    });

    test('returns nulls for all non-numeric data', () => {
        const result = findHighLow(['a', 'b', undefined]);
        expect(result.high).toBeNull();
    });

    test('handles single element', () => {
        const result = findHighLow([42]);
        expect(result.high).toBe(42);
        expect(result.low).toBe(42);
        expect(result.highIdx).toBe(0);
        expect(result.lowIdx).toBe(0);
    });

    test('skips non-numeric values in mixed array', () => {
        const result = findHighLow([10, 'bad', 30, undefined, 5]);
        expect(result.high).toBe(30);
        expect(result.low).toBe(5);
    });
});
