Object.assign(global,require('../../frontend/agents'));
const {quickChips,quickRows,laterWhen,defaultLaterTime,laterCount}=require('../../frontend/schedule');
const t=text=>'['+text+']';

test('quick prompts are the saved ones only; a terminal gets none',()=>{
 const saved=[{label:'Tests',text:'run the tests'}];
 expect(quickChips('claude',saved)).toEqual(saved);
 expect(quickChips('codex',[])).toEqual([]);
 expect(quickChips('shell',saved)).toEqual([]);
 // Nothing but a label and a text is taken from the saved file.
 expect(quickChips('claude',[{label:'x',text:'/clear',confirm:'injected'}])[0].confirm).toBeUndefined();
});

test('empty editor rows are dropped and labels are trimmed',()=>{
 expect(quickRows([{label:' Tests ',text:'run the tests'},{label:'empty',text:'   '},{label:'',text:'commit'}]))
  .toEqual([{label:'Tests',text:'run the tests'},{label:'',text:'commit'}]);
});

test('a waiting prompt says when it goes',()=>{
 const time=seconds=>'at '+seconds;
 expect(laterWhen({trigger:'time',at:1700000000},t,time)).toBe('at 1700000000');
 expect(laterWhen({trigger:'idle',at:0},t,time)).toBe('[Когда агент освободится]');
 expect(laterWhen({trigger:'limit',at:0},t,time)).toBe('[Когда сбросится лимит]');
});

test('the time field starts an hour ahead on a round five minutes, in local time',()=>{
 const value=defaultLaterTime(new Date(2026,9,10,23,12,30).getTime());
 expect(value).toBe('2026-10-11T00:15');
 expect(defaultLaterTime(new Date(2026,0,5,8,0,0).getTime())).toBe('2026-01-05T09:00');
});

test('the badge counts waiting prompts and auto-continue',()=>{
 expect(laterCount(null)).toBe(0);
 expect(laterCount({prompts:[],auto_resume:false})).toBe(0);
 expect(laterCount({prompts:[{},{}],auto_resume:true})).toBe(3);
});

test('the compact button exists only for an agent that has the command',()=>{
  const {compactCommand}=require('../../frontend/schedule');
  expect(compactCommand('claude').text).toBe('/compact');
  expect(compactCommand('claude-kimi').text).toBe('/compact');
  expect(compactCommand('codex').confirm).toBeUndefined();
  expect(compactCommand('shell')).toBeNull();
});

test('Qwen Code compacts with its own command',()=>{
  const {compactCommand}=require('../../frontend/schedule');
  expect(compactCommand('qwen').text).toBe('/compress');
  expect(agentCommands('qwen').map(p=>p.label)).toEqual(['/compress','/clear']);
});
