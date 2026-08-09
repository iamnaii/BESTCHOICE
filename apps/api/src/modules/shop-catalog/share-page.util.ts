/**
 * หน้า "แชร์" ของสินค้า — HTML สั้น ๆ ที่ API เสิร์ฟเองเพื่อให้ LINE/Facebook
 * ดึง Open Graph ได้ (SPA ของ web-shop เป็น client-render ล้วน crawler จึงไม่เห็น
 * meta ที่ usePageMeta ใส่ตอน runtime)
 *
 * ข้อควรระวังที่ทำให้ไฟล์นี้มีอยู่:
 * - API ตัวนี้ปิด CSP ทั้งระบบ (main.ts:97 contentSecurityPolicy:false — เหตุผล
 *   "API serves no HTML" ที่คอมเมนต์ :85-87) → ทุกค่าที่
 *   inject ต้อง escape ที่นี่ ไม่พึ่ง header
 * - ชื่อ/รายละเอียดสินค้าเป็นข้อความที่แอดมินพิมพ์เอง = untrusted stored input
 */

const SITE_NAME = 'BESTCHOICE';
const TITLE_SUFFIX = 'BESTCHOICE ลพบุรี';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** JSON ที่ฝังใน <script> — กัน `</script>` breakout ด้วยการ escape `<` */
function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildShareDescription(input: {
  title: string;
  condition: 'NEW' | 'USED';
  conditionGrade?: string;
  batteryHealth?: number;
  shopWarrantyDays?: number;
  price: number | null;
}): string {
  const parts: string[] = [input.title];
  parts.push(
    input.condition === 'NEW'
      ? 'เครื่องใหม่ มือ 1'
      : input.conditionGrade
        ? `มือสอง เกรด ${input.conditionGrade}`
        : 'มือสอง',
  );
  if (input.batteryHealth != null) parts.push(`แบต ${input.batteryHealth}%`);
  if (input.shopWarrantyDays != null) parts.push(`ประกันร้าน ${input.shopWarrantyDays} วัน`);
  parts.push(
    input.price != null && input.price > 0
      ? `฿${input.price.toLocaleString('en-US')}`
      : 'สอบถามราคา',
  );
  return `${parts.join(' · ')} — ผ่อนได้บัตรประชาชนใบเดียว ร้าน ${TITLE_SUFFIX}`;
}

export interface SharePageInput {
  title: string;
  description: string;
  brand: string;
  condition: 'NEW' | 'USED';
  price: number | null;
  imageUrl?: string;
  inStock: boolean;
  /** URL ของหน้าจริงบน SPA — ทั้ง canonical, og:url และปลายทาง redirect */
  canonicalUrl: string;
  nonce: string;
}

export function buildSharePage(input: SharePageInput): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const url = escapeHtml(input.canonicalUrl);
  const nonce = escapeHtml(input.nonce);
  const image = input.imageUrl ? escapeHtml(input.imageUrl) : null;
  const hasPrice = input.price != null && input.price > 0;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.title,
    description: input.description,
    brand: { '@type': 'Brand', name: input.brand },
    itemCondition:
      input.condition === 'NEW'
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
  };
  if (input.imageUrl) jsonLd.image = [input.imageUrl];
  if (hasPrice) {
    jsonLd.offers = {
      '@type': 'Offer',
      url: input.canonicalUrl,
      priceCurrency: 'THB',
      price: String(input.price),
      availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    };
  }

  const lines: string[] = [
    '<!doctype html>',
    '<html lang="th">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title} | ${TITLE_SUFFIX}</title>`,
    `<link rel="canonical" href="${url}">`,
    `<meta name="description" content="${description}">`,
    '<meta property="og:type" content="product">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    '<meta property="og:locale" content="th_TH">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
  ];
  if (image) lines.push(`<meta property="og:image" content="${image}">`);
  if (hasPrice) {
    lines.push(`<meta property="product:price:amount" content="${String(input.price)}">`);
    lines.push('<meta property="product:price:currency" content="THB">');
  }
  // FF-1 (B5 final review): ฝาแฝดฝั่ง crawler ของหน้า sold-out (T12b) — JSON-LD บอก
  // OutOfStock อยู่แล้ว แต่ OG scraper ของ FB/LINE อ่าน product:availability เป็นหลัก
  lines.push(
    `<meta property="product:availability" content="${input.inStock ? 'in stock' : 'out of stock'}">`,
  );
  lines.push(
    image
      ? '<meta name="twitter:card" content="summary_large_image">'
      : '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  );
  if (image) lines.push(`<meta name="twitter:image" content="${image}">`);
  lines.push(
    `<meta http-equiv="refresh" content="0;url=${url}">`,
    `<script nonce="${nonce}">window.location.replace(${escapeJsonForScript(input.canonicalUrl)});</script>`,
    `<script type="application/ld+json" nonce="${nonce}">${escapeJsonForScript(jsonLd)}</script>`,
    '</head>',
    '<body>',
    `<p>กำลังพาไปที่หน้าสินค้า… <a href="${url}">${title}</a></p>`,
    '</body>',
    '</html>',
  );
  return lines.join('\n');
}
