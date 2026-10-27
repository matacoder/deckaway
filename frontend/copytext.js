// The agent hard-wraps what it prints to the terminal's width: a newline and an indent inside a command or a
// sentence, and spaces up to the edge. Text copied from the screen is looked up in what the agent wrote
// (its conversation file, whitespace aside) and the original goes to the clipboard; tool output is not in
// that file, so there only the padding is dropped. Bundled before app.js; nothing runs at load time.
const agentText={key:"",text:""};
function rememberAgentText(key,turns){agentText.key=key;agentText.text=(Array.isArray(turns)?turns:[]).map(t=>t?.text||"").join("\n\n")}
const SCREEN_MARKS=/^[⏺●⎿│▐▌❯>•·-]+$/;
// The one place in the source the selection is, whitespace aside; null when absent or ambiguous. Pure for tests.
function sourceOf(selected,source){
  if(!source||!selected.trim()||selected.length>8000)return null;
  const words=selected.split(/\s+/).filter(word=>word&&!SCREEN_MARKS.test(word));
  if(!words.length||words.length>1500)return null;
  const pattern=new RegExp(words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("\\s*"),"g");
  const found=new Set([...source.matchAll(pattern)].map(match=>match[0]));
  return found.size===1?[...found][0]:null;
}
function cleanCopied(selected,source){
  return sourceOf(selected,source)??selected.replace(/[ \t ]+$/gm,"");
}
function copiedFromScreen(text){
  return cleanCopied(text,agentText.key===sessionInfoKey()?agentText.text:"");
}
function watchScreenCopy(){
  $("pre").addEventListener("copy",event=>{
    const text=String(getSelection()),clean=text&&copiedFromScreen(text);
    if(!text||clean===text||!event.clipboardData)return;
    event.clipboardData.setData("text/plain",clean);event.preventDefault();
  });
}

if(typeof module!=="undefined")module.exports={sourceOf,cleanCopied};
