import * as fs from 'fs';
import * as path from 'path';

/**
 * C5 fix — embedded Thai fonts for PDF generation.
 *
 * Cloud Run's `node:20-slim` base image and the puppeteer-bundled Chromium
 * do NOT ship Thai fonts. Without these embedded @font-face blocks, every
 * production PDF renders Thai text as tofu boxes (□□□).
 *
 * Fonts are loaded ONCE at module load (synchronous fs.readFile) and
 * cached forever — no per-request disk I/O.
 *
 * Both fonts are Apache 2.0 / OFL and bundled with the API image via the
 * nest-cli.json `assets` glob (`assets/fonts/*.{ttf,otf,woff2}`).
 *
 * - NotoSansThai-VF.ttf  — Google Apache 2.0 variable font, weights 100-900
 * - Sriracha-Regular.ttf — SIL OFL 1.1 cursive signature font
 */

function loadFont(filename: string): string {
  // dist/src/assets/fonts in production (nest-cli copies the assets folder),
  // apps/api/src/assets/fonts at dev. __dirname resolves to whichever is live.
  const fontPath = path.join(__dirname, filename);
  if (!fs.existsSync(fontPath)) {
    // Defensive: log + return empty data URL rather than crash. Receipts
    // will fall back to Chromium's system font fallback (tofu on Thai, but
    // PDF still renders).
    // eslint-disable-next-line no-console
    console.error(`[embedded-fonts] Missing font asset: ${fontPath}`);
    return '';
  }
  return fs.readFileSync(fontPath).toString('base64');
}

const NOTO_SANS_THAI_VF_B64 = loadFont('NotoSansThai-VF.ttf');
const SRIRACHA_B64 = loadFont('Sriracha-Regular.ttf');

/**
 * Inline @font-face declarations — embed directly inside a <style> block.
 * Both faces ship as a single variable TTF (Noto) + a static TTF (Sriracha).
 * Using `font: 'truetype-variations'` lets the same file serve weight 400
 * and weight 700 without two downloads.
 */
export const EMBEDDED_FONT_FACES = `
@font-face {
  font-family: 'Noto Sans Thai';
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(data:font/ttf;base64,${NOTO_SANS_THAI_VF_B64}) format('truetype-variations');
}
@font-face {
  font-family: 'Sriracha';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(data:font/ttf;base64,${SRIRACHA_B64}) format('truetype');
}
`;
