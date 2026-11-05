const test = require('node:test');
const assert = require('node:assert/strict');
const {buildInvestigationBrief} = require('../app/static/js/components/claim-proof.js');
// Markdown escapes preserve the visible exact value; they are not changed data.
function unescapeInline(text) { return text.replace(/\\([\\`*_{}\[\]()#+\-.!|])/g,'$1'); }
function proof() {
  return {claim_id:'cash_keeps_pace',claim:'Free cash flow growth kept pace with revenue growth',periods:['FY2024','FY2025'],comparison_basis:'Each issuer fiscal year',sensitivity:{cash_ppe_adjustment_percent:'-25'},actual_counts:{supported:0,contradicted:1,unavailable:0},scenario_counts:{supported:1,contradicted:0,unavailable:0},companies:[{ticker:'MSFT',company:'Microsoft Corporation',actual_status:'contradicted',scenario_status:'supported',actual_growth:'-3.320001',revenue_growth:'14.930001',scenario_growth:'18.470001',period_details:[{id:'FY2024',start:'2023-07-01',end:'2024-06-30'},{id:'FY2025',start:'2024-07-01',end:'2025-06-30'}],actuals:[],formulas:[],facts:[{id:'FY2025.revenue',reported_value:'281724000000',reported_unit:'USD',value:'281724',unit:'USD_millions',filed:'2025-07-30',accession:'0000950170-25-100235',source_sha256:'a'.repeat(64),url:'https://www.sec.gov/Archives/example.html'}],citations:[],measurement_note:'Calculated FCF differs from some issuer definitions.',break_even_adjustment_percent:'-20.95',break_even_note:'Historical sensitivity, not a business cause.'}]};
}
test('brief preserves scope, dates, reported verdict and separately labeled hypothetical result', () => {
  const input=proof(), before=JSON.stringify(input), artifact=buildInvestigationBrief(input);
  assert.match(artifact.filename,/^benchmarkwatcher-brief-cash_keeps_pace\.md$/);
  for(const text of ['MSFT','FY2024','FY2025','2023-07-01','2024-06-30','2024-07-01','2025-06-30','contradicted','supported','-25.00%','https://www.sec.gov/Archives/example.html','0000950170-25-100235','a'.repeat(64)]) assert.ok(unescapeInline(artifact.text).includes(text), text);
  assert.match(artifact.text,/hypothetical/i); assert.match(artifact.text,/historical|retained/i); assert.match(artifact.text,/not.*latest|not.*current/i);
  assert.equal(JSON.stringify(input),before);
});
test('zero adjustment and operating-income brief omit hypothetical verdicts', () => {
  const zero=proof(); zero.sensitivity.cash_ppe_adjustment_percent='0';
  const a=buildInvestigationBrief(zero); assert.doesNotMatch(a.text,/Hypothetical PP&E scenario/);
  zero.claim_id='profit_keeps_pace';zero.claim='Operating income growth kept pace with revenue growth';
  const b=buildInvestigationBrief(zero); assert.match(b.text,/Operating income/);assert.doesNotMatch(b.text,/Hypothetical PP&E scenario/);
});
test('brief refuses invalid scope and bounded-output violations', () => {
  for(const input of [null,{}, {...proof(),claim_id:'../escape'}, {...proof(),csrf:'private'}, {...proof(),companies:[]}, {...proof(),comparison_basis:'x'.repeat(300000)}]) assert.throws(()=>buildInvestigationBrief(input));
});
test('unavailable evidence never becomes a zero-growth conclusion', () => {
  const input=proof();Object.assign(input.companies[0],{actual_status:'unavailable',scenario_status:'unavailable',actual_growth:null,scenario_growth:null,revenue_growth:null});
  input.actual_counts={supported:0,contradicted:0,unavailable:1}; input.scenario_counts={...input.actual_counts};
  const output=buildInvestigationBrief(input).text; assert.match(output,/unavailable/i); assert.doesNotMatch(output,/growth was 0.00%/);
});
test('brief cannot create active HTML, markdown images, or unsafe source links', () => {
  const input=proof();input.companies[0].company='<img src=x onerror=alert(1)> ![x](https://evil.test/x)';
  input.companies[0].measurement_note='[click](javascript:alert(1))';input.companies[0].facts[0].url='javascript:alert(1)';
  const output=buildInvestigationBrief(input).text;
  assert.doesNotMatch(output,/<img|!\[x\]\(|\[click\]\(javascript:|<javascript:/);
});
test('hypothetical formulas are segregated and never leak into reported or profit sections', () => {
  const input=proof();input.companies[0].formulas=[{label:'Reported formula',value:'1',unit:'percent',formula:'reported operand',hypothetical:false},{label:'Scenario formula',value:'2',unit:'percent',formula:'scenario operand',hypothetical:true}];
  const result=unescapeInline(buildInvestigationBrief(input).text);
  const marker=result.indexOf('## Hypothetical'); assert.ok(marker>0);
  assert.ok(result.indexOf('reported operand')<marker); assert.ok(result.indexOf('scenario operand')>marker);
  input.sensitivity.cash_ppe_adjustment_percent='0';assert.doesNotMatch(buildInvestigationBrief(input).text,/scenario operand/);
  input.claim_id='profit_keeps_pace';assert.doesNotMatch(buildInvestigationBrief(input).text,/scenario operand/);
});
test('missing quantities stay unavailable and malformed nested records fail', () => {
  const input=proof();input.companies[0].facts[0].reported_value=null;input.companies[0].facts[0].value=undefined;
  const text=buildInvestigationBrief(input).text;assert.doesNotMatch(text,/reported null|normalized undefined/);assert.match(text,/Unavailable/);
  for(const key of ['facts','formulas','period_details']) for(const item of [null,'not a record',1,[]]) {
    const bad=proof();bad.companies[0][key]=[item];assert.throws(()=>buildInvestigationBrief(bad));
  }
});
test('UTF-8 expansion is bounded without dropping source evidence', () => {
  const input=proof();input.companies[0].measurement_note='界'.repeat(22000);
  assert.throws(()=>buildInvestigationBrief(input));
});
// Muse Spark e73064ca test draft, adapted to the artifact return contract.
test('brief preserves exact decimal strings including zero and negative long precision', () => {
  const input=proof();
  input.companies[0].facts = [
    {id:'f-zero',reported_value:'0',reported_unit:'USD',value:'0',unit:'USD'},
    {id:'f-neg',reported_value:'-3.320001',reported_unit:'%',value:'-0.00000100',unit:'%'},
    {id:'f-long',reported_value:'281724000000.123456789012345',reported_unit:'USD',value:'14.930001',unit:'%'},
    {id:'f-num',reported_value:0,reported_unit:'USD',value:123,unit:'USD'}
  ];
  const plain=unescapeInline(buildInvestigationBrief(input).text);
  assert.ok(plain.includes('f-zero reported 0 USD normalized 0 USD'));
  for(const value of ['-3.320001','-0.00000100','281724000000.123456789012345','14.930001']) assert.ok(plain.includes(value),value);
  assert.ok(plain.includes('f-num reported Unavailable USD normalized Unavailable USD'));
});
test('brief rejects nonboolean formula scope while accepting both boolean scopes', () => {
  const formula={label:'FCF growth',value:'1.23',unit:'%',formula:'(a-b)/b'};
  for(const value of [undefined,null,'true','false',0,1]) {
    const input=proof();input.companies[0].formulas=[{...formula,hypothetical:value}];
    assert.throws(()=>buildInvestigationBrief(input));
  }
  for(const value of [false,true]) {
    const input=proof();input.companies[0].formulas=[{...formula,hypothetical:value}];
    assert.equal(typeof buildInvestigationBrief(input).text,'string');
  }
});
test('brief refuses unsafe source origins and encodes valid SEC destination punctuation', () => {
  for(const url of ['http://www.sec.gov/a','https://sec.gov/a','https://www.sec.gov.evil.com/a','https://user@www.sec.gov/a','javascript:alert(1)']) {
    const input=proof();input.companies[0].facts[0].url=url;
    assert.doesNotMatch(buildInvestigationBrief(input).text,/\[SEC filing\]\(/);
  }
  const input=proof();input.companies[0].facts[0].url='https://www.sec.gov/Archives/(test).html';
  const text=buildInvestigationBrief(input).text;
  assert.ok(text.includes('[SEC filing](https://www.sec.gov/Archives/%28test%29.html)'));
  input.companies[0].facts[0].url='https://www.sec.gov/Archives/ex ample<1>.html';
  assert.ok(buildInvestigationBrief(input).text.includes('https://www.sec.gov/Archives/ex%20ample%3C1%3E.html'));
});
