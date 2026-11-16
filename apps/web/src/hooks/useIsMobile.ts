import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 1024;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * จอแคบกว่า 1024px — ตัดสินด้วย media query เท่านั้น ไม่อ่าน `window.innerWidth`:
 * ของที่ล้นจอขยาย layout viewport ของมือถือ ทำให้ innerWidth กว้างกว่าจอจริง แล้วหน้าค้างที่ตารางจอใหญ่
 * ค่าแรกอ่านตอนสร้าง state — จอแคบไม่ต้องวาดแบบจอใหญ่ก่อนหนึ่งเฟรม
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    // ค่าอาจเปลี่ยนระหว่าง render แรกกับตอนผูก listener
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
