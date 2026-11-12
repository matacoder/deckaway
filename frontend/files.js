// Project files of the open session: browse folders, open a text file, copy or paste into it and save.
// The server keeps everything inside the home folder and refuses to overwrite a file changed meanwhile.
// seq: each opening and folder load gets a number; an answer for an older one (another session, a
// folder left meanwhile) is dropped so it can never fill the dialog or decide where a new file goes.
const files={session:null,listing:null,file:null,seq:0,error:"",path:"",picking:false,picked:new Set(),ready:null,busy:false};

function formatSize(bytes){
  return bytes<1024?bytes+" B":bytes<1048576?(bytes/1024).toFixed(1)+" KB":(bytes/1048576).toFixed(1)+" MB";
}
// Each folder on the way from home is one tap away instead of several "Up" taps.
function breadcrumbs(listing){
  const nav=el("nav","files-crumbs");nav.setAttribute("aria-label",tr("Путь"));
  const rest=listing.path===listing.home?[]:listing.path.slice(listing.home.length+1).split("/");
  const parts=[["~",listing.home],...rest.map((name,i)=>[name,listing.home+"/"+rest.slice(0,i+1).join("/")])];
  parts.forEach(([name,path],i)=>{
    if(i)nav.append(el("span","sep","/"));
    if(i===parts.length-1){nav.append(el("span","here",name));return}
    const link=el("button","",name);link.type="button";link.onclick=()=>loadFolder(path);nav.append(link);
  });
  return nav;
}
function homeRelative(path,home){return path===home?"~":path.startsWith(home+"/")?"~/"+path.slice(home.length+1):path}
function filesDirty(){return Boolean(files.file&&files.file.content!==files.file.saved)}

async function startFiles(){
  // The home folder as it was listed last time for this session stands in while it is read again.
  dropPreview();files.session=active;files.key=sessionInfoKey();files.file=null;files.listing=knownAnswer(filesKnown,files.key);files.creating=false;
  await loadFolder("");
}
async function loadFolder(path){
  const seq=++files.seq;files.error="";files.path=path;
  // A folder listed before is shown at once and read again behind it.
  const known=path?knownAnswer(filesKnown,files.key+"|"+path):null;
  if(known){files.listing=known;files.file=null;renderFiles()}
  else if(!files.listing)renderFiles();
  try{
    const listing=await api("/api/files?name="+encodeURIComponent(files.session)+"&path="+encodeURIComponent(path),null,false,{timeout:60000});
    if(seq!==files.seq)return;
    files.listing=listing;files.file=null;keepAnswer(filesKnown,path?files.key+"|"+path:files.key,listing);
  }catch(e){if(seq!==files.seq)return;if(e.message!==STALE){files.error=e.message;if(files.listing)toast(e.message)}}
  renderFiles();
}
const PREVIEW_FILE=/\.(png|jpe?g|gif|webp|pdf)$/i;
// session: a path from that session's screen, which may be relative to where its agent works.
async function openFile(path,session){
  const seq=++files.seq,preview=PREVIEW_FILE.test(path),from=session?"&name="+encodeURIComponent(session):"";
  try{
    const data=await api((preview?"/api/file_preview?path=":"/api/file?path=")+encodeURIComponent(path)+from,null,false,{timeout:60000});
    if(seq!==files.seq)return;
    files.file=preview?{path:data.path,preview:previewBlob(data)}:{...data,saved:data.content,isNew:false,rendered:isMarkdown(data.path)};
    // Opened from the screen before any folder was listed: its own folder, without closing the file.
    if(!files.listing){
      const listing=await api("/api/files?name="+encodeURIComponent(files.session)+"&path="+encodeURIComponent(data.path.replace(/\/[^/]*$/,"")),null,false,{timeout:60000});
      if(seq!==files.seq)return;
      files.listing=listing;
    }
  }catch(e){
    if(seq!==files.seq||e.message===STALE)return;
    // Not text and not a picture or PDF (an archive, a spreadsheet): it can still be downloaded.
    if(!preview&&!(e instanceof OfflineError)){files.file={path,download:true,error:e.message};renderFiles()}else toast(e.message);
    return;
  }
  renderFiles();
}
// The server checked the content; the Blob gets that type and nothing else (never HTML or SVG).
function previewBlob(data){
  const type=["application/pdf","image/png","image/jpeg","image/gif","image/webp"].includes(data.type)?data.type:"application/octet-stream";
  // A plain loop: a callback per byte freezes a phone for seconds on a 10 MB file.
  const raw=atob(data.data),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return {type,size:data.size,url:URL.createObjectURL(new Blob([bytes],{type}))};
}
function dropPreview(){if(files.file?.preview)URL.revokeObjectURL(files.file.preview.url)}
async function leaveFile(){
  if(filesDirty()&&!await confirmAction(tr("Изменения не сохранены. Закрыть без сохранения?"),{confirm:tr("Закрыть без сохранения"),danger:true}))return false;
  dropPreview();files.file=null;
  // The folder may have changed (a new file was just saved): show it as it is now.
  if(files.listing){loadFolder(files.listing.path);return true}
  renderFiles();return true;
}
async function saveFile(){
  const file=files.file;if(!file)return;
  const content=file.content;
  try{
    const result=await api("/api/file_save",{path:file.path,content,hash:file.isNew?null:file.hash});
    Object.assign(file,{hash:result.hash,saved:content,isNew:false});
    toast(tr("Файл сохранён"),"success");
  }catch(e){if(e.message!==STALE)toast(e.message)}
  // Only the button changes: re-rendering would move the cursor and scroll of the open text.
  if(files.file===file&&files.saveButton)files.saveButton.disabled=!filesDirty();
}
function newFile(name){
  name=name.trim();
  if(!name||name.includes("/")||name==="."||name===".."){toast(tr("Введите имя файла без папок"));return}
  const folder=files.listing.path;
  files.creating=false;files.file={path:folder+"/"+name,content:"",saved:"",hash:null,isNew:true};renderFiles();
}
function fileButton(label,cls,run,icon){
  const b=el("button",cls,...(icon?[svgIcon(icon)]:[]),el("span","",label));b.type="button";b.onclick=run;return b;
}

function renderFiles(){
  const box=$("files_body"),listing=files.listing;box.replaceChildren();
  if(!listing&&files.error){box.append(errorWithRetry(files.error,()=>loadFolder(files.path)));return}
  if(!listing){box.append(listSkeleton());return}
  if(files.file)return renderEditor(box,listing);
  const crumbs=el("div","files-path",breadcrumbs(listing));
  if(listing.parent)crumbs.prepend(fileButton(tr("Вверх"),"files-up",()=>loadFolder(listing.parent),"arrow-up"));
  // Creating a file is occasional: a small button in the path row, the name field only once asked for.
  let create;
  if(files.creating){
    create=el("form","files-new");
    const input=el("input","");input.type="text";input.placeholder=tr("Новый файл");
    input.setAttribute("autocapitalize","none");input.setAttribute("autocorrect","off");input.spellcheck=false;input.setAttribute("aria-label",tr("Новый файл"));
    create.append(input,fileButton(tr("Создать"),"",()=>newFile(input.value),"plus"));
    create.onsubmit=e=>{e.preventDefault();newFile(input.value)};
    setTimeout(()=>input.focus(),0);
  }else crumbs.append(fileButton(tr("Файл"),"files-up files-add",()=>{files.creating=true;renderFiles()},"plus"));
  const paths=listing.entries.filter(entry=>!entry.dir).map(entry=>listing.path+"/"+entry.name);
  // Picks belong to the folder on screen: another folder starts with none.
  files.picked=new Set(paths.filter(path=>files.picked.has(path)));
  if(paths.length)crumbs.append(fileButton(files.picking?tr("Готово"):tr("Выбрать"),"files-up files-pick-toggle",()=>{
    files.picking=!files.picking;files.picked.clear();files.ready=null;renderFiles()},"check"));
  const list=el("div","files-list");
  for(const entry of listing.entries){
    const path=listing.path+"/"+entry.name;
    if(files.picking&&!entry.dir){
      const picked=files.picked.has(path);
      const row=fileButton(entry.name,"files-row files-pickable"+(picked?" picked":""),()=>{
        picked?files.picked.delete(path):files.picked.add(path);files.ready=null;renderFiles()},picked?"check":"file");
      row.setAttribute("aria-pressed",String(picked));row.append(el("span","files-size",formatSize(entry.size)));
      list.append(el("div","files-item",row));continue;
    }
    const row=fileButton(entry.name,"files-row"+(entry.dir?" dir":""),()=>entry.dir?loadFolder(path):openFile(path),entry.dir?"folder":"file");
    if(entry.dir){list.append(row);continue}
    row.append(el("span","files-size",formatSize(entry.size)));
    // Any file straight from the list, without opening it first (a video, an archive, a huge log).
    const save=el("button","files-download",svgIcon("download"));save.type="button";
    save.setAttribute("aria-label",tr("Скачать файл {0}",[entry.name]));save.title=tr("Скачать");
    save.onclick=()=>downloadFile(null,path);
    list.append(el("div","files-item",row,save));
  }
  if(!listing.entries.length)list.append(el("p","files-empty",tr("Папка пуста")));
  if(listing.truncated)list.append(el("p","files-empty",tr("Показаны первые 2000 элементов")));
  box.append(...[crumbs,create,list,files.picking&&paths.length?pickBar(paths):null].filter(Boolean));
}

// Several files at once, never zipped: shared together (the phone's sheet saves pictures to Photos or sends
// them to a chat) or downloaded one by one.
function pickBar(paths){
  const every=paths.every(path=>files.picked.has(path)),count=files.picked.size;
  const all=fileButton(every?tr("Снять выбор"):tr("Выбрать все"),"",()=>{files.picked=new Set(every?[]:paths);files.ready=null;renderFiles()});
  const acts=[];
  if(canShareFiles())acts.push(fileButton(tr("Поделиться"),"pri",sharePicked,"external"));
  // A Home Screen app on iOS has no downloads folder: there the sheet is the way to save.
  const environment=pushEnvironment();
  if(!acts.length||!(environment.ios&&environment.standalone))acts.push(fileButton(tr("Скачать"),"",downloadPicked,"download"));
  for(const button of acts)button.disabled=!count||files.busy;
  return el("div","files-pick",all,el("span","files-pick-count",tr("Выбрано: {0}",[count])),...acts);
}
const SHARE_TYPES={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",heic:"image/heic",heif:"image/heif",
  mp4:"video/mp4",mov:"video/quicktime",m4v:"video/x-m4v",pdf:"application/pdf",txt:"text/plain"};
// Every download arrives as bytes; the share sheet offers "Save to Photos" only for a picture's or a video's type.
function shareType(name){const dot=name.lastIndexOf(".");return dot>0&&SHARE_TYPES[name.slice(dot+1).toLowerCase()]||"application/octet-stream"}
function canShareFiles(){
  try{return Boolean(navigator.canShare&&navigator.canShare({files:[new File([""],"a.jpg",{type:"image/jpeg"})]}))}catch(e){return false}
}
async function fetchPicked(paths){
  const out=[];let next=0,done=0;
  const worker=async()=>{
    while(next<paths.length){
      const index=next++,path=paths[index],name=path.split("/").pop();
      const r=await fetch(activePath("/api/download?path="+encodeURIComponent(path)),{cache:"no-store"});
      if(!r.ok){let message="";try{message=(await r.json()).error}catch(e){}throw new Error(message||tr("Не удалось скачать файл"))}
      out[index]=new File([await r.blob()],name,{type:shareType(name)});
      toast(tr("Загружаю {0} из {1}…",[++done,paths.length]),"info");
    }
  };
  await Promise.all([worker(),worker(),worker()]);
  return out;
}
async function sharePicked(){
  const paths=[...files.picked],key=paths.join("\n");
  if(!paths.length||files.busy)return;
  // Ready from an earlier tap: shared at once, inside this tap, which the browser requires.
  let ready=files.ready?.key===key?files.ready.files:null;
  if(!ready){
    files.busy=true;renderFiles();
    try{ready=await fetchPicked(paths)}catch(e){toast(e.message);return}finally{files.busy=false;renderFiles()}
    files.ready={key,files:ready};
  }
  if(!navigator.canShare({files:ready})){toast(tr("Браузер не может поделиться этими файлами. Скачайте их."));return}
  const share=()=>navigator.share({files:ready});
  try{await share()}
  catch(e){
    // A long download outlives the tap that started it: one more tap shares what is already here.
    if(e.name==="NotAllowedError")toast(tr("Файлы загружены: {0}",[ready.length]),"info",{label:tr("Поделиться"),run:()=>share().catch(()=>{})});
    else if(e.name!=="AbortError")toast(e.message);
  }
}
async function downloadPicked(){
  for(const path of [...files.picked]){
    await downloadFile(null,path);
    await new Promise(resolve=>setTimeout(resolve,250));  // Browsers drop downloads started in one burst.
  }
}
// Files open for reading: wrapped lines with numbers, selectable without the keyboard popping up and the
// layout jumping. Editing is a separate step, and a new file starts in it.
function renderEditor(box,listing){
  const file=files.file,name=file.path.split("/").pop();
  const head=el("div","files-path",fileButton(tr("К папке"),"files-up",leaveFile,"arrow-up"),el("code","",homeRelative(file.path,listing.home)));
  applyCodeFont();
  if(file.preview)return renderPreview(box,head,file);
  if(file.download){box.append(head,el("p","files-empty",file.error),el("div","acts",fileButton(tr("Скачать"),"pri",()=>downloadFile(null,file.path))));return}
  if(!file.isNew&&!file.editing)return renderReader(box,head,file);
  const area=el("textarea","files-text");area.value=file.content;area.spellcheck=false;
  area.setAttribute("autocapitalize","none");area.setAttribute("autocorrect","off");area.setAttribute("aria-label",name);
  const save=fileButton(tr("Сохранить"),"pri",saveFile);save.disabled=!filesDirty()&&!file.isNew;files.saveButton=save;
  area.oninput=()=>{file.content=area.value;save.disabled=!filesDirty()&&!file.isNew};
  const copy=fileButton(tr("Копировать"),"",()=>{
    const text=area.selectionStart!==area.selectionEnd?area.value.slice(area.selectionStart,area.selectionEnd):area.value;
    copyText(text);
  });
  box.append(head,area,el("div","acts",copy,save));
}
const FILE_PAGE_LINES=400;
function readerPage(file){
  const lines=file.content.split("\n");
  if(lines.length>1&&!lines.at(-1))lines.pop();
  const pages=Math.max(1,Math.ceil(lines.length/FILE_PAGE_LINES));
  file.page=Math.max(0,Math.min(file.page||0,pages-1));
  const start=file.page*FILE_PAGE_LINES;
  return {lines:lines.slice(start,start+FILE_PAGE_LINES),start,pages,total:lines.length};
}
function readerPaging(file,page){
  const move=step=>{file.page+=step;renderFiles()};
  const previous=fileButton(tr("Предыдущая страница"),"files-up",()=>move(-1));previous.disabled=!file.page;
  const next=fileButton(tr("Следующая страница"),"files-up",()=>move(1));next.disabled=file.page+1>=page.pages;
  return el("div","files-path",previous,el("span","",tr("Страница {0} из {1}",[file.page+1,page.pages])),next);
}
function renderReader(box,head,file){
  const page=readerPage(file);
  let view=el("div","files-view");
  // Bound rows and inline markup too: one enormous Markdown line could otherwise create thousands of nodes.
  const markdown=file.rendered&&page.lines.join("\n").length<=32768;
  if(markdown)view=renderMarkdown(page.lines.join("\n"),document,page.start);
  else view.style.setProperty("--ln",Math.max(2,String(page.total).length));
  if(!markdown)page.lines.forEach((line,i)=>{
    const number=page.start+i+1;
    const row=el("div","fl",el("span","ln",String(number)),el("span","code",line||" "));
    row.dataset.line=row.dataset.end=number;view.append(row);
  });
  if(isMarkdown(file.path))head.append(fileButton(file.rendered?tr("Текст"):tr("Просмотр"),"files-up",()=>{file.rendered=!file.rendered;renderFiles()}));
  const copy=fileButton(tr("Копировать"),"",()=>{
    const selected=String(getSelection()||"");
    copyText(selected&&view.contains(getSelection().anchorNode)?selected:file.content);
  });
  const change=fileButton(tr("Изменить"),"",()=>{file.editing=true;renderFiles()});
  const download=fileButton(tr("Скачать"),"",()=>downloadFile(null,file.path));
  const acts=el("div","acts",copy,download,change);
  box.append(head,...(page.pages>1?[readerPaging(file,page)]:[]),view,acts);
  reviewReader(view,head,acts,file);
}
// Images show here; a PDF opens from a link, a direct tap, so no popup blocker stands in the way.
function renderPreview(box,head,file){
  const name=file.path.split("/").pop(),{type,url,size}=file.preview;
  box.append(head);
  if(type.startsWith("image/")){const img=el("img","files-image");img.src=url;img.alt=name;box.append(el("div","files-view files-picture",img))}
  else box.append(el("p","files-empty",tr("PDF-документ · {0}",[formatSize(size)])));
  const open=el("a","btn pri",tr("Открыть"));open.href=url;open.target="_blank";open.rel="noopener";
  box.append(el("div","acts",fileButton(tr("Скачать"),"",()=>downloadFile(null,file.path)),...(type==="application/pdf"?[open]:[])));
}
// Paths to any file that agents print ("/home/me/plan.pdf", "docs/notes.md"): a tap downloads it.
// A folder in the path keeps ordinary words ("v1.2", "e.g.") from turning into links.
// An extension has a letter: "store/1.4.0" is a folder of a version, not a file ".0".
const FILE_PATH_RE=/(?<![\w/.~@+-])(?:~\/|\/|\.\.?\/)?(?:[\w.@+-]+\/)+[\w.@+-]*\w\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,10}(?![\w-]|\.\w)/g;
// A folder only with a slash at its end and a start that is no word ("/Users/me/reports/", "~/dev/", "./out/"),
// so "and/or/" or the middle of a path stay text; a tap opens it in the file browser, like `open` on a Mac.
const FOLDER_PATH_RE=/(?<![\w/.~@+:-])(?:~\/|\/|\.\.?\/)(?:[\w.@+-]+\/)*(?![\w.@+\/-])/g;
// A home path with no slash at its end and no extension ("/Users/me/app/store/1.4.0") may be a folder or a file
// without one; under a home-like root only, so "/api/send" stays text. A tap finds out which (openScreenPath).
const BARE_PATH_RE=/(?<![\w/.~@+:-])(?:~|\/(?:Users|home|Volumes|private|tmp|mnt|srv|opt|workspace))(?:\/[\w.@+-]+)+(?![\w.@+\/-])/g;
function fileMatches(text,taken=[]){
  const files=[...text.matchAll(FILE_PATH_RE)].map(m=>({index:m.index,file:m[0]}));
  const folders=[...text.matchAll(FOLDER_PATH_RE)].filter(m=>m[0].replace(/^(~|\.\.?)?\//,"").length).map(m=>({index:m.index,file:m[0],folder:true}));
  const bare=[...text.matchAll(BARE_PATH_RE)].map(m=>({index:m.index,file:m[0].replace(/\.+$/,""),folder:"maybe"}));
  const found=[...files,...folders];
  for(const m of bare)if(!found.some(f=>m.index<f.index+f.file.length&&m.index+m.file.length>f.index))found.push(m);
  return found.filter(({index,file})=>!taken.some(([a,b])=>index<b&&index+file.length>a)).sort((x,y)=>x.index-y.index);
}
// A Markdown file opens in the file viewer instead, where it is read rendered and can be commented on.
function fileLink(session,path,runs,from,to,folder=false){
  const read=isMarkdown(path),link=el("a","file-link");link.href="#";
  link.title=folder===true?tr("Открыть папку")+" "+path:folder?path:tr(read?"Открыть файл {0}":"Скачать файл {0}",[path.split("/").pop()]);
  appendStyledRange(link,runs,from,to);
  link.onclick=event=>{
    event.preventDefault();
    if(folder===true){if(session===active)openRefFolder(path);return}
    if(folder){if(session===active)openScreenPath(path);return}
    read&&session===active?openScreenFile(path):downloadFile(session,path);
  };
  return link;
}
// A folder opens in the file browser; anything that is not one downloads (with its own message if missing).
async function openScreenPath(path){
  try{await api("/api/files?name="+encodeURIComponent(active)+"&path="+encodeURIComponent(sessionRelative(path)))}
  catch(e){if(e.message!==STALE)downloadFile(active,path);return}
  openRefFolder(path);
}
async function openScreenFile(path){
  if(filesDirty()&&!await confirmAction(tr("Изменения не сохранены. Закрыть без сохранения?"),{confirm:tr("Закрыть без сохранения"),danger:true}))return;
  dropPreview();files.file=null;
  openProject("files");
  await openFile(path,active);
}
// Fetched first, so a missing or too large file is a message here, not an error page in its place.
// A large file takes a while with nothing to see: a note says it started, and more taps do not start it again.
const downloading=new Set();
async function downloadFile(session,path){
  const url=activePath("/api/download?"+(session?"name="+encodeURIComponent(session)+"&":"")+"path="+encodeURIComponent(path));
  if(downloading.has(url))return;
  const name=path.split("/").pop();
  downloading.add(url);toast(tr("Скачиваю файл {0}…",[name]),"info");
  try{
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok){let message="";try{message=(await r.json()).error}catch(e){}toast(message||tr("Не удалось скачать файл"));return}
    const blob=await r.blob();
    if(await shareDownload(blob,name))return;
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  }catch(e){toast(tr("Не удалось скачать файл"))}
  finally{downloading.delete(url)}
}
// An iOS Home Screen app has no downloads: a blob link opens a blank in-app page that only "back" leaves.
// The share sheet saves to Files instead. It needs a fresh tap, which a slow download has outlived.
async function shareDownload(blob,name){
  if(!navigator.canShare)return false;
  const environment=pushEnvironment(),file=new File([blob],name,{type:blob.type||"application/octet-stream"});
  if(!environment.ios||!environment.standalone||!navigator.canShare({files:[file]}))return false;
  const share=()=>navigator.share({files:[file]});
  try{await share()}
  catch(e){if(e.name==="NotAllowedError")toast(tr("Файл {0} загружен",[name]),"info",{label:tr("Сохранить"),run:()=>share().catch(()=>{})})}
  return true;
}
async function copyText(text){
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);toast(tr("Скопировано: {0} симв.",[text.length]),"success");return}}catch(e){}
  if(execCopy(text,document))toast(tr("Скопировано: {0} симв.",[text.length]),"success");else toast(tr("Браузер запретил копирование"));
}

if(typeof module!=="undefined")module.exports={formatSize,homeRelative,fileMatches,shareType};
