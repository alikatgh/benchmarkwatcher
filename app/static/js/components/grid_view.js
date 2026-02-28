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
    requestSeq: 0,

    // Escape untrusted text before HTML interpolation
    escapeHtml: function (value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    // Format numeric values for UI display with max precision and no grouping.
    formatNumber: function (value, maxFractionDigits = 4) {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) return String(value ?? '');
        return numberValue.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: maxFractionDigits,
            useGrouping: false,
        });
    },

    // Get grid settings via BW.Settings
    getSettings: function () {
        return BW.Settings.getGridSettings();
    },

    // Filter history using latest observation as anchor (not current date)
    getHistoryForRange: function (history, range) {
        if (!Array.isArray(history) || history.length === 0) return [];
        if (!range || range === 'ALL') return history;

        const latestDate = new Date(history[history.length - 1].date);
        if (isNaN(latestDate.getTime())) return history;

        const cutoffDate = new Date(latestDate);
        switch (range) {
            case '1W': cutoffDate.setDate(latestDate.getDate() - 7); break;
            case '1M': cutoffDate.setMonth(latestDate.getMonth() - 1); break;
            case '3M': cutoffDate.setMonth(latestDate.getMonth() - 3); break;
            case '6M': cutoffDate.setMonth(latestDate.getMonth() - 6); break;
            case '1Y': cutoffDate.setFullYear(latestDate.getFullYear() - 1); break;
            default: return history;
        }

        return history.filter(item => {
            const d = new Date(item.date);
            return !isNaN(d.getTime()) && d >= cutoffDate;
        });
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
        this.requestSeq += 1;
        const activeRequestSeq = this.requestSeq;

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
        const apiUrl = BW.Utils.buildCommoditiesApiUrl({
            range,
            includeHistory: true,
            category,
        });

        const self = this;

        // Fetch and update grid
        fetch(apiUrl, { signal: this.currentRequest.signal })
            .then(response => response.json())
            .then(response => {
                const commodities = BW.Utils.getCommoditiesFromApiResponse(response);
                self.updateCards(commodities);
            })
            .catch(error => {
                if (error.name === 'AbortError') return;

                console.error('Failed to fetch data:', error);
                if (!container) return;
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
            })
            .finally(() => {
                // Only clear loading state for the latest request.
                if (activeRequestSeq !== self.requestSeq) return;

                if (loading) {
                    loading.classList.add('hidden');
                    loading.removeAttribute('aria-busy');
                }
                if (container) {
                    container.style.opacity = '1';
                    container.style.pointerEvents = '';
                }
                self.currentRequest = null;
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

            const history = Array.isArray(commodity.history) ? commodity.history : [];
            const scopedHistory = this.getHistoryForRange(history, currentRange);

            let displayChange = commodity.change !== undefined ? commodity.change : 0;
            let displayChangePercent = commodity.change_percent !== undefined ? commodity.change_percent : 0;

            if (scopedHistory.length >= 2) {
                const first = Number(scopedHistory[0].price);
                const last = Number(scopedHistory[scopedHistory.length - 1].price);
                if (Number.isFinite(first) && Number.isFinite(last)) {
                    const abs = last - first;
                    const pct = first !== 0 ? (abs / first) * 100 : 0;
                    displayChange = Number(abs.toFixed(3));
                    displayChangePercent = Number(pct.toFixed(2));
                }
            }

            const isUp = displayChange >= 0;
            const colorVar = isUp ? '--color-up' : '--color-down';
            const bgColorVar = isUp ? '--color-up-bg' : '--color-down-bg';
            const borderColorVar = isUp ? '--color-up-border' : '--color-down-border';
            const arrowSymbol = isUp ? '▲' : '▼';
            const sign = isUp ? '+' : '';

            const commodityId = String(commodity.id || '');
            const safeCategory = this.escapeHtml(String(commodity.category || '').toUpperCase());
            const safeName = this.escapeHtml(String(commodity.name || ''));
            const safePrice = this.escapeHtml(this.formatNumber(commodity.price, 4));
            const safeCurrency = this.escapeHtml(String(commodity.currency || ''));
            const safeUnit = this.escapeHtml(String(commodity.unit || ''));
            const safeDate = this.escapeHtml(String(commodity.date || ''));
            const safeDisplayChange = this.escapeHtml(`${sign}${displayChange}`);
            const safeDisplayChangePercent = this.escapeHtml(`${sign}${displayChangePercent}`);
            const safeRangeLabel = this.escapeHtml(rangeLabel);

            // Determine if daily or monthly data
            const isDaily = BW.Utils.isDailyCommodity(commodity);
            const freqBadge = isDaily ? 'D' : 'M';
            const freqTitle = isDaily ? 'Daily data' : 'Monthly data';
            const freqColor = isDaily ? 'bg-brand-teal/20 text-brand-teal' : 'bg-brand-oxford/20 text-brand-oxford dark:bg-brand-teal/20 dark:text-brand-teal';

            // Check if freq badge should be shown
            const showFreqBadge = settings.showFreqBadge !== false;
            const freqBadgeHtml = showFreqBadge ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${freqColor} font-ui freq-badge" title="${freqTitle}">${freqBadge}</span>` : '';

            const card = document.createElement('a');
            card.href = `/commodity/${encodeURIComponent(commodityId)}`;
            card.className = 'block group';
            // Data attributes for stable sorting (avoids regex scraping rendered text)
            card.dataset.name = commodity.name;
            card.dataset.price = commodity.price;
            card.dataset.changePct = displayChangePercent;
            card.dataset.changeAbs = displayChange;
            card.innerHTML = `
                <div class="bw-grid-card bg-card-warm dark:bg-terminal-surface p-6 rounded-2xl border border-brand-black-60/15 dark:border-white/10 group-hover:border-brand-oxford dark:group-hover:border-brand-teal group-hover:-translate-y-1 transition-all duration-300 h-full relative overflow-hidden" style="box-shadow: var(--card-shadow);">
                    <div class="bw-grid-gradient absolute inset-0 bg-gradient-to-br from-brand-oxford/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                    <div class="bw-grid-category-row flex items-center justify-between mb-4">
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold text-brand-black-60 dark:text-brand-black-60 tracking-[0.15em] font-ui uppercase">${safeCategory}</span>
                            ${freqBadgeHtml}
                        </div>
                        <div class="bw-grid-direction-badge text-[10px] font-bold py-0.5 px-2.5 rounded-full font-ui" style="color: var(${colorVar}); background-color: var(${bgColorVar}); border: 1px solid var(${borderColorVar});">
                            ${arrowSymbol} ${Math.abs(displayChangePercent)}%
                        </div>
                    </div>
                    <h3 class="bw-grid-title text-lg font-bold text-brand-black-80 dark:text-white mb-4 font-serif leading-tight group-hover:text-brand-oxford dark:group-hover:text-brand-teal transition-colors line-clamp-2 min-h-[3.1rem]">
                        ${safeName}
                    </h3>
                    <div class="bw-grid-price-section font-ui mb-3">
                        <div class="bw-grid-price tabular-nums text-3xl font-extrabold text-brand-black-80 dark:text-white tracking-tight leading-none truncate">
                            ${safePrice}
                        </div>
                        <div class="bw-grid-unit text-sm font-medium text-brand-black-60 dark:text-brand-black-60/80 mt-1">
                            ${safeCurrency} / ${safeUnit}
                        </div>
                    </div>
                    <div class="bw-grid-change flex items-baseline gap-2 font-ui min-h-[1.7rem]">
                        <span class="bw-grid-change-pct tabular-nums text-lg font-bold" style="color: var(${colorVar});">
                            ${safeDisplayChangePercent}%
                        </span>
                        <span class="text-brand-black-60/30 dark:text-white/20 text-xs select-none">·</span>
                        <span class="bw-grid-change-abs tabular-nums text-sm text-brand-black-60 dark:text-brand-black-60/60 truncate">
                            ${safeDisplayChange} ${safeCurrency}
                        </span>
                    </div>
                    <div class="bw-grid-footer mt-4 pt-4 border-t border-brand-black-60/10 dark:border-white/5 flex justify-between items-center font-ui">
                        <div class="bw-grid-date text-[10px] text-brand-black-60 dark:text-white/70">
                            As of ${safeDate} · <span class="italic">${safeRangeLabel}</span>
                        </div>
                        <div class="text-brand-black-60 dark:text-white/70 group-hover:text-brand-oxford dark:group-hover:text-brand-teal group-hover:translate-x-0.5 transition-all">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path>
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
                ? 'grid-range-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg shadow-sm transition-all theme-surface theme-text'
                : 'grid-range-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all';
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
        document.querySelectorAll('#grid-cards-container .freq-badge').forEach(badge => {
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
        document.querySelectorAll('#grid-cards-container .freq-badge').forEach(badge => {
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
            const priceSection = document.getElementById('preview-price-section');
            const previewChangeRow = previewChangePct?.parentElement || null;
            const categoryBadge = previewCategory;

            if (cardStyle === 'minimal') {
                // MINIMAL ROW: premium compact row
                previewCard.style.cssText = `
                    display: grid;
                    grid-template-columns: ${showCategory ? '86px ' : ''}1fr 115px 110px auto;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.75rem 0.85rem;
                    border-radius: 0.75rem;
                    background: var(--theme-surface);
                    border: 1px solid var(--theme-border);
                    box-shadow: 0 1px 0 color-mix(in srgb, var(--theme-border) 65%, transparent);
                `;
                if (previewFooter) previewFooter.style.display = showDate ? 'flex' : 'none';

                // Category inline
                if (categoryBadge) {
                    categoryBadge.style.cssText = 'order: 1; display: flex; flex-direction: column; align-items:flex-start; gap: 2px; margin: 0;';
                    const catSpan = categoryBadge.querySelector('span');
                    if (catSpan) catSpan.style.cssText = 'font-size: 10px; font-weight: 700; color: var(--theme-text-muted); letter-spacing:0.05em;';
                    const upBadge = categoryBadge.querySelector('div');
                    if (upBadge) upBadge.style.cssText = 'font-size:9px; padding:2px 6px;';
                }

                // Name inline
                if (nameEl) nameEl.style.cssText = 'order: 2; font-size: 14px; margin: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

                // Price and change inline
                if (priceSection) {
                    priceSection.style.cssText = 'order: 3; margin: 0; text-align: right;';
                }
                if (previewChangeRow) {
                    previewChangeRow.style.cssText = 'order: 4; justify-content: flex-end; margin: 0;';
                }

            } else if (cardStyle === 'dense') {
                previewCard.style.cssText = 'padding: 0.75rem; border-radius: 0.75rem; border: 1px solid var(--theme-border); box-shadow:none;';
                if (nameEl) nameEl.style.cssText = 'font-size: 12px; margin-bottom: 0.35rem; line-height:1.2;';
                if (categoryBadge) categoryBadge.style.cssText = showCategory ? 'margin-bottom:0.35rem; gap:0.35rem;' : 'display:none;';
                if (priceSection) priceSection.style.cssText = 'margin-bottom:0.3rem;';
                if (previewChangeRow) previewChangeRow.style.cssText = 'margin:0; gap:0.4rem;';
                if (previewFooter) previewFooter.style.display = showDate ? 'flex' : 'none';

            } else {
                previewCard.style.cssText = 'padding: 1.25rem; border-radius: 1rem; border: 1px solid color-mix(in srgb, var(--theme-border) 75%, transparent); box-shadow: 0 10px 24px color-mix(in srgb, var(--theme-border) 25%, transparent);';
                if (nameEl) nameEl.style.cssText = 'font-size: 16px; margin-bottom: 0.8rem; line-height:1.2;';
                if (categoryBadge) categoryBadge.style.cssText = showCategory ? 'margin-bottom:0.8rem;' : 'display:none;';
                if (priceSection) priceSection.style.cssText = 'margin-bottom:0.65rem;';
                if (previewChangeRow) previewChangeRow.style.cssText = 'margin:0; gap:0.5rem;';
                if (previewFooter) previewFooter.style.display = showDate ? 'flex' : 'none';
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
        container.style.borderRadius = '';
        container.style.overflow = '';
        container.style.border = '';
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(min(var(--card-min-w, 240px), 100%), 1fr))';
        container.style.gap = 'clamp(0.75rem, 1.8vw, 1.5rem)';

        // RESET: Clear all inline styles from all card elements first
        container.querySelectorAll('a.block.group').forEach(link => {
            const card = link.querySelector('div');
            if (!card) return;

            link.onmouseenter = null;
            link.onmouseleave = null;

            // Reset card inline styles
            card.style.cssText = '';

            // Reset all child elements' inline styles
            card.querySelectorAll('*').forEach(el => {
                el.style.cssText = '';
            });
        });

        if (cardStyle === 'minimal') {
            container.classList.add('gap-2');
            container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(460px, 100%), 1fr))';

            container.querySelectorAll('a.block.group').forEach((link, index) => {
                const card = link.querySelector('div');
                if (!card) return;

                const isEven = index % 2 === 0;
                card.className = 'bw-grid-card bg-card-warm dark:bg-terminal-surface rounded-xl border border-brand-black-60/15 dark:border-white/8 relative overflow-hidden';
                card.style.cssText = `
                    display: grid;
                    grid-template-columns: ${showCategory ? 'minmax(90px, 120px) ' : ''}minmax(180px, 1fr) minmax(140px, 180px) minmax(130px, 170px) auto;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.75rem 0.9rem;
                    background: ${isEven ? 'var(--theme-surface)' : 'color-mix(in srgb, var(--theme-surface) 65%, transparent)'};
                    box-shadow: 0 1px 0 color-mix(in srgb, var(--theme-border) 65%, transparent);
                    transition: transform 0.15s ease, background 0.2s ease;
                `;

                link.onmouseenter = () => {
                    card.style.background = 'color-mix(in srgb, var(--theme-accent) 10%, var(--theme-surface))';
                    card.style.transform = 'translateY(-1px)';
                };
                link.onmouseleave = () => {
                    card.style.background = isEven
                        ? 'var(--theme-surface)'
                        : 'color-mix(in srgb, var(--theme-surface) 65%, transparent)';
                    card.style.transform = '';
                };

                const gradientOverlay = card.querySelector('.bw-grid-gradient');
                if (gradientOverlay) gradientOverlay.style.display = 'none';

                const categoryRow = card.querySelector('.bw-grid-category-row');
                if (categoryRow) {
                    categoryRow.style.cssText = showCategory
                        ? 'display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px; margin:0; order:1;'
                        : 'display:none;';
                    const catLabel = categoryRow.querySelector('span');
                    if (catLabel) {
                        catLabel.style.cssText = 'font-size:10px; font-weight:700; letter-spacing:0.06em; color:var(--theme-text-muted);';
                    }
                    const badge = categoryRow.querySelector('.bw-grid-direction-badge');
                    if (badge) badge.style.cssText = 'font-size:9px; padding:2px 6px; border-radius:9999px;';
                }

                const title = card.querySelector('.bw-grid-title');
                if (title) {
                    title.style.cssText = `
                        order: 2;
                        margin: 0;
                        font-size: 14px;
                        font-weight: 700;
                        line-height: 1.2;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        min-height: 0;
                    `;
                }

                const priceSection = card.querySelector('.bw-grid-price-section');
                if (priceSection) {
                    priceSection.style.cssText = 'order:3; margin:0; text-align:right;';
                    const priceEl = priceSection.querySelector('.bw-grid-price');
                    if (priceEl) {
                        priceEl.style.cssText = 'font-size:18px; font-weight:800; line-height:1;';
                    }
                    const unitEl = priceSection.querySelector('.bw-grid-unit');
                    if (unitEl) {
                        unitEl.style.cssText = `font-size:11px; margin-top:2px; display:${showUnit ? 'block' : 'none'}; color: var(--theme-text-muted);`;
                    }
                }

                const changeSection = card.querySelector('.bw-grid-change');
                if (changeSection) {
                    changeSection.style.cssText = `
                        order:4;
                        display:${(!showChangePct && !showChangeAbs) ? 'none' : 'flex'};
                        flex-direction:column;
                        align-items:flex-end;
                        justify-content:center;
                        gap:2px;
                        min-height:0;
                    `;

                    const changePctEl = changeSection.querySelector('.bw-grid-change-pct');
                    if (changePctEl) {
                        changePctEl.style.cssText = `font-size:16px; line-height:1; font-weight:800; display:${showChangePct ? 'block' : 'none'};`;
                    }
                    const changeAbsEl = changeSection.querySelector('.bw-grid-change-abs');
                    if (changeAbsEl) {
                        changeAbsEl.style.cssText = `font-size:11px; line-height:1.15; display:${showChangeAbs ? 'block' : 'none'}; color:var(--theme-text-muted);`;
                    }
                }

                const footer = card.querySelector('.bw-grid-footer');
                if (footer) {
                    footer.style.cssText = `
                        order:5;
                        margin:0;
                        padding:0;
                        border:0;
                        display:${showDate ? 'flex' : 'none'};
                        align-items:center;
                        justify-content:flex-end;
                        gap:0.35rem;
                        min-width:85px;
                    `;
                    const dateEl = footer.querySelector('.bw-grid-date');
                    if (dateEl) {
                        dateEl.style.cssText = 'font-size:10px; white-space:nowrap; color:var(--theme-text-muted);';
                    }
                    const arrowEl = footer.querySelector('svg')?.parentElement;
                    if (arrowEl) {
                        arrowEl.style.cssText = 'display:flex; align-items:center; opacity:0.8;';
                    }
                }
            });
        } else if (cardStyle === 'dense') {
            container.classList.add('grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-4', 'xl:grid-cols-5', 'gap-3');

            container.querySelectorAll('a.block.group').forEach(link => {
                const card = link.querySelector('div');
                if (!card) return;

                card.className = 'bw-grid-card bg-card-warm dark:bg-terminal-surface rounded-lg border border-brand-black-60/12 dark:border-white/8 h-full relative overflow-hidden transition-all duration-150';
                card.style.cssText = 'padding: 0.7rem; box-shadow: none;';

                const gradientOverlay = card.querySelector('.bw-grid-gradient');
                if (gradientOverlay) gradientOverlay.style.display = 'none';

                const categoryRow = card.querySelector('.bw-grid-category-row');
                if (categoryRow) {
                    categoryRow.style.cssText = `display:${showCategory ? 'flex' : 'none'}; margin-bottom:0.35rem; gap:0.35rem; align-items:center;`;
                    const catSpan = categoryRow.querySelector('span');
                    if (catSpan) catSpan.style.cssText = 'font-size:9px; letter-spacing:0.05em;';
                    const badge = categoryRow.querySelector('.bw-grid-direction-badge');
                    if (badge) badge.style.cssText = 'font-size:8px; padding:2px 5px;';
                }

                const title = card.querySelector('.bw-grid-title');
                if (title) {
                    title.className = 'bw-grid-title text-xs font-bold text-brand-black-80 dark:text-white mb-1.5 font-serif leading-tight line-clamp-2 min-h-[2rem]';
                    title.style.cssText = '';
                }

                const priceSection = card.querySelector('.bw-grid-price-section');
                if (priceSection) {
                    priceSection.style.cssText = 'margin-bottom:0.3rem;';
                    const priceEl = priceSection.querySelector('.bw-grid-price');
                    if (priceEl) {
                        priceEl.className = 'bw-grid-price tabular-nums text-lg font-extrabold text-brand-black-80 dark:text-white tracking-tight leading-none truncate';
                        priceEl.style.cssText = '';
                    }
                    const unitEl = priceSection.querySelector('.bw-grid-unit');
                    if (unitEl) {
                        unitEl.style.cssText = `font-size:10px; margin-top:2px; display:${showUnit ? 'block' : 'none'};`;
                    }
                }

                const changeSection = card.querySelector('.bw-grid-change');
                if (changeSection) {
                    changeSection.className = 'bw-grid-change flex items-center gap-1 font-ui';
                    changeSection.style.cssText = (!showChangePct && !showChangeAbs) ? 'display:none;' : 'min-height:0;';
                    const changePctEl = changeSection.querySelector('.bw-grid-change-pct');
                    const changeAbsEl = changeSection.querySelector('.bw-grid-change-abs');
                    if (changePctEl) {
                        changePctEl.style.cssText = `font-size:12px; font-weight:800; display:${showChangePct ? 'inline' : 'none'};`;
                    }
                    if (changeAbsEl) {
                        changeAbsEl.style.cssText = `font-size:10px; display:${showChangeAbs ? 'inline' : 'none'}; color:var(--theme-text-muted);`;
                    }
                }

                const footer = card.querySelector('.bw-grid-footer');
                if (footer) {
                    footer.style.cssText = `display:${showDate ? 'flex' : 'none'}; margin-top:0.4rem; padding-top:0.35rem; border-top:1px solid var(--theme-border); align-items:center; justify-content:space-between;`;
                    const dateEl = footer.querySelector('.bw-grid-date');
                    if (dateEl) dateEl.style.cssText = 'font-size:9px;';
                    const arrowEl = footer.querySelector('svg')?.parentElement;
                    if (arrowEl) arrowEl.style.cssText = 'opacity:0.75;';
                }
            });
        } else {
            if (columns === 'auto') {
                container.classList.add('grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3', 'gap-7');
            } else if (columns === '2') {
                container.classList.add('grid-cols-1', 'sm:grid-cols-2', 'gap-7');
            } else if (columns === '3') {
                container.classList.add('grid-cols-1', 'sm:grid-cols-2', 'xl:grid-cols-3', 'gap-7');
            } else if (columns === '4') {
                container.classList.add('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4', 'gap-6');
            }
            container.querySelectorAll('a.block.group').forEach(link => {
                const card = link.querySelector('div');
                if (!card) return;
                card.className = 'bw-grid-card bg-card-warm dark:bg-terminal-surface p-6 rounded-2xl border border-brand-black-60/15 dark:border-white/10 group-hover:border-brand-oxford dark:group-hover:border-brand-teal group-hover:-translate-y-1 transition-all duration-300 h-full relative overflow-hidden';
                card.style.boxShadow = '0 10px 24px color-mix(in srgb, var(--theme-border) 25%, transparent)';

                // Restore gradient overlay
                const gradientOverlay = card.querySelector('.bw-grid-gradient') || card.querySelector('.absolute');
                if (gradientOverlay) {
                    gradientOverlay.className = 'absolute inset-0 bg-gradient-to-br from-brand-oxford/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none';
                    gradientOverlay.style.cssText = '';
                }

                // Restore category row
                const categoryRow = card.querySelector('.bw-grid-category-row') || card.querySelector('div:nth-child(2)');
                if (categoryRow && categoryRow.querySelector('span')) {
                    categoryRow.className = 'flex items-center justify-between mb-4';
                    categoryRow.style.cssText = showCategory ? '' : 'display: none;';
                }

                // Restore commodity name
                const commodityName = card.querySelector('.bw-grid-title') || card.querySelector('h3');
                if (commodityName) {
                    commodityName.className = 'bw-grid-title text-lg font-bold text-brand-black-80 dark:text-white mb-4 font-serif leading-tight group-hover:text-brand-oxford dark:group-hover:text-brand-teal transition-colors line-clamp-2 min-h-[3.1rem]';
                    commodityName.style.cssText = '';
                }

                // Restore price section
                const priceSection = card.querySelector('.bw-grid-price-section');
                if (priceSection) {
                    priceSection.className = 'bw-grid-price-section font-ui mb-3';
                    priceSection.style.cssText = '';

                    const priceEl = priceSection.querySelector('.bw-grid-price');
                    if (priceEl) {
                        priceEl.className = 'bw-grid-price tabular-nums text-3xl font-extrabold text-brand-black-80 dark:text-white tracking-tight leading-none truncate';
                        priceEl.style.cssText = '';
                    }
                    const unitEl = priceSection.querySelector('.bw-grid-unit');
                    if (unitEl) {
                        unitEl.className = 'bw-grid-unit text-sm font-medium text-brand-black-60 dark:text-brand-black-60/80 mt-1';
                        unitEl.style.cssText = showUnit ? '' : 'display: none;';
                    }
                }

                // Restore change row (sibling of priceSection)
                const changeSection = card.querySelector('.bw-grid-change');
                if (changeSection) {
                    changeSection.className = 'bw-grid-change flex items-baseline gap-2 font-ui min-h-[1.7rem]';
                    changeSection.style.cssText = (!showChangePct && !showChangeAbs) ? 'display: none;' : '';

                    const changePctEl = changeSection.querySelector('.bw-grid-change-pct');
                    if (changePctEl) {
                        changePctEl.className = 'bw-grid-change-pct tabular-nums text-lg font-bold';
                        changePctEl.style.cssText = showChangePct ? '' : 'display: none;';
                    }
                    const changeAbsEl = changeSection.querySelector('.bw-grid-change-abs');
                    if (changeAbsEl) {
                        changeAbsEl.className = 'bw-grid-change-abs tabular-nums text-sm text-brand-black-60 dark:text-brand-black-60/60 truncate';
                        changeAbsEl.style.cssText = showChangeAbs ? '' : 'display: none;';
                    }
                }

                // Restore footer
                const footer = card.querySelector('.bw-grid-footer') || card.lastElementChild;
                if (footer && footer.querySelector('svg')) {
                    footer.className = 'bw-grid-footer mt-4 pt-4 border-t border-brand-black-60/10 dark:border-white/5 flex justify-between items-center font-ui';
                    footer.style.cssText = showDate ? '' : 'display: none;';

                    const dateEl = footer.querySelector('.bw-grid-date');
                    if (dateEl) {
                        dateEl.className = 'bw-grid-date text-[10px] text-brand-black-60 dark:text-white/70';
                        dateEl.style.cssText = '';
                    }

                    const arrowEl = footer.lastElementChild;
                    if (arrowEl) {
                        arrowEl.className = 'text-brand-black-60 dark:text-white/70 group-hover:text-brand-oxford dark:group-hover:text-brand-teal group-hover:translate-x-0.5 transition-all';
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

// Auto-initialize on DOM ready (or immediately if already ready)
if (!window.__bwGridViewDomReadyBound) {
    window.__bwGridViewDomReadyBound = true;
    const runGridInit = function () {
        // Only init if grid view elements exist
        if (document.getElementById('grid-cards-container') || document.getElementById('grid-range-1W')) {
            BW.GridView.init();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runGridInit);
    } else {
        runGridInit();
    }
}
