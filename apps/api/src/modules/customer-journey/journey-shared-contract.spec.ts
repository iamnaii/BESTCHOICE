import { ChatChannel } from '@prisma/client';
import {
  JOURNEY_CHAT_CHANNEL_LABELS,
  JOURNEY_ENTRY_KINDS,
  JOURNEY_HEARD_FROM_CODES,
  JOURNEY_HEARD_FROM_LABELS,
  JOURNEY_LOST_PROMPT_OUTCOMES,
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOMES,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  firstChatContactTitle,
  type JourneyEntryCreatedResponse,
  type JourneyEntryDeletedResponse,
  type JourneyEvent,
  type JourneyManualEntryInput,
  type JourneyStepEvidence,
  type JourneyStepState,
  type JourneySummary,
} from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { chatSource } from './sources/chat.source';

/**
 * สเปคของ packages/shared ไม่รันใน CI (deploy-gcp.yml รันแค่ jest ของ API / vitest ของเว็บ) ⇒ ตรึงสัญญาร่วมเฟส 3 ซ้ำที่นี่
 * ค่าที่คาดหวังเขียนตรง ๆ ไม่อ่านจาก shared — แก้ป้าย/ลำดับที่ shared แล้วไม่ได้ตั้งใจ = แดง
 * ส่วน "ชนิด" ถูกตรวจตอน ts-jest คอมไพล์ไฟล์นี้ (และ tsc --noEmit ของ apps/api ที่รวม src/**)
 */
const REQUEST_ID = '3f0c2b7e-9a41-4c55-8d2e-6b1f0a9c7d21';

describe('สัญญาร่วมเฟส 3 (@installment/shared) — ตรึงใน jest ของ API', () => {
  it('ช่องทาง/ผลการติดต่อ: ลำดับชิป · ป้ายไทย · ช่องทางที่บันทึกได้ไม่มี อื่น ๆ · ยาวไม่เกินคอลัมน์ entries', () => {
    expect(JOURNEY_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER']);
    expect(JOURNEY_TOUCH_CHANNEL_LABELS).toEqual({ PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' });
    expect(Object.keys(JOURNEY_TOUCH_CHANNEL_LABELS)).toEqual([...JOURNEY_TOUCH_CHANNELS]);
    expect(JOURNEY_RECORDABLE_TOUCH_CHANNELS).toEqual(['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN']);
    expect(JOURNEY_TOUCH_OUTCOMES).toEqual(['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED']);
    expect(JOURNEY_TOUCH_OUTCOME_LABELS).toEqual({
      APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ',
      NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ',
    });
    expect(Object.keys(JOURNEY_TOUCH_OUTCOME_LABELS)).toEqual([...JOURNEY_TOUCH_OUTCOMES]);
    for (const code of JOURNEY_TOUCH_CHANNELS) expect(code.length).toBeLessThanOrEqual(16); // customer_journey_entries.channel VARCHAR(16)
    for (const code of JOURNEY_TOUCH_OUTCOMES) expect(code.length).toBeLessThanOrEqual(20); // outcome VARCHAR(20)
  });

  it('เหตุผลหลุด 5 · รู้จักร้านจาก 9 เรียงตรงกับคีย์ป้ายเดิม · ผลที่ถาม "ติดป้ายหลุดไหม" 2 ตัว', () => {
    expect(JOURNEY_LOST_REASONS).toEqual(['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER']);
    expect(Object.keys(JOURNEY_LOST_REASON_LABELS)).toEqual([...JOURNEY_LOST_REASONS]);
    expect(JOURNEY_HEARD_FROM_CODES).toEqual(['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER']);
    expect(Object.keys(JOURNEY_HEARD_FROM_LABELS)).toEqual([...JOURNEY_HEARD_FROM_CODES]);
    expect(JOURNEY_LOST_PROMPT_OUTCOMES).toEqual({ BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE', NOT_INTERESTED: 'NOT_INTERESTED' });
    for (const code of JOURNEY_LOST_REASONS) expect(code.length).toBeLessThanOrEqual(20); // lost_reason VARCHAR(20)
    for (const code of JOURNEY_HEARD_FROM_CODES) expect(code.length).toBeLessThanOrEqual(16); // heard_from VARCHAR(16)
  });

  it('ป้ายช่องทางแชทครบทุกค่าของ enum ChatChannel · firstChatContactTitle', () => {
    expect(JOURNEY_CHAT_CHANNEL_LABELS).toEqual({ FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' });
    expect(Object.keys(JOURNEY_CHAT_CHANNEL_LABELS).sort()).toEqual(Object.values(ChatChannel).sort());
    expect(firstChatContactTitle('CHAT_FACEBOOK')).toBe('ทักแชทครั้งแรกทาง Facebook');
    expect(firstChatContactTitle('CHAT_LINE_FINANCE')).toBe('ทักแชทครั้งแรกทาง LINE การเงิน');
    expect(firstChatContactTitle('CHAT_INSTAGRAM')).toBe('ทักแชทครั้งแรกทาง INSTAGRAM');
    for (const notChat of ['WALK_IN', 'REFERRAL', 'UNKNOWN', 'AI_CHAT', 'CHAT_', '']) expect(firstChatContactTitle(notChat)).toBeNull();
  });

  it('ชนิด: body บันทึกมือ 4 แบบตาม JOURNEY_ENTRY_KINDS.MANUAL · OTHER บันทึกใหม่ไม่ได้ · สถานะ/หลักฐานขั้นใหม่ · ฟิลด์เลิกทำ · รูปคำตอบ POST/DELETE', () => {
    const inputs: JourneyManualEntryInput[] = [
      { kind: 'TOUCHPOINT', channel: 'LINE_APP', outcome: 'NO_ANSWER', clientRequestId: REQUEST_ID },
      { kind: 'HEARD_FROM', heardFrom: 'WALK_BY' },
      { kind: 'MARKED_LOST', lostReason: 'CREDIT_FAILED', clientRequestId: REQUEST_ID },
      { kind: 'REOPENED' },
    ];
    expect(inputs.map((input) => input.kind)).toEqual([...JOURNEY_ENTRY_KINDS.MANUAL]);
    // @ts-expect-error OTHER มีไว้อ่านแถวเก่า — body ใหม่รับเฉพาะ JourneyRecordableTouchChannel
    const legacyChannel: JourneyManualEntryInput = { kind: 'TOUCHPOINT', channel: 'OTHER', outcome: 'THINKING' };
    expect(legacyChannel.kind).toBe('TOUCHPOINT');

    const states: JourneyStepState[] = ['done', 'current', 'skipped', 'todo', 'not_needed'];
    const evidence: JourneyStepEvidence[] = ['SYSTEM', 'MANUAL', 'CHAT_FILE'];
    expect([states.length, evidence.length]).toEqual([5, 3]);

    const undo: Pick<JourneyEvent, 'entryId' | 'undoableUntil' | 'canDelete'> = { entryId: 'entry-row-1', undoableUntil: null, canDelete: false };
    expect(Object.keys(undo)).toEqual(['entryId', 'undoableUntil', 'canDelete']);

    const flags: Pick<JourneySummary, 'askHeardFrom' | 'creditFilePending'> = { askHeardFrom: false, creditFilePending: false };
    const created: JourneyEntryCreatedResponse = { entryId: null, event: null, summary: flags as JourneySummary };
    const deleted: JourneyEntryDeletedResponse = { summary: created.summary };
    expect(Object.keys(created)).toEqual(['entryId', 'event', 'summary']);
    expect(Object.keys(deleted)).toEqual(['summary']);
  });
});

describe('chatSource — ถ้อยคำแถวห้องแชทเท่าเดิมหลังย้ายป้ายช่องทางไป shared', () => {
  const OWNER = { id: 'o1', role: 'OWNER' };
  const at = (iso: string) => new Date(iso);
  /** ไม่มีข้อความ/นัด/ลีด/ลูกค้า — เหลือแถว "เปิดห้อง" อย่างเดียว เวลา = createdAt ของห้อง */
  function chatDb(rooms: Array<{ id: string; channel: string; createdAt: Date }>) {
    return {
      chatRoom: { findMany: jest.fn().mockResolvedValue(rooms) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      todo: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      // เฟส 3: chatSource อ่านแคช state เพื่อทำแถว "ร้านตอบครั้งแรก" ทุกครั้ง — ไม่มีแคช ⇒ ไม่มีแถวนั้น ถ้อยคำแถวเปิดห้องต้องเท่าเดิม
      customerJourneyState: { findUnique: jest.fn().mockResolvedValue(null) },
      // Task 6: roomEvents อ่านป้ายหลุดล่าสุดเพื่อทำแถว "กลับมาติดต่ออีกครั้ง" — ไม่มีป้าย ⇒ ถ้อยคำแถวเปิดห้องเท่าเดิม
      customerJourneyEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it.each([
    ['FACEBOOK', 'ทักแชทครั้งแรกทาง Facebook'],
    ['LINE_SHOP', 'ทักแชทครั้งแรกทาง LINE ร้าน'],
    ['LINE_FINANCE', 'ทักแชทครั้งแรกทาง LINE การเงิน'],
    ['TIKTOK', 'ทักแชทครั้งแรกทาง TikTok'],
    ['WEB', 'ทักแชทครั้งแรกทาง เว็บ'],
  ])('ห้องแรกทาง %s → "%s"', async (channel, title) => {
    const prisma = chatDb([{ id: `room-${channel}`, channel, createdAt: at('2026-09-01T03:00:00.000Z') }]);
    const events = await chatSource(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(events).toEqual([
      {
        id: `chatroom-room-${channel}`, type: 'CHAT_ROOM_OPENED', group: 'chat', stage: 'CONTACTED', timestamp: '2026-09-01T03:00:00.000Z',
        title, actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/room-${channel}`, metadata: { channel },
      },
    ]);
  });

  it('ห้องถัดไปตามเวลาขึ้นต้น "ทักเพิ่มทาง" ด้วยป้ายชุดเดียวกัน · ขั้น CONTACTED เฉพาะห้องแรก', async () => {
    const prisma = chatDb([
      { id: 'r-web', channel: 'WEB', createdAt: at('2026-09-05T03:00:00.000Z') },
      { id: 'r-line-finance', channel: 'LINE_FINANCE', createdAt: at('2026-09-01T03:00:00.000Z') },
      { id: 'r-line-shop', channel: 'LINE_SHOP', createdAt: at('2026-09-02T03:00:00.000Z') },
      { id: 'r-facebook', channel: 'FACEBOOK', createdAt: at('2026-09-03T03:00:00.000Z') },
      { id: 'r-tiktok', channel: 'TIKTOK', createdAt: at('2026-09-04T03:00:00.000Z') },
    ]);
    const events = await chatSource(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, OWNER);
    expect(Object.fromEntries(events.map((e) => [e.id, [e.title, e.stage]]))).toEqual({
      'chatroom-r-line-finance': ['ทักแชทครั้งแรกทาง LINE การเงิน', 'CONTACTED'],
      'chatroom-r-line-shop': ['ทักเพิ่มทาง LINE ร้าน', null],
      'chatroom-r-facebook': ['ทักเพิ่มทาง Facebook', null],
      'chatroom-r-tiktok': ['ทักเพิ่มทาง TikTok', null],
      'chatroom-r-web': ['ทักเพิ่มทาง เว็บ', null],
    });
  });
});
