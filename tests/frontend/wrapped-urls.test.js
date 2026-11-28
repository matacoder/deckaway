const {wrappedUrls,unwrapUrls,joinUrlLines}=require('../../frontend/screen');
global.wrappedUrls=wrappedUrls;
global.safeHyperlink=url=>/^https:\/\//.test(url);
const {cutLinks,firstLinkProvider}=require('../../frontend/refs');

const GOOGLE='https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com&code_challenge=Etf5p1X9gnFt6qbfqBxEcMR9Bm1DcNFBdMV5b8ormsw&code_challenge_method=S256&prompt=consent&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&scope=openid&state=VlwXbilBy6ZeQMs2dEUvIA';
const WIDTH=60;
// Antigravity's sign-in screen: the address in chunks, each wrapped at the width, empty lines between chunks.
function antigravity(){
  const chunks=[GOOGLE.slice(0,150),GOOGLE.slice(150,260),GOOGLE.slice(260)];
  const lines=[' Your browser should open automatically. If not:',''];
  chunks.forEach((chunk,c)=>{
    const indent=c===0?'  ':' ';
    for(let k=0;k<chunk.length;k+=WIDTH-indent.length)lines.push(indent+chunk.slice(k,k+WIDTH-indent.length));
    lines.push('');
  });
  lines.push(" If you aren't automatically redirected, paste the authorization code below:",'',' authorization code...');
  return lines;
}

test('an address an agent cut into indented pieces with empty lines between them is one address again',()=>{
  const lines=antigravity(),found=wrappedUrls(lines,WIDTH);
  expect(found.map(f=>f.url)).toEqual([GOOGLE]);
  expect(found[0].parts.map(p=>lines[p.line].slice(p.start,p.end)).join('')).toBe(GOOGLE);
  const text=unwrapUrls(lines.join('\n'));
  expect(text).toContain('  '+GOOGLE+'\n');
  expect(text).toContain("If you aren't automatically redirected");
});

test('the screen view joins the coloured pieces and drops the lines between them',()=>{
  const lines=antigravity().map(text=>[{text,fg:4}]);
  const joined=joinUrlLines(lines).map(runs=>runs.map(r=>r.text).join(''));
  expect(joined).toContain('  '+GOOGLE);
  expect(joined.slice(joined.indexOf('  '+GOOGLE)+1,joined.indexOf('  '+GOOGLE)+3)).toEqual(['',antigravity().find(l=>l.startsWith(' If'))]);
});

test('a short link, ordinary text after a link and a second link are never glued',()=>{
  expect(wrappedUrls(['See https://example.com/docs','Done.'],60)).toEqual([]);
  expect(wrappedUrls(['x'.repeat(30)+' https://example.com/'+'a'.repeat(28),'','Finished.'],60)).toEqual([]);
  expect(wrappedUrls(['x'.repeat(30)+' https://example.com/'+'a'.repeat(28),'https://other.example/'],60)).toEqual([]);
  const full='x'.repeat(30)+' https://example.com/'+'a'.repeat(28);
  expect(wrappedUrls([full,'bbbb/c.html'],60).map(f=>f.url)).toEqual(['https://example.com/'+'a'.repeat(28)+'bbbb/c.html']);
});

test('in the terminal every piece opens the whole address, ahead of the terminal\'s own links',()=>{
  const lines=antigravity();
  const t={cols:WIDTH,buffer:{active:{length:lines.length,getLine:k=>lines[k]===undefined?undefined:{translateToString:()=>lines[k]}}}};
  const open=jest.spyOn(window,'open').mockImplementation(()=>null);
  const y=lines.findIndex(l=>l.includes('8ormsw'))+1;
  const links=cutLinks(t,y);
  expect(links.map(l=>l.text)).toEqual([GOOGLE]);
  expect(links[0].range.start.y).toBe(y);
  links[0].activate();
  expect(open).toHaveBeenCalledWith(GOOGLE,'_blank','noopener');
  expect(cutLinks(t,1)).toEqual([]);
  const own={},ttyd={},cut={},core={_core:{linkifier2:{_linkProviders:[ttyd,own,cut]}}};
  firstLinkProvider(core);
  expect(core._core.linkifier2._linkProviders).toEqual([cut,ttyd,own]);
  firstLinkProvider({});
});
