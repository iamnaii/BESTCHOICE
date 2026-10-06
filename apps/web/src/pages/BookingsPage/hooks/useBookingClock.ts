import { useEffect, useState } from 'react';

/** เวลาปัจจุบัน (ms) รีเฟรชทุก 30 วิ และตอนกลับมาที่แท็บ — ให้ป้าย "วันนี้/รอระบบปิด" เปลี่ยนเองโดยไม่ต้องโหลดหน้า */
export function useBookingClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);
  return now;
}
