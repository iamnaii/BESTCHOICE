import type { LucideIcon } from 'lucide-react';
import { Ban, Lock, Wifi, WifiOff } from 'lucide-react';
import type { AttendanceDevice } from '@/hooks/useAttendance';

/** heartbeat ทุก 10 นาที (KioskPage) ⇒ ติดต่อภายใน 15 นาที = ออนไลน์ */
export const ONLINE_WINDOW_MS = 15 * 60_000;

const BKK = 'Asia/Bangkok';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: BKK, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: BKK, hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: BKK, day: 'numeric', month: 'short' });
const regFmt = new Intl.DateTimeFormat('th-TH', { timeZone: BKK, day: 'numeric', month: 'short', year: '2-digit' });

/** 'วันนี้ 10:16' หรือ '27 ต.ค. 13:41' ตามปฏิทินไทย */
export function formatDeviceTime(iso: string | null, now = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const prefix = dayKey.format(d) === dayKey.format(now) ? 'วันนี้' : dateFmt.format(d);
  return `${prefix} ${timeFmt.format(d)}`;
}

export const formatRegisteredDate = (iso: string) => regFmt.format(new Date(iso));

/** ชนิดเครื่องอ่านง่ายจาก user-agent (แสดงผลเท่านั้น) */
export function deviceKind(ua: string | null): string {
  if (!ua) return 'ยังไม่เคยติดต่อ';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  return 'เบราว์เซอร์';
}

export interface DeviceStatusView {
  label: string;
  icon: LucideIcon;
  className: string;
}

/** สถานะเครื่อง = ไอคอน + คำ (ห้ามบอกด้วยสีอย่างเดียว) */
export function deviceStatusView(device: AttendanceDevice, now = Date.now()): DeviceStatusView {
  if (device.status === 'LOCKED') return { label: 'ล็อก · รหัสเครื่องถูกใช้จาก 2 ที่', icon: Lock, className: 'border-destructive/30 bg-destructive/10 text-destructive' };
  if (device.status === 'REVOKED') return { label: 'ยกเลิกแล้ว', icon: Ban, className: 'border-border bg-muted text-muted-foreground' };
  const online = !!device.lastSeenAt && now - new Date(device.lastSeenAt).getTime() <= ONLINE_WINDOW_MS;
  return online
    ? { label: 'ใช้งาน · ออนไลน์', icon: Wifi, className: 'border-primary/30 bg-primary/10 text-primary' }
    : { label: 'ใช้งาน · ไม่ได้ติดต่อ', icon: WifiOff, className: 'border-warning/40 bg-warning/10 text-warning-strong' };
}

/** พักรหัสพนักงานอยู่ (กรอกผิด 5 ครั้ง) — คืนเวลาที่ปลด หรือ null */
export const pinLockedUntil = (device: AttendanceDevice, now = Date.now()): string | null =>
  device.pinLockedUntil && new Date(device.pinLockedUntil).getTime() > now ? device.pinLockedUntil : null;
