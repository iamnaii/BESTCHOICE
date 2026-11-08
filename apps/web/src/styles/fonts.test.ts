import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const app = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(app, p), 'utf8');
const indexCss = read('src/index.css');
const fontsCss = read('src/styles/fonts.css');
const docFontsCss = read('src/styles/document-ui-fonts.css');
const indexHtml = read('index.html');
const staticPages = read('public/privacy.html') + read('public/terms.html');

const faces = (css: string) =>
  css.split('@font-face').slice(1).map((b) => {
    const family = b.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1];
    const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)?.[1];
    return `${family}|${weight}|${url}`;
  });
const expectFaces = (family: string, pkg: string, weights: string[], subsets: string[]) =>
  weights.flatMap((w) => subsets.map((s) => `${family}|${w}|/fonts/${pkg}/${pkg}-${s}-${w}-normal.woff2`));
const W5 = ['300', '400', '500', '600', '700'];

describe('admin app fonts', () => {
  test('no Google Fonts, Looped or Prompt remains in the app bundle and static pages', () => {
    expect(indexCss + fontsCss + docFontsCss + indexHtml + staticPages).not.toMatch(/googleapis|gstatic|Looped|['"]Prompt['"]|\/fonts\/prompt/);
    expect(existsSync(resolve(app, 'public/fonts/noto-sans-thai-looped'))).toBe(false);
  });
  test('public fonts.css copy equals src/styles/fonts.css', () => {
    expect(read('public/fonts/noto-sans-thai/fonts.css')).toBe(fontsCss);
  });
  test('index.css imports the UI faces then the document faces', () => {
    expect(indexCss).toMatch(/@import '\.\/styles\/fonts\.css';\s*\n@import '\.\/styles\/document-ui-fonts\.css';/);
  });
  test('UI face is Noto Sans Thai 300–700 (300 keeps LIFF light amounts)', () => {
    expect(indexCss).toMatch(/--font-sans:\s*'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;/);
    expect(faces(fontsCss).sort()).toEqual(expectFaces('Noto Sans Thai', 'noto-sans-thai', W5, ['thai', 'latin', 'latin-ext']).sort());
  });
  test('document faces are unchanged (owner rule 2026-11-08)', () => {
    expect(indexCss).toMatch(/--font-document-ui:\s*'Inter', 'IBM Plex Sans Thai', system-ui, -apple-system, sans-serif;/);
    expect(indexCss).toMatch(/--font-sarabun:\s*'TH Sarabun PSK', sans-serif;/);
    expect(indexCss).toMatch(/--font-mono:\s*'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;/);
    expect(indexCss).toMatch(/font-family:\s*'TH Sarabun PSK';\s*src:\s*url\('\/fonts\/THSarabunPSK-Regular\.ttf'\)/);
    expect(indexCss).toMatch(/font-family:\s*'TH Sarabun PSK';\s*src:\s*url\('\/fonts\/THSarabunPSK-Bold\.ttf'\)/);
    expect(indexCss).toMatch(/\.sticker, \.print-stickers, \.tiptap\) \{\s*--font-sans: var\(--font-document-ui\);\s*font-family: var\(--font-document-ui\);/);
    expect(indexCss).toMatch(/\.tiptap\.ProseMirror\s*\{[^}]*font-family:\s*'IBM Plex Sans Thai', sans-serif/);
    expect(indexHtml).toMatch(/href="\/fonts\/THSarabunPSK-Regular\.ttf"/);
    expect(indexHtml).toMatch(/href="\/fonts\/THSarabunPSK-Bold\.ttf"/);
  });
  test('document faces are self-hosted at the weights the Google import requested', () => {
    expect(faces(docFontsCss).sort()).toEqual([
      // spec §5: Google serves Inter as ONE variable woff2 per subset (static @fontsource files rasterise differently at 500/700)
      ...W5.flatMap((w) => ['latin', 'latin-ext'].map((s) => `Inter|${w}|/fonts/inter/inter-${s}-variable.woff2`)),
      ...expectFaces('IBM Plex Sans Thai', 'ibm-plex-sans-thai', W5, ['thai', 'latin', 'latin-ext']),
      ...expectFaces('IBM Plex Mono', 'ibm-plex-mono', ['300', '400', '500', '600'], ['latin', 'latin-ext']),
    ].sort());
  });
  test('every face swaps, has a unicode-range and an existing file', () => {
    for (const b of (fontsCss + docFontsCss).split('@font-face').slice(1)) {
      expect(b).toMatch(/font-display:\s*swap/);
      expect(b).toMatch(/unicode-range:/);
      const url = b.match(/url\((\/fonts\/[^)]+\.woff2)\)/)![1];
      expect(existsSync(resolve(app, 'public', url.slice(1))), url).toBe(true);
    }
  });
  test('each font folder ships OFL.txt and a SOURCE.json matching its files', () => {
    for (const dir of ['noto-sans-thai', 'inter', 'ibm-plex-sans-thai', 'ibm-plex-mono']) {
      const base = resolve(app, 'public/fonts', dir);
      expect(existsSync(resolve(base, 'OFL.txt')), dir).toBe(true);
      const source = JSON.parse(readFileSync(resolve(base, 'SOURCE.json'), 'utf8'));
      const woff = readdirSync(base).filter((f) => f.endsWith('.woff2')).sort();
      expect(source.files.map((f: { file: string }) => f.file).sort()).toEqual(woff);
      for (const f of source.files) {
        expect(createHash('sha256').update(readFileSync(resolve(base, f.file))).digest('hex')).toBe(f.sha256);
      }
    }
  });
  test('index.html preloads the Noto Thai 400 face and no Looped file', () => {
    expect(indexHtml).toMatch(/href="\/fonts\/noto-sans-thai\/noto-sans-thai-thai-400-normal\.woff2"[^>]*as="font"/);
  });
});
