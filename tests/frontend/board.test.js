const {tileKey,tileState,boardTiles,boardGroups,tileNow,reorder}=require('../../frontend/board');

const session=(name,extra={})=>({name,created:extra.created||1,group:extra.group||'',...extra});
const stateOf=s=>({busy:s.busy===true,running:s.running!==false});

test('a tile is keyed by computer, name and creation time, so a recreated session starts fresh',()=>{
 expect(tileKey('',session('api',{created:5}))).toBe('/api@5');
 expect(tileKey('m1',session('api',{created:6}))).toBe('m1/api@6');
});

test('state: a question first, then work, then finished, then a summary that waits',()=>{
 const s=session('a');
 expect(tileState(s,{question:{id:1},busy:true,running:true})).toBe('asks');
 expect(tileState(s,{busy:true,finished:true,running:true})).toBe('busy');
 expect(tileState(s,{finished:true,running:true})).toBe('done');
 expect(tileState({...s,summary:{asks:true}},{running:true})).toBe('asks');
 expect(tileState({...s,summary:{asks:true}},{running:false})).toBe('off');
 expect(tileState(s,{running:true})).toBe('idle');
 expect(tileState({...s,summary:{asks:true}},{running:true,quiet:true})).toBe('idle');
});

test('questions and finished marks are matched by computer and session',()=>{
 const computers=[{id:'',name:'gw',sessions:[session('api'),session('web')]},{id:'m',name:'mac',error:true,sessions:[session('api')]}];
 const tiles=boardTiles(computers,[{deck:'m',session:'api',id:'q1'}],[{deck:'',session:'web'}],stateOf);
 expect(tiles.map(t=>[t.key,t.state,t.machine,t.offline])).toEqual([
  ['/api@1','idle','gw',false],['/web@1','done','gw',false],['m/api@1','asks','mac',true]]);
 expect(tiles[2].question.id).toBe('q1');
});

test('"no reply needed" mutes a summary written before it; a newer summary or a real question asks again',()=>{
 const tiles=(quiet,questions=[])=>boardTiles([{id:'',name:'gw',sessions:[session('api',{summary:{asks:true,at:7},quiet})]}],questions,[],stateOf);
 expect(tiles(7)[0].state).toBe('idle');
 expect(tiles(6)[0].state).toBe('asks');
 expect(tiles(undefined)[0].state).toBe('asks');
 expect(tiles(9,[{deck:'',session:'api',id:'q'}])[0].state).toBe('asks');
});

test('waiting tiles lead, questions before finished; the rest keep the owner\'s order, then creation order',()=>{
 const tile=(key,state,created,group,deck='')=>({key,state,deck,machine:deck||'gw',session:{created,group}});
 const tiles=[tile('a','idle',3,'web'),tile('b','busy',1,'web'),tile('c','done',2,'api'),tile('d','asks',9,'api'),tile('e','idle',4,'','m')];
 const groups=boardGroups(tiles,'project',['a'],'(none)');
 expect(groups.map(g=>[g.key,g.label,g.tiles.map(t=>t.key)])).toEqual([
  ['waiting',null,['d','c']],['p:','(none)',['e']],['p:web','web',['a','b']]]);
 const byComputer=boardGroups(tiles,'computer',[],'(none)');
 expect(byComputer.map(g=>[g.label,g.tiles.map(t=>t.key)])).toEqual([[null,['d','c']],['gw',['b','a']],['m',['e']]]);
 expect(boardGroups(tiles,'none',[],'').map(g=>g.key)).toEqual(['waiting','all']);
});

test('the tile line is the screen digest, else the summary result, else its topic',()=>{
 expect(tileNow({digest:{now:'Runs tests',at:5},summary:{done:'Done',at:3}})).toEqual({text:'Runs tests',at:5});
 expect(tileNow({digest:{now:''},summary:{done:'',line:'Fixing login',at:3}})).toEqual({text:'Fixing login',at:3});
 expect(tileNow({})).toBeNull();
});

test('a group\'s new order takes the place of its tiles; other groups keep theirs',()=>{
 expect(reorder(['x','a','y','b'],['b','a'])).toEqual(['x','b','a','y']);
 expect(reorder(['x'],['c','d'])).toEqual(['x','c','d']);
 expect(reorder(['a','x'],['c','a'])).toEqual(['c','a','x']);
 expect(reorder([],['a'])).toEqual(['a']);
});
