/** @jest-environment node */
const {DECK,boot,session,settle,routesFor}=require('./harness');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function open(send,deck=''){
  const prefix=deck?'/deck/'+deck:'';
  const window=boot({
    ...routesFor({local:()=>({sessions:[session('alpha')]})}),
    [prefix+'/api/sessions']:()=>({sessions:[session('alpha')]}),
    [prefix+'/api/send']:send,
  },null,w=>{w.localStorage.setItem('cc.active','alpha');w.localStorage.setItem('cc.deck',deck)});
  await settle();await settle();
  window.eval(`
    files.session=active;files.key=sessionInfoKey();
    files.listing={home:"/home/demo",path:"/home/demo",entries:[]};
    files.file={path:"/home/demo/plan.txt",content:"First line\\nSecond line",saved:"First line\\nSecond line"};
    renderFiles();review.notes=[{from:1,to:1,text:"Please clarify"}];storeReview();renderFiles();
    $("msg").value="Unfinished task  ";$("msg").dispatchEvent(new Event("input"));
    imageAttachments.set(active,[{attachment:"draft-upload",label:"draft.txt"}]);renderAttachments();
  `);
  return window;
}
const send=window=>window.eval('sendReview(document.querySelector(".files-view"),files.file)');

for(const deck of ['',DECK])test(`sending a review preserves the composer and sends only the review (${deck?'remote':'gateway'})`,async()=>{
  const gate=deferred(),sent=[];
  const window=await open(async(url,options)=>{sent.push(JSON.parse(options.body));await gate.promise;return {ok:true}},deck);
  try{
    const sending=send(window);
    await send(window);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({name:'alpha',text:expect.stringContaining('Line 1: "First line"\nPlease clarify')});
    expect(sent[0].text).not.toContain('Unfinished task');
    expect(window.eval('review.notes.length')).toBe(1);
    gate.resolve();await sending;
    expect(window.document.getElementById('msg').value).toBe('Unfinished task  ');
    expect(window.eval('messageDrafts.get(active)')).toBe('Unfinished task  ');
    expect(window.eval('attachmentsFor(active).map(a=>a.attachment)')).toEqual(['draft-upload']);
    expect(window.eval('review.notes.length')).toBe(0);
    expect(window.localStorage.getItem('cc.review.'+deck+':/home/demo/plan.txt')).toBeNull();
    expect(window.eval('sending')).toBe(false);
  }finally{gate.resolve();await settle();window.close()}
});

test('a failed review send keeps notes for retry and preserves draft and attachments',async()=>{
  const window=await open(()=>({__status:400,error:'Agent is busy'}));
  try{
    await send(window);
    expect(window.eval('review.notes[0].text')).toBe('Please clarify');
    expect(window.document.getElementById('msg').value).toBe('Unfinished task  ');
    expect(window.eval('attachmentsFor(active).length')).toBe(1);
    expect(window.eval('review.send.disabled')).toBe(false);
    expect(window.document.getElementById('toast').textContent).toContain('Agent is busy');
    window.eval('review.key=null;loadReview("/home/demo/plan.txt")');
    expect(window.eval('review.notes[0].text')).toBe('Please clarify');
  }finally{await settle();window.close()}
});

test('a review completed after switching computers clears only the original notes',async()=>{
  const gate=deferred();
  const window=await open(async()=>{await gate.promise;return {ok:true}});
  try{
    const sending=send(window);
    window.eval(`switchDeck("${DECK}")`);await settle();
    window.eval('loadReview("/home/demo/plan.txt");review.notes=[{from:2,to:2,text:"Remote note"}];storeReview()');
    gate.resolve();await sending;
    expect(window.localStorage.getItem('cc.review.:/home/demo/plan.txt')).toBeNull();
    expect(window.eval('review.notes[0].text')).toBe('Remote note');
    expect(JSON.parse(window.localStorage.getItem('cc.review.'+DECK+':/home/demo/plan.txt'))[0].text).toBe('Remote note');
  }finally{gate.resolve();await settle();window.close()}
});
