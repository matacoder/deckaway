// Agent questions on every computer, answerable here: on top of the Questions tab, above the decisions agents filed
// (decisions.js), and on the board. Finished work is not listed: it waits for nothing (the session list and the
// board mark it).
const inbox={questions:[],cards:new Map(),nodes:new Map(),loading:false};

// Pure for tests.
function inboxItems(questions){return questions.map(q=>({kind:"question",key:(q.deck||"")+"/"+q.session,question:q}))}
function finishedSessions(){
  const local=[...attention].map(name=>({deck:selectedDeck,session:name,machine:currentDeckName()}));
  const remote=[...otherAttention].map(key=>{const [deck,session]=key.split("/");return {deck,session,machine:(otherDecks.find(d=>d.id===deck)||{}).name||""}});
  return [...local,...remote];
}
async function loadInbox(){
  if(document.hidden||inbox.loading)return;
  inbox.loading=true;
  try{inbox.questions=(await api("/api/inbox",null,true)).questions||[]}catch(e){/* Older gateways have no inbox; the list stays empty. */}
  finally{inbox.loading=false}
  renderInbox();if(typeof board!=="undefined"&&board.on)renderBoard();
}
// Without the ones just answered, here or in the session's own card: the agent's screen still shows them.
const openQuestions=()=>inbox.questions.filter(q=>!wasAnswered((q.deck||"")+"/"+q.session+"/"+q.id));
function inboxCount(){return inboxItems(openQuestions()).length+waitingDecisions()}
// The count of what waits is on the bar's panel button and the Questions tab (decisions.js), the menu button on a phone.
function renderInboxBadge(){markDecisionCount();return inboxCount()}
function openQuestionSession(deck,session){
  if(!projectDocked())closeProject();
  if((deck||"")!==selectedDeck)openDeckSession(deck||"",session);else select(session);
}
function renderInbox(){
  renderInboxBadge();
  if(!$("project_dlg").open||project.tab!=="decisions")return;
  const list=$("decisions_live"),items=inboxItems(openQuestions());
  const live=new Set(items.filter(i=>i.kind==="question").map(i=>i.key+"/"+i.question.id));
  for(const key of inbox.cards.keys())if(!live.has(key))inbox.cards.delete(key);
  const nodes=items.map(item=>{
    const key=item.kind+"/"+item.key+"/"+item.question.id;
    const deck=item.question.deck||"",session=item.question.session;
    const signature=JSON.stringify([item,inboxLabel(item,deck,session),deckDirectory.name]),known=inbox.nodes.get(key);
    if(known?.signature===signature)return known.node;
    const node=renderInboxItem(item);node.dataset.inboxKey=key;
    inbox.nodes.set(key,{signature,node});return node;
  });
  for(const [key,entry] of inbox.nodes)if(!nodes.includes(entry.node))inbox.nodes.delete(key);
  reconcileInbox(list,nodes);markQuestionsEmpty();
}
// Moving an unchanged focused row also blurs it in browsers, so leave rows already in place alone.
function reconcileInbox(list,nodes){
  const focused=document.activeElement,row=focused?.closest(".inbox-item"),index=row?[...row.querySelectorAll('button,textarea,[tabindex="0"]')].indexOf(focused):-1;
  const selection=focused?.tagName==="TEXTAREA"?[focused.selectionStart,focused.selectionEnd]:null;
  const rowIndex=row?[...list.children].indexOf(row):-1;
  nodes.forEach((node,i)=>{if(list.children[i]!==node)list.insertBefore(node,list.children[i]||null)});
  for(const node of [...list.children])if(!nodes.includes(node))node.remove();
  if(row&&document.activeElement!==focused){
    const next=nodes.find(n=>n.dataset.inboxKey===row.dataset.inboxKey)||nodes[Math.min(rowIndex,nodes.length-1)];
    const control=next?.querySelectorAll('button,textarea,[tabindex="0"]')[Math.max(0,index)];
    control?.focus({preventScroll:true});
    if(selection&&control?.tagName==="TEXTAREA")control.setSelectionRange(...selection);
  }
}
// The name the user gave the session, not its technical tmux name.
function inboxLabel(item,deck,session){
  if(item.question.label)return item.question.label;
  const list=deck===selectedDeck?sessions:(otherDecks.find(d=>d.id===deck)||{}).sessions||[];
  const found=list.find(s=>s.name===session);
  return found?sessionTitle(found):session;
}
function renderInboxItem(item){
  const q=item.question,machine=q.origin||(q.deck?"":deckDirectory.name),deck=q.deck||"",session=q.session;
  const head=el("button","inbox-head",agentIcon({agent:q.agent}),el("span","inbox-session",inboxLabel(item,deck,session)),
    el("span","inbox-machine",machine||""));
  head.type="button";head.onclick=()=>openQuestionSession(deck,session);
  const box=el("div","inbox-item",head);
  box.append(answerCard(q,deck,()=>{inbox.questions=inbox.questions.filter(x=>x!==q);renderInbox()}));
  return box;
}
// A question answered in place, here or on the board; per question, not per session: a new question in the
// same session starts with a clean card. The draft is shared by every place that shows the question.
function answerCard(q,deck,answered){
  const draftKey=(deck||"")+"/"+q.session+"/"+q.id,saved=answerDraft(draftKey);
  const card=el("div","inbox-question"),state=inbox.cards.get(draftKey)||{expanded:false,busy:null,textIndex:saved?.index??null,draft:saved?.text||""};
  inbox.cards.set(draftKey,state);
  const answer=async(index,text)=>{
    state.busy=index;draw();
    const body={name:q.session,id:q.id,index};if(text!==undefined)body.text=text;
    try{await api(instancePath(deck,"/api/answer"),body,true);toast(tr("Ответ отправлен: {0}",[text===undefined?q.options[index].label:text.slice(0,80)]),"success");
      saveAnswerDraft(draftKey,null);markAnswered(draftKey);inbox.cards.delete(draftKey);answered();if(deck===selectedDeck)load()}
    catch(e){state.busy=null;draw();toast(e.message)}
  };
  const draw=()=>renderQuestionCard({box:card,question:q,expanded:state.expanded,busyIndex:state.busy,textIndex:state.textIndex,textDraft:state.draft,translate:tr,
    onToggle:()=>{state.expanded=!state.expanded;draw()},onAnswer:index=>answer(index),
    onTextOption:index=>{state.textIndex=state.textIndex===index?null:index;draw();card.querySelector(".q-text textarea")?.focus()},onTextInput:value=>{state.draft=value;saveAnswerDraft(draftKey,{index:state.textIndex,text:value})},onSubmitText:answer});
  draw();return card;
}

if(typeof module!=="undefined")module.exports={inboxItems};
