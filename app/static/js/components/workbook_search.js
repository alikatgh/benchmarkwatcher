(function () {
    'use strict';
    const form = document.getElementById('workbook-search');
    if (!form) return;
    // The authenticated page supplies names and routes only, never workbook cells.
    let books;
    try { books = JSON.parse(document.getElementById('workbook-search-index').textContent); }
    catch (_) { return; } // Keep the ordinary GET form usable if enhancement fails.
    const input = form.querySelector('input');
    const clear = form.querySelector('.studio-search-clear');
    const popup = form.querySelector('.studio-search-popup');
    const options = document.getElementById('workbook-suggestions');
    const list = document.querySelector('.workbook-list');
    const count = document.getElementById('workbook-search-count');
    const pages = document.getElementById('workbook-pages');
    const index = books.map(book => ({ ...book, search: book.name.toLowerCase() }));
    const pageSize = 60;
    let active = -1;
    let matches = index;
    let timer;
    let composing = false;
    const terms = () => input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const close = () => {
        popup.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    };
    const setActive = position => {
        active = position;
        Array.from(options.children).forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
        const selected = options.children[active];
        if (selected) {
            input.setAttribute('aria-activedescendant', selected.id);
            selected.scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
    };
    const highlighted = name => {
        const label = document.createDocumentFragment();
        const escaped = terms().map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!escaped.length) { label.append(document.createTextNode(name)); return label; }
        const pattern = new RegExp('(' + escaped.sort((a, b) => b.length - a.length).join('|') + ')', 'gi');
        name.split(pattern).forEach((part, i) => {
            const node = i % 2 ? document.createElement('mark') : document.createTextNode(part);
            if (i % 2) node.textContent = part;
            label.append(node);
        });
        return label;
    };
    const showSuggestions = () => {
        options.replaceChildren();
        active = -1;
        input.removeAttribute('aria-activedescendant');
        if (!input.value.trim() || document.activeElement !== input) { close(); return; }
        matches.slice(0, 8).forEach((book, i) => {
            const option = document.createElement('li');
            option.id = 'workbook-option-' + i;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.dataset.url = book.url;
            const label = document.createElement('span');
            label.append(highlighted(book.name));
            option.append(label);
            const arrow = document.createElement('span');
            arrow.textContent = '↗';
            arrow.setAttribute('aria-hidden', 'true');
            option.append(arrow);
            option.addEventListener('pointerdown', event => event.preventDefault());
            option.addEventListener('click', () => location.assign(book.url));
            options.append(option);
        });
        form.querySelector('.studio-search-empty').hidden = matches.length > 0;
        popup.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    };
    const resultURL = page => {
        const url = new URL(form.getAttribute('action'), location.origin);
        if (input.value.trim()) url.searchParams.set('q', input.value.trim());
        if (page > 1) url.searchParams.set('page', page);
        return url;
    };
    const renderList = (page = 1) => {
        list.replaceChildren();
        const last = Math.max(1, Math.ceil(matches.length / pageSize));
        page = Math.min(Math.max(1, Math.floor(page)), last);
        matches.slice((page - 1) * pageSize, page * pageSize).forEach(book => {
            const link = document.createElement('a');
            link.href = book.url;
            const icon = document.createElement('span');
            icon.className = 'studio-file-mark';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '▦';
            const title = document.createElement('span');
            const name = document.createElement('strong');
            name.append(highlighted(book.name));
            const description = document.createElement('span');
            description.textContent = 'Workbook snapshot';
            title.append(name, description);
            const open = document.createElement('span');
            open.className = 'studio-open';
            open.textContent = 'Open →';
            link.append(icon, title, open);
            list.append(link);
        });
        if (!matches.length) {
            const empty = document.createElement('p');
            empty.textContent = index.length ? 'No matching workbooks. Try another company or ticker.' : 'The workbook library has not been connected yet.';
            list.append(empty);
        }
        count.textContent = `${matches.length} of ${index.length} workbooks${input.value.trim() ? ' matching “' + input.value.trim() + '”' : ''}`;
        pages.replaceChildren();
        for (const [label, target] of [['Previous', page - 1], ['Next', page + 1]]) {
            if (target < 1 || target > last) continue;
            const link = document.createElement('a');
            link.href = resultURL(target).href;
            link.textContent = label;
            link.addEventListener('click', event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                renderList(target);
                input.focus({ preventScroll: true });
                close();
                form.scrollIntoView({ block: 'start' });
            });
            pages.append(link);
        }
        history.replaceState(history.state, '', resultURL(page));
    };
    const update = (page = 1) => {
        const query = terms();
        matches = index.filter(book => query.every(term => book.search.includes(term)));
        if (query.length) {
            const rank = book => query.reduce((score, term) => score +
                (book.search === term ? 3 : book.search.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(term)) ? 1 : 0), 0);
            matches.sort((a, b) => rank(b) - rank(a));
        }
        clear.hidden = !input.value;
        renderList(page);
        showSuggestions();
    };
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', options.id);
    input.setAttribute('aria-expanded', 'false');
    form.querySelector('.studio-search-submit').hidden = true;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        close();
        if (!composing) timer = setTimeout(update, 100);
    });
    input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); close(); });
    input.addEventListener('compositionend', () => { composing = false; update(); });
    input.addEventListener('focus', showSuggestions);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); clearTimeout(timer); update(); close(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (popup.hidden) { clearTimeout(timer); update(); }
            const length = options.children.length;
            if (length) setActive((active + (event.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + length) % length);
        }
        if (event.key === 'Enter' && active >= 0 && !popup.hidden) {
            event.preventDefault();
            location.assign(options.children[active].dataset.url);
        }
    });
    clear.addEventListener('click', () => { clearTimeout(timer); input.value = ''; input.focus(); update(); });
    form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); update(); close(); });
    window.addEventListener('pageshow', () => { clearTimeout(timer); update(Number(new URL(location.href).searchParams.get('page')) || 1); });
    update(Number(new URL(location.href).searchParams.get('page')) || 1);
})();
