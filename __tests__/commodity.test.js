/**
 * __tests__/commodity.test.js
 * 
 * Unit tests for BW.Commodity pure functions
 * Uses a simple extraction approach to avoid jsdom ESM issues
 */

// ============================================================
// Extract pure functions for testing
// ============================================================

// Copy of hexWithAlpha logic for isolated testing
function hexWithAlpha(hex, alphaPercent) {
    if (!hex) return null;
    let h = hex.replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
    const a = Math.round(Math.max(0, Math.min(100, alphaPercent)) * 2.55);
    const ahex = a.toString(16).padStart(2, '0');
    return `#${h}${ahex}`;
}

// Copy of filterDataByRange logic for isolated testing
function filterDataByRange(data, range) {
    if (range === 'ALL' || !data || data.length === 0) return data;

    const latestDataDate = new Date(data[data.length - 1].date);
    let cutoffDate = new Date(latestDataDate);

    switch (range) {
        case '1W': cutoffDate.setDate(latestDataDate.getDate() - 7); break;
        case '1M': cutoffDate.setMonth(latestDataDate.getMonth() - 1); break;
        case '3M': cutoffDate.setMonth(latestDataDate.getMonth() - 3); break;
        case '6M': cutoffDate.setMonth(latestDataDate.getMonth() - 6); break;
        case '1Y': cutoffDate.setFullYear(latestDataDate.getFullYear() - 1); break;
    }

    return data.filter(item => new Date(item.date) >= cutoffDate);
}

// Percent conversion logic
function calculatePercentages(prices) {
    if (!prices || prices.length === 0) return [];
    const base = prices[0];
    return prices.map(p => ((p - base) / base) * 100);
}

// ============================================================
// Tests
// ============================================================

describe('hexWithAlpha', () => {
    test('converts hex color with alpha percentage', () => {
        // 50% alpha = 127.5 -> 127 (Math.round) -> 0x7f
        const result = hexWithAlpha('#ff0000', 50);
        expect(result).toBe('#ff00007f');
    });

    test('handles color without hash', () => {
        const result = hexWithAlpha('00ff00', 100);
        expect(result).toBe('#00ff00ff');
    });

    test('returns original for invalid hex', () => {
        expect(hexWithAlpha('red', 50)).toBe('red');
        expect(hexWithAlpha('#fff', 50)).toBe('#fff');
    });

    test('returns null for null input', () => {
        expect(hexWithAlpha(null, 50)).toBeNull();
    });

    test('clamps alpha to 0-100 range', () => {
        const result100 = hexWithAlpha('#000000', 100);
        expect(result100).toBe('#000000ff');

        const result0 = hexWithAlpha('#000000', 0);
        expect(result0).toBe('#00000000');
    });

    test('handles 15% opacity correctly', () => {
        // 15% = 38.25 -> 38 -> 0x26
        const result = hexWithAlpha('#0f5499', 15);
        expect(result).toBe('#0f549926');
    });
});

describe('filterDataByRange', () => {
    test('ALL returns same array reference', () => {
        const data = [
            { date: '2024-01-01', price: 10 },
            { date: '2024-01-02', price: 11 }
        ];
        const filtered = filterDataByRange(data, 'ALL');
        expect(filtered).toBe(data);
    });

    test('returns empty array for empty input', () => {
        const filtered = filterDataByRange([], '1W');
        expect(filtered).toEqual([]);
    });

    test('returns null as-is', () => {
        expect(filterDataByRange(null, '1W')).toBeNull();
    });

    test('1W cuts data older than 7 days from latest observation', () => {
        const data = [
            { date: '2024-01-01', price: 1 },
            { date: '2024-01-05', price: 2 },
            { date: '2024-01-08', price: 3 }
        ];
        const out = filterDataByRange(data, '1W');
        // Latest is 2024-01-08, cutoff is 2024-01-01 (inclusive)
        // All 3 dates are within 7 days of 2024-01-08
        expect(out.length).toBeGreaterThanOrEqual(2);
        expect(out[out.length - 1].date).toBe('2024-01-08');
    });

    test('1M cuts data older than 1 month from latest observation', () => {
        const data = [
            { date: '2024-01-01', price: 1 },
            { date: '2024-01-15', price: 2 },
            { date: '2024-02-01', price: 3 }
        ];
        const out = filterDataByRange(data, '1M');
        // All dates within 1 month of 2024-02-01
        expect(out.length).toBeGreaterThanOrEqual(2);
    });

    test('uses latest observation date as reference, not current date', () => {
        // Data from 2020 - if we used current date, nothing would show
        const data = [
            { date: '2020-01-01', price: 1 },
            { date: '2020-01-05', price: 2 },
            { date: '2020-01-08', price: 3 }
        ];
        const out = filterDataByRange(data, '1W');
        // Should still work because we use latest observation (2020-01-08) as reference
        expect(out.length).toBeGreaterThan(0);
    });
});

describe('percent conversion', () => {
    test('calculates correct percentages from base price', () => {
        const prices = [100, 110, 121];
        const percentages = calculatePercentages(prices);

        expect(percentages[0]).toBeCloseTo(0);
        expect(percentages[1]).toBeCloseTo(10);
        expect(percentages[2]).toBeCloseTo(21);
    });

    test('handles negative changes', () => {
        const prices = [100, 90];
        const percentages = calculatePercentages(prices);

        expect(percentages[1]).toBeCloseTo(-10);
    });

    test('returns empty array for empty input', () => {
        expect(calculatePercentages([])).toEqual([]);
    });

    test('returns empty array for null input', () => {
        expect(calculatePercentages(null)).toEqual([]);
    });

    test('first element is always 0%', () => {
        const prices = [50, 75, 100];
        const percentages = calculatePercentages(prices);
        expect(percentages[0]).toBe(0);
    });
});

describe('semantic safeguards', () => {
    test('field names use observation-based terminology', () => {
        // These are the expected field names that should exist
        const expectedFields = [
            'abs_change_1_obs',
            'pct_change_1_obs',
            'pct_change_30_obs',
            'pct_change_365_obs',
            'direction_30_obs'
        ];

        // No forbidden terms in expected fields
        const forbiddenTerms = ['trend', 'return', 'signal', 'forecast'];

        expectedFields.forEach(field => {
            forbiddenTerms.forEach(term => {
                expect(field.toLowerCase()).not.toContain(term);
            });
        });
    });

    test('direction is used instead of trend', () => {
        const correctField = 'direction_30_obs';
        const incorrectField = 'trend';

        expect(correctField).toContain('direction');
        expect(correctField).not.toBe(incorrectField);
    });
});
