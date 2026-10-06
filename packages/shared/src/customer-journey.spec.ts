import { describe, it, expect } from 'vitest';
import * as shared from './index';
import {
  JOURNEY_ACTOR_TYPES,
  JOURNEY_CHAT_CHANNEL_LABELS,
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_EVENT_GROUPS,
  JOURNEY_HEARD_FROM_CODES,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_HIDDEN_GROUPS,
  JOURNEY_LOST_PROMPT_OUTCOMES,
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_STAGES,
  JOURNEY_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOMES,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  STAGE_LABELS,
  firstChatContactTitle,
  journeyEntryOriginOf,
  type JourneyEntryCreatedResponse,
  type JourneyEntryKind,
  type JourneyListResponse,
  type JourneyManualEntryInput,
  type JourneyRedirect,
  type JourneyStepEvidence,
  type JourneyStepState,
  type JourneySummary,
} from './customer-journey';

describe('customer-journey — สัญญาร่วม API/เว็บ', () => {
  it('ขั้นเรียงตามลำดับจริง และทุกขั้นมีป้ายไทย (ขั้น 2 = ได้เบอร์ / ยืนยันตัวตน — OD-9 · ขั้น 3 ตรวจเครดิต ก่อนขั้น 4 นัด / จอง — เจ้าของสั่ง 2026-09-15)', () => {
    expect(JOURNEY_STAGES).toEqual(['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED']);
    expect(Object.keys(STAGE_LABELS)).toEqual([...JOURNEY_STAGES]);
    expect(STAGE_LABELS.IDENTIFIED).toBe('ได้เบอร์ / ยืนยันตัวตน');
    expect(STAGE_LABELS.CREDIT).toBe('ตรวจเครดิต');
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');
    for (const stage of JOURNEY_STAGES) {
      expect(STAGE_LABELS[stage].trim().length).toBeGreaterThan(0);
      expect(stage.length).toBeLessThanOrEqual(12); // customer_journey_states.stage VARCHAR(12)
    }
  });

  it('ชนิดแถว SYSTEM 11 · MANUAL 4 ไม่ซ้ำกัน และยาวไม่เกิน kind VARCHAR(40)', () => {
    expect(JOURNEY_ENTRY_KINDS.SYSTEM).toEqual([
      'CONTRACT_ACTIVATED',
      'CONTRACT_REVIEWED',
      'DEVICE_RETURNED',
      'EARLY_PAYOFF',
      'CREDIT_CHECK_OPENED_BY',
      'CREDIT_AI_SCORED',
      'BOT_HANDOFF',
      'CONTACT_ADDED',
      'LINE_LINKED',
      'PRODUCT_LINK_CLICK',
      'PLACEHOLDER_MERGED',
    ]);
    expect(JOURNEY_ENTRY_KINDS.MANUAL).toEqual([
      'TOUCHPOINT',
      'HEARD_FROM',
      'MARKED_LOST',
      'REOPENED',
    ]);
    const all: string[] = [...JOURNEY_ENTRY_KINDS.SYSTEM, ...JOURNEY_ENTRY_KINDS.MANUAL];
    expect(new Set(all).size).toBe(all.length);
    for (const kind of all) expect(kind.length).toBeLessThanOrEqual(40);
  });

  it('journeyEntryOriginOf แยก SYSTEM/MANUAL ตามรายการ', () => {
    const cases: [JourneyEntryKind, 'SYSTEM' | 'MANUAL'][] = [
      ['CONTRACT_ACTIVATED', 'SYSTEM'],
      ['DEVICE_RETURNED', 'SYSTEM'],
      ['PLACEHOLDER_MERGED', 'SYSTEM'],
      ['TOUCHPOINT', 'MANUAL'],
      ['REOPENED', 'MANUAL'],
    ];
    for (const [kind, origin] of cases) expect(journeyEntryOriginOf(kind)).toBe(origin);
  });

  it('กลุ่มเหตุการณ์ 8 กลุ่มตามลำดับชิปกรอง · actor type ยาวไม่เกิน VARCHAR(10)', () => {
    expect(JOURNEY_EVENT_GROUPS).toEqual([
      'chat',
      'credit',
      'sale',
      'payment',
      'collections',
      'service',
      'points',
      'system',
    ]);
    expect(JOURNEY_ACTOR_TYPES).toEqual(['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM']);
    for (const actor of JOURNEY_ACTOR_TYPES) expect(actor.length).toBeLessThanOrEqual(10);
  });

  it('กลุ่มค่าตั้งต้น + กลุ่มที่บทบาทไม่เห็น — ชุดเดียวที่ API (Task 8/9) และเว็บ (Task 12) ใช้ร่วมกัน', () => {
    expect(JOURNEY_DEFAULT_GROUPS).toEqual(['chat', 'credit', 'sale', 'collections', 'service']);
    // คำตัดสิน OD-10 (2026-09-15): SALES เห็นยอดชำระ/ติดตามหนี้ (เห็นข้อมูลเดียวกันในแถบเตือน/การ์ดสัญญา/full-timeline อยู่แล้ว) · ACCOUNTANT ยังไม่เห็นแชท
    expect(JOURNEY_HIDDEN_GROUPS).toEqual({ ACCOUNTANT: ['chat'] });
    const known: readonly string[] = JOURNEY_EVENT_GROUPS;
    for (const group of [...JOURNEY_DEFAULT_GROUPS, ...Object.values(JOURNEY_HIDDEN_GROUPS).flat()])
      expect(known).toContain(group);
  });

  it('ป้ายเหตุผลหลุดและที่มาที่ลูกค้าบอก ครบตามรหัสในคอมเมนต์ schema · รหัสยาวไม่เกินคอลัมน์', () => {
    expect(Object.keys(JOURNEY_LOST_REASON_LABELS)).toEqual([
      'NOT_INTERESTED',
      'BOUGHT_ELSEWHERE',
      'CREDIT_FAILED',
      'UNREACHABLE',
      'OTHER',
    ]);
    expect(Object.keys(JOURNEY_HEARD_FROM_LABELS)).toEqual([
      'FB_AD',
      'FB_PAGE',
      'TIKTOK',
      'LINE',
      'GOOGLE',
      'FRIEND',
      'WALK_BY',
      'OLD_CUSTOMER',
      'OTHER',
    ]);
    for (const code of Object.keys(JOURNEY_LOST_REASON_LABELS))
      expect(code.length).toBeLessThanOrEqual(20); // lost_reason VARCHAR(20)
    for (const code of Object.keys(JOURNEY_HEARD_FROM_LABELS))
      expect(code.length).toBeLessThanOrEqual(16); // heard_from VARCHAR(16)
    for (const label of [
      ...Object.values(JOURNEY_LOST_REASON_LABELS),
      ...Object.values(JOURNEY_HEARD_FROM_LABELS),
    ]) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(JOURNEY_LOST_REASON_LABELS.BOUGHT_ELSEWHERE).toBe('ซื้อที่อื่น');
    expect(JOURNEY_HEARD_FROM_LABELS.FRIEND).toBe('เพื่อนแนะนำ');
  });

  it('ช่องทาง/ผลของบันทึกการติดต่อ: ลำดับชิป · ป้ายครบทุกรหัส · ช่องทางที่บันทึกได้ไม่มี อื่น ๆ · รหัสยาวไม่เกินคอลัมน์', () => {
    expect(JOURNEY_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER']);
    expect(Object.keys(JOURNEY_TOUCH_CHANNEL_LABELS)).toEqual([...JOURNEY_TOUCH_CHANNELS]);
    expect(JOURNEY_TOUCH_CHANNEL_LABELS).toEqual({ PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' });
    expect(JOURNEY_RECORDABLE_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN']);
    expect(JOURNEY_TOUCH_OUTCOMES).toEqual(['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED']);
    expect(Object.keys(JOURNEY_TOUCH_OUTCOME_LABELS)).toEqual([...JOURNEY_TOUCH_OUTCOMES]);
    expect(JOURNEY_TOUCH_OUTCOME_LABELS).toEqual({
      APPOINTED: 'นัดแล้ว',
      VISITED: 'มาร้านแล้ว',
      THINKING: 'ขอคิดก่อน',
      BUDGET: 'งบ/ดาวน์ไม่พอ',
      NO_ANSWER: 'ไม่รับสาย',
      BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
      NOT_INTERESTED: 'ไม่สนใจ',
    });
    for (const code of JOURNEY_TOUCH_CHANNELS) expect(code.length).toBeLessThanOrEqual(16); // channel VARCHAR(16)
    for (const code of JOURNEY_TOUCH_OUTCOMES) expect(code.length).toBeLessThanOrEqual(20); // outcome VARCHAR(20)
  });

  it('รหัสเหตุผลหลุด/รู้จักร้านจาก เรียงเท่าคีย์ของป้ายเดิม · ผลที่ถาม "ติดป้ายหลุดไหม" จับคู่เหตุผล 1:1', () => {
    expect(JOURNEY_LOST_REASONS).toEqual(['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER']);
    expect([...JOURNEY_LOST_REASONS]).toEqual(Object.keys(JOURNEY_LOST_REASON_LABELS));
    expect(JOURNEY_HEARD_FROM_CODES).toEqual(['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER']);
    expect([...JOURNEY_HEARD_FROM_CODES]).toEqual(Object.keys(JOURNEY_HEARD_FROM_LABELS));
    expect(JOURNEY_LOST_PROMPT_OUTCOMES).toEqual({ BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE', NOT_INTERESTED: 'NOT_INTERESTED' });
  });

  it('ป้ายช่องทางห้องแชท + ถ้อยคำ "ทักแชทครั้งแรกทาง" ชุดเดียว (คำตัดสิน 12)', () => {
    expect(JOURNEY_CHAT_CHANNEL_LABELS).toEqual({ FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' });
    expect(firstChatContactTitle('CHAT_FACEBOOK')).toBe('ทักแชทครั้งแรกทาง Facebook');
    expect(firstChatContactTitle('CHAT_LINE_SHOP')).toBe('ทักแชทครั้งแรกทาง LINE ร้าน');
    expect(firstChatContactTitle('CHAT_LINE_FINANCE')).toBe('ทักแชทครั้งแรกทาง LINE การเงิน');
    expect(firstChatContactTitle('CHAT_TIKTOK')).toBe('ทักแชทครั้งแรกทาง TikTok');
    expect(firstChatContactTitle('CHAT_WEB')).toBe('ทักแชทครั้งแรกทาง เว็บ');
    expect(firstChatContactTitle('CHAT_INSTAGRAM')).toBe('ทักแชทครั้งแรกทาง INSTAGRAM');
    for (const notChat of ['WALK_IN', 'REFERRAL', 'UNKNOWN', 'AI_CHAT', 'CHAT_', '']) expect(firstChatContactTitle(notChat)).toBeNull();
  });

  it('รูป body/คำตอบของบันทึกมือ: 4 ชนิดตาม JOURNEY_ENTRY_KINDS.MANUAL · สถานะขั้น not_needed · หลักฐาน CHAT_FILE', () => {
    const inputs: JourneyManualEntryInput[] = [
      { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', clientRequestId: '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21' },
      { kind: 'HEARD_FROM', heardFrom: 'FRIEND' },
      { kind: 'MARKED_LOST', lostReason: 'UNREACHABLE' },
      { kind: 'REOPENED' },
    ];
    expect(inputs.map((input) => input.kind)).toEqual([...JOURNEY_ENTRY_KINDS.MANUAL]);
    const states: JourneyStepState[] = ['done', 'current', 'skipped', 'todo', 'not_needed'];
    const evidence: JourneyStepEvidence[] = ['SYSTEM', 'MANUAL', 'CHAT_FILE'];
    expect([states.length, evidence.length]).toEqual([5, 3]);
    const flags: Pick<JourneySummary, 'askHeardFrom' | 'creditFilePending'> = { askHeardFrom: false, creditFilePending: false };
    const noop: JourneyEntryCreatedResponse = { entryId: null, event: null, summary: flags as JourneySummary };
    expect(Object.keys(noop)).toEqual(['entryId', 'event', 'summary']);
  });

  it('รูปคำตอบของ GET /customers/:id/journey: หน้าไทม์ไลน์ หรือ redirect ของผู้สนใจที่ถูกรวมแล้ว', () => {
    const page: JourneyListResponse = {
      customerId: 'c1',
      mergedCustomerIds: ['p1'],
      events: [],
      nextCursor: null,
      notRecorded: [],
    };
    const redirect: JourneyRedirect = { redirectToCustomerId: 'c1' };
    const answers: Array<JourneyListResponse | JourneyRedirect> = [page, redirect];
    expect(
      answers.map((answer) => ('redirectToCustomerId' in answer ? 'redirect' : 'page')),
    ).toEqual(['page', 'redirect']);
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
    // เฟส 3 — ค่าที่ undefined ทั้งสองข้างผ่าน toBe ได้ ⇒ ตรวจว่ามีค่าจริงด้วย
    const phase3 = {
      JOURNEY_TOUCH_CHANNELS, JOURNEY_TOUCH_CHANNEL_LABELS, JOURNEY_RECORDABLE_TOUCH_CHANNELS, JOURNEY_TOUCH_OUTCOMES,
      JOURNEY_TOUCH_OUTCOME_LABELS, JOURNEY_LOST_REASONS, JOURNEY_LOST_PROMPT_OUTCOMES, JOURNEY_HEARD_FROM_CODES,
      JOURNEY_CHAT_CHANNEL_LABELS, firstChatContactTitle,
    };
    for (const [name, value] of Object.entries(phase3)) {
      expect(value).toBeDefined();
      expect((shared as unknown as Record<string, unknown>)[name]).toBe(value);
    }
  });
});
