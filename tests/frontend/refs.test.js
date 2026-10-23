const {answerRefs,lastAnswer}=require('../../frontend/refs');

const values=text=>answerRefs(text).map(item=>item.kind+' '+item.value);

test('paths of an answer come whole, a spaced file name up to its extension',()=>{
  const text='Сегодняшние файлы уже перенёс:\n- Отчёт для инвесторов: /Users/denis/dev/padel/reports/2026-10-23/Коэффициенты 1,22 и 1,55 сверка.pdf. '+
    'Рядом лежит report.html, из которого собран PDF.\n- Скриншоты: /Users/denis/dev/padel/screenshots/pricing-2026-10-23/ (файлы max_revenue.png и `plan-fomin.png`).\n'+
    'Если работаю в дереве w1…w6, кладу в папки: в деревьях reports/ и screenshots/ чистятся. See https://example.com/a/b.pdf, e.g. v1.2.';
  expect(values(text)).toEqual([
    'path plan-fomin.png',
    'path /Users/denis/dev/padel/reports/2026-10-23/Коэффициенты 1,22 и 1,55 сверка.pdf',
    'path report.html',
    'path /Users/denis/dev/padel/screenshots/pricing-2026-10-23/',
    'path max_revenue.png',
    'path reports/',
    'path screenshots/',
  ]);
});

test('commands come from shell blocks, "!" code and known programs; prose and comments stay out',()=>{
  const text='Run `! npm run build -- --watch` then:\n```bash\n# install\n$ uv sync\npython3 -m app --port 8000\n```\n'+
    '```json\n{"a": 1}\n```\nAlso `git status` and `someVariable`.';
  expect(values(text)).toEqual(['command uv sync','command python3 -m app --port 8000','command npm run build -- --watch','command git status']);
});

test('the answer is what the agent said after the person last wrote',()=>{
  const turns=[{role:'assistant',text:'old /tmp/a.txt'},{role:'user',text:'go'},{role:'assistant',text:'one'},{role:'assistant',text:'two'}];
  expect(lastAnswer(turns)).toBe('one\n\ntwo');
  expect(lastAnswer([{role:'user',text:'go'}])).toBe('');
  expect(lastAnswer(null)).toBe('');
});
