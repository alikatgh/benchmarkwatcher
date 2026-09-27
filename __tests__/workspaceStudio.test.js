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

test('chat examples do not submit and repeated sends are prevented until a page restore',()=>{
 document.body.insertAdjacentHTML('beforeend',`<form class="studio-chat-form"><textarea id="question"></textarea><button type="button" data-chat-question="Show Revenue across the available periods">Example</button><button type="submit">Send and save</button><p class="studio-chat-status" role="status" hidden></p></form>`);
 window.eval(source);
 const form=document.querySelector('.studio-chat-form'), send=form.querySelector('[type=submit]');
 const submit=jest.fn();form.addEventListener('submit',submit);
 form.querySelector('[data-chat-question]').click();
 expect(submit).not.toHaveBeenCalled();expect(document.getElementById('question').value).toContain('Revenue');
 expect(document.activeElement).toBe(document.getElementById('question'));
 expect(form.dispatchEvent(new Event('submit',{cancelable:true}))).toBe(true);
 expect(send.disabled).toBe(true);
 expect(form.querySelector('.studio-chat-status').hidden).toBe(false);
 expect(form.dispatchEvent(new Event('submit',{cancelable:true}))).toBe(false);
 window.dispatchEvent(new Event('pageshow'));
 expect(send.disabled).toBe(false);expect(form.querySelector('.studio-chat-status').hidden).toBe(true);
});
