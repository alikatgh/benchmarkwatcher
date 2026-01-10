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

    // Chart customization settings with defaults
    chartSettings: {
        // Colors
        lineColor: '#0f5499',
        fillColor: '#0f5499',
        fillOpacity: 15,
        gridColor: '#33302e',
        gridOpacity: 10,
        upColor: '#00a878',
        downColor: '#c23b22',
        tooltipBg: '#ffffff',
        tooltipText: '#000000',

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

    // Preset themes
    themes: {
        light: {
            lineColor: '#0f5499', fillColor: '#0f5499', fillOpacity: 15,
            gridColor: '#33302e', gridOpacity: 10, tooltipBg: '#ffffff', tooltipText: '#000000',
            upColor: '#00a878', downColor: '#c23b22'
        },
        dark: {
            lineColor: '#1aecff', fillColor: '#1aecff', fillOpacity: 15,
            gridColor: '#ffffff', gridOpacity: 5, tooltipBg: '#1a1a1a', tooltipText: '#ffffff',
            upColor: '#00d68f', downColor: '#ff6b6b'
        },
        bloomberg: {
            lineColor: '#ff9933', fillColor: '#ff9933', fillOpacity: 20,
            gridColor: '#ff9933', gridOpacity: 10, tooltipBg: '#2d2d2d', tooltipText: '#ff9933',
            upColor: '#00ff00', downColor: '#ff0000'
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
    init: function (historyData, currency, commodityName) {
        this.fullHistoryData = historyData;
        this.currency = currency || 'USD';
        this.commodityName = commodityName || 'commodity';

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

    // Setup chart colors based on theme
    setupColors: function () {
        const isDark = document.documentElement.classList.contains('dark');
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        const isBloomberg = theme === 'bloomberg';

        this.chartColors = isBloomberg ? {
            price: '#ff9933',
            priceLight: 'rgba(255, 153, 51, 0.15)',
            grid: 'rgba(255, 153, 51, 0.1)',
            text: '#ff9933',
            tooltipBg: '#2d2d2d',
            tooltipText: '#ff9933',
            tooltipBorder: '#ff9933',
        } : {
            price: isDark ? '#1aecff' : '#0f5499',
            priceLight: isDark ? 'rgba(26, 236, 255, 0.1)' : 'rgba(15, 84, 153, 0.1)',
            grid: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(51, 48, 46, 0.1)',
            text: isDark ? '#999' : '#66605c',
            tooltipBg: isDark ? '#1a1a1a' : '#fff',
            tooltipText: isDark ? '#fff' : '#000',
            tooltipBorder: isDark ? '#333' : '#ddd',
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
        const labels = filteredData.map(item => item.date);
        const prices = filteredData.map(item => item.price);

        // Calculate percentage change from first data point
        const basePrice = prices.length > 0 ? prices[0] : 1;
        const percentages = prices.map(p => ((p - basePrice) / basePrice) * 100);
        const chartData = this.currentViewMode === 'percent' ? percentages : prices;
        const dataLabel = this.currentViewMode === 'percent' ? 'Change %' : 'Price';

        this.calculateStats(filteredData);

        // Pre-compute alpha colors using helper
        const fillHexAlpha = this.hexWithAlpha(this.chartSettings.fillColor, this.chartSettings.fillOpacity);
        const gridHexAlpha = this.hexWithAlpha(this.chartSettings.gridColor, this.chartSettings.gridOpacity);

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
                    pointHoverBorderColor: document.documentElement.classList.contains('dark') ? '#000' : '#fff',
                    pointHoverBorderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: this.chartSettings.enableAnimation ? this.chartSettings.animationDuration : 0
                },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
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
                        displayColors: false,
                        callbacks: {
                            title: function (context) {
                                const date = new Date(context[0].label);
                                return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                            },
                            label: function (context) {
                                const val = context.parsed.y;
                                if (self.currentViewMode === 'percent') {
                                    // show percent with 2 decimals
                                    return val.toFixed(2) + ' %';
                                } else {
                                    return val.toLocaleString() + ' ' + self.currency;
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
                            color: this.chartColors?.text || '#666',
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
                            color: this.chartColors?.text || '#666',
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

                    const infoEl = document.getElementById('crosshair-info');
                    const dateEl = document.getElementById('crosshair-date');
                    const priceEl = document.getElementById('crosshair-price');
                    const changeEl = document.getElementById('crosshair-change');

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
                            changeEl.className = `text-sm font-bold ml-2 ${change >= 0 ? 'text-brand-teal' : 'text-brand-claret'}`;
                        } else {
                            const change = price - prev;
                            const changePercent = prev !== 0 ? ((change / prev) * 100).toFixed(2) : 'N/A';
                            const sign = change >= 0 ? '+' : '';
                            changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${changePercent}%)`;
                            changeEl.className = `text-sm font-bold ml-2 ${change >= 0 ? 'text-brand-teal' : 'text-brand-claret'}`;
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
        const activeClasses = 'bg-white dark:bg-white shadow-sm text-brand-black-80 dark:text-terminal-black';
        const inactiveClasses = 'text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5';

        document.querySelectorAll('.view-btn').forEach(btn => {
            const mode = btn.id.replace('view-', '');
            // Reset classes first
            btn.className = 'view-btn px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5';
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

    // Download chart as image
    downloadChart: function () {
        if (!this.priceChart) {
            console.warn('No chart available to download.');
            return;
        }
        const btn = document.querySelector('[onclick="downloadChart()"]');
        const originalHTML = btn ? btn.innerHTML : null;
        if (btn) {
            btn.innerHTML = '<span class="animate-pulse">Saving...</span>';
            btn.disabled = true;
        }
        setTimeout(() => {
            try {
                const link = document.createElement('a');
                link.download = `${this.commodityName}-price-chart.png`;
                link.href = this.priceChart.toBase64Image();
                link.click();
            } finally {
                if (btn) {
                    btn.innerHTML = '✓ Saved';
                    setTimeout(() => {
                        btn.innerHTML = originalHTML;
                        btn.disabled = false;
                    }, 1500);
                }
            }
        }, 100);
    },

    // Update range button states
    updateRangeButtons: function () {
        const self = this;
        ['1W', '1M', '3M', '6M', '1Y', 'ALL'].forEach(range => {
            const btn = document.getElementById(`range-${range}`);
            if (btn) {
                if (range === self.currentRange) {
                    btn.className = 'range-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-white shadow-sm text-brand-black-80 dark:text-terminal-black transition-all';
                } else {
                    btn.className = 'range-btn px-3 py-1.5 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all';
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
                    btn.className = 'type-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-white shadow-sm text-brand-black-80 dark:text-terminal-black transition-all flex items-center gap-1.5';
                } else {
                    btn.className = 'type-btn px-3 py-1.5 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all flex items-center gap-1.5';
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
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden'; // Prevent background scroll
        }
    },

    // Close settings modal
    closeChartSettings: function () {
        const modal = document.getElementById('chart-settings-modal');
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = ''; // Restore scroll
        }
    },

    // Show settings tab
    showChartSettingsTab: function (tabName) {
        // Hide all content
        document.querySelectorAll('.chart-settings-content').forEach(c => c.classList.add('hidden'));
        // Deactivate all tabs
        document.querySelectorAll('.chart-settings-tab').forEach(t => {
            t.className = 'chart-settings-tab px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all text-brand-black-60 hover:text-brand-black-80';
        });
        // Show selected content
        const content = document.getElementById('content-' + tabName);
        if (content) content.classList.remove('hidden');
        // Activate selected tab
        const tab = document.getElementById('tab-' + tabName);
        if (tab) {
            tab.className = 'chart-settings-tab px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all bg-white dark:bg-white shadow-sm text-brand-black-80 dark:text-terminal-black';
        }
    },

    // Load settings from localStorage
    loadChartSettings: function () {
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
    },

    // Save settings to localStorage
    saveChartSettings: function () {
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
            this.saveChartSettings();
            this.populateSettingsUI();
            this.applySettingsToDOM();
            this.updateChart();

            // Highlight selected theme button
            document.querySelectorAll('.theme-preset').forEach(btn => {
                if (btn.dataset.theme === themeName) {
                    btn.classList.add('border-brand-oxford', 'dark:border-brand-teal');
                    btn.classList.remove('border-brand-black-60/10');
                } else {
                    btn.classList.remove('border-brand-oxford', 'dark:border-brand-teal');
                    btn.classList.add('border-brand-black-60/10');
                }
            });
        }
    },

    // Reset all settings to defaults
    resetChartSettings: function () {
        const isDark = document.documentElement.classList.contains('dark');
        const defaultTheme = isDark ? 'dark' : 'light';

        // Reset to default values
        this.chartSettings = {
            lineColor: '#0f5499', fillColor: '#0f5499', fillOpacity: 15,
            gridColor: '#33302e', gridOpacity: 10, upColor: '#00a878', downColor: '#c23b22',
            tooltipBg: '#ffffff', tooltipText: '#000000',
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

        // Apply theme if dark mode
        if (isDark) {
            Object.assign(this.chartSettings, this.themes.dark);
        }

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
        const resetBtn = document.querySelector('[onclick="resetZoom()"]');
        const downloadBtn = document.querySelector('[onclick="downloadChart()"]');
        if (resetBtn) resetBtn.style.display = s.showResetBtn ? '' : 'none';
        if (downloadBtn) downloadBtn.style.display = s.showDownloadBtn ? '' : 'none';

        // Chart height - prefer canvas parent over brittle class selector
        const chartContainer = document.getElementById('priceChart') ? document.getElementById('priceChart').parentElement : null;
        if (chartContainer) chartContainer.style.height = s.chartHeight + 'px';

        // Up/Down colors as CSS variables for stats
        document.documentElement.style.setProperty('--color-up', s.upColor);
        document.documentElement.style.setProperty('--color-down', s.downColor);

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
    }
};

// Global function aliases for onclick handlers
function setTimeRange(r) { BW.Commodity.setTimeRange(r); }
function setChartType(t) { BW.Commodity.setChartType(t); }
function setViewMode(m) { BW.Commodity.setViewMode(m); }
function resetZoom() { BW.Commodity.resetZoom(); }
function downloadChart() { BW.Commodity.downloadChart(); }

// Chart settings modal functions
function openChartSettings() { BW.Commodity.openChartSettings(); }
function closeChartSettings() { BW.Commodity.closeChartSettings(); }
function showChartSettingsTab(t) { BW.Commodity.showChartSettingsTab(t); }
function updateChartSetting(k, v) { BW.Commodity.updateChartSetting(k, v); }
function applyChartTheme(t) { BW.Commodity.applyChartTheme(t); }
function resetChartSettings() { BW.Commodity.resetChartSettings(); }

// Keyboard shortcuts for chart settings
document.addEventListener('keydown', function (e) {
    // S key opens settings (when not in input)
    if (e.key === 's' && !e.ctrlKey && !e.metaKey &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        BW.Commodity.openChartSettings();
    }
    // Escape closes settings
    if (e.key === 'Escape') {
        BW.Commodity.closeChartSettings();
    }
});

// Copy price to clipboard with visual feedback
function copyPrice(price) {
    navigator.clipboard.writeText(price).then(() => {
        const copyIcon = document.getElementById('copy-icon');
        const checkIcon = document.getElementById('check-icon');
        if (copyIcon && checkIcon) {
            copyIcon.classList.add('hidden');
            checkIcon.classList.remove('hidden');
            setTimeout(() => {
                copyIcon.classList.remove('hidden');
                checkIcon.classList.add('hidden');
            }, 1500);
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
    });
}
