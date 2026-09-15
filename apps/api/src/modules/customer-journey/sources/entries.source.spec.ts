import type { JourneyEvent, JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { entriesSource, entriesSourceFor } from './entries.source';

jest.mock('../journey-data-schemas', () => ({
  JOURNEY_DATA_SCHEMAS: {
    PLACEHOLDER_MERGED: { safeParse: (v: { roomCount?: unknown }) => (typeof v?.roomCount === 'number' ? { success: true, data: { roomCount: v.roomCount } } : { success: false }) },
    CREDIT_AI_SCORED: { safeParse: () => ({ success: false }) },
  },
}));

const at = (iso: string) => new Date(iso);
const entry = (o: Record<string, unknown>) => ({ origin: 'SYSTEM', actorType: 'STAFF', roomId: null, refType: null, refId: null, data: null, channel: null, outcome: null, lostReason: null, heardFrom: null, actorUser: null, ...o });
const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);
function db() {
  return {
    customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([
      entry({ id: 'act', kind: 'CONTRACT_ACTIVATED', occurredAt: at('2026-09-05T03:00:00.000Z'), refType: 'contract', refId: 'k1', actorUser: { id: 'u1', name: 'แนน' } }),
      entry({ id: 'merge', kind: 'PLACEHOLDER_MERGED', occurredAt: at('2026-09-04T03:00:00.000Z'), data: { roomCount: 2 } }),
      entry({ id: 'ai', kind: 'CREDIT_AI_SCORED', occurredAt: at('2026-09-03T12:00:00.000Z'), actorType: 'SYSTEM', data: { phone: '0812345678' } }),
      entry({ id: 'touch', kind: 'TOUCHPOINT', origin: 'MANUAL', occurredAt: at('2026-09-03T03:00:00.000Z'), channel: 'PHONE', outcome: 'APPOINTED' }),
      entry({ id: 'handoff', kind: 'BOT_HANDOFF', occurredAt: at('2026-09-02T03:00:00.000Z'), actorType: 'BOT', roomId: 'r2' }),
      entry({ id: 'future', kind: 'SOMETHING_NEW', occurredAt: at('2026-09-01T05:00:00.000Z') }),
    ]) },
    customerTag: { findMany: jest.fn().mockResolvedValue([
      { id: 'vip-target', tag: 'VIP', source: 'MANUAL', createdAt: at('2024-01-01T03:00:00.000Z'), deletedAt: null, appliedBy: { id: 'u1', name: 'แนน' } },
      { id: 'vip-dup', tag: 'VIP', source: 'MANUAL', createdAt: at('2026-08-01T03:00:00.000Z'), deletedAt: at('2026-09-10T00:00:00.000Z'), appliedBy: null },
      { id: 'new', tag: 'NEW', source: 'AUTO', createdAt: at('2026-08-01T03:00:00.000Z'), deletedAt: at('2026-09-01T00:00:00.000Z'), appliedBy: null },
    ]) },
    chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('entriesSource', () => {
  it('kind → กลุ่ม/ขั้น/ลิงก์/origin · data ผ่าน whitelist เท่านั้น · kind ไม่รู้จักถูกทิ้ง · แท็กซ้ำจากการรวมไม่แสดง', async () => {
    const prisma = db();
    const events = await entriesSource(prisma as unknown as PrismaService, ['c1', 'p1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(events.map((e) => e.id)).toEqual(['entry-act', 'entry-merge', 'entry-ai', 'entry-touch', 'entry-handoff', 'tag-removed-new', 'tag-new', 'tag-vip-target']);
    expect(byId(events, 'entry-act')).toEqual({ id: 'entry-act', type: 'CONTRACT_ACTIVATED', group: 'sale', stage: 'PURCHASED', timestamp: '2026-09-05T03:00:00.000Z', title: 'เริ่มผ่อนสัญญา', actor: { type: 'STAFF', id: 'u1', name: 'แนน' }, reliability: 'exact', origin: 'SYSTEM_ENTRY', href: '/contracts/k1' });
    expect(byId(events, 'entry-merge')).toMatchObject({ group: 'chat', stage: 'IDENTIFIED', title: 'รวมประวัติแชท 2 ห้องเข้ากับลูกค้าคนนี้', metadata: { roomCount: 2 } });
    expect(byId(events, 'entry-ai')).toMatchObject({ group: 'credit', title: 'AI ประเมินเครดิตแล้ว', actor: { type: 'SYSTEM' } });
    expect(byId(events, 'entry-ai')).not.toHaveProperty('metadata');
    expect(byId(events, 'entry-touch')).toMatchObject({ stage: 'INTERESTED', origin: 'MANUAL', title: 'ติดต่อทางโทร: นัดแล้ว' });
    expect(byId(events, 'entry-handoff')).toMatchObject({ group: 'chat', actor: { type: 'BOT' }, href: '/inbox/r2' });
    expect(byId(events, 'tag-removed-new')).toMatchObject({ group: 'system', title: 'ถอดแท็ก ลูกค้าใหม่', actor: null });
    expect(byId(events, 'tag-new')).toMatchObject({ actor: { type: 'SYSTEM' } });
    expect(JSON.stringify(events)).not.toContain('0812345678');
    const args = prisma.customerJourneyEntry.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ customerId: { in: ['c1', 'p1'] }, deletedAt: null });
    expect(args.where.kind).toEqual({ in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED', 'CREDIT_AI_SCORED', 'BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
    expect(args.select).not.toHaveProperty('note');
  });

  it('SALES: บันทึกที่ผูกห้องที่คนอื่นดูแลถูกทิ้ง · ACCOUNTANT: ไม่มีลิงก์แชท', async () => {
    const sales = db();
    const salesEvents = await entriesSource(sales as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 's1', role: 'SALES' });
    expect(sales.chatRoom.findMany).toHaveBeenCalledWith({ where: { id: { in: ['r2'] }, OR: [{ assignedToId: null }, { assignedToId: 's1' }] }, select: { id: true } });
    expect(byId(salesEvents, 'entry-handoff')).toBeUndefined();
    const accountant = db();
    const accEvents = await entriesSource(accountant as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'a1', role: 'ACCOUNTANT' });
    expect(accountant.chatRoom.findMany).not.toHaveBeenCalled();
    expect(byId(accEvents, 'entry-handoff')).not.toHaveProperty('href');
  });

  it('entriesSourceFor: DB กรอง kind ตามกลุ่มที่ขอ · อ่านแท็กเฉพาะกลุ่มระบบ · ป้ายหลุด/รู้จักร้านมาจาก shared', async () => {
    const chat = db();
    chat.customerJourneyEntry.findMany.mockResolvedValue([
      entry({ id: 'lost', kind: 'MARKED_LOST', origin: 'MANUAL', occurredAt: at('2026-09-06T03:00:00.000Z'), lostReason: 'BOUGHT_ELSEWHERE' }),
      entry({ id: 'heard', kind: 'HEARD_FROM', origin: 'MANUAL', occurredAt: at('2026-09-05T03:00:00.000Z'), heardFrom: 'FRIEND' }),
      entry({ id: 'act', kind: 'CONTRACT_ACTIVATED', occurredAt: at('2026-09-04T03:00:00.000Z'), refType: 'contract', refId: 'k1' }),
    ]);
    const chatEvents = await entriesSourceFor(new Set<JourneyEventGroup>(['chat']))(chat as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(chat.customerJourneyEntry.findMany.mock.calls[0][0].where.kind).toEqual({ in: ['BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
    expect(chat.customerTag.findMany).not.toHaveBeenCalled();
    // แถวกลุ่มอื่นที่หลุดมา (mock ไม่กรอง where) ถูกทิ้งฝั่งโค้ดด้วย
    expect(chatEvents.map((e) => [e.id, e.title])).toEqual([
      ['entry-lost', 'ติดป้ายหลุด: ซื้อที่อื่น'],
      ['entry-heard', 'ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'],
    ]);

    const system = db();
    const systemEvents = await entriesSourceFor(new Set<JourneyEventGroup>(['system']))(system as unknown as PrismaService, ['c1'], { limit: 30 }, { id: 'o1', role: 'OWNER' });
    expect(system.customerJourneyEntry.findMany).not.toHaveBeenCalled();
    expect(systemEvents.map((e) => e.id)).toEqual(['tag-removed-new', 'tag-new', 'tag-vip-target']);
  });
});
