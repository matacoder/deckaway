// Screenshots and previews that agents mention by path: clickable, with thumbnails and a viewer.
const IMAGE_PATH_RE=/(?<![\w/.~@+-])(?:~?\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:png|jpe?g|webp|gif)(?![\w-]|\.\w)/gi;
const IMAGE_HEAD_RE=/^[\w./@+-]+\.(?:png|jpe?g|webp|gif)(?![\w-]|\.\w)/i;
let screenImages=[],viewerIndex=0;

function imageMatches(text,taken=[]){
  // taken: [start,end) ranges already used by URLs, so https://x/a.png stays a web link.
  const result=[];
  for(const m of text.matchAll(IMAGE_PATH_RE)){
    const start=m.index,end=start+m[0].length;
    if(!taken.some(([a,b])=>start<b&&end>a))result.push({index:start,path:m[0]});
  }
  return result;
}
// Agents hard-wrap long paths ("…/padel-w1-cashier-" + "preview/shot.png"); glue such lines back.
function joinImageLines(lines){
  const text=lines.map(runs=>runs.map(r=>r.text).join("")),out=[];
  for(let i=0;i<lines.length;i++){
    const runs=lines[i].slice();
    // Only a path at the end can wrap; scanning long base64 output would block the page.
    let tail=text[i].trimEnd().slice(-300);
    while(i+1<lines.length){
      const path=tail.match(/[\w.~@+-]*\/[\w./@+-]*$/);
      if(!path||/\.(?:png|jpe?g|webp|gif)$/i.test(path[0])||!IMAGE_HEAD_RE.test(text[i+1]))break;
      for(let j=runs.length-1;j>=0&&/\s$/.test(runs[j].text);j--)runs[j]={...runs[j],text:runs[j].text.trimEnd()};
      runs.push(...lines[++i]);
      tail=(tail+text[i]).trimEnd().slice(-300);
    }
    out.push(runs);
  }
  return out;
}

function imageUrl(session,path,thumb){return activePath("/api/image?name="+encodeURIComponent(session)+"&path="+encodeURIComponent(path)+(thumb?"&thumb=1":""))}
function imageLink(session,path,runs,from,to){
  const link=el("a","img-link");link.href=imageUrl(session,path);
  appendStyledRange(link,runs,from,to);
  link.onclick=event=>{event.preventDefault();openViewer(path)};
  return link;
}
// A path that did not load is not tried again for a while: the screen redraws often, and each new
// attempt would show an empty thumbnail that then disappears (a blink).
const missingImages=new Map(),MISSING_FOR=60*1000;
function imageMissing(session,path,now=Date.now()){
  const key=selectedDeck+"\n"+session+"\n"+path,at=missingImages.get(key);
  if(at&&now-at<MISSING_FOR)return true;
  missingImages.delete(key);return false;
}
// The screen is rebuilt on every change of its text (a running timer): a strip already drawn for the same
// pictures is moved into the new screen as it is, so loaded thumbnails do not blink.
function stripKey(deck,session,paths){return JSON.stringify([deck,session,[...new Set(paths)]])}
function keptStrips(box){
  const kept=new Map();
  for(const strip of box.querySelectorAll(".img-strip[data-key]"))if(!kept.has(strip.dataset.key))kept.set(strip.dataset.key,strip);
  return kept;
}
function imageStrip(session,paths,kept){
  // The pictures left out are part of the key: when one may be tried again, the strip is built anew for it.
  const skipped=new Set([...new Set(paths)].filter(path=>imageMissing(session,path)));
  const key=stripKey(selectedDeck,session,paths)+JSON.stringify([...skipped]),old=kept?.get(key);
  if(old){kept.delete(key);return old}
  const strip=el("div","img-strip");strip.dataset.key=key;
  for(const path of new Set(paths)){
    if(skipped.has(path))continue;
    const thumb=el("button","img-thumb"),img=document.createElement("img");
    thumb.type="button";thumb.title=path;thumb.setAttribute("aria-label",tr("Открыть картинку {0}",[path.split("/").pop()]));
    img.loading="lazy";img.decoding="async";img.alt="";img.src=imageUrl(session,path,true);
    // Missing files, or paths no longer on screen, simply leave the text without a preview.
    // Offline or a restarting panel is no reason to stop trying this picture. The strip is then built anew.
    img.onerror=()=>{if(connection==="online")missingImages.set(selectedDeck+"\n"+session+"\n"+path,Date.now());thumb.remove();delete strip.dataset.key};
    thumb.append(img);thumb.onclick=()=>openViewer(path);strip.append(thumb);
  }
  return strip;
}

// The viewer walks a list of pictures: the screenshots on the screen, or the session's gallery.
let viewerItems=[];
function openViewer(path){
  if(!screenImages.includes(path))screenImages=[path];
  showViewer(screenImages.map(p=>({url:imageUrl(active,p),name:p.split("/").pop(),title:p})),screenImages.indexOf(path));
}
function showViewer(items,index){
  viewerItems=items;viewerIndex=Math.max(0,index);
  viewerReturn=document.activeElement;
  // A modal dialog (the project panel on a phone) covers everything outside it: the viewer opens inside.
  const modal=[...document.querySelectorAll("dialog[open]")].find(d=>{try{return d.matches(":modal")}catch(e){return false}});
  (modal||document.body).append($("viewer"));
  renderViewer();$("viewer").hidden=false;fitViewerChrome();$("viewer_close").focus();
}
// A pinch on the picture zooms the whole page on an iPhone: the controls are kept over the part still on screen.
function viewerChromeStyle(vv){
  const scale=vv?.scale||1;
  if(scale<=1.01)return {left:"",top:"",width:"",height:"",transform:""};
  return {left:vv.offsetLeft+"px",top:vv.offsetTop+"px",width:vv.width*scale+"px",height:vv.height*scale+"px",transform:"scale("+1/scale+")"};
}
function fitViewerChrome(){Object.assign($("viewer_chrome").style,viewerChromeStyle(window.visualViewport))}
// Briefly capping the zoom is the only way a page can return Safari to its normal size.
function resetPageZoom(){
  const meta=document.querySelector("meta[name=viewport]");
  if(!meta||(window.visualViewport?.scale||1)<=1.01)return;
  const was=meta.content;meta.content=was+",maximum-scale=1";
  setTimeout(()=>{meta.content=was},300);
}
function renderViewer(){
  const item=viewerItems[viewerIndex];
  $("viewer_img").src=item.url;$("viewer_open").href=item.url;
  $("viewer_caption").textContent=(viewerItems.length>1?(viewerIndex+1)+" / "+viewerItems.length+"  ·  ":"")+item.name;
  $("viewer_caption").title=item.title;
  $("viewer_prev").hidden=$("viewer_next").hidden=viewerItems.length<2;
}
function stepViewer(delta){viewerIndex=(viewerIndex+delta+viewerItems.length)%viewerItems.length;renderViewer()}
let viewerReturn=null;
function closeViewer(){
  if($("viewer").hidden)return;
  $("viewer").hidden=true;$("viewer_img").removeAttribute("src");resetPageZoom();
  if(viewerReturn?.isConnected)viewerReturn.focus({preventScroll:true});viewerReturn=null;
}
if(typeof document!=="undefined"&&document.getElementById("viewer")){
  addEventListener("keydown",e=>{
    if($("viewer").hidden)return;
    if(e.key==="Tab"){
      // A modal viewer keeps keyboard focus inside until it is closed.
      const items=[...$("viewer").querySelectorAll("button,a[href]")].filter(x=>!x.hidden&&x.offsetParent!==null);
      const index=items.indexOf(document.activeElement),next=items[(index+(e.shiftKey?-1:1)+items.length)%items.length];
      if(next){e.preventDefault();next.focus()}return;
    }
    if(e.key==="Escape")closeViewer();else if(e.key==="ArrowRight")stepViewer(1);else if(e.key==="ArrowLeft")stepViewer(-1);else return;
    e.preventDefault();e.stopPropagation();
  },true);
  // Horizontal swipe flips between screenshots on a phone, a swipe down closes the viewer; not while zoomed in,
  // where a finger moves the page. Runs before app.js defines $, so the element is looked up directly.
  const viewer=document.getElementById("viewer");let touch=null;
  viewer.addEventListener("touchstart",e=>{touch=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null},{passive:true});
  viewer.addEventListener("touchend",e=>{
    if(!touch||(window.visualViewport?.scale||1)>1.01){touch=null;return}
    const dx=e.changedTouches[0].clientX-touch.x,dy=e.changedTouches[0].clientY-touch.y;touch=null;
    if(dy>90&&Math.abs(dx)<60)closeViewer();
    else if(Math.abs(dx)>60&&viewerItems.length>1)stepViewer(dx<0?1:-1);
  },{passive:true});
  for(const event of ["resize","scroll"])window.visualViewport?.addEventListener(event,()=>{if(!viewer.hidden)fitViewerChrome()});
}

if(typeof module!=="undefined")module.exports={viewerChromeStyle,stripKey,imageMatches,joinImageLines,IMAGE_PATH_RE,imageMissing,missingImages};
