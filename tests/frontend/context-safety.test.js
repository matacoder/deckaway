/** @jest-environment node */
const {DECK,boot,session,settle,routesFor}=require('./harness');

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function open(extra={},setup){
  const window=boot({
    ...routesFor({local:()=>({sessions:[session('alpha'),session('bravo')]})}),
    ['/deck/'+DECK+'/api/sessions']:()=>({sessions:[session('alpha'),session('bravo')]}),
    ...extra,
  },null,w=>{
    w.localStorage.setItem('cc.active','alpha');w.localStorage.setItem('cc.mode.d','screen');
    if(setup)setup(w);
  });
  await settle();await settle();
  return window;
}

for(const origin of ['',DECK])test(`a command stays on its original computer (${origin?'remote':'gateway'})`,async()=>{
  const gate=deferred(),requests=[],prefix=origin?'/deck/'+origin:'';
  const window=await open({
    [prefix+'/api/new']:async(url,options)=>{requests.push([url.pathname,JSON.parse(options.body)]);await gate.promise;return {name:'alpha-run-2'}},
    [prefix+'/api/send']:(url,options)=>{requests.push([url.pathname,JSON.parse(options.body)]);return {ok:true}},
  },w=>w.localStorage.setItem('cc.deck',origin));
  try{
    const running=window.eval('runInTerminal("npm run build")');
    await settle();window.eval(`switchDeck(${JSON.stringify(origin?'':DECK)})`);await settle();
    gate.resolve();await running;
    expect(requests).toEqual([
      [prefix+'/api/new',{name:'alpha-run',agent:'shell',path:'/home/demo/projects/alpha'}],
      [prefix+'/api/send',{name:'alpha-run-2',text:'npm run build'}],
    ]);
    expect(window.eval('active')).toBe('alpha');
    expect(window.eval('selectedDeck')).toBe(origin?'':DECK);
  }finally{gate.resolve();await settle();window.close()}
});

test('a command selects its new terminal after refreshing the original computer',async()=>{
  const sessions=[session('alpha')];
  const window=await open({
    '/api/sessions':()=>({sessions}),
    '/api/new':()=>{sessions.push(session('alpha-run-2',{agent:'shell'}));return {name:'alpha-run-2'}},
  });
  try{await window.eval('runInTerminal("pwd")');expect(window.eval('active')).toBe('alpha-run-2')}
  finally{await settle();window.close()}
});

test('typing while a save is pending keeps the newer text unsaved',async()=>{
  const gate=deferred(),sent=[];
  const window=await open({'/api/file_save':async(url,options)=>{sent.push(JSON.parse(options.body));await gate.promise;return {hash:'saved-hash'}}});
  try{
    window.eval('files.file={path:"/home/demo/a.txt",content:"A",saved:"old",hash:"old-hash"};files.saveButton=document.createElement("button")');
    const saving=window.eval('saveFile()');
    window.eval('files.file.content="AB"');gate.resolve();await saving;
    expect(sent).toEqual([{path:'/home/demo/a.txt',content:'A',hash:'old-hash'}]);
    expect(window.eval('files.file.saved')).toBe('A');
    expect(window.eval('files.file.hash')).toBe('saved-hash');
    expect(window.eval('filesDirty()')).toBe(true);
    expect(window.eval('files.saveButton.disabled')).toBe(false);
    await window.eval('saveFile()');
    expect(sent[1]).toEqual({path:'/home/demo/a.txt',content:'AB',hash:'saved-hash'});
    expect(window.eval('filesDirty()')).toBe(false);
  }finally{gate.resolve();await settle();window.close()}
});

test('automatic and explicit refresh both wait for an unsaved file',async()=>{
  let revision='test';
  const window=await open({'/api/ui-version':()=>({revision})});
  try{
    window.eval('document.activeElement.blur();drawer(false);sheet(false)');
    expect(window.eval('canAutoRefresh()')).toBe(true);
    window.eval('files.file={content:"edited",saved:"original"}');
    expect(window.eval('canAutoRefresh()')).toBe(false);
    revision='next';await window.eval('checkInterfaceVersion()');
    expect(window.document.getElementById('b_stale').hidden).toBe(false);
    window.eval('refreshInterface()');
    expect(window.problems.filter(p=>p.includes('navigation'))).toEqual([]);
    expect(window.document.getElementById('toast').textContent).toContain('Сохраните или закройте файл');
    window.eval('files.file.saved=files.file.content');
    expect(window.eval('canAutoRefresh()')).toBe(true);
  }finally{await settle();window.close()}
});

test('review notes use both computer and path when loaded and the captured key when stored',async()=>{
  const window=await open();
  try{
    window.eval('loadReview("/home/demo/plan.md");review.notes=[{from:1,to:1,text:"Gateway note"}];storeReview()');
    window.localStorage.setItem('cc.review.'+DECK+':/home/demo/plan.md',JSON.stringify([{from:2,to:2,text:'Remote note'}]));
    window.eval(`switchDeck("${DECK}")`);await settle();
    // Storing an already loaded review must not write its notes under the newly selected deck.
    window.eval('storeReview();loadReview("/home/demo/plan.md")');
    expect(window.eval('review.notes[0].text')).toBe('Remote note');
    window.eval('review.notes[0].text="Remote edit";storeReview()');
    window.eval('loadReview("/home/demo/other.md")');expect(window.eval('review.notes.length')).toBe(0);
    window.eval('switchDeck("")');await settle();window.eval('loadReview("/home/demo/plan.md")');
    expect(window.eval('review.notes[0].text')).toBe('Gateway note');
    expect(JSON.parse(window.localStorage.getItem('cc.review.'+DECK+':/home/demo/plan.md'))[0].text).toBe('Remote edit');
  }finally{await settle();window.close()}
});

for(const folder of [true,false])test(`a screen path is checked on the selected computer (${folder?'folder':'download'})`,async()=>{
  const asked=[];
  const window=await open({
    ['/deck/'+DECK+'/api/files']:(url)=>{asked.push(url);return folder?{path:'/home/demo/result',home:'/home/demo',entries:[]}:{__status:404,error:'Missing folder'}},
    '/api/files':()=>{throw new Error('The gateway must not check the path')},
  },w=>w.localStorage.setItem('cc.deck',DECK));
  try{
    window.openRefFolder=jest.fn();window.downloadFile=jest.fn();
    await window.eval('openScreenPath("/home/demo/result")');
    expect(asked).toHaveLength(1);
    expect(asked[0].searchParams.get('name')).toBe('alpha');
    expect(asked[0].searchParams.get('path')).toBe('/home/demo/result');
    if(folder){expect(window.openRefFolder).toHaveBeenCalledWith('/home/demo/result');expect(window.downloadFile).not.toHaveBeenCalled()}
    else{expect(window.downloadFile).toHaveBeenCalledWith('alpha','/home/demo/result');expect(window.openRefFolder).not.toHaveBeenCalled()}
  }finally{await settle();window.close()}
});

test('leaving a computer during a path check does not download from the next one',async()=>{
  const gate=deferred();
  const window=await open({'/api/files':async()=>{await gate.promise;return {__status:404,error:'Missing folder'}}});
  try{
    window.downloadFile=jest.fn();window.openRefFolder=jest.fn();
    const checking=window.eval('openScreenPath("/home/demo/result")');
    window.eval(`switchDeck("${DECK}")`);await settle();gate.resolve();await checking;
    expect(window.downloadFile).not.toHaveBeenCalled();expect(window.openRefFolder).not.toHaveBeenCalled();
  }finally{gate.resolve();await settle();window.close()}
});

test('disabling duplicate Telegram uses one explicit gateway route from a remote computer',async()=>{
  const sent=[];
  const window=await open({['/deck/'+DECK+'/api/telegram_config']:(url,options)=>{sent.push([url.pathname,JSON.parse(options.body)]);return {ok:true}}},w=>w.localStorage.setItem('cc.deck',DECK));
  try{
    window.confirmAction=async()=>true;
    await window.eval(`disableTelegramOn({id:"${DECK}",name:"Remote"})`);
    expect(sent).toEqual([['/deck/'+DECK+'/api/telegram_config',{clear:true}]]);
    expect(window.eval(`telegramClearedOn.has("${DECK}")`)).toBe(true);
  }finally{await settle();window.close()}
});

test('search resets for the same session name on another computer and rejects a late result',async()=>{
  const gate=deferred();
  const window=await open({'/api/scrollback':async()=>{await gate.promise;return {query:'old',matches:[{text:'Old output'}]}}});
  try{
    window.eval('$("search_q").value="old"');
    const searching=window.eval('runOutputSearch()'),seq=window.eval('outputSearch.seq');
    window.eval(`switchDeck("${DECK}")`);await settle();
    expect(window.eval('active')).toBe('alpha');
    expect(window.eval('outputSearch.key')).toBe(DECK+'/alpha');
    expect(window.eval('outputSearch.seq')).toBeGreaterThan(seq);
    expect(window.document.getElementById('search_q').value).toBe('');
    expect(window.document.getElementById('search_body').textContent).toBe('');
    expect(window.document.getElementById('search_pop').hidden).toBe(true);
    gate.resolve();await searching;
    expect(window.eval('outputSearch.result')).toBeNull();
    expect(window.eval('outputSearch.busy')).toBe(false);
    window.eval('$("search_q").value="new";outputSearch.query="new";select("bravo")');
    expect(window.eval('outputSearch.key')).toBe(DECK+'/bravo');
    expect(window.eval('outputSearch.query')).toBe('');
  }finally{gate.resolve();await settle();window.close()}
});
