// Pictures inside copied messages (Telegram and other apps on a Mac or an iPhone). Safari gives a text field
// only the text of such a copy — no files, no <img> — but pastes the pictures too into an editable block, the
// way Notes receives them. So a paste meant for the message field is caught by such a block: the text goes on
// into the field as always, the pictures found in the block are attached. Bundled before app.js.
const rich={timer:null};
// Sources of the pictures a paste left in a block, each once. Pure for tests.
function pastedImageSources(box){
  const sources=Array.from(box.querySelectorAll("img[src]"),img=>img.getAttribute("src"));
  return [...new Set(sources.filter(src=>/^(data:image\/|https?:\/\/|blob:)/i.test(src)))];
}
// What a paste left in a block, as text: blocks and line breaks become new lines, pictures nothing. Pure for
// tests (jsdom has no innerText, and a block off the screen would lose its lines in innerText anyway).
const PASTE_BLOCK=/^(DIV|P|LI|TR|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|SECTION|ARTICLE)$/;
function pastedText(box){
  let out="";
  const walk=node=>{
    if(node.nodeType===3){out+=node.nodeValue;return}
    if(node.nodeType!==1||/^(IMG|STYLE|SCRIPT|META|TITLE)$/.test(node.tagName))return;
    if(node.tagName==="BR"){out+="\n";return}
    const block=PASTE_BLOCK.test(node.tagName);
    if(block&&out&&!out.endsWith("\n"))out+="\n";
    node.childNodes.forEach(walk);
    if(block&&out&&!out.endsWith("\n"))out+="\n";
  };
  box.childNodes.forEach(walk);
  return out.replace(/\u00a0/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
// Several messages copied on an iPhone are several clipboard items: Safari puts all of them into the block,
// while the text it hands the page is the first item's alone (none when the first one is a photo). The
// clipboard's own text keeps its exact spacing, so it wins unless the block holds more. Pure for tests.
function richPasteText(plain,box){
  const whole=pastedText(box),size=text=>(text||"").replace(/\s+/g,"").length;
  return size(whole)>size(plain)?whole:plain||"";
}
// ⌘V or Ctrl+V as typed, on any keyboard layout; with Shift or Alt it is "paste as plain text". Pure for tests.
function isPasteKey(event){
  return Boolean((event.metaKey||event.ctrlKey)&&!(event.metaKey&&event.ctrlKey)&&!event.shiftKey&&!event.altKey&&event.code==="KeyV");
}
// Copied messages name their pictures in the text where a text field receives none. Pure for tests.
function mentionsPictures(text){return /\[ ?(Photo|Фото|Album|Альбом|Picture|Image)[^\]\n]{0,40}\]/i.test(text||"")}
function insertIntoMessage(text){
  const field=$("msg");field.focus({preventScroll:true});
  if(!text)return;
  let done=false;
  // Typed, not assigned: undo keeps working and the field grows as with any input.
  try{done=document.execCommand("insertText",false,text)}catch(e){}
  if(!done){field.setRangeText(text,field.selectionStart,field.selectionEnd,"end");field.dispatchEvent(new Event("input",{bubbles:true}))}
}
// The paste shortcut in the message field: the paste lands in the hidden block instead. If none arrives (an
// empty clipboard), the field simply gets the keyboard back.
function catchPaste(event){
  if(!isPasteKey(event)||isTouch()||!active)return;
  const box=$("paste_catch");box.replaceChildren();box.focus({preventScroll:true});
  clearTimeout(rich.timer);rich.timer=setTimeout(()=>{if(document.activeElement===box)$("msg").focus({preventScroll:true})},400);
}
// Runs for the hidden block and for the visible one of the dialog. The browser's own paste follows this
// event at once, so the block is read right after it.
function takeRichPaste(event){
  const box=event.currentTarget,data=event.clipboardData;
  clearTimeout(rich.timer);
  if(event.defaultPrevented)return void $("msg").focus({preventScroll:true});  // Files alone: already attached.
  const text=data?.getData?data.getData("text/plain"):"";
  const table=/<table/i.test(data?.getData?data.getData("text/html"):"");
  const files=table?[]:Array.from(data?.files||[]).filter(file=>file.type.startsWith("image/"));
  setTimeout(()=>{
    const sources=pastedImageSources(box),whole=richPasteText(text,box);box.replaceChildren();
    if($("paste_dlg").open)$("paste_dlg").close();
    insertIntoMessage(whole);
    if(!sources.length&&!files.length)return;
    const target=dropTarget(cur(),dropBlocked());
    if(target.ok)attachPastedPictures(files.length?[]:sources,files);else toast(tr(target.text));
  },0);
}
// A paste by the menu (a phone, a right click) goes straight into the field and brings no pictures: when its
// text says there were some, the dialog with an editable block is one tap away. A picture that came with the
// text (a photo copied from Telegram with its caption) is left out on purpose, since copied table cells bring
// a picture of themselves too; it is offered instead of being lost.
function offerRichPaste(event){
  const data=event.clipboardData;
  if(event.target!==$("msg")||!data?.getData)return;
  const images=Array.from(data.files||[]).filter(file=>file.type.startsWith("image/"));
  if(images.length){
    const html=data.getData("text/html")||"";
    if(!/<table/i.test(html)&&!pastedPictures(data).length)toast(tr("Вместе с текстом скопирована картинка"),true,{label:tr("Приложить"),run:()=>uploadImages(images)});
    return;
  }
  if(Array.from(data.files||[]).length)return;
  if(mentionsPictures(data.getData("text/plain")))toast(tr("Картинки из этой вставки не попали в поле"),true,{label:tr("Вставить с картинками"),run:openRichPaste});
}
function openRichPaste(){
  if(!active)return;
  $("paste_box").replaceChildren();
  if(!$("paste_dlg").open)$("paste_dlg").showModal();
  if(!isMobile()&&!isTouch())$("paste_box").focus({preventScroll:true});
}
function watchRichPaste(){
  $("msg").addEventListener("keydown",catchPaste);
  $("msg").addEventListener("paste",offerRichPaste);
  for(const id of ["paste_catch","paste_box"])$(id).addEventListener("paste",takeRichPaste);
  // Nothing is ever typed there: a stray key goes back to the field.
  $("paste_catch").addEventListener("input",()=>setTimeout(()=>{$("paste_catch").replaceChildren()},50));
}

if(typeof module!=="undefined")module.exports={pastedImageSources,isPasteKey,mentionsPictures,pastedText,richPasteText};
