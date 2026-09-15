import { formatThaiDateShort, formatThaiTime } from '@/lib/date';

export interface DateGroup<T> {
  label: string;
  items: T[];
}

/**
 * จัดกลุ่มตามวันของเครื่องผู้ใช้: "วันนี้" · "เมื่อวาน" · วันที่แบบสั้น (พ.ศ.)
 * คงลำดับที่ส่งมา (API เรียงใหม่ → เก่าแล้ว) — ห้ามเรียงใหม่ในนี้ ไม่งั้นหน้าที่โหลดต่อ (keyset) จะสลับตำแหน่ง
 */
export function groupEventsByDate<T extends { timestamp: string }>(events: T[], now: Date = new Date()): DateGroup<T>[] {
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const groups = new Map<string, T[]>();
  const order: string[] = [];

  for (const event of events) {
    const day = new Date(event.timestamp);
    day.setHours(0, 0, 0, 0);
    let label: string;
    if (day.getTime() === today.getTime()) {
      label = 'วันนี้';
    } else if (day.getTime() === yesterday.getTime()) {
      label = 'เมื่อวาน';
    } else {
      label = formatThaiDateShort(day);
    }

    const bucket = groups.get(label);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(label, [event]);
      order.push(label);
    }
  }

  return order.map((label) => ({ label, items: groups.get(label) ?? [] }));
}

/** ป้ายเวลาในแถว: ตอนนี้ · N นาทีที่แล้ว · N ชม.ที่แล้ว · เกิน 24 ชม. = HH:mm (วันที่อยู่ที่หัวกลุ่มแล้ว) */
export function relativeTimeLabel(iso: string, now: number = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'ตอนนี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return formatThaiTime(iso);
}
