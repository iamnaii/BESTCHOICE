import { Logger } from '@nestjs/common';

/**
 * แหล่งเดียวของ "IP ลูกค้า" ทั้งระบบ
 *
 * เดิมมี 6 จุดที่เขียน `req.headers['x-forwarded-for'].split(',')[0]` ซ้ำ ๆ กันเอง
 * (bot-defense guard, shop-tracking, journal, payments, audit, export-enabled guard)
 * ทำให้แก้กติกาทีต้องไล่แก้ 6 ที่ และแต่ละที่ fallback ไม่เหมือนกัน
 *
 * ── ทำไมต้องมี TRUSTED_PROXY_HOPS ──────────────────────────────────────────
 * prod มี 2 เส้นทางเข้า API ที่ความยาว proxy chain ไม่เท่ากัน:
 *
 *   1. ตรงเข้า Cloud Run   — https://api.bestchoicephone.app/api/**  (แอปพนักงาน)
 *   2. ผ่าน Firebase rewrite — https://www.bestchoicephone.com/api/** (หน้าร้าน)
 *
 * วัดจริงเมื่อ 2026-08-30 ด้วย Cloud Logging: เส้นทาง (1) `httpRequest.remoteIp`
 * เป็น IP ลูกค้าจริง แต่เส้นทาง (2) เป็น **IP ของ proxy Google (66.249.x)** —
 * แปลว่าฝั่งหน้าร้าน socket peer ใช้ระบุตัวลูกค้าไม่ได้เลย ต้องอ่านจาก XFF เท่านั้น
 *
 * XFF ถูก "ต่อท้าย" ไปเรื่อย ๆ ⇒ entry ซ้ายสุดคือค่าที่ client ส่งมาเอง (ปลอมได้ฟรี)
 * ส่วน entry ที่เชื่อถือได้อยู่ทางขวา นับจากขวาเข้ามาเท่ากับจำนวน proxy ที่เราคุมเอง
 *
 * **ไม่ตั้ง TRUSTED_PROXY_HOPS = โหมดเดิมเป๊ะ ๆ** (อ่าน entry ซ้ายสุด) ตั้งใจไม่เปลี่ยน
 * พฤติกรรมใน PR นี้ เพราะจำนวน hop ที่ถูกต้องต้อง **วัดจากของจริง ไม่ใช่เดา** —
 * เปิด IP_CHAIN_DEBUG=true บน Cloud Run แล้วยิง 1 request จะได้ chain เต็มใน log
 * จากนั้นตั้ง TRUSTED_PROXY_HOPS ให้ตรงแล้วปิด debug (ค่า hop ของ 2 เส้นทางอาจ
 * ไม่เท่ากัน — ถ้าต่างจริงต้องแยกเป็นค่า per-host ซึ่งยังไม่ทำใน PR นี้)
 *
 * ⚠️ ตราบใดที่ยังไม่ตั้งค่า IP ที่ได้ยัง **ปลอมได้ด้วย header** — พอกันคนยิงรัวโดย
 * ไม่ตั้งใจ แต่ยังกันคนตั้งใจเลี่ยงไม่ได้ (สิ่งที่ PR นี้แก้จริงคือ "ทุกคนใช้ถังเดียวกัน")
 */

const logger = new Logger('ClientIp');

/** req แบบหลวม ๆ พอให้ทั้ง express Request และ mock ใน test ใช้ร่วมกันได้ */
export interface IpAwareRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * จำนวน proxy ที่เราคุมเอง นับจาก "ขวาสุด" ของ XFF เข้ามา
 *
 * คืน null = ยังไม่ได้ตั้งค่า ⇒ ใช้โหมดเดิม (อ่าน entry ซ้ายสุด ซึ่งปลอมได้)
 */
export function trustedProxyHops(): number | null {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** entry ใน XFF ที่ "หน้าตาเป็น IP" — กัน header ขยะทำให้ key ของ rate limit เพี้ยน */
function looksLikeIp(value: string): boolean {
  if (!value || value.length > 45) return false;
  // IPv4 (อาจมี :port ต่อท้าย) หรือ IPv6 (ตัวเลขฐานสิบหกคั่นด้วย :)
  return /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(value) || /^[0-9a-fA-F:]+$/.test(value);
}

/** คืน X-Forwarded-For เป็น array ที่ trim + กรองขยะออกแล้ว (ซ้าย = ต้นทาง, ขวา = ใกล้เรา) */
export function forwardedChain(req: IpAwareRequest): string[] {
  const raw = req.headers?.['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (!header) return [];
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => looksLikeIp(part));
}

/**
 * IP ที่ใช้เป็นกุญแจ rate limit / audit log
 *
 * @param req  express request (หรือ object ที่มี headers/ip/socket)
 */
export function clientIp(req: IpAwareRequest): string {
  const chain = forwardedChain(req);

  if (process.env.IP_CHAIN_DEBUG === 'true') {
    // ตั้งใจ log ทั้ง chain — ใช้ครั้งเดียวตอนหาค่า TRUSTED_PROXY_HOPS ที่ถูกต้อง
    // แล้วต้องปิดทันที (มี IP = ข้อมูลส่วนบุคคล ไม่ควรค้างใน log ถาวร)
    logger.log(
      `xff=[${chain.join(' | ')}] req.ip=${req.ip ?? '-'} socket=${req.socket?.remoteAddress ?? '-'}`,
    );
  }

  if (chain.length === 0) {
    return req.ip || req.socket?.remoteAddress || '';
  }

  const hops = trustedProxyHops();
  // โหมดเดิม (ยังไม่ตั้ง TRUSTED_PROXY_HOPS): entry ซ้ายสุด — ค่าที่ client ส่งมาเอง
  if (hops === null) return chain[0];

  const index = chain.length - 1 - hops;
  return chain[Math.max(0, index)];
}
