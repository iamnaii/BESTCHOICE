/**
 * B3 §5 — เก็บ "รูป+ลิงก์สินค้า" จากผลลัพธ์ tool แบบ deterministic
 *
 * เป็น util ไม่ใช่ private method เพราะบอท 2 ตัวอยู่คนละ pipeline
 * (SalesBotService ผ่าน MessageRouter / FinanceAiService ไม่ผ่าน) แต่ต้องใช้
 * "กติกาการแนบ" ชุดเดียวกัน
 *
 * ⚠️ ห้ามอ่าน productId/URL จากข้อความที่โมเดลเขียน — โมเดลแต่ง id ได้ และ
 * เราจะกลายเป็นคนส่งรูปผิดเครื่องให้ลูกค้า
 */

export interface BotAttachment {
  productId: string;
  imageUrl?: string;
  webUrl?: string;
  /** ป้ายรุ่นสำหรับจดลงประวัติแชท ("[รูป iPhone 12 64GB เกรด A]") — ให้บอทจำได้ว่าส่งรูปอะไรไป */
  label?: string;
}

/** ส่งได้มากสุด 2 ใบต่อ 1 คำตอบ — LINE reply รับ 5 ข้อความ/ครั้ง เหลือที่ให้ text + เผื่อ */
export const MAX_BOT_ATTACHMENTS = 2;

/** id ของรูปตารางผ่อน/แผนที่ร้าน (send_rate_card) ในช่องแนบ = `card:<key>` — ไม่ใช่ productId */
export const RATE_CARD_ID_PREFIX = 'card:';

/** ช่องเต็ม → ถอดรูปสินค้าที่ใส่ก่อนสุด (Map เรียงตามลำดับที่ใส่) · มีแต่รูปตาราง = ไม่ถอด คืน false */
function evictOldestProductAttachment(into: Map<string, BotAttachment>): boolean {
  for (const key of into.keys()) {
    if (!key.startsWith(RATE_CARD_ID_PREFIX)) {
      into.delete(key);
      return true;
    }
  }
  return false;
}

/**
 * public HTTPS เท่านั้น — กัน storage key ดิบ (S3 key), `http://`, หรือ scheme
 * แปลก ๆ (`line://`, `javascript:`) ไม่ให้หลุดไปถึงปลายทาง (Task 9 → MessageRouter →
 * LINE/Facebook attachment API) ซึ่งพังแบบไม่มี error message ที่ตรงสาเหตุ
 */
const HTTPS_URL_RE = /^https:\/\//i;

function httpsUrlOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && HTTPS_URL_RE.test(value) ? value : undefined;
}

export function collectAttachmentsFromToolResult(
  toolName: string,
  result: unknown,
  into: Map<string, BotAttachment>,
): void {
  if (result == null || typeof result !== 'object') return;

  const push = (u: {
    id?: unknown; photoUrl?: unknown; webUrl?: unknown;
    model?: unknown; storage?: unknown; grade?: unknown; productName?: unknown;
  }) => {
    const productId = typeof u.id === 'string' ? u.id : null;
    if (!productId || into.has(productId)) return;
    const imageUrl = httpsUrlOrUndefined(u.photoUrl);
    const webUrl = httpsUrlOrUndefined(u.webUrl);
    if (!imageUrl && !webUrl) return;
    if (into.size >= MAX_BOT_ATTACHMENTS) return;
    const label = [
      typeof u.productName === 'string' ? u.productName : undefined,
      typeof u.model === 'string' ? u.model : undefined,
      typeof u.storage === 'string' ? u.storage : undefined,
      typeof u.grade === 'string' ? `เกรด ${u.grade}` : undefined,
    ].filter(Boolean).join(' ') || undefined;
    into.set(productId, {
      productId,
      ...(imageUrl ? { imageUrl } : {}),
      ...(webUrl ? { webUrl } : {}),
      ...(label ? { label } : {}),
    });
  };

  if (toolName === 'search_products') {
    const groups = (result as { groups?: unknown }).groups;
    if (!Array.isArray(groups)) return;
    const units = groups.flatMap((g) =>
      Array.isArray((g as { units?: unknown }).units) ? (g as { units: unknown[] }).units : [],
    );
    if (units.length === 0 || units.length > MAX_BOT_ATTACHMENTS) return;
    for (const u of units) push(u as Record<string, unknown>);
    return;
  }

  // รูปตารางผ่อน/แผนที่ของร้าน (send_rate_card) — id = `card:<key>` ไม่ใช่ productId
  // ป้ายจดลงประวัติเป็น "[รูป <label>]" ⇒ บอทรู้ว่าส่งตารางไหนไปแล้ว ไม่ส่งซ้ำ
  // รูปตารางที่บอทตั้งใจส่ง "ชนะ" รูปสินค้าที่ติดมากับผลค้น (เพดาน 2 ใบต่อคำตอบ): ช่องเต็มด้วยรูปสินค้า
  // → ถอดรูปสินค้าที่ใส่ก่อนสุดออก · เต็มด้วยรูปตารางแล้ว = ไม่แนบ (SalesBotService กระทบยอด
  // sent/missing กับช่องแนบจริง ⇒ โมเดลไม่อ้างว่าส่งรูปที่ลูกค้าไม่ได้รับ — รีวิว ATTACH-1 2026-09-22)
  if (toolName === 'send_rate_card') {
    const images = (result as { images?: unknown }).images;
    if (!Array.isArray(images)) return;
    for (const im of images) {
      const u = (im ?? {}) as Record<string, unknown>;
      const attachable =
        typeof u.id === 'string' &&
        !into.has(u.id) &&
        !!(httpsUrlOrUndefined(u.photoUrl) || httpsUrlOrUndefined(u.webUrl));
      // ถอดรูปสินค้าเฉพาะเมื่อรูปตารางใบนี้แนบได้จริง — ไม่งั้นเสียรูปสินค้าไปฟรี ๆ
      if (attachable && into.size >= MAX_BOT_ATTACHMENTS) evictOldestProductAttachment(into);
      push(u);
    }
    return;
  }

  if (toolName === 'calculate_installment') {
    const r = result as { productId?: unknown; photoUrl?: unknown; webUrl?: unknown; productName?: unknown };
    push({ id: r.productId, photoUrl: r.photoUrl, webUrl: r.webUrl, productName: r.productName });
  }
}
