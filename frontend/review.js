// Comments on lines of a file open in the file viewer, sent to the session's agent as one review message.
// Tapping a paragraph (or a line in text view) while commenting opens a note for its source lines. Notes are
// kept in this browser per computer and file until sent, like a draft. Bundled before app.js.
const review={path:null,notes:[],on:false,send:null,toggle:null};
const reviewKey=path=>"cc.review."+(selectedDeck||"")+":"+path;
function loadReview(path){
  if(review.path===path)return;
  let notes=[];
  try{notes=JSON.parse(localStore.getItem(reviewKey(path))||"[]")}catch(e){}
  review.path=path;
  review.notes=Array.isArray(notes)?notes.filter(n=>n&&n.from>0&&n.to>=n.from&&typeof n.text==="string"&&n.text.trim()):[];
  review.on=review.notes.length>0;
}
function storeReview(){
  try{review.notes.length?localStore.setItem(reviewKey(review.path),JSON.stringify(review.notes)):localStore.removeItem(reviewKey(review.path))}catch(e){}
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
  drawNotes(view,file);
}
function drawNotes(view,file){
  view.classList.toggle("reviewing",review.on);
  view.querySelectorAll(".review-note,.review-edit,.review-hint").forEach(node=>node.remove());
  view.querySelectorAll(".reviewed").forEach(node=>node.classList.remove("reviewed"));
  for(const target of view.querySelectorAll("[data-line]")){
    const from=Number(target.dataset.line),note=review.notes.find(n=>n.from===from&&n.to===Number(target.dataset.end));
    if(!note)continue;
    target.classList.add("reviewed");
    const box=el("div","review-note",el("span","review-lines",lineSpan(note.from,note.to)),el("span","review-text",note.text));
    box.onclick=()=>editNote(view,file,target);
    target.after(box);
  }
  if(review.on&&!review.notes.length)view.prepend(el("p","review-hint",tr("Нажмите на абзац или строку, чтобы оставить комментарий")));
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
    storeReview();drawNotes(view,file);
  };
  const buttons=el("div","acts",
    ...(note?[fileButton(tr("Удалить"),"",()=>done(""))]:[]),
    fileButton(tr("Отмена"),"",()=>drawNotes(view,file)),
    fileButton(tr("Сохранить"),"pri",()=>done(area.value)));
  target.after(el("div","review-edit",el("span","review-lines",lineSpan(from,to)),area,buttons));
  area.focus({preventScroll:true});
}
// Into the message field and sent like a typed message: the same send state, and the text stays there as a
// draft if it cannot be sent.
async function sendReview(view,file){
  if(!review.notes.length)return;
  if(files.session!==active){toast(tr("Откройте сессию этого файла"));return}
  const text=reviewPrompt(file.path,review.notes,file.content.replace(/\r\n?/g,"\n").split("\n")),field=$("msg");
  field.value=field.value.trim()?field.value.replace(/\s+$/,"")+"\n\n"+text:text;
  field.dispatchEvent(new Event("input"));  // Kept as this session's draft, as typed text is.
  review.notes=[];storeReview();review.on=false;drawNotes(view,file);
  if(projectDrawer()||isMobile())closeProject();
  await send();
}

if(typeof module!=="undefined")module.exports={reviewPrompt};
