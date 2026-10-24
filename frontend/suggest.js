// The next step Claude Code suggests in its empty input box (dim text after the prompt mark, gone once
// anything is typed) as a button that sends it. Bundled before app.js.
const suggestion={name:"",text:""};
const SUGGESTING=["claude","claude-kimi","claude-provider"];
// The suggestion on a screen captured with its colours, or "". Typed text is not dim, and an empty box's own
// hint ('Try "…"') is no suggestion. Pure for tests.
function promptSuggestion(ansi){
  const lines=String(ansi||"").split("\n").slice(-30);
  for(let i=lines.length-1;i>=0;i--){
    const match=lines[i].match(/^(?:\x1b\[[0-9;]*m)*❯[  ]\x1b\[2m([^\x1b]{1,400})\x1b\[(?:0|22)m\s*$/);
    if(!match)continue;
    const text=match[1].trim();
    return text&&!/^Try "/.test(text)?text:"";
  }
  return "";
}
function renderSuggestion(s){
  const chip=$("suggest_chip");if(!chip)return;
  const text=s&&SUGGESTING.includes(s.agent)&&s.name===active?promptSuggestion(s.preview_ansi):"";
  if(text===suggestion.text&&s?.name===suggestion.name)return;
  Object.assign(suggestion,{name:s?.name||"",text});
  chip.hidden=!text;
  $("suggest_text").textContent=text;chip.title=text;
}
async function sendSuggestion(){
  const {name,text}=suggestion;
  if(!text||name!==active)return;
  $("suggest_chip").hidden=true;
  await post("/api/send",{name,text});
}

if(typeof module!=="undefined")module.exports={promptSuggestion};
