/**
 * ข้อความ error ของการกดบนหน้า LIFF (สร้างลิงก์ชำระ / ปิดยอด) — ข้อความไทยจาก server (`response.data.message`) ก่อน ·
 * error ภาษาไทยที่หน้าโยนเอง (ไม่มี response) · นอกนั้น = ข้อความสำรองของหน้า (ไม่โชว์ข้อความ axios/ภาษาอังกฤษให้ลูกค้า)
 * (Task 36 review m-c — เดิม toast `err.message` ⇒ "Request failed with status code 400")
 */
const THAI = /[฀-๿]/;

export function liffMutationErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const value = error as { response?: { data?: { message?: unknown } }; message?: unknown };
  const raw = value.response?.data?.message;
  const fromServer = Array.isArray(raw) ? raw.find((m) => typeof m === 'string') : raw;
  if (typeof fromServer === 'string' && THAI.test(fromServer)) return fromServer;
  if (!value.response && typeof value.message === 'string' && THAI.test(value.message))
    return value.message;
  return fallback;
}
