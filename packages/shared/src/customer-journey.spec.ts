import { describe, it, expect } from 'vitest';
import * as shared from './index';
import {
  JOURNEY_ACTOR_TYPES,
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_HIDDEN_GROUPS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_STAGES,
  STAGE_LABELS,
  journeyEntryOriginOf,
  type JourneyEntryKind,
  type JourneyListResponse,
  type JourneyRedirect,
} from './customer-journey';

describe('customer-journey — สัญญาร่วม API/เว็บ', () => {
  it('ขั้นเรียงตามลำดับจริง และทุกขั้นมีป้ายไทย (ขั้น 2 = รู้ตัวตน)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'INTERESTED', 'CREDIT', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.IDENTIFIED).toBe('รู้ตัวตน');
    for (const stage of JOURNEY_STAGES) {
      expect(STAGE_LABELS[stage].trim().length).toBeGreaterThan(0);
      expect(stage.length).toBeLessThanOrEqual(12); // customer_journey_states.stage VARCHAR(12)
    }
  });

  it('ชนิดแถว SYSTEM 9 · MANUAL 4 ไม่ซ้ำกัน และยาวไม่เกิน kind VARCHAR(40)', () => {
    expect(JOURNEY_ENTRY_KINDS.SYSTEM).toEqual([
      'CONTRACT_ACTIVATED',
      'CONTRACT_REVIEWED',
      'CREDIT_CHECK_OPENED_BY',
      'CREDIT_AI_SCORED',
      'BOT_HANDOFF',
      'CONTACT_ADDED',
      'LINE_LINKED',
      'PRODUCT_LINK_CLICK',
      'PLACEHOLDER_MERGED',
    ]);
    expect(JOURNEY_ENTRY_KINDS.MANUAL).toEqual(['TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED']);
    const all: string[] = [...JOURNEY_ENTRY_KINDS.SYSTEM, ...JOURNEY_ENTRY_KINDS.MANUAL];
    expect(new Set(all).size).toBe(all.length);
    for (const kind of all) expect(kind.length).toBeLessThanOrEqual(40);
  });

  it('journeyEntryOriginOf แยก SYSTEM/MANUAL ตามรายการ', () => {
    const cases: [JourneyEntryKind, 'SYSTEM' | 'MANUAL'][] = [
      ['CONTRACT_ACTIVATED', 'SYSTEM'],
      ['PLACEHOLDER_MERGED', 'SYSTEM'],
      ['TOUCHPOINT', 'MANUAL'],
      ['REOPENED', 'MANUAL'],
    ];
    for (const [kind, origin] of cases) expect(journeyEntryOriginOf(kind)).toBe(origin);
  });

  it('กลุ่มเหตุการณ์ 8 กลุ่มตามลำดับชิปกรอง · actor type ยาวไม่เกิน VARCHAR(10)', () => {
    expect(JOURNEY_EVENT_GROUPS).toEqual(['chat', 'credit', 'sale', 'payment', 'collections', 'service', 'points', 'system']);
    expect(JOURNEY_ACTOR_TYPES).toEqual(['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM']);
    for (const actor of JOURNEY_ACTOR_TYPES) expect(actor.length).toBeLessThanOrEqual(10);
  });

  it('กลุ่มค่าตั้งต้น + กลุ่มที่บทบาทไม่เห็น — ชุดเดียวที่ API (Task 8/9) และเว็บ (Task 12) ใช้ร่วมกัน', () => {
    expect(JOURNEY_DEFAULT_GROUPS).toEqual(['chat', 'credit', 'sale', 'collections', 'service']);
    // คำตัดสิน OD-10 (2026-09-15): SALES เห็นยอดชำระ/ติดตามหนี้ (เห็นข้อมูลเดียวกันในแถบเตือน/การ์ดสัญญา/full-timeline อยู่แล้ว) · ACCOUNTANT ยังไม่เห็นแชท
    expect(JOURNEY_HIDDEN_GROUPS).toEqual({ ACCOUNTANT: ['chat'] });
    const known: readonly string[] = JOURNEY_EVENT_GROUPS;
    for (const group of [...JOURNEY_DEFAULT_GROUPS, ...Object.values(JOURNEY_HIDDEN_GROUPS).flat()]) expect(known).toContain(group);
  });

  it('ป้ายเหตุผลหลุดและที่มาที่ลูกค้าบอก ครบตามรหัสในคอมเมนต์ schema · รหัสยาวไม่เกินคอลัมน์', () => {
    expect(Object.keys(JOURNEY_LOST_REASON_LABELS)).toEqual(['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER']);
    expect(Object.keys(JOURNEY_HEARD_FROM_LABELS)).toEqual(['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER']);
    for (const code of Object.keys(JOURNEY_LOST_REASON_LABELS)) expect(code.length).toBeLessThanOrEqual(20); // lost_reason VARCHAR(20)
    for (const code of Object.keys(JOURNEY_HEARD_FROM_LABELS)) expect(code.length).toBeLessThanOrEqual(16); // heard_from VARCHAR(16)
    for (const label of [...Object.values(JOURNEY_LOST_REASON_LABELS), ...Object.values(JOURNEY_HEARD_FROM_LABELS)]) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(JOURNEY_LOST_REASON_LABELS.BOUGHT_ELSEWHERE).toBe('ซื้อที่อื่น');
    expect(JOURNEY_HEARD_FROM_LABELS.FRIEND).toBe('เพื่อนแนะนำ');
  });

  it('รูปคำตอบของ GET /customers/:id/journey: หน้าไทม์ไลน์ หรือ redirect ของผู้สนใจที่ถูกรวมแล้ว', () => {
    const page: JourneyListResponse = { customerId: 'c1', mergedCustomerIds: ['p1'], events: [], nextCursor: null, notRecorded: [] };
    const redirect: JourneyRedirect = { redirectToCustomerId: 'c1' };
    const answers: Array<JourneyListResponse | JourneyRedirect> = [page, redirect];
    expect(answers.map((answer) => ('redirectToCustomerId' in answer ? 'redirect' : 'page'))).toEqual(['page', 'redirect']);
  });

  it('ส่งออกผ่าน index ของแพ็กเกจ (@installment/shared)', () => {
    expect(shared.JOURNEY_STAGES).toBe(JOURNEY_STAGES);
    expect(shared.STAGE_LABELS).toBe(STAGE_LABELS);
    expect(shared.JOURNEY_ENTRY_KINDS).toBe(JOURNEY_ENTRY_KINDS);
    expect(shared.JOURNEY_EVENT_GROUPS).toBe(JOURNEY_EVENT_GROUPS);
    expect(shared.journeyEntryOriginOf).toBe(journeyEntryOriginOf);
    expect(shared.JOURNEY_DEFAULT_GROUPS).toBe(JOURNEY_DEFAULT_GROUPS);
    expect(shared.JOURNEY_HIDDEN_GROUPS).toBe(JOURNEY_HIDDEN_GROUPS);
    expect(shared.JOURNEY_LOST_REASON_LABELS).toBe(JOURNEY_LOST_REASON_LABELS);
    expect(shared.JOURNEY_HEARD_FROM_LABELS).toBe(JOURNEY_HEARD_FROM_LABELS);
  });
});
