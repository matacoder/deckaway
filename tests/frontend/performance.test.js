/** @jest-environment node */
const {DECK,boot,session,settle,routesFor}=require('./harness');

function start(extra={}){
  return boot({...routesFor({local:()=>({sessions:[session('alpha')]})}),...extra});
}

test('a half-million-line file has a bounded reader and retains original line numbers across pages',async()=>{
  const window=start();
  try{
    await settle();
    window.eval('files.listing={home:"/home/demo",path:"/home/demo",entries:[]};files.file={path:"/home/demo/log.txt",content:"x\\n".repeat(524288),saved:"",rendered:false};renderFiles()');
    const body=window.document.getElementById('files_body');
    expect(body.querySelectorAll('.fl').length).toBe(400);
    expect(body.querySelectorAll('*').length).toBeLessThan(1400);
    window.eval('files.file.page=1;renderFiles()');
    expect(body.querySelector('.fl').dataset.line).toBe('401');
    window.eval('files.file.page=999999;renderFiles()');
    expect(body.querySelector('.fl:last-child').dataset.end).toBe('524288');
    window.eval('files.file={path:"/home/demo/log.md",content:"# Heading\\n".repeat(10000),rendered:true};renderFiles()');
    expect(body.querySelectorAll('h1').length).toBe(400);
    window.eval('files.file.page=1;renderFiles()');
    expect(body.querySelector('h1').dataset.line).toBe('401');
    window.eval('files.file={path:"/home/demo/inline.md",content:"[a](https://example.test/) ".repeat(10000),rendered:true};renderFiles()');
    expect(body.querySelectorAll('.files-view *').length).toBeLessThan(10);
  }finally{window.close()}
});

test('identical conversation polls preserve history nodes and text selections',async()=>{
  const window=start({'/api/conversation':()=>({supported:true,revision:'one',turns:[{role:'user',text:'An earlier request with enough text'}]})});
  try{
    await settle();
    window.eval('screenView.cut=false');
    await window.eval('loadScreenHistory(sessionInfoKey())');
    const history=window.document.querySelector('.screen-history');
    expect(history).not.toBeNull();
    const selection=window.getSelection(),range=window.document.createRange();
    range.selectNodeContents(history);selection.addRange(range);
    const text=selection.toString();
    await window.eval('loadScreenHistory(sessionInfoKey())');
    expect(window.document.querySelector('.screen-history')).toBe(history);
    expect(selection.toString()).toBe(text);
  }finally{window.close()}
});

test('group polling has one in-flight request for a repository',async()=>{
  let release,calls=0;
  const window=start({'/api/git/groups':()=>new Promise(resolve=>{calls++;release=()=>resolve({groups:[],pending:[]})})});
  try{
    await settle();
    window.eval('hist.session=active;hist.key=sessionInfoKey();hist.tab="changes"');
    const first=window.eval('loadGroups()');await settle();
    await window.eval('loadGroups(true)');
    expect(calls).toBe(1);
    release();await first;
    const next=window.eval('loadGroups(true)');await settle();expect(calls).toBe(2);release();await next;
  }finally{window.close()}
});

test('all visited terminals share a six-client LRU',async()=>{
  const window=start();
  try{
    await settle();
    window.eval('mode="term";frameFor(active);for(let i=0;i<30;i++)frameFor("visited-"+i)');
    expect(window.eval('frames.size')).toBe(6);
    expect(window.eval('frames.has(active)')).toBe(true);
    expect(window.eval('frames.has("visited-0")')).toBe(false);
    window.eval('frameFor("visited-25");frameFor("last")');
    expect(window.eval('frames.has("visited-25")')).toBe(true);
    expect(window.eval('frames.has("visited-26")')).toBe(false);
  }finally{window.close()}
});

test('each computer publishes immediately and a slow computer does not block subsequent polls',async()=>{
  const slow='b'.repeat(24);let release,slowCalls=0,fastCalls=0;
  const window=start({
    '/api/decks':()=>({decks:[{id:DECK,name:'Fast'},{id:slow,name:'Slow'}]}),
    ['/deck/'+DECK+'/api/sessions']:()=>{fastCalls++;return {sessions:[session('fresh')] }},
    ['/deck/'+slow+'/api/sessions']:()=>new Promise(resolve=>{slowCalls++;release=()=>resolve({sessions:[session('late')]})}),
  });
  try{
    await settle();await settle();
    expect(window.eval('otherDecks.some(d=>d.id==="'+DECK+'"&&d.sessions[0]?.name==="fresh")')).toBe(true);
    expect(slowCalls).toBe(1);
    const before=fastCalls;
    await window.eval('loadOtherDecks()');
    expect(fastCalls).toBeGreaterThan(before);
    expect(slowCalls).toBe(1);
    release();await settle();
    expect(window.eval('otherDecks.some(d=>d.sessions[0]?.name==="late")')).toBe(true);
  }finally{window.close()}
});

test('polling sends the kept preview revision and keeps the text it already has',async()=>{
  const asked=[];let text=true;
  const window=start({'/api/sessions':url=>{asked.push(url);return {sessions:[session('alpha',{...(text?{preview_ansi:'output'}:{}),preview_revision:'revision-1'})]}}});
  try{
    await settle();await settle();asked.length=0;text=false;
    // The terminal view asks too: Claude's suggestion is read from the same screen text.
    window.eval('mode="term"');await window.load();
    expect(asked[0].searchParams.get('preview')).toBe('alpha');
    expect(asked[0].searchParams.get('preview_revision')).toBe('revision-1');
    expect(window.eval('cur().preview_ansi')).toBe('output');
  }finally{window.close()}
});

test('GitHub footer checks stay single-flight until the preceding request finishes',async()=>{
  let release,calls=0;
  const window=start({'/api/agents':()=>new Promise(resolve=>{calls++;release=()=>resolve({})})});
  try{
    await settle();const before=calls;
    await window.checkGithubFoot(true);await window.checkGithubFoot(true);
    expect(calls).toBe(before);
    release();await settle();
    const next=window.checkGithubFoot(true);await settle();expect(calls).toBe(before+1);release();await next;
  }finally{window.close()}
});
