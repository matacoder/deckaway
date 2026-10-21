const {renderMarkdown,isMarkdown}=require('../../frontend/markdown');

test('headings, lists, code, quotes and tables become their elements',()=>{
  const md=['# Plan','','Some **bold** and `code` text','continued.','','- one','- [x] done','','1. first','','```js','let a = 1;','```','','> quoted','','| A | B |','|---|---|','| 1 | 2 |'].join('\n');
  const root=renderMarkdown(md);
  expect(root.querySelector('h1').textContent).toBe('Plan');
  expect(root.querySelector('p').textContent).toBe('Some bold and code text continued.');
  expect(root.querySelector('p strong').textContent).toBe('bold');
  expect([...root.querySelectorAll('ul li')].map(li=>li.textContent)).toEqual(['one','☑ done']);
  expect(root.querySelector('ol li').textContent).toBe('first');
  expect(root.querySelector('pre code').textContent).toBe('let a = 1;');
  expect(root.querySelector('blockquote p').textContent).toBe('quoted');
  expect([...root.querySelectorAll('td')].map(td=>td.textContent)).toEqual(['1','2']);
});

test('raw HTML stays text and only web links are clickable',()=>{
  const root=renderMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://example.com) [local](docs/a.md)');
  expect(root.querySelector('img')).toBeNull();
  const links=[...root.querySelectorAll('a')];
  expect(links.map(a=>a.getAttribute('href'))).toEqual(['https://example.com']);
  expect(links[0].rel).toBe('noopener noreferrer');
  expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(root.textContent).toContain('bad');
});

test('markdown files are recognised by extension',()=>{
  expect(['README.md','plan.MARKDOWN','a.txt'].map(isMarkdown)).toEqual([true,true,false]);
});

test('a heading with a long run of spaces renders at once and keeps its text',()=>{
  const started=Date.now();
  const root=renderMarkdown('# Title'+' '.repeat(20000)+'end ##');
  expect(Date.now()-started).toBeLessThan(500);
  expect(root.querySelector('h1').textContent).toBe('Title'+' '.repeat(20000)+'end');
  expect(renderMarkdown('## C# notes').querySelector('h2').textContent).toBe('C# notes');
});

test('every block and list item names the source lines it came from',()=>{
  const root=renderMarkdown(['# T','','para one','still','','- a','  more','- b','','> q1','> q2','','```','x','```'].join('\n'));
  expect([...root.querySelectorAll('[data-line]')].map(n=>[n.tagName,n.dataset.line,n.dataset.end])).toEqual([
    ['H1','1','1'],['P','3','4'],['UL','6','8'],['LI','6','7'],['LI','8','8'],['BLOCKQUOTE','10','11'],['P','10','11'],['PRE','13','15']]);
});
