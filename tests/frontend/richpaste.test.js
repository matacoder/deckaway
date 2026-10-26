const {pastedImageSources,isPasteKey,mentionsPictures,pastedText,richPasteText}=require('../../frontend/richpaste');

test('pictures a paste left in an editable block are found once; anything that is not a picture address is not',()=>{
  document.body.innerHTML='<div id="b"><span>text</span><img src="data:image/png;base64,AAAA"><div><img src="blob:https://panel.test/1"><img src="data:image/png;base64,AAAA"></div><img src="https://cdn.example/a.png"><img src="file:///x.png"><img src="javascript:alert(1)"><img></div>';
  expect(pastedImageSources(document.getElementById('b'))).toEqual(['data:image/png;base64,AAAA','blob:https://panel.test/1','https://cdn.example/a.png']);
});

test('the paste shortcut is recognised on any layout, not with Shift or Alt',()=>{
  const key=extra=>({metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,code:'KeyV',...extra});
  expect(isPasteKey(key({metaKey:true}))).toBe(true);
  expect(isPasteKey(key({ctrlKey:true,key:'м'}))).toBe(true);   // A Russian layout types another letter.
  expect(isPasteKey(key({metaKey:true,shiftKey:true}))).toBe(false);
  expect(isPasteKey(key({ctrlKey:true,altKey:true}))).toBe(false);
  expect(isPasteKey(key({metaKey:true,code:'KeyC'}))).toBe(false);
  expect(isPasteKey(key({}))).toBe(false);
});

test('copied messages that name a picture are told from ordinary text',()=>{
  for(const text of ['[08.10 09:01] Anna: [ Photo ]\nlook','[Фото]','x [ Album ] y','[ Photo, 2 files ]'])expect(mentionsPictures(text)).toBe(true);
  for(const text of ['photo of the page','[link](https://x)','[ ]','',null])expect(mentionsPictures(text)).toBe(false);
});

test('the text a paste left in a block keeps its lines and leaves pictures out',()=>{
  document.body.innerHTML='<div id="b"><div>[26.10 12:40] Anna: [ Photo ]</div><img src="data:image/png;base64,AAAA"><div>first&nbsp;line<br>second line</div><p>third</p><span>tail</span></div>';
  expect(pastedText(document.getElementById('b'))).toBe('[26.10 12:40] Anna: [ Photo ]\nfirst line\nsecond line\nthird\ntail');
});

test('messages copied on an iPhone keep every message, not only the first clipboard item',()=>{
  document.body.innerHTML='<div id="b"><div>Anna: first message</div><img src="blob:https://panel.test/1"><div>Anna: second message</div><div>Boris: third message</div></div>';
  const box=document.getElementById('b');
  expect(richPasteText('Anna: first message',box)).toBe('Anna: first message\nAnna: second message\nBoris: third message');
  expect(richPasteText('',box)).toContain('Boris: third message');  // The first item was the photo.
  // One ordinary item: the clipboard's own text, with its exact spacing.
  document.body.innerHTML='<div id="b"><p>one  two</p></div>';
  expect(richPasteText('one  two\n',document.getElementById('b'))).toBe('one  two\n');
  document.body.innerHTML='<div id="b"><img src="blob:https://panel.test/2"></div>';
  expect(richPasteText('',document.getElementById('b'))).toBe('');
});
