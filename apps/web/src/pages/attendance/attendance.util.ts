import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Check, Clock, ImageOff, MapPin, Minus, MonitorOff, Stethoscope, Store, UserX, Wifi, X } from 'lucide-react';
import type { CellStatus, DayKind, MonthSummary, TodayStatus } from '@/hooks/useAttendance';

/** ป้ายสถานะ = ไอคอน + คำ เสมอ (ห้ามบอกด้วยสีอย่างเดียว) · สีจาก token ของแอป */
export interface StatusView {
  label: string;
  icon: LucideIcon;
  className: string;
}

export function statusView(status: CellStatus | TodayStatus, lateMinutes = 0, otHours = 0): StatusView {
  switch (status) {
    case 'ON_TIME':
      return { label: otHours > 0 ? `ตรงเวลา · OT ${fmtOt(otHours)} ชม.` : 'ตรงเวลา', icon: Check, className: 'border-primary/30 bg-primary/10 text-primary' };
    case 'LATE':
      return { label: `สาย ${lateMinutes} นาที`, icon: Clock, className: 'border-warning/40 bg-warning/10 text-warning-strong' };
    case 'MISSING_OUT':
      return { label: 'ไม่ได้ตอกออก', icon: AlertTriangle, className: 'border-warning/40 bg-warning/10 text-warning-strong' };
    case 'NOT_IN':
      return { label: 'ยังไม่มา', icon: X, className: 'border-destructive/30 bg-destructive/10 text-destructive' };
    case 'ABSENT':
      return { label: 'ขาด', icon: UserX, className: 'border-destructive/30 bg-destructive/10 text-destructive' };
    case 'DAY_OFF':
      return { label: 'วันหยุด', icon: Minus, className: 'border-border bg-muted text-muted-foreground' };
    case 'LEAVE':
      return { label: 'ลา', icon: Stethoscope, className: 'border-info/30 bg-info/10 text-info' };
    case 'SHOP_CLOSED':
      return { label: 'ร้านปิด', icon: Store, className: 'border-border bg-muted text-muted-foreground' };
    case 'UNAVAILABLE':
      return { label: 'เครื่องใช้ไม่ได้', icon: MonitorOff, className: 'border-border bg-muted text-muted-foreground' };
    default:
      return { label: '—', icon: Minus, className: 'border-border bg-background text-muted-foreground' };
  }
}

export const fmtOt = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

export const DAY_KIND_LABEL: Record<DayKind, string> = {
  WORK: 'ทำงาน',
  DAY_OFF: 'หยุด',
  LEAVE_SICK: 'ลาป่วย',
  LEAVE_PERSONAL: 'ลากิจ',
  LEAVE_OTHER: 'ลาอื่น',
  SHOP_CLOSED: 'ร้านปิด',
};

/** ลำดับการกดสลับในตารางหยุด: ทำงาน → หยุด → ลาป่วย → ลากิจ → ร้านปิด → ทำงาน */
export const DAY_KIND_CYCLE: DayKind[] = ['WORK', 'DAY_OFF', 'LEAVE_SICK', 'LEAVE_PERSONAL', 'SHOP_CLOSED'];
export const nextDayKind = (current: DayKind): DayKind => DAY_KIND_CYCLE[(DAY_KIND_CYCLE.indexOf(current) + 1) % DAY_KIND_CYCLE.length] ?? 'WORK';

export const FLAG_LABEL: Record<string, { label: string; icon: LucideIcon }> = {
  NO_PHOTO: { label: 'ไม่มีรูป', icon: ImageOff },
  NETWORK_CHANGED: { label: 'เครือข่ายเปลี่ยน', icon: Wifi },
  LOCATION_CHANGED: { label: 'ตำแหน่งเปลี่ยน', icon: MapPin },
  DEVICE_CONFLICT: { label: 'เครื่องถูกใช้ซ้อน', icon: AlertTriangle },
  REOPENED: { label: 'เปิดวันต่อ', icon: Clock },
  OUT_UPDATED: { label: 'แก้เวลาออก', icon: Clock },
  CORRECTED: { label: 'แก้ไขย้อนหลัง', icon: Clock },
  WORKED_ON_OFF_DAY: { label: 'ทำงานวันหยุด', icon: Store },
  DEVICE_UNAVAILABLE: { label: 'เครื่องใช้ไม่ได้', icon: MonitorOff },
};

const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
export const hhmm = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '—');

const THAI_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM-DD' → 'จ 27 ต.ค.' (ไม่พึ่ง TZ ของเครื่อง: ตีความเป็นวันปฏิทิน) */
export function thaiShortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${THAI_DAYS[dow]} ${d} ${THAI_MONTHS[m - 1]}`;
}

export function thaiMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const full = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${full[m - 1]} ${y + 543}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + delta));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function todayBangkok(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** จันทร์ของสัปดาห์ที่มีวันนี้ (ตารางหยุดรายสัปดาห์เริ่มวันจันทร์) */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftDate(date, dow === 0 ? -6 : 1 - dow);
}

export const EXCEL_COLUMNS = [
  { header: 'พนักงาน', key: 'name', width: 24 },
  { header: 'วันทำงาน', key: 'workDays', width: 12 },
  { header: 'สาย (ครั้ง)', key: 'lateCount', width: 12 },
  { header: 'สาย (นาที)', key: 'lateMinutes', width: 12 },
  { header: 'ขาด', key: 'absent', width: 10 },
  { header: 'ลา', key: 'leave', width: 10 },
  { header: 'OT (ชม.)', key: 'otHours', width: 12 },
];

export const summaryToExcelRow = (name: string, s: MonthSummary) => ({ name, workDays: s.workDays, lateCount: s.lateCount, lateMinutes: s.lateMinutes, absent: s.absent, leave: s.leave, otHours: s.otHours });
