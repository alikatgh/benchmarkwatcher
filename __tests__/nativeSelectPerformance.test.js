/** @jest-environment jsdom */
const path = require('path');
const {execFileSync} = require('child_process');
const mockRoots = [];
jest.mock('react-dom/client', () => ({createRoot: () => {
    const root = {render:jest.fn(),unmount:jest.fn()}; mockRoots.push(root); return root;
}}));
const options = {
    entryPoints:[path.join(__dirname,'../frontend/reui/native-select.tsx')],
    bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',
    external:['react','react-dom/client','lucide-react','radix-ui','cmdk'],
};
// Build in Node's own realm; esbuild's typed-array invariant differs inside jsdom.
const code = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("esbuild").buildSync(' + JSON.stringify(options) + ').outputFiles[0].text)'], {cwd:path.join(__dirname,'..'),encoding:'utf8'});
let dispose, install;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
    document.body.innerHTML = '<main id="main-content"><div id="tw-filters"><select id="tw-category"><option value="">All</option><option value="energy">Energy</option></select></div><div id="chart"></div></main>';
    const target = {exports:{}}; new Function('require','module','exports',code)(require,target,target.exports);
    install = target.exports.installNativeSelects; dispose = install();
});
afterEach(() => { dispose(); jest.restoreAllMocks(); mockRoots.length = 0; });

test('generic table changes synchronize values without revisiting option collections', async () => {
    const select = document.getElementById('tw-category'); await settle();
    const options = jest.spyOn(select,'options','get');
    for (let index=0;index<100;index++) document.dispatchEvent(new CustomEvent('bw:table-view-change'));
    expect(options).not.toHaveBeenCalled();
    select.add(new Option('Metals','metal')); await settle();
    expect(options).toHaveBeenCalledTimes(1);
});

test('SVG chart mutations do not rescan the document; added and removed fields mount/dispose once', async () => {
    await settle();
    const scan = jest.spyOn(document,'querySelectorAll');
    const chart = document.getElementById('chart');
    for (let index=0;index<100;index++) chart.append(document.createElementNS('http://www.w3.org/2000/svg','path'));
    await settle(); expect(scan).not.toHaveBeenCalled();
    const group = document.createElement('div'); group.className='gr-filter';
    group.innerHTML='<select id="source"><option>Public</option></select>';
    document.getElementById('main-content').append(group); await settle();
    expect(group.querySelectorAll('[data-reui-select="source"]')).toHaveLength(1);
    expect(mockRoots).toHaveLength(2);
    expect(install()).toBe(dispose);
    const removed = mockRoots[1]; group.remove(); await settle();
    expect(removed.unmount).toHaveBeenCalledTimes(1);
});

test('disposal disconnects global and field observers and restores native form controls', async () => {
    const select = document.getElementById('tw-category'); await settle();
    const options = jest.spyOn(select,'options','get'); dispose();
    expect(select.hidden).toBe(false);
    expect(select.dataset.reuiEnhanced).toBeUndefined();
    expect(document.querySelector('.rui-select-host')).toBeNull();
    select.add(new Option('Metals','metal'));
    document.dispatchEvent(new CustomEvent('bw:table-ready'));
    document.dispatchEvent(new CustomEvent('bw:table-view-change')); await settle();
    expect(options).not.toHaveBeenCalled();
    expect(mockRoots[0].unmount).toHaveBeenCalledTimes(1);
});
