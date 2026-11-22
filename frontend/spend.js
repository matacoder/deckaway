// Tokens a session spent today on its computer (integrations/spend.py), at the right of its row in the list.
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
if(typeof module!=="undefined")module.exports={spendTotal,compactTokens};
