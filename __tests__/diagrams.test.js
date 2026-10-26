const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const runtime = fs.readFileSync(path.join(__dirname, '../app/static/js/core/diagrams.js'), 'utf8');
const vendor = fs.readFileSync(path.join(__dirname, '../app/static/js/vendor/pele.v1.6.0.min.js'), 'utf8');
let dom, window, document;

function figure(labels = ['Original publisher', 'Published observation']) {
    const item = document.createElement('figure');
    item.dataset.bwDiagram = '';
    item.innerHTML = '<div class="bw-diagram-stage" aria-hidden="true"></div><ol class="bw-diagram-steps"></ol><p class="bw-diagram-status" hidden></p><script type="application/json" data-diagram-steps></script>';
    item.querySelector('script').textContent = JSON.stringify(labels);
    if (Array.isArray(labels)) labels.forEach(label => {
        const step = document.createElement('li');
        step.textContent = String(label);
        item.querySelector('ol').appendChild(step);
    });
    return item;
}

function disclosure(item = figure(), open = false) {
    const details = document.createElement('details');
    details.innerHTML = '<summary>Source and method</summary>';
    details.appendChild(item);
    details.open = open;
    document.body.appendChild(details);
    return details;
}

function toggle(details, open) {
    details.open = open;
    details.dispatchEvent(new window.Event('toggle'));
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
}

function start(source) {
    const loader = document.createElement('script');
    if (source) loader.dataset.peleSrc = source;
    Object.defineProperty(document, 'currentScript', { configurable: true, value: loader });
    window.eval(runtime);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
}

function mockPele(svgOverride) {
    const mounts = [];
    const mount = jest.fn((stage, source, options) => {
        const count = (source.match(/S\d+\["/g) || []).length;
        const svg = svgOverride || '<svg xmlns="http://www.w3.org/2000/svg"><g>' +
            Array.from({ length: count }, (_, index) => '<g class="pele-node" data-id="S' + index + '"><text>Step</text></g>').join('') +
            Array.from({ length: count - 1 }, () => '<g class="pele-edge"><path d="M0 0L1 1"/></g>').join('') + '</g></svg>';
        const result = { svg, type: 'flowchart', width: 400, height: 80 };
        try {
            stage.replaceChildren(options.sanitize(svg));
            options.onRender(result);
        } catch (error) {
            options.onError(error);
            const failed = { error, destroy: jest.fn() };
            mounts.push(failed);
            return failed;
        }
        const mounted = { result, destroy: jest.fn(), refresh: jest.fn() };
        mounts.push(mounted);
        return mounted;
    });
    window.pele = { mount };
    return { mount, mounts };
}

function installRealPele(width) {
    const rect = { width, height: 100, top: 0, left: 0, bottom: 100, right: width };
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
    window.HTMLElement.prototype.getBoundingClientRect = () => rect;
    window.HTMLElement.prototype.getClientRects = () => [rect];
    window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: text.length * 6 }) });
    window.ResizeObserver = class { observe() {} disconnect() {} };
    vm.runInContext(vendor, dom.getInternalVMContext());
}

beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url: 'https://benchmark.test/dashboard', runScripts: 'outside-only'
    });
    window = dom.window;
    document = window.document;
});

afterEach(() => dom.window.close());

test('closed disclosures keep readable steps and do not request Pele', async () => {
    const item = figure();
    disclosure(item);
    start();
    await settle();
    expect(document.querySelector('[data-bw-diagram-vendor]')).toBeNull();
    expect(item.querySelectorAll('ol li')).toHaveLength(2);
    expect(item.querySelector('ol').hasAttribute('aria-hidden')).toBe(false);
    expect(item.dataset.diagramState).toBeUndefined();
});

test('concurrent opens share one local vendor request and fixed safe options', async () => {
    const first = disclosure(), second = disclosure();
    start('https://external.example/evil.js');
    toggle(first, true); toggle(second, true);
    await settle();
    const scripts = document.querySelectorAll('[data-bw-diagram-vendor]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://benchmark.test/static/js/vendor/pele.v1.6.0.min.js');
    const { mount } = mockPele();
    scripts[0].dispatchEvent(new window.Event('load'));
    await settle();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[0][2]).toMatchObject({ links: false, images: false, zoom: false, fontSize: 12, autoDirection: true, responsive: true, maxEdges: 5, limit: 12000, outputLimit: 100000 });
    for (const details of [first, second]) {
        expect(details.querySelector('figure').dataset.diagramState).toBe('ready');
        expect(details.querySelector('.bw-diagram-stage').getAttribute('aria-hidden')).toBe('true');
        expect(details.querySelector('ol').hidden).toBe(false);
        expect(details.querySelector('ol').hasAttribute('aria-hidden')).toBe(false);
    }
});

test('an open child waits for its closed ancestor disclosure', async () => {
    const child = disclosure(figure(), true);
    const parent = disclosure(child);
    start();
    await settle();
    expect(document.querySelector('[data-bw-diagram-vendor]')).toBeNull();
    toggle(parent, true);
    await settle();
    expect(document.querySelectorAll('[data-bw-diagram-vendor]')).toHaveLength(1);
});

test('failed loading preserves fallback and retries on reopening', async () => {
    const details = disclosure();
    start(); toggle(details, true);
    await settle();
    const failedScript = document.querySelector('[data-bw-diagram-vendor]');
    failedScript.dispatchEvent(new window.Event('error'));
    await settle();
    const item = details.querySelector('figure');
    expect(item.dataset.diagramState).toBe('error');
    expect(item.querySelector('.bw-diagram-stage').hidden).toBe(true);
    expect(item.querySelector('ol li').textContent).toBe('Original publisher');
    expect(item.querySelector('.bw-diagram-status').hidden).toBe(false);
    toggle(details, false); await settle(); toggle(details, true);
    await settle();
    const retry = document.querySelector('[data-bw-diagram-vendor]');
    expect(retry).not.toBeNull();
    expect(retry).not.toBe(failedScript);
    mockPele(); retry.dispatchEvent(new window.Event('load'));
    await settle();
    expect(item.dataset.diagramState).toBe('ready');
    expect(item.querySelector('.bw-diagram-status').hidden).toBe(true);
});

test.each([
    ['Only one'], ['Valid', 'x'.repeat(201)], ['Valid', {}], ['', 'Other'],
    { source: 'flowchart LR\nINJECT --> X', options: { links: true } },
    ['1', '2', '3', '4', '5', '6', '7']
])('malformed labels never reach Pele: %j', async labels => {
    const item = figure(labels);
    disclosure(item, true);
    const { mount } = mockPele();
    start(); await settle();
    expect(mount).not.toHaveBeenCalled();
    expect(item.dataset.diagramState).toBe('error');
    expect(document.querySelector('[data-bw-diagram-vendor]')).toBeNull();
});

test('hostile labels stay literal with the real pinned Pele parser and renderer', async () => {
    const labels = ['x"] --> INJECT[Injected]\nclick INJECT "https://evil.example"', '<svg onload=alert(1)> & "quoted" 日本語'];
    disclosure(figure(labels), true);
    const { mount } = mockPele();
    start(); await settle();
    const source = mount.mock.calls[0][1];
    expect(source).toMatch(/^flowchart LR\nS0\["(?:#\d+;)+"\]\nS1\["(?:#\d+;)+"\]\nS0 --> S1$/);
    const context = vm.createContext({});
    vm.runInContext(vendor, context);
    const parsed = context.pele.parse(source, { limit: 12000, maxEdges: 5 });
    expect([...parsed.nodes.keys()]).toEqual(['S0', 'S1']);
    expect(parsed.edges).toHaveLength(1);
    const result = context.pele.render(source, { links: false, images: false, limit: 12000, outputLimit: 100000, maxEdges: 5 });
    const svg = new window.DOMParser().parseFromString(result.svg, 'image/svg+xml');
    expect(svg.querySelectorAll('.pele-node')).toHaveLength(2);
    expect(svg.querySelector('script, a, image, foreignObject, [onload]')).toBeNull();
    const renderedLabels = [...svg.querySelectorAll('.pele-node')].map(node => {
        const lines = [...node.querySelectorAll('tspan')];
        return lines.length ? lines.map(line => line.textContent).join(' ') : node.textContent;
    });
    expect(renderedLabels).toEqual(labels.map(label => label.replace(/\s+/g, ' ')));
    expect(mount.mock.calls[0][2].sanitize(result.svg).localName).toBe('svg');
});

test.each([320, 900])('the real pinned mount and sanitizer render at %ipx', async width => {
    installRealPele(width);
    const item = figure(['Original public data publisher', 'Period and unit kept with each observation', 'Stored source snapshot and attribution', 'Historical reference view']);
    disclosure(item, true);
    start(); await settle();
    expect(item.dataset.diagramState).toBe('ready');
    expect(item.querySelectorAll('.pele-node')).toHaveLength(4);
    expect(item.querySelectorAll('.pele-edge')).toHaveLength(3);
    const [, , renderedWidth, renderedHeight] = item.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
    if (width === 320) expect(renderedHeight).toBeGreaterThan(renderedWidth);
    else expect(renderedWidth).toBeGreaterThan(renderedHeight);
});

test('an unbroken label that would shrink text too far keeps the readable fallback', async () => {
    installRealPele(320);
    const item = figure(['x'.repeat(200), 'Published observation']);
    disclosure(item, true);
    start(); await settle();
    expect(item.dataset.diagramState).toBe('error');
    expect(item.querySelector('.bw-diagram-stage').childNodes).toHaveLength(0);
    expect(item.querySelector('ol li').textContent).toHaveLength(200);
});

test('new workbook fragments are discovered and removed mounts are destroyed', async () => {
    start();
    const { mount, mounts } = mockPele();
    const fragment = document.createDocumentFragment();
    const item = figure();
    const details = document.createElement('details');
    details.open = true;
    details.appendChild(item);
    fragment.appendChild(details);
    document.body.appendChild(fragment);
    await settle();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(item.dataset.diagramState).toBe('ready');
    details.remove(); await settle();
    expect(mounts[0].destroy).toHaveBeenCalledTimes(1);
});

test('a disclosure closed during download waits for reopening before mounting', async () => {
    const details = disclosure();
    start(); toggle(details, true);
    await settle();
    toggle(details, false);
    const { mount } = mockPele();
    document.querySelector('[data-bw-diagram-vendor]').dispatchEvent(new window.Event('load'));
    await settle();
    expect(mount).not.toHaveBeenCalled();
    toggle(details, true); await settle();
    expect(mount).toHaveBeenCalledTimes(1);
});

test('render errors and unexpected SVG retain the ordered fallback', async () => {
    const item = figure();
    disclosure(item, true);
    mockPele('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/tracker"/></svg>');
    start(); await settle();
    expect(item.dataset.diagramState).toBe('error');
    expect(item.querySelector('.bw-diagram-stage').childNodes).toHaveLength(0);
    expect(item.querySelector('ol').hidden).toBe(false);
});

test('an automatic redraw failure restores fallback and releases its observer', async () => {
    const item = figure(); disclosure(item, true);
    const { mount, mounts } = mockPele();
    start(); await settle();
    mount.mock.calls[0][2].onError(new Error('resize failed'));
    await settle();
    expect(item.dataset.diagramState).toBe('error');
    expect(item.querySelector('.bw-diagram-stage').hidden).toBe(true);
    expect(mounts[0].destroy).toHaveBeenCalledTimes(1);
});

test('the public scan method handles a figure root and duplicate script evaluation', async () => {
    const item = figure(); disclosure(item, true);
    const { mount } = mockPele();
    start(); await settle();
    const api = window.BW.Diagrams;
    window.eval(runtime);
    api.scan(item);
    expect(Object.isFrozen(api)).toBe(true);
    expect(window.BW.Diagrams).toBe(api);
    expect(mount).toHaveBeenCalledTimes(1);
});
