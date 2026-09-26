/* Navigation and command search join the public reference desk and local research. */
(function () {
    'use strict';
    window.BW = window.BW || {};
    const $ = id => document.getElementById(id);
    const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
    const normalClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    const names = { energy: 'Energy', metal: 'Metals', precious: 'Precious metals', agricultural: 'Agriculture', index: 'Indices' };
    const Workspace = {
        catalog: [], catalogLoaded: false, loading: null, loadFailed: false, current: 'benchmarks', searchTrigger: null,
        init() {
            try { this.catalog = JSON.parse($('workspace-benchmarks')?.textContent || '[]'); } catch (_) { this.catalog = []; }
            this.renderOverview();
            document.addEventListener('click', event => {
                if (!normalClick(event)) return;
                const target = event.target.closest('a[data-workspace], a[data-workspace-category], a[data-benchmark-id]');
                if (!target) return;
                if (target.dataset.benchmarkId && BW.BenchmarkDetail) { event.preventDefault(); BW.BenchmarkDetail.open(target.dataset.benchmarkId, target); return; }
                if (!$('index-page-state')) return;
                if (target.dataset.workspaceCategory !== undefined) {
                    if (!BW.TableWorkspace?.ready) return;
                    event.preventDefault(); const url = new URL(location.href); url.searchParams.delete('workspace'); url.searchParams.set('category', target.dataset.workspaceCategory); this.go(url); return;
                }
                if (target.dataset.workspace === 'watchlist' && !BW.TableWorkspace?.ready) return;
                event.preventDefault(); const url = new URL(location.href); url.searchParams.delete('category');
                if (target.dataset.workspace === 'benchmarks') url.searchParams.delete('workspace'); else url.searchParams.set('workspace', target.dataset.workspace);
                this.go(url);
            });
            document.addEventListener('bw:watch-toggle', event => BW.BenchmarkDetail?.toggleWatch(event.detail?.id));
            document.addEventListener('bw:compare', event => BW.BenchmarkDetail?.compare(event.detail?.ids || [], event.detail?.trigger));
            document.addEventListener('bw:research-add', event => {
                const ids = new Set(event.detail?.ids || []);
                const records = this.catalog.filter(c => ids.has(c.id));
                BW.BenchmarkDetail?.close(); BW.ResearchWorkspace?.addBenchmarks(records);
            });
            document.addEventListener('bw:research-open', () => {
                if (!$('research-workspace')) { location.href = '/?workspace=research'; return; }
                BW.BenchmarkDetail?.close(); const url = new URL(location.href); url.searchParams.set('workspace', 'research'); this.go(url, false);
            });
            document.addEventListener('bw:research-count', event => { if ($('bw-research-count')) $('bw-research-count').textContent = event.detail.count; this.openRequestedEntry(); });
            document.addEventListener('bw:watchlist-change', event => {
                if ($('bw-watch-count')) $('bw-watch-count').textContent = event.detail.ids.length;
                BW.TableWorkspace?.setWatchlist(event.detail.ids); this.renderOverview();
            });
            document.addEventListener('bw:table-ready', () => { this.restoreWatchlist(); this.navigate(false, true); });
            document.addEventListener('DOMContentLoaded', () => this.restoreWatchlist(), { once: true });
            document.addEventListener('bw:table-data', event => {
                if (Array.isArray(event.detail?.commodities)) this.mergeCatalog(event.detail.commodities);
            });
            document.addEventListener('bw:table-view-change', event => {
                // A named view owns its category; keep the rail and URL in sync without reapplying filters.
                if (this.navigating || this.current === 'research') return;
                const category = event.detail?.state?.filters?.category || '';
                const url = new URL(location.href); if (category) url.searchParams.set('category', category); else url.searchParams.delete('category');
                history.replaceState(null, '', url); this.updateNavigation(category);
            });
            window.addEventListener('popstate', () => {
                BW.BenchmarkDetail?.close(); this.navigate(true);
                const range = new URLSearchParams(location.search).get('range') || '1Y';
                if (['1W','1M','3M','6M','1Y','ALL'].includes(range)) {
                    if (BW.TableWorkspace?.ready && BW.TableWorkspace.current.range !== range) BW.CompactTable.setDataRange(range, { history: 'none' });
                    else if (BW.GridView && $('index-page-state')?.dataset.activeView === 'grid' && BW.GridView.getSettings().dataRange !== range) BW.GridView.setDataRange(range, { history: 'none' });
                }
            });
            $('bw-about-data')?.addEventListener('click', event => {
                event.preventDefault(); const url = new URL(location.href); url.searchParams.delete('workspace'); this.go(url); $('market-pulse').open = true; $('market-pulse').scrollIntoView({ behavior: 'instant', block: 'start' }); $('market-pulse').querySelector('summary').focus();
            });
            this.initSearch(); this.navigate(false, true);
            if ($('index-page-state')) this.loadCatalog();
        },
        go(url, focus = true) { BW.BenchmarkDetail?.close(); if (url.href !== location.href) history.pushState(null, '', url); this.navigate(focus); },
        navigate(focus, initial = false) {
            if (!$('index-page-state')) return;
            this.navigating = true;
            const params = new URLSearchParams(location.search);
            const requested = params.get('workspace'); this.current = ['research','watchlist'].includes(requested) ? requested : 'benchmarks';
            const research = this.current === 'research';
            if (!research) $('research-workspace').querySelectorAll('dialog[open]').forEach(dialog => BW.ResearchWorkspace?.closeDialog(dialog));
            $('benchmark-workspace').hidden = research; $('research-workspace').hidden = !research;
            if (!research && BW.TableWorkspace?.ready) {
                if (!initial || this.current === 'watchlist') BW.TableWorkspace.setWatchOnly(this.current === 'watchlist');
                if (!initial || params.has('category')) BW.TableWorkspace.setCategory(params.get('category') || '');
            }
            $('bw-page-title').textContent = this.current === 'watchlist' ? 'Your watchlist' : 'Commodity benchmarks';
            $('bw-page-description').textContent = this.current === 'watchlist' ? 'The reference series you want to keep close.' : 'A clearer view of energy, metals and agriculture.';
            $('bw-table-heading').textContent = this.current === 'watchlist' ? 'Saved benchmarks' : 'Explore benchmarks';
            this.updateNavigation(params.get('category') || ''); this.renderOverview();
            this.navigating = false;
            if (focus) { const heading = (research ? $('research-workspace') : $('benchmark-workspace')).querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
        },
        restoreWatchlist() {
            const ids = BW.BenchmarkDetail?.getWatchlist() || [];
            if ($('bw-watch-count')) $('bw-watch-count').textContent = ids.length;
            BW.TableWorkspace?.setWatchlist(ids); this.renderOverview();
        },
        updateNavigation(category) {
            document.querySelectorAll('[data-workspace]').forEach(link => { if (link.dataset.workspace === this.current && !(this.current === 'benchmarks' && category)) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
            document.querySelectorAll('[data-workspace-category]').forEach(link => { if (this.current === 'benchmarks' && link.dataset.workspaceCategory === category) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
        },
        mergeCatalog(records) {
            const map = new Map(this.catalog.map(c => [c.id, c])); records.forEach(c => { if (c && typeof c.id === 'string') map.set(c.id, { ...map.get(c.id), ...c, source: c.source_name || c.source || '' }); });
            this.catalog = [...map.values()]; this.renderOverview(); this.openRequestedEntry();
            if ($('bw-search-dialog')?.open) this.renderSearch();
        },
        openRequestedEntry() {
            if (!$('research-workspace') || !BW.ResearchWorkspace?.root) return;
            const url = new URL(location.href), id = url.searchParams.get('entry'), benchmarkId = url.searchParams.get('add_benchmark');
            const requestedIds = new Set((benchmarkId || '').split(',').slice(0,4));
            const benchmarks = this.catalog.filter(c => requestedIds.has(c.id));
            if (!id && (!benchmarks.length || (!this.catalogLoaded && benchmarks.length !== requestedIds.size))) return;
            // Consume before opening: rendering Research dispatches count events again.
            url.searchParams.delete('entry'); url.searchParams.delete('add_benchmark'); history.replaceState(null, '', url);
            if (id) BW.ResearchWorkspace.focusEntry(id); else BW.ResearchWorkspace.addBenchmarks(benchmarks);
        },
        loadCatalog() {
            if (this.catalogLoaded) return Promise.resolve(); if (this.loading) return this.loading;
            this.loadFailed = false;
            this.loading = fetch('/api/commodities?include_history=false', { headers: { Accept: 'application/json' } }).then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); }).then(payload => { if (!Array.isArray(payload.data)) throw new Error('Invalid response'); this.mergeCatalog(payload.data); this.catalogLoaded = true; this.openRequestedEntry(); }).catch(() => { this.loadFailed = true; }).finally(() => { this.loading = null; if ($('bw-search-dialog')?.open) this.renderSearch(); });
            return this.loading;
        },
        renderOverview() {
            const root = $('bw-overview'); if (!root) return;
            let records = this.catalog;
            if (this.current === 'watchlist') { const watched = new Set(BW.BenchmarkDetail?.getWatchlist() || []); records = records.filter(c => watched.has(c.id)); }
            const preferred = ['crude_oil_brent', 'gold', 'copper'];
            const selected = [...records].sort((a,b) => { const ai = preferred.indexOf(a.id), bi = preferred.indexOf(b.id); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi); }).slice(0,3);
            root.replaceChildren(); root.hidden = !selected.length;
            selected.forEach(c => {
                const card = el('a', undefined, 'bw-observation'); card.href = '/commodity/' + encodeURIComponent(c.id); card.dataset.benchmarkId = c.id;
                const heading = el('div', undefined, 'bw-observation-heading'); heading.append(el('span', c.name), el('span','↗')); card.append(heading);
                const value = el('div',undefined,'bw-observation-value'); value.append(el('strong', typeof c.price === 'number' && Number.isFinite(c.price) ? new Intl.NumberFormat('en-US',{ maximumFractionDigits:2, minimumFractionDigits:2 }).format(c.price) : '—'), el('span', [c.currency,c.unit].filter(Boolean).join(' / '))); card.append(value,el('div', c.date ? 'Observed ' + c.date : 'Observation unavailable','bw-observation-date')); root.append(card);
            });
        },
        initSearch() {
            const dialog = $('bw-search-dialog'); if (!dialog) return;
            if (!/Mac|iPhone|iPad/.test(navigator.platform)) $('bw-search-shortcut').textContent = 'Ctrl K';
            const open = () => { if (document.querySelector('dialog[open]') || document.body.classList.contains('bw-detail-open')) return; this.searchTrigger = document.activeElement; dialog.showModal(); $('bw-global-query').focus(); this.renderSearch(); this.loadCatalog(); };
            $('bw-search-trigger').addEventListener('click',open);
            $('bw-search-close').addEventListener('click',()=>dialog.close());
            dialog.addEventListener('close',()=>{ if (this.searchTrigger?.isConnected && !document.querySelector('dialog[open]') && !document.body.classList.contains('bw-detail-open')) this.searchTrigger.focus(); });
            dialog.addEventListener('click', event => { if (event.target === dialog) { const rect=dialog.getBoundingClientRect(); if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) dialog.close(); } });
            $('bw-global-query').addEventListener('input',()=>this.renderSearch());
            document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) { event.preventDefault(); if (dialog.open) dialog.close(); else open(); } });
            dialog.addEventListener('keydown', event => {
                if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
                const results = [...$('bw-search-results').querySelectorAll('a,button')]; if (!results.length) return;
                const index = results.indexOf(document.activeElement); event.preventDefault(); results[(index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length].focus();
            });
        },
        renderSearch() {
            const root=$('bw-search-results'); if (!root) return;
            const query = $('bw-global-query').value.trim().toLocaleLowerCase();
            const matches = text => String(text || '').toLocaleLowerCase().includes(query);
            const benchmarks = this.catalog.filter(c => matches([c.name,c.category,c.id,c.source].join(' ')));
            const research = (BW.ResearchWorkspace?.getSearchItems() || []).filter(c => matches([c.title,c.status,...c.tags,c.notes].join(' ')));
            root.replaceChildren();
            $('bw-search-status').textContent = `${benchmarks.length} benchmarks · ${research.length} research entries` + (this.loading ? ' · Loading all benchmarks…' : '');
            if (this.loadFailed) { const retry=el('button','Some benchmarks could not load. Retry','bw-search-result'); retry.type='button'; retry.addEventListener('click',()=>this.loadCatalog()); root.append(retry); }
            if (!benchmarks.length && !research.length) root.append(el('p','No matches. Try a benchmark name or a word from your notes.','bw-search-result'));
            if (benchmarks.length) root.append(el('h3', query ? 'Benchmarks' : 'Explore benchmarks','bw-search-group'));
            benchmarks.slice(0,30).forEach(c => { const link=el('a',undefined,'bw-search-result'); link.href='/commodity/'+encodeURIComponent(c.id); link.append(el('span',c.name),el('small', names[c.category] || c.category)); link.addEventListener('click',event=>{ if(!normalClick(event)||!BW.BenchmarkDetail)return; event.preventDefault(); $('bw-search-dialog').close(); BW.BenchmarkDetail.open(c.id,$('bw-search-trigger')); }); root.append(link); });
            if (research.length) root.append(el('h3','Your research','bw-search-group'));
            research.slice(0,20).forEach(c=>{ const button=el('button',undefined,'bw-search-result'); button.type='button'; button.append(el('span',c.title || 'Untitled entry'),el('small',c.status)); button.addEventListener('click',()=>{ $('bw-search-dialog').close(); if ($('research-workspace')) BW.ResearchWorkspace.focusEntry(c.id); else location.href='/?workspace=research&entry='+encodeURIComponent(c.id); }); root.append(button); });
        }
    };
    BW.Workspace = Workspace;
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',()=>Workspace.init(),{once:true}); else Workspace.init();
})();
