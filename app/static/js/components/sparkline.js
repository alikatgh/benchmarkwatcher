/* Theme-aware D3 sparklines. */
window.BW = window.BW || {};
BW.Sparkline = {
    render: function (element, data) { if (BW.Visuals) BW.Visuals.sparkline(element, data, {type: 'area'}); },
    renderAll: function () {
        document.querySelectorAll('[data-sparkline]').forEach(element => {
            try { this.render(element, JSON.parse(element.dataset.sparkline)); } catch (_) { /* Missing data stays empty. */ }
        });
    },
    refresh: function () { this.renderAll(); BW.CompactTable?.refreshSparklines(); },
    _observeResize: function () {} // SVG viewBoxes resize without a canvas redraw.
};
if (!window.__bwSparklineDomReadyBound) {
    window.__bwSparklineDomReadyBound = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => BW.Sparkline.renderAll());
    else BW.Sparkline.renderAll();
}
