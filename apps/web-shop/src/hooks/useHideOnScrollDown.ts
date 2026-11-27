import { useEffect, useState } from 'react';

/** เลื่อนน้อยกว่านี้ไม่เปลี่ยนสถานะ — กันปุ่มกะพริบตอนนิ้วสั่น */
const JITTER_PX = 8;
/** ช่วงบนสุดของหน้า ปุ่มโผล่เสมอ */
const TOP_ZONE_PX = 120;

/**
 * true ขณะลูกค้าเลื่อนลง (กำลังไล่ดูการ์ด) · false เมื่อเลื่อนขึ้นหรืออยู่บนสุดของหน้า
 * ใช้ซ่อนปุ่มทักแชทลอยบนมือถือไม่ให้บังป้ายบนการ์ด (เจ้าของ 2026-11-27)
 */
export function useHideOnScrollDown(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y <= TOP_ZONE_PX) {
        setHidden(false);
        last = y;
        return;
      }
      const delta = y - last;
      if (Math.abs(delta) < JITTER_PX) return;
      setHidden(delta > 0);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return hidden;
}
