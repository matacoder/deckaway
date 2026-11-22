// Decisions agents left for their owner (integrations/decisions.py), every session's on every computer in one
// list under the questions on agents' screens (inbox.js), each with its own answer field. A typed or dictated answer is kept on that computer as a draft (any
// device sees it) and goes to the agent with "Send", as a prompt typed once the session is free.
// The agent's text is shown as plain text: it is data, never markup.
const decisions={key:null,items:null,raw:"",error:"",timer:null,drafts:new Map(),saves:new Map(),stale:false,sending:false};
const DECISIONS_POLL=15000,DECISION_SAVE_MS=700;

// Every computer the page knows, the selected one first: questions are one stream, not one per place.
function decisionDecks(){return [selectedDeck||"",...otherDecks.map(d=>d.id).filter(id=>id!==(selectedDeck||""))]}
function decisionsKey(){return decisionDecks().join(",")}
function decisionDeckName(deck){return deck===(selectedDeck||"")?currentDeckName():(otherDecks.find(d=>d.id===deck)||{}).name||""}
const decisionRef=item=>item.deck+"/"+item.id;
function decisionsShown(){return $("project_dlg").open&&project.tab==="decisions"&&!document.hidden}
function decisionFocused(){return Boolean(document.activeElement?.closest?.("#decisions_list .dec-card"))}
async function loadDecisions(){
  const key=decisionsKey(),decks=decisionDecks();clearTimeout(decisions.timer);
  if(decisions.key!==key){Object.assign(decisions,{key,items:decisions.items&&decisions.items.filter(x=>decks.includes(x.deck)),raw:"",error:""});renderDecisions()}
  const answers=await Promise.allSettled(decks.map(deck=>gatewayApi(instancePath(deck,"/api/decisions?name="))));
  if(decisions.key!==key)return;
  // A computer that does not answer keeps what it showed; one that never did adds nothing.
  const items=[],failed=[];
  answers.forEach((answer,i)=>{
    if(answer.status==="fulfilled")items.push(...(answer.value.decisions||[]).map(item=>({...item,deck:decks[i]})));
    else{failed.push(answer.reason);items.push(...(decisions.items||[]).filter(x=>x.deck===decks[i]))}
  });
  if(failed.length===decks.length&&!failed.every(e=>e.message===STALE)){decisions.error=failed[0].message;if(!decisions.items)renderDecisions()}
  else if(failed.length<decks.length){
    items.sort((a,b)=>b.asked-a.asked);
    const raw=JSON.stringify(items);
    if(raw!==decisions.raw||decisions.error){
      Object.assign(decisions,{raw,items,error:""});
      // Redrawn under a typing finger, the field would lose the cursor: the new list waits for the blur.
      if(decisionFocused())decisions.stale=true;else renderDecisions();
    }
  }
  if(decisionsShown())decisions.timer=setTimeout(()=>{if(decisionsShown())loadDecisions()},DECISIONS_POLL);
}
function decisionCardFor(ref){return [...document.querySelectorAll("#decisions_list .dec-card")].find(card=>card.dataset.ref===ref)}
const findDecision=ref=>decisions.items?.find(x=>decisionRef(x)===ref);
function decisionDraft(item){const ref=decisionRef(item);return decisions.drafts.has(ref)?decisions.drafts.get(ref):item.answer}
// Every change is saved after a short pause, so another device (or a reload) finds the draft.
function setDecisionDraft(ref,text){
  decisions.drafts.set(ref,text);
  clearTimeout(decisions.saves.get(ref));
  decisions.saves.set(ref,setTimeout(()=>saveDecisionDraft(ref),DECISION_SAVE_MS));
  const card=decisionCardFor(ref);
  if(card)markDecisionCard(card,ref);
  renderDecisionFooter();
}
async function saveDecisionDraft(ref){
  clearTimeout(decisions.saves.get(ref));decisions.saves.delete(ref);
  const item=findDecision(ref);
  if(!decisions.drafts.has(ref)||!item)return;
  const text=decisions.drafts.get(ref);
  try{
    await gatewayApi(instancePath(item.deck,"/api/decisions_answer"),{id:item.id,answer:text});
    item.answer=text.trim();
    if(decisions.drafts.get(ref)===text)decisions.drafts.delete(ref);
  }catch(e){if(e.message!==STALE)toast(e.message)}
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
  return (decisions.items||[]).filter(item=>item.status==="open"&&item.live&&decisionDraft(item).trim());
}
// One request per computer: each sends its own answers to its own sessions.
async function sendDecisions(refs){
  if(decisions.sending||!refs.length)return;
  decisions.sending=true;renderDecisionFooter();
  try{
    for(const ref of refs)if(decisions.drafts.has(ref))await saveDecisionDraft(ref);
    const byDeck=new Map();
    for(const item of refs.map(findDecision).filter(Boolean))byDeck.set(item.deck,[...(byDeck.get(item.deck)||[]),item.id]);
    let sent=0;
    for(const [deck,ids] of byDeck)sent+=(await gatewayApi(instancePath(deck,"/api/decisions_send"),{ids})).sent||0;
    toast(tr("Отправлено ответов: {0}. Агент получит их, когда сессия освободится",[sent]),true);
    decisions.raw="";await loadDecisions();
  }catch(e){if(e.message!==STALE)toast(e.message)}
  finally{decisions.sending=false;renderDecisionFooter()}
}
async function dismissDecision(item){
  if(!await confirmAction(tr("Закрыть вопрос без ответа?"),{text:item.question,confirm:tr("Закрыть")}))return;
  try{await gatewayApi(instancePath(item.deck,"/api/decisions_dismiss"),{id:item.id});decisions.drafts.delete(decisionRef(item));decisions.raw="";await loadDecisions()}
  catch(e){if(e.message!==STALE)toast(e.message)}
}
function fitDecisionField(field){field.style.height="auto";field.style.height=Math.min(field.scrollHeight+2,320)+"px"}
function markDecisionCard(card,ref){
  const item=findDecision(ref);if(!item)return;
  const text=decisionDraft(item);
  card.querySelector(".dec-send").disabled=!text.trim()||!item.live||decisions.sending;
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
  field.onblur=()=>{if(decisions.saves.has(ref))saveDecisionDraft(ref);setTimeout(()=>{if(decisions.stale&&!decisionFocused()){decisions.stale=false;renderDecisions()}},0)};
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
  const footer=document.querySelector("#decisions_list .dec-footer");if(!footer)return;
  const ready=answeredDecisions();
  footer.hidden=ready.length<2;
  const button=footer.querySelector("button");
  button.textContent=tr("Отправить все ответы ({0})",[ready.length]);button.disabled=decisions.sending;
  for(const card of document.querySelectorAll("#decisions_list .dec-card:not(.sent)"))markDecisionCard(card,card.dataset.ref);
}
// Questions on an agent's screen come first (inbox.js draws them above): they hold the agent right now.
function renderDecisions(){
  const box=$("decisions_list");box.replaceChildren();
  if(decisions.error&&!decisions.items){box.append(errorWithRetry(decisions.error,loadDecisions));return}
  if(!decisions.items){box.append(listSkeleton());return}
  const waiting=decisions.items.filter(item=>item.status==="open"),sent=decisions.items.filter(item=>item.status==="sent");
  const empty=el("p","files-empty dec-empty",tr("Вопросов нет. Сюда приходят вопросы и решения, которых агенты ждут от вас, со всех сессий и компьютеров. Ответ можно напечатать или надиктовать."));
  box.append(empty);markQuestionsEmpty();
  for(const item of waiting)box.append(decisionCard(item));
  if(sent.length){box.append(el("h3","dec-heading",tr("Отправленные")));for(const item of sent)box.append(decisionCard(item))}
  const sendAll=el("button","dec-send",tr("Отправить все ответы"));sendAll.type="button";
  sendAll.onclick=()=>sendDecisions(answeredDecisions().map(decisionRef));
  box.append(el("div","dec-footer",sendAll));
  renderDecisionFooter();renderDecisionMics();
}
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
  const count=inboxCount(),tab=$("project_tabs").querySelector('[data-tab="decisions"]');
  if(tab)tab.dataset.count=count?String(count):"";
  const button=$("b_project");button.dataset.count=count?String(count):"";
  button.setAttribute("aria-label",count?tr("Ждут ответа: {0}",[count]):tr("Скрыть или показать панель проекта"));
}
function formatTime(at){
  return new Intl.DateTimeFormat(DATE_LOCALE,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(at*1000));
}
if(typeof document!=="undefined")document.addEventListener("visibilitychange",()=>{if(!document.hidden&&decisions.key&&decisionsShown())loadDecisions()});
