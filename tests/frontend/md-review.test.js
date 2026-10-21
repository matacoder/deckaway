const {reviewPrompt}=require('../../frontend/review');

test('a review quotes each commented range of the file, in file order',()=>{
  const lines=['# Plan','','- shrink the pool','- alert when the base is busy for more than '+'x'.repeat(200)];
  const text=reviewPrompt('/home/me/plans/db.md',[{from:4,to:4,text:'  Which bot?  '},{from:1,to:3,text:'Fine'}],lines);
  expect(text.startsWith('Review of /home/me/plans/db.md: my comments on its lines as the file is now.')).toBe(true);
  expect(text.indexOf('Lines 1-3: "# Plan - shrink the pool"\nFine')).toBeLessThan(text.indexOf('Line 4: "- alert'));
  expect(text).toContain('…"\nWhich bot?');
  expect(text.match(/Line 4: "([^"]*)"/)[1].length).toBe(160);
});
