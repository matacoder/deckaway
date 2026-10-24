const {promptSuggestion}=require('../../frontend/suggest');

const box=line=>'● Done.\n\x1b[2m────────\x1b[0m\n'+line+'\n\x1b[2m────────\x1b[0m\n  ⏵⏵ auto mode on (shift+tab to cycle)';

test('the dim text after an empty prompt is the suggestion; typed text and the box hint are not',()=>{
  expect(promptSuggestion(box('\x1b[39m❯ \x1b[2mдавай, как Fable закончит — пуш и выкат\x1b[0m'))).toBe('давай, как Fable закончит — пуш и выкат');
  expect(promptSuggestion(box('\x1b[39m❯ commit it'))).toBe('');
  expect(promptSuggestion(box('\x1b[39m❯ \x1b[2mTry "refactor <filepath>"\x1b[0m'))).toBe('');
  expect(promptSuggestion(box('\x1b[39m❯ '))).toBe('');
  expect(promptSuggestion(undefined)).toBe('');
});

test('a focused box with its cursor over the first letter and other colour codes still shows the suggestion',()=>{
  expect(promptSuggestion(box('\x1b[38;5;246m❯\u00a0\x1b[39m\x1b[7mо\x1b[27m\x1b[2mбнови M5 до 1.63.0\x1b[22m\x1b[39m   '))).toBe('обнови M5 до 1.63.0');
  expect(promptSuggestion(box('\x1b[39m❯\u00a0\x1b[2;38;5;246mpush\x1b[0m \x1b[2mit\x1b[0m'))).toBe('push it');
  expect(promptSuggestion(box('\x1b[39m❯\u00a0\x1b[7mc\x1b[27mommit'))).toBe('');
});
