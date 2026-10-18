/* Optional source-flow diagrams. The ordered steps remain the accessible source. */
(function () {
    'use strict';
    const scriptSource = document.currentScript?.dataset.peleSrc;
    window.BW = window.BW || {};
    if (window.BW.Diagrams) return;

    const selector = '[data-bw-diagram]';
    const fallbackSource = '/static/js/vendor/pele.v1.6.0.min.js';
    const records = new Map();
    let vendorPromise = null;
    let sequence = 0;

    function localSource(value) {
        try {
            const url = new URL(value || fallbackSource, window.location.href);
            if (url.origin === window.location.origin && /^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
        } catch (_) { /* Use the pinned local asset when the configured URL is invalid. */ }
        return new URL(fallbackSource, window.location.href).href;
    }
    const vendorSource = localSource(scriptSource);

    function loadVendor() {
        if (window.pele && typeof window.pele.mount === 'function') return Promise.resolve(window.pele);
        if (vendorPromise) return vendorPromise;
        const loading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = vendorSource;
            script.async = true;
            script.dataset.bwDiagramVendor = '';
            const timer = window.setTimeout(() => finish(false), 15000);
            function finish(success) {
                window.clearTimeout(timer);
                script.onload = null;
                script.onerror = null;
                if (success && window.pele && typeof window.pele.mount === 'function') resolve(window.pele);
                else {
                    script.remove();
                    reject(new Error('Diagram library unavailable'));
                }
            }
            script.onload = () => finish(true);
            script.onerror = () => finish(false);
            document.head.appendChild(script);
        });
        vendorPromise = loading.catch(error => {
            vendorPromise = null;
            throw error;
        });
        return vendorPromise;
    }

    function disclosuresOpen(figure) {
        let disclosure = false;
        for (let node = figure; node; node = node.parentElement) {
            if (node.tagName === 'DETAILS') {
                disclosure = true;
                if (!node.open) return false;
            }
        }
        return disclosure;
    }

    function ownElements(figure, query) {
        return [...figure.querySelectorAll(query)].filter(node => node.closest(selector) === figure);
    }

    function readFigure(figure) {
        const scripts = ownElements(figure, 'script[type="application/json"][data-diagram-steps]');
        const stages = ownElements(figure, '.bw-diagram-stage');
        const steps = ownElements(figure, 'ol.bw-diagram-steps');
        if (scripts.length !== 1 || stages.length !== 1 || steps.length !== 1) throw new Error('Invalid diagram structure');
        const raw = scripts[0].textContent;
        if (raw.length > 16384) throw new Error('Diagram steps too large');
        const labels = JSON.parse(raw);
        if (!Array.isArray(labels) || labels.length < 2 || labels.length > 6 || labels.some(label =>
            typeof label !== 'string' || !label.trim() || label.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(label))) {
            throw new Error('Invalid diagram steps');
        }
        return { figure, stage: stages[0], labels, status: ownElements(figure, '.bw-diagram-status')[0], state: 'idle', mount: null, disposed: false };
    }

    function setStatus(record, message) {
        if (!record.status) return;
        record.status.textContent = message;
        record.status.hidden = !message;
    }

    function destroy(record) {
        if (record.mount && typeof record.mount.destroy === 'function') record.mount.destroy();
        record.mount = null;
    }

    function fail(record) {
        destroy(record);
        record.state = 'error';
        record.figure.dataset.diagramState = 'error';
        record.stage.replaceChildren();
        record.stage.hidden = true;
        setStatus(record, 'Diagram unavailable. The source steps remain available.');
    }

    // Every character is encoded before parsing, including quotes, newlines and
    // Mermaid punctuation. Labels cannot introduce statements, IDs or options.
    function sourceFor(labels) {
        const nodes = labels.map((label, index) => {
            const text = [...label.trim().replace(/\s+/g, ' ')].map(char => '#' + char.codePointAt(0) + ';').join('');
            return 'S' + index + '["' + text + '"]';
        });
        const edges = labels.slice(1).map((_, index) => 'S' + index + ' --> S' + (index + 1));
        return ['flowchart LR', ...nodes, ...edges].join('\n');
    }

    function sanitizeSvg(svg, count) {
        if (typeof svg !== 'string' || svg.length > 100000) throw new Error('Invalid diagram output');
        const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const root = parsed.documentElement;
        if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || parsed.querySelector('parsererror')) throw new Error('Invalid diagram SVG');
        const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan', 'title', 'desc', 'defs', 'marker', 'clipPath']);
        for (const node of [root, ...root.querySelectorAll('*')]) {
            if (!tags.has(node.localName) || node.namespaceURI !== root.namespaceURI) throw new Error('Unexpected diagram element');
            for (const attribute of node.attributes) {
                if (/^on/i.test(attribute.name) || /(?:^|:)href$/i.test(attribute.name) || /url\s*\(|@import|expression\s*\(/i.test(attribute.value)) throw new Error('Unexpected diagram attribute');
            }
        }
        const nodes = [...root.querySelectorAll('.pele-node')];
        if (nodes.length !== count || nodes.some((node, index) => node.getAttribute('data-id') !== 'S' + index) || root.querySelectorAll('.pele-edge').length !== count - 1) throw new Error('Unexpected diagram flow');
        return document.importNode(root, true);
    }

    function render(record, pele) {
        record.stage.hidden = false;
        record.stage.setAttribute('aria-hidden', 'true');
        const options = {
            links: false, images: false, zoom: false,
            fontSize: 12, padding: 6, responsive: true, autoDirection: true,
            directionBreakpoint: 640, limit: 12000, outputLimit: 100000, maxEdges: 5,
            idPrefix: 'bw-source-flow-' + (++sequence),
            sanitize: svg => sanitizeSvg(svg, record.labels.length),
            onError: () => fail(record),
            onRender: result => {
                if (record.disposed) return;
                const availableWidth = record.stage.clientWidth || record.stage.getBoundingClientRect().width;
                if (result?.type !== 'flowchart' || !Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0 || !record.stage.querySelector('svg') || (availableWidth > 0 && result.width > availableWidth * 1.2)) {
                    fail(record);
                    return;
                }
                record.state = 'ready';
                record.figure.dataset.diagramState = 'ready';
                record.stage.hidden = false;
                setStatus(record, '');
            }
        };
        try {
            const mounted = pele.mount(record.stage, sourceFor(record.labels), options);
            if (!mounted || mounted.error || record.state === 'error') {
                mounted?.destroy?.();
                fail(record);
            } else record.mount = mounted;
        } catch (_) { fail(record); }
    }

    function ensure(figure) {
        if (!figure.isConnected || !disclosuresOpen(figure)) return;
        let record = records.get(figure);
        if (record?.state === 'loading') return;
        if (record?.state === 'ready') {
            record.mount?.refresh?.();
            return;
        }
        if (record) destroy(record);
        try { record = readFigure(figure); }
        catch (_) {
            figure.dataset.diagramState = 'error';
            return;
        }
        records.set(figure, record);
        record.state = 'loading';
        figure.dataset.diagramState = 'loading';
        setStatus(record, '');
        loadVendor().then(pele => {
            if (record.disposed || records.get(figure) !== record || !figure.isConnected) return;
            if (!disclosuresOpen(figure)) {
                record.state = 'idle';
                figure.dataset.diagramState = 'idle';
                return;
            }
            render(record, pele);
        }, () => {
            if (!record.disposed && records.get(figure) === record) fail(record);
        });
    }

    function scan(root = document) {
        if (root.nodeType === 1 && root.matches(selector)) ensure(root);
        root.querySelectorAll?.(selector).forEach(ensure);
    }

    function cleanup() {
        records.forEach((record, figure) => {
            if (figure.isConnected) return;
            record.disposed = true;
            destroy(record);
            records.delete(figure);
        });
    }

    document.addEventListener('toggle', event => {
        if (event.target.tagName === 'DETAILS' && event.target.open) scan(event.target);
    }, true);
    const observer = new MutationObserver(changes => {
        let removed = false;
        for (const change of changes) {
            if (change.removedNodes.length) removed = true;
            change.addedNodes.forEach(node => {
                if (node.nodeType === 1 || node.nodeType === 11) scan(node);
            });
        }
        if (removed) cleanup();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.BW.Diagrams = Object.freeze({ scan });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(), { once: true });
    else scan();
})();
