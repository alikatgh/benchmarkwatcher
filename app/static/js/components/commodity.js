/**
 * BenchmarkWatcher - Commodity Detail Component
 * Handles the commodity detail page with interactive D3 chart
 */

window.BW = window.BW || {};

BW.Commodity = {
    // State
    currentRange: 'ALL',
    currentChartType: 'line',
    currentViewMode: 'price', // 'price' or 'percent'
    priceChart: null,
    fullHistoryData: null,
    chartColors: null,
    chartElement: null,
    currency: 'USD',
    commodityName: 'commodity',
    commodityId: '',
    previouslyFocusedChartControl: null,
    activeSettingsTab: 'appearance',
    chartSettingsFocusTimer: null,
    chartSettingsFocusSeq: 0,
    exportImageTimer: null,
    exportImageSeq: 0,
    copyFeedbackTimer: null,
    copyFeedbackSeq: 0,

    // Comparison state
    comparisonData: {},      // { id: { name, history, color } }
    comparisonPendingSeq: {}, // { id: requestSeq } for in-flight compare additions
    comparisonRequestSeq: 0,
    compareListRequest: null,
    compareListRequestSeq: 0,
    compareListLoading: false,
    allCommoditiesList: [],  // cached list from API
    compareColors: ['#e11d48', '#8b5cf6', '#f59e0b', '#06b6d4', '#84cc16', '#ec4899', '#14b8a6', '#f97316'],
    compareColorIndex: 0,

    // Chart customization settings with defaults (overridden by theme on init)
    chartSettings: {
        // Colors — will be set from active theme preset on init/reset
        chartTheme: 'light',
        lineColor: '#0f5499',
        fillColor: '#0f5499',
        fillOpacity: 15,
        gridColor: '#33302e',
        gridOpacity: 10,
        upColor: '#0d7680',
        downColor: '#990f3d',
        tooltipBg: '#f7f4f0',
        tooltipText: '#33302e',

        // Chart rendering
        lineWidth: 2,
        pointRadius: 0,
        tension: 10,
        enableFill: true,
        showHGrid: true,
        showVGrid: false,

        // Scales
        yAxisPosition: 'right',
        yMaxTicks: 6,
        xMaxTicks: 8,
        axisFontSize: 11,

        // Tooltip
        tooltipRadius: 8,
        tooltipPadding: 12,
        showCrosshairDate: true,
        showCrosshairPrice: true,
        showCrosshairChange: true,

        // Interaction
        enableZoom: true,
        enablePan: true,
        zoomModifier: 'ctrl',
        enableAnimation: true,
        animationDuration: 300,
        chartHeight: 400,
        responsiveHeight: true,

        // Visibility
        showStatsBar: true,
        showStatHigh: true,
        showStatLow: true,
        showStatAvg: true,
        showStatRange: true,
        showStatPoints: true,
        showResetBtn: true,
        showDownloadBtn: true
    },

    // Helper to produce a hex+alpha safely
    hexWithAlpha: function (hex, alphaPercent) {
        // Accepts "#RRGGBB" or "RRGGBB" and returns "#RRGGBBAA"
        if (!hex) return null;
        let h = hex.replace('#', '').trim();
        // If color isn't 6 hex chars, don't try to append alpha — just return original
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
        const pct = Number(alphaPercent);
        if (!Number.isFinite(pct)) return `#${h}ff`; // default to fully opaque
        const a = Math.round(Math.max(0, Math.min(100, pct)) * 2.55);
        const ahex = a.toString(16).padStart(2, '0');
        return `#${h}${ahex}`;
    },

    // Preset themes for chart customization
    themes: {
        light: {
            lineColor: '#1967d2', fillColor: '#1967d2', fillOpacity: 15,
            gridColor: '#33302e', gridOpacity: 10, tooltipBg: '#f7f4f0', tooltipText: '#33302e',
            upColor: '#0d7680', downColor: '#990f3d'
        },
        dark: {
            lineColor: '#8ab4f8', fillColor: '#8ab4f8', fillOpacity: 15,
            gridColor: '#e8e6e3', gridOpacity: 5, tooltipBg: '#13171f', tooltipText: '#e8e6e3',
            upColor: '#00d68f', downColor: '#ff6b6b'
        },
        'mono-light': {
            lineColor: '#000000', fillColor: '#000000', fillOpacity: 10,
            gridColor: '#000000', gridOpacity: 8, tooltipBg: '#ffffff', tooltipText: '#000000',
            upColor: '#333333', downColor: '#666666'
        },
        'mono-dark': {
            lineColor: '#ffffff', fillColor: '#ffffff', fillOpacity: 10,
            gridColor: '#ffffff', gridOpacity: 5, tooltipBg: '#0a0a0a', tooltipText: '#ffffff',
            upColor: '#cccccc', downColor: '#888888'
        },
        bloomberg: {
            lineColor: '#ff9933', fillColor: '#ff9933', fillOpacity: 20,
            gridColor: '#ff9933', gridOpacity: 10, tooltipBg: '#2d2d2d', tooltipText: '#ff9933',
            upColor: '#00ff00', downColor: '#ff3333'
        },
        ft: {
            lineColor: '#990f3d', fillColor: '#990f3d', fillOpacity: 15,
            gridColor: '#33302e', gridOpacity: 10, tooltipBg: '#fff9f5', tooltipText: '#33302e',
            upColor: '#0d7680', downColor: '#990f3d'
        },
        ocean: {
            lineColor: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 20,
            gridColor: '#0ea5e9', gridOpacity: 8, tooltipBg: '#f0f9ff', tooltipText: '#0c4a6e',
            upColor: '#10b981', downColor: '#f43f5e'
        },
        forest: {
            lineColor: '#16a34a', fillColor: '#16a34a', fillOpacity: 20,
            gridColor: '#16a34a', gridOpacity: 8, tooltipBg: '#f0fdf4', tooltipText: '#14532d',
            upColor: '#22c55e', downColor: '#dc2626'
        }
    },

    // Initialize with data
    init: function (historyData, currency, commodityName, commodityId) {
        this.fullHistoryData = BW.Visuals.history(historyData).map(point => ({ ...point, price: point.value }));
        this.currency = currency || 'USD';
        this.commodityName = commodityName || 'commodity';
        this.commodityId = commodityId || '';

        const canvas = document.getElementById('priceChart');
        if (!canvas) return;
        this.chartElement = canvas;

        // Start with the page theme; an explicitly saved chart style can override it.
        const pageTheme = document.documentElement.getAttribute('data-theme') || 'light';
        Object.assign(this.chartSettings, this.themes[pageTheme] || this.themes.light);
        this.chartSettings.chartTheme = pageTheme;
        this.loadChartSettings();

        // Set up colors based on theme (will be overridden by chartSettings)
        this.setupColors();

        // Initial render
        this.updateChart();
        this.updateRangeButtons();
        this.updateTypeButtons();
        this.updateViewButtons();
        if (historyData.length) {
            const start = document.getElementById('chart-date-start');
            const end = document.getElementById('chart-date-end');
            [start, end].forEach(input => { if (input) { input.min = historyData[0].date.slice(0, 10); input.max = historyData[historyData.length - 1].date.slice(0, 10); } });
            if (start) start.value = start.min;
            if (end) end.value = end.max;
        }

        // Hide skeleton loader once chart is ready
        const skeleton = document.getElementById('chart-skeleton');
        if (skeleton) {
            skeleton.classList.add('opacity-0');
            setTimeout(() => skeleton.remove(), 300);
        }
    },

    // Setup chart colors based on current theme - reads from CSS variables
    setupColors: function () {
        const cs = getComputedStyle(document.documentElement);
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        const isDark = document.documentElement.classList.contains('dark');

        // Read colors from the current theme preset if available
        const preset = this.themes[theme];
        const accentColor = cs.getPropertyValue('--theme-accent').trim() || (preset ? preset.lineColor : '#0f5499');
        const textColor = cs.getPropertyValue('--theme-text-muted').trim() || (isDark ? '#999' : '#66605c');
        const surfaceColor = cs.getPropertyValue('--theme-surface').trim() || (isDark ? '#13171f' : '#f7f4f0');
        const mainText = cs.getPropertyValue('--theme-text').trim() || (isDark ? '#e8e6e3' : '#33302e');
        const borderColor = cs.getPropertyValue('--theme-border').trim() || (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(51,48,46,0.2)');

        this.chartColors = {
            price: preset ? preset.lineColor : accentColor,
            priceLight: this.hexWithAlpha(preset ? preset.fillColor : accentColor, 10) || accentColor,
            grid: this.hexWithAlpha(preset ? preset.gridColor : mainText, preset ? preset.gridOpacity : 10) || mainText,
            text: textColor,
            tooltipBg: preset ? preset.tooltipBg : surfaceColor,
            tooltipText: preset ? preset.tooltipText : mainText,
            tooltipBorder: borderColor,
        };
    },

    // Windows use UTC calendar dates, anchored to the primary series' last observation.
    filterDataByRange: function (data, range) {
        if (range === 'ALL' || !data || data.length === 0) return data;
        const primary = this.fullHistoryData && this.fullHistoryData.length ? this.fullHistoryData : data;
        const latest = primary[primary.length - 1].date.slice(0, 10);
        let start, end = latest;
        if (range === 'custom' && this.customDateWindow) {
            start = this.customDateWindow.start;
            end = this.customDateWindow.end;
        } else {
            const anchor = new Date(latest + 'T00:00:00Z');
            const y = anchor.getUTCFullYear(), m = anchor.getUTCMonth(), day = anchor.getUTCDate();
            let cutoff;
            if (range === '1W') cutoff = new Date(Date.UTC(y, m, day - 7));
            else if (range === 'YTD') cutoff = new Date(Date.UTC(y, 0, 1));
            else {
                const months = {'1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60}[range];
                if (!months) return data;
                cutoff = new Date(Date.UTC(y, m - months, 1));
                const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
                cutoff.setUTCDate(Math.min(day, lastDay));
            }
            start = cutoff.toISOString().slice(0, 10);
        }
        return data.filter(item => item.date.slice(0, 10) >= start && item.date.slice(0, 10) <= end);
    },

    applyCustomDates: function () {
        const startInput = document.getElementById('chart-date-start');
        const endInput = document.getElementById('chart-date-end');
        const error = document.getElementById('chart-date-error');
        const start = startInput.value, end = endInput.value;
        const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        let message = '';
        if (!valid(start) || !valid(end)) message = 'Enter valid start and end dates.';
        else if (start > end) message = 'The start date must be on or before the end date.';
        else if (!this.fullHistoryData.some(row => row.date.slice(0, 10) >= start && row.date.slice(0, 10) <= end)) message = 'No observations in this window. Choose a wider range.';
        if (error) error.textContent = message;
        if (message) return false;
        this.customDateWindow = {start, end};
        this.setTimeRange('custom');
        document.getElementById('chart-date-picker').open = false;
        document.getElementById('range-custom').focus();
        return true;
    },

    // Calculate and display statistics
    calculateStats: function (data) {
        if (!data || data.length === 0) {
            const statIds = ['stat-high', 'stat-low', 'stat-avg', 'stat-range', 'stat-points', 'date-range-display'];
            statIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '--';
            });
            return;
        }

        const prices = data.map(item => item.price);
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const range = high - low;

        const statHigh = document.getElementById('stat-high');
        const statLow = document.getElementById('stat-low');
        const statAvg = document.getElementById('stat-avg');
        const statRange = document.getElementById('stat-range');
        const statPoints = document.getElementById('stat-points');
        const dateRangeDisplay = document.getElementById('date-range-display');

        const fmt2 = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (statHigh) statHigh.textContent = fmt2(high) + ' ' + this.currency;
        if (statLow) statLow.textContent = fmt2(low) + ' ' + this.currency;
        if (statAvg) statAvg.textContent = fmt2(avg) + ' ' + this.currency;
        if (statRange) statRange.textContent = fmt2(range) + ' ' + this.currency;
        if (statPoints) statPoints.textContent = data.length;

        if (dateRangeDisplay && data.length > 0) {
            const startDate = new Date(data[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const endDate = new Date(data[data.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            dateRangeDisplay.textContent = `${startDate} — ${endDate}`;
        }
    },

    // All series retain their actual observation dates; missing values are never filled.
    updateChart: function () {
        const V = BW.Visuals;
        const target = document.getElementById('priceChart');
        if (!target || !V) return;
        const filtered = this.filterDataByRange(this.fullHistoryData, this.currentRange) || [];
        const settings = this.chartSettings;
        target.parentElement.style.height = this.getChartHeight() + 'px';
        const primaryUnit = target.dataset.unit || '';
        const mixedUnits = Object.values(this.comparisonData).some(record => record.currency !== this.currency || record.unit !== primaryUnit);
        if (mixedUnits) this.currentViewMode = 'percent';
        const percent = this.currentViewMode === 'percent';
        this.updateSegmentedControls('chart-view-controls', this.currentViewMode, mixedUnits ? ['price'] : []);
        const viewSelect = document.getElementById('chart-view-select');
        if (viewSelect) { viewSelect.value = this.currentViewMode; viewSelect.querySelector('option[value=price]').disabled = mixedUnits; }
        let comparisonNote = document.getElementById('d3-comparison-note');
        if (!comparisonNote) { comparisonNote = document.createElement('p'); comparisonNote.id = 'd3-comparison-note'; comparisonNote.className = 'bw-visual-note'; target.parentElement.after(comparisonNote); }
        comparisonNote.textContent = mixedUnits ? 'Different units: comparing percentage changes from each series’ first available positive value. Baseline dates may differ; missing observations are not filled.' : '';
        const valueLabel = document.getElementById('crosshair-value-label');
        if (valueLabel) valueLabel.textContent = percent ? 'Change from baseline' : 'Value';
        this.calculateStats(filtered.filter(p => p.price !== null));
        const records = [{name: this.commodityName, history: filtered, color: settings.lineColor, currency: this.currency, unit: primaryUnit, is_daily: target.dataset.daily === 'true'},
            ...Object.values(this.comparisonData).map(record => ({ ...record, history: this.filterDataByRange(record.history, this.currentRange) }))];
        const series = records.map(record => {
            const observations = V.history(record.history);
            const baseline = observations.find(p => p.value !== null)?.value;
            return {name: record.name, color: record.color, gapDays: record.is_daily ? 7 : 62, unit: percent ? '%' : [record.currency || this.currency, record.unit].filter(Boolean).join(' / '),
                points: observations.map(p => ({...p, value: percent ? (baseline > 0 && p.value !== null ? (p.value / baseline - 1) * 100 : null) : p.value}))};
        });
        this.priceChart?.destroy();
        this.priceChart = V.timeSeries(target, series, {
            type: this.currentChartType === 'area' && !settings.enableFill ? 'line' : this.currentChartType,
            height: Math.min(settings.chartHeight, target.parentElement.clientHeight || settings.chartHeight),
            label: this.commodityName + ' historical observations. Use left and right arrow keys to inspect observations.',
            color: settings.lineColor, fillColor: settings.fillColor, fillOpacity: settings.fillOpacity / 100,
            lineWidth: settings.lineWidth, pointRadius: settings.pointRadius,
            grid: settings.showHGrid, verticalGrid: settings.showVGrid, gridColor: this.hexWithAlpha(settings.gridColor, settings.gridOpacity),
            xTicks: settings.xMaxTicks, yTicks: settings.yMaxTicks, yAxisPosition: settings.yAxisPosition, axisFontSize: settings.axisFontSize,
            tension: settings.tension / 100, animation: settings.enableAnimation ? settings.animationDuration : 0,
            tooltipBg: settings.tooltipBg, tooltipText: settings.tooltipText, tooltipRadius: settings.tooltipRadius, tooltipPadding: settings.tooltipPadding,
            zero: percent, zoom: settings.enableZoom, pan: settings.enablePan, modifier: settings.zoomModifier,
            onInspect: (point, series) => {
                if (!point) return;
                const date = document.getElementById('crosshair-date'), value = document.getElementById('crosshair-price'), change = document.getElementById('crosshair-change');
                if (date) date.textContent = point.date;
                if (value) value.textContent = V.format(point.value) + ' ' + series.unit;
                const index = series.points.indexOf(point), prev = series.points[index - 1];
                if (change) change.textContent = prev && prev.value !== null ? V.format(point.value - prev.value) + (percent ? ' pp' : ' ' + series.unit) : '—';
            }
        });
        if (BW.VisualExplorer) BW.VisualExplorer.detail(filtered, this.commodityName, [this.currency, primaryUnit].filter(Boolean).join(' / '));
        if (!this.chartResizeObserver && typeof ResizeObserver !== 'undefined') {
            let size = target.clientWidth;
            this.chartResizeObserver = new ResizeObserver(() => {
                if (Math.abs(target.clientWidth - size) < 1) return;
                size = target.clientWidth;
                this.updateChart();
            });
            this.chartResizeObserver.observe(target);
        }
    },

    // Set time range
    setTimeRange: function (range) {
        this.currentRange = range;
        this.updateChart();
        this.updateRangeButtons();
    },

    // Set chart type
    setChartType: function (type) {
        this.currentChartType = type;
        this.updateChart();
        this.updateTypeButtons();
    },

    // Set view mode (price or percent)
    setViewMode: function (mode) {
        this.currentViewMode = mode;
        this.updateChart();
        this.updateViewButtons();
    },

    // Update view mode button states
    updateViewButtons: function () {
        this.updateSegmentedControls('chart-view-controls', this.currentViewMode);
        const select = document.getElementById('chart-view-select');
        if (select) select.value = this.currentViewMode;
        const activeClasses = 'theme-surface theme-text';
        const inactiveClasses = 'text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5';
        const chartViewButtons = [
            { id: 'view-price', mode: 'price' },
            { id: 'view-percent', mode: 'percent' }
        ];

        chartViewButtons.forEach(({ id, mode }) => {
            const btn = document.getElementById(id);
            if (!btn) return;

            btn.setAttribute('aria-pressed', mode === this.currentViewMode ? 'true' : 'false');
            btn.className = 'view-btn min-h-[44px] px-3 sm:px-4 text-xs font-semibold rounded-lg transition flex items-center gap-1.5';
            if (mode === this.currentViewMode) {
                btn.className += ' ' + activeClasses;
            } else {
                btn.className += ' ' + inactiveClasses;
            }
        });
    },

    // Reset zoom
    resetZoom: function () {
        if (this.priceChart) {
            this.priceChart.resetZoom();
        }
    },

    // --- Download menu & multi-format export ---
    toggleDownloadMenu: function () {
        var menu = document.getElementById('download-menu');
        var chevron = document.getElementById('download-chevron');
        var btn = document.getElementById('download-menu-btn');
        if (!menu) return;
        var isOpen = !menu.classList.contains('hidden');
        if (isOpen) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
            if (chevron) chevron.classList.remove('rotate-180');
            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                btn.focus();
            }
        } else {
            this.closeCompareMenu();
            menu.classList.remove('hidden');
            menu.setAttribute('aria-hidden', 'false');
            if (chevron) chevron.classList.add('rotate-180');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            const firstItem = menu.querySelector('[role="menuitem"]');
            if (firstItem) firstItem.focus();
        }
    },

    closeDownloadMenu: function () {
        var menu = document.getElementById('download-menu');
        var chevron = document.getElementById('download-chevron');
        var btn = document.getElementById('download-menu-btn');
        if (menu) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
        }
        if (chevron) chevron.classList.remove('rotate-180');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    },

    exportDownload: function (format) {
        this.closeDownloadMenu();
        switch (format) {
            case 'csv': this.exportCSV(); break;
            case 'excel': this.exportExcel(); break;
            case 'image': this.exportImage(); break;
            case 'pptx': this.exportPPTX(); break;
        }
    },

    // CSV export - price history as .csv
    exportCSV: function () {
        var filteredData = this.filterDataByRange(this.fullHistoryData, this.currentRange);
        if (!filteredData || filteredData.length === 0) return;
        var name = this.commodityName || 'commodity';
        var currency = this.currency || 'USD';
        var rows = ['Date,Price (' + currency + ')'];
        filteredData.forEach(function (item) {
            rows.push(item.date + ',' + item.price);
        });
        var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name + '-price-history.csv';
        link.click();
        URL.revokeObjectURL(link.href);
    },

    // Excel export - SpreadsheetML XML opened natively by Excel
    exportExcel: function () {
        var filteredData = this.filterDataByRange(this.fullHistoryData, this.currentRange);
        if (!filteredData || filteredData.length === 0) return;
        var name = this.commodityName || 'commodity';
        var currency = this.currency || 'USD';
        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<?mso-application progid="Excel.Sheet"?>\n' +
            '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
            ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
            ' <Worksheet ss:Name="Price History">\n  <Table>\n' +
            '   <Row><Cell><Data ss:Type="String">Date</Data></Cell>' +
            '<Cell><Data ss:Type="String">Price (' + currency + ')</Data></Cell></Row>\n';
        filteredData.forEach(function (item) {
            xml += '   <Row><Cell><Data ss:Type="String">' + item.date + '</Data></Cell>' +
                '<Cell><Data ss:Type="Number">' + item.price + '</Data></Cell></Row>\n';
        });
        xml += '  </Table>\n </Worksheet>\n</Workbook>';
        var blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name + '-price-history.xls';
        link.click();
        URL.revokeObjectURL(link.href);
    },

    // Image export - PNG of chart (legacy downloadChart)
    exportImage: function () {
        if (!this.priceChart) {
            console.warn('No chart available to download.');
            return;
        }
        this.exportImageSeq += 1;
        const activeExportSeq = this.exportImageSeq;
        if (this.exportImageTimer) {
            clearTimeout(this.exportImageTimer);
            this.exportImageTimer = null;
        }

        this.exportImageTimer = setTimeout(async function () {
            if (activeExportSeq !== this.exportImageSeq) return;
            if (!this.priceChart || typeof this.priceChart.toBase64Image !== 'function') return;
            var link = document.createElement('a');
            link.download = (this.commodityName || 'commodity') + '-price-chart.png';
            try {
                link.href = await this.priceChart.toBase64Image();
                if (activeExportSeq === this.exportImageSeq) link.click();
            } catch (_) { alert('The chart image could not be created. Please try again.'); }
            this.exportImageTimer = null;
        }.bind(this), 100);
    },

    // PowerPoint export - lazy-loads PptxGenJS from CDN
    exportPPTX: function () {
        var self = this;
        if (!this.priceChart) {
            console.warn('No chart available to export.');
            return;
        }
        var run = async function () {
            var pptx = new PptxGenJS();
            var slide = pptx.addSlide();
            slide.addText(self.commodityName || 'Commodity', {
                x: 0.5, y: 0.3, fontSize: 22, bold: true, color: '333333'
            });
            var imgData = await self.priceChart.toBase64Image();
            slide.addImage({ data: imgData, x: 0.3, y: 0.9, w: 9.2, h: 4.5 });
            pptx.writeFile({ fileName: (self.commodityName || 'commodity') + '-chart.pptx' });
        };
        if (window.PptxGenJS) { run(); return; }
        // Lazy-load the vendored, same-origin PptxGenJS bundle. The URL (with the
        // ?v=<mtime> cache-buster) is published by commodity.html on the script tag's
        // data-pptx-src; loading from a CDN here would be blocked by the CSP
        // (script-src 'self'). Fall back to the static path if the tag is missing.
        var tag = document.getElementById('bw-commodity-js');
        var src = (tag && tag.dataset.pptxSrc) || '/static/js/vendor/pptxgen.bundle.min.js';
        var script = document.createElement('script');
        script.src = src;
        script.onload = run;
        script.onerror = function () { alert('Failed to load PowerPoint export library. Please try again.'); };
        document.head.appendChild(script);
    },

    // Backward-compatible alias
    downloadChart: function () {
        this.exportImage();
    },

    // Update range button states
    updateRangeButtons: function () {
        const custom = document.getElementById('range-custom');
        if (custom) { custom.dataset.active = String(this.currentRange === 'custom'); custom.textContent = this.currentRange === 'custom' ? 'Custom dates ▾' : 'Dates ▾'; }
        const self = this;
        ['1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL'].forEach(range => {
            const btn = document.getElementById(`range-${range}`);
            if (btn) {
                btn.setAttribute('aria-pressed', String(range === self.currentRange));
                if (range === self.currentRange) {
                    btn.className = 'range-btn min-h-[44px] px-3 sm:px-4 text-xs font-semibold rounded-lg transition theme-surface theme-text';
                } else {
                    btn.className = 'range-btn min-h-[44px] px-3 sm:px-4 text-xs font-semibold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition';
                }
            }
        });
    },

    // Update type button states
    updateTypeButtons: function () {
        this.updateSegmentedControls('chart-type-controls', this.currentChartType);
        const select = document.getElementById('chart-type-select');
        if (select) select.value = this.currentChartType;
        const self = this;
        ['line', 'area', 'step', 'bar', 'scatter'].forEach(type => {
            const btn = document.getElementById(`type-${type}`);
            if (btn) {
                if (type === self.currentChartType) {
                    btn.className = 'type-btn min-h-[44px] px-3 sm:px-4 text-xs font-semibold rounded-lg transition theme-surface theme-text flex items-center gap-1.5';
                } else {
                    btn.className = 'type-btn min-h-[44px] px-3 sm:px-4 text-xs font-semibold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition flex items-center gap-1.5';
                }
            }
        });
    },

    // Native radios own keyboard behavior; the indicator follows the selected value.
    updateSegmentedControls: function (id, value, disabledValues) {
        const group = document.getElementById(id);
        if (!group) return;
        const inputs = Array.from(group.querySelectorAll('input[type="radio"]'));
        inputs.forEach(input => {
            input.checked = input.value === value;
            if (disabledValues) input.disabled = disabledValues.includes(input.value);
        });
        const track = group.querySelector('.chart-segmented-track');
        if (track) track.style.setProperty('--segment-index', Math.max(0, inputs.findIndex(input => input.value === value)));
    },

    // ============================================================
    // CHART SETTINGS FUNCTIONS
    // ============================================================

    // Open settings modal
    openChartSettings: function () {
        const modal = document.getElementById('chart-settings-modal');
        if (modal) {
            if (modal.open) return;
            this.chartSettingsFocusSeq += 1;
            const activeFocusSeq = this.chartSettingsFocusSeq;
            if (this.chartSettingsFocusTimer) {
                clearTimeout(this.chartSettingsFocusTimer);
                this.chartSettingsFocusTimer = null;
            }
            this.previouslyFocusedChartControl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            modal.classList.remove('hidden');
            modal.removeAttribute('aria-hidden');
            if (typeof modal.showModal === 'function') {
                if (!modal.open) modal.showModal();
                if (!modal.dataset.cancelBound) {
                    modal.addEventListener('cancel', event => { event.preventDefault(); this.closeChartSettings(); });
                    modal.dataset.cancelBound = 'true';
                }
            }
            document.body.style.overflow = 'hidden'; // Prevent background scroll
            const tabName = this.activeSettingsTab || 'appearance';
            this.showChartSettingsTab(tabName);
            const activeTab = document.getElementById('tab-' + tabName);
            if (activeTab) {
                this.chartSettingsFocusTimer = setTimeout(() => {
                    if (activeFocusSeq !== this.chartSettingsFocusSeq) return;
                    if (modal.classList.contains('hidden')) return;
                    activeTab.focus();
                    this.chartSettingsFocusTimer = null;
                }, 0);
            }
        }
    },

    // Close settings modal
    closeChartSettings: function () {
        const modal = document.getElementById('chart-settings-modal');
        if (modal && !modal.classList.contains('hidden')) {
            this.chartSettingsFocusSeq += 1;
            if (this.chartSettingsFocusTimer) {
                clearTimeout(this.chartSettingsFocusTimer);
                this.chartSettingsFocusTimer = null;
            }
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
            if (modal.open && typeof modal.close === 'function') modal.close();
            document.body.style.overflow = ''; // Restore scroll
            if (this.previouslyFocusedChartControl && typeof this.previouslyFocusedChartControl.focus === 'function') {
                this.previouslyFocusedChartControl.focus();
            }
        }
    },

    // Show settings tab
    showChartSettingsTab: function (tabName) {
        this.activeSettingsTab = tabName;
        const modal = document.getElementById('chart-settings-modal');
        const scopeRoot = modal || document;
        // Hide all content
        scopeRoot.querySelectorAll('.chart-settings-content').forEach(c => c.classList.add('hidden'));
        // Deactivate all tabs
        scopeRoot.querySelectorAll('.chart-settings-tab').forEach(t => {
            t.setAttribute('aria-selected', 'false');
            t.tabIndex = -1;
        });
        // Show selected content
        const content = document.getElementById('content-' + tabName);
        if (content) content.classList.remove('hidden');
        // Activate selected tab
        const tab = document.getElementById('tab-' + tabName);
        if (tab) {
            tab.setAttribute('aria-selected', 'true');
            tab.tabIndex = 0;
        }
        const scroll = modal?.querySelector('.chart-settings-scroll');
        if (scroll) scroll.scrollTop = 0;
    },

    syncThemePresetUI: function () {
        const activeTheme = String(this.chartSettings.chartTheme || '');
        const modal = document.getElementById('chart-settings-modal');
        const scopeRoot = modal || document;
        scopeRoot.querySelectorAll('.theme-preset').forEach(btn => {
            const isActive = btn.dataset.theme === activeTheme;
            if (isActive) {
                btn.classList.add('border-brand-oxford', 'dark:border-brand-teal');
                btn.classList.remove('border-brand-black-60/10');
            } else {
                btn.classList.remove('border-brand-oxford', 'dark:border-brand-teal');
                btn.classList.add('border-brand-black-60/10');
            }
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    },

    // Load settings from localStorage
    loadChartSettings: function () {
        if (window.BW && BW.Settings && typeof BW.Settings.getChartSettings === 'function') {
            try {
                const parsed = BW.Settings.getChartSettings();
                if (parsed && typeof parsed === 'object') {
                    this.chartSettings = { ...this.chartSettings, ...parsed };
                    if (parsed.responsiveHeight === undefined && parsed.chartHeight !== undefined && parsed.chartHeight !== 400) this.chartSettings.responsiveHeight = false;
                }
            } catch (e) {
                console.warn('Could not load chart settings from BW.Settings:', e);
            }
            this.populateSettingsUI();
            this.applySettingsToDOM();
            return;
        }

        try {
            const saved = localStorage.getItem('chart-settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Merge with defaults (in case new settings were added)
                this.chartSettings = { ...this.chartSettings, ...parsed };
                if (parsed.responsiveHeight === undefined && parsed.chartHeight !== undefined && parsed.chartHeight !== 400) this.chartSettings.responsiveHeight = false;
            }
        } catch (e) {
            console.warn('Could not load chart settings:', e);
        }
        this.populateSettingsUI();
        this.applySettingsToDOM();
    },

    // Populate UI controls with current settings
    populateSettingsUI: function () {
        const s = this.chartSettings;

        // Color pickers
        const colorFields = ['lineColor', 'fillColor', 'gridColor', 'upColor', 'downColor', 'tooltipBg', 'tooltipText'];
        colorFields.forEach(field => {
            const el = document.getElementById('setting-' + field);
            if (el) el.value = s[field];
        });

        // Range sliders with value displays
        const rangeFields = {
            lineWidth: 'lineWidth-value', tension: 'tension-value', pointRadius: 'pointRadius-value',
            fillOpacity: 'fillOpacity-value', gridOpacity: 'gridOpacity-value',
            yMaxTicks: 'yMaxTicks-value', xMaxTicks: 'xMaxTicks-value', axisFontSize: 'axisFontSize-value',
            tooltipRadius: 'tooltipRadius-value', tooltipPadding: 'tooltipPadding-value',
            animationDuration: 'animationDuration-value', chartHeight: 'chartHeight-value'
        };
        Object.entries(rangeFields).forEach(([field, valueId]) => {
            const el = document.getElementById('setting-' + field);
            const valueEl = document.getElementById(valueId);
            if (el) el.value = s[field];
            if (valueEl) valueEl.textContent = s[field];
        });

        // Checkboxes
        const checkboxFields = [
            'enableFill', 'showHGrid', 'showVGrid', 'showCrosshairDate', 'showCrosshairPrice',
            'showCrosshairChange', 'enableZoom', 'enablePan', 'enableAnimation',
            'showStatsBar', 'showStatHigh', 'showStatLow', 'showStatAvg', 'showStatRange',
            'showStatPoints', 'showResetBtn', 'showDownloadBtn'
        ];
        checkboxFields.forEach(field => {
            const el = document.getElementById('setting-' + field);
            if (el) el.checked = s[field];
        });

        // Select dropdowns
        const selectFields = ['yAxisPosition', 'zoomModifier'];
        selectFields.forEach(field => {
            const el = document.getElementById('setting-' + field);
            if (el) el.value = s[field];
        });

        this.syncThemePresetUI();
    },

    // Save settings to localStorage
    saveChartSettings: function () {
        if (window.BW && BW.Settings && typeof BW.Settings.saveChartSettings === 'function') {
            try {
                BW.Settings.saveChartSettings(this.chartSettings);
                return;
            } catch (e) {
                console.warn('Could not save chart settings to BW.Settings:', e);
            }
        }

        try {
            localStorage.setItem('chart-settings', JSON.stringify(this.chartSettings));
        } catch (e) {
            console.warn('Could not save chart settings:', e);
        }
    },

    // Update single setting and re-render
    updateChartSetting: function (key, value) {
        // Convert value type if needed
        if (typeof this.chartSettings[key] === 'number') {
            value = parseFloat(value);
        } else if (typeof this.chartSettings[key] === 'boolean') {
            // Future-proof: handle string 'false'/'true' from generic inputs
            value = value === true || value === 'true';
        }

        this.chartSettings[key] = value;
        if (key === 'chartHeight') this.chartSettings.responsiveHeight = false;
        this.saveChartSettings();
        this.applySettingsToDOM();
        this.updateChart(); // Real-time visual feedback!
    },

    // Apply a preset theme
    applyChartTheme: function (themeName) {
        const theme = this.themes[themeName];
        if (theme) {
            // Apply theme colors to settings
            Object.assign(this.chartSettings, theme);
            this.chartSettings.chartTheme = themeName;
            this.saveChartSettings();
            this.populateSettingsUI();
            this.applySettingsToDOM();
            this.updateChart();
        }
    },

    // Reset all settings to defaults
    resetChartSettings: function () {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        const preset = this.themes[theme] || this.themes.light;

        // Reset to default values using current theme preset
        this.chartSettings = {
            chartTheme: this.themes[theme] ? theme : 'light',
            lineColor: preset.lineColor, fillColor: preset.fillColor, fillOpacity: preset.fillOpacity,
            gridColor: preset.gridColor, gridOpacity: preset.gridOpacity, upColor: preset.upColor, downColor: preset.downColor,
            tooltipBg: preset.tooltipBg, tooltipText: preset.tooltipText,
            lineWidth: 2, pointRadius: 0, tension: 10, enableFill: true,
            showHGrid: true, showVGrid: false,
            yAxisPosition: 'right', yMaxTicks: 6, xMaxTicks: 8, axisFontSize: 11,
            tooltipRadius: 8, tooltipPadding: 12,
            showCrosshairDate: true, showCrosshairPrice: true, showCrosshairChange: true,
            enableZoom: true, enablePan: true, zoomModifier: 'ctrl',
            enableAnimation: true, animationDuration: 300, chartHeight: 400, responsiveHeight: true,
            showStatsBar: true, showStatHigh: true, showStatLow: true, showStatAvg: true,
            showStatRange: true, showStatPoints: true, showResetBtn: true, showDownloadBtn: true
        };

        this.saveChartSettings();
        this.populateSettingsUI();
        this.applySettingsToDOM();
        this.updateChart();
    },

    getChartHeight: function () {
        const settings = this.chartSettings;
        return settings.responsiveHeight !== false && window.innerWidth <= 640 ? Math.min(settings.chartHeight, 300) : settings.chartHeight;
    },

    // Apply visibility and DOM-based settings
    applySettingsToDOM: function () {
        const s = this.chartSettings;

        // Stats bar visibility
        const statsBar = document.getElementById('stats-bar');
        if (statsBar) statsBar.style.display = s.showStatsBar ? '' : 'none';

        // Individual stats
        const statElements = {
            'stat-high': s.showStatHigh,
            'stat-low': s.showStatLow,
            'stat-avg': s.showStatAvg,
            'stat-range': s.showStatRange,
            'stat-points': s.showStatPoints
        };
        Object.entries(statElements).forEach(([id, show]) => {
            const el = document.getElementById(id);
            if (el && el.parentElement) {
                el.parentElement.style.display = show ? '' : 'none';
            }
        });

        // Action buttons
        const resetBtn = document.getElementById('reset-zoom-btn');
        const downloadContainer = document.getElementById('download-menu-container');
        if (resetBtn) resetBtn.style.display = s.showResetBtn ? '' : 'none';
        if (downloadContainer) downloadContainer.style.display = s.showDownloadBtn ? '' : 'none';
        if (!s.showDownloadBtn) this.closeDownloadMenu();

        // Chart height - prefer canvas parent over brittle class selector
        const chartContainer = document.getElementById('priceChart') ? document.getElementById('priceChart').parentElement : null;
        if (chartContainer) chartContainer.style.height = this.getChartHeight() + 'px';

        // High/Low are extremes of one series, not gains/losses — up/down colors
        // would misuse direction semantics, so they stay neutral ink (UI rules:
        // hierarchy via weight, color reserved for direction).

        // Crosshair info fields
        const crosshairFields = {
            'crosshair-date': s.showCrosshairDate,
            'crosshair-price': s.showCrosshairPrice,
            'crosshair-change': s.showCrosshairChange
        };
        Object.entries(crosshairFields).forEach(([id, show]) => {
            const el = document.getElementById(id);
            if (el && el.parentElement) {
                el.parentElement.style.display = show ? '' : 'none';
            }
        });

        // Hide entire crosshair panel when all fields are off.
        const crosshairInfo = document.getElementById('crosshair-info');
        const showAnyCrosshairField = s.showCrosshairDate || s.showCrosshairPrice || s.showCrosshairChange;
        if (crosshairInfo) {
            if (!showAnyCrosshairField) {
                crosshairInfo.classList.add('hidden');
            } else {
                crosshairInfo.classList.remove('hidden');
            }
        }
    },

    // ============================================================
    // COMMODITY COMPARISON FUNCTIONS
    // ============================================================

    toggleCompareMenu: function () {
        var menu = document.getElementById('compare-menu');
        var btn = document.getElementById('compare-menu-btn');
        if (!menu) return;
        var isOpen = !menu.classList.contains('hidden');
        if (isOpen) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        } else {
            this.closeDownloadMenu();
            menu.classList.remove('hidden');
            menu.setAttribute('aria-hidden', 'false');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            var search = document.getElementById('compare-search');
            if (search) { search.value = ''; search.focus(); }
            this.loadCompareList();
        }
    },

    closeCompareMenu: function () {
        var menu = document.getElementById('compare-menu');
        var btn = document.getElementById('compare-menu-btn');
        this.compareListRequestSeq += 1;
        this.compareListLoading = false;
        if (this.compareListRequest) {
            this.compareListRequest.abort();
            this.compareListRequest = null;
        }
        if (menu) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
        }
        if (btn) btn.setAttribute('aria-expanded', 'false');
    },

    loadCompareList: function () {
        var self = this;
        if (this.allCommoditiesList.length > 0) {
            var cachedQuery = document.getElementById('compare-search')?.value || '';
            this.renderCompareList(cachedQuery);
            return;
        }
        if (this.compareListLoading) {
            return;
        }

        this.compareListLoading = true;
        this.compareListRequestSeq += 1;
        var activeRequestSeq = this.compareListRequestSeq;
        if (this.compareListRequest) {
            this.compareListRequest.abort();
        }
        this.compareListRequest = new AbortController();

        var apiUrl = BW.Utils.buildCommoditiesApiUrl({
            range: 'ALL',
            includeHistory: false,
        });

        fetch(apiUrl, { signal: this.compareListRequest.signal })
            .then(function (r) { return r.json(); })
            .then(function (json) {
                if (activeRequestSeq !== self.compareListRequestSeq) return;
                var data = BW.Utils.getCommoditiesFromApiResponse(json);
                self.allCommoditiesList = (Array.isArray(data) ? data : [])
                    .filter(function (c) { return c.id !== self.commodityId; })
                    .map(function (c) { return { id: c.id, name: c.name, category: c.category }; });
                var liveQuery = document.getElementById('compare-search')?.value || '';
                self.renderCompareList(liveQuery);
            })
            .catch(function (err) {
                if (activeRequestSeq !== self.compareListRequestSeq) return;
                if (err && err.name === 'AbortError') return;
                self.allCommoditiesList = [];
            })
            .finally(function () {
                if (activeRequestSeq !== self.compareListRequestSeq) return;
                self.compareListLoading = false;
                self.compareListRequest = null;
            });
    },

    renderCompareList: function (query) {
        var listEl = document.getElementById('compare-list');
        if (!listEl) return;
        var self = this;
        var q = (query || '').toLowerCase();
        var items = this.allCommoditiesList.filter(function (c) {
            return !q || c.name.toLowerCase().indexOf(q) !== -1 || c.category.toLowerCase().indexOf(q) !== -1;
        });
        listEl.innerHTML = '';
        if (items.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'px-4 py-3 text-xs text-brand-black-60';
            empty.textContent = 'No commodities found';
            listEl.appendChild(empty);
            return;
        }
        for (var i = 0; i < items.length; i++) {
            var c = items[i];
            var isAdded = !!this.comparisonData[c.id];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'w-full text-left px-4 py-2 text-xs font-medium transition-colors flex items-center justify-between gap-2 ' +
                (isAdded
                    ? 'text-brand-oxford dark:text-brand-teal bg-brand-oxford/5 dark:bg-brand-teal/5'
                    : 'text-brand-black-80 dark:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5');

            (function (id, name) {
                button.addEventListener('click', function () {
                    self.toggleComparison(id, name);
                });
            })(c.id, c.name);

            var nameSpan = document.createElement('span');
            nameSpan.className = 'truncate';
            nameSpan.textContent = c.name;

            var categorySpan = document.createElement('span');
            categorySpan.className = 'text-2xs uppercase tracking-wider text-brand-black-60 shrink-0';
            categorySpan.textContent = c.category;

            button.appendChild(nameSpan);
            button.appendChild(categorySpan);
            listEl.appendChild(button);
        }
    },

    toggleComparison: function (id, name) {
        if (this.comparisonData[id] || this.comparisonPendingSeq[id]) {
            this.removeComparison(id);
        } else {
            this.addComparison(id, name);
        }
    },

    addComparison: function (id, name) {
        if (this.comparisonData[id]) return;
        var self = this;
        var color = this.compareColors[this.compareColorIndex % this.compareColors.length];
        this.compareColorIndex++;
        this.comparisonRequestSeq += 1;
        var requestSeq = this.comparisonRequestSeq;
        this.comparisonPendingSeq[id] = requestSeq;

        fetch('/api/commodity/' + encodeURIComponent(id))
            .then(function (r) { return r.json(); })
            .then(function (json) {
                if (self.comparisonPendingSeq[id] !== requestSeq) return;
                delete self.comparisonPendingSeq[id];
                var data = json.data || json;
                self.comparisonData[id] = {
                    name: name,
                    history: data.history || [],
                    currency: data.currency, unit: data.unit, is_daily: data.is_daily,
                    color: color
                };
                self.updateChart();
                self.updateCompareBar();
                self.renderCompareList(document.getElementById('compare-search')?.value || '');
            })
            .catch(function (err) {
                if (self.comparisonPendingSeq[id] !== requestSeq) return;
                delete self.comparisonPendingSeq[id];
                console.error('Failed to fetch comparison data for ' + id, err);
            });
    },

    removeComparison: function (id) {
        delete this.comparisonPendingSeq[id];
        delete this.comparisonData[id];
        this.updateChart();
        this.updateCompareBar();
        this.renderCompareList(document.getElementById('compare-search')?.value || '');
    },

    updateCompareBar: function () {
        var bar = document.getElementById('compare-bar');
        var tags = document.getElementById('compare-tags');
        if (!bar || !tags) return;

        var ids = Object.keys(this.comparisonData);
        if (ids.length === 0) {
            bar.classList.add('hidden');
            return;
        }
        bar.classList.remove('hidden');
        tags.innerHTML = '';
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            var comp = this.comparisonData[id];
            var pill = document.createElement('span');
            pill.className = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-semibold text-white shrink-0 whitespace-nowrap';
            pill.style.backgroundColor = comp.color;

            var name = document.createElement('span');
            name.textContent = comp.name;

            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'ml-0.5 p-1 min-w-[24px] min-h-[24px] flex items-center justify-center hover:opacity-70 rounded';
            removeBtn.textContent = '\u00D7';
            (function (compareId) {
                removeBtn.addEventListener('click', function () {
                    BW.Commodity.removeComparison(compareId);
                });
            })(id);

            pill.appendChild(name);
            pill.appendChild(removeBtn);
            tags.appendChild(pill);
        }
    }
};

// Global function aliases for onclick handlers
function setTimeRange(r) { BW.Commodity.setTimeRange(r); }
function setChartType(t) { BW.Commodity.setChartType(t); }
function setViewMode(m) { BW.Commodity.setViewMode(m); }
function resetZoom() { BW.Commodity.resetZoom(); }
function downloadChart() { BW.Commodity.downloadChart(); }
function toggleDownloadMenu() { BW.Commodity.toggleDownloadMenu(); }
function exportDownload(f) { BW.Commodity.exportDownload(f); }

// Comparison functions
function toggleCompareMenu() { BW.Commodity.toggleCompareMenu(); }
function filterCompareList(q) { BW.Commodity.renderCompareList(q); }
function toggleCompare(id, name) { BW.Commodity.toggleComparison(id, name); }
function removeComparison(id) { BW.Commodity.removeComparison(id); }

if (!window.__bwCommodityGlobalHandlersBound) {
    window.__bwCommodityGlobalHandlersBound = true;

    // Close download/compare menus on outside click
    document.addEventListener('click', function (e) {
        var container = document.getElementById('download-menu-container');
        if (container && !container.contains(e.target)) {
            BW.Commodity.closeDownloadMenu();
        }
        var compareContainer = document.getElementById('compare-menu-container');
        if (compareContainer && !compareContainer.contains(e.target)) {
            BW.Commodity.closeCompareMenu();
        }
    });
}

// Chart settings modal functions
function openChartSettings() { BW.Commodity.openChartSettings(); }
function closeChartSettings() { BW.Commodity.closeChartSettings(); }
function showChartSettingsTab(t) { BW.Commodity.showChartSettingsTab(t); }
function updateChartSetting(k, v) { BW.Commodity.updateChartSetting(k, v); }
function applyChartTheme(t) { BW.Commodity.applyChartTheme(t); }
function resetChartSettings() { BW.Commodity.resetChartSettings(); }

// Keyboard shortcuts for chart settings
if (!window.__bwCommodityGlobalKeydownBound) {
    window.__bwCommodityGlobalKeydownBound = true;
    document.addEventListener('keydown', function (e) {
        const tab = e.target.closest?.('#chart-settings-modal [role="tab"]');
        if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            const tabs = Array.from(tab.parentElement.querySelectorAll('[role="tab"]'));
            const index = tabs.indexOf(tab);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 :
                (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            e.preventDefault();
            BW.Commodity.showChartSettingsTab(tabs[next].id.replace('tab-', ''));
            tabs[next].focus();
            return;
        }
        // S key opens settings (when not in input)
        if (e.key === 's' && !e.ctrlKey && !e.metaKey &&
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
            e.preventDefault();
            BW.Commodity.openChartSettings();
        }
        // Escape closes settings
        if (e.key === 'Escape') {
            BW.Commodity.closeDownloadMenu();
            BW.Commodity.closeCompareMenu();
            BW.Commodity.closeChartSettings();
        }
    });
}

// Change period picker for commodity detail page header badge
function setChangePeriod(period) {
    const section = document.getElementById('change-badge-section');
    if (!section) return;

    const pctMap = {
        '1':   parseFloat(section.dataset.pct1),
        '30':  parseFloat(section.dataset.pct30),
        '365': parseFloat(section.dataset.pct365),
    };
    const abs1      = parseFloat(section.dataset.abs1);
    const currency  = section.dataset.currency || '';
    const date      = section.dataset.date || '';
    const prevPrice = section.dataset.prevPrice || '';
    const prevDate  = section.dataset.prevDate || '';
    const prevLabel = section.dataset.prevLabel || 'vs prev obs';

    const pct  = pctMap[period];
    const available = Number.isFinite(pct);
    const isUp = pct >= 0;
    const cs   = getComputedStyle(document.documentElement);
    const color = cs.getPropertyValue(available ? (isUp ? '--color-up' : '--color-down') : '--theme-text-muted').trim();
    const bg    = cs.getPropertyValue(available ? (isUp ? '--color-up-bg' : '--color-down-bg') : '--theme-bg').trim();
    const sign  = isUp ? '+' : '';
    const arrow = available ? (isUp ? '▲' : '▼') : '—';
    const pctText = available ? `${sign}${pct.toFixed(2)}%` : 'Unavailable';

    // Update badge
    const badgeBg = document.getElementById('change-badge-bg');
    const pctDisplay   = document.getElementById('change-pct-display');
    const arrowDisplay = document.getElementById('change-arrow-display');
    if (badgeBg)      badgeBg.style.backgroundColor = bg;
    if (pctDisplay)   { pctDisplay.style.color = color; pctDisplay.textContent = pctText; }
    if (arrowDisplay) { arrowDisplay.style.color = color; arrowDisplay.textContent = arrow; }

    // Update tooltip-change-line color too
    const changeLine = document.getElementById('tooltip-change-line');
    if (changeLine) changeLine.style.color = color;

    // Update context label
    const labelMap = {
        '1':   `${prevLabel} · As of ${date}`,
        '30':  `vs ~30 obs · As of ${date}`,
        '365': `vs ~1 year · As of ${date}`,
    };
    const label = document.getElementById('change-period-label');
    if (label) label.textContent = labelMap[period] || '';

    // Update tooltip content
    const tooltipTitle   = document.getElementById('change-tooltip-title');
    const tooltipPrevRow = document.getElementById('tooltip-prev-row');
    const tooltipPrevLbl = document.getElementById('tooltip-prev-label');
    const tooltipPrevPrc = document.getElementById('tooltip-prev-price');
    const titleMap = { '1': 'Price Change (Prev obs)', '30': 'Price Change (~30 obs)', '365': 'Price Change (~1 year)' };
    if (tooltipTitle) tooltipTitle.textContent = titleMap[period] || 'Price Change';

    if (period === '1') {
        if (tooltipPrevRow) tooltipPrevRow.style.display = '';
        if (tooltipPrevLbl) tooltipPrevLbl.textContent = `Previous (${prevDate}):`;
        if (tooltipPrevPrc) tooltipPrevPrc.textContent = prevPrice ? `${prevPrice} ${currency}` : 'Unavailable';
        if (changeLine) changeLine.textContent = available && Number.isFinite(abs1)
            ? `${abs1 >= 0 ? '+' : ''}${abs1} ${currency} (${pctText})` : 'Change unavailable';
    } else {
        if (tooltipPrevRow) tooltipPrevRow.style.display = 'none';
        if (changeLine) changeLine.textContent = pctText;
    }

    // Update button active states
    ['1', '30', '365'].forEach(p => {
        const btn = document.getElementById(`period-btn-${p}`);
        if (!btn) return;
        const isActive = p === period;
        btn.className = isActive
            ? 'period-btn px-2.5 py-1 text-2xs font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-oxford dark:focus:ring-brand-teal theme-surface theme-text'
            : 'period-btn px-2.5 py-1 text-2xs font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-brand-oxford dark:focus:ring-brand-teal text-brand-black-60 hover:bg-brand-black-60/5 dark:hover:bg-white/5';
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // Persist selection
    try { localStorage.setItem('bw-change-period', period); } catch (e) {}
}

// Restore persisted period selection on page load
(function () {
    const saved = (function () { try { return localStorage.getItem('bw-change-period'); } catch (e) { return null; } })();
    if (saved && saved !== '1') {
        const run = function () { setChangePeriod(saved); };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }
})();

// Copy price to clipboard with visual feedback
function copyPrice(price) {
    const commodity = (window.BW && BW.Commodity) ? BW.Commodity : null;
    let activeFeedbackSeq = 0;
    if (commodity) {
        commodity.copyFeedbackSeq += 1;
        activeFeedbackSeq = commodity.copyFeedbackSeq;
        if (commodity.copyFeedbackTimer) {
            clearTimeout(commodity.copyFeedbackTimer);
            commodity.copyFeedbackTimer = null;
        }
    }

    navigator.clipboard.writeText(price).then(() => {
        const copyIcon = document.getElementById('copy-icon');
        const checkIcon = document.getElementById('check-icon');
        if (copyIcon && checkIcon) {
            copyIcon.classList.add('hidden');
            checkIcon.classList.remove('hidden');

            const resetFeedback = () => {
                if (commodity && activeFeedbackSeq !== commodity.copyFeedbackSeq) return;
                copyIcon.classList.remove('hidden');
                checkIcon.classList.add('hidden');
                if (commodity) commodity.copyFeedbackTimer = null;
            };

            if (commodity) {
                commodity.copyFeedbackTimer = setTimeout(resetFeedback, 1500);
            } else {
                setTimeout(resetFeedback, 1500);
            }
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
    });
}
