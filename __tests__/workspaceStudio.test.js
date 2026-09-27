/** @jest-environment jsdom */
const fs=require('fs'), path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../app/static/js/components/workspace_studio.js'),'utf8');
beforeEach(()=>{
 localStorage.clear();
 document.body.innerHTML=`<select id="provider-model"><option value="typesafe:jev">Jev</option><option value="deepseek:chat">DeepSeek</option></select><label id="studio-explanation"><input type="checkbox"></label><div id="studio-explanation-model"><select id="explanation-model"><option value="chat">Chat</option></select></div><form class="manual-form"><select id="operation"><option value="series">Series</option><option value="value">Value</option><option value="change">Change</option></select><div id="studio-periods"><div id="studio-from-field"><select id="start"><option value="q1" data-frequency="quarter">Q1</option><option value="year" data-frequency="annual">Year</option></select></div><select id="end"><option value="q1" data-frequency="quarter">Q1</option><option value="q2" data-frequency="quarter">Q2</option><option value="year" data-frequency="annual" selected>Year</option></select></div><p id="studio-calculation-help"></p></form>`;
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
test('a connected DeepSeek explanation is available alongside either selection provider',()=>{
 const field=document.querySelector('#studio-explanation input');
 const model=document.getElementById('explanation-model');
 expect(field.disabled).toBe(false);expect(model.disabled).toBe(true);
 field.checked=true;field.dispatchEvent(new Event('change'));
 expect(model.disabled).toBe(false);
 choose('provider-model','deepseek:chat');expect(field.disabled).toBe(false);
 choose('provider-model','typesafe:jev');expect(model.disabled).toBe(false);
 field.checked=false;field.dispatchEvent(new Event('change'));expect(model.disabled).toBe(true);
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

function addDock(user='1') {
 document.body.innerHTML=`<div class="workspace has-chat"><aside class="studio-chat" data-chat-user="${user}"><button id="studio-chat-toggle" aria-expanded="true">Minimize</button><div id="studio-chat-body"><textarea id="question"></textarea></div></aside></div>`;
 window.eval(source);
}
test('only an intentional minimize persists, separately for each account',()=>{
 addDock();
 expect(document.getElementById('studio-chat-body').hidden).toBe(false);
 document.getElementById('studio-chat-toggle').click();
 expect(localStorage.getItem('bw-workbook-chat-minimized:1')).toBe('true');
 addDock();expect(document.getElementById('studio-chat-body').hidden).toBe(true);
 document.getElementById('studio-chat-toggle').click();
 expect(document.activeElement.id).toBe('question');
 expect(localStorage.getItem('bw-workbook-chat-minimized:1')).toBe('false');
 localStorage.setItem('bw-workbook-chat-minimized:1','true');
 addDock('2');expect(document.getElementById('studio-chat-body').hidden).toBe(false);
});
test('unavailable browser storage does not break chat or its toggle',()=>{
 const read=jest.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked');});
 const write=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
 try {
  addDock();expect(document.getElementById('studio-chat-body').hidden).toBe(false);
  document.getElementById('studio-chat-toggle').click();
  expect(document.getElementById('studio-chat-body').hidden).toBe(true);
 } finally {read.mockRestore();write.mockRestore();}
});
