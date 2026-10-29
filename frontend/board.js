// Mission control: every session on every computer as a tile, grouped by project or computer. A tile shows
// what the agent does (screen digest, summary, the bottom of its screen), answers its question and takes a
// short reply; opening it leaves for the session view. Bundled before app.js; nothing runs at load time.
const BOARD_GROUPS=["project","computer","none"];
const BOARD_POLL=5000;
const board={on:false,decks:new Map(),pending:new Set(),nodes:new Map(),groups:new Map(),cards:new Map(),sending:new Set(),timer:null};

/* ---------- pure: tests require these ---------- */
const tileKey=(deck,session)=>(deck||"")+"/"+session.name+"@"+session.created;
// asks: an open question, or a summary that says the agent waits while it is idle; done: finished, not yet seen.
// quiet: the owner said this summary needs no answer; a new summary asks again.
function tileState(session,{question,finished,busy,running,quiet}){
  if(question)return "asks";
  if(busy)return "busy";
  if(finished)return "done";
  if(session.summary?.asks&&running&&!quiet)return "asks";
  return running?"idle":"off";
}
// One tile per session; questions and "finished" marks come from the inbox, keyed by computer + session.
function boardTiles(computers,questions,finished,stateOf,quiet={}){
  const asked=new Map(questions.map(q=>[(q.deck||"")+"/"+q.session,q])),seen=new Set(finished.map(f=>(f.deck||"")+"/"+f.session));
  const tiles=[];
  for(const c of computers)for(const s of c.sessions||[]){
    const where=(c.id||"")+"/"+s.name,question=asked.get(where)||null,{busy,running}=stateOf(s),key=tileKey(c.id,s);
    const hushed=s.summary?.at!=null&&quiet[key]===s.summary.at;
    tiles.push({key,deck:c.id||"",machine:c.name,offline:Boolean(c.error),session:s,question,
      state:tileState(s,{question,finished:seen.has(where),busy,running,quiet:hushed})});
  }
  return tiles;
}
// Waiting tiles go to the top, the rest stay in a stable order: the owner's (dragged) order, then by creation time.
function boardGroups(tiles,mode,owned,noProject){
  const order=t=>{const i=owned.indexOf(t.key);return i<0?owned.length:i};
  const asksFirst=(a,b)=>(a.state==="asks"?0:1)-(b.state==="asks"?0:1);
  const sort=(list,first=()=>0)=>list.sort((a,b)=>first(a,b)||order(a)-order(b)||Number(a.session.created)-Number(b.session.created)||a.key.localeCompare(b.key));
  const waiting=tiles.filter(t=>t.state==="asks"||t.state==="done"),rest=tiles.filter(t=>!waiting.includes(t));
  const groups=[];
  if(waiting.length)groups.push({key:"waiting",label:null,tiles:sort(waiting,asksFirst)});
  if(mode==="none"){if(rest.length)groups.push({key:"all",label:null,tiles:sort(rest)});return groups}
  const byKey=new Map();
  for(const t of rest){
    const key=mode==="computer"?"c:"+t.deck:"p:"+(t.session.group||"");
    const label=mode==="computer"?t.machine:t.session.group||noProject;
    if(!byKey.has(key))byKey.set(key,{key,label,tiles:[]});
    byKey.get(key).tiles.push(t);
  }
  const named=[...byKey.values()].sort((a,b)=>a.label.localeCompare(b.label));
  for(const g of named)sort(g.tiles);
  return [...groups,...named];
}

/* ---------- stored choices, per browser ---------- */
function boardStored(name,fallback){try{return JSON.parse(localStore.getItem("cc.board."+name))??fallback}catch(e){return fallback}}
function boardStore(name,value){try{localStore.setItem("cc.board."+name,JSON.stringify(value))}catch(e){}}
const boardGroup=()=>{const g=boardStored("group","project");return BOARD_GROUPS.includes(g)?g:"project"};
// The owner's order of tiles; pins of 1.72.0 were the start of it.
const boardOrder=()=>{const p=boardStored("order",null)??boardStored("pins",[]);return Array.isArray(p)?p.filter(x=>typeof x==="string"):[]};
const TILE_SIZES=["s","m","l"];
const tileSize=key=>{const size=boardStored("sizes",{})[key];return TILE_SIZES.includes(size)?size:"m"};
// One group's new sequence replaces its tiles in the whole order, where the first of them stood; other
// groups' tiles keep their relative order (a tile is only ever sorted against its own group).
function reorder(order,keys){
  const moved=new Set(keys),first=order.findIndex(key=>moved.has(key)),rest=order.filter(key=>!moved.has(key));
  const at=first<0?rest.length:order.slice(0,first).filter(key=>!moved.has(key)).length;
  return [...rest.slice(0,at),...keys,...rest.slice(at)];
}
const digestsOn=()=>deckDirectory.network?.screen_digests===true;

/* ---------- data ---------- */
function boardComputers(){
  const all=[{id:"",name:deckDirectory.name||tr("Этот компьютер")},...deckDirectory.decks.map(d=>({id:d.id,name:d.name}))];
  return all.map(c=>{
    const got=board.decks.get(c.id);
    // A computer without /api/board yet (older version) still shows its sessions from the sidebar's list.
    const listed=c.id===selectedDeck?{sessions}:otherDecks.find(d=>d.id===c.id)||{};
    return {...c,sessions:got?.sessions||listed.sessions||[],error:got?got.error:listed.error};
  });
}
async function loadBoard(){
  if(!board.on||document.hidden)return;
  const query="?language="+encodeURIComponent(I18N.language)+(digestsOn()?"&digests=1":"");
  await Promise.all(boardComputers().map(async c=>{
    if(board.pending.has(c.id))return;
    board.pending.add(c.id);
    try{const data=await api(instancePath(c.id,"/api/board"+query),null,true);board.decks.set(c.id,{sessions:Array.isArray(data.sessions)?data.sessions:[]})}
    catch(e){
      const known=board.decks.get(c.id);
      // Unreachable: the last tiles stay, greyed. A computer on an older version falls back to the sidebar's list.
      if(e.offline)board.decks.set(c.id,{sessions:known?.sessions||[],error:true});else board.decks.delete(c.id);
    }finally{board.pending.delete(c.id)}
  }));
  renderBoard();
}
function boardTileList(){
  const stateOf=s=>{const st=state(s);return {busy:st==="busy",running:st!=="off"}};
  return boardTiles(boardComputers(),openQuestions(),finishedSessions(),stateOf,boardStored("quiet",{}));
}
// "No answer needed": the finished mark goes as if the session was opened, and a summary that asks is
// muted until the next one. An open question stays: the agent is really stopped on it.
function quietTile(t){
  if(t.deck===selectedDeck)attention.delete(t.session.name);else otherAttention.delete(t.deck+"/"+t.session.name);
  const live=new Set(boardTileList().map(x=>x.key)),quiet=Object.fromEntries(Object.entries(boardStored("quiet",{})).filter(([key])=>live.has(key)));
  if(t.session.summary?.asks&&t.session.summary.at!=null)quiet[t.key]=t.session.summary.at;
  boardStore("quiet",quiet);
  renderTabs();renderInboxBadge();renderBoard(true);
}

/* ---------- view ---------- */
const TAIL_SHOWN={m:6,l:12};
function setBoard(on){
  board.on=on;document.body.classList.toggle("board-on",on);boardStore("on",on);
  $("b_board").setAttribute("aria-pressed",String(on));
  clearInterval(board.timer);board.timer=null;
  if(!on){show();load();return}
  drawer(false);$("board_group").value=boardGroup();
  renderBoard();loadBoard();board.timer=setInterval(loadBoard,BOARD_POLL);
}
function toggleBoard(){setBoard(!board.on)}
function setBoardGroup(value){boardStore("group",BOARD_GROUPS.includes(value)?value:"project");renderBoard(true)}
// Sessions that are gone leave the order, so it does not grow with every session ever made.
function saveGroupOrder(keys){
  const live=new Set(boardTileList().map(t=>t.key));
  boardStore("order",reorder(boardOrder().filter(key=>live.has(key)),keys));renderBoard(true);
}
function cycleSize(key){
  const sizes=boardStored("sizes",{}),next=TILE_SIZES[(TILE_SIZES.indexOf(tileSize(key))+1)%TILE_SIZES.length];
  if(next==="m")delete sizes[key];else sizes[key]=next;
  boardStore("sizes",sizes);renderBoard(true);
}
// Leaving the board for the session itself; another computer's session switches the computer as the list does.
function openTile(t){
  setBoard(false);
  if(t.deck===selectedDeck)select(t.session.name);else openDeckSession(t.deck,t.session.name);
}
// moved: the owner asked for a new order (grouping, a drag), so it applies even while a field has focus.
function renderBoard(moved=false){
  if(!board.on)return;
  const mode=boardGroup(),order=boardOrder(),tiles=boardTileList(),multi=boardComputers().length>1;
  const live=new Set(tiles.map(t=>t.key));
  for(const key of [...board.nodes.keys()])if(!live.has(key))board.nodes.delete(key);
  // Someone is typing in a tile: its contents update, but nothing moves until the field is left.
  const typing=board.drag||!moved&&Boolean(document.activeElement?.matches?.("#board_grid textarea"));
  const sections=boardGroups(tiles,mode,order,tr("Без проекта")).map(g=>boardSection(g,{mode,multi},typing));
  const summary=$("board_summary"),counts=boardCounts(tiles);
  summary.textContent=counts;
  if(typing)return;
  placeChildren($("board_grid"),sections.length?sections:[boardEmpty()]);
}
function boardCounts(tiles){
  const n=state=>tiles.filter(t=>t.state===state).length,parts=[];
  if(n("asks"))parts.push(tr("ждут ответа: {0}",[n("asks")]));
  if(n("busy"))parts.push(tr("работают: {0}",[n("busy")]));
  if(n("done"))parts.push(tr("закончили: {0}",[n("done")]));
  return parts.join(" · ");
}
// Moving a node that is already in place blurs it in browsers, so only nodes out of place are moved.
function placeChildren(parent,nodes){
  nodes.forEach((node,i)=>{if(parent.children[i]!==node)parent.insertBefore(node,parent.children[i]||null)});
  for(const node of [...parent.children])if(!nodes.includes(node))node.remove();
}
function boardEmpty(){
  const start=el("button","pri",svgIcon("plus"),el("span","",tr("Новая сессия")));start.type="button";start.onclick=()=>openNew();
  return el("div","board-empty",el("p","",tr("Сессий пока нет")),start);
}
function boardSection(group,view,typing){
  let section=board.groups.get(group.key);
  if(!section){
    section={node:el("section","board-group"),head:el("h3","board-group-head"),grid:el("div","board-tiles")};
    section.node.append(section.head,section.grid);board.groups.set(group.key,section);
  }
  const label=group.key==="waiting"?tr("Ждут вас"):group.label;
  section.head.hidden=!label;section.head.replaceChildren(...(label?[el("span","",label),el("span","board-count",String(group.tiles.length))]:[]));
  section.node.classList.toggle("waiting",group.key==="waiting");
  const tiles=group.tiles.map(t=>boardTile(t,view));
  if(!typing)placeChildren(section.grid,tiles);
  return section.node;
}
const TILE_WORDS={asks:"ждёт ответа",busy:"работает",done:"закончил",idle:"свободен",off:"остановлен"};
// One node per tile for its whole life: the reply field and a question card keep focus and drafts across
// refreshes; only the information part is drawn again, and only when it changed.
function boardTile(t,view){
  let entry=board.nodes.get(t.key);
  if(!entry){
    entry={node:el("article","tile"),info:el("div","tile-info"),question:el("div","tile-question"),questionId:null,reply:tileReply(t),signature:""};
    entry.node.append(entry.info,entry.question,entry.reply);board.nodes.set(t.key,entry);
  }
  const s=t.session,size=tileSize(t.key);
  entry.node.className="tile "+t.state+(t.offline?" offline":"")+(tileNow(s)?" has-now":"")+" size-"+size+(board.drag?.node===entry.node?" dragging":"");entry.node.dataset.key=t.key;
  const signature=JSON.stringify([t.state,t.machine,t.offline,s.title,s.agent,s.group,s.path,s.tail,s.summary,s.digest?.now,s.digest?.at,s.context,size,view.mode,view.multi]);
  if(signature!==entry.signature){entry.signature=signature;entry.info.replaceChildren(...tileInfo(t,view,size))}
  const qid=t.question?t.question.id:null;
  if(qid!==entry.questionId){
    entry.questionId=qid;
    entry.question.replaceChildren(...(t.question?[answerCard(t.question,t.deck,()=>{inbox.questions=inbox.questions.filter(x=>x!==t.question);renderBoard()})]:[]));
  }
  entry.reply.querySelector("textarea").disabled=t.state==="off"&&agentOf(s)!=="shell";
  return entry.node;
}
function tileInfo(t,view,size){
  const s=t.session,head=el("button","tile-head",agentIcon(s),el("span","tile-title",sessionTitle(s)),el("span","tile-state "+t.state,tr(TILE_WORDS[t.state])));
  head.type="button";head.title=tr("Открыть сессию");head.onclick=()=>openTile(t);
  const words={s:tr("маленькая"),m:tr("средняя"),l:tr("большая")},resize=el("button","tile-size",size.toUpperCase());resize.type="button";
  resize.setAttribute("aria-label",tr("Размер плитки: {0}",[words[size]]));resize.title=resize.getAttribute("aria-label");resize.onclick=()=>cycleSize(t.key);
  const where=[view.mode!=="computer"&&view.multi?t.machine:"",shortPath(s.path||"")].filter(Boolean).join(" · ");
  const parts=[el("div","tile-top",tileGrip(t),head,resize),el("div","tile-where",where)];
  const now=tileNow(s);
  if(now)parts.push(el("p","tile-now",now.text,...(now.at?[el("span","tile-age",relativeTime(now.at))]:[])));
  if(s.context?.tokens)parts.push(el("span","tile-ctx "+(s.context.level||"fine"),Math.round(s.context.tokens/1000)+"k"));
  const tail=size==="s"?[]:(s.tail||[]).slice(-TAIL_SHOWN[size]);
  if(tail.length)parts.push(el("pre","tile-tail",tail.join("\n")));
  if((t.state==="done"||t.state==="asks")&&!t.question){
    const quiet=el("button","tile-quiet",svgIcon("check"),el("span","",tr("Ответ не требуется")));
    quiet.type="button";quiet.onclick=()=>quietTile(t);parts.push(quiet);
  }
  return parts;
}
// The digest says what the screen shows now; without one, the summary's latest result or its topic line.
function tileNow(s){
  if(s.digest?.now)return {text:s.digest.now,at:s.digest.at};
  const summary=s.summary;
  if(summary&&(summary.done||summary.line))return {text:summary.done||summary.line,at:summary.at};
  return null;
}
function tileReply(t){
  const input=el("textarea"),send=el("button","tile-send",svgIcon("arrow-up"));
  input.rows=1;input.placeholder=tr("Сообщение агенту…");input.setAttribute("aria-label",tr("Сообщение агенту…"));
  input.autocomplete="off";input.spellcheck=false;input.value=boardStored("drafts",{})[t.key]||"";
  input.oninput=()=>{saveTileDraft(t.key,input.value);input.style.height="";input.style.height=Math.min(input.scrollHeight,120)+"px"};
  input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing&&!isTouch()){e.preventDefault();sendFromTile(t,input)}};
  send.type="button";send.setAttribute("aria-label",tr("Отправить"));send.title=tr("Отправить");send.onclick=()=>sendFromTile(t,input);
  return el("div","tile-reply",input,send);
}
function saveTileDraft(key,text){
  const drafts=boardStored("drafts",{});
  if(text)drafts[key]=text;else delete drafts[key];
  boardStore("drafts",drafts);
}
// Bound to the tile's computer and session; the draft stays until the computer confirms the message.
async function sendFromTile(t,input){
  const text=input.value;
  if(!text.trim()||board.sending.has(t.key))return;
  board.sending.add(t.key);input.readOnly=true;
  try{
    await api(instancePath(t.deck,"/api/send"),{name:t.session.name,text,attachments:[]},true);
    if(input.value===text){input.value="";input.style.height=""}
    saveTileDraft(t.key,input.value);
    toast(tr("Отправлено в ")+sessionTitle(t.session),"success");
    loadBoard();
  }catch(e){toast(tr("Не отправлено: ")+e.message)}
  finally{board.sending.delete(t.key);input.readOnly=false}
}

/* ---------- moving tiles ---------- */
// Pointer events, not HTML drag and drop (iOS has none of that). The listeners sit on the window, so moving
// the dragged node within the page does not end the gesture.
function tileGrip(t){
  const grip=el("button","tile-grip",svgIcon("grip"));grip.type="button";
  grip.setAttribute("aria-label",tr("Переместить: перетащите или нажимайте стрелки"));grip.title=grip.getAttribute("aria-label");
  grip.onpointerdown=e=>startDrag(e,t.key);
  grip.onkeydown=e=>{const step={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[e.key];if(step){e.preventDefault();moveTile(t.key,step)}};
  return grip;
}
const groupKeys=grid=>[...grid.children].map(node=>node.dataset.key);
function moveTile(key,step){
  const grid=board.nodes.get(key)?.node.parentElement;
  if(!grid)return;
  const keys=groupKeys(grid),from=keys.indexOf(key),to=from+step;
  if(to<0||to>=keys.length)return;
  keys.splice(from,1);keys.splice(to,0,key);saveGroupOrder(keys);
  board.nodes.get(key)?.node.querySelector(".tile-grip")?.focus();
}
function startDrag(e,key){
  const node=board.nodes.get(key)?.node,grid=node?.parentElement;
  if(e.button!==0||!grid)return;
  e.preventDefault();
  board.drag={node,grid,start:groupKeys(grid).join("\n")};
  node.classList.add("dragging");document.body.classList.add("board-dragging");
  addEventListener("pointermove",dragMove);addEventListener("pointerup",endDrag);addEventListener("pointercancel",cancelDrag);
}
// The tile under the pointer, in the same group, swaps sides with the dragged one.
function dragMove(e){
  const drag=board.drag;
  if(!drag)return;
  e.preventDefault();scrollWhileDragging(e.clientY);
  const over=document.elementFromPoint(e.clientX,e.clientY)?.closest(".tile");
  if(!over||over===drag.node||over.parentElement!==drag.grid)return;
  const tiles=[...drag.grid.children];
  over[tiles.indexOf(over)>tiles.indexOf(drag.node)?"after":"before"](drag.node);
}
function scrollWhileDragging(y){
  const box=$("board"),rect=box.getBoundingClientRect(),edge=56;
  if(y<rect.top+edge)box.scrollBy(0,-14);else if(y>rect.bottom-edge)box.scrollBy(0,14);
}
function endDrag(){
  const drag=stopDrag();
  if(drag&&groupKeys(drag.grid).join("\n")!==drag.start)saveGroupOrder(groupKeys(drag.grid));
}
// Cancelled (a call, the system took the touch): the tiles go back to the saved order.
function cancelDrag(){if(stopDrag())renderBoard(true)}
function stopDrag(){
  const drag=board.drag;board.drag=null;
  removeEventListener("pointermove",dragMove);removeEventListener("pointerup",endDrag);removeEventListener("pointercancel",cancelDrag);
  drag?.node.classList.remove("dragging");document.body.classList.remove("board-dragging");
  return drag;
}

if(typeof module!=="undefined")module.exports={tileKey,tileState,boardTiles,boardGroups,tileNow,reorder};
