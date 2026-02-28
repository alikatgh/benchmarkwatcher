/**
 * BenchmarkWatcher - Commodity Detail Component
 * Handles the commodity detail page with interactive Chart.js chart
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
    ctx: null,
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
        const a = Math.round(Math.max(0, Math.min(100, alphaPercent)) * 2.55);
        const ahex = a.toString(16).padStart(2, '0');
        return `#${h}${ahex}`;
    },

    // Preset themes for chart customization
    themes: {
        light: {
            lineColor: '#0f5499', fillColor: '#0f5499', fillOpacity: 15,
            gridColor: '#33302e', gridOpacity: 10, tooltipBg: '#f7f4f0', tooltipText: '#33302e',
            upColor: '#0d7680', downColor: '#990f3d'
        },
        dark: {
            lineColor: '#1aecff', fillColor: '#1aecff', fillOpacity: 15,
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
        this.fullHistoryData = historyData;
        this.currency = currency || 'USD';
        this.commodityName = commodityName || 'commodity';
        this.commodityId = commodityId || '';

        const canvas = document.getElementById('priceChart');
        if (!canvas) return;
        this.ctx = canvas.getContext('2d');

        // Load saved chart settings from localStorage
        this.loadChartSettings();

        // Set up colors based on theme (will be overridden by chartSettings)
        this.setupColors();

        // Initial render
        this.updateChart();
        this.updateRangeButtons();
        this.updateTypeButtons();

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

    // Filter data by time range
    filterDataByRange: function (data, range) {
        if (range === 'ALL' || !data || data.length === 0) return data;

        // Use the LATEST data point date as reference, not current date
        // This handles datasets that aren't up-to-date
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

        if (statHigh) statHigh.textContent = high.toLocaleString() + ' ' + this.currency;
        if (statLow) statLow.textContent = low.toLocaleString() + ' ' + this.currency;
        if (statAvg) statAvg.textContent = avg.toFixed(2) + ' ' + this.currency;
        if (statRange) statRange.textContent = range.toFixed(2) + ' ' + this.currency;
        if (statPoints) statPoints.textContent = data.length;

        if (dateRangeDisplay && data.length > 0) {
            const startDate = new Date(data[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const endDate = new Date(data[data.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            dateRangeDisplay.textContent = `${startDate} — ${endDate}`;
        }
    },

    // Update chart
    updateChart: function () {
        const self = this;
        const filteredData = this.filterDataByRange(this.fullHistoryData, this.currentRange);
        var labels = filteredData.map(item => item.date);
        var prices = filteredData.map(item => item.price);

        // Calculate percentage change from first data point
        var basePrice = prices.length > 0 ? prices[0] : 1;
        var percentages = prices.map(p => ((p - basePrice) / basePrice) * 100);
        var chartData = this.currentViewMode === 'percent' ? percentages : prices;
        const dataLabel = this.currentViewMode === 'percent' ? 'Change %' : 'Price';

        this.calculateStats(filteredData);

        // Pre-compute alpha colors using helper
        const fillHexAlpha = this.hexWithAlpha(this.chartSettings.fillColor, this.chartSettings.fillOpacity);
        const gridHexAlpha = this.hexWithAlpha(this.chartSettings.gridColor, this.chartSettings.gridOpacity);

        // Build comparison datasets with unified timeline
        // Handles mixed-frequency data (daily vs monthly) using LOCF interpolation
        var compDatasets = [];
        var compIds = Object.keys(this.comparisonData);

        // If comparisons exist, build a unified date axis from all datasets
        if (compIds.length > 0) {
            // Collect all unique dates from main + comparison datasets
            var allDatesSet = {};
            for (var li = 0; li < labels.length; li++) {
                allDatesSet[labels[li]] = true;
            }
            for (var ci = 0; ci < compIds.length; ci++) {
                var compHist = this.filterDataByRange(this.comparisonData[compIds[ci]].history, this.currentRange);
                for (var ch = 0; ch < compHist.length; ch++) {
                    allDatesSet[compHist[ch].date] = true;
                }
            }
            // Sort all dates chronologically to form unified timeline
            var unifiedDates = Object.keys(allDatesSet).sort();

            // Re-align main dataset to unified timeline using LOCF
            var mainDateMap = {};
            for (var mi = 0; mi < filteredData.length; mi++) {
                mainDateMap[filteredData[mi].date] = filteredData[mi].price;
            }
            var unifiedMainPrices = [];
            var lastMainPrice = null;
            for (var ui = 0; ui < unifiedDates.length; ui++) {
                if (mainDateMap[unifiedDates[ui]] !== undefined) {
                    lastMainPrice = mainDateMap[unifiedDates[ui]];
                }
                unifiedMainPrices.push(lastMainPrice);
            }

            // Override labels and chart data with unified versions
            labels = unifiedDates;
            prices = unifiedMainPrices;
            var newBasePrice = prices.length > 0 ? prices[0] : 1;
            if (this.currentViewMode === 'percent') {
                chartData = prices.map(function (p) { return p !== null ? ((p - newBasePrice) / newBasePrice) * 100 : null; });
            } else {
                chartData = prices;
            }
        }

        for (var ci = 0; ci < compIds.length; ci++) {
            var comp = this.comparisonData[compIds[ci]];
            var compFiltered = this.filterDataByRange(comp.history, this.currentRange);

            // Build date->price map for LOCF (Last Observation Carried Forward)
            var compDateMap = {};
            for (var cj = 0; cj < compFiltered.length; cj++) {
                compDateMap[compFiltered[cj].date] = compFiltered[cj].price;
            }

            // Align to unified timeline using LOCF interpolation
            // This handles daily-vs-monthly mismatches by carrying forward
            // the last known price until a new observation appears
            var compPrices = [];
            var lastKnown = null;
            var firstCompDate = compFiltered.length > 0 ? compFiltered[0].date : null;
            for (var ck = 0; ck < labels.length; ck++) {
                var dateKey = labels[ck];
                if (compDateMap[dateKey] !== undefined) {
                    lastKnown = compDateMap[dateKey];
                }
                // Only start carrying forward after the first actual data point
                // to avoid a flat line before data begins
                if (lastKnown !== null && firstCompDate && dateKey >= firstCompDate) {
                    compPrices.push(lastKnown);
                } else {
                    compPrices.push(null);
                }
            }

            // In percent mode, compute % change from first non-null value
            var compChartData;
            if (this.currentViewMode === 'percent') {
                var compBase = null;
                for (var cb = 0; cb < compPrices.length; cb++) {
                    if (compPrices[cb] !== null) { compBase = compPrices[cb]; break; }
                }
                compChartData = compPrices.map(function (p) {
                    return p !== null && compBase ? ((p - compBase) / compBase) * 100 : null;
                });
            } else {
                compChartData = compPrices;
            }

            compDatasets.push({
                label: comp.name,
                data: compChartData,
                borderColor: comp.color,
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                fill: false,
                tension: this.chartSettings.tension / 100,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: comp.color,
                pointHoverBorderColor: getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim() || '#fff',
                pointHoverBorderWidth: 2,
                borderDash: [4, 2],
                spanGaps: true,
                yAxisID: this.currentViewMode === 'percent' ? 'y' : 'y2',
            });
        }

        var useSecondYAxis = this.currentViewMode !== 'percent' && compDatasets.length > 0;

        const chartConfig = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: dataLabel,
                    data: chartData,
                    borderColor: this.chartSettings.lineColor,
                    backgroundColor: (this.currentChartType === 'area' && this.chartSettings.enableFill)
                        ? (fillHexAlpha || this.chartSettings.fillColor)
                        : 'transparent',
                    borderWidth: this.chartSettings.lineWidth,
                    fill: this.currentChartType === 'area' && this.chartSettings.enableFill,
                    tension: this.chartSettings.tension / 100,
                    pointRadius: this.chartSettings.pointRadius,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: this.chartSettings.lineColor,
                    pointHoverBorderColor: getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim() || '#fff',
                    pointHoverBorderWidth: 2,
                }].concat(compDatasets)
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: this.chartSettings.enableAnimation ? this.chartSettings.animationDuration : 0
                },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: compDatasets.length > 0, position: 'top', labels: { boxWidth: 12, font: { size: 11, family: 'Inter' }, usePointStyle: true, pointStyle: 'line' } },
                    tooltip: {
                        enabled: true,
                        backgroundColor: this.chartSettings.tooltipBg,
                        titleColor: this.chartSettings.tooltipText,
                        bodyColor: this.chartSettings.tooltipText,
                        borderColor: this.chartSettings.lineColor,
                        borderWidth: 1,
                        titleFont: { size: 11, weight: 'bold', family: 'Inter' },
                        bodyFont: { size: 13, weight: '600', family: 'Inter' },
                        padding: this.chartSettings.tooltipPadding,
                        cornerRadius: this.chartSettings.tooltipRadius,
                        displayColors: compDatasets.length > 0,
                        callbacks: {
                            title: function (context) {
                                const date = new Date(context[0].label);
                                return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                            },
                            label: function (context) {
                                const val = context.parsed.y;
                                if (val === null || val === undefined) return null; // skip null values in tooltip
                                var prefix = compDatasets.length > 0 ? (context.dataset.label + ': ') : '';
                                if (self.currentViewMode === 'percent') {
                                    return prefix + val.toFixed(2) + ' %';
                                } else {
                                    return prefix + val.toLocaleString() + ' ' + self.currency;
                                }
                            },
                            afterLabel: function (context) {
                                if (context.dataIndex > 0) {
                                    const prev = context.dataset.data[context.dataIndex - 1];
                                    const curr = context.parsed.y;
                                    // When in percent view, prev and curr are already percentage points.
                                    if (self.currentViewMode === 'percent') {
                                        const change = curr - prev;
                                        const sign = change >= 0 ? '+' : '';
                                        return `${sign}${change.toFixed(2)} %`;
                                    } else {
                                        const change = curr - prev;
                                        const changePercent = prev !== 0 ? ((change / prev) * 100).toFixed(2) : 'N/A';
                                        const sign = change >= 0 ? '+' : '';
                                        return `${sign}${change.toFixed(2)} (${sign}${changePercent}%)`;
                                    }
                                }
                                return '';
                            }
                        }
                    },
                    zoom: {
                        pan: { enabled: this.chartSettings.enablePan, mode: 'x' },
                        zoom: {
                            wheel: {
                                enabled: this.chartSettings.enableZoom,
                                modifierKey: this.chartSettings.zoomModifier === 'none' ? undefined : this.chartSettings.zoomModifier
                            },
                            pinch: { enabled: this.chartSettings.enableZoom },
                            mode: 'x'
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: this.chartSettings.showVGrid, color: (gridHexAlpha || this.chartSettings.gridColor) },
                        ticks: {
                            maxTicksLimit: this.chartSettings.xMaxTicks,
                            font: { size: this.chartSettings.axisFontSize, weight: '600', family: 'Inter' },
                            color: this.chartColors?.text || getComputedStyle(document.documentElement).getPropertyValue('--theme-text-muted').trim() || '#666',
                            callback: function (value) {
                                const date = new Date(this.getLabelForValue(value));
                                if (self.currentRange === '1W' || self.currentRange === '1M') {
                                    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                }
                                return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
                            }
                        }
                    },
                    y: {
                        position: this.chartSettings.yAxisPosition,
                        grid: {
                            display: this.chartSettings.showHGrid,
                            color: (gridHexAlpha || this.chartSettings.gridColor),
                            drawTicks: false,
                            lineWidth: 1
                        },
                        border: { display: false },
                        ticks: {
                            font: { size: this.chartSettings.axisFontSize, weight: '600', family: 'Inter' },
                            color: this.chartColors?.text || getComputedStyle(document.documentElement).getPropertyValue('--theme-text-muted').trim() || '#666',
                            padding: 10,
                            maxTicksLimit: this.chartSettings.yMaxTicks,
                            callback: function (value) { return value.toLocaleString(); }
                        }
                    },
                    y2: {
                        display: useSecondYAxis,
                        position: this.chartSettings.yAxisPosition === 'right' ? 'left' : 'right',
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            font: { size: this.chartSettings.axisFontSize - 1, weight: '600', family: 'Inter' },
                            color: this.chartColors?.text || getComputedStyle(document.documentElement).getPropertyValue('--theme-text-muted').trim() || '#666',
                            padding: 10,
                            maxTicksLimit: this.chartSettings.yMaxTicks,
                            callback: function (value) { return value.toLocaleString(); }
                        }
                    }
                },
                onHover: function (event, elements) {
                    if (!elements || elements.length === 0) return;
                    const el = elements[0];
                    const dataIndex = el.index;
                    const dataset = this.data.datasets[el.datasetIndex];
                    const price = dataset.data[dataIndex];
                    const date = this.data.labels[dataIndex];

                    if (price === null || price === undefined) return;

                    const infoEl = document.getElementById('crosshair-info');
                    const dateEl = document.getElementById('crosshair-date');
                    const priceEl = document.getElementById('crosshair-price');
                    const changeEl = document.getElementById('crosshair-change');

                    const showAnyCrosshairField =
                        self.chartSettings.showCrosshairDate ||
                        self.chartSettings.showCrosshairPrice ||
                        self.chartSettings.showCrosshairChange;

                    if (!showAnyCrosshairField) return;

                    if (infoEl) infoEl.classList.remove('hidden');
                    if (dateEl) dateEl.textContent = new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

                    if (priceEl) {
                        if (self.currentViewMode === 'percent') {
                            priceEl.textContent = price.toFixed(2) + ' %';
                        } else {
                            priceEl.textContent = price.toLocaleString() + ' ' + self.currency;
                        }
                    }

                    if (dataIndex > 0 && changeEl) {
                        const prev = dataset.data[dataIndex - 1];
                        if (self.currentViewMode === 'percent') {
                            const change = price - prev;
                            const sign = change >= 0 ? '+' : '';
                            changeEl.textContent = `${sign}${change.toFixed(2)} %`;
                            changeEl.className = 'text-sm font-bold ml-2';
                            changeEl.style.color = change >= 0 ? self.chartSettings.upColor : self.chartSettings.downColor;
                        } else {
                            const change = price - prev;
                            const changePercent = prev !== 0 ? ((change / prev) * 100).toFixed(2) : 'N/A';
                            const sign = change >= 0 ? '+' : '';
                            changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${changePercent}%)`;
                            changeEl.className = 'text-sm font-bold ml-2';
                            changeEl.style.color = change >= 0 ? self.chartSettings.upColor : self.chartSettings.downColor;
                        }
                    }
                }
            }
        };

        if (this.priceChart) {
            this.priceChart.destroy();
        }

        this.priceChart = new Chart(this.ctx, chartConfig);
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
        const activeClasses = 'shadow-sm theme-surface theme-text';
        const inactiveClasses = 'text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5';
        const chartViewButtons = [
            { id: 'view-price', mode: 'price' },
            { id: 'view-percent', mode: 'percent' }
        ];

        chartViewButtons.forEach(({ id, mode }) => {
            const btn = document.getElementById(id);
            if (!btn) return;

            btn.className = 'view-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5';
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

        this.exportImageTimer = setTimeout(function () {
            if (activeExportSeq !== this.exportImageSeq) return;
            if (!this.priceChart || typeof this.priceChart.toBase64Image !== 'function') return;
            var link = document.createElement('a');
            link.download = (this.commodityName || 'commodity') + '-price-chart.png';
            link.href = this.priceChart.toBase64Image();
            link.click();
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
        var run = function () {
            var pptx = new PptxGenJS();
            var slide = pptx.addSlide();
            slide.addText(self.commodityName || 'Commodity', {
                x: 0.5, y: 0.3, fontSize: 22, bold: true, color: '333333'
            });
            var imgData = self.priceChart.toBase64Image('image/png', 1);
            slide.addImage({ data: imgData, x: 0.3, y: 0.9, w: 9.2, h: 4.5 });
            pptx.writeFile({ fileName: (self.commodityName || 'commodity') + '-chart.pptx' });
        };
        if (window.PptxGenJS) { run(); return; }
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
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
        const self = this;
        ['1W', '1M', '3M', '6M', '1Y', 'ALL'].forEach(range => {
            const btn = document.getElementById(`range-${range}`);
            if (btn) {
                if (range === self.currentRange) {
                    btn.className = 'range-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg shadow-sm transition-all theme-surface theme-text';
                } else {
                    btn.className = 'range-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all';
                }
            }
        });
    },

    // Update type button states
    updateTypeButtons: function () {
        const self = this;
        ['line', 'area'].forEach(type => {
            const btn = document.getElementById(`type-${type}`);
            if (btn) {
                if (type === self.currentChartType) {
                    btn.className = 'type-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg shadow-sm transition-all theme-surface theme-text flex items-center gap-1.5';
                } else {
                    btn.className = 'type-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all flex items-center gap-1.5';
                }
            }
        });
    },

    // ============================================================
    // CHART SETTINGS FUNCTIONS
    // ============================================================

    // Open settings modal
    openChartSettings: function () {
        const modal = document.getElementById('chart-settings-modal');
        if (modal) {
            this.chartSettingsFocusSeq += 1;
            const activeFocusSeq = this.chartSettingsFocusSeq;
            if (this.chartSettingsFocusTimer) {
                clearTimeout(this.chartSettingsFocusTimer);
                this.chartSettingsFocusTimer = null;
            }
            this.previouslyFocusedChartControl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            modal.classList.remove('hidden');
            modal.removeAttribute('aria-hidden');
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
        if (modal) {
            this.chartSettingsFocusSeq += 1;
            if (this.chartSettingsFocusTimer) {
                clearTimeout(this.chartSettingsFocusTimer);
                this.chartSettingsFocusTimer = null;
            }
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
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
            t.className = 'chart-settings-tab flex-1 min-h-[44px] px-3 sm:px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white';
        });
        // Show selected content
        const content = document.getElementById('content-' + tabName);
        if (content) content.classList.remove('hidden');
        // Activate selected tab
        const tab = document.getElementById('tab-' + tabName);
        if (tab) {
            tab.className = 'chart-settings-tab flex-1 min-h-[44px] px-3 sm:px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all shadow-sm theme-surface theme-text';
        }
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
            enableAnimation: true, animationDuration: 300, chartHeight: 400,
            showStatsBar: true, showStatHigh: true, showStatLow: true, showStatAvg: true,
            showStatRange: true, showStatPoints: true, showResetBtn: true, showDownloadBtn: true
        };

        this.saveChartSettings();
        this.populateSettingsUI();
        this.applySettingsToDOM();
        this.updateChart();
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
        if (chartContainer) chartContainer.style.height = s.chartHeight + 'px';

        // Up/Down colors: apply locally to chart stats only (do not override global market theme)
        const statHigh = document.getElementById('stat-high');
        const statLow = document.getElementById('stat-low');
        if (statHigh) statHigh.style.color = s.upColor;
        if (statLow) statLow.style.color = s.downColor;

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
            categorySpan.className = 'text-[9px] uppercase tracking-wider text-brand-black-60 shrink-0';
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
            pill.className = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-white shrink-0 whitespace-nowrap';
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
