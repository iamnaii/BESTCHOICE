import {
  Activity,
  Banknote,
  CreditCard,
  Gift,
  MessageCircle,
  PhoneCall,
  Settings2,
  ShoppingBag,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { JOURNEY_EVENT_GROUPS, type JourneyEventGroup } from '@installment/shared';

export interface EventStyle {
  Icon: LucideIcon;
  iconBg: string;
  iconText: string;
  typeLabel: string;
}

/**
 * ไอคอน + ป้ายของกลุ่มเหตุการณ์ — key ตรงกับ JOURNEY_EVENT_GROUPS ใน packages/shared/src/customer-journey.ts
 * ป้ายไทยตาม eventCatalog[].group ของแบบ (แชท/ติดต่อ · เครดิต · ขาย/สัญญา · ชำระเงิน · ติดตามหนี้ · บริการ/ประกัน · แต้ม · ระบบ)
 * แท็บการเดินทาง (Task 12) ใช้ป้าย/ไอคอนชุดนี้ทั้งชิปและการ์ด — แก้ที่นี่ที่เดียว
 */
export const GROUP_EVENT_STYLES: Readonly<Record<JourneyEventGroup, EventStyle>> = {
  chat: { Icon: MessageCircle, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'แชท/ติดต่อ' },
  credit: { Icon: CreditCard, iconBg: 'bg-info/10', iconText: 'text-info', typeLabel: 'เครดิต' },
  sale: { Icon: ShoppingBag, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'ขาย/สัญญา' },
  payment: { Icon: Banknote, iconBg: 'bg-success/10', iconText: 'text-success', typeLabel: 'ชำระเงิน' },
  collections: { Icon: PhoneCall, iconBg: 'bg-warning/10', iconText: 'text-warning-strong', typeLabel: 'ติดตามหนี้' },
  service: { Icon: Wrench, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: 'บริการ/ประกัน' },
  points: { Icon: Gift, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'แต้ม' },
  system: { Icon: Settings2, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: 'ระบบ' },
};

/** ค่าตั้งต้นของ EventTimeline: เลือกตาม group · ไม่มี/ไม่รู้จัก group → ไอคอนกลาง + ชื่อ type */
function isJourneyEventGroup(value: string): value is JourneyEventGroup {
  return (JOURNEY_EVENT_GROUPS as readonly string[]).includes(value);
}

export function defaultEventStyle(event: { type: string; group?: string }): EventStyle {
  if (event.group && isJourneyEventGroup(event.group)) {
    return GROUP_EVENT_STYLES[event.group];
  }
  return { Icon: Activity, iconBg: 'bg-muted', iconText: 'text-muted-foreground', typeLabel: event.type };
}
