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

        // Get theme-aware colors
        const colors = (BW.Theme && BW.Theme.getSparklineColors)
            ? BW.Theme.getSparklineColors()
            : {
                line: '#0f5499',
                gradientStart: 'rgba(15, 84, 153, 0.1)',
                gradientEnd: 'rgba(15, 84, 153, 0)'
            };

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const stepX = width / (data.length - 1);
        const padding = 2;
        const drawHeight = height - padding * 2;

        // Draw line
        ctx.beginPath();
        data.forEach((val, i) => {
            const x = i * stepX;
            const y = padding + drawHeight - ((val - min) / range) * drawHeight;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });

        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Fill gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, colors.gradientStart);
        gradient.addColorStop(1, colors.gradientEnd);

        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = gradient;
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

// Auto-initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function () {
    if (BW.Sparkline) {
        BW.Sparkline.renderAll();
    }
});
