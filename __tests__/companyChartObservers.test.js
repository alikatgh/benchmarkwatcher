/** @jest-environment node */
const fs=require('fs');
const {JSDOM}=require('jsdom');

test('company charts ignore scroll classes, redraw for effective themes and clean every observer/frame on final exit',()=>{
    const report={cik:'1',company:'Fixture Company',checked:'2026-10-23',basis:'Saved fixture',periods:[{id:'fy',frequency:'annual',end:'2025-12-31',label:'2025'}],sections:{balance:'Balance sheet'},metrics:[{id:'assets',label:'Total assets',unit:'USD',section:'balance',values:{fy:{value:12,method:'Reported',sources:[]}}}]};
    const calculation={metric:'Total assets',metric_id:'assets',unit:'USD',frequency:'annual',points:[{end:'2025-12-31',period:'2025',value:12}]};
    const dom=new JSDOM(`<main data-company-workspace><input name="csrf" value="fixture"><script id="company-report-data" type="application/json"></script>
    <div class="company-report-layout"><select id="company-metric"><option value="assets">Assets</option></select><select id="company-chart-type"><option value="line">Line</option></select><select id="company-range"><option value="all">All</option></select>
    <div id="company-chart"></div><div id="company-chart-readout"></div><p id="company-chart-caption"></p><div><table id="company-table"></table></div><div id="company-table-empty"></div><p id="company-table-note"></p>
    <dialog id="company-source"></dialog><button id="company-source-close"></button><button id="company-chat-open"></button><aside id="company-chat"><button id="company-chat-close"></button><form id="company-chat-form"><input name="previous"><input type="checkbox" name="consent"><textarea id="company-question"></textarea><button type="submit">Ask</button></form><select id="company-provider"><option value="local">Local</option></select><div id="company-consent"></div><button id="company-new-topic"></button><p id="company-chat-status"></p><div id="company-conversation"><details class="company-answer-data"><div class="company-answer-chart"></div></details></div></aside></div></main>`,{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,d=w.document,observers=[],frames=new Map(),draws=[],destroyed=[];let serial=0;
    d.getElementById('company-report-data').textContent=JSON.stringify(report);
    d.querySelector('.company-answer-chart').dataset.calculation=JSON.stringify(calculation);
    Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get:()=>640});
    Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get:()=>270});
    w.matchMedia=()=>({matches:true,addEventListener(){}});
    w.ResizeObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
    w.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
    w.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};w.cancelAnimationFrame=id=>frames.delete(id);
    w.BW={Visuals:{timeSeries:()=>{const index=draws.push(true);return {destroy:()=>destroyed.push(index)};}}};
    const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());};
    try{
        w.eval(fs.readFileSync('app/static/js/components/company_research.js','utf8'));
        expect(draws).toHaveLength(1);observers[0].callback([{contentRect:{width:640}}]);expect(frames.size).toBe(0);const details=d.querySelector('details');details.open=true;details.dispatchEvent(new w.Event('toggle'));flush();expect(draws).toHaveLength(2);
        d.documentElement.classList.add('bw-scrolled');observers.filter((_,index)=>index===1 || index===3).forEach(observer=>observer.callback([]));
        expect(frames.size).toBe(0);expect(draws).toHaveLength(2);
        d.documentElement.setAttribute('data-theme','dark');observers[1].callback([]);observers[3].callback([]);expect(frames.size).toBe(2);flush();expect(draws).toHaveLength(4);
        observers[2].callback([]);expect(frames.size).toBe(0);
        w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:true}));expect(observers.some(observer=>observer.disconnected)).toBe(false);
        d.documentElement.setAttribute('data-theme','light');observers[1].callback([]);observers[3].callback([]);const pending=[...frames.values()];
        w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:false}));expect(frames.size).toBe(0);expect(observers.every(observer=>observer.disconnected)).toBe(true);
        expect(destroyed).toHaveLength(4);pending.forEach(callback=>callback());expect(draws).toHaveLength(4);
    } finally{dom.window.close();}
});
