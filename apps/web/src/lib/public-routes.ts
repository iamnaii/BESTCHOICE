/**
 * แหล่งความจริงเดียวของ "หน้าไหนเปิดได้โดยยังไม่ล็อกอิน".
 *
 * เดิมรายการนี้ถูกคัดลอกด้วยมือไว้ 2 ที่ — `lib/api.ts` (ห้ามเด้งไป /login เมื่อเจอ 401)
 * กับ `contexts/AuthContext.tsx` (ห้ามยิง /auth/me ตั้งแต่แรก) — แล้วทั้งคู่ตกหน้าที่
 * "เปิดจากลิงก์ในอีเมล" ไปเหมือนกันหมด: /reset-password, /forgot-password, /register
 *
 * ผลที่ prod (2026-08-25): กดลิงก์รีเซ็ตรหัสผ่านในอีเมล → cold load ไม่มี session →
 * /auth/me ตอบ 401 → interceptor สั่ง `window.location.href = '/login'` → **token ใน URL
 * หายไปพร้อมหน้าจอ** ผู้ใช้เห็นแค่หน้า login กะพริบขึ้นมา ⇒ "รีเซ็ตรหัสผ่านใช้ไม่ได้จริง"
 * (log ยืนยัน: มี /auth/me + /auth/refresh 401 วน 8 รอบจนโดน 429 แต่ไม่มี
 * POST /auth/reset-password แม้แต่ครั้งเดียว) ลิงก์เชิญพนักงาน /register ก็พังด้วยเหตุเดียวกัน
 * และ /privacy กับ /privacy/data-deletion ที่ Meta ต้องเปิดได้สาธารณะก็โดนเด้งเช่นกัน
 *
 * เพิ่มหน้าสาธารณะใหม่ที่นี่ที่เดียว — อย่าคัดลอกรายการกลับไปไว้ในไฟล์อื่นอีก
 */

export type PageLocation = {
  hostname: string;
  pathname: string;
  search: string;
};

/** อ่านตำแหน่งหน้าปัจจุบันจาก `window` — แยกออกมาให้ predicate ข้างล่างเทสต์ได้ตรง ๆ */
export function currentLocation(): PageLocation {
  return {
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

/**
 * หน้าสาธารณะแท้ ๆ — ไม่มี session ของแอดมินให้ใช้เลย
 * จับแบบ "ทั้งส่วน": `/register` ตรงตัวหรือขึ้นต้นด้วย `/register/` เท่านั้น
 * (`/registers` ไม่นับ) กัน prefix ชนกันโดยไม่ตั้งใจ
 */
const PUBLIC_SECTIONS = [
  // เปิดจากลิงก์ในอีเมล — cold load ที่ไม่มี session เสมอ
  '/reset-password',
  '/forgot-password',
  '/register',
  // หน้านโยบายที่ Meta/ผู้ใช้ทั่วไปต้องเปิดได้โดยไม่ล็อกอิน
  '/privacy',
  '/terms',
  // พอร์ทัลลูกค้า / LIFF ที่ยืนยันตัวด้วย token ในลิงก์
  '/liff',
  '/pay',
  '/customer-access',
  '/verify',
];

/** หน้าที่ยัง "อยากรู้ว่ามี session ไหม" แต่ห้ามเด้งออกถ้าไม่มี */
const NO_REDIRECT_SECTIONS = [
  // /login ต้องยิง /auth/me ต่อไป — App.tsx ใช้ isAuthenticated พาคนที่ล็อกอินอยู่แล้วไปหน้าแรก
  '/login',
  '/landing',
  // ใบลดหนี้ที่เปิดจากลิงก์ใน LINE Flex
  '/cn',
];

function inSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

function inAnySection(pathname: string, sections: string[]): boolean {
  return sections.some((section) => inSection(pathname, section));
}

/**
 * `true` = ห้ามยิง /auth/me บนหน้านี้ (และห้ามเด้งไป /login ด้วย — ดู shouldSkipLoginRedirect)
 */
export function isPublicPage({ hostname, pathname, search }: PageLocation): boolean {
  // โดเมนย่อยของลูกค้า/LIFF ไม่มี cookie ของแอดมินเลย
  if (hostname.startsWith('customer.') || hostname.startsWith('liff.')) return true;
  // LINE ส่งกลับมาที่ path ไหนก็ได้พร้อม liff.state
  if (search.includes('liff.state')) return true;
  return inAnySection(pathname, PUBLIC_SECTIONS);
}

/**
 * `true` = เจอ 401 แล้วให้อยู่หน้าเดิม ห้าม `window.location.href = '/login'`
 */
export function shouldSkipLoginRedirect(location: PageLocation): boolean {
  return (
    isPublicPage(location) || inAnySection(location.pathname, NO_REDIRECT_SECTIONS)
  );
}
