/** @jest-environment jsdom */
const fs=require('fs'), path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../app/static/js/components/workspace_studio.js'),'utf8');
beforeEach(()=>{
 document.body.innerHTML=`<select id="provider-model"><option value="typesafe:jev">Jev</option><option value="deepseek:chat">DeepSeek</option></select><label id="studio-explanation"><input type="checkbox"></label><form class="manual-form"><select id="operation"><option value="series">Series</option><option value="value">Value</option><option value="change">Change</option></select><div id="studio-periods"><div id="studio-from-field"><select id="start"><option value="q1" data-frequency="quarter">Q1</option><option value="year" data-frequency="annual">Year</option></select></div><select id="end"><option value="q1" data-frequency="quarter">Q1</option><option value="q2" data-frequency="quarter">Q2</option><option value="year" data-frequency="annual" selected>Year</option></select></div><p id="studio-calculation-help"></p></form>`;
 window.eval(source);
});
function choose(id,value){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('change'));}
test('only the reporting periods used by an operation are submitted',()=>{
 expect(document.getElementById('start').disabled).toBe(true);expect(document.getElementById('end').disabled).toBe(true);
 choose('operation','value');expect(document.getElementById('start').disabled).toBe(true);expect(document.getElementById('end').disabled).toBe(false);
 choose('operation','change');expect(document.getElementById('start').disabled).toBe(false);expect(document.getElementById('end').value).toBe('q2');
 expect(document.getElementById('end').querySelector('[value=year]').disabled).toBe(true);
});
test('an unavailable matching-frequency comparison cannot be submitted',()=>{
 choose('operation','change');choose('start','year');expect(document.getElementById('end').validity.valid).toBe(false);expect(document.getElementById('end').validationMessage).toContain('same frequency');
 choose('operation','series');expect(document.getElementById('end').validationMessage).toBe('');
});
test('DeepSeek-only explanation cannot be submitted with a different provider',()=>{
 const field=document.querySelector('#studio-explanation input');expect(field.disabled).toBe(true);
 choose('provider-model','deepseek:chat');expect(field.disabled).toBe(false);expect(document.getElementById('studio-explanation').hidden).toBe(false);
});
