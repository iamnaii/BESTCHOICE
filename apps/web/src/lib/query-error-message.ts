/** Read failures should explain recovery, never display transport/server internals. */
export function queryErrorMessage(error: unknown): string {
  const fallback = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  if (!error || typeof error !== 'object') return fallback;
  const value = error as { response?: { status?: number; data?: { message?: unknown } }; code?: string; message?: string };
  if (value.code === 'ECONNABORTED' || value.code === 'ETIMEDOUT') return 'ระบบใช้เวลาตอบกลับนานเกินไป กรุณาลองใหม่อีกครั้ง';
  const status = value.response?.status;
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'คุณไม่มีสิทธิ์ดูข้อมูลนี้ กรุณาตรวจสอบบริษัทที่เลือกหรือติดต่อผู้ดูแลระบบ';
  if (status === 404) return 'ไม่พบข้อมูลนี้ ข้อมูลอาจถูกยกเลิกแล้ว กรุณากลับไปตรวจสอบรายการ';
  if (status === 429) return 'มีคำขอจำนวนมาก กรุณารอสักครู่แล้วลองใหม่';
  if (status && status >= 500) return 'ระบบขัดข้องชั่วคราว กรุณารอสักครู่แล้วลองใหม่ หากยังไม่สำเร็จให้ติดต่อผู้ดูแลระบบ';
  const raw = value.response?.data?.message;
  const message = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.find(item => typeof item === 'string') : !value.response && !value.code && error instanceof Error ? error.message : undefined;
  return typeof message === 'string' && /[\u0e00-\u0e7f]/.test(message) ? message : fallback;
}
