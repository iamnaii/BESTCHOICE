import { describe, expect, it } from 'vitest';
import { JOURNEY_EVENT_GROUPS } from '@installment/shared';
import { GROUP_EVENT_STYLES } from '@/components/timeline/eventTimelineStyles';
import {
  allChipNote,
  canViewJourney,
  DEFAULT_EXCLUDED_GROUPS,
  journeyActorLabel,
  journeyEventSubtitle,
  journeyGroupLabel,
  journeyGroupsForRole,
} from '../utils/journeyGroups';

describe('journeyGroupsForRole — ตาม JOURNEY_HIDDEN_GROUPS ของ shared (ชุดเดียวกับ API)', () => {
  it('OWNER / BRANCH_MANAGER / FINANCE_MANAGER เห็นครบทุกกลุ่มตามลำดับกลาง', () => {
    expect(journeyGroupsForRole('OWNER')).toEqual([...JOURNEY_EVENT_GROUPS]);
    expect(journeyGroupsForRole('BRANCH_MANAGER')).toEqual([...JOURNEY_EVENT_GROUPS]);
    expect(journeyGroupsForRole('FINANCE_MANAGER')).toEqual([...JOURNEY_EVENT_GROUPS]);
  });

  it('SALES ไม่เห็นชำระเงินและติดตามหนี้ (สมมติฐานเจ้าของข้อ b)', () => {
    expect(journeyGroupsForRole('SALES')).toEqual(['chat', 'credit', 'sale', 'service', 'points', 'system']);
  });

  it('ACCOUNTANT ไม่เห็นแชท · บทบาทที่ API ไม่อนุญาตไม่ได้กลุ่มใดเลย', () => {
    expect(journeyGroupsForRole('ACCOUNTANT')).toEqual(['credit', 'sale', 'payment', 'collections', 'service', 'points', 'system']);
    expect(journeyGroupsForRole('VIEWER')).toEqual([]);
    expect(canViewJourney('VIEWER')).toBe(false);
    expect(canViewJourney('ACCOUNTANT')).toBe(true);
  });
});

describe('allChipNote', () => {
  it('บอกกลุ่มที่ชิป "ทั้งหมด" ไม่รวม (กลุ่มนอก JOURNEY_DEFAULT_GROUPS) เฉพาะกลุ่มที่บทบาทนั้นเห็น', () => {
    expect([...DEFAULT_EXCLUDED_GROUPS]).toEqual(['payment', 'points', 'system']);
    expect(allChipNote('OWNER')).toBe('ทั้งหมด ไม่รวม ชำระเงิน · แต้ม · ระบบ — กดชิปของกลุ่มนั้นเพื่อดู');
    expect(allChipNote('SALES')).toBe('ทั้งหมด ไม่รวม แต้ม · ระบบ — กดชิปของกลุ่มนั้นเพื่อดู');
    expect(allChipNote('VIEWER')).toBeNull();
  });
});

describe('journeyEventSubtitle', () => {
  it('ต่อรายละเอียดกับผู้ทำ', () => {
    expect(journeyEventSubtitle({ subtitle: 'CT-2569-0042', actor: { type: 'STAFF', name: 'แนน' } })).toBe('CT-2569-0042 · แนน');
  });

  it('ผู้ทำไม่มีชื่อ → ป้ายตามประเภท · ไม่มีทั้งรายละเอียดและผู้ทำ → ว่าง', () => {
    expect(journeyActorLabel({ type: 'STAFF' })).toBe('ร้าน (ไม่ทราบชื่อ)');
    expect(journeyActorLabel({ type: 'BOT' })).toBe('บอท');
    expect(journeyActorLabel(null)).toBeNull();
    expect(journeyEventSubtitle({ actor: null })).toBe('');
  });
});

describe('journeyGroupLabel', () => {
  it('ป้ายมาจาก GROUP_EVENT_STYLES ของไทม์ไลน์กลาง (Task 11) ทุกกลุ่ม ห้ามหลุดค่าดิบ', () => {
    for (const group of JOURNEY_EVENT_GROUPS) {
      expect(journeyGroupLabel(group)).toBe(GROUP_EVENT_STYLES[group].typeLabel);
      expect(journeyGroupLabel(group)).not.toBe(group);
    }
    expect(journeyGroupLabel('chat')).toBe('แชท/ติดต่อ');
  });
});
