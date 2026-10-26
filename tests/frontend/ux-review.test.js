/** @jest-environment node */
const fs=require('fs');
const path=require('path');
const {DECK,boot,session,settle,routesFor}=require('./harness');

async function open(extra={},setup){
  const window=boot({...routesFor({local:()=>({sessions:[session('alpha')]})}),...extra},null,w=>{
    w.localStorage.setItem('cc.active','alpha');w.localStorage.setItem('cc.mode.d','screen');
    if(setup)setup(w);
  });
  await settle();await settle();return window;
}
const press=(w,target,key,code=key)=>{
  const event=new w.KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;
};

test('screen shortcuts preserve Tab and leave links and controls alone',async()=>{
  const sent=[];
  const w=await open({'/api/send':(url,options)=>{sent.push(JSON.parse(options.body).key);return {ok:true}}});
  try{
    const d=w.document,pre=d.getElementById('pre');d.activeElement.blur();
    expect(press(w,d.body,'Tab').defaultPrevented).toBe(false);
    expect(press(w,d.body,'Enter').defaultPrevented).toBe(true);  // Nothing focused: the menu key still goes.
    pre.focus();expect(d.activeElement).toBe(pre);
    expect(press(w,pre,'Tab').defaultPrevented).toBe(false);
    expect(press(w,pre,'Enter').defaultPrevented).toBe(true);
    const link=d.createElement('a');link.href='#example';link.textContent='Open';pre.append(link);link.focus();
    expect(press(w,link,'Enter').defaultPrevented).toBe(false);
    const button=d.createElement('button');pre.append(button);button.focus();
    expect(press(w,button,'Enter').defaultPrevented).toBe(false);
    await settle();expect(sent).toEqual(['Enter','Enter']);
  }finally{w.close()}
});

test('send feedback remains available while the keyboard is open, including a failed send',async()=>{
  let release;
  const w=await open({'/api/send':()=>new Promise(resolve=>{release=resolve})});
  try{
    const d=w.document,field=d.getElementById('msg'),state=d.getElementById('send_state');
    d.body.classList.add('keyboard-open');field.focus();field.value='Please send';
    const pending=w.send();await settle();expect(state.classList.contains('pending')).toBe(true);
    release({__status:400,error:'Send failed'});await pending;
    expect(state.classList.contains('error')).toBe(true);expect(state.textContent).toContain('Send failed');
    expect(d.activeElement).toBe(field);expect(field.value).toBe('Please send');
    const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/style.css'),'utf8');
    expect(css).not.toMatch(/body\.keyboard-open \.composer-status[,{]/);
    expect(css).toContain('#send_state:not(.pending):not(.error):not(.success)');
  }finally{w.close()}
});

test('an open conversation refreshes on session and history polls while keeping reading position and selection',async()=>{
  let turns=[{role:'user',text:'First question'}];
  const w=await open({'/api/session_info':()=>({supported:true,context:{tokens:20}}),'/api/conversation':()=>({supported:true,turns})});
  try{
    await w.openConversation();const d=w.document,list=d.getElementById('talk_list'),first=list.firstChild;
    Object.defineProperties(list,{scrollHeight:{value:1000},clientHeight:{value:200}});list.scrollTop=123;
    turns=[...turns,{role:'assistant',text:'Fresh answer'}];
    await w.loadSessionInfo();await settle();
    expect(list.children).toHaveLength(2);expect(list.firstChild).toBe(first);expect(list.scrollTop).toBe(123);
    const text=first.querySelector('.talk-text').firstChild,range=d.createRange();range.setStart(text,0);range.setEnd(text,5);
    const selection=w.getSelection();selection.removeAllRanges();selection.addRange(range);
    turns=[...turns,{role:'user',text:'Next question'}];
    await w.eval('loadScreenHistory(sessionInfoKey())');
    expect(selection.toString()).toBe('First');expect(list.firstChild).toBe(first);expect(list.children).toHaveLength(3);
    turns=[{role:'user',text:'Changed question'},...turns.slice(1)];await w.eval('loadScreenHistory(sessionInfoKey())');
    expect(selection.toString()).toBe('First');
    selection.removeAllRanges();await w.eval('loadScreenHistory(sessionInfoKey())');
    expect(list.children).toHaveLength(3);expect(list.scrollTop).toBe(123);
    list.scrollTop=800;turns=[...turns,{role:'assistant',text:'Latest'}];await w.refreshConversation();
    expect(list.scrollTop).toBe(1000);
    w.closeConversation();const count=list.children.length;await w.refreshConversation();expect(list.children).toHaveLength(count);
  }finally{w.close()}
});

test('the new session form shows install, sign-in, model setup, and ready states',async()=>{
  const w=await open({'/api/agents':()=>({claude:{installed:false},codex:{installed:true,logged_in:false},pi:{installed:true,logged_in:true},kimi:{installed:true},kimi_config:{configured:false}})});
  try{
    await w.openNew();await settle();const d=w.document,status=d.getElementById('n_agent_status'),step=d.getElementById('n_agent_step');
    w.pickAgent('claude');expect(status.textContent).toBe('Агент не установлен');expect(step.textContent).toBe('Установить');
    w.pickAgent('codex');expect(status.textContent).toBe('Агенту нужен вход');expect(step.textContent).toBe('Войти');
    w.pickAgent('pi');expect(status.textContent).toBe('Для Pi подключите локальную модель');expect(step.textContent).toBe('Настроить модели');
    w.eval('lmData.profiles=[{id:"local",name:"Local",models:[{id:"model",name:"Model"}]}];renderSources()');
    expect(status.textContent).toBe('Готов к запуску');expect(step.hidden).toBe(true);
    w.pickAgent('kimi');expect(status.textContent).toBe('Сохраните ключ Kimi в настройках');
    w.pickAgent('shell');expect(status.textContent).toBe('Готов к запуску');
    w.eval('lastAg={};pickAgent("claude")');expect(status.textContent).toBe('Готовность агента ещё не проверена');
  }finally{w.close()}
});

test('the Pi startup error has actionable localized copy in every locale',async()=>{
  const key='Pi requires a saved local model and conversation ID';
  const catalogs=fs.readdirSync(path.resolve(__dirname,'../../locales')).filter(n=>n.endsWith('.json'));
  for(const file of catalogs){
    const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../locales',file),'utf8'));
    expect(data.messages[key]).toBeTruthy();expect(data.messages[key]).not.toBe(key);
  }
  const w=await open({'/api/new':()=>({__status:400,error:key})});
  try{
    w.eval(`I18N.messages[${JSON.stringify(key)}]="Connect a local model in Settings"`);
    await expect(w.eval('api("/api/new",{name:"pi"})')).rejects.toThrow('Connect a local model in Settings');
  }finally{w.close()}
});

const question=(name,id='one')=>({session:name,id,title:'Choose',question:'Pick one',options:[{label:'Yes'},{label:'Other',text:true}]});
test('Inbox polls preserve option nodes, keyboard focus, and typed answers as other questions change',async()=>{
  let questions=[question('alpha')];
  const w=await open({'/api/inbox':()=>({questions})});
  try{
    w.openInbox();await settle();const d=w.document,list=d.getElementById('inbox_list'),row=list.firstChild;
    const option=row.querySelector('.q-opt');expect(option).not.toBeNull();option.focus();
    await w.loadInbox();expect(list.firstChild).toBe(row);expect(d.activeElement).toBe(option);
    questions=[question('bravo','two'),question('alpha')];await w.loadInbox();
    expect(list.children[1]).toBe(row);expect(d.activeElement).toBe(option);
    row.querySelectorAll('.q-opt')[1].click();const field=row.querySelector('textarea');field.value='My answer';field.dispatchEvent(new w.Event('input',{bubbles:true}));
    questions=[question('alpha')];await w.loadInbox();expect(list.firstChild).toBe(row);
    expect(d.activeElement).toBe(field);expect(field.value).toBe('My answer');
    questions=[{...question('alpha'),title:'Updated choice'}];await w.loadInbox();
    expect(d.activeElement.tagName).toBe('TEXTAREA');expect(d.activeElement.value).toBe('My answer');
  }finally{w.close()}
});

test('quick search exposes the selected result and resets accessibility state when closed',async()=>{
  const w=await open();
  try{
    w.openPalette();const d=w.document,input=d.getElementById('palette_q');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const id=input.getAttribute('aria-activedescendant');expect(d.getElementById(id).getAttribute('aria-selected')).toBe('true');
    w.paletteKey(new w.KeyboardEvent('keydown',{key:'ArrowDown'}));
    const next=input.getAttribute('aria-activedescendant');expect(next).not.toBe(id);expect(d.getElementById(next).getAttribute('aria-selected')).toBe('true');
    const label=d.getElementById(next).querySelector('.palette-label').textContent;
    input.value=label;w.filterPalette();expect(d.getElementById(next)).not.toBeNull();
    input.value='no matching session or action';w.filterPalette();expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    d.getElementById('palette_dlg').close();expect(input.getAttribute('aria-expanded')).toBe('false');
    w.openPalette();expect(input.hasAttribute('aria-activedescendant')).toBe(true);
  }finally{w.close()}
});

test('review paragraphs and saved notes can be opened and edited with a keyboard',async()=>{
  const w=await open();
  try{
    w.eval('window.reviewView=renderMarkdown("First paragraph\\n\\nSecond paragraph");window.reviewHead=el("div","");window.reviewActs=el("div","");document.body.append(reviewHead,reviewView,reviewActs);reviewReader(reviewView,reviewHead,reviewActs,{path:"/home/demo/review.md",content:"First paragraph\\n\\nSecond paragraph"})');
    const d=w.document,view=w.reviewView,target=view.querySelector('[data-line]');
    w.reviewHead.querySelector('button').click();expect(target.tabIndex).toBe(0);expect(target.getAttribute('aria-keyshortcuts')).toBe('Enter Space');
    target.focus();press(w,target,'Enter');let field=view.querySelector('textarea');expect(d.activeElement).toBe(field);
    field.value='Please revise this';[...view.querySelectorAll('.review-edit button')].find(b=>b.textContent==='Сохранить').click();
    expect(d.activeElement).toBe(target);const note=view.querySelector('.review-note');expect(note.tagName).toBe('BUTTON');
    note.focus();note.click();field=view.querySelector('textarea');expect(field.value).toBe('Please revise this');expect(d.activeElement).toBe(field);
    [...view.querySelectorAll('.review-edit button')].find(b=>b.textContent==='Отмена').click();expect(d.activeElement).toBe(target);
    press(w,target,' ');expect(view.querySelector('textarea')).not.toBeNull();
  }finally{w.close()}
});

test('an unreachable computer keeps its mobile heading, last known count, and retry action',async()=>{
  let down=false,requests=0;
  const w=await open({['/deck/'+DECK+'/api/sessions']:()=>{requests++;return down?{__network:true}:{sessions:[session('beta'),session('gamma')]}}});
  try{
    await w.loadOtherDecks();down=true;await w.loadOtherDecks();const d=w.document,head=d.querySelector('#tabs .deck-head.off');
    expect(head).not.toBeNull();expect(head.textContent).toContain('Mac Studio');expect(head.textContent).toContain('Недоступен');expect(head.textContent).toContain('2');expect(head.getAttribute('aria-label')).toContain('Недоступен');
    const before=requests;down=false;head.click();await settle();expect(requests).toBeGreaterThan(before);expect(d.querySelector('#tabs .deck-head.off')).toBeNull();
    const css=fs.readFileSync(path.resolve(__dirname,'../../frontend/style.css'),'utf8');expect(css).not.toMatch(/\.deck-head\.off\s*\{display:none/);
  }finally{w.close()}
});

test.each(['confirmed','old version','unreachable','failed','rejected'])('bulk updates verify final versions: %s',async(result)=>{
  const current={version:'2.0.0',latest:'2.0.0',update:false,can_update:true,job:{phase:'idle'}};
  let remote={...current,version:'1.0.0',update:true};
  const w=await open({
    '/api/version':()=>current,
    ['/deck/'+DECK+'/api/version']:()=>remote,
    ['/deck/'+DECK+'/api/update']:()=>{
      remote=result==='unreachable'?{__network:true}:result==='old version'?remote:result==='failed'?{...remote,job:{phase:'error'}}:current;
      return result==='rejected'?{__status:400,error:'Update rejected'}:{ok:true};
    },
  });
  try{
    await w.loadFleet();w.confirmAction=async()=>true;
    const nativeTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===3000?0:ms,...args);
    await w.updateAllComputers();const text=w.document.getElementById('toast').textContent;
    if(result==='confirmed')expect(text).toBe('Все компьютеры обновлены');
    else{expect(text).toContain('Обновление не подтверждено');expect(text).not.toContain('Компьютеры обновлены')}
  }finally{w.close()}
});
