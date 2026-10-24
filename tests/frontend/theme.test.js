const {resolvedTheme}=require('../../frontend/theme');

test('dark is the default and "system" follows the device',()=>{
  expect(resolvedTheme('light',false)).toBe('light');
  expect(resolvedTheme('dark',true)).toBe('dark');
  expect(resolvedTheme('system',true)).toBe('light');
  expect(resolvedTheme('system',false)).toBe('dark');
  expect(resolvedTheme(null,true)).toBe('dark');
});
