/**
 * BenchmarkWatcher - Sparkline Module
 * Theme-aware sparkline rendering utilities
 * 
 * Provides:
 * - renderAll() method to render canvas-based sparklines with data-sparkline attribute
 * - Theme change auto-refresh (via BW.Theme integration)
 * - Unified color lookup through BW.Theme.getSparklineColors()
 */

window.BW = window.BW || {};

BW.Sparkline = {
    // Render a single canvas sparkline
    render: function (canvas, data) {
        if (!canvas || !Array.isArray(data) || data.length < 2) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || canvas.offsetWidth;
        const height = canvas.clientHeight || canvas.offsetHeight;

        if (width === 0 || height === 0) return;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // Get theme-aware colors from CSS variables or theme module
        const colors = (BW.Theme && BW.Theme.getSparklineColors)
            ? BW.Theme.getSparklineColors()
            : (() => {
                const cs = getComputedStyle(document.documentElement);
                return {
                    line: cs.getPropertyValue('--sparkline-line').trim() || cs.getPropertyValue('--theme-accent').trim() || '#0f5499',
                    gradientStart: cs.getPropertyValue('--sparkline-grad-start').trim() || 'rgba(15, 84, 153, 0.1)',
                    gradientEnd: cs.getPropertyValue('--sparkline-grad-end').trim() || 'rgba(15, 84, 153, 0)'
                };
            })();

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const dotRadius = 2.5;
        const padding = dotRadius + 1; // ensure end-dot doesn't clip
        const stepX = (width - padding) / (data.length - 1);
        const drawHeight = height - padding * 2;

        // Convert data to x/y points
        const points = data.map((val, i) => ({
            x: i * stepX,
            y: padding + drawHeight - ((val - min) / range) * drawHeight
        }));

        // Draw smooth curve using monotone cubic interpolation
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            // Catmull-Rom to cubic Bezier conversion (tension = 0 = smooth)
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }

        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Fill gradient under the curve
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, colors.gradientStart);
        gradient.addColorStop(1, colors.gradientEnd);

        ctx.lineTo(points[points.length - 1].x, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // End-dot marker — highlights the latest data point
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = colors.line;
        ctx.fill();
    },

    // Render all sparklines with data-sparkline attribute
    renderAll: function () {
        document.querySelectorAll('canvas[data-sparkline]').forEach(canvas => {
            const raw = canvas.dataset.sparkline;
            try {
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this.render(canvas, data);
                }
            } catch (e) {
                console.warn('BW.Sparkline: Invalid sparkline data', e);
            }
        });
    },

    // Refresh all sparklines (for theme changes)
    refresh: function () {
        // First, refresh simple canvas sparklines
        this.renderAll();

        // Then, refresh Chart.js sparklines in compact table (if loaded)
        if (BW.CompactTable && typeof BW.CompactTable.refreshSparklines === 'function') {
            BW.CompactTable.refreshSparklines();
        }
    }
};

// Auto-initialize on DOMContentLoaded (bind once across duplicate script loads)
if (!window.__bwSparklineDomReadyBound) {
    window.__bwSparklineDomReadyBound = true;
    const runSparklineInit = function () {
        if (BW.Sparkline) {
            BW.Sparkline.renderAll();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runSparklineInit);
    } else {
        runSparklineInit();
    }

    // Re-render canvas sparklines when their containers resize
    if (typeof ResizeObserver !== 'undefined') {
        let resizeTimer = null;
        const resizeObs = new ResizeObserver(function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                if (BW.Sparkline) BW.Sparkline.renderAll();
            }, 150);
        });
        const observeSparklines = function () {
            document.querySelectorAll('canvas[data-sparkline]').forEach(function (canvas) {
                if (!canvas.__bwResizeObserved) {
                    canvas.__bwResizeObserved = true;
                    resizeObs.observe(canvas);
                }
            });
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', observeSparklines);
        } else {
            observeSparklines();
        }
        // Expose so dynamically added sparklines can be observed
        BW.Sparkline._observeResize = observeSparklines;
    }
}
