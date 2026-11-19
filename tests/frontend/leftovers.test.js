const {leftoverAge,leftoverMemory,leftoverGroups}=require('../../frontend/leftovers');
const tr=(text,args=[])=>text.replace(/\{(\d)\}/g,(_,i)=>args[i]);

test('age and memory read as people say them',()=>{
 expect([30,600,7500,14*86400+3*3600].map(s=>leftoverAge(s,tr))).toEqual(['1 мин','10 мин','2 ч 5 мин','14 д 3 ч']);
 expect(leftoverMemory(512*1024,'en')).toBe('512 MB');
 expect(leftoverMemory(7.38*1048576,'en')).toBe('7.4 GB');
});

test('processes of closed sessions come before those of live ones',()=>{
 const [closed,background]=leftoverGroups([{pid:1,closed:false},{pid:2,closed:true},{pid:3,closed:true}]);
 expect(closed.map(p=>p.pid)).toEqual([2,3]);expect(background.map(p=>p.pid)).toEqual([1]);
});
