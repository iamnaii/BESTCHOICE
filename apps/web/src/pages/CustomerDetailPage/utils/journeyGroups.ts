import {
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HIDDEN_GROUPS,
  type JourneyEvent,
  type JourneyEventGroup,
} from '@installment/shared';
import { GROUP_EVENT_STYLES } from '@/components/timeline/eventTimelineStyles';

/** ตรง roles ของ GET /customers/:id/journey และ /summary — บทบาทอื่นไม่เห็นแท็บ แถบขั้น และการ์ด (และไม่ยิง API) */
export const JOURNEY_VIEW_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'BRANCH_MANAGER',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'SALES',
]);

export function canViewJourney(role: string): boolean {
  return JOURNEY_VIEW_ROLES.has(role);
}

/**
 * กลุ่มนอก JOURNEY_DEFAULT_GROUPS — ชิป "ทั้งหมด" ไม่ส่ง groups จึงไม่ได้กลุ่มเหล่านี้
 * กฎกลุ่ม (JOURNEY_DEFAULT_GROUPS / JOURNEY_HIDDEN_GROUPS) มาจาก shared ชุดเดียวกับ API — API ตัดข้อมูลจริง เว็บซ่อนชิปให้ตรง
 */
export const DEFAULT_EXCLUDED_GROUPS: ReadonlySet<JourneyEventGroup> = new Set<JourneyEventGroup>(
  JOURNEY_EVENT_GROUPS.filter((group) => !JOURNEY_DEFAULT_GROUPS.includes(group)),
);

/** การ์ด "กิจกรรมล่าสุด" บนแท็บภาพรวม — ค่าคงที่ระดับไฟล์ queryKey จึงไม่เปลี่ยนทุก render */
export const OVERVIEW_GROUPS: readonly JourneyEventGroup[] = ['chat', 'credit', 'sale'];
export const OVERVIEW_LIMIT = 6;

/** "เงียบ" = ยังไม่ซื้อ และไม่มีการติดต่อเกิน 30 วัน (API คำนวณ silentDays แล้ว เว็บแค่ตัดสินว่าจะติดป้าย) */
export const SILENT_AFTER_DAYS = 30;

export function journeyGroupsForRole(role: string): JourneyEventGroup[] {
  if (!canViewJourney(role)) return [];
  const hidden = JOURNEY_HIDDEN_GROUPS[role] ?? [];
  return JOURNEY_EVENT_GROUPS.filter((group) => !hidden.includes(group));
}

/** ป้ายกลุ่มชุดเดียวกับไทม์ไลน์กลาง — แก้ป้ายที่ eventTimelineStyles.ts ที่เดียว */
export function journeyGroupLabel(group: JourneyEventGroup): string {
  return GROUP_EVENT_STYLES[group].typeLabel;
}

export function allChipNote(role: string): string | null {
  const excluded = journeyGroupsForRole(role).filter((group) => DEFAULT_EXCLUDED_GROUPS.has(group));
  if (excluded.length === 0) return null;
  return `ทั้งหมด ไม่รวม ${excluded.map(journeyGroupLabel).join(' · ')} — กดชิปของกลุ่มนั้นเพื่อดู`;
}

const ACTOR_FALLBACK: Readonly<Record<string, string>> = {
  STAFF: 'ร้าน (ไม่ทราบชื่อ)',
  CUSTOMER: 'ลูกค้า',
  BOT: 'บอท',
  SYSTEM: 'ระบบ',
};

export function journeyActorLabel(actor: JourneyEvent['actor']): string | null {
  if (!actor) return null;
  return actor.name || ACTOR_FALLBACK[actor.type] || null;
}

/** บรรทัดรอง: รายละเอียดจาก API · ผู้ทำ — ไม่อ่าน metadata (PDPA) · ป้ายเวลาโดยประมาณแสดงแยกจาก reliability */
export function journeyEventSubtitle(event: Pick<JourneyEvent, 'subtitle' | 'actor'>): string {
  return [event.subtitle, journeyActorLabel(event.actor)].filter(Boolean).join(' · ');
}
