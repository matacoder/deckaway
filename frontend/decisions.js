// Decisions agents left for their owner (integrations/decisions.py): the open session's, or every session's on this
// computer, each with its own answer field. A typed or dictated answer is kept on that computer as a draft (any
// device sees it) and goes to the agent with "Send", as a prompt typed once the session is free.
// The agent's text is shown as plain text: it is data, never markup.
const decisions={key:null,items:null,raw:"",error:"",timer:null,drafts:new Map(),saves:new Map(),stale:false,sending:false};
const DECISIONS_POLL=15000,DECISION_SAVE_MS=700;

function decisionScope(){try{return localStore.getItem("cc.decisions.scope")==="all"?"all":"session"}catch(e){return "session"}}
function setDecisionScope(scope){
  try{localStore.setItem("cc.decisions.scope",scope)}catch(e){}
  decisions.key=null;loadDecisions();
}
function decisionsKey(){return decisionScope()==="all"?(selectedDeck||"")+"/*":sessionInfoKey()}
function decisionsShown(){return $("project_dlg").open&&project.tab==="decisions"&&!document.hidden}
function decisionFocused(){return Boolean(document.activeElement?.closest?.("#decisions_body .dec-card"))}
async function loadDecisions(){
  const key=decisionsKey(),scope=decisionScope();clearTimeout(decisions.timer);
  if(!key)return;
  if(decisions.key!==key){Object.assign(decisions,{key,items:null,raw:"",error:""});renderDecisions()}
  try{
    const data=await api("/api/decisions?name="+encodeURIComponent(scope==="all"?"":active));
    if(decisions.key!==key)return;
    const raw=JSON.stringify(data.decisions||[]);
    if(raw!==decisions.raw||decisions.error){
      Object.assign(decisions,{raw,items:data.decisions||[],error:""});
      // Redrawn under a typing finger, the field would lose the cursor: the new list waits for the blur.
      if(decisionFocused())decisions.stale=true;else renderDecisions();
    }
  }catch(e){
    if(decisions.key!==key||e.message===STALE)return;
    decisions.error=e.message;if(!decisions.items)renderDecisions();
  }
  if(decisionsShown())decisions.timer=setTimeout(()=>{if(decisionsShown())loadDecisions()},DECISIONS_POLL);
}
function decisionCardFor(id){return [...document.querySelectorAll("#decisions_body .dec-card")].find(card=>card.dataset.id===id)}
function decisionDraft(item){return decisions.drafts.has(item.id)?decisions.drafts.get(item.id):item.answer}
// Every change is saved after a short pause, so another device (or a reload) finds the draft.
function setDecisionDraft(id,text){
  decisions.drafts.set(id,text);
  clearTimeout(decisions.saves.get(id));
  decisions.saves.set(id,setTimeout(()=>saveDecisionDraft(id),DECISION_SAVE_MS));
  const card=decisionCardFor(id);
  if(card)markDecisionCard(card,id);
  renderDecisionFooter();
}
async function saveDecisionDraft(id){
  clearTimeout(decisions.saves.get(id));decisions.saves.delete(id);
  if(!decisions.drafts.has(id))return;
  const text=decisions.drafts.get(id);
  try{
    await api("/api/decisions_answer",{id,answer:text});
    const item=decisions.items?.find(x=>x.id===id);if(item)item.answer=text.trim();
    if(decisions.drafts.get(id)===text)decisions.drafts.delete(id);
  }catch(e){if(e.message!==STALE)toast(e.message)}
}
// Dictation started from a card's microphone ends up here (voice.js).
function decisionDictation(id,text){
  const item=decisions.items?.find(x=>x.id===id);
  const current=decisions.drafts.has(id)?decisions.drafts.get(id):item?.answer||"";
  const next=joinDictation(current,text);
  const field=decisionCardFor(id)?.querySelector("textarea");
  if(field&&document.activeElement!==field)field.value=next;
  else if(field){const end=field.value.length;field.setRangeText(next.slice(current.length),end,end,"preserve")}
  if(field)fitDecisionField(field);
  setDecisionDraft(id,next);
}
function answeredDecisions(){
  return (decisions.items||[]).filter(item=>item.status==="open"&&item.live&&decisionDraft(item).trim());
}
async function sendDecisions(ids){
  if(decisions.sending||!ids.length)return;
  decisions.sending=true;renderDecisionFooter();
  try{
    for(const id of ids)if(decisions.drafts.has(id))await saveDecisionDraft(id);
    const result=await api("/api/decisions_send",{ids});
    toast(tr("Отправлено ответов: {0}. Агент получит их, когда сессия освободится",[result.sent]),true);
    decisions.raw="";await loadDecisions();
  }catch(e){if(e.message!==STALE)toast(e.message)}
  finally{decisions.sending=false;renderDecisionFooter()}
}
async function dismissDecision(item){
  if(!await confirmAction(tr("Закрыть вопрос без ответа?"),{text:item.question,confirm:tr("Закрыть")}))return;
  try{await api("/api/decisions_dismiss",{id:item.id});decisions.drafts.delete(item.id);decisions.raw="";await loadDecisions()}
  catch(e){if(e.message!==STALE)toast(e.message)}
}
function fitDecisionField(field){field.style.height="auto";field.style.height=Math.min(field.scrollHeight+2,320)+"px"}
function markDecisionCard(card,id){
  const item=decisions.items?.find(x=>x.id===id);if(!item)return;
  const text=decisionDraft(item);
  card.querySelector(".dec-send").disabled=!text.trim()||!item.live||decisions.sending;
  for(const chip of card.querySelectorAll(".dec-option"))chip.setAttribute("aria-pressed",String(chip.dataset.option===text.trim()));
}
function renderDecisionMics(){
  for(const button of document.querySelectorAll("#decisions_body .dec-mic")){
    const on=voice.rec?.target?.decision===button.dataset.id;
    button.classList.toggle("on",on);button.setAttribute("aria-pressed",String(on));
  }
}
function decisionCard(item,all){
  const card=el("article","dec-card"+(item.status==="sent"?" sent":""));card.dataset.id=item.id;
  const meta=el("div","dec-meta");
  if(all)meta.append(el("span","dec-session",item.title||item.session));
  meta.append(el("span","",formatTime(item.asked)));
  if(item.status==="sent")meta.append(el("span","dec-state",tr("Отправлено")));
  card.append(meta,el("p","dec-q",item.question));
  if(item.context)card.append(el("p","dec-ctx",item.context));
  if(item.status==="sent"){card.append(el("p","dec-answer",item.answer));return card}
  const field=document.createElement("textarea");
  field.rows=2;field.value=decisionDraft(item);field.placeholder=tr("Ваш ответ");field.setAttribute("aria-label",tr("Ответ на вопрос"));
  field.oninput=()=>{fitDecisionField(field);setDecisionDraft(item.id,field.value)};
  field.onblur=()=>{if(decisions.saves.has(item.id))saveDecisionDraft(item.id);setTimeout(()=>{if(decisions.stale&&!decisionFocused()){decisions.stale=false;renderDecisions()}},0)};
  if(item.options.length){
    const options=el("div","dec-options");
    for(const option of item.options){
      const chip=el("button","dec-option",option);chip.type="button";chip.dataset.option=option;
      chip.onclick=()=>{field.value=option;fitDecisionField(field);setDecisionDraft(item.id,option)};
      options.append(chip);
    }
    card.append(options);
  }
  const mic=el("button","dec-mic",svgIcon("mic"));mic.type="button";mic.dataset.id=item.id;
  mic.setAttribute("aria-label",tr("Надиктовать ответ"));mic.title=tr("Надиктовать ответ");
  mic.onclick=()=>toggleVoice({decision:item.id});
  card.append(el("div","dec-field",field,mic));
  const send=el("button","dec-send",tr("Отправить"));send.type="button";send.onclick=()=>sendDecisions([item.id]);
  const dismiss=el("button","dec-dismiss",tr("Не нужно"));dismiss.type="button";dismiss.onclick=()=>dismissDecision(item);
  card.append(el("div","dec-actions",dismiss,send));
  if(!item.live)card.append(el("p","dec-closed",tr("Сессия этого вопроса закрыта: ответ некуда отправить")));
  setTimeout(()=>fitDecisionField(field),0);
  markDecisionCard(card,item.id);
  return card;
}
function decisionScopeSwitch(){
  const box=el("div","dec-scope"),scope=decisionScope();box.setAttribute("role","group");
  for(const [value,label] of [["session",tr("Эта сессия")],["all",tr("Все сессии компьютера")]]){
    const b=el("button","",label);b.type="button";b.setAttribute("aria-pressed",String(scope===value));
    b.onclick=()=>{if(decisionScope()!==value)setDecisionScope(value)};box.append(b);
  }
  return box;
}
function renderDecisionFooter(){
  const footer=document.querySelector("#decisions_body .dec-footer");if(!footer)return;
  const ready=answeredDecisions();
  footer.hidden=ready.length<2;
  const button=footer.querySelector("button");
  button.textContent=tr("Отправить все ответы ({0})",[ready.length]);button.disabled=decisions.sending;
  for(const card of document.querySelectorAll("#decisions_body .dec-card:not(.sent)"))markDecisionCard(card,card.dataset.id);
}
function renderDecisions(){
  const box=$("decisions_body"),all=decisionScope()==="all";box.replaceChildren(decisionScopeSwitch());
  if(decisions.error&&!decisions.items){box.append(errorWithRetry(decisions.error,loadDecisions));return}
  if(!decisions.items){box.append(listSkeleton());return}
  const waiting=decisions.items.filter(item=>item.status==="open"),sent=decisions.items.filter(item=>item.status==="sent");
  if(!decisions.items.length)box.append(el("p","files-empty",tr("Вопросов нет. Здесь собираются решения, которых агенты ждут от вас, например во время дежурства. Ответ можно напечатать или надиктовать.")));
  for(const item of waiting)box.append(decisionCard(item,all));
  if(sent.length){box.append(el("h3","dec-heading",tr("Отправленные")));for(const item of sent)box.append(decisionCard(item,all))}
  const sendAll=el("button","dec-send",tr("Отправить все ответы"));sendAll.type="button";
  sendAll.onclick=()=>sendDecisions(answeredDecisions().map(item=>item.id));
  box.append(el("div","dec-footer",sendAll));
  renderDecisionFooter();renderDecisionMics();
}
function decisionBadge(count){
  const badge=el("span","dec-count",String(count));badge.title=tr("Вопросов ждут ответа: {0}",[count]);
  return badge;
}
// The count on the sidebar's tab and the bar button: decisions the open session waits for.
function markDecisionCount(){
  const count=cur()?.decisions||0,tab=$("project_tabs").querySelector('[data-tab="decisions"]');
  if(tab)tab.dataset.count=count?String(count):"";
  $("b_project").classList.toggle("has-decisions",Boolean(count));
}
function formatTime(at){
  return new Intl.DateTimeFormat(DATE_LOCALE,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(at*1000));
}
if(typeof document!=="undefined")document.addEventListener("visibilitychange",()=>{if(!document.hidden&&decisions.key&&decisionsShown())loadDecisions()});
