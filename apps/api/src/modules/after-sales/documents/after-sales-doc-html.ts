import {
  DOCUMENT_WEB_FONT_FACES,
  TRANSACTION_PAGE_CSS,
  transactionDocumentCss,
} from '@installment/shared';
import { AFTER_SALES_LOGO_SVG } from './after-sales-logo';

/**
 * ใบรับฝากเครื่อง / ใบส่งมอบ ของเคสหลังการขาย (PR 4) — ตัวแปลงเอกสาร → HTML แบบ pure
 * (ไม่มี DI ไม่แตะฐานข้อมูล). หน้าตาใช้ชุด CSS เอกสารกลางของระบบ (`transactionDocumentCss`
 * — TH Sarabun PSK 16pt, หัวเขียว) + ส่วนเสริมเฉพาะเอกสารนี้ (`AS_CSS`). ถ้อยคำทั้งหมดมาจาก
 * `after-sales-doc-compose.ts` — ไฟล์นี้ไม่ตัดสินเรื่องข้อความ
 */

export const DOC_NOT_RECEIPT = 'เอกสารนี้ไม่ใช่ใบเสร็จรับเงิน / ใบกำกับภาษี';

export interface DocKv {
  label: string;
  value: string;
  strong?: boolean;
}

export interface DocSection {
  title: string;
  rows: DocKv[];
}

export interface DocCheck {
  text: string;
  checked: boolean;
}

export interface DocPhoto {
  angle: string;
  dataUrl: string | null;
  /** ข้อความในช่องเมื่อไม่มีรูปที่ใช้ได้ — "ไม่ได้ถ่าย" หรือ "เปิดรูปไม่ได้" (ตัดสินที่ compose) */
  emptyText: string;
}

export type DocBlock =
  | { type: 'pair'; left: DocSection; right: DocSection }
  | { type: 'section'; section: DocSection }
  | {
      type: 'table';
      title: string;
      head: string[];
      rows: string[][];
      strongRows?: number[];
      /** index คอลัมน์ที่ห้ามตัดบรรทัด (IMEI/Serial) — shared ตั้ง overflow-wrap:anywhere ทุกเซลล์ */
      nowrapCols?: number[];
    }
  | { type: 'checks'; label: string; items: DocCheck[]; trailing?: DocCheck }
  | { type: 'box'; title: string; text: string }
  | { type: 'photos'; title: string; photos: DocPhoto[] };

export interface DocCompany {
  nameTh: string;
  address: string;
  taxId: string;
  phone: string | null;
}

export interface DocSignature {
  role: string;
  name: string;
  sub: string;
}

export interface AfterSalesDoc {
  title: string;
  kicker: string;
  company: DocCompany;
  meta: DocKv[];
  blocks: DocBlock[];
  /** เงื่อนไขปิดท้ายเอกสาร (ใบรับฝากเท่านั้น) — เรนเดอร์รวมกับ ack/ลายเซ็น/footer เป็นกลุ่มเดียว
   * ห้ามแยกหน้า (ลายเซ็นต้องอยู่หน้าเดียวกับเงื่อนไขที่ลูกค้ารับทราบ) */
  conditions?: { title: string; items: string[] };
  ack: string;
  signatures: [DocSignature, DocSignature];
  footer: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** รับเฉพาะรูปที่ service อ่านจาก storage แล้วแปลงเอง — อย่างอื่นถือว่าไม่มีรูป */
const SAFE_IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

const AS_CSS = `
@page { size: A4; margin: 14mm 15mm; }
.as-block { margin-top: 1.5mm; break-inside: avoid; }
.as-pair { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 6mm; }
.as-muted { color: #52645d; }
.as-checks { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 5mm; margin-top: 1.5mm; }
.as-check { display: inline-flex; align-items: center; gap: 1.5mm; }
.as-box { display: inline-block; width: 3.6mm; height: 3.6mm; border: 0.3mm solid #172b25; border-radius: 0.5mm; text-align: center; font-size: 11pt !important; line-height: 3.4mm !important; font-weight: 700; }
.as-textbox { border: 1px solid #d4dfd9; border-radius: 1.5mm; padding: 1mm 3mm; white-space: pre-wrap; overflow-wrap: anywhere; }
.as-photos { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 2mm; }
.as-photo { position: relative; height: 12mm; border: 1px solid #c9d6cf; border-radius: 1mm; background: #eef3f0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.as-photo img { width: 100%; height: 100%; object-fit: cover; }
.as-photo.as-empty { background: #ffffff; border-style: dashed; }
.as-photo.as-empty, .as-photo.as-empty * { font-size: 12pt !important; color: #52645d; }
.as-photo-label { position: absolute; left: 0; bottom: 0; padding: 0.3mm 1mm; background: rgba(255,255,255,0.85); font-size: 12pt !important; color: #52645d; }
.as-list { margin: 0; padding-left: 5mm; columns: 2; column-gap: 6mm; }
.as-list li { break-inside: avoid; }
.as-list li, .as-list li * { font-size: 14pt !important; }
.as-ack { margin-top: 3mm; }
.as-sig-sub, .as-sig-sub * { font-size: 12pt !important; color: #52645d; }
body :is(td,th).as-nowrap { white-space: nowrap; overflow-wrap: normal; }
.as-closing { break-inside: avoid; padding-top: 1mm; }
.as-closing .bc-doc-signature .sign-space { height: 10mm; }
.as-closing .bc-doc-approval { margin-top: 2mm; }
.as-closing .as-ack { margin-top: 2mm; }
body .bc-doc-header { padding-bottom: 2mm; margin-bottom: 2mm; }
`;

/** ย่อรูปในเบราว์เซอร์ก่อนพิมพ์ — Chromium ฝังไฟล์รูปต้นฉบับทั้งไฟล์ลง PDF ถ้าไม่ย่อ (รูปมือถือ
 * 2–5MB × 6) · renderer รอ `window.__afterSalesThumbs` ก่อนเรียก page.pdf()
 * ทำทีละรูป (promise chain) — ถอดรหัสพร้อมกัน 6 รูปกินหน่วยความจำ Cloud Run (2 GiB) · ปูพื้นขาวก่อนวาด
 * เพราะ JPEG ไม่มีช่องโปร่งใส (PNG/WebP โปร่งใสจะกลายเป็นพื้นดำ) */
const THUMB_SCRIPT = `<script>
window.__afterSalesThumbs = Array.prototype.reduce.call(document.querySelectorAll('img[data-thumb]'), function (chain, img) {
  return chain.then(function () {
    return img.decode().then(function () {
      var w = 360;
      var h = Math.round((img.naturalHeight * w) / img.naturalWidth) || w;
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      img.src = c.toDataURL('image/jpeg', 0.82);
      return img.decode();
    }).catch(function () {
      img.removeAttribute('src');
      img.alt = 'เปิดรูปไม่ได้';
    });
  });
}, Promise.resolve());
</script>`;

function kvRows(rows: DocKv[]): string {
  return rows
    .map(
      (r) =>
        `<span>${escapeHtml(r.label)}</span><span>${
          r.strong ? `<strong>${escapeHtml(r.value)}</strong>` : escapeHtml(r.value)
        }</span>`,
    )
    .join('');
}

function section(s: DocSection): string {
  return `<div><p class="bc-doc-label">${escapeHtml(s.title)}</p><div class="bc-doc-kv">${kvRows(s.rows)}</div></div>`;
}

function check(c: DocCheck, extraClass = ''): string {
  return `<span class="as-check${extraClass}"><span class="as-box">${c.checked ? '✓' : ''}</span>${escapeHtml(c.text)}</span>`;
}

function photo(p: DocPhoto): string {
  const ok = !!p.dataUrl && SAFE_IMAGE_DATA_URL.test(p.dataUrl);
  const inner = ok
    ? `<img data-thumb alt="มุม${escapeHtml(p.angle)}" src="${p.dataUrl}">`
    : `<span>${escapeHtml(p.emptyText)}</span>`;
  return `<div class="as-photo${ok ? '' : ' as-empty'}">${inner}<span class="as-photo-label">${escapeHtml(p.angle)}</span></div>`;
}

function renderBlock(b: DocBlock): string {
  switch (b.type) {
    case 'pair':
      return `<section class="as-block as-pair">${section(b.left)}${section(b.right)}</section>`;
    case 'section':
      return `<section class="as-block">${section(b.section)}</section>`;
    case 'table': {
      const cls = (col: number) => (b.nowrapCols?.includes(col) ? ' class="as-nowrap"' : '');
      const head = b.head.map((h, col) => `<th${cls(col)}>${escapeHtml(h)}</th>`).join('');
      const rows = b.rows
        .map((r, i) => {
          const strong = b.strongRows?.includes(i) ?? false;
          const cells = r
            .map((c, col) =>
              strong
                ? `<td${cls(col)}><strong>${escapeHtml(c)}</strong></td>`
                : `<td${cls(col)}>${escapeHtml(c)}</td>`,
            )
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
    }
    case 'checks':
      return `<div class="as-checks"><span class="as-muted">${escapeHtml(b.label)}</span>${b.items
        .map((i) => check(i))
        .join('')}${b.trailing ? check(b.trailing, ' as-trailing') : ''}</div>`;
    case 'box':
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><div class="as-textbox">${escapeHtml(b.text)}</div></section>`;
    case 'photos':
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><div class="as-photos">${b.photos
        .map(photo)
        .join('')}</div></section>`;
  }
}

function renderConditions(c: { title: string; items: string[] }): string {
  return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(c.title)}</p><ol class="as-list">${c.items
    .map((i) => `<li>${escapeHtml(i)}</li>`)
    .join('')}</ol></section>`;
}

function header(doc: AfterSalesDoc): string {
  const c = doc.company;
  const taxLine = c.taxId
    ? `<p>เลขประจำตัวผู้เสียภาษี ${escapeHtml(c.taxId)}${c.phone ? ` · โทร ${escapeHtml(c.phone)}` : ''}</p>`
    : c.phone
      ? `<p>โทร ${escapeHtml(c.phone)}</p>`
      : '';
  const brand = `<div class="bc-doc-brand"><div>${AFTER_SALES_LOGO_SVG}</div><p class="bc-doc-company">${escapeHtml(c.nameTh)}</p>${
    c.address ? `<p>${escapeHtml(c.address)}</p>` : ''
  }${taxLine}</div>`;
  const meta = doc.meta
    .map((m) => `<span>${escapeHtml(m.label)}</span><span>${escapeHtml(m.value)}</span>`)
    .join('');
  const identity = `<div class="bc-doc-identity"><h1>${escapeHtml(doc.title)}</h1><p class="bc-doc-kicker">${escapeHtml(doc.kicker)}</p><div class="bc-doc-meta">${meta}</div></div>`;
  return `<div class="bc-doc-header">${brand}${identity}</div>`;
}

function signatures(sigs: [DocSignature, DocSignature]): string {
  return `<div class="bc-doc-approval">${sigs
    .map(
      (s) =>
        `<div class="bc-doc-signature"><div class="sign-space"></div><p>${escapeHtml(s.role)} — ( ${escapeHtml(s.name)} )</p><p class="as-sig-sub">${escapeHtml(s.sub)}</p></div>`,
    )
    .join('')}</div>`;
}

export function buildAfterSalesDocHtml(doc: AfterSalesDoc): string {
  const hasPhotos = doc.blocks.some(
    (b) =>
      b.type === 'photos' &&
      b.photos.some((p) => !!p.dataUrl && SAFE_IMAGE_DATA_URL.test(p.dataUrl)),
  );
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(doc.title)}</title>
<style>
${DOCUMENT_WEB_FONT_FACES}
${TRANSACTION_PAGE_CSS}
${transactionDocumentCss('body')}
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${AS_CSS}
</style>
</head>
<body>
${header(doc)}
${doc.blocks.map(renderBlock).join('\n')}
<div class="as-closing">
${doc.conditions ? renderConditions(doc.conditions) : ''}
<p class="as-ack">${escapeHtml(doc.ack)}</p>
${signatures(doc.signatures)}
<div class="bc-doc-footer"><span>${escapeHtml(doc.footer)}</span><span>${DOC_NOT_RECEIPT}</span></div>
</div>
${hasPhotos ? THUMB_SCRIPT : ''}
</body>
</html>`;
}
