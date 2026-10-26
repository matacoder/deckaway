// Comments on lines of a file open in the file viewer, sent to the session's agent as one review message.
// Tapping a paragraph (or a line in text view) while commenting opens a note for its source lines. Notes are
// kept in this browser per computer and file until sent, like a draft. Bundled before app.js.
const review={key:null,path:null,notes:[],on:false,send:null,toggle:null};
const reviewKey=path=>"cc.review."+(selectedDeck||"")+":"+path;
function loadReview(path){
  const key=reviewKey(path);if(review.key===key)return;
  let notes=[];
  try{notes=JSON.parse(localStore.getItem(key)||"[]")}catch(e){}
  review.key=key;review.path=path;
  review.notes=Array.isArray(notes)?notes.filter(n=>n&&n.from>0&&n.to>=n.from&&typeof n.text==="string"&&n.text.trim()):[];
  review.on=review.notes.length>0;
}
function storeReview(notes=review.notes,key=review.key){
  try{notes.length?localStore.setItem(key,JSON.stringify(notes)):localStore.removeItem(key)}catch(e){}
}
// The message for the agent: each note with its lines quoted from the file as it is now. Pure for tests.
function reviewPrompt(path,notes,lines){
  const quote=(from,to)=>{const text=lines.slice(from-1,to).join(" ").replace(/\s+/g," ").trim();return text.length>160?text.slice(0,159)+"…":text};
  const items=[...notes].sort((a,b)=>a.from-b.from||a.to-b.to).map(n=>
    (n.from===n.to?"Line "+n.from:"Lines "+n.from+"-"+n.to)+': "'+quote(n.from,n.to)+'"\n'+n.text.trim());
  return "Review of "+path+": my comments on its lines as the file is now. Address each one.\n\n"+items.join("\n\n");
}
const lineSpan=(from,to)=>from===to?tr("Строка {0}",[from]):tr("Строки {0}–{1}",[from,to]);
// Called by the reader once its view is drawn: the toggle in the head, the send button, the notes in place.
function reviewReader(view,head,acts,file){
  loadReview(file.path);
  review.toggle=fileButton(tr("Комментарии"),"files-up review-toggle",()=>{review.on=!review.on;drawNotes(view,file)},"chat");
  head.append(review.toggle);
  // A row of its own: beside copy, download and edit it would not fit a phone.
  review.send=fileButton("","pri review-send",()=>sendReview(view,file));
  acts.before(el("div","acts review-acts",review.send));
  view.addEventListener("click",event=>{
    if(!review.on||event.target.closest("a,.review-note,.review-edit"))return;
    const selection=getSelection();
    if(selection&&!selection.isCollapsed)return;  // Selecting text to copy is not a request for a note.
    const target=event.target.closest("[data-line]");
    if(target&&view.contains(target))editNote(view,file,target);
  });
  view.addEventListener("keydown",event=>{
    if(!review.on||!["Enter"," "].includes(event.key)||!event.target.matches("[data-line]"))return;
    event.preventDefault();event.stopPropagation();editNote(view,file,event.target);
  });
  drawNotes(view,file);
}
function drawNotes(view,file){
  view.classList.toggle("reviewing",review.on);
  view.querySelectorAll(".review-note,.review-edit,.review-hint").forEach(node=>node.remove());
  view.querySelectorAll(".reviewed").forEach(node=>node.classList.remove("reviewed"));
  for(const target of view.querySelectorAll("[data-line]")){
    target.tabIndex=review.on?0:-1;
    if(review.on)target.setAttribute("aria-keyshortcuts","Enter Space");else target.removeAttribute("aria-keyshortcuts");
    const from=Number(target.dataset.line),note=review.notes.find(n=>n.from===from&&n.to===Number(target.dataset.end));
    if(!note)continue;
    target.classList.add("reviewed");
    const box=el("button","review-note",el("span","review-lines",lineSpan(note.from,note.to)),el("span","review-text",note.text));
    box.type="button";box.onclick=()=>editNote(view,file,target);
    target.after(box);
  }
  if(review.on&&!review.notes.length)view.prepend(el("p","review-hint",tr("Выберите абзац или строку клавишей Tab и нажмите Enter, чтобы оставить комментарий. Можно также нажать мышью.")));
  review.send.parentNode.hidden=!review.notes.length;
  review.send.textContent=tr("Отправить ревью ({0})",[review.notes.length]);
  review.toggle.setAttribute("aria-pressed",String(review.on));
}
function editNote(view,file,target){
  drawNotes(view,file);
  const from=Number(target.dataset.line),to=Number(target.dataset.end);
  const note=review.notes.find(n=>n.from===from&&n.to===to);
  target.nextElementSibling?.classList.contains("review-note")&&target.nextElementSibling.remove();
  const area=el("textarea","review-area");area.value=note?.text||"";area.rows=3;
  area.setAttribute("aria-label",tr("Комментарий: {0}",[lineSpan(from,to)]));
  const done=text=>{
    review.notes=review.notes.filter(n=>n!==note);
    if(text.trim())review.notes.push({from,to,text:text.trim()});
    storeReview();drawNotes(view,file);target.focus({preventScroll:true});
  };
  const buttons=el("div","acts",
    ...(note?[fileButton(tr("Удалить"),"",()=>done(""))]:[]),
    fileButton(tr("Отмена"),"",()=>{drawNotes(view,file);target.focus({preventScroll:true})}),
    fileButton(tr("Сохранить"),"pri",()=>done(area.value)));
  target.after(el("div","review-edit",el("span","review-lines",lineSpan(from,to)),area,buttons));
  area.focus({preventScroll:true});
}
// A review is a separate message: the composer may hold another task and its attachments.
async function sendReview(view,file){
  if(!review.notes.length||sending||uploading||panelUpdating)return;
  if(files.session!==active||review.key!==reviewKey(file.path)){toast(tr("Откройте сессию этого файла"));return}
  if(isLocal(cur())&&!cur().running){toast(agentLabel(cur())+tr(" не запущен"));return}
  const deck=selectedDeck,epoch=deckEpoch,name=active,key=review.key,notes=review.notes.slice();
  const text=reviewPrompt(file.path,notes,file.content.replace(/\r\n?/g,"\n").split("\n"));
  sending=true;review.send.disabled=true;renderAttachments();
  sendStates.set(name,{text:tr("Отправляю…"),phase:"pending"});renderSendState();
  try{
    await gatewayApi(instancePath(deck,"/api/send"),{name,text});
    finishReview(key,notes);
    if(epoch!==deckEpoch)return;
    sendStates.set(name,{text:tr("Отправлено в ")+agentLabel(cur()),phase:"success"});
    if(files.file===file){drawNotes(view,file);if(projectDrawer()||isMobile())closeProject()}
    await load();
  }catch(e){
    if(epoch===deckEpoch)sendStates.set(name,{text:tr("Не отправлено: ")+e.message,error:true});
    toast(tr("Не отправлено: ")+e.message);
  }finally{sending=false;review.send.disabled=false;renderAttachments();renderSendState()}
}
function finishReview(key,sent){
  let notes=review.notes;
  if(review.key!==key){try{notes=JSON.parse(localStore.getItem(key)||"[]")}catch(e){notes=[]}}
  const remaining=notes.filter(n=>!sent.some(s=>s.from===n.from&&s.to===n.to&&s.text===n.text));
  storeReview(remaining,key);
  if(review.key===key){review.notes=remaining;review.on=remaining.length>0}
}

if(typeof module!=="undefined")module.exports={reviewPrompt};
