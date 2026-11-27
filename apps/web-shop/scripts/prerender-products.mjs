/**
 * หน้ารายละเอียดสินค้าที่ขายอยู่ — snapshot ต่อเครื่อง + sitemap.xml (เจ้าของ 2026-11-27 ส่วน B6)
 *
 * ทำไม: /products/:id ไม่เคย prerender ⇒ HTML แรกเป็น shell เปล่า (title/meta ของหน้าแรก)
 * ลิงก์ที่แชร์ในไลน์/เฟซบุ๊ก และ crawler ที่ไม่รัน JS จึงเห็นชื่อร้านแทนชื่อรุ่น
 *
 * กติกา:
 * - รายการเครื่องมาจาก GET /api/shop/products (ชุดเดียวกับการ์ดหน้ารวม) ณ ตอน deploy —
 *   เครื่องที่ขายออกหลัง deploy ยังมีไฟล์ค้างจนรอบถัดไป แต่แอปเรนเดอร์ใหม่จาก API สดทุกครั้ง
 *   (main.tsx ใช้ createRoot ไม่ใช่ hydrate) จึงเห็นสถานะจริงเสมอ
 * - หน้าสินค้าเป็น best effort: ดึงรายการ/เก็บหน้าไม่สำเร็จ = เตือนแล้วข้าม ห้ามทำ deploy แดง
 *   (หน้า marketing 13 หน้ายังมีด่านเดิมครบ)
 * - sitemap.xml ใน dist = ไฟล์ public เดิม + URL ของเครื่องที่ snapshot สำเร็จเท่านั้น
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** เพดานกันรายการบวมจน deploy ช้า — วันนี้มีราว 30–40 เครื่อง */
export const MAX_PRODUCT_ROUTES = 300;
const PAGE_LIMIT = 100;

/** id ของการ์ดหน้ารวม (ตัวเดียวกับลิงก์ `/products/:id` บนการ์ด) เรียงเข้าใหม่ก่อน */
export async function listInStockProductIds(apiBase) {
  const ids = [];
  for (let page = 1; ids.length < MAX_PRODUCT_ROUTES; page += 1) {
    const res = await fetch(
      `${apiBase}/api/shop/products?sort=newest&limit=${PAGE_LIMIT}&page=${page}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new Error(`GET /api/shop/products page ${page} → ${res.status}`);
    const body = await res.json();
    // API ห่อด้วย { success, data } — เผื่อรุ่นที่ไม่ห่อด้วย
    const payload = body && typeof body === 'object' && 'success' in body ? body.data : body;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const row of rows) {
      if (typeof row?.id === 'string' && UUID.test(row.id) && !ids.includes(row.id)) {
        ids.push(row.id);
      }
    }
    const total = Number(payload?.total ?? 0);
    if (rows.length === 0 || page * PAGE_LIMIT >= total) break;
  }
  return ids.slice(0, MAX_PRODUCT_ROUTES);
}

/** รูปสินค้าบนโดเมนจริง — ตอบด้วย PNG 1×1 ให้ <img> ขึ้นสถานะโหลดแล้ว โดย src ใน HTML ยังเป็น URL จริง */
export function isProductPhotoRequest(url, apiBase) {
  return (
    url.origin === new URL(apiBase).origin &&
    /^\/api\/shop\/products\/[^/]+\/photos\//.test(url.pathname)
  );
}
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** แทรก <url> ของเครื่องก่อน </urlset> — static 13 หน้าคงเดิมทุกตัวอักษร */
export function sitemapWithProducts(staticXml, ids, isoDate) {
  if (ids.length === 0) return staticXml;
  const eol = staticXml.includes('\r\n') ? '\r\n' : '\n';
  const entries = ids
    .map((id) =>
      [
        '  <url>',
        `    <loc>https://www.bestchoicephone.com/products/${id}</loc>`,
        `    <lastmod>${isoDate}</lastmod>`,
        '    <changefreq>daily</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ].join(eol),
    )
    .join(eol);
  const close = staticXml.lastIndexOf('</urlset>');
  if (close < 0) throw new Error('sitemap.xml ไม่มี </urlset>');
  return `${staticXml.slice(0, close)}${entries}${eol}${staticXml.slice(close)}`;
}
