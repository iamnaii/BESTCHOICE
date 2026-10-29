/**
 * ที่เก็บ "ตัวตนของเครื่องตอกบัตร" บนแท็บเล็ตประจำสาขา (ก้อน 10 D3 · สเปก §4.1 §4.3)
 * - ข้อยกเว้นของกฎ security.md เรื่อง localStorage: ไม่ใช่ JWT ผู้ใช้ · เป็น device token ที่หมุนเมื่องานสำเร็จ ให้สิทธิ์เฉพาะตอกบัตร · ยกเลิก/ล็อกจากเซิร์ฟเวอร์ได้
 * - localStorage อาจถูกบล็อก/ว่าง (โหมดส่วนตัว) → ทุกการอ่าน/เขียนห่อ try/catch และหน้าจอต้องทำงานต่อได้ (กลับไปหน้าลงทะเบียน)
 */
export const KIOSK_STORE_KEY = 'bc.kiosk.device';

export interface KioskDevice {
  token: string;
  branchName: string;
  deviceName: string;
  /** requestId ของคำขอที่ส่งไปแล้วแต่ยังไม่ได้คำตอบแน่นอน (เน็ตหลุด) — ต้องเก็บผลก่อนส่งคำขอใหม่ (รีวิว C3) */
  pendingRequestId?: string;
}

export function loadDevice(): KioskDevice | null {
  try {
    const raw = localStorage.getItem(KIOSK_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KioskDevice>;
    if (typeof parsed?.token !== 'string' || !parsed.token) return null;
    const device: KioskDevice = { token: parsed.token, branchName: String(parsed.branchName ?? ''), deviceName: String(parsed.deviceName ?? '') };
    if (typeof parsed.pendingRequestId === 'string' && parsed.pendingRequestId) device.pendingRequestId = parsed.pendingRequestId;
    return device;
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

/** token รุ่นถัดไป = คำขอที่ค้างได้คำตอบแล้ว ⇒ เขียน token + ล้าง pending ในครั้งเดียว */
export function updateToken(token: string): void {
  const current = loadDevice();
  if (!current) return;
  saveDevice({ token, branchName: current.branchName, deviceName: current.deviceName });
}

export function setPendingRequest(requestId: string | null): void {
  const current = loadDevice();
  if (!current) return;
  const base: KioskDevice = { token: current.token, branchName: current.branchName, deviceName: current.deviceName };
  saveDevice(requestId ? { ...base, pendingRequestId: requestId } : base);
}

export function clearDevice(): void {
  try {
    localStorage.removeItem(KIOSK_STORE_KEY);
  } catch {
    /* ignore */
  }
}
