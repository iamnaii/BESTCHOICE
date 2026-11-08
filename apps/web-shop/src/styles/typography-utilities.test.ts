import { expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const css = read('src/index.css');

test('reading-block is a Tailwind @utility that keeps controls in the UI face', () => {
  const block = css.match(/@utility reading-block\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(block).toMatch(/font-family:\s*var\(--font-reading\)/);
  expect(block).toMatch(/line-height:\s*1\.75/);
  expect(block).toMatch(/& :is\(button, \[role='button'\], \.btn, a\)\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  expect(css).not.toMatch(/\.font-reading\s*\{/);
});
test('long-form surfaces use reading-block', () => {
  for (const f of [
    'src/components/shop/FaqAccordion.tsx', 'src/pages/InstallmentTermsPage.tsx',
    'src/pages/ReturnsPage.tsx', 'src/pages/ShippingPage.tsx', 'src/pages/AboutPage.tsx',
    'src/pages/landing/InstallmentLopburiPage.tsx', 'src/pages/landing/UsedIphoneLopburiPage.tsx', 'src/pages/ProductDetailPage.tsx',
  ]) expect(read(f), f).toMatch(/\breading-block\b/);
});
test('no 800 weight, tight tracking, Looped or Prompt remains in storefront src', () => {
  const out = execSync("grep -rlE 'font-extrabold|tracking-tight|Looped|(^|[^A-Za-z])Prompt([^A-Za-z]|$)|fonts/prompt' src --include='*.tsx' --include='*.ts' --include='*.css' --exclude='*.test.ts' --exclude='*.test.tsx' || true", { cwd: app }).toString().trim();
  expect(out).toBe('');
});
