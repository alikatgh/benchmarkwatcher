// Meta-authored growth gap cases be516cf9.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {describeGrowthGap}=require('../app/static/js/components/claim-research.js');
test('positive and negative signs',()=>{
assert.equal(describeGrowthGap('18.25','reported').value,'+18.25 percentage points');
assert.equal(describeGrowthGap('-4.2','scenario').value,'-4.20 percentage points');
});
test('labels and exact passthrough',()=>{
assert.equal(describeGrowthGap('1.5','scenario').label,'Hypothetical growth gap');
assert.equal(describeGrowthGap('1.5','reported').label,'Reported growth gap');
assert.equal(describeGrowthGap('1.5','break_even').label,'Reported growth gap');
assert.equal(describeGrowthGap('1.50','reported').exact,'1.50');
});
test('zero and tiny',()=>{
assert.equal(describeGrowthGap('0','reported').value,'0.00 percentage points');
assert.equal(describeGrowthGap('-0.000','reported').value,'0.00 percentage points');
assert.equal(describeGrowthGap('0.004','reported').value,'+<0.01 percentage points');
assert.equal(describeGrowthGap('-0.004','reported').value,'-<0.01 percentage points');
});
test('missing invalid finite overflow',()=>{
assert.equal(describeGrowthGap(null,'reported').value,'Unavailable');
assert.equal(describeGrowthGap(null,'reported').exact,null);
assert.equal(describeGrowthGap('','reported').exact,null);
assert.equal(describeGrowthGap(' 1.2','reported').exact,null);
assert.equal(describeGrowthGap('1e3','reported').exact,null);
assert.equal(describeGrowthGap('9'.repeat(400),'reported').exact,null);
});
test('basis throws and no mutation',()=>{
assert.throws(()=>describeGrowthGap('1.0','x'));
const s='2.50';describeGrowthGap(s,'reported');assert.equal(s,'2.50');
});
