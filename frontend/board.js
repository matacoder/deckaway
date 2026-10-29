// Mission control: every session on every computer as a tile, grouped by project or computer. A tile shows
// what the agent does (screen digest, summary, the bottom of its screen), answers its question and takes a
// short reply; opening it leaves for the session view. Bundled before app.js; nothing runs at load time.
const BOARD_GROUPS=["project","computer","none"];
const BOARD_POLL=5000;
const board={on:false,decks:new Map(),pending:new Set(),nodes:new Map(),groups:new Map(),cards:new Map(),sending:new Set(),timer:null};

/* ---------- pure: tests require these ---------- */
const tileKey=(deck,session)=>(deck||"")+"/"+session.name+"@"+session.created;
// asks: an open question, or a summary that says the agent waits while it is idle; done: finished, not yet seen.
function tileState(session,{question,finished,busy,running}){
  if(question)return "asks";
  if(busy)return "busy";
  if(finished)return "done";
  if(session.summary?.asks&&running)return "asks";
  return running?"idle":"off";
}
// One tile per session; questions and "finished" marks come from the inbox, keyed by computer + session.
function boardTiles(computers,questions,finished,stateOf){
  const asked=new Map(questions.map(q=>[(q.deck||"")+"/"+q.session,q])),seen=new Set(finished.map(f=>(f.deck||"")+"/"+f.session));
  const tiles=[];
  for(const c of computers)for(const s of c.sessions||[]){
    const where=(c.id||"")+"/"+s.name,question=asked.get(where)||null,{busy,running}=stateOf(s);
    tiles.push({key:tileKey(c.id,s),deck:c.id||"",machine:c.name,offline:Boolean(c.error),session:s,question,
      state:tileState(s,{question,finished:seen.has(where),busy,running})});
  }
  return tiles;
}
// Waiting tiles go to the top, the rest stay in a stable order: pinned first, then by creation time.
function boardGroups(tiles,mode,pins,noProject){
  const order=t=>{const i=pins.indexOf(t.key);return i<0?pins.length:i};
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
const boardPins=()=>{const p=boardStored("pins",[]);return Array.isArray(p)?p.filter(x=>typeof x==="string"):[]};
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
  return boardTiles(boardComputers(),openQuestions(),finishedSessions(),stateOf);
}

/* ---------- view ---------- */
const TAIL_SHOWN=6;
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
function togglePin(key){
  const pins=boardPins(),i=pins.indexOf(key);
  if(i<0)pins.push(key);else pins.splice(i,1);
  boardStore("pins",pins);renderBoard(true);
}
// Leaving the board for the session itself; another computer's session switches the computer as the list does.
function openTile(t){
  setBoard(false);
  if(t.deck===selectedDeck)select(t.session.name);else openDeckSession(t.deck,t.session.name);
}
// moved: the owner asked for a new order (grouping, a pin), so it applies even while a field has focus.
function renderBoard(moved=false){
  if(!board.on)return;
  const mode=boardGroup(),pins=boardPins(),tiles=boardTileList(),multi=boardComputers().length>1;
  const live=new Set(tiles.map(t=>t.key));
  for(const key of [...board.nodes.keys()])if(!live.has(key))board.nodes.delete(key);
  // Someone is typing in a tile: its contents update, but nothing moves until the field is left.
  const typing=!moved&&Boolean(document.activeElement?.matches?.("#board_grid textarea"));
  const sections=boardGroups(tiles,mode,pins,tr("Без проекта")).map(g=>boardSection(g,{mode,multi,pins},typing));
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
  const s=t.session,pinned=view.pins.includes(t.key);
  entry.node.className="tile "+t.state+(t.offline?" offline":"")+(tileNow(s)?" has-now":"");
  const signature=JSON.stringify([t.state,t.machine,t.offline,s.title,s.agent,s.group,s.path,s.tail,s.summary,s.digest?.now,s.digest?.at,s.context,pinned,view.mode,view.multi]);
  if(signature!==entry.signature){entry.signature=signature;entry.info.replaceChildren(...tileInfo(t,view,pinned))}
  const qid=t.question?t.question.id:null;
  if(qid!==entry.questionId){
    entry.questionId=qid;
    entry.question.replaceChildren(...(t.question?[answerCard(t.question,t.deck,()=>{inbox.questions=inbox.questions.filter(x=>x!==t.question);renderBoard()})]:[]));
  }
  entry.reply.querySelector("textarea").disabled=t.state==="off"&&agentOf(s)!=="shell";
  return entry.node;
}
function tileInfo(t,view,pinned){
  const s=t.session,head=el("button","tile-head",agentIcon(s),el("span","tile-title",sessionTitle(s)),el("span","tile-state "+t.state,tr(TILE_WORDS[t.state])));
  head.type="button";head.title=tr("Открыть сессию");head.onclick=()=>openTile(t);
  const pin=el("button","tile-pin"+(pinned?" on":""),svgIcon("pin"));pin.type="button";
  pin.setAttribute("aria-pressed",String(pinned));pin.setAttribute("aria-label",tr("Закрепить первой в группе"));pin.title=pin.getAttribute("aria-label");
  pin.onclick=()=>togglePin(t.key);
  const where=[view.mode!=="computer"&&view.multi?t.machine:"",shortPath(s.path||"")].filter(Boolean).join(" · ");
  const parts=[el("div","tile-top",head,pin),el("div","tile-where",where)];
  const now=tileNow(s);
  if(now)parts.push(el("p","tile-now",now.text,...(now.at?[el("span","tile-age",relativeTime(now.at))]:[])));
  if(s.context?.tokens)parts.push(el("span","tile-ctx "+(s.context.level||"fine"),Math.round(s.context.tokens/1000)+"k"));
  const tail=(s.tail||[]).slice(-TAIL_SHOWN);
  if(tail.length)parts.push(el("pre","tile-tail",tail.join("\n")));
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

if(typeof module!=="undefined")module.exports={tileKey,tileState,boardTiles,boardGroups,tileNow};
