import * as fs from 'fs';
import * as path from 'path';
import type { jsPDF } from 'jspdf';

/**
 * Thai font registration helper for jsPDF (e-Tax PDF — ม.86/4 compliant).
 *
 * Reuses the Noto Sans Thai variable font bundled by PR #843 at
 * `apps/api/src/assets/fonts/NotoSansThai-VF.ttf` (Apache 2.0). The font
 * file is copied into `dist/src/assets/fonts/` at build time via the
 * `nest-cli.json` `assets` glob, so the same loader works in both dev
 * and the Cloud Run production image (`node:20-slim`, which ships with
 * NO Thai system fonts).
 *
 * Cached at module scope — the ~213 KB base64 string is built ONCE per
 * worker process. Every subsequent PDF reuses the cached buffer.
 */

const FONT_FILE = 'NotoSansThai-VF.ttf';
export const THAI_FONT_FAMILY = 'NotoSansThai';

// Candidate locations covering dev (src/) + prod (dist/src/) + cwd-relative.
// First match wins.
const FONT_DIR_CANDIDATES = [
  // Dev: apps/api/src/modules/e-tax/ → ../../assets/fonts/
  path.join(__dirname, '..', '..', 'assets', 'fonts'),
  // Prod (nest build): dist/src/modules/e-tax/ → ../../assets/fonts/
  path.join(__dirname, '..', '..', 'assets', 'fonts'),
  // Cwd-relative fallbacks
  path.join(process.cwd(), 'src', 'assets', 'fonts'),
  path.join(process.cwd(), 'apps', 'api', 'src', 'assets', 'fonts'),
  path.join(process.cwd(), 'dist', 'src', 'assets', 'fonts'),
];

let cachedBase64: string | null = null;

function loadFontBase64(): string {
  if (cachedBase64 !== null) return cachedBase64;

  const dir = FONT_DIR_CANDIDATES.find((d) => fs.existsSync(path.join(d, FONT_FILE)));
  if (!dir) {
    // Defensive: emit empty string + log. jsPDF will fall back to its
    // default font (Helvetica) for Thai chars → tofu boxes, but PDF
    // still renders. Catches missing-asset deployments without crashing.
    // eslint-disable-next-line no-console
    console.error(
      `[e-tax/thai-font] Missing font asset ${FONT_FILE} in any of: ${FONT_DIR_CANDIDATES.join(', ')}`,
    );
    cachedBase64 = '';
    return cachedBase64;
  }

  cachedBase64 = fs.readFileSync(path.join(dir, FONT_FILE)).toString('base64');
  return cachedBase64;
}

/**
 * Register the Noto Sans Thai font on a fresh jsPDF instance and select it
 * as the active font. After this call, `doc.text('ใบกำกับภาษี', ...)` will
 * render real Thai glyphs instead of tofu boxes.
 *
 * Idempotent at the jsPDF level — `addFileToVFS` overwrites; safe to call
 * once per doc. The base64 buffer is cached at module scope so repeat
 * registrations across requests are O(1) memory + zero disk I/O.
 *
 * Returns the font family name for use with `doc.setFont(...)`.
 */
export function registerThaiFont(doc: jsPDF): string {
  const base64 = loadFontBase64();
  if (!base64) {
    // Font missing — skip registration. setFont(THAI_FONT_FAMILY) would
    // throw `jsPDF: Font does not exist`, so callers must check the
    // return-vs-default themselves if they want to know. For now we
    // return the default Helvetica family so PDF still renders (tofu).
    return 'helvetica';
  }

  // jsPDF font registration (3-step canonical pattern):
  //   1. addFileToVFS — register the raw TTF bytes under a virtual filename
  //   2. addFont — bind that filename to a (family, style) pair
  //   3. setFont — select for subsequent text() calls
  doc.addFileToVFS(`${FONT_FILE}`, base64);
  doc.addFont(FONT_FILE, THAI_FONT_FAMILY, 'normal');
  // Variable font serves bold weight from the same file — register again
  // under style 'bold' so doc.setFont(..., 'bold') works.
  doc.addFont(FONT_FILE, THAI_FONT_FAMILY, 'bold');
  doc.setFont(THAI_FONT_FAMILY, 'normal');
  return THAI_FONT_FAMILY;
}
