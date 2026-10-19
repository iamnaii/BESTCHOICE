/** Present service errors in Thai without changing API codes or validation data. */
export function localizeErrorMessage(message: unknown, status?: number): string {
  const raw = Array.isArray(message) ? message.find((item) => typeof item === 'string' && item.trim()) : message;
  if (typeof raw === 'string' && raw.trim()) {
    const known: Record<string, string> = {
      'FINANCE company not configured': 'ยังไม่ได้ตั้งค่าบริษัทงานการเงิน กรุณาติดต่อผู้ดูแลระบบ',
      Unauthorized: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
      Forbidden: 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาติดต่อผู้ดูแลระบบ',
      'Forbidden resource': 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาติดต่อผู้ดูแลระบบ',
      'Not Found': 'ไม่พบข้อมูลที่ต้องการ กรุณาตรวจสอบรายการอีกครั้ง',
      'Network Error': 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้',
    };
    const key = raw.trim();
    const translated = Object.prototype.hasOwnProperty.call(known, key) ? known[key] : undefined;
    if (translated) return translated;
    // Preserve actionable Thai business errors, including names/identifiers.
    if (/[\u0e00-\u0e7f]/.test(raw)) return raw;
  }
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'คุณไม่มีสิทธิ์ดำเนินการนี้ กรุณาติดต่อผู้ดูแลระบบ';
  if (status === 404) return 'ไม่พบข้อมูลที่ต้องการ กรุณาตรวจสอบรายการอีกครั้ง';
  if (status === 400 || status === 422) return 'ข้อมูลไม่ถูกต้องหรือไม่ครบถ้วน กรุณาตรวจสอบช่องกรอก';
  if (status === 409) return 'ข้อมูลมีการเปลี่ยนแปลงหรือรายการซ้ำ กรุณาตรวจสอบรายการล่าสุด';
  if (status && status >= 500) return 'ระบบไม่สามารถดำเนินการได้ กรุณาตรวจสอบรายการก่อนทำซ้ำ หรือติดต่อผู้ดูแลระบบ';
  return 'เกิดข้อผิดพลาด กรุณาตรวจสอบข้อมูลหรือติดต่อผู้ดูแลระบบ';
}
