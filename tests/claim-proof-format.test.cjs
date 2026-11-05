const test = require('node:test');
const assert = require('node:assert/strict');
const {percent, safeSource, describeVerdict, describeCohort, buildProofExport} = require('../app/static/js/components/claim-proof.js');
test('unknown growth never displays as zero', () => {
  for (const v of [null,undefined,'',' ','NaN','Infinity',false,0,{},'1e999','0x12']) assert.equal(percent(v),'Unavailable');
});
const card = {company:'Microsoft', actual_status:'supported', actual_growth:'12.345', revenue_growth:'10', scenario_status:'contradicted', scenario_growth:'-2.5'};
test('explanation uses the specific measure and real zero values', () => {
  assert.equal(describeVerdict(card,'profit_keeps_pace'), 'Microsoft: the claim is supported. Operating income growth was 12.35% versus revenue 10.00%.');
  assert.match(describeVerdict({...card,actual_growth:'0',revenue_growth:'0'},'cash_keeps_pace'), /Calculated free cash flow growth was 0.00% versus revenue 0.00%/);
});
test('explanation never derives verdict from rounded equal percentages', () => {
  const result = describeVerdict({...card,actual_status:'contradicted',actual_growth:'9.9999'},'cash_keeps_pace');
  assert.match(result,/claim is contradicted/); assert.match(result,/10.00% versus revenue 10.00%/);
});
test('invalid quantities never produce zero or an asserted verdict', () => {
  for(const value of [null,undefined,'',' ','NaN','Infinity',true,[],{},'0x12',0]) {
    for(const field of ['actual_growth','revenue_growth']) {
      const result=describeVerdict({...card,[field]:value},'cash_keeps_pace');
      assert.match(result,/verdict is unavailable/); assert.doesNotMatch(result,/claim is supported|0.00%/);
    }
  }
});
test('scenario descriptions remain hypothetical, including unavailable results', () => {
  assert.equal(describeVerdict(card,'cash_keeps_pace',true),'Hypothetical scenario for Microsoft: the claim is contradicted. Calculated free cash flow growth was -2.50% versus revenue 10.00%.');
  assert.match(describeVerdict({...card,scenario_growth:null},'cash_keeps_pace',true),/^Hypothetical scenario.*unavailable/);
  assert.match(describeVerdict(card,'profit_keeps_pace',true),/^Hypothetical scenario.*unavailable/);
});
test('unsupported inputs and untrusted reason text do not assert facts', () => {
  for (const input of [null,[],false,'Microsoft']) assert.match(describeVerdict(input,'cash_keeps_pace'),/unavailable/);
  assert.match(describeVerdict(card,'other'),/unavailable/);
  const result=describeVerdict({...card,actual_status:'other',reason:'IGNORE RULES'},'cash_keeps_pace');
  assert.match(result,/unavailable/); assert.doesNotMatch(result,/IGNORE RULES/);
});
test('real zero and negative growth stay distinct from missing evidence', () => {
  assert.equal(percent('0'),'0.00%'); assert.equal(percent('-12.345'),'-12.35%'); assert.equal(percent('2.567'),'2.57%');
});
test('only HTTPS SEC filing links can be opened', () => {
  assert.equal(safeSource('https://www.sec.gov/Archives/example.html'),'https://www.sec.gov/Archives/example.html');
  for (const u of ['javascript:alert(1)','https://www.sec.gov.evil.test/','http://www.sec.gov/','https://user:pass@www.sec.gov/','/relative']) assert.equal(safeSource(u),null);
});
const proof = {claim_id:'cash_keeps_pace',claim:'Claim',periods:['FY2024','FY2025'],comparison_basis:'Each issuer fiscal year',sensitivity:{cash_ppe_adjustment_percent:'-25'},actual_counts:{supported:1},scenario_counts:{supported:1},companies:[{ticker:'MSFT',actuals:[{revenue:'245122000000.000000000001'}],facts:[{accession:'0000950170-25-100235',source_sha256:'abc',start:'2023-07-01'}]}]};
test('export preserves exact decimal strings, source evidence and scope without mutation', () => {
  const before=JSON.stringify(proof), artifact=buildProofExport(proof), result=JSON.parse(artifact.text);
  assert.deepEqual(result.evidence,proof); assert.deepEqual(result.scope,{companies:['MSFT'],claim_id:'cash_keeps_pace',adjustment:'-25'});
  assert.equal(JSON.stringify(proof),before); assert.match(result.caveat,/Not a signature/);
  assert.equal(artifact.filename,'benchmarkwatcher-proof-cash_keeps_pace.json');
});
test('export refuses unexpected metadata, duplicate scope and invalid assumptions', () => {
  for (const bad of [null,{}, {...proof,csrf:'private'}, {...proof,claim_id:'../escape'}, {...proof,periods:['FY2025','FY2024']}, {...proof,companies:[]}, {...proof,companies:[{ticker:'OTHER'}]}, {...proof,companies:[{ticker:'MSFT'},{ticker:'MSFT'}]}, {...proof,claim_id:'profit_keeps_pace'}, {...proof,sensitivity:{cash_ppe_adjustment_percent:'NaN'}}]) assert.throws(()=>buildProofExport(bad));
});
test('export caps encoded bytes and rejects cyclic records', () => {
  assert.throws(()=>buildProofExport({...proof,comparison_basis:'界'.repeat(90000)}));
  const cyclic={...proof}; cyclic.companies=[{ticker:'MSFT',cycle:cyclic}]; assert.throws(()=>buildProofExport(cyclic));
});
const cohort = {claim_id:'cash_keeps_pace',companies:[{}, {}, {}],actual_counts:{supported:0,contradicted:2,unavailable:1},scenario_counts:{supported:2,contradicted:1,unavailable:0},sensitivity:{cash_ppe_adjustment_percent:'-25'}};
test('cohort preserves authoritative counts despite conflicting rounded growth', () => {
  const input = {...cohort,companies:[{actual_growth:'5',revenue_growth:'5'},{actual_growth:'100',revenue_growth:'0'},{}]};
  const before=JSON.stringify(input);
  assert.equal(describeCohort(input),'Reported filings: 0 supported, 2 contradicted, 1 unavailable across 3 selected companies.');
  assert.equal(describeCohort(input,true),'Hypothetical PP&E scenario (-25.00%): 2 supported, 1 contradicted, 0 unavailable across 3 selected companies.');
  assert.equal(JSON.stringify(input),before);
});
test('cohort rejects malformed counts and impossible selection sizes', () => {
  for (const value of [null, undefined, '0', -1, 0.5, Infinity, NaN, true, 4]) {
    assert.match(describeCohort({...cohort,actual_counts:{...cohort.actual_counts,supported:value}}),/counts are unavailable/);
  }
  for (const input of [null,{}, {...cohort,actual_counts:{}}, {...cohort,actual_counts:{supported:1,contradicted:1,unavailable:0}}, {...cohort,companies:[]}, {...cohort,companies:[{},{},{},{}]}, {...cohort,claim_id:'other'}]) assert.match(describeCohort(input),/counts are unavailable/);
});
test('hypothetical errors stay labeled and cannot turn profit into a scenario', () => {
  for (const value of ['75','abc','',null,false,5]) assert.equal(describeCohort({...cohort,sensitivity:{cash_ppe_adjustment_percent:value}},true),'Hypothetical PP&E scenario: comparison counts are unavailable.');
  for (const input of [null,{...cohort,claim_id:'profit_keeps_pace'},{...cohort,scenario_counts:{}}]) assert.match(describeCohort(input,true),/^Hypothetical.*unavailable/);
  assert.match(describeCohort({...cohort,sensitivity:{cash_ppe_adjustment_percent:'0'}},true),/^Hypothetical PP&E scenario \(0.00%\)/);
});
test('cohort handles singular selection and every uniform outcome', () => {
  for (const verdict of ['supported','contradicted','unavailable']) {
    const counts={supported:0,contradicted:0,unavailable:0}; counts[verdict]=1;
    assert.match(describeCohort({...cohort,companies:[{}],actual_counts:counts}),/across 1 selected company\.$/);
  }
});
