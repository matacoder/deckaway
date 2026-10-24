const {promptSuggestion}=require('../../frontend/suggest');

const box=line=>'● Done.\n\x1b[2m────────\x1b[0m\n'+line+'\n\x1b[2m────────\x1b[0m\n  ⏵⏵ auto mode on (shift+tab to cycle)';

test('the dim text after an empty prompt is the suggestion; typed text and the box hint are not',()=>{
  expect(promptSuggestion(box('\x1b[39m❯ \x1b[2mдавай, как Fable закончит — пуш и выкат\x1b[0m'))).toBe('давай, как Fable закончит — пуш и выкат');
  expect(promptSuggestion(box('\x1b[39m❯ commit it'))).toBe('');
  expect(promptSuggestion(box('\x1b[39m❯ \x1b[2mTry "refactor <filepath>"\x1b[0m'))).toBe('');
  expect(promptSuggestion(box('\x1b[39m❯ '))).toBe('');
  expect(promptSuggestion(undefined)).toBe('');
});
