const {sourceOf,cleanCopied}=require('../../frontend/copytext');

const answer='Run this on the Mac:\n\n```bash\nsudo sh -c \'grep -h -e ^PANEL_USER= -e ^PANEL_PASSWORD= /home/*/.config/cc-panel/env\'\n```\n\nThen open the panel and sign in with what it printed.';

test('a command the agent wrapped on a narrow screen is copied as it wrote it',()=>{
  const screen="  sudo sh -c 'grep -h -e ^PANEL_USER= -e\n  ^PANEL_PASSWORD= /home/*/.config/cc-pan\n  el/env'   ";
  expect(cleanCopied(screen,answer)).toBe("sudo sh -c 'grep -h -e ^PANEL_USER= -e ^PANEL_PASSWORD= /home/*/.config/cc-panel/env'");
});

test('wrapped prose comes back as one sentence; screen marks are no part of it',()=>{
  expect(sourceOf('⏺ Then open the panel and sign in\n  with what it printed.',answer)).toBe('Then open the panel and sign in with what it printed.');
});

test('without the source, or when it is not there, only the padding at line ends goes',()=>{
  const tool='  ⎿  1705-  text that was cut in the mid   \n     dle of a word.  ';
  expect(cleanCopied(tool,answer)).toBe('  ⎿  1705-  text that was cut in the mid\n     dle of a word.');
  expect(cleanCopied('one line with padding   ',answer)).toBe('one line with padding');
  expect(cleanCopied('a\nb','')).toBe('a\nb');
});

test('a fragment found in two different spellings is not guessed',()=>{
  expect(sourceOf('sign\nin','sign in here; then sign in there')).toBe('sign in');  // The same text either way.
  expect(sourceOf('sign\nin','sign in here; then sign  in there')).toBeNull();
});
