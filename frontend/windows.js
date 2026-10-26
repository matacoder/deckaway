// Agents in Windows itself, on a computer where DeckAway runs in WSL: whether that computer can start them, the
// choice in the new-session dialog and moving a session to the other side. Bundled before app.js.
const windowsState={deck:null,status:null,at:0};
const WINDOWS_AGENTS=["claude","codex","shell"];
let newRuntime="wsl";
// Asked when the dialog or the menu opens, never on a timer: the computer starts PowerShell to answer.
async function ensureWindows(){
  const deck=selectedDeck||"";
  if(windowsState.deck!==deck)Object.assign(windowsState,{deck,status:null,at:0});
  if(Date.now()-windowsState.at<300000)return windowsState.status;
  windowsState.at=Date.now();
  try{const data=await api("/api/windows_status",{});if(windowsState.deck===deck)windowsState.status=data.windows||null}
  catch(e){windowsState.at=0}
  renderNewRuntime();renderSessionMove();
  return windowsState.status;
}
const windowsOffered=()=>windowsState.deck===(selectedDeck||"")&&Boolean(windowsState.status?.available);
// C:\Users\me\<name>: the field's suggestion, and what is used when it is left empty.
function windowsFolder(name){
  const home=windowsState.status?.windows_home;
  return home?home.replace(/\\$/,"")+"\\"+(name||"project"):"";
}
function pickRuntime(value){newRuntime=value;renderNewRuntime()}
function renderNewRuntime(){
  const offered=windowsOffered(),win=offered&&newRuntime==="windows",status=windowsState.status||{};
  $("n_runtime_row").hidden=!offered;
  for(const b of $("n_runtime").children){const on=b.dataset.runtime===(win?"windows":"wsl");b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on))}
  $("dlg").classList.toggle("windows-run",win);
  $("n_winpath").placeholder=windowsFolder($("n_name").value.trim());
  const agents=(status.agents||[]).map(a=>AGENTS[a]?.label||a).join(", ");
  $("n_win_hint").textContent=!win?"":!status.ready?tr("Windows-программы не запускаются с этого компьютера: {0}",[status.error||""])
    :!WINDOWS_AGENTS.includes(newAgent)?tr("В Windows запускаются Claude, Codex и терминал")
    :tr(status.admin?"PowerShell {0}. Установлены в Windows: {1}. Агент работает от имени администратора.":"PowerShell {0}. Установлены в Windows: {1}. Агент работает без прав администратора.",[status.version||"",agents||tr("нет")]);
  $("n_win_hint").classList.toggle("warn",win&&(!status.ready||!WINDOWS_AGENTS.includes(newAgent)));
  renderNewAgentReadiness();
}
// What createSession adds to its request. The account or model and the containers picked for WSL are hidden
// for Windows and must not be sent with it: the computer refuses a Windows session with a source.
function newRuntimeFields(){
  if(!windowsOffered()||newRuntime!=="windows")return {};
  return {runtime:"windows",windows_path:$("n_winpath").value.trim()||windowsFolder($("n_name").value.trim()),source:undefined,containers:undefined};
}
function renderSessionMove(){
  const s=cur(),item=$("s_move");
  item.hidden=!s||!windowsOffered()||!WINDOWS_AGENTS.includes(agentOf(s));
  if(!item.hidden)$("s_move_label").textContent=tr(s.runtime==="windows"?"Перенести в Linux (WSL)":"Перенести в Windows");
}
function openMove(){
  const s=cur();if(!s)return;
  if(s.runtime==="windows")return moveSession(s.name,"wsl");
  const drive=/^\/mnt\/([a-z])(\/.*)?$/.exec(s.path||"");
  $("move_path").value=drive?drive[1].toUpperCase()+":"+(drive[2]||"\\").replace(/\//g,"\\"):windowsFolder(s.group&&s.group!=="другое"?s.group:s.name);
  $("move_dlg").dataset.session=s.name;$("move_dlg").showModal();
}
async function moveSession(name,runtime,windowsPath){
  if(runtime==="wsl"&&!await confirmAction(tr("Перенести в Linux (WSL)?"),{text:tr("Агент начнёт новый разговор: история не переносится, он получит краткое резюме этой сессии. Эта сессия останется как есть.")}))return;
  const done=await post("/api/session_move",{name,runtime,windows_path:windowsPath});
  if(!done)return;
  if($("move_dlg").open)$("move_dlg").close();
  toast(tr(done.summary?"Новая сессия получит резюме, когда агент будет готов":"Резюме этой сессии ещё нет: расскажите агенту задачу сами"),true);
  select(done.name);
}
