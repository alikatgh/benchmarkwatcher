/* Browse saved stock histories without replacing the company list or calling providers. */
(function () {
    'use strict';
    const root = document.getElementById('stock-workspace');
    if (!root || !window.BW?.ReferencePage || !window.fetch || !window.AbortController) return;
    const $ = selector => root.querySelector(selector);
    const list = $('#stock-list'), host = $('#stock-detail-host'), search = $('#stock-search');
    const scroller = $('.stock-list-scroll'), picker = $('#stock-navigator');
    const status = $('#stock-navigation-status'), retry = $('#stock-retry'), fallback = $('#stock-open-page');
    const previous = $('#stock-previous'), next = $('#stock-next'), sortControl = $('#stock-sort');
    if (!list || !host || !search || !scroller || !picker) return;
    const rows = new Map(Array.from(list.querySelectorAll('[data-stock-id]')).map(row => [row.dataset.stockId, row]));
    const desktop = window.matchMedia('(min-width: 901px)');
    const collator = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
    const cache = new Map(), removers = [];
    const MAX_FRAGMENT = 1024 * 1024, MAX_CACHE = 2 * MAX_FRAGMENT, MAX_ENTRIES = 6, TTL = 300000;
    let cacheBytes = 0, generation = 0, pending = null, failed = null, disposed = false, scrollFrame = null;
    const oldScrollRestoration = history.scrollRestoration;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let current = host.querySelector('#market-detail-panel')?.dataset.instrumentId || null;
    let displayedURL = new URL(location.href), chart = BW.ReferencePage.mount(host);
    let visible = [], view = 'all', sort = 'name', recentOrder = [];
    function stored(key, limit) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && rows.has(id)))].slice(0, limit) : [];
        } catch (_) { return []; }
    }
    let favorites = new Set(stored('bw.stock.watchlist.v1', 100)), recent = stored('bw.stock.recent.v1', 12);
    function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
    function remember(id) {
        if (!rows.has(id)) return;
        recent = [id, ...recent.filter(item => item !== id)].slice(0, 12);
        saveLocal('bw.stock.recent.v1', recent);
    }
    function listen(node, type, fn, options) {
        node.addEventListener(type, fn, options);
        removers.push(() => node.removeEventListener(type, fn, options));
    }
    function idFrom(url) {
        if (url.origin !== location.origin) return null;
        const match = url.pathname.match(/^\/stocks\/([^/]+)\/?$/);
        if (!match) return null;
        try { const id = decodeURIComponent(match[1]); return rows.has(id) ? id : null; } catch (_) { return null; }
    }
    function applyQuery(url) {
        const q = search.value.trim();
        if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
        if (view !== 'all') url.searchParams.set('view', view); else url.searchParams.delete('view');
        if (sort !== 'name') url.searchParams.set('sort', sort); else url.searchParams.delete('sort');
        return url;
    }
    function selectionURL(id) {
        return applyQuery(new URL(rows.get(id).querySelector('[data-stock-link]').href));
    }
    function state() {
        return {id:current, query:search.value, view, sort, recentOrder:[...recentOrder], navScroll:scroller.scrollTop,
            panelScroll:host.scrollTop, windowScroll:window.scrollY};
    }
    function saveHistory(url = new URL(location.href)) {
        history.replaceState({...history.state, bwStocks:state()}, '', url);
    }
    function readView(url, saved) {
        search.value = (saved?.query ?? url.searchParams.get('q') ?? '').slice(0, 100);
        const wantedView = saved?.view ?? url.searchParams.get('view');
        view = ['watchlist','recent'].includes(wantedView) ? wantedView : 'all';
        recentOrder = Array.isArray(saved?.recentOrder) ? [...new Set(saved.recentOrder.filter(id => rows.has(id)))].slice(0,12) : [...recent];
        sort = (saved?.sort ?? url.searchParams.get('sort')) === 'symbol' ? 'symbol' : 'name';
        sortControl.value = sort;
    }
    function star(button, id) {
        const selected = favorites.has(id), name = rows.get(id)?.dataset.stockName || 'company';
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${name} ${selected ? 'from' : 'to'} watchlist`);
        button.title = selected ? 'Remove from watchlist' : 'Add to watchlist';
        button.querySelector('span').textContent = selected ? '★' : '☆';
    }
    function render() {
        const query = search.value.trim().toLocaleLowerCase();
        const source = root.dataset.stockSource;
        const ordered = Array.from(rows.values()).sort((a,b) => view === 'recent'
            ? ((recentOrder.indexOf(a.dataset.stockId) < 0 ? 100 : recentOrder.indexOf(a.dataset.stockId)) - (recentOrder.indexOf(b.dataset.stockId) < 0 ? 100 : recentOrder.indexOf(b.dataset.stockId))) || collator.compare(a.dataset.stockName,b.dataset.stockName)
            : collator.compare(a.dataset[sort === 'symbol' ? 'stockSymbol' : 'stockName'],b.dataset[sort === 'symbol' ? 'stockSymbol' : 'stockName']));
        visible = [];
        let cursor = list.firstElementChild;
        for (const row of ordered) {
            if (row !== cursor) list.insertBefore(row, cursor); else cursor = cursor.nextElementSibling;
            const id = row.dataset.stockId;
            const match = (!source || row.dataset.stockSource === source) && (row.dataset.stockSearch || '').toLocaleLowerCase().includes(query)
                && (view === 'all' || (view === 'watchlist' ? favorites.has(id) : recentOrder.includes(id)));
            row.hidden = !match;
            if (match) visible.push(id);
            row.classList.toggle('is-selected', id === current);
            const link = row.querySelector('[data-stock-link]');
            if (id === current) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
            link.href = selectionURL(id).href;
            star(row.querySelector('[data-stock-star]'), id);
        }
        root.querySelectorAll('[data-stock-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stockView === view)));
        $('#stock-count').textContent = `${visible.length} ${visible.length === 1 ? 'company' : 'companies'}`;
        $('#stock-empty').hidden = visible.length > 0;
        $('#stock-empty-title').textContent = query || source ? 'No matching companies' : view === 'watchlist' ? 'Your watchlist is empty' : view === 'recent' ? 'No recently viewed companies' : 'No saved companies yet';
        $('#stock-empty-description').textContent = query || source ? 'Try another company name or symbol.' : view === 'watchlist' ? 'Select a star to keep a company here.' : 'Choose a company from All to explore its history.';
        const index = visible.indexOf(current), record = rows.get(current);
        $('#stock-position').textContent = index < 0 ? (current ? 'Not in this view' : '') : `${index + 1} of ${visible.length}`;
        previous.disabled = index <= 0;
        next.disabled = !visible.length || index === visible.length - 1;
        $('[data-stock-current-symbol]').textContent = record?.dataset.stockSymbol || 'Stocks';
        $('[data-stock-current-name]').textContent = record?.dataset.stockSymbol || 'Choose a company';
        const currentStar = $('#stock-current-star');
        currentStar.disabled = !record;
        star(currentStar, current);
    }
    function filter() {
        render(); saveHistory(applyQuery(new URL(location.href)));
        displayedURL = applyQuery(displayedURL);
    }
    function toggleStar(id) {
        if (!rows.has(id)) return;
        const focusedRow = document.activeElement?.closest('[data-stock-id]');
        const focusedIndex = focusedRow ? visible.indexOf(focusedRow.dataset.stockId) : -1;
        if (favorites.has(id)) favorites.delete(id); else if (favorites.size < 100) favorites.add(id);
        saveLocal('bw.stock.watchlist.v1', [...favorites]); render();
        if (focusedRow?.hidden) {
            const neighbor = rows.get(visible[Math.min(focusedIndex, visible.length - 1)]);
            (neighbor?.querySelector('[data-stock-star]') || search).focus();
        }
    }
    function cacheKey(url) { const key = new URL(url); key.hash = ''; return key.href; }
    function putCache(url, html) {
        const key = cacheKey(url), bytes = new TextEncoder().encode(html).length;
        if (bytes > MAX_FRAGMENT) return;
        if (cache.has(key)) {cacheBytes -= cache.get(key).bytes; cache.delete(key);}
        cache.set(key, {html, bytes, at:Date.now()}); cacheBytes += bytes;
        while (cache.size > MAX_ENTRIES || cacheBytes > MAX_CACHE) {
            const first = cache.keys().next().value; cacheBytes -= cache.get(first).bytes; cache.delete(first);
        }
    }
    function getCache(url) {
        const key = cacheKey(url), entry = cache.get(key);
        if (!entry) return null;
        cache.delete(key); cacheBytes -= entry.bytes;
        if (Date.now() - entry.at > TTL) return null;
        cache.set(key, entry); cacheBytes += entry.bytes; return entry.html;
    }
    function parse(html, id) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const panels = doc.querySelectorAll('#market-detail-panel');
        if (panels.length !== 1 || panels[0].dataset.instrumentId !== id || !panels[0].dataset.pageTitle) throw new Error('Unexpected company response');
        const panel = panels[0];
        panel.querySelectorAll('script').forEach(script => {
            if (script.type !== 'application/json' || !['gr-chart-data','bw-visual-source'].includes(script.id)) script.remove();
        });
        return panel;
    }
    async function readResponse(response) {
        if (!response.ok || (response.url && new URL(response.url).origin !== location.origin)) throw new Error('History unavailable');
        if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Unexpected response type');
        if (Number(response.headers.get('content-length')) > MAX_FRAGMENT) throw new Error('History response too large');
        if (response.body?.getReader) {
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let bytes = 0, text = '';
            try {
                while (true) {
                    const chunk = await reader.read(); if (chunk.done) break;
                    bytes += chunk.value.byteLength;
                    if (bytes > MAX_FRAGMENT) throw new Error('History response too large');
                    text += decoder.decode(chunk.value,{stream:true});
                }
                return text + decoder.decode();
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const html = await response.text();
        if (new TextEncoder().encode(html).length > MAX_FRAGMENT) throw new Error('History response too large');
        return html;
    }
    function chartState(same) {
        const old = chart?.getState?.(); if (!old) return undefined;
        return {range:old.range, custom:{...old.custom}, chartStyle:old.chartStyle, showDots:old.showDots,
            settingsOpen:old.settingsOpen, exactDatesOpen:old.exactDatesOpen, inspectedDate:same ? old.inspectedDate : null};
    }
    function showRow(id) {
        const row = rows.get(id); if (!row || row.hidden) return;
        const rect = row.getBoundingClientRect(), parent = scroller.getBoundingClientRect();
        if (rect.top < parent.top) scroller.scrollTop -= parent.top - rect.top;
        else if (rect.bottom > parent.bottom) scroller.scrollTop += rect.bottom - parent.bottom;
    }
    function restoreScroll(saved) {
        scroller.scrollTop = Number(saved?.navScroll) || 0;
        host.scrollTop = Number(saved?.panelScroll) || 0;
        if (!desktop.matches) window.scrollTo(0, Number(saved?.windowScroll) || 0);
    }
    async function navigate(url, options = {}) {
        const id = idFrom(url); if (!id || disposed) return;
        if (scrollFrame !== null) {cancelAnimationFrame(scrollFrame); scrollFrame = null;}
        const sequence = ++generation;
        if (pending) {pending.abort.abort(); clearTimeout(pending.timer);}
        const abort = new AbortController();
        const task = {abort, timer:null, timeout:false}; pending = task;
        failed = null; retry.hidden = fallback.hidden = true;
        status.removeAttribute('data-error'); status.textContent = `Loading ${rows.get(id).dataset.stockName}…`;
        host.setAttribute('aria-busy','true');
        const deadline = new Promise((_, reject) => {
            task.timer = setTimeout(() => {task.timeout = true; abort.abort(); reject(new Error('History request timed out'));}, 8000);
        });
        try {
            let html = getCache(url);
            if (html === null) {
                html = await Promise.race([
                    fetch(url.href, {headers:{'X-BW-Fragment':'stock-detail','Accept':'text/html'}, credentials:'same-origin', signal:abort.signal}).then(readResponse),
                    deadline,
                ]);
            }
            if (sequence !== generation || disposed || abort.signal.aborted) return;
            const panel = parse(html, id), same = id === current, savedState = chartState(same);
            if (!options.pop) {url = applyQuery(new URL(url)); saveHistory();}
            const oldNodes = Array.from(host.childNodes), oldScroll = host.scrollTop, oldChart = chart;
            host.replaceChildren(panel);
            try {chart = BW.ReferencePage.mount(panel, {state:savedState});}
            catch (error) {
                host.replaceChildren(...oldNodes);
                chart = oldChart; host.scrollTop = oldScroll;
                throw error;
            }
            oldChart?.destroy();
            current = id; displayedURL = new URL(url); document.title = panel.dataset.pageTitle;
            putCache(url, html);
            remember(id); render();
            if (!options.pop) {
                host.scrollTop = 0;
                history.pushState({...history.state, bwStocks:state()}, '', url);
            }
            if (options.pop) restoreScroll(options.saved);
            else if (options.keyboard) {showRow(id); rows.get(id).querySelector('[data-stock-link]').focus({preventScroll:true});}
            if (!desktop.matches) {
                picker.open = false;
                if (!options.pop) {host.focus({preventScroll:true}); host.scrollIntoView({block:'start',behavior:'instant'});}
            }
            if (url.hash === '#gr-table-heading' && !options.pop) {
                host.querySelector('#gr-table-heading')?.scrollIntoView({block:'start',behavior:'instant'});
            }
            status.textContent = '';
        } catch (_) {
            if (sequence !== generation || disposed || (abort.signal.aborted && !task.timeout)) return;
            status.textContent = `Couldn’t load ${rows.get(id).dataset.stockName}. ${current ? `Still showing ${rows.get(current)?.dataset.stockName || 'the previous company'}.` : 'Please try again.'}`;
            status.dataset.error = 'true'; failed = {url, options};
            retry.hidden = fallback.hidden = false; fallback.href = url.href;
        } finally {
            clearTimeout(task.timer);
            if (sequence === generation) {pending = null; host.removeAttribute('aria-busy');}
        }
    }
    function step(delta, keyboard = false) {
        const index = visible.indexOf(current);
        const id = visible[index < 0 ? (delta > 0 ? 0 : -1) : index + delta];
        if (id) navigate(selectionURL(id), {keyboard});
    }
    if (current) remember(current);
    readView(new URL(location.href), history.state?.bwStocks);
    if (current) { const panel = host.querySelector('#market-detail-panel'); putCache(location.href, panel.outerHTML);}
    root.dataset.enhanced = 'true'; render();
    if (history.state?.bwStocks?.id === current) restoreScroll(history.state.bwStocks); else if (desktop.matches) showRow(current);
    saveHistory();
    if (!desktop.matches && current) picker.open = false;
    listen(desktop, 'change', () => {picker.open = desktop.matches || !current;});
    listen(search, 'input', filter);
    listen(search.form, 'submit', event => {event.preventDefault(); filter(); if (visible.length) navigate(selectionURL(visible[0]));});
    listen(sortControl, 'change', () => {sort = sortControl.value === 'symbol' ? 'symbol' : 'name'; filter();});
    listen(root, 'click', event => {
        const viewButton = event.target.closest('[data-stock-view]');
        if (viewButton) {
            if (view !== 'recent' && viewButton.dataset.stockView === 'recent') recentOrder = [...recent];
            view = viewButton.dataset.stockView; filter(); return;
        }
        const starButton = event.target.closest('[data-stock-star]');
        if (starButton) {toggleStar(starButton.dataset.stockStar); return;}
        if (event.target.closest('[data-stock-clear]')) {
            // Source filtering is server validated; a source reset uses its ordinary link.
            if (!root.dataset.stockSource) {event.preventDefault(); search.value = ''; view = 'all'; filter(); search.focus();}
            return;
        }
        const link = event.target.closest('a');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
        if (!link.matches('[data-stock-link]') && !link.closest('.gr-pagination')) return;
        const url = new URL(link.href); if (!idFrom(url)) return;
        event.preventDefault(); navigate(applyQuery(url));
    });
    listen($('#stock-current-star'), 'click', () => toggleStar(current));
    listen(previous, 'click', () => step(-1)); listen(next, 'click', () => step(1));
    listen(retry, 'click', () => {if (failed) navigate(failed.url, failed.options);});
    listen(list, 'keydown', event => {
        if (!event.target.matches('[data-stock-link]') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const focused = event.target.closest('[data-stock-id]').dataset.stockId, index = visible.indexOf(focused);
        const id = event.key === 'Home' ? visible[0] : event.key === 'End' ? visible[visible.length-1] : visible[index + (event.key === 'ArrowDown' ? 1 : -1)];
        if (id) {rows.get(id).querySelector('[data-stock-link]').focus({preventScroll:true}); navigate(selectionURL(id), {keyboard:true});}
    });
    listen(window, 'popstate', event => {
        const url = new URL(location.href), saved = event.state?.bwStocks;
        readView(url, saved); render();
        const id = idFrom(url) || (rows.has(saved?.id) ? saved.id : null);
        if (!id) {location.assign(url.href); return;}
        if (id === current && cacheKey(url) === cacheKey(displayedURL)) {
            generation++; if (pending) {pending.abort.abort(); clearTimeout(pending.timer); pending = null;}
            host.removeAttribute('aria-busy'); status.textContent = ''; retry.hidden = fallback.hidden = true; restoreScroll(saved);
        } else {
            const requestURL = idFrom(url) ? url : selectionURL(id);
            // The original /stocks entry retains its URL while reloading its selected panel.
            navigate(requestURL, {pop:true,saved});
        }
    });
    // Capture positions before any history traversal; the listener does no layout reads.
    const saveScroll = () => {
        if (pending || disposed || scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(() => {scrollFrame = null; if (!pending && !disposed) saveHistory();});
    };
    listen(scroller, 'scroll', saveScroll, {passive:true}); listen(host, 'scroll', saveScroll, {passive:true});
    listen(window, 'scroll', saveScroll, {passive:true});
    function destroy() {
        if (disposed) return; disposed = true; generation++;
        if (pending) {pending.abort.abort(); clearTimeout(pending.timer);}
        if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
        if ('scrollRestoration' in history) history.scrollRestoration = oldScrollRestoration;
        removers.forEach(remove => remove()); cache.clear(); cacheBytes = 0; chart?.destroy();
    }
    listen(window, 'pagehide', event => {
        generation++; if (pending) {pending.abort.abort(); clearTimeout(pending.timer); pending = null;}
        host.removeAttribute('aria-busy'); status.textContent = '';
        if (!event.persisted) destroy();
    });
    window.BW.StockWorkspace = {destroy};
})();
