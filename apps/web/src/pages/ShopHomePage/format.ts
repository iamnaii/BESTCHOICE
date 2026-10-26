/** ตัวช่วยจัดรูปแบบของหน้าหลักหน้าร้าน — เวลาไทยทั้งหมด */
export const baht = (n: number) => n.toLocaleString('th-TH');

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM' → 'ต.ค.' */
export function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return THAI_MONTHS[m - 1] ?? ym;
}

export function thaiDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  });
}

export function thaiDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
}

export function timeHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

/** +8% / −3% / 0% */
export function signedPct(pct: number): string {
  if (pct > 0) return `+${pct}%`;
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return '0%';
}
