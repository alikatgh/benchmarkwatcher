/**
 * BenchmarkWatcher - Utility Functions (hardened)
 * - safe numeric parsing & finite checks
 * - accepts numbers or parseable strings
 * - robust date handling (strings or Date objects)
 * - defensive moving-average / high/low
 */

window.BW = window.BW || {};

BW.Utils = (function () {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    function toNumber(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    }

    function isNumberLike(v) {
        return Number.isFinite(Number(v));
    }

    return {
        // Format price with fixed precision (returns string). Non-numeric -> empty string.
        formatPrice: function (value, precision = 2) {
            const n = toNumber(value);
            if (!Number.isFinite(n)) return '';
            return n.toFixed(Math.max(0, precision));
        },

        // Format with thousands separators using locale. Non-numeric -> empty string.
        formatPriceThousands: function (value, precision = 2) {
            const n = toNumber(value);
            if (!Number.isFinite(n)) return '';
            return n.toLocaleString(undefined, {
                minimumFractionDigits: Math.max(0, precision),
                maximumFractionDigits: Math.max(0, precision)
            });
        },

        // Compact format (K / M). Keeps sign. Non-numeric -> empty string.
        formatCompact: function (value, precision = 2) {
            const n = toNumber(value);
            if (!Number.isFinite(n)) return '';
            const sign = n < 0 ? '-' : '';
            const abs = Math.abs(n);

            if (abs >= 1_000_000) {
                return sign + (abs / 1_000_000).toFixed(Math.max(0, precision)) + 'M';
            } else if (abs >= 1_000) {
                return sign + (abs / 1_000).toFixed(Math.max(0, precision)) + 'K';
            }
            return sign + abs.toFixed(Math.max(0, precision));
        },

        // Parse date-like input (string or Date). Returns Date instance or null.
        _toDate: function (input) {
            if (!input) return null;
            if (input instanceof Date) {
                return isNaN(input.getTime()) ? null : input;
            }
            // Try ISO/other parse
            const d = new Date(String(input));
            return isNaN(d.getTime()) ? null : d;
        },

        // Format date in several formats. If parsing fails, returns original input.
        formatDate: function (dateInput, format = 'iso') {
            const d = this._toDate(dateInput);
            if (!d) return dateInput;

            switch (format) {
                case 'iso':
                    // Return YYYY-MM-DD (date-only ISO)
                    return d.toISOString().split('T')[0];
                case 'short':
                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                case 'long':
                    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
                case 'relative':
                    return this.getRelativeDate(d);
                default:
                    return dateInput;
            }
        },

        // Human-friendly relative date. Handles future/past.
        getRelativeDate: function (date) {
            const d = this._toDate(date);
            if (!d) return '';

            const now = new Date();
            // Round to nearest day by using floor of difference in ms
            const diffMs = now.setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0);
            const diffDays = Math.round(diffMs / MS_PER_DAY) * -1; // negative if past -> positive days ago

            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Tomorrow';
            if (diffDays === -1) return 'Yesterday';

            if (diffDays > 1 && diffDays < 7) return `${diffDays} days from now`;
            if (diffDays < -1 && diffDays > -7) return `${Math.abs(diffDays)} days ago`;

            if (Math.abs(diffDays) < 30) {
                const weeks = Math.round(Math.abs(diffDays) / 7);
                return `${weeks} week${weeks > 1 ? 's' : ''} ${diffDays > 0 ? 'from now' : 'ago'}`;
            }

            // Fallback to short date
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        },

        // Parse JSON stored in a script tag (id). Returns parsed object or null.
        getJsonData: function (elementId) {
            try {
                const el = document.getElementById(elementId);
                if (!el) return null;
                const text = el.textContent.trim();
                if (!text) return null;
                return JSON.parse(text);
            } catch (e) {
                console.warn('BW.Utils.getJsonData: failed to parse JSON for', elementId, e);
                return null;
            }
        },

        // Debounce preserving `this` and arguments
        debounce: function (func, wait = 200) {
            let timeout = null;
            return function debounced(...args) {
                const ctx = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    timeout = null;
                    func.apply(ctx, args);
                }, wait);
            };
        },

        // Calculate simple moving average (returns array same length as input).
        // Non-numeric windows produce null in output position.
        calculateMA: function (data = [], period = 7) {
            if (!Array.isArray(data) || data.length === 0 || period <= 0) return [];

            const out = new Array(data.length).fill(null);
            const nums = data.map(v => toNumber(v));

            let windowSum = 0;
            let validCount = 0;
            // Initialize first window
            for (let i = 0; i < data.length; i++) {
                const val = nums[i];
                if (i < period) {
                    if (Number.isFinite(val)) {
                        windowSum += val;
                        validCount++;
                    }
                    if (i === period - 1) {
                        // only set MA if all entries in window are numeric (strict) OR if you prefer allow partial, change logic.
                        out[i] = (validCount === period) ? windowSum / period : null;
                    } else {
                        out[i] = null;
                    }
                } else {
                    // Slide window: remove i-period, add i
                    const prev = nums[i - period];
                    if (Number.isFinite(prev)) windowSum -= prev;
                    else validCount = Math.max(0, validCount - 1);

                    if (Number.isFinite(val)) {
                        windowSum += val;
                        validCount++;
                    }
                    out[i] = (validCount === period) ? windowSum / period : null;
                }
            }
            return out;
        },

        // Find high/low among numeric values only. Returns nulls when no numeric entries.
        findHighLow: function (data = []) {
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
                if (n > high) {
                    high = n;
                    highIdx = i;
                }
                if (n < low) {
                    low = n;
                    lowIdx = i;
                }
            });

            if (highIdx === null) {
                return { highIdx: null, lowIdx: null, high: null, low: null };
            }
            return { highIdx, lowIdx, high, low };
        }
    };
})();
