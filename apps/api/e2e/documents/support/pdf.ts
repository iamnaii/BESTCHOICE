/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * PDF assertions for the documents harness — pdfjs (legacy build, Node) so the
 * evidence is the real bytes Chromium produced: page boxes, embedded font names,
 * text sizes in points and text positions per page.
 */
// pdfjs probes for `canvas` at require time and logs "Warning: Cannot polyfill DOMMatrix";
// text extraction never needs it, so keep that one line out of every Jest run.
const pdfjs = (() => {
  const log = console.log;
  console.log = (...args: unknown[]) => { if (!String(args[0]).startsWith('Warning: Cannot polyfill')) log(...args); };
  try { return require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = log; }
})();

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  /** Font size in PDF points (1/72 in). */
  size: number;
  /** Embedded font name without the subset prefix, e.g. THSarabunPSK-Regular. */
  font: string;
}

export interface PdfPage {
  index: number;
  widthPt: number;
  heightPt: number;
  items: PdfTextItem[];
  /** Text grouped by baseline, top of page first. */
  lines: string[];
  text: string;
}

export interface ParsedPdf {
  pageCount: number;
  pages: PdfPage[];
  fonts: string[];
}

const A4 = { width: 595.28, height: 841.89 };

export async function parsePdf(bytes: Buffer): Promise<ParsedPdf> {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Not a PDF: missing %PDF- header');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  const fonts = new Set<string>();
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const [x0, y0, x1, y1] = page.view as number[];
      await page.getOperatorList(); // populates commonObjs with the embedded fonts
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items as any[]) {
        if (typeof raw.str !== 'string' || !raw.fontName) continue;
        let font = 'unknown';
        try {
          const loaded = page.commonObjs.get(raw.fontName);
          font = String(loaded?.name ?? 'unknown').replace(/^[A-Z]{6}\+/, '');
        } catch {
          font = 'unknown';
        }
        if (raw.str.trim()) fonts.add(font);
        items.push({ str: raw.str, x: raw.transform[4], y: raw.transform[5], size: Math.hypot(raw.transform[0], raw.transform[1]), font });
      }
      const lines = groupLines(items);
      pages.push({ index, widthPt: x1 - x0, heightPt: y1 - y0, items, lines, text: lines.join('\n') });
    }
  } finally {
    await doc.destroy();
  }
  return { pageCount: pages.length, pages, fonts: [...fonts].sort() };
}

function groupLines(items: PdfTextItem[]): string[] {
  const rows = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    if (!item.str) continue;
    const key = Math.round(item.y * 2) / 2;
    const row = rows.get(key) ?? [];
    row.push(item);
    rows.set(key, row);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.str).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Chromium reports A4 as 595.92 × 841.92 pt (rounded mm), so allow ±1 pt. Safe for `pages.every(isA4)`. */
export function isA4(page: PdfPage): boolean {
  return isPageSize(page, A4.width, A4.height, 1);
}

/** A4 turned sideways (asset register and other landscape documents). */
export function isA4Landscape(page: PdfPage): boolean {
  return isPageSize(page, A4.height, A4.width, 1);
}

export function isPageSize(page: PdfPage, widthPt: number, heightPt: number, tolerancePt = 1): boolean {
  return Math.abs(page.widthPt - widthPt) <= tolerancePt && Math.abs(page.heightPt - heightPt) <= tolerancePt;
}

/**
 * Text comparison key for Chromium PDFs set in TH Sarabun PSK: the embedded
 * font maps its contextual mark glyphs (tone marks / thanthakhat shifted over a
 * vowel or a tall consonant) to the legacy Thai private-use code points
 * U+F700–U+F71A instead of the Unicode marks, and SARA AM comes back decomposed
 * (ำ → ํา). Comparing with all Thai marks, those PUA glyphs and whitespace
 * removed keeps anchors like "ผู้ให้ความยินยอม" reliable without weakening what
 * is asserted (page, size, font, order).
 */
export function foldThai(text: string): string {
  return text
    .replace(/ำ/g, 'า')
    .replace(/[ัิ-ฺ็-๎-]/g, '')
    .replace(/\s+/g, '');
}

/** 1-based page index of the first page whose text contains `needle`, or 0. */
export function pageContaining(pdf: ParsedPdf, needle: string): number {
  const target = foldThai(needle);
  return pdf.pages.find((page) => foldThai(page.text).includes(target))?.index ?? 0;
}

/** Distinct text sizes (rounded to 0.1 pt) with glyph counts, largest count first. */
export function textSizes(pdf: ParsedPdf, filter: (item: PdfTextItem) => boolean = () => true): Array<{ size: number; count: number }> {
  const counts = new Map<number, number>();
  for (const page of pdf.pages) for (const item of page.items) {
    if (!item.str.trim() || !filter(item)) continue;
    const size = Math.round(item.size * 10) / 10;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  return [...counts.entries()].map(([size, count]) => ({ size, count })).sort((a, b) => b.count - a.count);
}

/** Sizes used by the glyphs of a specific line of text (matched without whitespace). */
export function sizesOfText(pdf: ParsedPdf, needle: string): number[] {
  const target = foldThai(needle);
  const sizes = new Set<number>();
  for (const page of pdf.pages) {
    const rows = new Map<number, PdfTextItem[]>();
    for (const item of page.items) {
      const key = Math.round(item.y * 2) / 2;
      rows.set(key, [...(rows.get(key) ?? []), item]);
    }
    for (const row of rows.values()) {
      const sorted = row.sort((a, b) => a.x - b.x);
      if (foldThai(sorted.map((item) => item.str).join('')).includes(target)) {
        for (const item of sorted) if (item.str.trim()) sizes.add(Math.round(item.size * 10) / 10);
      }
    }
  }
  return [...sizes].sort((a, b) => a - b);
}
