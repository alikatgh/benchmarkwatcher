/**
 * BenchmarkWatcher - Compact Table Component
 * Handles table settings, sparkline charts, previews, and data management
 */

window.BW = window.BW || {};

BW.CompactTable = {
    // Internal state
    chartRegistry: {},
    currentRequest: null,  // AbortController for request cancellation
    defaultColumns: ['commodity', 'trend', 'price', 'chg', 'pct', 'updated'],
    defaultSettings: {
        dataRange: 'ALL',
        panelOpen: false,
        columns: { commodity: true, trend: true, price: true, chg: true, pct: true, updated: true },
        commodity: { display: 'full', icon: 'initials' },
        trend: { type: 'area', points: '30', showMA: false, showHighLow: false },
        price: { format: 'default', currency: 'below', precision: '2' },
        chg: { format: 'arrow', color: 'colored' },
        pct: { style: 'badge', decimals: '2' },
        updated: { format: 'iso', time: 'no' }
    },

    // Get merged settings
    getSettings: function () {
        const stored = JSON.parse(localStorage.getItem('table-settings') || '{}');
        return {
            ...this.defaultSettings,
            ...stored,
            columns: { ...this.defaultSettings.columns, ...(stored.columns || {}) }
        };
    },

    // Save settings to localStorage
    saveSettings: function (settings) {
        localStorage.setItem('table-settings', JSON.stringify(settings));
    },

    // Data Range Functions
    setDataRange: function (range) {
        const settings = this.getSettings();
        settings.dataRange = range;
        this.saveSettings(settings);

        this.updateRangeButtons(range);
        this.updateDateRangeDisplay(range);

        // Update URL without reload
        const url = new URL(window.location.href);
        url.searchParams.set('range', range);
        window.history.pushState({}, '', url.toString());

        // Show loading state
        const tableBody = document.getElementById('commodities-tbody');
        const loading = document.getElementById('table-loading');
        if (loading) loading.classList.remove('hidden');
        if (tableBody) {
            tableBody.style.opacity = '0.5';
            tableBody.style.pointerEvents = 'none';
        }

        // Cancel any pending request to prevent race conditions
        if (this.currentRequest) {
            this.currentRequest.abort();
        }
        this.currentRequest = new AbortController();

        // Preserve category filter from URL
        const urlParams = new URLSearchParams(window.location.search);
        const category = urlParams.get('category');
        let apiUrl = `/api/commodities?range=${range}`;
        if (category) apiUrl += `&category=${encodeURIComponent(category)}`;

        // Fetch data via AJAX and update table
        fetch(apiUrl, { signal: this.currentRequest.signal })
            .then(response => response.json())
            .then(response => {
                const commodities = response.data || response;  // Handle both formats
                this.updateTableData(commodities);
                if (loading) loading.classList.add('hidden');
                if (tableBody) {
                    tableBody.style.opacity = '1';
                    tableBody.style.pointerEvents = '';
                }
            })
            .catch(error => {
                console.error('Failed to fetch data:', error);
                if (loading) loading.classList.add('hidden');
                if (tableBody) {
                    tableBody.style.opacity = '1';
                    tableBody.style.pointerEvents = '';
                    tableBody.innerHTML = `
                        <tr>
                            <td colspan="6" class="py-8">
                                <div class="empty-state">
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                                    </svg>
                                    <p class="font-bold text-brand-claret">Failed to load data</p>
                                    <p class="text-sm text-brand-black-60">Please check your connection and try again</p>
                                    <button onclick="setDataRange('${range}')" 
                                        class="mt-4 px-4 py-2 text-sm font-bold text-white bg-brand-oxford dark:bg-brand-teal rounded-lg hover:opacity-90 transition-all focus:outline-none focus:ring-2 focus:ring-brand-oxford dark:focus:ring-brand-teal focus:ring-offset-2">
                                        Try Again
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }
            });
    },

    // Destroy all Chart.js instances
    destroyAllCharts: function () {
        Object.keys(this.chartRegistry).forEach(id => {
            if (this.chartRegistry[id]) {
                this.chartRegistry[id].destroy();
                delete this.chartRegistry[id];
            }
        });
    },

    // Rebuild table with new data
    updateTableData: function (commodities) {
        const tbody = document.querySelector('#data-table tbody');
        if (!tbody) return;

        this.destroyAllCharts();
        tbody.innerHTML = '';

        const settings = this.getSettings();
        const currentRange = settings.dataRange || 'ALL';
        const rangeLabels = {
            '1W': 'past week',
            '1M': 'past month',
            '3M': 'past 3 months',
            '6M': 'past 6 months',
            '1Y': 'past year',
            'ALL': 'all time'
        };
        const rangeLabel = rangeLabels[currentRange] || 'selected period';

        commodities.forEach(commodity => {
            // Use range-based change (first to last in selected range)
            const displayChange = commodity.change !== undefined ? commodity.change : 0;
            const displayChangePercent = commodity.change_percent !== undefined ? commodity.change_percent : 0;

            // Calculate first and last price from history for tooltip
            const history = commodity.history || [];
            const firstPrice = history.length > 0 ? history[0].price : commodity.price;
            const lastPrice = history.length > 0 ? history[history.length - 1].price : commodity.price;
            const firstDate = history.length > 0 ? history[0].date : '';
            const lastDate = history.length > 0 ? history[history.length - 1].date : commodity.date;

            const isUp = displayChange >= 0;
            const colorVar = isUp ? '--color-up' : '--color-down';
            const bgColorVar = isUp ? '--color-up-bg' : '--color-down-bg';
            const arrow = isUp ? '▲' : '▼';
            const sign = isUp ? '+' : '';

            // Determine if daily or monthly data
            const dailyCommodities = ['brent_oil', 'wti_oil', 'natural_gas', 'heating_oil', 'jet_fuel', 'propane', 'gold', 'silver', 'gasoline'];
            const isDaily = commodity.source_type === 'EIA' || dailyCommodities.includes(commodity.id);
            const freqBadge = isDaily ? 'D' : 'M';
            const freqTitle = isDaily ? 'Daily data' : 'Monthly data';
            const freqColor = isDaily ? 'bg-brand-teal/20 text-brand-teal' : 'bg-brand-oxford/20 text-brand-oxford dark:bg-brand-teal/20 dark:text-brand-teal';

            const row = document.createElement('tr');
            row.onclick = () => { window.location = `/commodity/${commodity.id}`; };
            row.className = 'hover:bg-brand-black-60/5 dark:hover:bg-white/5 cursor-pointer transition-all duration-200 group';

            row.innerHTML = `
                <td data-col="commodity" class="px-4 py-5">
                    <div class="flex items-center gap-3 commodity-cell">
                        <div class="commodity-icon w-10 h-10 rounded-xl bg-brand-black-60/5 dark:bg-white/5 flex items-center justify-center group-hover:bg-brand-oxford/10 dark:group-hover:bg-brand-teal/10 transition-colors">
                            <span class="text-[10px] font-bold text-brand-black-60 dark:text-brand-black-60">${commodity.id.slice(0, 2)}</span>
                        </div>
                        <div>
                            <div class="commodity-name text-sm font-bold text-brand-black-80 dark:text-white group-hover:text-brand-oxford dark:group-hover:text-brand-teal transition-colors">${commodity.name}</div>
                            <div class="flex items-center gap-1.5">
                                <span class="commodity-category text-[10px] text-brand-black-60 tracking-wide uppercase">${commodity.category.toUpperCase()}</span>
                                <span class="text-[8px] font-bold px-1 py-0.5 rounded ${freqColor} font-ui freq-badge" title="${freqTitle}">${freqBadge}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td data-col="trend" class="px-4 py-5">
                    <div class="h-10 w-28 bg-brand-black-60/5 dark:bg-white/5 rounded-lg p-1">
                        <canvas id="sparkline-${commodity.id}"></canvas>
                    </div>
                </td>
                <td data-col="price" class="px-4 py-5 text-right">
                    <div class="price-value text-sm font-bold text-brand-black-80 dark:text-white" data-raw="${commodity.price}">${commodity.price}</div>
                    <div class="price-currency text-[10px] text-brand-black-60">${commodity.currency}</div>
                </td>
                <td data-col="chg" class="px-4 py-5 text-right">
                    <div class="chg-cell relative group/chg">
                        <div class="inline-flex items-center gap-1 text-sm font-bold cursor-help" style="color: var(${colorVar});" data-value="${displayChange}">
                            <span class="chg-arrow text-[10px]">${arrow}</span>
                            <span class="chg-value">${sign}${displayChange}</span>
                        </div>
                        <!-- Tooltip -->
                        <div class="absolute bottom-full right-0 mb-2 w-48 p-2 bg-brand-black-80 dark:bg-terminal-black rounded-lg shadow-lg text-white text-[10px] opacity-0 invisible group-hover/chg:opacity-100 group-hover/chg:visible transition-all z-50 font-ui text-left">
                            <div class="font-bold mb-1">Price Change (${rangeLabel})</div>
                            <div class="space-y-0.5 text-brand-black-60">
                                <div>Start: <span class="text-white">${firstPrice} ${commodity.currency}</span></div>
                                <div>End: <span class="text-white">${lastPrice} ${commodity.currency}</span></div>
                                <div class="pt-1 border-t border-white/20">Δ <span class="font-bold" style="color: var(${colorVar});">${sign}${displayChange} ${commodity.currency}</span></div>
                            </div>
                        </div>
                    </div>
                </td>
                <td data-col="pct" class="px-4 py-5 text-right">
                    <div class="pct-cell relative group/pct">
                        <div class="inline-flex px-2 py-1 rounded-md text-sm font-bold cursor-help" style="color: var(${colorVar}); background-color: var(${bgColorVar});" data-value="${displayChangePercent}">
                            ${sign}${displayChangePercent}%
                        </div>
                        <!-- Tooltip -->
                        <div class="absolute bottom-full right-0 mb-2 w-48 p-2 bg-brand-black-80 dark:bg-terminal-black rounded-lg shadow-lg text-white text-[10px] opacity-0 invisible group-hover/pct:opacity-100 group-hover/pct:visible transition-all z-50 font-ui text-left">
                            <div class="font-bold mb-1">% Change (${rangeLabel})</div>
                            <div class="space-y-0.5 text-brand-black-60">
                                <div>${firstDate} → ${lastDate}</div>
                                <div>From: <span class="text-white">${firstPrice}</span> to <span class="text-white">${lastPrice}</span></div>
                                <div class="pt-1 border-t border-white/20">= <span class="font-bold" style="color: var(${colorVar});">${sign}${displayChangePercent}%</span></div>
                            </div>
                        </div>
                    </div>
                </td>
                <td data-col="updated" class="px-4 py-5 text-right">
                    <div class="updated-cell text-xs font-medium text-brand-black-60" data-date="${commodity.date}">${commodity.date}</div>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Re-apply settings
        Object.entries(settings.columns).forEach(([col, visible]) => {
            this.applyColumnVisibility(col, visible);
        });
        this.applyVisualSettings(settings);
        this.initSparklines(commodities);
    },

    // Initialize sparkline charts
    initSparklines: function (commodities) {
        const self = this;
        requestAnimationFrame(() => {
            const colors = BW.Theme ? BW.Theme.getSparklineColors() : {
                line: '#0f5499',
                gradientStart: 'rgba(15, 84, 153, 0.1)',
                gradientEnd: 'rgba(15, 84, 153, 0)',
                ma: '#990f3d',
                up: '#0d7680',
                down: '#990f3d'
            };

            const settings = self.getSettings();
            const pointsSetting = settings.trend?.points || '30';
            const useAllPoints = pointsSetting === 'all';
            const pointsCount = useAllPoints ? Infinity : parseInt(pointsSetting);
            const chartType = settings.trend?.type || 'area';
            const showMA = document.getElementById('trend-ma')?.checked || settings.trend?.showMA || false;
            const showHighLow = document.getElementById('trend-highlow')?.checked || settings.trend?.showHighLow || false;

            commodities.forEach(commodity => {
                const canvasId = `sparkline-${commodity.id}`;
                const canvas = document.getElementById(canvasId);
                if (!canvas || !commodity.history) return;

                const ctx = canvas.getContext('2d');
                const allPrices = commodity.history.map(h => h.price);
                const dataPoints = useAllPoints ? allPrices : allPrices.slice(-pointsCount);

                if (dataPoints.length < 2) {
                    const container = canvas.parentElement;
                    if (container) {
                        canvas.style.display = 'none';
                        let noDataMsg = container.querySelector('.no-data-msg');
                        if (!noDataMsg) {
                            noDataMsg = document.createElement('div');
                            noDataMsg.className = 'no-data-msg text-[9px] text-brand-black-60 italic flex items-center justify-center h-full';
                            noDataMsg.textContent = 'No data in range';
                            container.appendChild(noDataMsg);
                        }
                    }
                    return;
                }

                // Clear no data message
                const container = canvas.parentElement;
                if (container) {
                    const noDataMsg = container.querySelector('.no-data-msg');
                    if (noDataMsg) noDataMsg.remove();
                    canvas.style.display = '';
                }

                // Destroy existing chart
                if (self.chartRegistry[canvasId]) {
                    self.chartRegistry[canvasId].destroy();
                    delete self.chartRegistry[canvasId];
                }

                // Calculate moving average
                const maData = [];
                if (showMA && dataPoints.length >= 7) {
                    for (let i = 0; i < dataPoints.length; i++) {
                        if (i < 6) {
                            maData.push(null);
                        } else {
                            const slice = dataPoints.slice(i - 6, i + 1);
                            const avg = slice.reduce((a, b) => a + b, 0) / 7;
                            maData.push(avg);
                        }
                    }
                }

                // Find high/low
                const maxVal = Math.max(...dataPoints);
                const minVal = Math.min(...dataPoints);
                const maxIdx = dataPoints.indexOf(maxVal);
                const minIdx = dataPoints.indexOf(minVal);

                // Create gradient
                const canvasHeight = canvas.parentElement?.offsetHeight || 40;
                const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
                gradient.addColorStop(0, colors.gradientStart);
                gradient.addColorStop(1, colors.gradientEnd);

                // Build datasets
                const datasets = [];
                let jsChartType = 'line';
                let mainDataset = {
                    data: dataPoints,
                    borderColor: colors.line,
                    backgroundColor: gradient,
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: colors.line,
                };

                switch (chartType) {
                    case 'area':
                        mainDataset.fill = true;
                        break;
                    case 'line':
                        mainDataset.fill = false;
                        break;
                    case 'bar':
                        jsChartType = 'bar';
                        mainDataset = {
                            data: dataPoints,
                            backgroundColor: dataPoints.map((val, i) => {
                                if (i === 0) return colors.line;
                                return val >= dataPoints[i - 1] ? colors.up : colors.down;
                            }),
                            borderRadius: 1,
                            borderSkipped: false,
                        };
                        break;
                    case 'step':
                        mainDataset.stepped = 'before';
                        mainDataset.tension = 0;
                        mainDataset.fill = true;
                        break;
                    case 'sparkline-range':
                        mainDataset.fill = {
                            target: 'origin',
                            above: colors.gradientStart,
                            below: 'rgba(153, 15, 61, 0.1)'
                        };
                        mainDataset.tension = 0.2;
                        const avgPrice = dataPoints.reduce((a, b) => a + b, 0) / dataPoints.length;
                        datasets.push({
                            data: dataPoints.map(() => avgPrice),
                            borderColor: 'rgba(128, 128, 128, 0.3)',
                            borderWidth: 1,
                            borderDash: [3, 3],
                            fill: false,
                            pointRadius: 0,
                        });
                        break;
                    case 'none':
                        canvas.style.display = 'none';
                        return;
                }

                // Add high/low markers
                if (showHighLow && jsChartType === 'line') {
                    mainDataset.pointRadius = dataPoints.map((_, i) => (i === maxIdx || i === minIdx) ? 4 : 0);
                    mainDataset.pointBackgroundColor = dataPoints.map((_, i) => {
                        if (i === maxIdx) return colors.up;
                        if (i === minIdx) return colors.down;
                        return colors.line;
                    });
                    mainDataset.pointBorderColor = mainDataset.pointBackgroundColor;
                }

                datasets.unshift(mainDataset);

                // Add MA line
                if (showMA && maData.length > 0 && jsChartType === 'line') {
                    datasets.push({
                        data: maData,
                        borderColor: colors.ma,
                        borderWidth: 1,
                        borderDash: [2, 2],
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        spanGaps: true,
                    });
                }

                // Create chart
                self.chartRegistry[canvasId] = new Chart(ctx, {
                    type: jsChartType,
                    data: {
                        labels: dataPoints.map((_, i) => i),
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 300 },
                        plugins: { legend: { display: false }, tooltip: { enabled: false } },
                        scales: { x: { display: false }, y: { display: false } },
                        interaction: { intersect: false, mode: 'index' }
                    }
                });
            });
        });
    },

    // Refresh sparkline colors on theme change (called by BW.Sparkline.refresh)
    refreshSparklines: function () {
        const colors = BW.Theme ? BW.Theme.getSparklineColors() : {
            line: '#0f5499',
            gradientStart: 'rgba(15, 84, 153, 0.1)',
            gradientEnd: 'rgba(15, 84, 153, 0)'
        };

        Object.keys(this.chartRegistry).forEach(canvasId => {
            const chart = this.chartRegistry[canvasId];
            if (!chart || !chart.data || !chart.data.datasets) return;

            const canvas = document.getElementById(canvasId);
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const canvasHeight = canvas.parentElement?.offsetHeight || 40;
            const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
            gradient.addColorStop(0, colors.gradientStart);
            gradient.addColorStop(1, colors.gradientEnd);

            // Update main dataset colors
            const mainDataset = chart.data.datasets[0];
            if (mainDataset) {
                mainDataset.borderColor = colors.line;
                mainDataset.backgroundColor = gradient;
                if (mainDataset.pointHoverBackgroundColor) {
                    mainDataset.pointHoverBackgroundColor = colors.line;
                }
            }

            // Update MA line if present
            if (chart.data.datasets.length > 1) {
                const maDataset = chart.data.datasets.find(d => d.borderDash);
                if (maDataset) {
                    maDataset.borderColor = colors.ma;
                }
            }

            chart.update('none'); // Update without animation
        });
    },

    // Update range button styles
    updateRangeButtons: function (activeRange) {
        const ranges = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
        ranges.forEach(range => {
            const btn = document.getElementById(`range-${range}`);
            if (btn) {
                if (range === activeRange) {
                    btn.className = 'range-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-white shadow-sm text-brand-black-80 dark:text-terminal-black transition-all';
                } else {
                    btn.className = 'range-btn px-3 py-1.5 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all';
                }
            }
        });
    },

    // Update date range display text (simplified - no specific dates since data may vary)
    updateDateRangeDisplay: function (range) {
        const display = document.getElementById('date-range-display');
        if (!display) return;

        const labels = {
            '1W': 'Last 7 days',
            '1M': 'Last month',
            '3M': 'Last 3 months',
            '6M': 'Last 6 months',
            '1Y': 'Last year',
            'ALL': 'All available data'
        };
        display.textContent = labels[range] || 'All available data';
    },

    // Initialize data range on load
    initDataRange: function () {
        const urlParams = new URLSearchParams(window.location.search);
        const range = urlParams.get('range') || this.getSettings().dataRange || 'ALL';
        this.updateRangeButtons(range);
        this.updateDateRangeDisplay(range);
    },

    // Toggle settings panel visibility
    toggleSettingsPanel: function () {
        const panel = document.getElementById('settings-panel');
        const container = document.getElementById('table-settings-container');
        const toggleText = document.getElementById('settings-toggle-text');

        panel.classList.toggle('hidden');
        if (container) container.classList.toggle('hidden');

        const isHidden = panel.classList.contains('hidden');
        toggleText.textContent = isHidden ? 'Show' : 'Hide';

        const settings = this.getSettings();
        settings.panelOpen = !isHidden;
        this.saveSettings(settings);
    },

    // Toggle column visibility
    toggleColumn: function (colName) {
        const checkbox = document.getElementById(`col-${colName}`);
        const settings = this.getSettings();
        settings.columns[colName] = checkbox.checked;
        this.saveSettings(settings);
        this.applyColumnVisibility(colName, checkbox.checked);
        this.updateColumnCount();
    },

    // Apply column visibility
    applyColumnVisibility: function (colName, visible) {
        document.querySelectorAll(`[data-col="${colName}"]`).forEach(cell => {
            cell.style.display = visible ? '' : 'none';
        });
    },

    // Update visible column count
    updateColumnCount: function () {
        const settings = this.getSettings();
        const count = Object.values(settings.columns).filter(v => v).length;
        const el = document.getElementById('visible-columns-count');
        if (el) el.textContent = count;
    },

    // Preview router
    updatePreview: function (colName) {
        switch (colName) {
            case 'commodity': this.updateCommodityPreview(); break;
            case 'trend': this.updateTrendPreview(); break;
            case 'price': this.updatePricePreview(); break;
            case 'chg': this.updateChgPreview(); break;
            case 'pct': this.updatePctPreview(); break;
            case 'updated': this.updateUpdatedPreview(); break;
        }
    },

    // Commodity preview
    updateCommodityPreview: function () {
        const display = document.getElementById('commodity-display')?.value || 'full';
        const preview = document.getElementById('preview-commodity');
        if (!preview) return;

        const icon = '<div class="w-8 h-8 rounded-lg bg-brand-black-60/10 dark:bg-white/10 flex items-center justify-center"><span class="text-[9px] font-bold text-brand-black-60">BR</span></div>';
        const name = '<div class="text-xs font-bold text-brand-black-80 dark:text-white">Brent Crude Oil</div>';
        const category = '<div class="text-[9px] text-brand-black-60">Energy</div>';

        switch (display) {
            case 'full': preview.innerHTML = `<div class="flex items-center gap-2">${icon}<div>${name}${category}</div></div>`; break;
            case 'name-category': preview.innerHTML = `<div>${name}${category}</div>`; break;
            case 'name-only': preview.innerHTML = name; break;
            case 'compact': preview.innerHTML = `<div class="flex items-center gap-2">${icon}${name}</div>`; break;
        }
    },

    // Trend chart preview
    updateTrendPreview: function () {
        const type = document.getElementById('trend-type')?.value || 'area';
        const showMA = document.getElementById('trend-ma')?.checked || false;
        const showHighLow = document.getElementById('trend-highlow')?.checked || false;
        const container = document.getElementById('preview-trend');
        if (!container) return;

        const points = [[0, 20], [12, 18], [25, 12], [38, 15], [50, 8], [63, 10], [75, 4], [88, 6], [100, 8]];
        const highIdx = 6;
        const lowIdx = 0;

        if (type === 'none') {
            container.innerHTML = '<span class="text-[9px] text-brand-black-60 italic">Hidden</span>';
            return;
        }

        let svg = '<svg class="w-full h-8" viewBox="0 0 100 24">';
        svg += `<defs><linearGradient id="sparkGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#0f5499;stop-opacity:0.3" /><stop offset="100%" style="stop-color:#0f5499;stop-opacity:0" /></linearGradient></defs>`;

        switch (type) {
            case 'area':
                svg += `<path d="M${points.map(p => p.join(',')).join(' L')} L100,24 L0,24 Z" fill="url(#sparkGrad)" />`;
                svg += `<path d="M${points.map(p => p.join(',')).join(' L')}" fill="none" stroke="#0f5499" stroke-width="2" />`;
                break;
            case 'line':
                svg += `<path d="M${points.map(p => p.join(',')).join(' L')}" fill="none" stroke="#0f5499" stroke-width="2" />`;
                break;
            case 'bar':
                const colors = ['#0f5499', '#0d7680', '#990f3d', '#0d7680', '#0d7680', '#990f3d', '#0d7680', '#990f3d', '#0d7680'];
                points.forEach((p, i) => { svg += `<rect x="${p[0] - 4}" y="${p[1]}" width="8" height="${24 - p[1]}" fill="${colors[i]}" rx="1" />`; });
                break;
            case 'step':
                let stepPath = `M${points[0][0]},${points[0][1]}`;
                for (let i = 1; i < points.length; i++) { stepPath += ` H${points[i][0]} V${points[i][1]}`; }
                svg += `<path d="${stepPath} V24 H0 Z" fill="url(#sparkGrad)" />`;
                svg += `<path d="${stepPath}" fill="none" stroke="#0f5499" stroke-width="2" />`;
                break;
            case 'sparkline-range':
                svg += `<path d="M${points.map(p => p.join(',')).join(' L')}" fill="none" stroke="#0f5499" stroke-width="2" />`;
                const avgY = points.reduce((a, p) => a + p[1], 0) / points.length;
                svg += `<line x1="0" y1="${avgY}" x2="100" y2="${avgY}" stroke="#888" stroke-width="1" stroke-dasharray="3,3" />`;
                break;
        }

        if (showMA && ['area', 'line', 'step'].includes(type)) {
            const maPoints = [[25, 16], [38, 13], [50, 11], [63, 10], [75, 7], [88, 6], [100, 7]];
            svg += `<path d="M${maPoints.map(p => p.join(',')).join(' L')}" fill="none" stroke="#990f3d" stroke-width="1.5" stroke-dasharray="2,2" />`;
        }

        if (showHighLow && type !== 'bar') {
            svg += `<circle cx="${points[highIdx][0]}" cy="${points[highIdx][1]}" r="4" fill="#0d7680" />`;
            svg += `<circle cx="${points[lowIdx][0]}" cy="${points[lowIdx][1]}" r="4" fill="#990f3d" />`;
        }

        svg += '</svg>';
        container.innerHTML = svg;
    },

    // Price preview
    updatePricePreview: function () {
        const format = document.getElementById('price-format')?.value || 'default';
        const currency = document.getElementById('price-currency')?.value || 'below';
        const precision = parseInt(document.getElementById('price-precision')?.value || '2');
        const preview = document.getElementById('preview-price');
        if (!preview) return;

        const basePrice = 89.84567;
        let priceText = basePrice.toFixed(precision);
        if (format === 'thousands') {
            priceText = basePrice.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
        }

        let html = '';
        switch (currency) {
            case 'below': html = `<div class="text-sm font-bold text-brand-black-80 dark:text-white">${priceText}</div><div class="text-[9px] text-brand-black-60">USD</div>`; break;
            case 'inline': html = `<div class="text-sm font-bold text-brand-black-80 dark:text-white">USD ${priceText}</div>`; break;
            case 'symbol': html = `<div class="text-sm font-bold text-brand-black-80 dark:text-white">$${priceText}</div>`; break;
            case 'none': html = `<div class="text-sm font-bold text-brand-black-80 dark:text-white">${priceText}</div>`; break;
        }
        preview.innerHTML = html;
    },

    // Change preview
    updateChgPreview: function () {
        const format = document.getElementById('chg-format')?.value || 'arrow';
        const color = document.getElementById('chg-color')?.value || 'colored';
        const preview = document.getElementById('preview-chg');
        if (!preview) return;

        const colorStyle = color === 'colored' ? 'color: var(--color-up)' : '';
        let text = '';
        switch (format) {
            case 'arrow': text = '▲ +12.45'; break;
            case 'sign': text = '+12.45'; break;
            case 'plain': text = '12.45'; break;
        }
        preview.innerHTML = `<span class="text-sm font-bold ${color === 'neutral' ? 'text-brand-black-80 dark:text-white' : ''}" style="${colorStyle}">${text}</span>`;
    },

    // Percent preview
    updatePctPreview: function () {
        const style = document.getElementById('pct-style')?.value || 'badge';
        const decimals = parseInt(document.getElementById('pct-decimals')?.value || '2');
        const preview = document.getElementById('preview-pct');
        if (!preview) return;

        const pctValue = '+' + (0.7234).toFixed(decimals) + '%';
        if (style === 'badge') {
            preview.innerHTML = `<span class="px-2 py-0.5 rounded text-xs font-bold" style="color: var(--color-up); background-color: var(--color-up-bg)">${pctValue}</span>`;
        } else {
            preview.innerHTML = `<span class="text-xs font-bold" style="color: var(--color-up)">${pctValue}</span>`;
        }
    },

    // Date preview
    updateUpdatedPreview: function () {
        const format = document.getElementById('updated-format')?.value || 'iso';
        const preview = document.getElementById('preview-updated');
        if (!preview) return;

        let dateText = '';
        switch (format) {
            case 'iso': dateText = '2026-01-07'; break;
            case 'short': dateText = 'Jan 7'; break;
            case 'long': dateText = 'January 7, 2026'; break;
            case 'relative': dateText = 'Today'; break;
        }
        preview.innerHTML = `<span class="text-xs font-medium text-brand-black-60">${dateText}</span>`;
    },

    // Apply all settings
    applySettings: function () {
        const settings = this.getSettings();

        settings.commodity = {
            display: document.getElementById('commodity-display')?.value || 'full',
            icon: document.getElementById('commodity-icon')?.value || 'initials'
        };
        settings.trend = {
            type: document.getElementById('trend-type')?.value || 'area',
            points: document.getElementById('trend-points')?.value || '30',
            showMA: document.getElementById('trend-ma')?.checked || false,
            showHighLow: document.getElementById('trend-highlow')?.checked || false
        };
        settings.price = {
            format: document.getElementById('price-format')?.value || 'default',
            currency: document.getElementById('price-currency')?.value || 'below',
            precision: document.getElementById('price-precision')?.value || '2'
        };
        settings.chg = {
            format: document.getElementById('chg-format')?.value || 'arrow',
            color: document.getElementById('chg-color')?.value || 'colored'
        };
        settings.pct = {
            style: document.getElementById('pct-style')?.value || 'badge',
            decimals: document.getElementById('pct-decimals')?.value || '2'
        };
        settings.updated = {
            format: document.getElementById('updated-format')?.value || 'iso',
            time: document.getElementById('updated-time')?.value || 'no'
        };

        this.saveSettings(settings);
        this.applyVisualSettings(settings);

        // Reload charts
        const urlParams = new URLSearchParams(window.location.search);
        const currentRange = urlParams.get('range') || 'ALL';
        const category = urlParams.get('category');
        let apiUrl = `/api/commodities?range=${currentRange}`;
        if (category) apiUrl += `&category=${encodeURIComponent(category)}`;

        fetch(apiUrl)
            .then(response => response.json())
            .then(response => {
                const commodities = response.data || response;
                this.initSparklines(commodities);
            })
            .catch(err => console.error('Failed to reload charts:', err));

        // Show confirmation
        const btn = document.querySelector('[onclick*="applySettings"]');
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = '✓ Applied!';
            setTimeout(() => { btn.textContent = originalText; }, 1500);
        }
    },

    // Apply visual settings to table
    applyVisualSettings: function (settings) {
        // Commodity display
        document.querySelectorAll('.commodity-cell').forEach(cell => {
            const icon = cell.querySelector('.commodity-icon');
            const category = cell.querySelector('.commodity-category');
            const display = settings.commodity?.display || 'full';

            if (icon) icon.style.display = (display === 'full' || display === 'compact') ? '' : 'none';
            if (category) category.style.display = (display === 'full' || display === 'name-category') ? '' : 'none';
        });

        // Price format
        document.querySelectorAll('.price-value').forEach(el => {
            const rawValue = parseFloat(el.dataset.raw);
            if (isNaN(rawValue)) return;

            const format = settings.price?.format || 'default';
            const precision = parseInt(settings.price?.precision || '2');
            let formatted = rawValue.toFixed(precision);

            if (format === 'thousands') {
                formatted = rawValue.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
            } else if (format === 'compact') {
                if (rawValue >= 1000000) formatted = (rawValue / 1000000).toFixed(precision) + 'M';
                else if (rawValue >= 1000) formatted = (rawValue / 1000).toFixed(precision) + 'K';
            }
            el.textContent = formatted;
        });

        // Price currency
        document.querySelectorAll('.price-currency').forEach(el => {
            el.style.display = settings.price?.currency === 'none' ? 'none' : '';
        });

        // Change format
        document.querySelectorAll('.chg-arrow').forEach(el => {
            el.style.display = (settings.chg?.format || 'arrow') === 'arrow' ? '' : 'none';
        });

        document.querySelectorAll('.chg-value').forEach(el => {
            const format = settings.chg?.format || 'arrow';
            const parent = el.closest('.chg-cell');
            const rawValue = parseFloat(parent?.dataset.value);
            if (isNaN(rawValue)) return;

            if (format === 'plain') {
                el.textContent = Math.abs(rawValue).toString();
            } else {
                el.textContent = (rawValue >= 0 ? '+' : '') + rawValue;
            }
        });

        // Change color
        document.querySelectorAll('.chg-cell').forEach(el => {
            const color = settings.chg?.color || 'colored';
            const rawValue = parseFloat(el.dataset.value);
            el.classList.remove('text-brand-teal', 'text-brand-claret', 'text-brand-black-80');
            el.style.color = '';

            if (color === 'neutral') {
                el.classList.add('text-brand-black-80');
            } else {
                el.style.color = rawValue >= 0 ? 'var(--color-up)' : 'var(--color-down)';
            }
        });

        // Percent style
        document.querySelectorAll('.pct-cell').forEach(el => {
            const style = settings.pct?.style || 'badge';
            const decimals = parseInt(settings.pct?.decimals || '2');
            const rawValue = parseFloat(el.dataset.value);
            if (isNaN(rawValue)) return;

            el.textContent = (rawValue >= 0 ? '+' : '') + rawValue.toFixed(decimals) + '%';
            el.classList.remove('px-2', 'py-1', 'rounded-md');
            el.style.color = '';
            el.style.backgroundColor = '';

            if (style === 'badge') {
                el.classList.add('px-2', 'py-1', 'rounded-md');
                el.style.color = rawValue >= 0 ? 'var(--color-up)' : 'var(--color-down)';
                el.style.backgroundColor = rawValue >= 0 ? 'var(--color-up-bg)' : 'var(--color-down-bg)';
            } else {
                el.style.color = rawValue >= 0 ? 'var(--color-up)' : 'var(--color-down)';
            }
        });

        // Date format
        document.querySelectorAll('.updated-cell').forEach(el => {
            const rawDate = el.dataset.raw;
            if (!rawDate) return;

            const format = settings.updated?.format || 'iso';
            const date = new Date(rawDate);
            if (isNaN(date.getTime())) return;

            let formatted = rawDate;
            switch (format) {
                case 'short': formatted = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); break;
                case 'long': formatted = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }); break;
                case 'relative':
                    const diffDays = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
                    if (diffDays === 0) formatted = 'Today';
                    else if (diffDays === 1) formatted = 'Yesterday';
                    else if (diffDays < 7) formatted = diffDays + ' days ago';
                    else formatted = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    break;
            }
            el.textContent = formatted;
        });
    },

    // Reset all settings
    resetAllSettings: function () {
        if (!confirm('Reset all table settings to defaults? This cannot be undone.')) {
            return;
        }
        localStorage.removeItem('table-settings');
        location.reload();
    },

    // Export to CSV
    exportToCSV: function () {
        const table = document.getElementById('data-table');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        const headers = ['Commodity', 'Category', 'Price', 'Currency', 'Change', 'Change %', 'Date'];
        let csvContent = headers.join(',') + '\n';

        rows.forEach(row => {
            const commodity = row.querySelector('.commodity-name')?.textContent?.trim() || '';
            const category = row.querySelector('.commodity-category')?.textContent?.trim() || '';
            const price = row.querySelector('.price-value')?.dataset?.raw || '';
            const change = row.querySelector('.chg-cell')?.dataset?.value || '';
            const changePct = row.querySelector('.pct-cell')?.dataset?.value || '';
            const date = row.querySelector('.updated-cell')?.dataset?.raw || '';

            csvContent += `"${commodity}","${category}",${price},USD,${change},${changePct},${date}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `benchmarks_${new Date().toISOString().split('T')[0]}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // Load settings on page load
    loadSettings: function () {
        const settings = this.getSettings();

        // Load column checkboxes
        this.defaultColumns.forEach(col => {
            const checkbox = document.getElementById(`col-${col}`);
            if (checkbox) {
                checkbox.checked = settings.columns[col] !== false;
                this.applyColumnVisibility(col, checkbox.checked);
            }
        });

        // Load selects
        const selects = {
            'commodity-display': settings.commodity?.display,
            'trend-type': settings.trend?.type,
            'trend-points': settings.trend?.points,
            'price-format': settings.price?.format,
            'price-currency': settings.price?.currency,
            'price-precision': settings.price?.precision,
            'chg-format': settings.chg?.format,
            'chg-color': settings.chg?.color,
            'pct-style': settings.pct?.style,
            'pct-decimals': settings.pct?.decimals,
            'updated-format': settings.updated?.format
        };

        Object.entries(selects).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el && value) el.value = value;
        });

        // Load trend checkboxes
        const trendMA = document.getElementById('trend-ma');
        if (trendMA) trendMA.checked = settings.trend?.showMA || false;
        const trendHighLow = document.getElementById('trend-highlow');
        if (trendHighLow) trendHighLow.checked = settings.trend?.showHighLow || false;

        // Restore panel state
        const panel = document.getElementById('settings-panel');
        const toggleText = document.getElementById('settings-toggle-text');
        if (panel && settings.panelOpen) {
            panel.classList.remove('hidden');
            if (toggleText) toggleText.textContent = 'Hide Settings';
        }

        this.updateColumnCount();
        this.applyVisualSettings(settings);

        // Update previews
        ['commodity', 'trend', 'price', 'chg', 'pct', 'updated'].forEach(col => this.updatePreview(col));
    },

    // Initialize component
    init: function (commodities) {
        this.loadSettings();
        this.initDataRange();
        if (commodities && commodities.length > 0) {
            this.initSparklines(commodities);
        }
    }
};

// Global function aliases for onclick handlers
function setDataRange(r) { BW.CompactTable.setDataRange(r); }
function toggleSettingsPanel() { BW.CompactTable.toggleSettingsPanel(); }
function toggleColumn(c) { BW.CompactTable.toggleColumn(c); }
function updatePreview(c) { BW.CompactTable.updatePreview(c); }
function applySettings() { BW.CompactTable.applySettings(); }
function resetAllSettings() { BW.CompactTable.resetAllSettings(); }
function exportToCSV() { BW.CompactTable.exportToCSV(); }
function toggleFreqBadge() {
    const checkbox = document.getElementById('table-show-freq-badge');
    const showBadge = checkbox?.checked ?? true;
    // Save to localStorage
    try {
        const settings = JSON.parse(localStorage.getItem('table-settings') || '{}');
        settings.showFreqBadge = showBadge;
        localStorage.setItem('table-settings', JSON.stringify(settings));
    } catch (e) { }
    // Toggle visibility of all freq badges in table
    document.querySelectorAll('#table-body .freq-badge').forEach(badge => {
        badge.style.display = showBadge ? '' : 'none';
    });
}

// Table Sorting State
let currentSortColumn = null;
let currentSortDirection = 'asc';

// Sort table by column
function sortTable(column) {
    const table = document.getElementById('data-table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length === 0) return;

    // Toggle direction if same column, otherwise reset to ascending
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'asc';
    }

    // Update sort indicators
    document.querySelectorAll('.sort-indicator').forEach(el => {
        el.textContent = '';
    });
    const activeIndicator = document.querySelector(`.sort-indicator[data-sort="${column}"]`);
    if (activeIndicator) {
        activeIndicator.textContent = currentSortDirection === 'asc' ? ' ▲' : ' ▼';
    }

    // Sort rows
    rows.sort((a, b) => {
        let aVal, bVal;

        switch (column) {
            case 'name':
                aVal = a.querySelector('.commodity-name')?.textContent?.trim() || '';
                bVal = b.querySelector('.commodity-name')?.textContent?.trim() || '';
                break;
            case 'price':
                aVal = parseFloat(a.querySelector('.price-value')?.dataset?.raw || a.querySelector('.price-value')?.textContent || 0);
                bVal = parseFloat(b.querySelector('.price-value')?.dataset?.raw || b.querySelector('.price-value')?.textContent || 0);
                break;
            case 'change':
                aVal = parseFloat(a.querySelector('.chg-cell')?.dataset?.value || 0);
                bVal = parseFloat(b.querySelector('.chg-cell')?.dataset?.value || 0);
                break;
            case 'pct':
                aVal = parseFloat(a.querySelector('.pct-cell')?.dataset?.value || 0);
                bVal = parseFloat(b.querySelector('.pct-cell')?.dataset?.value || 0);
                break;
            case 'date':
                aVal = a.querySelector('.updated-cell')?.dataset?.date || '';
                bVal = b.querySelector('.updated-cell')?.dataset?.date || '';
                break;
            default:
                return 0;
        }

        // Compare values
        if (typeof aVal === 'string') {
            const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
            return currentSortDirection === 'asc' ? cmp : -cmp;
        } else {
            const cmp = aVal - bVal;
            return currentSortDirection === 'asc' ? cmp : -cmp;
        }
    });

    // Re-append sorted rows
    rows.forEach(row => tbody.appendChild(row));
}

