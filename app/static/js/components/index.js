/**
 * BenchmarkWatcher - Index Page Component (merged/improved)
 * - Shows/hides view containers (#grid-view / #compact-view)
 * - Updates button states (#view-grid / #view-compact) with data-active + aria-pressed
 * 
 * NOTE: Do not access localStorage directly.
 * Use BW.Settings exclusively.
 * 
 * COUPLING NOTE: view-mode is written by SettingsModal and consumed here on page load.
 * GridView is intentionally stateless regarding view mode (separation of concerns).
 */

window.BW = window.BW || {};

BW.Index = {
    rangeLabels: {
        '1W': 'Recent observations',
        '1M': 'Recent observations',
        '3M': 'Extended observations',
        '6M': 'Extended observations',
        '1Y': 'Longer observation span',
        'ALL': 'All observations'
    },

    categoryLabels: {
        agricultural: 'Agriculture',
        metal: 'Metals',
        index: 'Indices',
        precious: 'Precious',
        energy: 'Energy'
    },

    normalizeViewMode: function (value) {
        return value === 'grid' || value === 'compact' ? value : null;
    },

    toFiniteNumber: function (value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    },

    firstFiniteField: function (item, keys) {
        for (const key of keys) {
            const parsed = this.toFiniteNumber(item?.[key]);
            if (parsed !== null) return parsed;
        }
        return 0;
    },

    parseDate: function (value) {
        if (!value) return null;
        const parsed = new Date(String(value));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    },

    formatPercent: function (value, { signed = false } = {}) {
        const parsed = this.toFiniteNumber(value);
        if (parsed === null) return '—';
        const sign = signed && parsed > 0 ? '+' : '';
        return `${sign}${parsed.toFixed(2)}%`;
    },

    getCategoryName: function (categorySlug) {
        const slug = String(categorySlug || 'uncategorized').trim().toLowerCase();
        return this.categoryLabels[slug] || slug
            .replace(/_/g, ' ')
            .replace(/\b\w/g, letter => letter.toUpperCase());
    },

    escapeHtml: function (value) {
        if (BW.Utils?.escapeHtml) return BW.Utils.escapeHtml(value);
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    summarizeMarketPulse: function (commodities) {
        const summary = {
            total: 0,
            up_count: 0,
            down_count: 0,
            flat_count: 0,
            daily_count: 0,
            monthly_count: 0,
            breadth_percent: 0,
            net_count: 0,
            latest_date: null,
            latest_count: 0,
            headline: 'No benchmarks loaded',
            biggest_up: null,
            biggest_down: null
        };

        if (!Array.isArray(commodities) || commodities.length === 0) {
            return summary;
        }

        const dated = [];
        const categoryTotals = {};

        commodities.forEach(commodity => {
            if (!commodity || typeof commodity !== 'object') return;

            summary.total += 1;
            const pctChange = this.firstFiniteField(commodity, ['change_percent', 'daily_change_percent']);
            const absChange = this.firstFiniteField(commodity, ['change', 'daily_change']);
            const mover = {
                id: commodity.id || '',
                name: commodity.name || 'Unknown benchmark',
                category: commodity.category || 'uncategorized',
                change_percent: pctChange,
                change: absChange,
                currency: commodity.currency || ''
            };

            if (pctChange > 0) {
                summary.up_count += 1;
                if (!summary.biggest_up || pctChange > summary.biggest_up.change_percent) {
                    summary.biggest_up = mover;
                }
            } else if (pctChange < 0) {
                summary.down_count += 1;
                if (!summary.biggest_down || pctChange < summary.biggest_down.change_percent) {
                    summary.biggest_down = mover;
                }
            } else {
                summary.flat_count += 1;
            }

            const categorySlug = String(commodity.category || 'uncategorized').trim().toLowerCase();
            if (!categoryTotals[categorySlug]) {
                categoryTotals[categorySlug] = {
                    slug: categorySlug,
                    name: this.getCategoryName(categorySlug),
                    total: 0,
                    up_count: 0,
                    down_count: 0,
                    flat_count: 0,
                    breadth_percent: 0,
                    flat_percent: 0,
                    down_percent: 0
                };
            }
            const categoryBucket = categoryTotals[categorySlug];
            categoryBucket.total += 1;
            if (pctChange > 0) categoryBucket.up_count += 1;
            else if (pctChange < 0) categoryBucket.down_count += 1;
            else categoryBucket.flat_count += 1;

            const isDaily = BW.Utils?.isDailyCommodity
                ? BW.Utils.isDailyCommodity(commodity)
                : commodity.is_daily === true;
            if (isDaily) summary.daily_count += 1;
            else summary.monthly_count += 1;

            const parsedDate = this.parseDate(commodity.date);
            if (parsedDate) dated.push({ date: parsedDate, raw: String(commodity.date) });
        });

        if (summary.total === 0) return summary;

        if (summary.up_count > summary.down_count) {
            summary.headline = 'More benchmarks rose than fell';
        } else if (summary.down_count > summary.up_count) {
            summary.headline = 'More benchmarks fell than rose';
        } else if (summary.up_count + summary.down_count === 0) {
            summary.headline = 'Benchmarks were unchanged';
        } else {
            summary.headline = 'Benchmarks were evenly split';
        }
        summary.breadth_percent = Math.round((summary.up_count / summary.total) * 1000) / 10;
        summary.net_count = summary.up_count - summary.down_count;

        if (dated.length > 0) {
            const latestTime = Math.max(...dated.map(item => item.date.getTime()));
            const latest = dated.find(item => item.date.getTime() === latestTime);
            summary.latest_date = latest?.raw || null;
            summary.latest_count = dated.filter(item => item.date.getTime() === latestTime).length;
        }

        summary.categories = Object.values(categoryTotals)
            .map(category => ({
                ...category,
                breadth_percent: category.total > 0
                    ? Math.round((category.up_count / category.total) * 1000) / 10
                    : 0,
                flat_percent: category.total > 0
                    ? Math.round((category.flat_count / category.total) * 1000) / 10
                    : 0,
                down_percent: category.total > 0
                    ? Math.round((category.down_count / category.total) * 1000) / 10
                    : 0
            }))
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

        return summary;
    },

    setText: function (id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    updateMover: function ({ prefix, mover, fallback, signed }) {
        const link = document.getElementById(`market-pulse-${prefix}-link`);
        const value = document.getElementById(`market-pulse-${prefix}-value`);
        const name = document.getElementById(`market-pulse-${prefix}-name`);

        if (!mover) {
            if (link) {
                link.removeAttribute('href');
                link.setAttribute('aria-disabled', 'true');
                link.setAttribute('tabindex', '-1');
            }
            if (value) value.textContent = '—';
            if (name) name.textContent = fallback;
            return;
        }

        if (link) {
            link.href = `/commodity/${encodeURIComponent(mover.id || '')}`;
            link.removeAttribute('aria-disabled');
            link.removeAttribute('tabindex');
        }
        if (value) value.textContent = this.formatPercent(mover.change_percent, { signed });
        if (name) name.textContent = mover.name || fallback;
    },

    buildCategoryUrl: function (categorySlug, activeRange) {
        const params = new URLSearchParams();
        if (categorySlug) params.set('category', categorySlug);
        if (activeRange) params.set('range', activeRange);

        const currentView = this.normalizeViewMode(new URLSearchParams(window.location.search).get('view'))
            || this.normalizeViewMode(BW.Settings?.getViewMode?.());
        if (currentView) params.set('view', currentView);

        const query = params.toString();
        return query ? `/?${query}` : '/';
    },

    getActiveCategory: function () {
        return String(new URLSearchParams(window.location.search).get('category') || '')
            .trim()
            .toLowerCase();
    },

    updateCategoryAllLink: function (activeRange) {
        const allLink = document.getElementById('market-pulse-all-link');
        if (!allLink) return;

        allLink.href = this.buildCategoryUrl('', activeRange);
        if (this.getActiveCategory()) {
            allLink.removeAttribute('aria-current');
        } else {
            allLink.setAttribute('aria-current', 'page');
        }
    },

    renderCategoryPulse: function (categories, activeRange) {
        const container = document.getElementById('market-pulse-categories');
        if (!container) return;

        container.innerHTML = '';
        if (!Array.isArray(categories) || categories.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'rounded-lg border border-brand-black-60/15 dark:border-white/10 p-3 text-xs font-bold text-brand-black-60';
            empty.textContent = 'No category data';
            container.appendChild(empty);
            return;
        }

        const activeCategory = this.getActiveCategory();
        categories.forEach(category => {
            const slug = String(category.slug || '').trim().toLowerCase();
            const item = document.createElement('a');
            item.href = this.buildCategoryUrl(slug, activeRange);
            const isActive = slug && slug === activeCategory;
            item.className = isActive
                ? 'group/category block rounded-lg border border-brand-oxford dark:border-brand-teal bg-brand-oxford/5 dark:bg-brand-teal/5 p-3 transition-colors'
                : 'group/category block rounded-lg border border-brand-black-60/15 dark:border-white/10 p-3 hover:border-brand-oxford dark:hover:border-brand-teal transition-colors';
            item.dataset.category = slug;
            if (isActive) item.setAttribute('aria-current', 'page');

            const upPercent = Math.max(0, Math.min(100, this.toFiniteNumber(category.breadth_percent) ?? 0));
            const flatPercent = Math.max(0, Math.min(100, this.toFiniteNumber(category.flat_percent) ?? 0));
            const downPercent = Math.max(0, Math.min(100, this.toFiniteNumber(category.down_percent) ?? 0));
            const categoryName = category.name || this.getCategoryName(slug);
            const upCount = Number(category.up_count || 0);
            const flatCount = Number(category.flat_count || 0);
            const downCount = Number(category.down_count || 0);
            const totalCount = Number(category.total || 0);

            item.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-bold text-brand-black-80 dark:text-white truncate">${this.escapeHtml(categoryName)}</span>
                    <span class="text-[10px] font-semibold tabular-nums text-brand-black-60">
                        ${upCount} / ${flatCount} / ${downCount}
                    </span>
                </div>
                <div class="mt-2 flex h-1.5 rounded-full bg-brand-black-60/10 dark:bg-white/10 overflow-hidden"
                    aria-label="${this.escapeHtml(categoryName)} distribution: ${upCount} up, ${flatCount} flat, ${downCount} down">
                    <div class="h-full" style="width: ${upPercent}%; background-color: var(--color-up);"></div>
                    <div class="h-full" style="width: ${flatPercent}%; background-color: var(--theme-border);"></div>
                    <div class="h-full" style="width: ${downPercent}%; background-color: var(--color-down);"></div>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[10px] text-brand-black-60">
                    <span>${totalCount} benchmarks</span>
                    <span>up / flat / down</span>
                </div>
            `;
            container.appendChild(item);
        });
    },

    updateMarketPulse: function (payload, { range } = {}) {
        const summary = Array.isArray(payload)
            ? this.summarizeMarketPulse(payload)
            : (payload && typeof payload === 'object' ? payload : this.summarizeMarketPulse([]));

        const activeRange = range || new URLSearchParams(window.location.search).get('range') || 'ALL';

        this.setText('market-pulse-headline', summary.headline || 'No benchmarks loaded');
        this.setText('market-pulse-range', this.rangeLabels[activeRange] || 'All observations');
        this.setText('market-pulse-total', String(summary.total ?? 0));
        this.setText('market-pulse-up', String(summary.up_count ?? 0));
        this.setText('market-pulse-down', String(summary.down_count ?? 0));
        this.setText('market-pulse-breadth', String(summary.breadth_percent ?? 0));
        this.setText('market-pulse-flat', String(summary.flat_count ?? 0));
        this.setText('market-pulse-latest-date', summary.latest_date || 'No date');
        this.setText('market-pulse-latest-count', String(summary.latest_count ?? 0));
        this.setText('market-pulse-daily', String(summary.daily_count ?? 0));
        this.setText('market-pulse-monthly', String(summary.monthly_count ?? 0));
        this.updateCategoryAllLink(activeRange);
        this.renderCategoryPulse(summary.categories, activeRange);

        this.updateMover({
            prefix: 'rise',
            mover: summary.biggest_up,
            fallback: 'No positive moves',
            signed: true
        });
        this.updateMover({
            prefix: 'drop',
            mover: summary.biggest_down,
            fallback: 'No negative moves',
            signed: false
        });
    },

    quickFindState: {
        query: '',
        filter: 'all'
    },

    quickFilterActiveClass: 'quick-filter-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg transition-all theme-surface theme-text',
    quickFilterIdleClass: 'quick-filter-btn min-h-[44px] px-3 sm:px-4 text-xs font-bold rounded-lg text-brand-black-60 hover:text-brand-black-80 dark:hover:text-white hover:bg-brand-black-60/5 dark:hover:bg-white/5 transition-all',

    getQuickFindScope: function () {
        const grid = document.getElementById('grid-view');
        const compact = document.getElementById('compact-view');
        if (grid && !grid.classList.contains('hidden')) {
            return {
                type: 'grid',
                items: Array.from(document.querySelectorAll('#grid-cards-container > a'))
            };
        }
        if (compact && !compact.classList.contains('hidden')) {
            return {
                type: 'compact',
                items: Array.from(document.querySelectorAll('#table-body > tr'))
            };
        }
        return { type: 'none', items: [] };
    },

    getQuickFindText: function (item) {
        if (!item) return '';
        const fields = [
            item.dataset.name,
            item.dataset.category,
            item.dataset.currency,
            item.dataset.unit,
            item.dataset.date
        ];
        return fields.filter(Boolean).join(' ').toLowerCase();
    },

    getQuickFindDirection: function (item) {
        const explicitDirection = String(item?.dataset?.direction || '').toLowerCase();
        if (['up', 'down', 'flat'].includes(explicitDirection)) return explicitDirection;

        const change = this.toFiniteNumber(item?.dataset?.changePct);
        if (change > 0) return 'up';
        if (change < 0) return 'down';
        return 'flat';
    },

    getQuickFindFrequency: function (item) {
        const explicitFrequency = String(item?.dataset?.frequency || '').toLowerCase();
        if (['daily', 'monthly'].includes(explicitFrequency)) return explicitFrequency;
        return item?.querySelector('.freq-badge')?.textContent?.trim() === 'D' ? 'daily' : 'monthly';
    },

    matchesQuickFind: function (item) {
        const { query, filter } = this.quickFindState;
        const normalizedQuery = query.trim().toLowerCase();
        const textMatch = !normalizedQuery || this.getQuickFindText(item).includes(normalizedQuery);
        if (!textMatch) return false;

        if (filter === 'all') return true;
        if (filter === 'daily' || filter === 'monthly') {
            return this.getQuickFindFrequency(item) === filter;
        }
        return this.getQuickFindDirection(item) === filter;
    },

    setQuickFindItemVisibility: function (item, visible) {
        if (!item) return;
        item.classList.toggle('quick-find-hidden', !visible);
        item.style.display = visible ? '' : 'none';
    },

    summarizeQuickFindItems: function (items) {
        return items.reduce((summary, item) => {
            const direction = this.getQuickFindDirection(item);
            const frequency = this.getQuickFindFrequency(item);

            if (direction === 'up') summary.up += 1;
            if (direction === 'down') summary.down += 1;
            if (direction === 'flat') summary.flat += 1;
            if (frequency === 'daily') summary.daily += 1;
            if (frequency === 'monthly') summary.monthly += 1;
            return summary;
        }, { up: 0, down: 0, flat: 0, daily: 0, monthly: 0 });
    },

    updateQuickFindSummary: function (visibleItems) {
        const summary = this.summarizeQuickFindItems(visibleItems);
        this.setText('quick-find-up', String(summary.up));
        this.setText('quick-find-down', String(summary.down));
        this.setText('quick-find-daily', String(summary.daily));
        this.setText('quick-find-monthly', String(summary.monthly));
    },

    updateQuickFindControls: function () {
        document.querySelectorAll('[data-quick-filter]').forEach(button => {
            const isActive = button.dataset.quickFilter === this.quickFindState.filter;
            button.className = isActive ? this.quickFilterActiveClass : this.quickFilterIdleClass;
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        const reset = document.getElementById('quick-find-reset');
        if (reset) {
            const hasFilter = this.quickFindState.filter !== 'all' || this.quickFindState.query.trim() !== '';
            reset.classList.toggle('hidden', !hasFilter);
        }

        const exportButton = document.getElementById('quick-find-export');
        if (exportButton) {
            const visibleCount = this.getVisibleQuickFindItems().length;
            exportButton.disabled = visibleCount === 0;
            exportButton.setAttribute('aria-disabled', visibleCount === 0 ? 'true' : 'false');
            exportButton.classList.toggle('opacity-50', visibleCount === 0);
            exportButton.classList.toggle('cursor-not-allowed', visibleCount === 0);
        }
    },

    applyQuickFind: function () {
        const scope = this.getQuickFindScope();
        let visibleCount = 0;
        const visibleItems = [];

        scope.items.forEach(item => {
            const visible = this.matchesQuickFind(item);
            this.setQuickFindItemVisibility(item, visible);
            if (visible) {
                visibleCount += 1;
                visibleItems.push(item);
            }
        });

        const count = document.getElementById('quick-find-count');
        if (count) {
            const totalCount = scope.items.length;
            count.textContent = totalCount === visibleCount
                ? `${visibleCount} shown`
                : `${visibleCount}/${totalCount} shown`;
        }

        const empty = document.getElementById('quick-find-empty');
        if (empty) {
            empty.classList.toggle('hidden', scope.items.length === 0 || visibleCount > 0);
        }

        this.updateQuickFindSummary(visibleItems);
        this.updateQuickFindControls();
    },

    setQuickFindFilter: function (filter) {
        this.quickFindState.filter = filter || 'all';
        this.applyQuickFind();
    },

    resetQuickFind: function () {
        this.quickFindState.query = '';
        this.quickFindState.filter = 'all';

        const input = document.getElementById('quick-find-input');
        if (input) input.value = '';

        this.applyQuickFind();
    },

    getVisibleQuickFindItems: function () {
        return this.getQuickFindScope().items.filter(item => item.style.display !== 'none');
    },

    escapeCsvField: function (value) {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
    },

    getQuickFindExportRow: function (item) {
        const price = item.dataset.price || item.querySelector('.price-value')?.dataset?.raw || '';
        const change = item.dataset.changeAbs || item.querySelector('.chg-cell')?.dataset?.value || '';
        const changePct = item.dataset.changePct || item.querySelector('.pct-cell')?.dataset?.value || '';

        return {
            id: item.dataset.id || '',
            name: item.dataset.name || item.querySelector('.commodity-name')?.textContent?.trim() || '',
            category: item.dataset.category || item.querySelector('.commodity-category')?.textContent?.trim() || '',
            price,
            currency: item.dataset.currency || item.querySelector('.price-currency')?.textContent?.trim() || '',
            change,
            change_percent: changePct,
            date: item.dataset.date || item.querySelector('.updated-cell')?.dataset?.raw || '',
            frequency: this.getQuickFindFrequency(item),
            direction: this.getQuickFindDirection(item)
        };
    },

    buildQuickFindCsvContent: function (items) {
        const headers = ['ID', 'Benchmark', 'Category', 'Price', 'Currency', 'Change', 'Change %', 'Date', 'Frequency', 'Direction'];
        const lines = [headers.join(',')];

        items.forEach(item => {
            const row = this.getQuickFindExportRow(item);
            lines.push([
                row.id,
                row.name,
                row.category,
                row.price,
                row.currency,
                row.change,
                row.change_percent,
                row.date,
                row.frequency,
                row.direction
            ].map(value => this.escapeCsvField(value)).join(','));
        });

        return `${lines.join('\n')}\n`;
    },

    exportQuickFindCsv: function () {
        const items = this.getVisibleQuickFindItems();
        if (items.length === 0) return;

        const csvContent = this.buildQuickFindCsvContent(items);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `benchmarkwatcher_visible_${new Date().toISOString().split('T')[0]}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    initQuickFind: function () {
        const input = document.getElementById('quick-find-input');
        if (input && !input.hasAttribute('data-quick-find-bound')) {
            input.addEventListener('input', event => {
                this.quickFindState.query = event.target.value || '';
                this.applyQuickFind();
            });
            input.setAttribute('data-quick-find-bound', 'true');
        }

        document.querySelectorAll('[data-quick-filter]').forEach(button => {
            if (button.hasAttribute('data-quick-find-bound')) return;
            button.addEventListener('click', () => {
                this.setQuickFindFilter(button.dataset.quickFilter || 'all');
            });
            button.setAttribute('data-quick-find-bound', 'true');
        });

        const reset = document.getElementById('quick-find-reset');
        if (reset && !reset.hasAttribute('data-quick-find-bound')) {
            reset.addEventListener('click', () => this.resetQuickFind());
            reset.setAttribute('data-quick-find-bound', 'true');
        }

        const exportButton = document.getElementById('quick-find-export');
        if (exportButton && !exportButton.hasAttribute('data-quick-find-bound')) {
            exportButton.addEventListener('click', () => this.exportQuickFindCsv());
            exportButton.setAttribute('data-quick-find-bound', 'true');
        }

        this.applyQuickFind();
    },

    // Initialize view mode
    init: function () {
        // R2: Auto-detect device class and view mode on first visit
        if (window.BW && BW.Responsive) {
            BW.Responsive.autoApply();
        }

        const serverView = this.normalizeViewMode(document.getElementById('index-page-state')?.dataset?.activeView);
        const storedView = this.normalizeViewMode(BW.Settings.getViewMode());
        const params = new URLSearchParams(window.location.search);
        const explicitView = this.normalizeViewMode(params.get('view'));

        // If server and client preference diverge without explicit view param,
        // reload once with preferred view so the server renders the right markup.
        if (
            window.location.pathname === '/' &&
            !explicitView &&
            !!serverView &&
            !!storedView &&
            serverView !== storedView
        ) {
            const redirectUrl = new URL(window.location.href);
            redirectUrl.searchParams.set('view', storedView);
            window.location.replace(redirectUrl.toString());
            return;
        }

        const viewMode = explicitView || serverView || storedView || 'grid';
        BW.Settings.setViewMode(viewMode);

        // View containers (show/hide the active view)
        const gridContainer = document.getElementById('grid-view');
        const compactContainer = document.getElementById('compact-view');
        const indicator = document.getElementById('view-indicator');

        // Show correct container, hide the other
        if (viewMode === 'compact') {
            if (gridContainer) gridContainer.classList.add('hidden');
            if (compactContainer) compactContainer.classList.remove('hidden');
            if (indicator) indicator.textContent = 'Display: Compact';
        } else {
            if (gridContainer) gridContainer.classList.remove('hidden');
            if (compactContainer) compactContainer.classList.add('hidden');
            if (indicator) indicator.textContent = 'Display: Standard Grid';
        }

        // View toggle buttons (in settings modal)
        const gridBtn = document.getElementById('view-grid');
        const compactBtn = document.getElementById('view-compact');

        // Apply accessible state attributes so CSS can style active state
        if (gridBtn) {
            if (viewMode === 'grid') {
                gridBtn.setAttribute('data-active', 'true');
                gridBtn.setAttribute('aria-pressed', 'true');
            } else {
                gridBtn.removeAttribute('data-active');
                gridBtn.setAttribute('aria-pressed', 'false');
            }
        }
        if (compactBtn) {
            if (viewMode === 'compact') {
                compactBtn.setAttribute('data-active', 'true');
                compactBtn.setAttribute('aria-pressed', 'true');
            } else {
                compactBtn.removeAttribute('data-active');
                compactBtn.setAttribute('aria-pressed', 'false');
            }
        }

        // Attach click handlers defensively (only if not already bound via onclick)
        if (gridBtn && !gridBtn.hasAttribute('data-click-bound') && !gridBtn.hasAttribute('onclick')) {
            gridBtn.addEventListener('click', () => {
                BW.Settings.setViewMode('grid');
                if (window.location.pathname === '/') window.location.reload();
            });
            gridBtn.setAttribute('data-click-bound', 'true');
        }
        if (compactBtn && !compactBtn.hasAttribute('data-click-bound') && !compactBtn.hasAttribute('onclick')) {
            compactBtn.addEventListener('click', () => {
                BW.Settings.setViewMode('compact');
                if (window.location.pathname === '/') window.location.reload();
            });
            compactBtn.setAttribute('data-click-bound', 'true');
        }

        this.initQuickFind();
    }
};

// Auto-initialize on DOM ready
if (!window.__bwIndexDomReadyBound) {
    window.__bwIndexDomReadyBound = true;
    const runIndexInit = function () {
        BW.Index.init();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runIndexInit);
    } else {
        runIndexInit();
    }
}
