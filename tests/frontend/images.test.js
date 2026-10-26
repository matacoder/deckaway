const {imageMatches,joinImageLines}=require('../../frontend/images');
const runs=text=>[{text,style:{}}];
const plain=line=>line.map(r=>r.text).join('');

test('finds absolute, home and relative screenshot paths but leaves web links alone',()=>{
 const text='Касса (/private/tmp/a/cashier_viewport.png) · shots/home.PNG, ~/Desktop/r.jpeg https://example.com/x.png';
 const url=text.indexOf('https');
 expect(imageMatches(text,[[url,text.length]]).map(m=>m.path)).toEqual(['/private/tmp/a/cashier_viewport.png','shots/home.PNG','~/Desktop/r.jpeg']);
 expect(imageMatches('report.pdf notes.png.bak archive.png-old')).toEqual([]);
});

test('glues a path the agent wrapped across lines, as in Codex output',()=>{
 const lines=[runs('  Касса (/private/tmp/padel-w1-cashier-'),runs('preview/cashier_viewport.png) · Отдельный экран'),runs('next line')];
 const joined=joinImageLines(lines);
 expect(joined.map(plain)).toEqual(['  Касса (/private/tmp/padel-w1-cashier-preview/cashier_viewport.png) · Отдельный экран','next line']);
 expect(imageMatches(plain(joined[0])).map(m=>m.path)).toEqual(['/private/tmp/padel-w1-cashier-preview/cashier_viewport.png']);
});

test('does not glue ordinary lines',()=>{
 const lines=[runs('see /tmp/done.png'),runs('next.png is separate'),runs('path /usr/lib/'),runs('and more text')];
 expect(joinImageLines(lines).map(plain)).toEqual(['see /tmp/done.png','next.png is separate','path /usr/lib/','and more text']);
});

test('an image that failed to load is not retried on every redraw for a while',()=>{
  const {imageMissing,missingImages}=require('../../frontend/images');
  global.selectedDeck='';
  missingImages.set('\ns\nshot.png',1000);
  expect(imageMissing('s','shot.png',1000+30*1000)).toBe(true);
  expect(imageMissing('other','shot.png',1000+30*1000)).toBe(false);
  global.selectedDeck='a'.repeat(24);
  expect(imageMissing('s','shot.png',1000+30*1000)).toBe(false);  // Another computer's session of the same name.
  global.selectedDeck='';
  expect(imageMissing('s','shot.png',1000+2*60*1000)).toBe(false);  // Tried again after a minute.
});

test('any file path with a folder becomes a download link; plain words and web links do not',()=>{
 const {fileMatches}=require('../../frontend/files');
 const text='PDF /home/dev/suzdal/suzdal_plan.pdf. см. src/app.py:12, ~/notes/a.md и ../x/y.tar.gz; v1.2 e.g. plan.pdf https://x.test/a/b.pdf';
 const url=text.indexOf('https');
 expect(fileMatches(text,[[url,text.length]]).map(m=>m.file)).toEqual(['/home/dev/suzdal/suzdal_plan.pdf','src/app.py','~/notes/a.md','../x/y.tar.gz']);
});

test('a folder path ending in a slash is a link of its own; "and/or/", a lone "~/" and a URL are not',()=>{
 const {fileMatches}=require('../../frontend/files');
 const text='Отчёт: /Users/denis/dev/med/reports/tts-compare-2026-10-24/ и ~/dev/, файл /tmp/x/a.txt, and/or/ ~/ https://x.test/a/b/';
 const url=text.indexOf('https');
 expect(fileMatches(text,[[url,text.length]]).map(m=>(m.folder?'dir ':'')+m.file)).toEqual(['dir /Users/denis/dev/med/reports/tts-compare-2026-10-24/','dir ~/dev/','/tmp/x/a.txt']);
});

test('a version folder is no ".0" file; a home path without a slash at its end may be either, other roots stay text',()=>{
 const {fileMatches}=require('../../frontend/files');
 const text='Сборка в /Users/denis/dev/Audopia/mobile/store/1.4.0. Маршрут /api/send, v1.2.3, store/1.4.0 и ~/dev/a.md';
 expect(fileMatches(text).map(m=>(m.folder?m.folder+' ':'')+m.file)).toEqual(['maybe /Users/denis/dev/Audopia/mobile/store/1.4.0','~/dev/a.md']);
});

test('long hex and base64 lines use a bounded tail and keep image paths intact',()=>{
 const lines=[runs('a'.repeat(80000)),runs('b'.repeat(80000)+'/tmp/wrapped-  '),runs('shot.png'),runs('done')];
 const started=performance.now(),joined=joinImageLines(lines);
 expect(performance.now()-started).toBeLessThan(1000);
 expect(joined.map(plain)).toEqual(['a'.repeat(80000),'b'.repeat(80000)+'/tmp/wrapped-shot.png','done']);
 expect(plain(lines[1]).endsWith('  ')).toBe(true);
});

test('successive wrapped paths keep styles and trim trailing whitespace across runs',()=>{
 const first=[{text:'prefix /tmp/first-',style:{color:'red'}},{text:'  ',style:{}}];
 const lines=[first,runs('shot.png and /tmp/second-'),runs('shot.png')];
 const joined=joinImageLines(lines);
 expect(joined.map(plain)).toEqual(['prefix /tmp/first-shot.png and /tmp/second-shot.png']);
 expect(joined[0][0].style).toEqual({color:'red'});
 expect(first[1].text).toBe('  ');
});
