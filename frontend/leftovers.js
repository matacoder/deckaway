// What agents left running on this computer: processes of closed sessions and ones sent to the background.
let leftoverList=null;

function leftoverAge(seconds,translate){
  const m=Math.max(1,Math.round(seconds/60));
  return m<60?translate("{0} мин",[m]):m<1440?translate("{0} ч {1} мин",[Math.floor(m/60),m%60]):translate("{0} д {1} ч",[Math.floor(m/1440),Math.floor(m%1440/60)]);
}
function leftoverMemory(kb,locale){
  const gb=kb>=1048576;
  return new Intl.NumberFormat(locale,{style:"unit",unit:gb?"gigabyte":"megabyte",maximumFractionDigits:gb?1:0}).format(gb?kb/1048576:kb/1024);
}
// The closed sessions' processes first: nothing waits for them any more.
function leftoverGroups(list){
  return [list.filter(p=>p.closed),list.filter(p=>!p.closed)];
}

async function loadLeftovers(){
  try{leftoverList=(await api("/api/leftovers")).processes}catch(e){leftoverList=null;if(e.message!==STALE)$("leftover_status").textContent=e.message;return}
  renderLeftovers();
}
function renderLeftovers(){
  const list=leftoverList||[],[closed,background]=leftoverGroups(list);
  const total=list.reduce((sum,p)=>sum+p.rss,0);
  $("leftover_status").textContent=list.length?tr("Процессов: {0} · память: {1}",[list.length,leftoverMemory(total,DATE_LOCALE)]):tr("Ничего не осталось");
  $("leftover_status").className="card-status "+(closed.length?"warn":"ok");
  const row=p=>hubRow({title:p.closed?tr("Закрытая сессия"):p.session,status:leftoverMemory(p.rss,DATE_LOCALE)+" · "+leftoverAge(p.age,tr),
    tone:p.closed?"warn":"idle",meta:p.command,actions:[labelledButton(tr("Остановить"),"",()=>stopLeftovers([p]),p.command)]});
  $("leftover_list").replaceChildren(...closed.map(row),...background.map(row),
    el("div","acts",btn(tr("Обновить"),"",loadLeftovers),...(closed.length>1?[btn(tr("Остановить всё от закрытых сессий"),"danger-pri",()=>stopLeftovers(closed))]:[])));
}
async function stopLeftovers(items){
  const text=items.length===1?items[0].command:tr("Процессов: {0} · память: {1}",[items.length,leftoverMemory(items.reduce((s,p)=>s+p.rss,0),DATE_LOCALE)]);
  if(!await confirmAction(tr("Остановить процессы?"),{text,confirm:tr("Остановить"),danger:true}))return;
  try{
    const r=await api("/api/leftovers_stop",{pids:items.map(p=>p.pid)});
    toast(tr("Остановлено: {0}",[r.stopped]));
  }catch(e){toast(e.message)}
  // Stopping takes up to a few seconds (TERM, then KILL).
  setTimeout(loadLeftovers,1500);
}
// Sleep and the daily restart of agents on this computer (integrations/upkeep.py).
async function loadUpkeep(){
  try{const data=await api("/api/upkeep");$("upkeep_daily").checked=data.daily_restart!==false;syncField($("upkeep_days"),String(data.sleep_days));$("upkeep_status").textContent=""}
  catch(e){if(e.message!==STALE)$("upkeep_status").textContent=e.message}
}
async function saveUpkeep(){
  const days=Number($("upkeep_days").value);
  if(!Number.isInteger(days)||days<0||days>90){toast(tr("Дней: целое число от 0 до 90"));return}
  try{await api("/api/upkeep_save",{sleep_days:days,daily_restart:$("upkeep_daily").checked});toast(tr("Настройки сохранены"),"success")}
  catch(e){toast(e.message);loadUpkeep()}
}
if(typeof module!=="undefined")module.exports={leftoverAge,leftoverMemory,leftoverGroups};
