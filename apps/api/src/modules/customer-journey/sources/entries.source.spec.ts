import type { JourneyEvent, JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { entriesSource, entriesSourceFor } from './entries.source';

jest.mock('../journey-data-schemas', () => ({
  JOURNEY_DATA_SCHEMAS: {
    PLACEHOLDER_MERGED: {
      safeParse: (v: { roomCount?: unknown }) =>
        typeof v?.roomCount === 'number'
          ? { success: true, data: { roomCount: v.roomCount } }
          : { success: false },
    },
    CREDIT_AI_SCORED: { safeParse: () => ({ success: false }) },
    // stub whitelist ของ EARLY_PAYOFF (zod จริงทดสอบใน journey-data-schemas.spec) — ตัดคีย์นอกรายการทิ้งเหมือนของจริง
    EARLY_PAYOFF: {
      safeParse: (v: { contractNumber?: unknown; receiptNumber?: unknown; totalPayoff?: unknown }) =>
        typeof v?.contractNumber === 'string' && typeof v?.totalPayoff === 'number'
          ? {
              success: true,
              data: {
                contractNumber: v.contractNumber,
                receiptNumber: v.receiptNumber ?? null,
                totalPayoff: v.totalPayoff,
              },
            }
          : { success: false },
    },
  },
}));

const at = (iso: string) => new Date(iso);
const entry = (o: Record<string, unknown>) => ({ origin: 'SYSTEM', actorType: 'STAFF', roomId: null, refType: null, refId: null, data: null, channel: null, outcome: null, lostReason: null, heardFrom: null, actorUser: null, createdAt: at('2026-09-01T00:00:00.000Z'), ...o });
const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);
function db() {
  return {
    customerJourneyEntry: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          entry({
            id: 'act',
            kind: 'CONTRACT_ACTIVATED',
            occurredAt: at('2026-09-05T03:00:00.000Z'),
            refType: 'contract',
            refId: 'k1',
            actorUser: { id: 'u1', name: 'แนน' },
          }),
          entry({
            id: 'merge',
            kind: 'PLACEHOLDER_MERGED',
            occurredAt: at('2026-09-04T03:00:00.000Z'),
            data: { roomCount: 2 },
          }),
          entry({
            id: 'ai',
            kind: 'CREDIT_AI_SCORED',
            occurredAt: at('2026-09-03T12:00:00.000Z'),
            actorType: 'SYSTEM',
            data: { phone: '0812345678' },
          }),
          entry({
            id: 'touch',
            kind: 'TOUCHPOINT',
            origin: 'MANUAL',
            occurredAt: at('2026-09-03T03:00:00.000Z'),
            channel: 'PHONE',
            outcome: 'APPOINTED',
          }),
          entry({
            id: 'handoff',
            kind: 'BOT_HANDOFF',
            occurredAt: at('2026-09-02T03:00:00.000Z'),
            actorType: 'BOT',
            roomId: 'r2',
          }),
          entry({
            id: 'future',
            kind: 'SOMETHING_NEW',
            occurredAt: at('2026-09-01T05:00:00.000Z'),
          }),
        ]),
    },
    customerTag: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'vip-target',
          tag: 'VIP',
          source: 'MANUAL',
          createdAt: at('2024-01-01T03:00:00.000Z'),
          deletedAt: null,
          appliedBy: { id: 'u1', name: 'แนน' },
        },
        {
          id: 'vip-dup',
          tag: 'VIP',
          source: 'MANUAL',
          createdAt: at('2026-08-01T03:00:00.000Z'),
          deletedAt: at('2026-09-10T00:00:00.000Z'),
          appliedBy: null,
        },
        {
          id: 'new',
          tag: 'NEW',
          source: 'AUTO',
          createdAt: at('2026-08-01T03:00:00.000Z'),
          deletedAt: at('2026-09-01T00:00:00.000Z'),
          appliedBy: null,
        },
      ]),
    },
    chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('entriesSource', () => {
  it('EARLY_PAYOFF แสดงใน sale พร้อมลิงก์สัญญาและ metadata เลขใบเสร็จ/ยอดปิดที่ผ่าน whitelist', async () => {
    const prisma = db();
    prisma.customerJourneyEntry.findMany.mockResolvedValue([
      entry({
        id: 'payoff',
        kind: 'EARLY_PAYOFF',
        occurredAt: at('2026-09-24T03:00:00.000Z'),
        refType: 'contract',
        refId: 'k1',
        actorUser: { id: 'u1', name: 'แนน' },
        data: {
          contractNumber: 'BCP2609-00042',
          receiptNumber: 'RT-202609-00042',
          totalPayoff: 18135.85,
          paymentMethod: 'BANK_TRANSFER',
        },
      }),
    ]);
    const events = await entriesSource(
      prisma as unknown as PrismaService,
      ['c1'],
      { limit: 30 },
      { id: 'o1', role: 'OWNER' },
    );
    expect(byId(events, 'entry-payoff')).toEqual({
      id: 'entry-payoff',
      type: 'EARLY_PAYOFF',
      group: 'sale',
      stage: null,
      timestamp: '2026-09-24T03:00:00.000Z',
      title: 'ปิดยอดก่อนกำหนด',
      actor: { type: 'STAFF', id: 'u1', name: 'แนน' },
      reliability: 'exact',
      origin: 'SYSTEM_ENTRY',
      href: '/contracts/k1',
      metadata: {
        contractNumber: 'BCP2609-00042',
        receiptNumber: 'RT-202609-00042',
        totalPayoff: 18135.85,
      },
    });
  });
  it('DEVICE_RETURNED แสดงใน sale พร้อมผู้ยืนยัน/สัญญา และป้าย RETURNED_DEVICE ภาษาไทย', async () => {
    const prisma = db();
    prisma.customerJourneyEntry.findMany.mockResolvedValue([
      entry({
        id: 'returned',
        kind: 'DEVICE_RETURNED',
        occurredAt: at('2026-09-20T03:00:00.000Z'),
        refType: 'contract',
        refId: 'k1',
        actorUser: { id: 'u1', name: 'แนน' },
      }),
    ]);
    prisma.customerTag.findMany.mockResolvedValue([
      {
        id: 'returned',
        tag: 'RETURNED_DEVICE',
        source: 'AUTO',
        createdAt: at('2026-09-20T03:00:00.000Z'),
        deletedAt: null,
        appliedBy: null,
      },
    ]);
    const events = await entriesSource(
      prisma as unknown as PrismaService,
      ['c1'],
      { limit: 30 },
      { id: 'o1', role: 'OWNER' },
    );
    expect(byId(events, 'entry-returned')).toEqual({
      id: 'entry-returned',
      type: 'DEVICE_RETURNED',
      group: 'sale',
      stage: null,
      timestamp: '2026-09-20T03:00:00.000Z',
      title: 'คืนเครื่อง',
      actor: { type: 'STAFF', id: 'u1', name: 'แนน' },
      reliability: 'exact',
      origin: 'SYSTEM_ENTRY',
      href: '/contracts/k1',
    });
    expect(byId(events, 'tag-returned')).toMatchObject({
      title: 'ติดแท็ก เคยคืนเครื่อง',
      actor: { type: 'SYSTEM' },
    });
  });
  it('kind → กลุ่ม/ขั้น/ลิงก์/origin · data ผ่าน whitelist เท่านั้น · kind ไม่รู้จักถูกทิ้ง · แท็กซ้ำจากการรวมไม่แสดง', async () => {
    const prisma = db();
    const events = await entriesSource(
      prisma as unknown as PrismaService,
      ['c1', 'p1'],
      { limit: 30 },
      { id: 'o1', role: 'OWNER' },
    );
    expect(events.map((e) => e.id)).toEqual([
      'entry-act',
      'entry-merge',
      'entry-ai',
      'entry-touch',
      'entry-handoff',
      'tag-removed-new',
      'tag-new',
      'tag-vip-target',
    ]);
    expect(byId(events, 'entry-act')).toEqual({
      id: 'entry-act',
      type: 'CONTRACT_ACTIVATED',
      group: 'sale',
      stage: 'PURCHASED',
      timestamp: '2026-09-05T03:00:00.000Z',
      title: 'เริ่มผ่อนสัญญา',
      actor: { type: 'STAFF', id: 'u1', name: 'แนน' },
      reliability: 'exact',
      origin: 'SYSTEM_ENTRY',
      href: '/contracts/k1',
    });
    expect(byId(events, 'entry-merge')).toMatchObject({
      group: 'chat',
      stage: 'IDENTIFIED',
      title: 'รวมประวัติแชท 2 ห้องเข้ากับลูกค้าคนนี้',
      metadata: { roomCount: 2 },
    });
    expect(byId(events, 'entry-ai')).toMatchObject({
      group: 'credit',
      title: 'AI ประเมินเครดิตแล้ว',
      actor: { type: 'SYSTEM' },
    });
    expect(byId(events, 'entry-ai')).not.toHaveProperty('metadata');
    expect(byId(events, 'entry-touch')).toMatchObject({
      stage: 'INTERESTED',
      origin: 'MANUAL',
      title: 'ติดต่อทางโทร: นัดแล้ว',
    });
    expect(byId(events, 'entry-handoff')).toMatchObject({
      group: 'chat',
      actor: { type: 'BOT' },
      href: '/inbox/r2',
    });
    expect(byId(events, 'tag-removed-new')).toMatchObject({
      group: 'system',
      title: 'ถอดแท็ก ลูกค้าใหม่',
      actor: null,
    });
    expect(byId(events, 'tag-new')).toMatchObject({ actor: { type: 'SYSTEM' } });
    expect(JSON.stringify(events)).not.toContain('0812345678');
    const args = prisma.customerJourneyEntry.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ customerId: { in: ['c1', 'p1'] }, deletedAt: null });
    expect(args.where.kind).toEqual({
      in: [
        'CONTRACT_ACTIVATED',
        'CONTRACT_REVIEWED',
        'DEVICE_RETURNED',
        'EARLY_PAYOFF',
        'CREDIT_AI_SCORED',
        'BOT_HANDOFF',
        'CONTACT_ADDED',
        'LINE_LINKED',
        'PRODUCT_LINK_CLICK',
        'PLACEHOLDER_MERGED',
        'TOUCHPOINT',
        'HEARD_FROM',
        'MARKED_LOST',
        'REOPENED',
      ],
    });
    expect(args.select).not.toHaveProperty('note');
  });

  it('SALES: บันทึกที่ผูกห้องที่คนอื่นดูแลถูกทิ้ง · ACCOUNTANT: ไม่มีลิงก์แชท', async () => {
    const sales = db();
    const salesEvents = await entriesSource(
      sales as unknown as PrismaService,
      ['c1'],
      { limit: 30 },
      { id: 's1', role: 'SALES' },
    );
    expect(sales.chatRoom.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['r2'] }, OR: [{ assignedToId: null }, { assignedToId: 's1' }] },
      select: { id: true },
    });
    expect(byId(salesEvents, 'entry-handoff')).toBeUndefined();
    const accountant = db();
    const accEvents = await entriesSource(
      accountant as unknown as PrismaService,
      ['c1'],
      { limit: 30 },
      { id: 'a1', role: 'ACCOUNTANT' },
    );
    expect(accountant.chatRoom.findMany).not.toHaveBeenCalled();
    expect(byId(accEvents, 'entry-handoff')).not.toHaveProperty('href');
  });

  it('entriesSourceFor: DB กรอง kind ตามกลุ่มที่ขอ · อ่านแท็กเฉพาะกลุ่มระบบ · ป้ายหลุด/รู้จักร้านมาจาก shared', async () => {
    const chat = db();
    chat.customerJourneyEntry.findMany.mockResolvedValue([
      entry({
        id: 'lost',
        kind: 'MARKED_LOST',
        origin: 'MANUAL',
        occurredAt: at('2026-09-06T03:00:00.000Z'),
        lostReason: 'BOUGHT_ELSEWHERE',
      }),
      entry({
        id: 'heard',
        kind: 'HEARD_FROM',
        origin: 'MANUAL',
        occurredAt: at('2026-09-05T03:00:00.000Z'),
        heardFrom: 'FRIEND',
      }),
      entry({
        id: 'act',
        kind: 'CONTRACT_ACTIVATED',
        occurredAt: at('2026-09-04T03:00:00.000Z'),
        refType: 'contract',
        refId: 'k1',
      }),
    ]);
    const chatEvents = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(
      chat as unknown as PrismaService,
      ['c1'],
      { limit: 30 },
      { id: 'o1', role: 'OWNER' },
    );
    expect(chat.customerJourneyEntry.findMany.mock.calls[0][0].where.kind).toEqual({
      in: [
        'BOT_HANDOFF',
        'CONTACT_ADDED',
        'LINE_LINKED',
        'PRODUCT_LINK_CLICK',
        'PLACEHOLDER_MERGED',
        'TOUCHPOINT',
        'HEARD_FROM',
        'MARKED_LOST',
        'REOPENED',
      ],
    });
    expect(chat.customerTag.findMany).not.toHaveBeenCalled();
    // แถวกลุ่มอื่นที่หลุดมา (mock ไม่กรอง where) ถูกทิ้งฝั่งโค้ดด้วย
    expect(chatEvents.map((e) => [e.id, e.title])).toEqual([
      ['entry-lost', 'ติดป้ายหลุด: ซื้อที่อื่น'],
      ['entry-heard', 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'],
    ]);

    const system = db();
    const systemEvents = await entriesSourceFor(new Set<JourneyEventGroup>(['system']))(
      system as unknown as PrismaService,
      ['c1'],
      { limit: 30 },
      { id: 'o1', role: 'OWNER' },
    );
    expect(system.customerJourneyEntry.findMany).not.toHaveBeenCalled();
    expect(systemEvents.map((e) => e.id)).toEqual(['tag-removed-new', 'tag-new', 'tag-vip-target']);
  });

  it('ถ้อยคำบันทึกมือเท่าเดิมทุกไบต์: ช่องทาง 5 × ผล 7 · รหัสไม่รู้จัก · รู้จักร้านจาก 9 · เหตุผลหลุด 5 · เปิดใหม่', async () => {
    // ค่าคาดหวังคัดลอกจากแผนที่เดิมใน entries.source.ts (ก่อนย้ายไป shared) — ห้ามอ่านจาก shared ไม่งั้นเทสนี้ไม่ตรึงอะไร
    const CHANNEL_TEXT: Record<string, string> = { PHONE: 'โทร', FB_APP: 'แชทในแอป FB', LINE_APP: 'LINE', WALK_IN: 'หน้าร้าน', OTHER: 'อื่น ๆ' };
    const OUTCOME_TEXT: Record<string, string> = { APPOINTED: 'นัดแล้ว', VISITED: 'มาร้านแล้ว', THINKING: 'ขอคิดก่อน', BUDGET: 'งบ/ดาวน์ไม่พอ', NO_ANSWER: 'ไม่รับสาย', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', NOT_INTERESTED: 'ไม่สนใจ' };
    const HEARD_TEXT: Record<string, string> = { FB_AD: 'โฆษณา FB', FB_PAGE: 'เพจ/โพสต์', TIKTOK: 'TikTok', LINE: 'LINE', GOOGLE: 'Google', FRIEND: 'เพื่อนแนะนำ', WALK_BY: 'ผ่านหน้าร้าน', OLD_CUSTOMER: 'ลูกค้าเก่า', OTHER: 'อื่น ๆ' };
    const LOST_TEXT: Record<string, string> = { NOT_INTERESTED: 'ไม่สนใจ', BOUGHT_ELSEWHERE: 'ซื้อที่อื่น', CREDIT_FAILED: 'เครดิตไม่ผ่าน', UNREACHABLE: 'ติดต่อไม่ได้', OTHER: 'อื่น ๆ' };
    const rows: Record<string, unknown>[] = [];
    const expected: Record<string, [string, string | null]> = {};
    let minute = 0;
    const push = (id: string, fields: Record<string, unknown>, title: string, stage: string | null) => {
      rows.push(entry({ id, origin: 'MANUAL', occurredAt: new Date(Date.UTC(2026, 8, 1, 3, minute++)), ...fields }));
      expected[`entry-${id}`] = [title, stage];
    };
    for (const channel of Object.keys(CHANNEL_TEXT)) {
      for (const outcome of Object.keys(OUTCOME_TEXT)) {
        const stage = outcome === 'APPOINTED' || outcome === 'VISITED' ? 'INTERESTED' : null;
        push(`touch-${channel}-${outcome}`, { kind: 'TOUCHPOINT', channel, outcome }, `ติดต่อทาง${CHANNEL_TEXT[channel]}: ${OUTCOME_TEXT[outcome]}`, stage);
      }
    }
    push('touch-unknown', { kind: 'TOUCHPOINT', channel: 'SMS', outcome: null }, 'ติดต่อทางอื่น ๆ: บันทึกแล้ว', null);
    for (const code of Object.keys(HEARD_TEXT)) push(`heard-${code}`, { kind: 'HEARD_FROM', heardFrom: code }, `ลูกค้าบอกว่ารู้จักร้านจาก${HEARD_TEXT[code]}`, null);
    push('heard-unknown', { kind: 'HEARD_FROM', heardFrom: 'RADIO' }, 'ลูกค้าบอกว่ารู้จักร้านจากอื่น ๆ', null);
    for (const code of Object.keys(LOST_TEXT)) push(`lost-${code}`, { kind: 'MARKED_LOST', lostReason: code }, `ติดป้ายหลุด: ${LOST_TEXT[code]}`, null);
    push('lost-unknown', { kind: 'MARKED_LOST', lostReason: null }, 'ติดป้ายหลุด: อื่น ๆ', null);
    push('reopen', { kind: 'REOPENED' }, 'เปิดใหม่', null);

    const prisma = db();
    prisma.customerJourneyEntry.findMany.mockResolvedValue(rows);
    const events = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(prisma as unknown as PrismaService, ['c1'], { limit: 100 }, { id: 'o1', role: 'OWNER' });

    expect(events).toHaveLength(53); // 35 + 1 + 9 + 1 + 5 + 1 + 1
    expect(Object.fromEntries(events.map((e) => [e.id, [e.title, e.stage]]))).toEqual(expected);
    expect(events.every((e) => e.group === 'chat' && e.origin === 'MANUAL')).toBe(true);
  });

  describe('แถว MANUAL: entryId / undoableUntil / canDelete ตามผู้ดู (TimelineRows e1-e5)', () => {
    const NOW = new Date('2026-09-15T10:00:00.000Z');
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const until = (createdAt: Date) => new Date(createdAt.getTime() + 24 * HOUR).toISOString();
    const SOMSRI = { id: 'staff-somsri', name: 'สมศรี ตัวอย่าง' };
    const MANA = { id: 'staff-mana', name: 'มานะ ทดสอบ' };
    const rows = [
      entry({ id: 'e1', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(5 * MINUTE), createdAt: ago(5 * MINUTE), channel: 'PHONE', outcome: 'APPOINTED', actorUser: SOMSRI }),
      entry({ id: 'e5', kind: 'MARKED_LOST', origin: 'MANUAL', occurredAt: ago(2 * HOUR), createdAt: ago(2 * HOUR), lostReason: 'NOT_INTERESTED', actorUser: MANA }),
      entry({ id: 'e4', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(3 * HOUR), createdAt: ago(3 * HOUR), channel: 'LINE_APP', outcome: 'APPOINTED', actorUser: MANA }),
      entry({ id: 'e2', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(22 * HOUR), createdAt: ago(22 * HOUR), channel: 'WALK_IN', outcome: 'THINKING', actorUser: SOMSRI }),
      entry({ id: 'e3', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: ago(29 * HOUR), createdAt: ago(29 * HOUR), channel: 'PHONE', outcome: 'NO_ANSWER', actorUser: SOMSRI }),
      entry({ id: 'sys', kind: 'CONTACT_ADDED', occurredAt: ago(30 * HOUR), createdAt: ago(30 * HOUR), actorUser: SOMSRI }),
    ];
    async function view(actor: { id: string; role: string }) {
      const prisma = db();
      prisma.customerJourneyEntry.findMany.mockResolvedValue(rows);
      const events = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(prisma as unknown as PrismaService, ['c1'], { limit: 30 }, actor);
      return { prisma, events };
    }
    const undo = (events: JourneyEvent[], id: string) => {
      const event = byId(events, `entry-${id}`);
      if (!event) throw new Error(`ไม่พบแถว entry-${id}`);
      return { entryId: event.entryId, undoableUntil: event.undoableUntil, canDelete: event.canDelete };
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('SALES (สมศรี): e1/e2 ของตัวเองในหน้าต่างเลิกทำได้ · e3 เกิน 24 ชม. · e4/e5 ของคนอื่นไม่ได้ · แถว SYSTEM ไม่มีคีย์ · select มี createdAt ไม่มี note', async () => {
      const { prisma, events } = await view({ id: SOMSRI.id, role: 'SALES' });
      expect(undo(events, 'e1')).toEqual({ entryId: 'e1', undoableUntil: until(ago(5 * MINUTE)), canDelete: true });
      expect(undo(events, 'e2')).toEqual({ entryId: 'e2', undoableUntil: until(ago(22 * HOUR)), canDelete: true });
      expect(undo(events, 'e3')).toEqual({ entryId: 'e3', undoableUntil: null, canDelete: false });
      expect(undo(events, 'e4')).toEqual({ entryId: 'e4', undoableUntil: null, canDelete: false });
      expect(undo(events, 'e5')).toEqual({ entryId: 'e5', undoableUntil: null, canDelete: false });
      const system = byId(events, 'entry-sys');
      expect(system).toBeDefined();
      for (const key of ['entryId', 'undoableUntil', 'canDelete']) expect(system).not.toHaveProperty(key);
      const args = prisma.customerJourneyEntry.findMany.mock.calls[0][0];
      expect(args.select).toHaveProperty('createdAt', true);
      expect(args.select).not.toHaveProperty('note');
    });

    it('FINANCE_MANAGER: แถวของพนักงานอื่นเลิกทำไม่ได้', async () => {
      const { events } = await view({ id: 'fm-1', role: 'FINANCE_MANAGER' });
      expect(undo(events, 'e4')).toEqual({ entryId: 'e4', undoableUntil: null, canDelete: false });
      expect(undo(events, 'e1')).toEqual({ entryId: 'e1', undoableUntil: null, canDelete: false });
    });

    it.each(['OWNER', 'BRANCH_MANAGER'])('%s: ทุกแถวที่พนักงานกดเลิกทำได้ ไม่จำกัด 24 ชม. (e5) · undoableUntil เป็น null เพราะไม่ใช่ผู้บันทึก', async (role) => {
      const { events } = await view({ id: `viewer-${role}`, role });
      for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) expect(undo(events, id)).toEqual({ entryId: id, undoableUntil: null, canDelete: true });
    });
  });
});
