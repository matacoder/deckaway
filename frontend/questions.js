function svgIcon(name){
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),use=document.createElementNS(ns,"use");
  svg.setAttribute("class","ui-icon");svg.setAttribute("aria-hidden","true");use.setAttribute("href","#i-"+name);svg.append(use);
  return svg;
}

// Free-text options (Other / Type something) open a text field; the answer is typed into that row.
// A question of several choices (`multi`) toggles its rows into `picks` and is sent by one button under them.
// Its title is left out when the terminal right above shows it (`showTitle`).
function renderQuestionCard({box,question,expanded,busyIndex,textIndex,textDraft="",picks=new Set(),showTitle=true,onAnswer,onToggle,onTextOption,onTextInput,onSubmitText,onPick,onSubmitChoices,onHide,translate}){
  box.replaceChildren();
  box.hidden=!question;
  if(!question)return;
  const busy=busyIndex!==null&&busyIndex!==undefined;
  const head=document.createElement("div");head.className="q-head";
  head.append(translate("Вопрос агента"));
  if(question.progress){const progress=document.createElement("span");progress.className="q-progress";progress.textContent=question.progress;head.append(progress)}
  if(onHide){
    const hide=document.createElement("button");hide.type="button";hide.className="q-hide";
    hide.title=translate("Скрыть");hide.setAttribute("aria-label",translate("Скрыть"));hide.append(svgIcon("x"));hide.onclick=onHide;
    head.append(hide);
  }
  // Not a <button>: WebKit neither clamps nor scrolls the text of one, so a long command pushed the answers off
  // a phone's screen with no way to reach them.
  const title=document.createElement("div");title.className="q-title"+(expanded?" open":"");
  title.setAttribute("role","button");title.tabIndex=0;
  title.textContent=question.title;title.setAttribute("aria-expanded",String(Boolean(expanded)));title.onclick=onToggle;
  title.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onToggle?.()}};
  const multi=Boolean(question.multi),typed=textIndex!==null&&textIndex!==undefined&&Boolean(textDraft.trim());
  const options=document.createElement("div");options.className="q-options";
  question.options.forEach((option,index)=>{
    const button=document.createElement("button");button.type="button";
    const picked=multi&&(option.text?typed&&index===textIndex:picks.has(index));
    button.className="q-opt"+(option.text?" q-free":"")+(!multi&&index===question.selected?" selected":"")+(index===busyIndex?" sending":"")+(index===textIndex?" active":"")+(picked?" picked":"");
    const number=document.createElement("span");number.className="q-num";
    if(option.text)number.append(svgIcon("pencil"));else if(picked)number.append(svgIcon("check"));else number.textContent=String(index+1);
    const label=document.createElement("span");label.textContent=option.label;
    button.append(number,label);button.disabled=busy;
    if(multi&&!option.text)button.setAttribute("aria-pressed",String(picked));
    button.onclick=()=>option.text?onTextOption&&onTextOption(index):multi?onPick(index):onAnswer(index);
    options.append(button);
    if(option.text&&index===textIndex){
      const form=document.createElement("form");form.className="q-text";
      const field=document.createElement("textarea");field.rows=2;field.maxLength=4000;field.placeholder=translate("Ваш ответ…");field.disabled=busy;field.value=textDraft;
      field.oninput=()=>onTextInput&&onTextInput(field.value);
      form.onsubmit=event=>{event.preventDefault();if(multi)onSubmitChoices();else if(field.value.trim())onSubmitText(index,field.value)};
      form.append(field);
      // A question of several choices has one send button for all of it, under the rows.
      if(!multi){
        const send=document.createElement("button");send.type="submit";send.className="pri";send.textContent=translate("Ответить");send.disabled=busy;
        form.append(send);
      }
      options.append(form);
    }
  });
  if(multi){
    const send=document.createElement("button");send.type="button";send.className="pri q-send";
    send.textContent=translate("Ответить");send.disabled=busy||!(picks.size||typed);send.onclick=onSubmitChoices;
    options.append(send);
  }
  box.append(head,...(showTitle?[title]:[]),options);
}

// Typed answers survive reloads, language switches, logout and computer switches, like message drafts.
const ANSWER_DRAFTS="cc.answer-drafts";
function readAnswerDrafts(){try{const all=JSON.parse(sessionStorage.getItem(ANSWER_DRAFTS)||"{}");return all&&typeof all==="object"?all:{}}catch(e){return {}}}
function answerDraft(key){const draft=readAnswerDrafts()[key];return draft&&typeof draft.text==="string"&&Number.isInteger(draft.index)?draft:null}
function saveAnswerDraft(key,draft){
  const all=readAnswerDrafts();
  if(draft&&draft.text)all[key]={index:draft.index,text:draft.text};else delete all[key];
  try{sessionStorage.setItem(ANSWER_DRAFTS,JSON.stringify(all))}catch(e){}
}

// One styled confirm for every destructive action; resolves false on Escape or backdrop close.
function askConfirm(dialog,{title,text="",confirm,danger=false}){
  return new Promise(resolve=>{
    dialog.querySelector("#confirm_title").textContent=title;
    dialog.querySelector("#confirm_text").textContent=text;
    dialog.querySelector("#confirm_text").hidden=!text;
    const ok=dialog.querySelector("#confirm_ok");ok.textContent=confirm;ok.className=danger?"danger-pri":"pri";
    dialog.returnValue="";
    dialog.addEventListener("close",()=>resolve(dialog.returnValue==="ok"),{once:true});
    dialog.showModal();ok.focus();
  });
}

// A question stays on the agent's screen for a moment after its answer is typed, and a list read then would
// bring the card back. One answered (deck/session/id) is left out for a few seconds, in the card and the inbox.
const answeredQuestions=new Map(),ANSWERED_MS=8000;
function markAnswered(key,now=Date.now()){answeredQuestions.set(key,now)}
function wasAnswered(key,now=Date.now()){
  for(const [k,at] of answeredQuestions)if(now-at>ANSWERED_MS)answeredQuestions.delete(k);
  return answeredQuestions.has(key);
}
// A card the owner hid (a question the panel cannot answer, or one answered in the terminal) stays hidden in this
// browser until the agent asks something else; the terminal and its keys still answer it.
const HIDDEN_QUESTIONS="cc.hidden-questions",HIDDEN_MS=7*86400000;
function hiddenQuestions(now=Date.now()){
  let all={};try{all=JSON.parse(localStorage.getItem(HIDDEN_QUESTIONS)||"{}")||{}}catch(e){}
  for(const key of Object.keys(all))if(!(now-all[key]<HIDDEN_MS))delete all[key];
  return all;
}
function hideQuestion(key,now=Date.now()){
  const all=hiddenQuestions(now);all[key]=now;
  try{localStorage.setItem(HIDDEN_QUESTIONS,JSON.stringify(all))}catch(e){}
}
function isHiddenQuestion(key){return Object.hasOwn(hiddenQuestions(),key)}
if(typeof module!=="undefined")module.exports={svgIcon,renderQuestionCard,askConfirm,answerDraft,saveAnswerDraft,markAnswered,wasAnswered,hideQuestion,isHiddenQuestion};

// The open session's question: fetched with the screen, drawn as a card, answered by its buttons.
let question={name:null,data:null,expanded:false,busy:null,textIndex:null,picks:new Set()},loadingQuestion=false,questionCard="";
async function loadQuestion(){
  const s=cur();
  if(!s||agentOf(s)==="shell"||!s.running){if(question.data)setQuestion(s?.name||null,null);return}
  if(loadingQuestion||question.busy!==null||document.hidden)return;
  loadingQuestion=true;const name=s.name;
  try{
    const data=await api("/api/question?name="+encodeURIComponent(name)),got=data.question;
    if(active===name)setQuestion(name,got&&(wasAnswered(answerKey(name,got.id))||isHiddenQuestion(answerKey(name,got.id)))?null:got);
  }
  catch(e){/* Questions are an optional shortcut; the key row still works. */}
  finally{loadingQuestion=false}
}
function setQuestion(name,data){
  const same=question.name===name&&JSON.stringify(question.data)===JSON.stringify(data);
  if(same)return;
  const keepExpanded=question.name===name&&question.data?.id===data?.id;
  const saved=data?answerDraft(answerKey(name,data.id)):null;
  // Marks made on the page are kept while the same question refreshes; a new one starts from its screen.
  const picks=keepExpanded?question.picks:new Set((data?.checked||[]).flatMap((on,i)=>on&&!data.options[i]?.text?[i]:[]));
  question={name,data,expanded:keepExpanded&&question.expanded,busy:null,picks,
    textIndex:saved?saved.index:keepExpanded?question.textIndex:null,textDraft:saved?saved.text:keepExpanded?question.textDraft:""};
  renderQuestion();
}
const answerKey=(name,id)=>selectedDeck+"/"+name+"/"+id;
function saveQuestionDraft(){
  if(question.data)saveAnswerDraft(answerKey(question.name,question.data.id),{index:question.textIndex,text:question.textDraft});
}
function renderQuestion(){
  const data=question.name===active?question.data:null;
  // The card's own buttons answer; the 1/2/3 keys would only repeat them on a short screen.
  document.body.classList.toggle("has-question",Boolean(data));
  // Typing an answer must not be wiped by the 2.5 s refresh, so an open text field pauses re-rendering.
  // Only while the card is still this question: its buttons answer the one known now, not the one drawn.
  const card=data?question.name+"\n"+data.id:"";
  if($("question").querySelector(".q-text textarea:focus")&&questionCard===card)return;
  questionCard=card;
  renderQuestionCard({box:$("question"),question:data,expanded:question.expanded,busyIndex:question.busy,textIndex:question.textIndex,textDraft:question.textDraft||"",translate:tr,
    picks:question.picks,showTitle:!data?.screen,
    onPick:index=>{question.picks.has(index)?question.picks.delete(index):question.picks.add(index);renderQuestion()},
    onSubmitChoices:answerChoices,
    // The send button of several choices follows the text as it is typed; the field itself is not redrawn.
    onTextInput:value=>{question.textDraft=value;saveQuestionDraft();const send=$("question").querySelector(".q-send");if(send)send.disabled=!(question.picks.size||value.trim())},
    onToggle:()=>{question.expanded=!question.expanded;renderQuestion()},onAnswer:answerQuestion,
    onHide:()=>{hideQuestion(answerKey(question.name,data.id));setQuestion(question.name,null)},
    // Focus inside the tap itself: iOS opens the keyboard only for a user gesture, and a
    // refocus on every refresh would pop the keyboard back after the user dismissed it.
    onTextOption:index=>{question.textIndex=question.textIndex===index?null:index;renderQuestion();$("question").querySelector(".q-text textarea")?.focus()},
    onSubmitText:(index,text)=>answerQuestion(index,text)});
}
async function answerQuestion(index,text){
  const name=active,data=question.data;
  if(!data||question.busy!==null||panelUpdating)return;
  question.busy=index;$("question").querySelector(".q-text textarea")?.blur();renderQuestion();
  try{
    await api("/api/answer",text===undefined?{name,id:data.id,index}:{name,id:data.id,index,text});
    saveAnswerDraft(answerKey(name,data.id),null);markAnswered(answerKey(name,data.id));
    sendStates.set(name,{text:tr("Ответ отправлен: {0}",[text===undefined?data.options[index].label:text.slice(0,80)]),phase:"success"});
    question={name,data:null,expanded:false,busy:null,textIndex:null,picks:new Set()};
  }catch(e){toast(e.message);question.busy=null}
  renderQuestion();renderSendState();await load();loadQuestion();
}
async function answerChoices(){
  const name=active,data=question.data;
  if(!data||question.busy!==null||panelUpdating)return;
  const text=question.textIndex!==null&&question.textDraft?.trim()?question.textDraft:undefined,picks=[...question.picks].sort((a,b)=>a-b);
  if(!picks.length&&text===undefined)return;
  question.busy=-1;$("question").querySelector(".q-text textarea")?.blur();renderQuestion();
  try{
    await api("/api/answer",text===undefined?{name,id:data.id,picks}:{name,id:data.id,picks,text});
    saveAnswerDraft(answerKey(name,data.id),null);markAnswered(answerKey(name,data.id));
    const said=[...picks.map(i=>data.options[i].label),...(text===undefined?[]:[text.slice(0,80)])].join(", ");
    sendStates.set(name,{text:tr("Ответ отправлен: {0}",[said]),phase:"success"});
    question={name,data:null,expanded:false,busy:null,textIndex:null,picks:new Set()};
  }catch(e){toast(e.message);question.busy=null}
  renderQuestion();renderSendState();await load();loadQuestion();
}
