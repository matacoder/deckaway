// Decisions agents left for their owner (integrations/decisions.py), every session's on every computer in one
// list under the questions on agents' screens (inbox.js), each with its own answer field. A typed or dictated answer is kept on that computer as a draft (any
// device sees it) and goes to the agent with "Send", as a prompt typed once the session is free.
// The agent's text is shown as plain text: it is data, never markup.
const decisions={key:null,items:null,raw:"",error:"",timer:null,decks:new Map(),cards:new Map(),fixed:null,
  drafts:new Map(),saves:new Map(),saving:new Map(),sending:new Set(),local:new Map(),counts:new Map(),stale:false,pointer:0};
// A healthy computer is asked often while the tab is open, and at once when its session list shows a change; one
// that did not answer is left alone for a while (Settings shows it offline), so it never holds the others back.
const DECISIONS_POLL=4000,DECISIONS_RETRY=30000,DECISION_SAVE_MS=700,DECISION_LOCAL_MS=30000,POINTER_HOLD_MS=8000;

// Every computer the page knows, the selected one first: questions are one stream, not one per place.
function decisionDecks(){return [selectedDeck||"",...otherDecks.map(d=>d.id).filter(id=>id!==(selectedDeck||""))]}
function decisionsKey(){return decisionDecks().join(",")}
function decisionDeckName(deck){return deck===(selectedDeck||"")?currentDeckName():(otherDecks.find(d=>d.id===deck)||{}).name||""}
const decisionRef=item=>item.deck+"/"+item.id;
function decisionsShown(){return $("project_dlg").open&&project.tab==="decisions"&&!document.hidden}
function decisionFocused(){return Boolean(document.activeElement?.closest?.("#decisions_list .dec-card"))}
// A finger or the mouse is on the list: a redraw now would move or replace what is being pressed, and its click
// would go nowhere (Safari does not focus a pressed button, so focus alone does not tell).
const decisionPressed=()=>Date.now()-decisions.pointer<POINTER_HOLD_MS;
function decisionDeck(deck){
  if(!decisions.decks.has(deck))decisions.decks.set(deck,{items:null,error:"",pending:null,again:false,retry:0});
  return decisions.decks.get(deck);
}
// Each computer is asked on its own and drawn as soon as it answers.
function loadDecisions(){
  const key=decisionsKey(),decks=decisionDecks();clearTimeout(decisions.timer);
  if(decisions.key!==key){
    decisions.key=key;
    for(const deck of [...decisions.decks.keys()])if(!decks.includes(deck))decisions.decks.delete(deck);
    publishDecisions(true);
  }
  const asked=decks.map(deck=>refreshDecisionDeck(deck));
  if(decisionsShown())decisions.timer=setTimeout(()=>{if(decisionsShown())loadDecisions()},DECISIONS_POLL);
  return Promise.all(asked);
}
function refreshDecisionDeck(deck,now=false){
  const state=decisionDeck(deck),key=decisions.key;
  if(state.pending){if(now)state.again=true;return state.pending}
  const offline=otherDecks.find(d=>d.id===deck&&d.id!==(selectedDeck||""))?.error;
  if(!now&&(Date.now()<state.retry||offline&&state.error))return Promise.resolve();
  state.pending=(async()=>{
    try{
      const answer=await gatewayApi(instancePath(deck,"/api/decisions?name="));
      if(decisions.key!==key)return;
      Object.assign(state,{items:(answer.decisions||[]).map(item=>({...item,deck})),error:"",retry:0});
    }catch(e){
      if(decisions.key!==key||e.message===STALE)return;
      // A computer that does not answer keeps what it showed; one that never did adds nothing.
      Object.assign(state,{error:e.message,retry:Date.now()+DECISIONS_RETRY});
    }finally{state.pending=null}
    publishDecisions();
    if(state.again){state.again=false;await refreshDecisionDeck(deck,true)}
  })();
  return state.pending;
}
// What was just sent or closed here stays so until its computer says the same, so a read that started before
// the click cannot bring the card back.
function decisionWithLocal(item){
  const ref=decisionRef(item),local=decisions.local.get(ref);
  if(!local)return item;
  if(item.status!=="open"||Date.now()-local.at>DECISION_LOCAL_MS){decisions.local.delete(ref);return item}
  return {...item,...local.item};
}
function publishDecisions(force=false){
  const states=decisionDecks().map(deck=>decisions.decks.get(deck)).filter(Boolean),known=states.filter(s=>s.items);
  if(!known.length){
    decisions.items=null;decisions.raw="";
    decisions.error=states.length&&states.every(s=>s.error)?states[0].error:"";
    return renderDecisions();
  }
  const items=known.flatMap(s=>s.items).map(decisionWithLocal).filter(item=>["open","sent"].includes(item.status));
  items.sort((a,b)=>b.asked-a.asked);
  for(const item of items){
    // The computer has the draft now: what it says is the answer again.
    const ref=decisionRef(item);
    if(decisions.drafts.get(ref)?.trim()===item.answer&&!decisions.saves.has(ref)&&!decisions.saving.has(ref))decisions.drafts.delete(ref);
  }
  const raw=JSON.stringify(items);
  if(raw===decisions.raw&&!decisions.error&&!force)return;
  Object.assign(decisions,{raw,items,error:""});
  renderDecisions();
}
function decisionCardFor(ref){return decisions.cards.get(ref)?.node}
const findDecision=ref=>decisions.items?.find(x=>decisionRef(x)===ref);
function decisionDraft(item){const ref=decisionRef(item);return decisions.drafts.has(ref)?decisions.drafts.get(ref):item.answer}
// Every change is saved after a short pause, so another device (or a reload) finds the draft.
function setDecisionDraft(ref,text){
  decisions.drafts.set(ref,text);
  clearTimeout(decisions.saves.get(ref));
  decisions.saves.set(ref,setTimeout(()=>saveDecisionDraft(ref).catch(()=>{}),DECISION_SAVE_MS));
  const card=decisionCardFor(ref);
  if(card)markDecisionCard(card,ref);
  renderDecisionFooter();
}
// One save at a time per decision, each writing the latest text: an older one can never land last.
function saveDecisionDraft(ref){
  clearTimeout(decisions.saves.get(ref));decisions.saves.delete(ref);
  const next=(decisions.saving.get(ref)||Promise.resolve()).catch(()=>{}).then(()=>writeDecisionDraft(ref));
  decisions.saving.set(ref,next);
  next.catch(()=>{}).finally(()=>{if(decisions.saving.get(ref)===next)decisions.saving.delete(ref)});
  return next;
}
async function writeDecisionDraft(ref){
  const item=findDecision(ref);
  if(!decisions.drafts.has(ref)||!item)return;
  const text=decisions.drafts.get(ref);
  try{await gatewayApi(instancePath(item.deck,"/api/decisions_answer"),{id:item.id,answer:text})}
  catch(e){
    if(decisions.sending.has(ref))throw e;  // Send reports it once.
    await decisionRefused(e,[ref]);
  }
}
// Dictation started from a card's microphone ends up here (voice.js).
function decisionDictation(ref,text){
  const item=findDecision(ref);
  const current=decisions.drafts.has(ref)?decisions.drafts.get(ref):item?.answer||"";
  const next=joinDictation(current,text);
  const field=decisionCardFor(ref)?.querySelector("textarea");
  if(field&&document.activeElement!==field)field.value=next;
  else if(field){const end=field.value.length;field.setRangeText(next.slice(current.length),end,end,"preserve")}
  if(field)fitDecisionField(field);
  setDecisionDraft(ref,next);
}
function answeredDecisions(){
  return (decisions.items||[]).filter(item=>item.status==="open"&&item.live&&decisionDraft(item).trim()&&!decisions.sending.has(decisionRef(item)));
}
function markDecisionsLocally(items,change){
  for(const item of items)decisions.local.set(decisionRef(item),{at:Date.now(),item:change(item)});
  publishDecisions();
}
// One request per computer: each sends its own answers to its own sessions. Only the cards being sent wait;
// the rest of the list stays live, and only the computers concerned are asked again.
async function sendDecisions(refs){
  refs=refs.filter(ref=>!decisions.sending.has(ref));
  if(!refs.length)return;
  for(const ref of refs)decisions.sending.add(ref);
  renderDecisionFooter();
  const items=refs.map(findDecision).filter(Boolean),decks=[...new Set(items.map(item=>item.deck))];
  try{
    await Promise.all(refs.map(ref=>decisions.drafts.has(ref)||decisions.saving.has(ref)?saveDecisionDraft(ref):null));
    let sent=0;
    await Promise.all(decks.map(async deck=>{
      const mine=items.filter(item=>item.deck===deck);
      sent+=(await gatewayApi(instancePath(deck,"/api/decisions_send"),{ids:mine.map(item=>item.id)})).sent||0;
      markDecisionsLocally(mine,item=>({status:"sent",answer:decisionDraft(item).trim(),sent:Date.now()/1000}));
    }));
    toast(tr("Отправлено ответов: {0}. Агент получит их, когда сессия освободится",[sent]),true);
  }catch(e){await decisionRefused(e,refs)}
  finally{
    for(const ref of refs)decisions.sending.delete(ref);
    renderDecisionFooter();
    for(const deck of decks)refreshDecisionDeck(deck,true);
  }
}
// A refusal may mean the list is behind (answered from Telegram or another device): read it again and say so.
async function decisionRefused(e,refs){
  if(e.message===STALE)return;
  const decks=[...new Set(refs.map(ref=>findDecision(ref)?.deck).filter(deck=>deck!==undefined))];
  await Promise.all(decks.map(deck=>refreshDecisionDeck(deck,true)));
  const closed=refs.some(ref=>findDecision(ref)?.status!=="open");
  toast(closed?tr("На этот вопрос уже ответили: с другого устройства или из Telegram"):e.message);
}
async function dismissDecision(item){
  if(!await confirmAction(tr("Закрыть вопрос без ответа?"),{text:item.question,confirm:tr("Закрыть")}))return;
  try{
    await gatewayApi(instancePath(item.deck,"/api/decisions_dismiss"),{id:item.id});
    decisions.drafts.delete(decisionRef(item));
    markDecisionsLocally([item],()=>({status:"dismissed"}));
    refreshDecisionDeck(item.deck,true);
  }
  catch(e){if(e.message!==STALE)toast(e.message)}
}
function fitDecisionField(field){field.style.height="auto";field.style.height=Math.min(field.scrollHeight+2,320)+"px"}
function markDecisionCard(card,ref){
  const item=findDecision(ref);if(!item)return;
  const text=decisionDraft(item);
  const send=card.querySelector(".dec-send"),sending=decisions.sending.has(ref);
  send.disabled=!text.trim()||!item.live||sending;send.textContent=sending?tr("Отправляю…"):tr("Отправить");
  // A draft typed on another device shows here, never under one's own cursor.
  const field=card.querySelector("textarea");
  if(field&&document.activeElement!==field&&field.value!==text){field.value=text;fitDecisionField(field)}
  for(const chip of card.querySelectorAll(".dec-option"))chip.setAttribute("aria-pressed",String(chip.dataset.option===text.trim()));
}
function renderDecisionMics(){
  for(const button of document.querySelectorAll("#decisions_list .dec-mic")){
    const on=voice.rec?.target?.decision===button.dataset.ref;
    button.classList.toggle("on",on);button.setAttribute("aria-pressed",String(on));
  }
}
// The session (a tap opens it while it lives) and, with several computers, the computer it is on.
function decisionMeta(item){
  const meta=el("div","dec-meta");
  const name=el(item.live?"button":"span","dec-session",item.title||item.session);
  if(item.live){name.type="button";name.onclick=()=>openQuestionSession(item.deck,item.session)}
  meta.append(name);
  if(decisionDecks().length>1)meta.append(el("span","",decisionDeckName(item.deck)));
  meta.append(el("span","",formatTime(item.asked)));
  if(item.status==="sent")meta.append(el("span","dec-state",tr("Отправлено")));
  return meta;
}
function decisionCard(item){
  const ref=decisionRef(item),card=el("article","dec-card"+(item.status==="sent"?" sent":""));card.dataset.ref=ref;
  card.append(decisionMeta(item),el("p","dec-q",item.question));
  if(item.context)card.append(el("p","dec-ctx",item.context));
  if(item.status==="sent"){card.append(el("p","dec-answer",item.answer));return card}
  const field=document.createElement("textarea");
  field.rows=2;field.value=decisionDraft(item);field.placeholder=tr("Ваш ответ");field.setAttribute("aria-label",tr("Ответ на вопрос"));
  field.oninput=()=>{fitDecisionField(field);setDecisionDraft(ref,field.value)};
  field.onblur=()=>{if(decisions.saves.has(ref))saveDecisionDraft(ref).catch(()=>{});setTimeout(flushDecisions,0)};
  if(item.options.length){
    const options=el("div","dec-options");
    for(const option of item.options){
      const chip=el("button","dec-option",option);chip.type="button";chip.dataset.option=option;
      chip.onclick=()=>{field.value=option;fitDecisionField(field);setDecisionDraft(ref,option)};
      options.append(chip);
    }
    card.append(options);
  }
  const mic=el("button","dec-mic",svgIcon("mic"));mic.type="button";mic.dataset.ref=ref;
  mic.setAttribute("aria-label",tr("Надиктовать ответ"));mic.title=tr("Надиктовать ответ");
  mic.onclick=()=>toggleVoice({decision:ref});
  card.append(el("div","dec-field",field,mic));
  const send=el("button","dec-send",tr("Отправить"));send.type="button";send.onclick=()=>sendDecisions([ref]);
  const dismiss=el("button","dec-dismiss",tr("Не нужно"));dismiss.type="button";dismiss.onclick=()=>dismissDecision(item);
  card.append(el("div","dec-actions",dismiss,send));
  if(!item.live)card.append(el("p","dec-closed",tr("Сессия этого вопроса закрыта: ответ некуда отправить")));
  setTimeout(()=>fitDecisionField(field),0);
  markDecisionCard(card,ref);
  return card;
}
function renderDecisionFooter(){
  const footer=decisions.fixed?.footer;if(!footer)return;
  const ready=answeredDecisions();
  footer.hidden=ready.length<2;
  const button=footer.querySelector("button");
  button.textContent=tr("Отправить все ответы ({0})",[ready.length]);
  for(const {node} of decisions.cards.values())if(!node.classList.contains("sent"))markDecisionCard(node,node.dataset.ref);
}
// What a card shows: a card is rebuilt only when this changes. An open card's answer is its field, kept in step
// by markDecisionCard.
function decisionSignature(item){
  return JSON.stringify([item.status,item.question,item.context,item.options,item.live,item.title,item.session,item.asked,
    item.status==="sent"?item.answer:"",decisionDecks().length>1&&decisionDeckName(item.deck)]);
}
function decisionFixedNodes(){
  if(decisions.fixed)return decisions.fixed;
  const empty=el("p","files-empty dec-empty",tr("Вопросов нет. Сюда приходят вопросы и решения, которых агенты ждут от вас, со всех сессий и компьютеров. Ответ можно напечатать или надиктовать."));
  const sendAll=el("button","dec-send",tr("Отправить все ответы"));sendAll.type="button";
  sendAll.onclick=()=>sendDecisions(answeredDecisions().map(decisionRef));
  return decisions.fixed={empty,heading:el("h3","dec-heading",tr("Отправленные")),footer:el("div","dec-footer",sendAll)};
}
// Cards are kept and updated in place, never redrawn wholesale: a card under the cursor keeps its field, and
// nothing moves under a pressing finger (the redraw waits for the release). A card answered elsewhere is closed
// even under the cursor, or its Send would fail.
function renderDecisions(){
  const box=$("decisions_list");
  if(!decisions.items){
    decisions.cards.clear();decisions.fixed=null;
    box.replaceChildren(decisions.error?errorWithRetry(decisions.error,loadDecisions):listSkeleton());
    return;
  }
  if(decisionPressed()){decisions.stale=true;return}
  decisions.stale=false;
  const fixed=decisionFixedNodes(),held=document.activeElement?.closest?.("#decisions_list .dec-card"),cards=new Map();
  const card=item=>{
    const ref=decisionRef(item),signature=decisionSignature(item),known=decisions.cards.get(ref);
    if(known?.signature===signature)return cards.set(ref,known).get(ref).node;
    if(known&&known.node===held&&item.status==="open"){decisions.stale=true;return cards.set(ref,known).get(ref).node}
    return cards.set(ref,{signature,node:decisionCard(item)}).get(ref).node;
  };
  const waiting=decisions.items.filter(item=>item.status==="open").map(card),sent=decisions.items.filter(item=>item.status==="sent").map(card);
  decisions.cards=cards;
  const want=[fixed.empty,...waiting,...(sent.length?[fixed.heading,...sent]:[]),fixed.footer];
  for(const child of [...box.children])if(!want.includes(child))child.remove();
  let at=box.firstChild;
  // A node already in place is never re-inserted: that would drop the cursor from its field.
  for(const node of want){if(node===at)at=at.nextSibling;else box.insertBefore(node,at)}
  markQuestionsEmpty();renderDecisionFooter();renderDecisionMics();
}
function flushDecisions(){if(decisions.stale&&!decisionPressed())renderDecisions()}
function markQuestionsEmpty(){
  const empty=document.querySelector("#decisions_list .dec-empty");
  if(empty)empty.hidden=Boolean(decisions.items?.length)||openQuestions().length>0;
}
function decisionBadge(count){
  const badge=el("span","dec-count",String(count));badge.title=tr("Вопросов ждут ответа: {0}",[count]);
  return badge;
}
// Filed decisions waiting on every computer, from the session lists the page already has.
function waitingDecisions(){
  const count=list=>(list||[]).reduce((sum,s)=>sum+(s.decisions||0),0);
  return count(sessions)+otherDecks.filter(d=>d.id!==(selectedDeck||"")).reduce((sum,d)=>sum+count(d.sessions),0);
}
// The count on the panel's tab and the bar's panel button: everything that waits for the owner, wherever it is.
function markDecisionCount(){
  noticeDecisionCounts();
  const count=inboxCount(),tab=$("project_tabs").querySelector('[data-tab="decisions"]');
  if(tab)tab.dataset.count=count?String(count):"";
  const button=$("b_project");button.dataset.count=count?String(count):"";
  button.setAttribute("aria-label",count?tr("Ждут ответа: {0}",[count]):tr("Скрыть или показать панель проекта"));
}
// The session lists (every few seconds) carry each session's count of waiting decisions: a change there asks
// that computer for its decisions at once, so a new or answered one shows without waiting for the next check.
function noticeDecisionCounts(){
  const signature=list=>(list||[]).map(s=>s.name+":"+s.created+":"+(s.decisions||0)).join(",");
  const now=new Map([[selectedDeck||"",signature(sessions)],
    ...otherDecks.filter(d=>!d.error&&d.id!==(selectedDeck||"")).map(d=>[d.id,signature(d.sessions)])]);
  const changed=[...now].filter(([deck,value])=>decisions.counts.has(deck)&&decisions.counts.get(deck)!==value);
  decisions.counts=now;
  if(decisions.key===decisionsKey()&&decisionsShown())for(const [deck] of changed)refreshDecisionDeck(deck,true);
}
function formatTime(at){
  return new Intl.DateTimeFormat(DATE_LOCALE,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(at*1000));
}
if(typeof document!=="undefined"){
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&decisions.key&&decisionsShown())loadDecisions()});
  document.addEventListener("pointerdown",e=>{if(e.target.closest?.("#decisions_list"))decisions.pointer=Date.now()},true);
  // After the release the click has landed (it follows in the same task); then the waiting redraw runs.
  const release=()=>{if(!decisions.pointer)return;decisions.pointer=0;setTimeout(flushDecisions,0)};
  document.addEventListener("pointerup",release,true);document.addEventListener("pointercancel",release,true);
}
