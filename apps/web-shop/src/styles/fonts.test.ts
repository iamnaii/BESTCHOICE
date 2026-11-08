import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const fontsCss = read('src/styles/fonts.css');
const tokensCss = read('src/styles/tokens.css');
const indexCss = read('src/index.css');
const indexHtml = read('index.html');

const faces = (css: string) =>
  css.split('@font-face').slice(1).map((b) => {
    const family = b.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1];
    const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)?.[1];
    return `${family}|${weight}|${url}`;
  });
const SUBSETS = ['thai', 'latin', 'latin-ext'];
const expectFaces = (family: string, pkg: string, weights: string[]) =>
  weights.flatMap((w) => SUBSETS.map((s) => `${family}|${w}|/fonts/${pkg}/${pkg}-${s}-${w}-normal.woff2`));

describe('storefront fonts', () => {
  test('sans token is Noto Sans Thai with system fallback', () => {
    expect(tokensCss).toMatch(/--font-sans:\s*'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;/);
    expect(tokensCss).toMatch(/--font-head:\s*var\(--font-sans\);/);
  });
  test('reading token is Sarabun falling back to Noto Sans Thai', () => {
    expect(tokensCss).toMatch(/--font-reading:\s*'Sarabun', 'Noto Sans Thai', system-ui, sans-serif;/);
  });
  test('declares exactly Noto Sans Thai 400–700 and Sarabun 400/700 per subset', () => {
    const expected = [
      ...expectFaces('Noto Sans Thai', 'noto-sans-thai', ['400', '500', '600', '700']),
      ...expectFaces('Sarabun', 'sarabun', ['400', '700']),
    ];
    expect(faces(fontsCss).sort()).toEqual(expected.sort());
  });
  test('every face swaps, has a unicode-range and an existing file', () => {
    for (const b of fontsCss.split('@font-face').slice(1)) {
      expect(b).toMatch(/font-display:\s*swap/);
      expect(b).toMatch(/unicode-range:/);
      const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)![1];
      expect(existsSync(resolve(app, 'public', url.slice(1)))).toBe(true);
    }
  });
  test('each font folder ships OFL.txt and a SOURCE.json matching its files', () => {
    for (const dir of ['noto-sans-thai', 'sarabun']) {
      const base = resolve(app, 'public/fonts', dir);
      expect(existsSync(resolve(base, 'OFL.txt'))).toBe(true);
      const source = JSON.parse(readFileSync(resolve(base, 'SOURCE.json'), 'utf8'));
      expect(source.version).toBe('5.3.0');
      const woff = readdirSync(base).filter((f) => f.endsWith('.woff2')).sort();
      expect(source.files.map((f: { file: string }) => f.file).sort()).toEqual(woff);
      for (const f of source.files) {
        expect(createHash('sha256').update(readFileSync(resolve(base, f.file))).digest('hex')).toBe(f.sha256);
      }
    }
  });
  test('Looped, Prompt and Google Fonts are gone', () => {
    expect(fontsCss + tokensCss + indexCss + indexHtml).not.toMatch(/Looped|['"]Prompt['"]|\/fonts\/prompt|googleapis|gstatic/);
    expect(existsSync(resolve(app, 'public/fonts/noto-sans-thai-looped'))).toBe(false);
    expect(existsSync(resolve(app, 'public/fonts/prompt'))).toBe(false);
  });
  test('index.html preloads only the Thai 400 face', () => {
    const fontPreloads = [...indexHtml.matchAll(/<link\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag))
      .map((tag) => tag.match(/href="([^"]+)"/)![1]);
    expect(fontPreloads).toEqual(['/fonts/noto-sans-thai/noto-sans-thai-thai-400-normal.woff2']);
  });
});
