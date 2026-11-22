// Tokens a session spent today, and how long it has lived, on its computer (integrations/spend.py), at the right of its row in the list.
// Cache reads are most of it: an agent rereads its whole context on every step, so a long conversation that
// works often costs the most.
function spendTotal(spend){return spend?Object.values(spend.today||{}).reduce((sum,value)=>sum+(Number(value)||0),0):0}
function compactTokens(value,locale){
  return new Intl.NumberFormat(locale,{notation:"compact",maximumFractionDigits:value<1e4||value>=1e6&&value<1e7?1:0}).format(value);
}
function spendTag(s){
  const total=spendTotal(s.spend);
  if(!total)return [];
  const part=name=>compactTokens(s.spend.today[name]||0,DATE_LOCALE);
  const tag=el("span","spend",compactTokens(total,DATE_LOCALE));
  tag.title=tr("Токенов сегодня: {0}. Ввод {1}, запись в кэш {2}, чтение из кэша {3}, ответы {4}. Вчера: {5}",
    [compactTokens(total,DATE_LOCALE),part("input"),part("cache_write"),part("cache_read"),part("output"),compactTokens(s.spend.yesterday||0,DATE_LOCALE)]);
  return [tag];
}
// How long the agent has run since it was last started (spend.running): a restart, a wake or the daily restart
// (integrations/upkeep.py) puts it on the installed version. Red after three days: it runs an old version.
const OLD_SESSION=3*86400;
function sessionAge(seconds,locale){
  const [value,unit]=seconds<3600?[Math.max(1,Math.floor(seconds/60)),"minute"]:seconds<86400?[Math.floor(seconds/3600),"hour"]:[Math.floor(seconds/86400),"day"];
  return new Intl.NumberFormat(locale,{style:"unit",unit,unitDisplay:"narrow"}).format(value);
}
function ageTag(s,now=Date.now()/1000){
  const started=s.spend?.running;
  if(!(started>0))return [];
  const age=Math.max(0,now-started);
  const tag=el("span","age"+(age>OLD_SESSION?" old":""),sessionAge(age,DATE_LOCALE));
  tag.title=tr("Агент запущен {0}",[new Date(started*1000).toLocaleString(DATE_LOCALE,{dateStyle:"medium",timeStyle:"short"})]);
  return [tag];
}
// Tokens above, age below, at the right of the row.
function rowMeta(s){
  const parts=[...spendTag(s),...ageTag(s)];
  return parts.length?[el("span","meta",...parts)]:[];
}
if(typeof module!=="undefined")module.exports={spendTotal,compactTokens,sessionAge};
