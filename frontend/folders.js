// Folders in the projects directory for the new-session form, most recently worked in first: a folder's name
// is easy to forget, when it was last worked in is not. Bundled before app.js; nothing runs at load time.
const projectFolders={deck:null,list:[],root:""};
function setProjectFolders(data,deck){
  projectFolders.deck=deck;projectFolders.root=data?.root||"";
  // A computer before 1.70 sends names only.
  projectFolders.list=Array.isArray(data?.folders)?data.folders:(data?.projects||[]).map(name=>({name}));
  $("projlist").replaceChildren(...projectFolders.list.map(f=>{const o=document.createElement("option");o.value=f.name;return o}));
  renderProjectFolders();
}
// Pure for tests.
function matchFolders(list,query){
  const q=(query||"").trim().toLowerCase();
  return list.filter(f=>!q||f.name.toLowerCase().includes(q));
}
function renderProjectFolders(){
  const box=$("n_folders");
  if(projectFolders.deck!==selectedDeck){projectFolders.list=[];projectFolders.root=""}
  box.hidden=!projectFolders.list.length;
  if(box.hidden)return;
  const root=projectFolders.root.replace(/^\/(?:Users|home)\/[^/]+/,"~");
  $("n_folders_state").textContent=root?tr("Папки в {0}",[root]):tr("Папки проектов");
  const list=$("n_folders_list"),chosen=$("n_proj").value.trim();
  const found=matchFolders(projectFolders.list,$("n_folders_q").value).slice(0,100);
  list.replaceChildren(...found.map(f=>{
    const row=el("button","repo"+(chosen===f.name?" sel":""),el("span","rn",f.name));row.type="button";
    if(f.changed)row.append(el("span","rm",relativeTime(f.changed)));
    row.onclick=()=>pickProjectFolder(f.name);
    return row;
  }));
  if(!found.length)list.append(el("div","hint",tr("Ничего не найдено")));
}
function pickProjectFolder(name){
  $("n_proj").value=name;
  // The folder is there already: a repository picked before would have been cloned into it.
  if($("n_git").value){$("n_git").value="";renderAdvanced();if($("gh_list"))renderRepos()}
  if(!$("n_name").value||$("n_name").dataset.auto){$("n_name").value=name.replace(/[^A-Za-z0-9_-]/g,"-").slice(0,32);$("n_name").dataset.auto="1"}
  renderProjectFolders();
}
