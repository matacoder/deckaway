// Paths and commands of the agent's last answer, taken from its conversation file: there they are whole, while
// the terminal wraps a long path or command across lines where neither a tap nor a selection gets it. Each one
// is a chip under the screen: copied, opened or downloaded, or run in a terminal of its own. Bundled before app.js.
const refs={key:"",sig:"",items:[],item:null};
const SHELL_FENCE=/^(bash|sh|zsh|shell|console|terminal|powershell|ps1)?$/i;
const COMMANDS=/^(\.\/\S+|npm|npx|pnpm|yarn|bun|node|deno|python3?|pip3?|uv|uvx|poetry|git|gh|docker|make|cargo|go|rustc|brew|apt|sudo|curl|wget|ssh|scp|rsync|tmux|cd|ls|cat|tail|less|open|bash|sh|zsh|claude|codex|kubectl|terraform|psql|sqlite3|tar|unzip|chmod|mkdir|rm|cp|mv|ffmpeg)\s/;
const FILE_EXT="md|markdown|pdf|png|jpe?g|gif|webp|svg|html?|txt|json|jsonl|csv|tsv|xlsx?|docx?|pptx?|zip|gz|tgz|log|py|js|mjs|cjs|ts|tsx|jsx|css|scss|sh|ya?ml|toml|ini|env|sql|go|rs|java|kt|swift|rb|php|c|h|cpp|hpp|lock|xml|mp4|mov|mp3|wav";
const HAS_EXT=new RegExp("\\.("+FILE_EXT+")$","i");
// An absolute or home path; a relative one only with a slash or a known extension, so "e.g." or "v1.2" stay text.
const BARE_PATH=new RegExp("(?:^|[\\s(«\"'])((?:~|\\.{1,2})?/[^\\s`\"'<>|()«»]+|[\\w.-]+/[^\\s`\"'<>|()«»]*|[\\w-][\\w.-]*\\.(?:"+FILE_EXT+"))(?=$|[\\s)»\"',;:!?]|\\.(?:\\s|$))","gi");
// A path that goes on past a space up to its extension: "…/Коэффициенты 1,22 и 1,55 сверка.pdf".
const SPACED_TAIL=new RegExp("^((?: [^\\s/`\"'<>|()«»]+){1,6}?\\.(?:"+FILE_EXT+"))(?=$|[\\s)»\"',;:!?]|\\.(?:\\s|$))","i");
const looksLikePath=value=>/^(~|\.{1,2})?\//.test(value)||(/^[\w.-]+\/\S*$/.test(value)&&!/^\w+:\/\//.test(value))||HAS_EXT.test(value)&&!/\s/.test(value);
function commandOf(line){
  const value=line.trim().replace(/^(\$|!|>)\s*/,"");
  return value&&!value.startsWith("#")?value:"";
}
// What a text names, in order and each once: {kind:"command"|"path", value}. Pure for tests.
function answerRefs(text,limit=12){
  const found=[],seen=new Set();
  const add=(kind,value)=>{value=value.trim();if(value&&value.length<=1000&&!seen.has(kind+value)){seen.add(kind+value);found.push({kind,value})}};
  let rest=String(text||"").replace(/```([^\n`]*)\n([\s\S]*?)```/g,(block,lang,body)=>{
    if(SHELL_FENCE.test(lang.trim()))for(const line of body.split("\n"))add("command",commandOf(line));
    return "\n";
  });
  rest=rest.replace(/`([^`\n]+)`/g,(code,value)=>{
    value=value.trim();
    if(value.startsWith("!"))add("command",value.slice(1));
    else if(looksLikePath(value))add("path",value.replace(/[.,;:]$/,""));
    else if(COMMANDS.test(value+" "))add("command",value);
    return " ";
  }).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi," ");
  for(const line of rest.split("\n"))for(const match of line.matchAll(BARE_PATH)){
    let value=match[1];
    if(!HAS_EXT.test(value)&&!value.endsWith("/")){
      const tail=line.slice(match.index+match[0].length).match(SPACED_TAIL);
      if(tail)value+=tail[1];
    }
    add("path",value.replace(/[.,;:]$/,""));
  }
  return found.slice(0,limit);
}
const isFolder=value=>value.endsWith("/")||!HAS_EXT.test(value.split("/").pop());
const refLabel=item=>item.kind==="command"?item.value:(isFolder(item.value)?item.value.replace(/\/+$/,"").split("/").pop()+"/":item.value.split("/").pop());
// The agent's turns after the person's last message: the answer now on screen.
function lastAnswer(turns){
  const list=Array.isArray(turns)?turns:[];
  let i=list.length;
  while(i>0&&list[i-1]?.role!=="user")i--;
  return list.slice(i).map(turn=>turn.text||"").join("\n\n");
}
function showRefs(key,turns){
  const box=$("answer_refs");if(!box)return;
  const items=key===sessionInfoKey()?answerRefs(lastAnswer(turns)):[];
  const sig=key+"\n"+items.map(item=>item.kind+item.value).join("\n");
  if(sig===refs.sig&&!box.hidden===Boolean(items.length))return;
  Object.assign(refs,{key,sig,items});
  box.replaceChildren(...items.map(item=>{
    const chip=el("button","ref-chip",svgIcon(item.kind==="command"?"terminal":isFolder(item.value)?"folder":"file"),el("span","",refLabel(item)));
    chip.type="button";chip.title=item.value;chip.onclick=()=>openRef(item);
    return chip;
  }));
  box.hidden=!items.length;
}
function clearRefs(){refs.sig="";refs.items=[];const box=$("answer_refs");if(box){box.hidden=true;box.replaceChildren()}}
function openRef(item){
  refs.item=item;
  const s=cur(),windows=s?.runtime==="windows",folder=item.kind==="path"&&isFolder(item.value);
  $("ref_value").textContent=item.value;
  $("ref_title").textContent=tr(item.kind==="command"?"Команда":folder?"Папка":"Файл");
  const actions=[btn(tr("Копировать"),"",()=>{copyText(item.value);$("ref_dlg").close()})];
  if(item.kind==="command"&&!windows)actions.push(btn(tr("Запустить в новом терминале"),"pri",()=>{$("ref_dlg").close();runInTerminal(item.value)}));
  if(item.kind==="path"&&!windows)actions.push(folder?btn(tr("Открыть папку"),"pri",()=>{$("ref_dlg").close();openRefFolder(item.value)})
    :btn(tr(isMarkdown(item.value)?"Открыть":"Скачать"),"pri",()=>{$("ref_dlg").close();isMarkdown(item.value)?openScreenFile(item.value):downloadFile(active,item.value)}));
  $("ref_actions").replaceChildren(...actions);
  $("ref_dlg").showModal();
}
function sessionRelative(path){
  const base=cur()?.path||"";
  return /^[~/]/.test(path)||!base?path:base.replace(/\/+$/,"")+"/"+path.replace(/^\.\//,"");
}
async function openRefFolder(path){
  if(filesDirty()&&!await confirmAction(tr("Изменения не сохранены. Закрыть без сохранения?"),{confirm:tr("Закрыть без сохранения"),danger:true}))return;
  dropPreview();files.file=null;
  openProject("files");
  files.session=active;files.key=sessionInfoKey();
  await loadFolder(sessionRelative(path).replace(/(.)\/+$/,"$1"));
}
// A terminal of its own in the session's folder: the agent's session keeps its screen and its input.
async function runInTerminal(command){
  const s=cur();if(!s)return;
  if(panelUpdating){toast(tr("Панель обновляется. Дождитесь завершения."));return}
  const deck=selectedDeck,epoch=deckEpoch,asked=s.name.slice(0,28)+"-run";
  try{
    const made=await gatewayApi(instancePath(deck,"/api/new"),{name:asked,agent:"shell",path:s.path});
    const name=made.name||asked;
    await gatewayApi(instancePath(deck,"/api/send"),{name,text:command});
    if(epoch!==deckEpoch)return;
    await load();
    if(epoch===deckEpoch)select(name);
  }catch(e){toast(e.message)}
}

if(typeof module!=="undefined")module.exports={answerRefs,lastAnswer};
