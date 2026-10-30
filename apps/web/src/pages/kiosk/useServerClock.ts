import { useEffect, useState } from 'react';

/** นาฬิกาบนเครื่องตอกบัตร = เวลาเซิร์ฟเวอร์ (offset จาก serverTime ล่าสุด) ไม่ใช่นาฬิกาของแท็บเล็ต — แสดงผลเท่านั้น เวลาที่บันทึกคือเวลาเซิร์ฟเวอร์เสมอ */
export function useServerClock(offsetMs: number) {
  const [now, setNow] = useState(() => new Date(Date.now() + offsetMs));
  useEffect(() => {
    setNow(new Date(Date.now() + offsetMs));
    const id = setInterval(() => setNow(new Date(Date.now() + offsetMs)), 10_000);
    return () => clearInterval(id);
  }, [offsetMs]);
  return now;
}

const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

export const formatClock = (d: Date) => timeFmt.format(d);
export const formatThaiDate = (d: Date) => dateFmt.format(d);
export const formatHHmm = (iso: string) => timeFmt.format(new Date(iso));
