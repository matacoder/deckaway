// The panel's look, per browser: dark (the default), one of the other themes, or whatever the system uses. The
// page's head sets the same attribute before the styles load, so a light page never flashes dark. Bundled before
// app.js. `light` marks a theme drawn on a light page: agent output is recoloured for it (screenRgb).
const THEMES={dark:{label:"Тёмная"},light:{label:"Светлая",light:true},black:{label:"Чёрная"},
  dusk:{label:"Сумерки"},mint:{label:"Мятная",light:true}};
const knownTheme=name=>Object.prototype.hasOwnProperty.call(THEMES,name);
const THEME_KEY="cc.theme";
function themeChoice(){
  const saved=localStore.getItem(THEME_KEY);return saved==="system"||knownTheme(saved)?saved:"dark";
}
// The theme a choice shows now; "system" follows the device's light or dark setting. Pure for tests.
function resolvedTheme(choice,systemLight){return choice==="system"?(systemLight?"light":"dark"):knownTheme(choice)?choice:"dark"}
const isLightTheme=name=>Boolean(THEMES[resolvedTheme(name,false)].light);
const systemLight=()=>typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: light)").matches;
function applyTheme(){
  const theme=resolvedTheme(themeChoice(),systemLight()),root=document.documentElement;
  if(root.dataset.theme!==theme)root.dataset.theme=theme;
  screenTone.light=isLightTheme(theme);
  // The phone's status bar and the installed app's frame take the bar's own colour.
  const bar=getComputedStyle(root).getPropertyValue("--side").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",bar||"#252526");
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content",screenTone.light?"default":"black");
  const pre=document.getElementById("pre");
  if(pre&&screenView.shown){pre.dataset.raw="";updateScreen(screenView.shown,true)}
}
function fillThemes(){
  const pick=document.getElementById("ui_theme");if(!pick)return;
  const names=[...Object.entries(THEMES).map(([value,theme])=>[value,theme.label]),["system","Как в системе"]];
  pick.replaceChildren(...names.map(([value,label])=>new Option(tr(label),value)));
  pick.value=themeChoice();
}
function saveTheme(){
  localStore.setItem(THEME_KEY,document.getElementById("ui_theme").value);
  applyTheme();
}
if(typeof matchMedia==="function")matchMedia("(prefers-color-scheme: light)").addEventListener?.("change",()=>{if(themeChoice()==="system")applyTheme()});

if(typeof module!=="undefined")module.exports={THEMES,resolvedTheme,isLightTheme};
