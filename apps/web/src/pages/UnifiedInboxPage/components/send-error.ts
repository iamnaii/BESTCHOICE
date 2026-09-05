/** แปลเหตุที่ส่งล้มจาก Facebook เป็นภาษาไทยที่พนักงานทำอะไรต่อได้ (สเปก §8.1)
 *  รู้จัก: Graph #10 / subcode 2018278 = พ้นหน้าต่าง 24 ชม. · #190 = token ของเพจหมดอายุ · อื่น ๆ = ข้อความดิบตัดที่ 120 */
export const SEND_ERROR_WINDOW = 'พ้น 24 ชม. Facebook ไม่ให้ส่งข้อความปกติ';
export const SEND_ERROR_TOKEN = 'token ของเพจหมดอายุ ต้องต่ออายุในตั้งค่า';

export function describeSendError(error: string | null | undefined): string | null {
  if (!error) return null;
  const raw = String(error);
  let code: number | undefined;
  let subcode: number | undefined;
  try {
    const parsed = JSON.parse(raw);
    code = parsed?.error?.code;
    subcode = parsed?.error?.error_subcode;
  } catch {
    // ไม่ใช่ JSON — ลองรูป "fb:<code>[:<subcode>]" ที่ adapter จะส่งมา (PR3) และรูป "(#10)" ในข้อความดิบ
    const m = /fb:(\d+)(?::(\d+))?/.exec(raw);
    if (m) { code = Number(m[1]); subcode = m[2] ? Number(m[2]) : undefined; }
    else {
      const p = /\(#(\d+)\)/.exec(raw);
      if (p) code = Number(p[1]);
      if (/2018278/.test(raw)) subcode = 2018278;
    }
  }
  if (code === 10 || subcode === 2018278) return SEND_ERROR_WINDOW;
  if (code === 190) return SEND_ERROR_TOKEN;
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
}
