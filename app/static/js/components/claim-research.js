(function () {
  'use strict';
  // Meta-assisted implementation, reviewed against the local research contract.
  // Draft: 82a1b583-2c14-475d-8e35-591bc71bfecc. No generated code executes itself.
  function createResearchController(options) {
    const o = options || {}, fetchImpl = o.fetchImpl || globalThis.fetch;
    const makeId = o.makeId || (() => globalThis.crypto.randomUUID());
    const setTimer = o.setTimer || setTimeout, clearTimer = o.clearTimer || clearTimeout;
    const allowed = new Set(['MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NFLX', 'AMD', 'NOW', 'PLTR', 'AMGN', 'HON', 'UNP', 'BKNG']);
    const failure = 'The Meta request failed. It was not retried.';
    const timeoutMessage = 'The Meta request timed out. It was not retried.';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    let busy = false, generation = 0, revision = 0;
    const notify = (name, value) => { try { if (typeof o[name] === 'function') o[name](value); } catch (_) {} };
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    function validate(p) {
      if (!object(p) || typeof p.question !== 'string' || !p.question.trim() || p.question.length > 1200) return 'Enter a question of 1 to 1200 characters.';
      if (!Array.isArray(p.companies) || p.companies.length < 1 || p.companies.length > 3 || new Set(p.companies).size !== p.companies.length || p.companies.some(c => !allowed.has(c))) return 'Meta investigates up to three companies; test the full library with Test claim instead.';
      if (!['cash_keeps_pace', 'profit_keeps_pace'].includes(p.claim_id)) return 'Choose a valid claim.';
      if (!['reported', 'scenario', 'break_even'].includes(p.basis)) return 'Choose a valid basis.';
      if (typeof p.adjustment !== 'string' || !/^[+-]?(?:0|[1-9][0-9]?)(?:\.[0-9]{1,24})?$/.test(p.adjustment) || Math.abs(Number(p.adjustment)) > 50) return 'Enter a cash spending adjustment from -50 to 50.';
      if (p.claim_id === 'profit_keeps_pace' && (p.basis !== 'reported' || Number(p.adjustment) !== 0)) return 'The profit claim uses reported figures and no cash adjustment.';
      return null;
    }
    async function submit(payload) {
      if (busy) return false;
      if (o.endpoint !== '/api/research/claims/investigate') { notify('onError', failure); return false; }
      const invalid = validate(payload);
      if (invalid) { notify('onError', invalid); return false; }
      let requestId;
      try { requestId = payload.request_id === undefined ? makeId() : payload.request_id; }
      catch (_) { notify('onError', failure); return false; }
      if (typeof requestId !== 'string' || !uuid.test(requestId)) { notify('onError', failure); return false; }
      generation++; revision++; const current = generation;
      const body = {companies:payload.companies.slice(), claim_id:payload.claim_id, adjustment:payload.adjustment, question:payload.question.trim(), basis:payload.basis, request_id:requestId};
      busy = true; notify('onBusy', true);
      let timer, timedOut = false, publicError = failure;
      try {
        const controller = new AbortController();
        timer = setTimer(() => { timedOut = true; controller.abort(); }, 60000);
        const response = await fetchImpl(o.endpoint, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-CSRF-Token':o.csrf}, body:JSON.stringify(body), signal:controller.signal});
        const text = await response.text();
        if (timedOut) throw new Error('timeout');
        if (text.length > 262144) throw new Error('size');
        const parsed = JSON.parse(text);
        if (!object(parsed)) throw new Error('response');
        if (current !== generation) return false;
        if (object(parsed.meta)) notify('onStatus', parsed.meta);
        if (!response.ok) {
          const messages = {
            budget_exhausted:'The shared Meta allowance is exhausted. No further request will be sent.',
            grant_stopped:'Meta requests have been stopped. The filing proof remains available.',
            grant_expired:'The Meta allowance has expired. The filing proof remains available.',
            grant_busy:'Another Meta question is running. This question was not sent.',
            source_unavailable:'The retained filing evidence could not be verified. No Meta request was sent.'
          };
          if (Object.hasOwn(messages, parsed.code)) publicError = messages[parsed.code];
          throw new Error('response');
        }
        if (!object(parsed.result) || parsed.result.kind !== 'cohort') throw new Error('response');
        notify('onResult', parsed.result);
        return true;
      } catch (_) {
        if (current === generation) notify('onError', timedOut ? timeoutMessage : publicError);
        return false;
      } finally {
        try { clearTimer(timer); } catch (_) {}
        busy = false; notify('onBusy', false);
      }
    }
    return {submit, invalidate:() => { generation++; }, isBusy:() => busy, revision:() => revision};
  }
  function describeGrowthGap(raw, basis){
  var label;
  if(basis==='scenario')label='Hypothetical growth gap';
  else if(basis==='reported'||basis==='break_even')label='Reported growth gap';
  else throw new Error('invalid basis');
  if(typeof raw!=='string'||raw.length===0||raw.length>256)return{label:label,value:'Unavailable',exact:null};
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw))return{label:label,value:'Unavailable',exact:null};
  var n=Number(raw);
  if(!Number.isFinite(n))return{label:label,value:'Unavailable',exact:null};
  var d=raw.replace(/^[+-]/,'').replace('.','');
  var z=true;
  for(var i=0;i<d.length;i++){if(d[i]!=='0'){z=false;break;}}
  if(z)return{label:label,value:'0.00 percentage points',exact:raw};
  var neg=raw[0]==='-';
  var r=Math.abs(n).toFixed(2);
  if(r==='0.00')return{label:label,value:neg?'-<0.01 percentage points':'+<0.01 percentage points',exact:raw};
  return{label:label,value:(neg?'-':'+')+r+' percentage points',exact:raw};
  }
function renderSelectedEvidence(finding,basis,el){var V=['revenue_growth','operating_income_growth','operating_cash_flow_growth','cash_ppe_growth','fcf_growth','margin_change'];var B=['reported','scenario','break_even'];if(B.indexOf(basis)<0)throw new Error('basis');if(!finding||typeof finding!=='object')throw new Error('finding');var t=finding.audit&&finding.audit.ticker;var e=finding.evidence;if(typeof t!=='string'||!e||typeof e!=='object')throw new Error('shape');if(e.company!==t)throw new Error('company');var cs=e.calculations,fs=e.facts;if(!Array.isArray(cs)||cs.length<1||cs.length>4)throw new Error('calcs');if(!Array.isArray(fs)||fs.length>8)throw new Error('facts');var re=/^-?\d+(\.\d+)?$/;function isD(s){return typeof s==='string'&&re.test(s)&&Number.isFinite(Number(s));}var fm=Object.create(null),i,j;for(i=0;i<fs.length;i++){var x=fs[i];if(!x||typeof x.id!=='string')throw new Error('fact');if(fm[x.id])throw new Error('dupFact');var ks=['reported_value','reported_unit','start','end','filed','accession'];for(j=0;j<ks.length;j++)if(typeof x[ks[j]]!=='string')throw new Error('factField');if(!isD(x.reported_value))throw new Error('factVal');fm[x.id]=x;}var seen=Object.create(null);for(i=0;i<cs.length;i++){var c=cs[i];if(!c||typeof c!=='object')throw new Error('calc');if(V.indexOf(c.id)<0||seen[c.id])throw new Error('calcId');seen[c.id]=1;if(typeof c.label!=='string'||!c.label)throw new Error('label');if(c.value!==null&&!isD(c.value))throw new Error('val');if(c.value!==null&&(typeof c.display!=='string'||!c.display))throw new Error('disp');if(c.unit!=='percent'&&c.unit!=='percentage_points')throw new Error('unit');if(typeof c.formula!=='string'||!c.formula)throw new Error('formula');if(!Array.isArray(c.operand_ids)||c.operand_ids.length<1||c.operand_ids.length>4)throw new Error('ops');var st=Object.create(null);for(j=0;j<c.operand_ids.length;j++){var o=c.operand_ids[j];if(typeof o!=='string'||st[o])throw new Error('dupOp');st[o]=1;if(!fm[o])throw new Error('miss:'+o);}}var d=el('details','');d.appendChild(el('summary','Evidence selected for this question ('+cs.length+')'));if(basis==='scenario')d.appendChild(el('p','Reported figures below; the hypothetical scenario is shown separately.'));for(i=0;i<cs.length;i++){var k=cs[i];var v=k.value===null?'Unavailable':k.display;d.appendChild(el('h4',k.label+': '+v));d.appendChild(el('code','Exact value: '+(k.value===null?'Unavailable':k.value)+' '+k.unit));d.appendChild(el('code',k.formula));for(j=0;j<k.operand_ids.length;j++){var f2=fm[k.operand_ids[j]];d.appendChild(el('p',f2.id+' | '+f2.reported_value+' '+f2.reported_unit+' | '+f2.start+' to '+f2.end+' | filed '+f2.filed+' '+f2.accession));}}return d;}
function renderComparisonOverview(result, el){
if(!result||!Array.isArray(result.findings)||result.findings.length===0)return null;if(result.findings.length>3)throw new Error('Too many findings');
if(result.basis!=="reported"&&result.basis!=="scenario"&&result.basis!=="break_even")return null;
if(result.claim_id!=="cash_keeps_pace"&&result.claim_id!=="profit_keeps_pace")return null;
var cash=result.claim_id==="cash_keeps_pace";
var scen=result.basis==="scenario";
var measure=scen?"Hypothetical FCF growth":cash?"FCF growth (reported rows)":"Operating income growth (reported)";
var sec=el("section","","cp-comparison");
var h=el("h3","Finding comparison","");
h.id="cp-investigation-overview";h.tabIndex=-1;sec.append(h);
var note=el("p","Exact fiscal periods differ by company. Positive gap means the measure lagged revenue.","cp-comparison-note");
note.id="cp-investigation-overview-note";sec.append(note);
var sc=el("div","","cp-comparison-scroll");
sc.tabIndex=0;sc.setAttribute("role","region");sc.setAttribute("aria-labelledby",h.id);sc.setAttribute("aria-describedby",note.id);
var t=el("table","","cp-comparison");
t.setAttribute("aria-label","Finding comparison");

var thead=el("thead","","");var hr=el("tr","","");
["Company","Revenue growth (reported)",measure,"Gap vs revenue (pp)","Verdict"].forEach(function(x){var c=el("th",x,"");c.scope="col";hr.append(c);});
thead.append(hr);t.append(thead);
var tb=el("tbody","","");
result.findings.forEach(function(f,i){
var a=f.audit||{};var row=el("tr","","");
var th=el("th","","");th.scope="row";
var link=el("a",(i+1)+". "+a.company+" ("+a.ticker+")","");
link.href="#cp-investigation-finding-"+i;
link.addEventListener("click",function(e){var d=link.ownerDocument.getElementById("cp-investigation-finding-"+i);if(!d)return;e.preventDefault();if(d.scrollIntoView)d.scrollIntoView();if(d.focus)d.focus({preventScroll:true});});
th.append(link);row.append(th);
var rep=describeGrowthGap(a.revenue_growth,result.basis);
var sel=describeGrowthGap(scen?a.scenario_growth:a.actual_growth,result.basis);
var gap=describeGrowthGap(f.gap_percentage_points,result.basis);
var rc=el("td",rep.value.replace(" percentage points","%"),"cp-comparison-number");if(rep.exact!=null)rc.title=rep.exact;row.append(rc);var sc2=el("td",sel.value.replace(" percentage points","%"),"cp-comparison-number");if(sel.exact!=null)sc2.title=sel.exact;row.append(sc2);var gc=el("td",gap.value.replace(" percentage points",""),"cp-comparison-number");if(gap.exact!=null)gc.title=gap.exact;row.append(gc);
var v=f.selected_status==="supported"?"Supported":f.selected_status==="contradicted"?"Contradicted":"Unavailable";
row.append(el("td",v,""));tb.append(row);});
if(!tb.children.length)return null;
t.append(tb);sc.append(t);sec.append(sc);return sec;}
function createOverviewReturn(el){
 const a=el('a','Back to comparison');
 a.setAttribute('href','#cp-investigation-overview');
 a.addEventListener('click',(ev)=>{
  const doc=a.ownerDocument||document;
  const t=doc.getElementById('cp-investigation-overview');
  if(t){
   if(ev)ev.preventDefault();
   try{if(typeof t.focus==='function')t.focus();}catch(e){}
   try{if(typeof t.scrollIntoView==='function')t.scrollIntoView();}catch(e){}
  }
 });
 return a;
}
  if (typeof module !== 'undefined' && module.exports) module.exports = {createResearchController, describeGrowthGap, renderSelectedEvidence, renderComparisonOverview, createOverviewReturn};
  if (typeof document === 'undefined') return;
  const root = document.getElementById('claim-proof'), form = document.getElementById('cp-research-form');
  if (!root || !form) return;
  const scope = document.getElementById('cp-form'), question = document.getElementById('cp-research-question');
  const basis = document.getElementById('cp-research-basis'), button = form.querySelector('[type=submit]');
  const status = document.getElementById('cp-research-status'), results = document.getElementById('cp-research-results');
  const claim = document.getElementById('cp-claim'), adjustment = document.getElementById('cp-adjustment');
  let available = false;
  function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
  function feedback(message, error = false) { status.textContent = message; status.dataset.error = String(error); }
  function showAvailability(meta) {
    available = !!meta && meta.available === true;
    button.disabled = !available || controller.isBusy();
  }
  const percent = value => typeof value === 'string' && Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : 'Unavailable';
  function render(result) {
    if (!Array.isArray(result.findings) || result.findings.length > 3 || !Array.isArray(result.limitations)) throw new Error('Invalid findings');
    const fragment = document.createDocumentFragment();
    fragment.append(el('p', 'MUSE SPARK INVESTIGATION · HISTORICAL FILINGS', 'cp-research-label'), el('h2', result.title), el('p', result.question, 'cp-research-question'), el('p', result.summary));
    const overview = renderComparisonOverview(result, el);
    if (overview) fragment.append(overview);
    for (const [findingIndex, finding] of result.findings.entries()) {
      const card = finding.audit;
      if (!card || !Array.isArray(card.facts) || !Array.isArray(card.formulas)) throw new Error('Invalid evidence');
      const article = el('article', undefined, 'cp-research-finding');
      const detailHeading = el('h3', `${card.ticker} · ${card.company}`);
      detailHeading.id = 'cp-investigation-finding-' + findingIndex;
      detailHeading.tabIndex = -1;
      article.append(detailHeading);
      const hypothetical = result.basis === 'scenario';
      const labels = {supported:'Claim supported', contradicted:'Claim contradicted', unavailable:'Evidence unavailable'};
      article.append(el('p', `${hypothetical ? 'Hypothetical scenario: ' : 'Reported figures: '}${labels[finding.selected_status] || 'Evidence unavailable'}`, 'cp-verdict'));
      if (result.basis === 'break_even') article.append(el('p', `Cash PP&E adjustment for equal growth: ${percent(card.break_even_adjustment_percent)}. ${card.break_even_note || ''}`));
      else article.append(el('p', `${result.claim_id === 'cash_keeps_pace' ? 'Calculated FCF' : 'Operating income'} growth ${percent(hypothetical ? card.scenario_growth : card.actual_growth)}; revenue growth ${percent(card.revenue_growth)}.`));
      if (hypothetical) article.append(el('p', `Assumption: FY2025 cash PP&E payments change by ${percent(result.adjustment)}; operating cash flow and revenue stay fixed.`));
      const gap = describeGrowthGap(finding.gap_percentage_points, result.basis);
      const gapLine = el('p', gap.label + ': ' + gap.value, 'cp-growth-gap');
      if (gap.exact !== null) gapLine.title = 'Exact gap: ' + gap.exact + ' percentage points';
      article.append(gapLine);
      article.append(renderSelectedEvidence(finding, result.basis, el));
      const details = el('details'); details.append(el('summary', 'Inspect calculations and filing evidence'));
      details.append(el('p', 'Exact source values below; headline percentages are rounded.'));
      for (const period of card.period_details || []) details.append(el('p', `${period.id}: ${period.start} to ${period.end}`));
      for (const f of card.formulas) { details.append(el('p', `${f.hypothetical ? 'Hypothetical · ' : ''}${f.label}: ${f.value === null ? 'Unavailable' : f.value} ${f.unit}`), el('code', f.formula)); }
      for (const f of card.facts) {
        const row = el('div', undefined, 'cp-fact'); row.append(el('strong', f.id), el('span', `${f.reported_value} ${f.reported_unit} reported`), el('span', `${f.start} to ${f.end} · Filed ${f.filed}`));
        try { const url = new URL(f.url); if (url.protocol === 'https:' && url.hostname === 'www.sec.gov' && !url.username && !url.password) { const a = el('a', 'Open SEC filing'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); } } catch (_) {}
        details.append(row);
      }
      article.append(details, createOverviewReturn(el)); fragment.append(article);
    }
    for (const limitation of result.limitations) fragment.append(el('p', limitation, 'cp-research-limitation'));
    if (!result.findings.length && !result.limitation) fragment.append(el('p', 'No selected company matches the requested filter. Ask again for all companies to see every verdict; the filing proof below is unchanged.', 'cp-note'));
    results.replaceChildren(fragment); results.hidden = false;
  }
  const controller = createResearchController({endpoint:root.dataset.researchEndpoint, csrf:root.dataset.csrf,
    onBusy:busy => { button.disabled = busy || !available; button.textContent = busy ? 'Investigating…' : 'Ask Muse Spark'; results.setAttribute('aria-busy', String(busy)); },
    onStatus:showAvailability,
    onResult:result => { try { render(result); feedback('Muse Spark selected the evidence. The answer was calculated from retained filing facts.'); } catch (_) { feedback('The evidence could not be displayed. No further request was made.', true); } },
    onError:message => feedback(message, true)
  });
  function invalidate() {
    controller.invalidate(); results.hidden = true;
    feedback(controller.isBusy() ? 'Selection changed. The in-flight answer will be discarded; no second request was started.' : available ? 'Ask a question about your current selection.' : 'Meta is not connected. You can still test claims and inspect the evidence.');
    if (claim.value === 'profit_keeps_pace') basis.value = 'reported';
    basis.disabled = claim.value === 'profit_keeps_pace';
  }
  scope.addEventListener('change', invalidate); adjustment.addEventListener('input', invalidate);
  document.getElementById('cp-reset').addEventListener('click', invalidate);
  question.addEventListener('input', invalidate); basis.addEventListener('change', invalidate);
  form.querySelectorAll('[data-question]').forEach(example => example.addEventListener('click', () => { question.value = example.dataset.question; invalidate(); question.focus(); }));
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!available || controller.isBusy() || !form.reportValidity() || !scope.reportValidity()) return;
    results.hidden = true; feedback('Meta is selecting evidence from your chosen companies…');
    controller.submit({question:question.value, companies:Array.from(scope.querySelectorAll('[name=company]:checked'), node => node.value), claim_id:claim.value, adjustment:adjustment.value, basis:basis.value});
  });
  const checkBtn = el('button', 'Check connection', 'cp-connection-check');
  checkBtn.type = 'button';
  status.after(checkBtn);
  let checking = false;
  function msgFor(code) {
    if (code === 'grant_busy') return 'Meta is busy with another question. Check the connection manually after it finishes.';
    if (code === 'budget_exhausted') return 'Meta is unavailable: budget exhausted.';
    if (code === 'grant_stopped') return 'Meta is unavailable: grant stopped.';
    if (code === 'grant_expired') return 'Meta is unavailable: grant expired.';
    if (code === 'not_activated') return 'Meta is not activated in this preview.';
    if (code === 'credential_missing_or_invalid') return 'Meta is unavailable: missing or invalid credentials.';
    if (code === 'ledger_unavailable') return 'Meta ledger is unavailable.';
    return 'Meta is not connected in this preview. You can still test claims and inspect the evidence.';
  }
  async function checkConnection() {
    if (checking) return Promise.resolve();
    if (controller.isBusy()) return Promise.resolve();
    const revision = (typeof controller.revision === 'function') ? controller.revision() : 0;
    checking = true;
    checkBtn.disabled = true;
    let timedOut = false;
    const sc = new AbortController();
    const tm = setTimeout(() => { timedOut = true; sc.abort(); }, 5000);
    try {
      const r = await fetch(root.dataset.researchStatus, { credentials: 'same-origin', signal: sc.signal });
      if (timedOut) throw new Error('timeout');
      if (r.status !== 200) throw new Error('status');
      const t = await r.text();
      if (timedOut) throw new Error('timeout');
      if ((t || '').length > 8192) throw new Error('too_large');
      const b = JSON.parse(t || '');
      const meta = (b && typeof b.meta === 'object' && b.meta !== null && !Array.isArray(b.meta)) ? b.meta : {};
      if (controller.isBusy() || (typeof controller.revision === 'function' && controller.revision() !== revision)) return;
      const code = typeof meta.code === 'string' ? meta.code : '';
      const ok = meta !== null && typeof meta === 'object' && !Array.isArray(meta) && code === 'ready' && meta.available === true;
      if (ok) { showAvailability(meta); feedback('Ready. Only Ask Meta sends a model request; calculations and downloads are local.'); }
      else { showAvailability({ available: false }); feedback(code === 'ready' ? 'Meta is not connected in this preview. You can still test claims and inspect the evidence.' : msgFor(code)); }
    } catch (e) {
      if (controller.isBusy() || (typeof controller.revision === 'function' && controller.revision() !== revision)) return;
      available = false;
      button.disabled = true;
      feedback('Meta is unavailable. The filing proof below remains usable.');
    } finally {
      clearTimeout(tm);
      checking = false;
      checkBtn.disabled = false;
    }
  }
  checkBtn.addEventListener('click', () => { checkConnection(); });
  checkConnection();
}());
