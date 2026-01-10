/**
 * BenchmarkWatcher - Grid View Component
 * Handles grid card display, data range selection, and updates
 * 
 * NOTE: Do not access localStorage directly.
 * Use BW.Settings exclusively.
 * 
 * COUPLING NOTE: GridView is intentionally stateless regarding view-mode.
 * View switching is handled by BW.Index; this component only manages grid-specific state.
 */

window.BW = window.BW || {};

BW.GridView = {
    // AbortController for request cancellation
    currentRequest: null,

    // Get grid settings via BW.Settings
    getSettings: function () {
        return BW.Settings.getGridSettings();
    },

    // Save grid settings via BW.Settings
    saveSettings: function (settings) {
        BW.Settings.saveGridSettings(settings);
    },

    // Create DOM-based state node (error, empty, loading) - reusable, accessible
    createStateNode: function ({ type, title, message, actionLabel, onAction }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'col-span-full flex flex-col items-center justify-center py-16 text-center gap-3';
        wrapper.setAttribute('role', 'status');
        wrapper.setAttribute('aria-live', 'polite');

        const icon = document.createElement('div');
        icon.className = 'text-brand-black-60';
        icon.innerHTML = `
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                ${type === 'error'
                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>'
                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0H4"></path>'
            }
            </svg>
        `;

        const heading = document.createElement('p');
        heading.className = type === 'error' ? 'font-bold text-brand-claret' : 'font-bold text-brand-black-80 dark:text-white';
        heading.textContent = title;

        const text = document.createElement('p');
        text.className = 'text-sm text-brand-black-60 max-w-md';
        text.textContent = message;

        wrapper.append(icon, heading, text);

        if (actionLabel && onAction) {
            const btn = document.createElement('button');
            btn.className =
                'mt-4 px-4 py-2 text-sm font-bold text-white bg-brand-oxford dark:bg-brand-teal rounded-lg hover:opacity-90 transition-all focus:outline-none focus:ring-2 focus:ring-brand-oxford dark:focus:ring-brand-teal';
            btn.textContent = actionLabel;
            btn.addEventListener('click', onAction);
            wrapper.appendChild(btn);
        }

        return wrapper;
    },

    // Set data range and fetch new data
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

        // Cancel any pending request to prevent race conditions
        if (this.currentRequest) {
            this.currentRequest.abort();
        }
        this.currentRequest = new AbortController();

        // Show loading state
        const container = document.getElementById('grid-cards-container');
        const loading = document.getElementById('grid-loading');
        if (loading) {
            loading.classList.remove('hidden');
            loading.setAttribute('aria-busy', 'true');
        }
        if (container) {
            container.style.opacity = '0.5';
            container.style.pointerEvents = 'none';
        }

        // Preserve category filter from URL
        const urlParams = new URLSearchParams(window.location.search);
        const category = urlParams.get('category');
        let apiUrl = `/api/commodities?range=${range}`;
        if (category) apiUrl += `&category=${encodeURIComponent(category)}`;

        const self = this;

        // Fetch and update grid
        fetch(apiUrl, { signal: this.currentRequest.signal })
            .then(response => response.json())
            .then(response => {
                const commodities = response.data || response;
                self.updateCards(commodities);
                if (loading) {
                    loading.classList.add('hidden');
                    loading.removeAttribute('aria-busy');
                }
                if (container) {
                    container.style.opacity = '1';
                    container.style.pointerEvents = '';
                }
            })
            .catch(error => {
                if (error.name === 'AbortError') return;

                console.error('Failed to fetch data:', error);
                if (loading) {
                    loading.classList.add('hidden');
                    loading.removeAttribute('aria-busy');
                }
                if (!container) return;

                container.style.opacity = '1';
                container.style.pointerEvents = '';
                container.innerHTML = '';

                container.appendChild(
                    self.createStateNode({
                        type: 'error',
                        title: 'Failed to load data',
                        message: 'Please check your connection and try again.',
                        actionLabel: 'Try again',
                        onAction: () => self.setDataRange(range)
                    })
                );
            });
    },

    // Update grid cards with new data
    updateCards: function (commodities) {
        const container = document.getElementById('grid-cards-container');
        if (!container) return;

        container.innerHTML = '';

        // Handle empty data
        if (!Array.isArray(commodities) || commodities.length === 0) {
            container.appendChild(
                this.createStateNode({
                    type: 'empty',
                    title: 'No data available',
                    message: 'No benchmarks match the current filters or range.'
                })
            );
            return;
        }

        const settings = this.getSettings();
        const currentRange = settings.dataRange || 'ALL';
        // Observation-based labels (not calendar periods)
        const rangeLabels = {
            '1W': 'recent observations',
            '1M': 'recent observations',
            '3M': 'extended observations',
            '6M': 'extended observations',
            '1Y': 'long-run observations',
            'ALL': 'full observation history'
        };
        const rangeLabel = rangeLabels[currentRange] || 'selected observations';

        commodities.forEach(commodity => {
            // Defensive guard: skip malformed records to prevent partial API failures from crashing UI
            if (!commodity || !commodity.id || commodity.price == null) {
                if (window.BW_ENV === 'dev') {
                    console.warn('Skipping malformed commodity record:', commodity);
                }
                return;
            }

            // Observation-based percentage change (not time-normalized, not a return metric)
            const displayChange = commodity.change !== undefined ? commodity.change : 0;
            const displayChangePercent = commodity.change_percent !== undefined ? commodity.change_percent : 0;

            const isUp = displayChange >= 0;
            const colorVar = isUp ? '--color-up' : '--color-down';
            const bgColorVar = isUp ? '--color-up-bg' : '--color-down-bg';
            const arrow = isUp ? '+' : '−';
            const direction = isUp ? '' : '';  // Neutral: no interpretive label
            const sign = isUp ? '+' : '';

            // Determine if daily or monthly data
            const dailyCommodities = ['brent_oil', 'wti_oil', 'natural_gas', 'heating_oil', 'jet_fuel', 'propane', 'gold', 'silver', 'gasoline'];
            const isDaily = commodity.source_type === 'EIA' || dailyCommodities.includes(commodity.id);
            const freqBadge = isDaily ? 'D' : 'M';
            const freqTitle = isDaily ? 'Daily data' : 'Monthly data';
            const freqColor = isDaily ? 'bg-brand-teal/20 text-brand-teal' : 'bg-brand-oxford/20 text-brand-oxford dark:bg-brand-teal/20 dark:text-brand-teal';

            // Check if freq badge should be shown
            const showFreqBadge = settings.showFreqBadge !== false;
            const freqBadgeHtml = showFreqBadge ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${freqColor} font-ui freq-badge" title="${freqTitle}">${freqBadge}</span>` : '';

            const card = document.createElement('a');
            card.href = `/commodity/${commodity.id}`;
            card.className = 'block group';
            // Data attributes for stable sorting (avoids regex scraping rendered text)
            card.dataset.name = commodity.name;
            card.dataset.price = commodity.price;
            card.dataset.changePct = displayChangePercent;
            card.dataset.changeAbs = displayChange;
            card.innerHTML = `
                <div class="bg-card-warm dark:bg-terminal-surface p-6 rounded-2xl shadow-sm border border-brand-black-60/20 dark:border-white/10 group-hover:shadow-lg group-hover:border-brand-oxford dark:group-hover:border-brand-teal group-hover:-translate-y-1 transition-all duration-300 h-full relative overflow-hidden">
                    <div class="absolute inset-0 bg-gradient-to-br from-brand-oxford/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold text-brand-black-60 dark:text-brand-black-60 tracking-[0.15em] font-ui uppercase">${commodity.category.toUpperCase()}</span>
                            ${freqBadgeHtml}
                        </div>
                        <div class="text-[10px] font-bold py-1 px-2.5 rounded-full font-ui" style="color: var(${colorVar}); background-color: var(${bgColorVar});">
                            ${arrow} ${direction}
                        </div>
                    </div>
                    <h3 class="text-lg font-bold text-brand-black-80 dark:text-white mb-4 font-serif leading-tight group-hover:text-brand-oxford dark:group-hover:text-brand-teal transition-colors">
                        ${commodity.name}
                    </h3>
                    <div class="flex items-end justify-between gap-4 font-ui">
                        <div>
                            <div class="text-3xl font-extrabold text-brand-black-80 dark:text-white tracking-tight leading-none">
                                ${commodity.price}
                            </div>
                            <div class="text-sm font-medium text-brand-black-60 dark:text-brand-black-60/80 mt-1">
                                ${commodity.currency} / ${commodity.unit}
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="text-xl font-bold" style="color: var(${colorVar});">
                                ${sign}${displayChangePercent}%
                            </div>
                            <div class="text-xs text-brand-black-60 dark:text-brand-black-60/60 mt-1">
                                ${sign}${displayChange} ${commodity.currency}
                            </div>
                        </div>
                    </div>
                    <div class="mt-5 pt-4 border-t border-brand-black-60/10 dark:border-white/5 flex justify-between items-center font-ui">
                        <div class="text-xs text-brand-black-60 dark:text-brand-black-60/80 font-medium">
                            As of ${commodity.date} · <span class="italic">${rangeLabel}</span>
                        </div>
                        <div class="text-brand-black-60 dark:text-brand-black-60 group-hover:text-brand-oxford dark:group-hover:text-brand-teal group-hover:translate-x-1 transition-all">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                            </svg>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    },

    // Update range button styles and accessibility attributes
    updateRangeButtons: function (activeRange) {
        const ranges = ['1W', '1M', '3M', '6M', '1Y', 'ALL'];
        ranges.forEach(range => {
            const btn = document.getElementById(`grid-range-${range}`);
            if (!btn) return;

            const isActive = range === activeRange;

            // ARIA radio semantics for screen readers
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
            btn.setAttribute('tabindex', isActive ? '0' : '-1');

            btn.className = isActive
                ? 'grid-range-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-white shadow-sm text-brand-black-80 dark:text-terminal-black transition-all'
                : 'grid-range-btn px-3 py-1.5 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all';
        });
    },

    // Update date range display text (simplified - no specific dates since data may vary)
    updateDateRangeDisplay: function (range) {
        const display = document.getElementById('grid-range-text');
        if (!display) return;

        // Observation-accurate labels (not calendar periods)
        const labels = {
            '1W': 'Recent observations',
            '1M': 'Recent observations',
            '3M': 'Extended observations',
            '6M': 'Extended observations',
            '1Y': 'Longer observation span',
            'ALL': 'All available observations'
        };
        display.textContent = labels[range] || 'All available observations';
    },

    // Initialize grid view
    init: function () {
        const urlParams = new URLSearchParams(window.location.search);
        const urlRange = urlParams.get('range');
        const settings = this.getSettings();
        const activeRange = urlRange || settings.dataRange || 'ALL';

        this.updateRangeButtons(activeRange);
        this.updateDateRangeDisplay(activeRange);
        this.loadGridSettings();
    },

    // Toggle settings panel visibility
    toggleSettingsPanel: function () {
        const panel = document.getElementById('grid-settings-panel');
        const toggleText = document.getElementById('grid-settings-toggle-text');
        if (panel) {
            panel.classList.toggle('hidden');
            if (toggleText) {
                toggleText.textContent = panel.classList.contains('hidden') ? 'Show Settings' : 'Hide Settings';
            }
        }
    },

    // Load saved grid settings
    loadGridSettings: function () {
        const settings = this.getSettings();

        // Load visibility toggles
        const showCategory = document.getElementById('grid-show-category');
        const showChangePct = document.getElementById('grid-show-change-pct');
        const showChangeAbs = document.getElementById('grid-show-change-abs');
        const showDate = document.getElementById('grid-show-date');
        const showUnit = document.getElementById('grid-show-unit');
        const showFreqBadge = document.getElementById('grid-show-freq-badge');
        const columns = document.getElementById('grid-columns');
        const sort = document.getElementById('grid-sort');
        const cardStyle = document.getElementById('grid-card-style');

        // Apply saved values (default to true/checked)
        if (showCategory) showCategory.checked = settings.showCategory !== false;
        if (showChangePct) showChangePct.checked = settings.showChangePct !== false;
        if (showChangeAbs) showChangeAbs.checked = settings.showChangeAbs !== false;
        if (showDate) showDate.checked = settings.showDate !== false;
        if (showUnit) showUnit.checked = settings.showUnit !== false;
        if (showFreqBadge) showFreqBadge.checked = settings.showFreqBadge !== false;
        if (columns && settings.columns) columns.value = settings.columns;
        if (sort && settings.sort) sort.value = settings.sort;
        if (cardStyle && settings.cardStyle) cardStyle.value = settings.cardStyle;

        // IMMEDIATELY apply freq badge visibility to server-rendered cards
        const freqBadgeVisible = settings.showFreqBadge !== false;
        document.querySelectorAll('.freq-badge').forEach(badge => {
            badge.style.display = freqBadgeVisible ? '' : 'none';
        });

        // Apply settings immediately
        this.updateSettings();
    },

    // Update grid settings from controls - REAL DATA VISIBILITY CHANGES
    updateSettings: function () {
        const settings = this.getSettings();

        // Read all visibility toggles
        const showCategory = document.getElementById('grid-show-category')?.checked ?? true;
        const showChangePct = document.getElementById('grid-show-change-pct')?.checked ?? true;
        const showChangeAbs = document.getElementById('grid-show-change-abs')?.checked ?? true;
        const showDate = document.getElementById('grid-show-date')?.checked ?? true;
        const showUnit = document.getElementById('grid-show-unit')?.checked ?? true;
        const showFreqBadge = document.getElementById('grid-show-freq-badge')?.checked ?? true;
        const columns = document.getElementById('grid-columns')?.value || 'auto';
        const sort = document.getElementById('grid-sort')?.value || 'name';
        const cardStyle = document.getElementById('grid-card-style')?.value || 'card';

        // Save settings
        settings.showCategory = showCategory;
        settings.showChangePct = showChangePct;
        settings.showChangeAbs = showChangeAbs;
        settings.showDate = showDate;
        settings.showUnit = showUnit;
        settings.showFreqBadge = showFreqBadge;
        settings.columns = columns;
        settings.sort = sort;
        settings.cardStyle = cardStyle;
        this.saveSettings(settings);

        // IMMEDIATELY apply freq badge visibility
        document.querySelectorAll('.freq-badge').forEach(badge => {
            badge.style.display = showFreqBadge ? '' : 'none';
        });

        // ============================================================
        // UPDATE LIVE PREVIEW CARD - INCLUDING STYLE TRANSFORMATION
        // ============================================================
        const previewCard = document.getElementById('grid-preview-card');
        const previewCategory = document.getElementById('preview-category');
        const previewChangePct = document.getElementById('preview-change-pct');
        const previewChangeAbs = document.getElementById('preview-change-abs');
        const previewFooter = document.getElementById('preview-footer');
        const previewUnit = document.getElementById('preview-unit');

        if (previewCategory) previewCategory.style.display = showCategory ? '' : 'none';
        if (previewChangePct) previewChangePct.style.display = showChangePct ? '' : 'none';
        if (previewChangeAbs) previewChangeAbs.style.display = showChangeAbs ? '' : 'none';
        if (previewFooter) previewFooter.style.display = showDate ? '' : 'none';
        if (previewUnit) previewUnit.style.display = showUnit ? '' : 'none';

        // Transform preview card based on style to match dashboard exactly
        if (previewCard) {
            const nameEl = previewCard.querySelector('h4');
            const priceSection = previewCard.querySelector('.flex.items-end');
            const categoryBadge = previewCategory;

            if (cardStyle === 'minimal') {
                // MINIMAL ROW: Horizontal layout like dashboard
                previewCard.style.cssText = `
                    display: grid;
                    grid-template-columns: ${showCategory ? '50px' : ''} 1fr 100px 80px;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.5rem 0.75rem;
                    border-radius: 0.5rem;
                    background: rgba(0,0,0,0.02);
                    border: 1px solid rgba(0,0,0,0.06);
                    font-family: ui-monospace, SFMono-Regular, monospace;
                `;
                if (previewFooter) previewFooter.style.display = 'none';

                // Category inline
                if (categoryBadge) {
                    categoryBadge.style.cssText = 'order: 1; display: flex; flex-direction: column; gap: 2px; margin: 0;';
                    const catSpan = categoryBadge.querySelector('span');
                    if (catSpan) catSpan.style.cssText = 'font-size: 9px; font-weight: 600; color: #666; text-transform: capitalize;';
                    const upBadge = categoryBadge.querySelector('div');
                    if (upBadge) upBadge.style.display = 'none';
                }

                // Name inline
                if (nameEl) nameEl.style.cssText = 'order: 2; font-size: 13px; margin: 0; font-weight: 600;';

                // Price and change inline
                if (priceSection) {
                    priceSection.style.cssText = 'order: 3; display: contents;';
                    const priceDiv = priceSection.querySelector('div:first-child');
                    const changeDiv = priceSection.querySelector('.text-right');
                    if (priceDiv) priceDiv.style.cssText = 'order: 3; text-align: right;';
                    if (changeDiv) changeDiv.style.cssText = 'order: 4; text-align: right;';
                }

            } else if (cardStyle === 'dense') {
                // DENSE: Compact card
                previewCard.style.cssText = 'padding: 0.75rem; border-radius: 0.75rem;';
                if (nameEl) nameEl.style.cssText = 'font-size: 14px; margin-bottom: 0.5rem;';
                if (categoryBadge) categoryBadge.style.cssText = '';
                if (priceSection) priceSection.style.cssText = '';

            } else {
                // FULL CARD: Reset to default
                previewCard.style.cssText = '';
                if (nameEl) nameEl.style.cssText = '';
                if (categoryBadge) categoryBadge.style.cssText = '';
                if (priceSection) priceSection.style.cssText = '';
                const catSpan = categoryBadge?.querySelector('span');
                if (catSpan) catSpan.style.cssText = '';
                const upBadge = categoryBadge?.querySelector('div');
                if (upBadge) upBadge.style.cssText = '';
            }
        }

        const container = document.getElementById('grid-cards-container');
        if (!container) return;

        // ============================================================
        // CARD STYLE (Full Cards / Minimal Row / Dense Grid)
        // First: RESET all inline styles to prevent corruption
        // ============================================================
        container.className = 'grid';

        // RESET: Clear all inline styles from all card elements first
        container.querySelectorAll('a.block.group').forEach(link => {
            const card = link.querySelector('div');
            if (!card) return;

            // Reset card inline styles
            card.style.cssText = '';

            // Reset all child elements' inline styles
            card.querySelectorAll('*').forEach(el => {
                el.style.cssText = '';
            });
        });

        if (cardStyle === 'minimal') {
            // MINIMAL: Dense, terminal-style reference rows
            container.classList.add('gap-0');
            container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(500px, 1fr))';

            // Add table header style to container
            container.style.borderRadius = '0.5rem';
            container.style.overflow = 'hidden';
            container.style.border = '1px solid rgba(0,0,0,0.1)';

            container.querySelectorAll('a.block.group').forEach((link, index) => {
                const card = link.querySelector('div');
                if (!card) return;

                // Financial terminal row styling
                const isEven = index % 2 === 0;
                card.className = '';
                card.style.cssText = `
                    display: grid;
                    grid-template-columns: ${showCategory ? '70px' : ''} 1fr 140px 100px;
                    align-items: center;
                    gap: 1rem;
                    padding: 0.625rem 1rem;
                    background: ${isEven ? 'rgba(0,0,0,0.02)' : 'transparent'};
                    border-bottom: 1px solid rgba(0,0,0,0.06);
                    transition: background 0.15s;
                    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
                `;

                // Hover effect
                link.onmouseenter = () => card.style.background = 'rgba(14, 55, 86, 0.08)';
                link.onmouseleave = () => card.style.background = isEven ? 'rgba(0,0,0,0.02)' : 'transparent';

                // Hide footer and overlay
                const gradientOverlay = card.querySelector('.absolute');
                const footer = card.querySelector('.mt-5');
                if (gradientOverlay) gradientOverlay.style.display = 'none';
                if (footer) footer.style.display = 'none';

                // CATEGORY - Compact sector tag
                const categoryRow = card.querySelector('.flex.items-center.justify-between.mb-3');
                if (categoryRow) {
                    if (!showCategory) {
                        categoryRow.style.display = 'none';
                    } else {
                        categoryRow.style.cssText = `
                            display: flex;
                            flex-direction: column;
                            align-items: flex-start;
                            gap: 2px;
                            margin: 0;
                            order: 1;
                        `;
                        // Style the category label
                        const catLabel = categoryRow.querySelector('span');
                        if (catLabel) {
                            catLabel.style.cssText = `
                                font-size: 9px;
                                font-weight: 600;
                                letter-spacing: 0.02em;
                                text-transform: capitalize;
                                color: #666;
                                font-family: system-ui, sans-serif;
                            `;
                        }
                        // Hide the UP/DOWN badge in minimal view
                        const badge = categoryRow.querySelector('div');
                        if (badge) badge.style.display = 'none';
                    }
                }

                // TICKER/NAME - Financial style
                const title = card.querySelector('h3');
                if (title) {
                    title.style.cssText = `
                        order: 2;
                        margin: 0;
                        font-size: 13px;
                        font-weight: 600;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        color: #1a1a1a;
                        font-family: system-ui, -apple-system, sans-serif;
                        letter-spacing: -0.01em;
                    `;
                }

                // PRICE - Monospace, right-aligned
                const priceSection = card.querySelector('.flex.items-end.justify-between');
                if (priceSection) {
                    priceSection.style.cssText = `
                        order: 3;
                        display: flex;
                        flex-direction: column;
                        align-items: flex-end;
                        gap: 0;
                        text-align: right;
                    `;

                    const priceEl = priceSection.querySelector('.text-3xl');
                    if (priceEl) {
                        priceEl.style.cssText = `
                            font-size: 13px;
                            font-weight: 700;
                            color: #1a1a1a;
                            font-family: ui-monospace, SFMono-Regular, monospace;
                            letter-spacing: -0.02em;
                        `;
                        priceEl.className = '';
                    }

                    const unitEl = priceSection.querySelector('.text-sm.font-medium');
                    if (unitEl) {
                        unitEl.style.cssText = `
                            font-size: 9px;
                            color: #888;
                            font-family: system-ui, sans-serif;
                            display: ${showUnit ? 'block' : 'none'};
                        `;
                        unitEl.className = '';
                    }
                }

                // CHANGE - Color-coded, prominent
                const changeSection = card.querySelector('.text-right');
                if (changeSection) {
                    changeSection.style.cssText = `
                        order: 4;
                        display: ${(!showChangePct && !showChangeAbs) ? 'none' : 'flex'};
                        flex-direction: column;
                        align-items: flex-end;
                        gap: 0;
                        text-align: right;
                        min-width: 80px;
                    `;

                    const changePctEl = changeSection.querySelector('.text-xl');
                    if (changePctEl) {
                        // Get the actual value to determine color - use CSS variables for theme support
                        const text = changePctEl.textContent || '';
                        const isPositive = text.includes('+') || (!text.includes('-') && parseFloat(text) > 0);
                        const isNegative = text.includes('-') || parseFloat(text) < 0;
                        const color = isPositive ? 'var(--color-up)' : isNegative ? 'var(--color-down)' : '#666';

                        changePctEl.style.cssText = `
                            font-size: 13px;
                            font-weight: 700;
                            color: ${color};
                            font-family: ui-monospace, SFMono-Regular, monospace;
                            display: ${showChangePct ? 'block' : 'none'};
                        `;
                        changePctEl.className = '';
                    }

                    const changeAbsEl = changeSection.querySelector('.text-xs');
                    if (changeAbsEl) {
                        const text = changeAbsEl.textContent || '';
                        const isPositive = text.includes('+');
                        const isNegative = text.includes('-');
                        const color = isPositive ? 'var(--color-up)' : isNegative ? 'var(--color-down)' : '#888';

                        changeAbsEl.style.cssText = `
                            font-size: 10px;
                            color: ${color};
                            font-family: ui-monospace, SFMono-Regular, monospace;
                            opacity: 0.8;
                            display: ${showChangeAbs ? 'block' : 'none'};
                        `;
                        changeAbsEl.className = '';
                    }
                }
            });
        } else if (cardStyle === 'dense') {
            // DENSE: Compact grid with smaller cards, more columns
            container.classList.add('grid-cols-2', 'sm:grid-cols-3', 'md:grid-cols-4', 'lg:grid-cols-5', 'gap-3');

            container.querySelectorAll('a.block.group').forEach(link => {
                const card = link.querySelector('div');
                if (!card) return;

                // Compact card styling
                card.className = 'bg-card-warm dark:bg-terminal-surface rounded-xl border border-brand-black-60/20 dark:border-white/10 group-hover:shadow-md group-hover:border-brand-oxford dark:group-hover:border-brand-teal transition-all duration-200';
                card.style.cssText = 'padding: 0.75rem; height: 100%; display: flex; flex-direction: column;';

                // Hide gradient overlay
                const gradientOverlay = card.querySelector('.absolute');
                if (gradientOverlay) gradientOverlay.style.display = 'none';

                // Category - compact inline
                const categoryRow = card.querySelector('.flex.items-center.justify-between.mb-3');
                if (categoryRow) {
                    categoryRow.style.cssText = `display: ${showCategory ? 'flex' : 'none'}; margin-bottom: 0.5rem; gap: 0.5rem;`;
                    const catSpan = categoryRow.querySelector('span');
                    if (catSpan) catSpan.style.cssText = 'font-size: 9px; text-transform: capitalize;';
                    const badge = categoryRow.querySelector('div');
                    if (badge) badge.style.cssText = 'font-size: 8px; padding: 2px 6px;';
                }

                // Title - smaller
                const title = card.querySelector('h3');
                if (title) {
                    title.className = 'text-sm font-bold text-brand-black-80 dark:text-white mb-2 font-serif leading-tight';
                    title.style.cssText = 'font-size: 14px; margin-bottom: 0.5rem;';
                }

                // Price section - compact
                const priceSection = card.querySelector('.flex.items-end.justify-between');
                if (priceSection) {
                    priceSection.style.cssText = 'display: flex; align-items: flex-end; justify-content: space-between; gap: 0.5rem; flex: 1;';

                    const priceEl = priceSection.querySelector('.text-3xl');
                    if (priceEl) {
                        priceEl.className = '';
                        priceEl.style.cssText = 'font-size: 18px; font-weight: 800;';
                    }

                    const unitEl = priceSection.querySelector('.text-sm.font-medium');
                    if (unitEl) {
                        unitEl.className = '';
                        unitEl.style.cssText = `font-size: 9px; color: #888; display: ${showUnit ? 'block' : 'none'};`;
                    }

                    const changeSection = priceSection.querySelector('.text-right');
                    if (changeSection) {
                        changeSection.style.cssText = `display: ${(!showChangePct && !showChangeAbs) ? 'none' : 'block'}; text-align: right;`;
                        const changePctEl = changeSection.querySelector('.text-xl');
                        const changeAbsEl = changeSection.querySelector('.text-xs');
                        if (changePctEl) {
                            changePctEl.className = '';
                            changePctEl.style.cssText = `font-size: 13px; font-weight: 700; display: ${showChangePct ? 'block' : 'none'};`;
                        }
                        if (changeAbsEl) {
                            changeAbsEl.className = '';
                            changeAbsEl.style.cssText = `font-size: 9px; display: ${showChangeAbs ? 'block' : 'none'};`;
                        }
                    }
                }

                // Footer - compact
                const footer = card.querySelector('.mt-5');
                if (footer) {
                    footer.className = '';
                    footer.style.cssText = `display: ${showDate ? 'flex' : 'none'}; justify-content: space-between; align-items: center; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(0,0,0,0.05);`;
                    const dateEl = footer.querySelector('.text-xs');
                    if (dateEl) dateEl.style.cssText = 'font-size: 9px;';
                }
            });
        } else {
            // FULL CARDS: Standard responsive grid
            if (columns === 'auto') {
                container.classList.add('grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'gap-6');
            } else if (columns === '2') {
                container.classList.add('grid-cols-1', 'sm:grid-cols-2', 'gap-6');
            } else if (columns === '3') {
                container.classList.add('grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'gap-6');
            } else if (columns === '4') {
                container.classList.add('grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-4', 'gap-6');
            }
            container.querySelectorAll('a.block.group').forEach(link => {
                const card = link.querySelector('div');
                if (!card) return;
                card.className = 'bg-card-warm dark:bg-terminal-surface p-6 rounded-2xl shadow-sm border border-brand-black-60/20 dark:border-white/10 group-hover:shadow-lg group-hover:border-brand-oxford dark:group-hover:border-brand-teal group-hover:-translate-y-1 transition-all duration-300 h-full relative overflow-hidden';

                // Restore gradient overlay
                const gradientOverlay = card.querySelector('.absolute');
                if (gradientOverlay) {
                    gradientOverlay.className = 'absolute inset-0 bg-gradient-to-br from-brand-oxford/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none';
                    gradientOverlay.style.cssText = '';
                }

                // Restore category row
                const categoryRow = card.querySelector('div:nth-child(2)');
                if (categoryRow && categoryRow.querySelector('span')) {
                    categoryRow.className = 'flex items-center justify-between mb-3';
                    categoryRow.style.cssText = showCategory ? '' : 'display: none;';
                }

                // Restore commodity name
                const commodityName = card.querySelector('h3');
                if (commodityName) {
                    commodityName.className = 'text-lg font-bold text-brand-black-80 dark:text-white mb-4 font-serif leading-tight group-hover:text-brand-oxford dark:group-hover:text-brand-teal transition-colors';
                    commodityName.style.cssText = '';
                }

                // Restore price section
                const priceSection = card.querySelector('.flex.items-end') || card.querySelectorAll('div')[3];
                if (priceSection) {
                    priceSection.className = 'flex items-end justify-between gap-4 font-ui';
                    priceSection.style.cssText = '';

                    // Price value
                    const priceDiv = priceSection.children[0];
                    if (priceDiv) {
                        priceDiv.style.cssText = '';
                        const priceEl = priceDiv.querySelector('div:first-child');
                        if (priceEl) {
                            priceEl.className = 'text-3xl font-extrabold text-brand-black-80 dark:text-white tracking-tight leading-none';
                            priceEl.style.cssText = '';
                        }
                        const unitEl = priceDiv.querySelector('div:last-child');
                        if (unitEl) {
                            unitEl.className = 'text-sm font-medium text-brand-black-60 dark:text-brand-black-60/80 mt-1';
                            unitEl.style.cssText = showUnit ? '' : 'display: none;';
                        }
                    }

                    // Change section
                    const changeSection = priceSection.querySelector('.text-right') || priceSection.children[1];
                    if (changeSection) {
                        changeSection.className = 'text-right';
                        changeSection.style.cssText = (!showChangePct && !showChangeAbs) ? 'display: none;' : '';

                        const changePctEl = changeSection.children[0];
                        if (changePctEl) {
                            changePctEl.className = 'text-xl font-bold';
                            changePctEl.style.cssText = showChangePct ? '' : 'display: none;';
                        }
                        const changeAbsEl = changeSection.children[1];
                        if (changeAbsEl) {
                            changeAbsEl.className = 'text-xs text-brand-black-60 dark:text-brand-black-60/60 mt-1';
                            changeAbsEl.style.cssText = showChangeAbs ? '' : 'display: none;';
                        }
                    }
                }

                // Restore footer
                const footer = card.querySelector('.mt-5') || card.lastElementChild;
                if (footer && footer.querySelector('svg')) {
                    footer.className = 'mt-5 pt-4 border-t border-brand-black-60/10 dark:border-white/5 flex justify-between items-center font-ui';
                    footer.style.cssText = showDate ? '' : 'display: none;';

                    const dateEl = footer.querySelector('.text-xs');
                    if (dateEl) {
                        dateEl.className = 'text-xs text-brand-black-60 dark:text-brand-black-60/80 font-medium';
                        dateEl.style.cssText = '';
                    }

                    const arrowEl = footer.lastElementChild;
                    if (arrowEl) {
                        arrowEl.className = 'text-brand-black-60 dark:text-brand-black-60 group-hover:text-brand-oxford dark:group-hover:text-brand-teal group-hover:translate-x-1 transition-all';
                        arrowEl.style.cssText = '';
                    }
                }
            });
        }

        // ============================================================
        // SORTING
        // ============================================================
        const cardLinks = Array.from(container.querySelectorAll('a.block.group'));
        if (cardLinks.length === 0) return;

        cardLinks.sort((a, b) => {
            // Use data attributes for stable sorting (no regex scraping)
            const nameA = a.dataset.name || a.querySelector('h3')?.textContent.trim() || '';
            const nameB = b.dataset.name || b.querySelector('h3')?.textContent.trim() || '';
            const priceA = parseFloat(a.dataset.price) || 0;
            const priceB = parseFloat(b.dataset.price) || 0;
            const changeA = parseFloat(a.dataset.changePct) || 0;
            const changeB = parseFloat(b.dataset.changePct) || 0;

            switch (sort) {
                case 'name': return nameA.localeCompare(nameB);
                case 'name-desc': return nameB.localeCompare(nameA);
                case 'change-desc': return changeB - changeA;
                case 'change-asc': return changeA - changeB;
                case 'price-desc': return priceB - priceA;
                case 'price-asc': return priceA - priceB;
                default: return 0;
            }
        });

        // Re-append sorted cards
        cardLinks.forEach(card => container.appendChild(card));
    }
};

// Global functions for onclick handlers
function setGridDataRange(r) { BW.GridView.setDataRange(r); }
function toggleGridSettingsPanel() { BW.GridView.toggleSettingsPanel(); }
function updateGridSettings() { BW.GridView.updateSettings(); }

// Auto-initialize on DOM ready (defer to ensure elements exist)
document.addEventListener('DOMContentLoaded', function () {
    // Only init if grid view elements exist
    if (document.getElementById('grid-cards-container') || document.getElementById('grid-range-1W')) {
        BW.GridView.init();
    }
});
