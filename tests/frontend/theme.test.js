const fs=require('fs');
const path=require('path');
const {THEMES,resolvedTheme,isLightTheme}=require('../../frontend/theme');

const read=name=>fs.readFileSync(path.join(__dirname,'../../',name),'utf8');

test('dark is the default and "system" follows the device',()=>{
  expect(resolvedTheme('light',false)).toBe('light');
  expect(resolvedTheme('dark',true)).toBe('dark');
  expect(resolvedTheme('mint',false)).toBe('mint');
  expect(resolvedTheme('system',true)).toBe('light');
  expect(resolvedTheme('system',false)).toBe('dark');
  expect(resolvedTheme(null,true)).toBe('dark');
  expect(resolvedTheme('constructor',true)).toBe('dark');
  expect(isLightTheme('mint')).toBe(true);
  expect(isLightTheme('dusk')).toBe(false);
});

test('the page heads know every theme the settings offer',()=>{
  const others=Object.keys(THEMES).filter(name=>name!=='dark').join('|');
  for(const page of ['frontend/index.html','panel/login.html']){
    expect(read(page)).toContain('/^('+others+')$/.test(t)');
    if(page.startsWith('panel'))for(const name of Object.keys(THEMES).slice(1))expect(read(page)).toContain(':root[data-theme='+name+']');
  }
});

// Tokens of a CSS block: the dark :root first, then a theme's own block over it.
const tokens=block=>Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;}]+)/g)].map(m=>[m[1],m[2].trim()]));
const luminance=hex=>{
  let h=hex.replace('#','');if(h.length===3)h=[...h].map(c=>c+c).join('');
  const [r,g,b]=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
};
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};

test('every theme keeps text readable (WCAG AA) on its surfaces',()=>{
  const base=tokens(read('frontend/style.css').match(/:root\{([\s\S]*?)\n\}/)[1]);
  const css=read('frontend/themes.css');
  const weak=[];
  for(const name of Object.keys(THEMES)){
    const own=name==='dark'?'':css.match(new RegExp(':root\\[data-theme='+name+'\\]\\{([\\s\\S]*?)\\n\\}'))[1];
    const t={...base,...tokens(own)};
    for(const fg of ['--fg','--fg2','--mut','--dim','--acc-text','--link','--bad-text',...Array.from({length:8},(_,i)=>'--author-'+i)])
      for(const bg of (fg.startsWith('--author-')?['--bg','--side','--side2','--sel']:['--bg','--side']))if(contrast(t[fg],t[bg])<4.5)weak.push(`${name} ${fg} on ${bg}: ${contrast(t[fg],t[bg]).toFixed(2)}`);
    if(contrast(t['--on-acc'],t['--acc-strong'])<4.5)weak.push(`${name} --on-acc on --acc-strong`);
  }
  expect(weak).toEqual([]);
});
