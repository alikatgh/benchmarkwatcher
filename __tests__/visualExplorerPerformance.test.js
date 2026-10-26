/** @jest-environment node */
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
let dom,w,d,observers,media;
const points=count=>Array.from({length:count},(_,index)=>({date:new Date(Date.UTC(2000,0,index+1)).toISOString().slice(0,10),value:index===0?0:index/7}));
const spec=(count=7121)=>({id:'source',title:'All observations',unit:'USD',frequency:'daily',series:[{name:'Source',unit:'USD',points:points(count)}]});
beforeEach(()=>{
 dom=new JSDOM('<div class="commodity-overview"><div id="priceChart"></div></div><div id="chart"></div><p id="note"></p><div id="values"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});w=dom.window;d=w.document;
 observers=[];w.ResizeObserver=class {constructor(callback){this.callback=callback;this.disconnect=jest.fn();observers.push(this);}observe(){}};
 media=[];w.matchMedia=()=>{const query={matches:false,addEventListener:jest.fn(),removeEventListener:jest.fn()};media.push(query);return query;};
 for(const file of ['vendor/d3.v7.9.0.min.js','core/visuals.js','components/visual_builder.js','components/visual_explorer.js'])w.eval(fs.readFileSync('app/static/js/'+file,'utf8'));
});
afterEach(()=>{w.BW.VisualBuilder.close();w.BW.VisualExplorer.dispose();dom.window.close();});
const toggle=(details,open)=>{details.open=open;details.dispatchEvent(new w.Event('toggle'));};

test('closed explorer exact values allocate no rows, then expose all 7121 and refresh the open disclosure',()=>{
 const render=rows=>w.BW.VisualExplorer.render(d.getElementById('chart'),rows,'line','USD',d.getElementById('note'),d.getElementById('values'));
 const create=jest.spyOn(d,'createElement');render(points(7121));
 expect(create.mock.calls.filter(([tag])=>['tr','td'].includes(tag))).toHaveLength(0);
 const details=d.querySelector('.bw-visual-data');expect(details.textContent).toContain('7121 rows');expect(details.querySelector('table')).toBeNull();
 toggle(details,true);expect(details.querySelectorAll('tbody tr')).toHaveLength(7121);expect(details.querySelector('tbody tr').textContent).toContain('0');
 const old=details.querySelector('tbody');toggle(details,true);expect(details.querySelector('tbody')).toBe(old);
 render([{date:'2026-01-01',value:0},{date:'2026-01-02',value:null}]);
 expect(d.querySelector('.bw-visual-data')).toBe(details);expect(details.open).toBe(true);expect(details.querySelectorAll('tbody tr')).toHaveLength(2);expect(details.textContent).toContain('Unavailable');expect(details.textContent).not.toContain('2000-01-01');
 toggle(details,false);expect(details.querySelector('table')).toBeNull();render(points(3));expect(details.querySelector('table')).toBeNull();toggle(details,true);expect(details.querySelectorAll('tbody tr')).toHaveLength(3);
});

test('closed builder source table stays lazy, then preserves existing view limit, raw values and refreshed source data',()=>{
 const large=spec(),small={id:'small',title:'Fresh source',unit:'USD',series:[{name:'Fresh',points:[{date:'2025',value:123.1234567890123,footnote:'Exact note'},{date:'2026',value:null,status:'unavailable'}]}]};
 const create=jest.spyOn(d,'createElement'),controller=w.BW.VisualBuilder.open({...large,datasets:[large,small]});
 expect(create.mock.calls.filter(([tag])=>['tr','td'].includes(tag))).toHaveLength(0);
 const details=controller.dialog.querySelector('.bw-vb-data');expect(details.querySelector('table')).toBeNull();toggle(details,true);
 expect(details.querySelectorAll('tbody tr')).toHaveLength(500);expect(details.textContent).toContain('7121 source observations');expect(JSON.parse(controller.dialog.querySelector('metadata').textContent).series[0].points).toHaveLength(7121);
 const select=controller.dialog.querySelector('[data-vb-field="dataset"]');select.value='small';select.dispatchEvent(new w.Event('change'));
 expect(details.open).toBe(true);expect(details.querySelectorAll('tbody tr')).toHaveLength(2);expect(details.textContent).toContain('123.1234567890123');expect(details.textContent).toContain('Exact note');expect(details.textContent).toContain('unavailable');
 toggle(details,false);expect(details.querySelector('table')).toBeNull();select.value='source';select.dispatchEvent(new w.Event('change'));expect(details.querySelector('table')).toBeNull();toggle(details,true);expect(details.querySelectorAll('tbody tr')).toHaveLength(500);controller.close();
});

test('detached labs dispose owned observer, global chooser listeners and responsive media callback, then recreate once',()=>{
 const addedDocument=jest.spyOn(d,'addEventListener'),removedDocument=jest.spyOn(d,'removeEventListener'),addedWindow=jest.spyOn(w,'addEventListener'),removedWindow=jest.spyOn(w,'removeEventListener');
 w.BW.VisualExplorer.detail(points(3),'Old source','USD');const lab=d.querySelector('.bw-visual-lab'),observer=observers[0];
 const pointer=addedDocument.mock.calls.find(([name])=>name==='pointerdown')[1],resize=addedWindow.mock.calls.find(([name])=>name==='resize')[1],responsive=media[0].addEventListener.mock.calls[0][1];
 lab.remove();observer.callback();expect(observer.disconnect).toHaveBeenCalledTimes(1);expect(removedDocument).toHaveBeenCalledWith('pointerdown',pointer);expect(removedWindow).toHaveBeenCalledWith('resize',resize);expect(media[0].removeEventListener).toHaveBeenCalledWith('change',responsive);
 w.BW.VisualExplorer.refresh();expect(observer.disconnect).toHaveBeenCalledTimes(1);w.BW.VisualExplorer.detail(points(2),'Fresh source','USD');expect(d.querySelectorAll('.bw-visual-lab')).toHaveLength(1);expect(observers).toHaveLength(2);
 w.BW.VisualExplorer.dispose(d.querySelector('.bw-visual-lab'));expect(observers[1].disconnect).toHaveBeenCalledTimes(1);expect(d.querySelector('.bw-visual-lab')).toBeNull();
});


test('lab view changes and disposal cancel pending source-chart inspection work',()=>{
 const frames=new Map();let next=0;w.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};w.cancelAnimationFrame=id=>frames.delete(id);
 w.BW.VisualExplorer.detail(points(30),'Source','USD');const lab=d.querySelector('.bw-visual-lab'),choice=lab.querySelector('.bw-visual-choice');
 choice.value='line';choice.dispatchEvent(new w.Event('change'));let svg=lab.querySelector('.bw-visual-stage svg');
 svg.dispatchEvent(new w.MouseEvent('pointermove',{clientX:200,clientY:100}));expect(frames.size).toBe(1);
 choice.value='histogram';choice.dispatchEvent(new w.Event('change'));expect(frames.size).toBe(0);
 choice.value='line';choice.dispatchEvent(new w.Event('change'));svg=lab.querySelector('.bw-visual-stage svg');svg.dispatchEvent(new w.MouseEvent('pointermove',{clientX:200,clientY:100}));expect(frames.size).toBe(1);
 w.BW.VisualExplorer.dispose(lab);expect(frames.size).toBe(0);svg.dispatchEvent(new w.MouseEvent('pointermove',{clientX:200,clientY:100}));expect(frames.size).toBe(0);
});
