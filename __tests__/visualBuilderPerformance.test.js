/** @jest-environment node */
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
let dom,w,host,frames,records,finds,visits,layoutReads;
function dense(count=7121) {
    return {title:'All source history',unit:'USD',frequency:'daily',series:[{id:'history',name:'Source',unit:'USD',points:Array.from({length:count},(_,index)=>({date:new Date(Date.UTC(2000,0,index+1)).toISOString().slice(0,10),value:index/7,footnote:index===100?'Exact source note':''}))}]};
}
function flush() {const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(0);}
function move(svg,point) {svg.dispatchEvent(new w.MouseEvent('pointermove',{clientX:point.x,clientY:point.y,bubbles:true}));}
function key(svg,name) {svg.dispatchEvent(new w.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));}
beforeEach(()=>{
    dom=new JSDOM('<button id="opener">Edit</button><div id="chart"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});w=dom.window;host=w.document.getElementById('chart');frames=new Map();let next=0;
    w.requestAnimationFrame=callback=>{const id=++next;frames.set(id,callback);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
    for(const file of ['vendor/d3.v7.9.0.min.js','components/visual_builder.js'])w.eval(fs.readFileSync('app/static/js/'+file,'utf8'));
    records=[];finds=0;visits=0;layoutReads=0;
    const quadtree=w.d3.quadtree,pointer=w.d3.pointer;
    w.d3.pointer=(...args)=>{layoutReads++;return pointer(...args);};
    w.d3.quadtree=(items,...accessors)=>{
        records.push(items);const tree=quadtree(items,...accessors),find=tree.find,visit=tree.visit;
        tree.find=function(...args){finds++;return find.apply(this,args);};
        tree.visit=function(callback){return visit.call(this,(...args)=>{visits++;return callback(...args);});};return tree;
    };
});
afterEach(()=>{w.BW.VisualBuilder.close();dom.window.close();});

test('7121 source points stay exact without dense invisible marks and pointer bursts do one bounded spatial lookup',()=>{
    const onInspect=jest.fn(),chart=w.BW.VisualBuilder.render(host,dense(),{presentation:'quick',width:700,onInspect}),items=records.at(-1);
    expect(items).toHaveLength(7121);expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(0);
    expect(chart.svg.querySelectorAll('title')).toHaveLength(1);
    expect(JSON.parse(chart.svg.querySelector('metadata').textContent).series[0].points).toHaveLength(7121);
    for(let index=0;index<100;index++)move(chart.svg,items[index]);
    move(chart.svg,items[100]);expect(frames.size).toBe(1);expect(finds).toBe(0);expect(layoutReads).toBe(0);
    flush();expect(finds).toBe(1);expect(layoutReads).toBe(1);expect(visits).toBeLessThan(712);
    expect(onInspect).toHaveBeenCalledTimes(1);expect(onInspect.mock.calls[0][0].text).toContain('Exact source note');
    key(chart.svg,'Home');expect(onInspect.mock.calls.at(-1)[0].text).toContain('0 USD');
    key(chart.svg,'End');expect(onInspect.mock.calls.at(-1)[0].text).toContain(String(7120/7));
    chart.destroy();
});

test('leave, keyboard, rerender and destroy cancel pending pointer work; stale destroy cannot remove the new SVG',()=>{
    const firstInspect=jest.fn(),first=w.BW.VisualBuilder.render(host,dense(40),{presentation:'quick',onInspect:firstInspect});
    move(first.svg,records.at(-1)[20]);first.svg.dispatchEvent(new w.Event('pointerleave'));expect(frames.size).toBe(0);flush();expect(finds).toBe(0);
    move(first.svg,records.at(-1)[20]);key(first.svg,'Home');expect(frames.size).toBe(0);expect(firstInspect.mock.calls.at(-1)[0].text).toContain('0 USD');
    move(first.svg,records.at(-1)[20]);const secondInspect=jest.fn(),second=w.BW.VisualBuilder.render(host,dense(50),{presentation:'quick',onInspect:secondInspect});
    expect(frames.size).toBe(0);first.destroy();expect(second.svg.isConnected).toBe(true);
    move(second.svg,records.at(-1)[21]);second.destroy();expect(frames.size).toBe(0);expect(host.querySelector('svg')).toBeNull();flush();expect(secondInspect.mock.calls.filter(call=>call[0]!==null)).toHaveLength(0);
});

test('same-date multi-series points retain 2D nearest values and stable coincident keyboard/pointer ties',()=>{
    const onInspect=jest.fn(),chart=w.BW.VisualBuilder.render(host,{unit:'USD',series:[{name:'First',points:[{date:'2025',value:0},{date:'2025',value:10}]},{name:'Second',points:[{date:'2025',value:10},{date:'2025',value:20}]}]},{presentation:'quick',onInspect});
    expect(records.at(-1)).toHaveLength(3);
    const middle=records.at(-1).find(item=>item.point.value===10);move(chart.svg,middle);flush();expect(onInspect.mock.calls.at(-1)[0].text).toContain('First');
    const top=records.at(-1).find(item=>item.point.value===20);move(chart.svg,top);flush();expect(onInspect.mock.calls.at(-1)[0].text).toContain('20 USD');
    key(chart.svg,'Home');key(chart.svg,'ArrowRight');expect(onInspect.mock.calls.at(-1)[0].text).toContain('First');
    key(chart.svg,'ArrowRight');expect(onInspect.mock.calls.at(-1)[0].text).toContain('Second');expect(onInspect.mock.calls.at(-1)[0].text).toContain('10 USD');chart.destroy();
});

test('ordinal source order, null gaps, isolated visible observations, bars and scatter remain complete',()=>{
    const spec=dense(30);spec.ordinal=true;spec.series[0].points=spec.series[0].points.map((point,index)=>({period:'Period '+index,value:point.value}));spec.series[0].points.push({period:'Missing',value:null},{period:'Isolated',value:123.1234567890123});
    for(const type of ['line','area','bar','scatter']) {
        const onInspect=jest.fn(),chart=w.BW.VisualBuilder.render(host,{...spec,type},{presentation:'quick',onInspect});
        expect(chart.svg.querySelectorAll('.bw-vb-mark')).toHaveLength(['line','area'].includes(type)?1:31);
        key(chart.svg,'End');expect(onInspect.mock.calls.at(-1)[0].text).toContain('Isolated');expect(onInspect.mock.calls.at(-1)[0].text).toContain('123.1234567890123');
        if(['line','area'].includes(type))expect(chart.svg.querySelectorAll('.bw-vb-line')).toHaveLength(2);chart.destroy();
    }
});

test('full editor timeline supports dense pointer values and close clears pending inspection frames',()=>{
    const controller=w.BW.VisualBuilder.open(dense(100));
    const svg=controller.dialog.querySelector('svg'),point=records.at(-1)[50];move(svg,point);flush();
    expect(svg.querySelector('.bw-vb-inspection').getAttribute('visibility')).toBe('visible');
    expect(svg.querySelector('.bw-vb-inspection').textContent).toContain(String(50/7));
    move(svg,records.at(-1)[51]);controller.close();expect(frames.size).toBe(0);flush();expect(svg.isConnected).toBe(false);
});
