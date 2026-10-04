/**
 * คำตอบสั้นที่เป็น "การรับปากเปล่า ๆ" ('ได้ค่ะ' 'ผ่านค่ะ' 'มีค่ะ' 'ส่งได้ค่ะ') — ไม่มีข้อมูลรองรับ
 * ถ้าไม่ได้เรียกเครื่องมือในเทิร์นนั้น = อาจรับปากเรื่องนโยบาย/อนุมัติ/สต๊อกเอง ⇒ ไม่ส่งอัตโนมัติ
 * (แทนกฎเดิม "สั้นกว่า 20 ตัวอักษร = 0.6" ที่เปลี่ยน 'ยินดีค่ะ 😊' เป็นข้อความรอแอดมิน — synth C02)
 */
const BARE_PROMISE_RE =
  /^(?:ได้|มี|ผ่าน|ส่งได้|ผ่อนได้|ทำได้|รับได้|อนุมัติ|ใช่)(?:เลย|แน่นอน|แน่ๆ|แน่|แล้ว)?(?:ค่ะ|คะ|ค่า|ครับ|นะคะ|จ้า|จ้ะ)?(?:พี่)?$/;
export function isBarePromise(reply: string): boolean {
  const t = reply.trim();
  if (!t || t.length >= 20) return false;
  // ตัดอีโมจิ/เครื่องหมาย/ช่องว่าง เหลือแต่ตัวอักษรไทย-อังกฤษ-ตัวเลข
  const core = t.replace(/[^฀-๿a-zA-Z0-9]/g, '');
  return BARE_PROMISE_RE.test(core);
}

export function parseRecommendationBudget(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const raw = String(v).replace(/,/g, '').trim().toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*(หมื่น|พัน|k)?/.exec(raw);
  if (!m) return undefined;
  const mult = m[2] === 'หมื่น' ? 10_000 : m[2] === 'พัน' || m[2] === 'k' ? 1_000 : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function estimateReplyConfidence(reply: string, toolsUsed: string[]): number {
  if (toolsUsed.includes('handoff_to_human')) return 0.3;
  if (!reply.trim()) return 0;
  if (toolsUsed.length === 0 && isBarePromise(reply)) return 0.6;
  if (toolsUsed.length > 0) return 0.95;
  return 0.9;
}
