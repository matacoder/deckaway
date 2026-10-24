// The next step Claude Code suggests in its empty input box (dim text after the prompt mark, gone once
// anything is typed) as a button that sends it. Bundled before app.js.
const suggestion={name:"",text:""};
const SUGGESTING=["claude","claude-kimi","claude-provider"];
// The suggestion on a screen captured with its colours, or "". Typed text is not dim, and an empty box's own
// hint ('Try "…"') is no suggestion. Colour codes vary, and a focused box draws its cursor inverted over the
// first letter, so the dim state is followed code by code instead of matching one exact sequence. Pure for tests.
function suggestionText(rest){
  let dim=false,inverse=false,seen=false,text="";
  for(const part of rest.split(/(\x1b\[[0-9;]*m)/)){
    const codes=part.match(/^\x1b\[([0-9;]*)m$/);
    if(codes){
      for(const code of (codes[1]||"0").split(";").map(Number)){
        if(code===0)dim=inverse=false;else if(code===2)dim=true;else if(code===22)dim=false;
        else if(code===7)inverse=true;else if(code===27)inverse=false;
      }
      continue;
    }
    if(/\S/.test(part)&&!dim&&!inverse)return "";
    seen=seen||dim&&/\S/.test(part);text+=part;
  }
  return seen?text.trim():"";
}
function promptSuggestion(ansi){
  const lines=String(ansi||"").split("\n").slice(-30);
  for(let i=lines.length-1;i>=0;i--){
    const match=lines[i].match(/^(?:\x1b\[[0-9;]*m)*❯[\u00a0 ](.{0,600})$/);
    if(!match)continue;
    const text=suggestionText(match[1]);
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
