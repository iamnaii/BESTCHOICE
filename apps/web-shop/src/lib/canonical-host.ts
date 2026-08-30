/**
 * ย้ายคนที่ยังเข้ามาทางโดเมนเก่าไปโดเมนจริง
 *
 * Firebase Hosting เสิร์ฟ site เดียวกันทั้งที่ `<site>.web.app` และ custom domain
 * ปิดโดเมนเก่าไม่ได้ (Firebase ไม่ให้ปิด) ⇒ ถ้าไม่เด้งเอง จะมีคนค้างอยู่ที่
 * bestchoicephone-shop.web.app ตลอดไป ซึ่งพังเงียบ ๆ 2 อย่าง:
 *
 *  1. ล็อกอิน LINE จบไม่ได้ — `redirect_uri` ที่ฝั่ง API สร้าง (SHOP_BASE_URL) ชี้
 *     www เสมอ แต่ state/returnTo ของ OAuth เก็บใน sessionStorage ซึ่งผูกกับ origin
 *     ⇒ เริ่มที่ web.app แล้วถูกส่งกลับมาที่ www = อ่าน state ไม่เจอ = error ลอย ๆ
 *  2. SEO แตกเป็น 2 โดเมนที่เนื้อหาเหมือนกัน
 *
 * ทำฝั่ง client เพราะ firebase.json ไม่มี host-based redirect ให้ใช้
 */

/** โดเมนเก่าที่ต้องเด้งออก — ระบุตรง ๆ ไม่ใช้ pattern เพื่อไม่ให้โดน preview channel */
const LEGACY_HOSTS = ['bestchoicephone-shop.web.app', 'bestchoicephone-shop.firebaseapp.com'];

const CANONICAL_ORIGIN = 'https://www.bestchoicephone.com';

/**
 * 🔴 สวิตช์นิรภัย — ต้องเปิดเองเมื่อ www เสิร์ฟหน้าร้านได้จริงแล้วเท่านั้น
 *
 * ตอนเขียนโค้ดนี้ Firebase ออก cert ให้ www แล้ว (CERT_ACTIVE) แต่ยังไม่ผูก host
 * เข้ากับ site (hostState = HOST_MISMATCH) ⇒ www ยังคืนหน้า "Site Not Found"
 * ถ้าเปิดสวิตช์ตอนนั้น คนที่เข้าโดเมนเก่าจะถูกเด้งไปหน้า 404 = **ร้านล่มทั้งสองทาง**
 *
 * ตั้ง VITE_ENABLE_LEGACY_REDIRECT=true ใน deploy-gcp.yml เมื่อยืนยันแล้วว่า
 * `curl https://www.bestchoicephone.com/` คืนหน้าร้านจริง
 */
const REDIRECT_ENABLED = import.meta.env.VITE_ENABLE_LEGACY_REDIRECT === 'true';

export function redirectLegacyHost(loc: Location = window.location): boolean {
  if (!REDIRECT_ENABLED) return false;
  if (!LEGACY_HOSTS.includes(loc.hostname)) return false;
  // replace() ไม่ทิ้งประวัติไว้ให้กดย้อนกลับมาโดเมนเก่าแล้ววนอีกรอบ
  loc.replace(`${CANONICAL_ORIGIN}${loc.pathname}${loc.search}${loc.hash}`);
  return true;
}
