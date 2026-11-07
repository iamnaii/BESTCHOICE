import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const css = readFileSync(resolve(__dirname, 'admin-typography.css'), 'utf8');
const docGuard = css.match(/:not\(:where\(([^)]*)\)\)/)![1]; // document exclusions of the first rule in the file

test('tight tracking is neutralised on screen UI only, with the same document exclusions', () => {
  const start = css.indexOf('body:has(.app-shell) {');
  const m = css.match(/& :is\(\.tracking-tight, \.tracking-tighter\):not\(:where\(([^)]*)\)\)\s*\{([^}]*)\}/);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(m).not.toBeNull();
  expect(css.indexOf(m![0])).toBeGreaterThan(start);
  expect(m![1]).toBe(docGuard);
  expect(docGuard).toContain('.template-paper');
  expect(docGuard).toContain('.sticker');
  expect(docGuard).toContain('.tiptap');
  expect(m![2]).toMatch(/letter-spacing:\s*normal/);
});
test('no blanket leading-none override exists', () => {
  expect(css).not.toMatch(/\.leading-none/);
});
