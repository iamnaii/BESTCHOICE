/**
 * ที่เก็บ "ตัวตนของเครื่องตอกบัตร" บนแท็บเล็ตประจำสาขา (ก้อน 10 D3 · สเปก §4.1 §4.3)
 * - ข้อยกเว้นของกฎ security.md เรื่อง localStorage: ไม่ใช่ JWT ผู้ใช้ · เป็น device token ที่หมุนทุกคำขอ ให้สิทธิ์เฉพาะตอกบัตร · ยกเลิก/ล็อกจากเซิร์ฟเวอร์ได้
 * - localStorage อาจถูกบล็อก/ว่าง (โหมดส่วนตัว) → ทุกการอ่าน/เขียนห่อ try/catch และหน้าจอต้องทำงานต่อได้ (กลับไปหน้าลงทะเบียน)
 */
export const KIOSK_STORE_KEY = 'bc.kiosk.device';

export interface KioskDevice {
  token: string;
  branchName: string;
  deviceName: string;
}

export function loadDevice(): KioskDevice | null {
  try {
    const raw = localStorage.getItem(KIOSK_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KioskDevice>;
    if (typeof parsed?.token !== 'string' || !parsed.token) return null;
    return { token: parsed.token, branchName: String(parsed.branchName ?? ''), deviceName: String(parsed.deviceName ?? '') };
  } catch {
    return null;
  }
}

export function saveDevice(device: KioskDevice): void {
  try {
    localStorage.setItem(KIOSK_STORE_KEY, JSON.stringify(device));
  } catch {
    /* storage ถูกบล็อก — หน้าจอจะขอลงทะเบียนใหม่ครั้งหน้า */
  }
}

export function updateToken(token: string): void {
  const current = loadDevice();
  if (!current) return;
  saveDevice({ ...current, token });
}

export function clearDevice(): void {
  try {
    localStorage.removeItem(KIOSK_STORE_KEY);
  } catch {
    /* ignore */
  }
}
