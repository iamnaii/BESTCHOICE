/**
 * สถานะนัดของห้อง — ใช้ร่วมกันทั้งป้ายแถวรายชื่อ · ชิปหัวห้อง · แถบเตือนเหนือทุกแผง
 * (เจ้าของเคาะ 2026-09-06: ชั้น 1 "เห็นเมื่อมอง" + ชั้น 2 "เห็นแม้ไม่ได้มอง")
 * เตือนล่วงหน้า 15 นาที = ค่าเดียวกับ OBI (P3-6) ไม่ปรับเอง
 */
export const APPT_LEAD_MIN = 15;

export type ApptKind = 'overdue' | 'due' | 'soon' | 'today' | 'tomorrow' | 'later';
export interface ApptState {
  kind: ApptKind;
  label: string;
  /** danger = ถึง/ใกล้ถึง/เลย · warn = วันนี้ · muted = วันอื่น */
  tone: 'danger' | 'warn' | 'muted';
  /** ต้องเด้ง/ลอยขึ้นบน (ถึง ใกล้ถึง เลย) */
  urgent: boolean;
}

export interface RoomAppointment {
  id: string;
  title: string;
  dueDate?: string | null;
  status: string;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MIN = 60_000;

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "12 นาที" · "2 ชม. 5 นาที" · "3 วัน" */
export function formatDurationTh(ms: number): string {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} ชม. ${r} นาที` : `${h} ชม.`;
  return `${Math.floor(h / 24)} วัน`;
}

export function apptState(due: string | Date | null | undefined, now: Date = new Date()): ApptState | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const diff = d.getTime() - now.getTime();
  if (diff < -MIN) return { kind: 'overdue', label: `เลยนัด ${formatDurationTh(-diff)}`, tone: 'danger', urgent: true };
  if (diff <= MIN) return { kind: 'due', label: 'ถึงเวลานัดแล้ว', tone: 'danger', urgent: true };
  if (diff <= APPT_LEAD_MIN * MIN) return { kind: 'soon', label: `นัดอีก ${Math.ceil(diff / MIN)} นาที`, tone: 'danger', urgent: true };
  if (sameDay(d, now)) return { kind: 'today', label: `นัดวันนี้ ${hhmm(d)}`, tone: 'warn', urgent: false };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return { kind: 'tomorrow', label: `นัดพรุ่งนี้ ${hhmm(d)}`, tone: 'muted', urgent: false };
  return { kind: 'later', label: `นัด ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${hhmm(d)}`, tone: 'muted', urgent: false };
}

/** นัดถัดไปของห้องจาก include `todos` (API ส่งมาแค่ใบใกล้สุดที่ยังไม่เสร็จ) */
export function nextAppointment(todos?: RoomAppointment[] | null): RoomAppointment | null {
  if (!todos?.length) return null;
  const open = todos.filter((t) => t.dueDate && t.status !== 'DONE');
  if (!open.length) return null;
  return [...open].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
}
