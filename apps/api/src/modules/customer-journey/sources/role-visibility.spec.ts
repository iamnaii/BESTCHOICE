import type { JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { resolveJourneyGroups } from '../customer-journey.service';
import { chatSource } from './chat.source';
import { collectionsSource } from './collections.source';
import { customerContractEvents } from './contract-timeline';
import { creditSource } from './credit.source';
import { entriesSourceFor } from './entries.source';
import { paymentSource } from './payment.source';

// สมมติเจ้าของเคาะกลับข้อ b: SALES เห็นยอดชำระ/ติดตามหนี้แต่ไม่เห็นแชท · ACCOUNTANT เห็นแชท — แก้ที่ shared ที่เดียว ทุกแหล่งต้องตาม
jest.mock('@installment/shared', () => ({ ...jest.requireActual('@installment/shared'), JOURNEY_HIDDEN_GROUPS: { SALES: ['chat'] } }));
jest.mock('./contract-timeline', () => ({ customerContractEvents: jest.fn() }));

const SALES = { id: 's1', role: 'SALES' };
const ACCOUNTANT = { id: 'a1', role: 'ACCOUNTANT' };
const at = (iso: string) => new Date(iso);
/** แตะตารางไหนก็โยน — พิสูจน์ว่าแหล่งไม่ยิง DB */
const untouchable = new Proxy({}, { get: (_target, key) => { throw new Error(`ไม่ควรอ่าน prisma.${String(key)}`); } }) as unknown as PrismaService;

describe('กฎกลุ่มตามบทบาทมาจาก JOURNEY_HIDDEN_GROUPS ที่เดียว', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(customerContractEvents).mockResolvedValue([]);
  });

  it('resolveJourneyGroups + payment/collections ของ SALES ตามตาราง (ไม่มีชื่อบทบาทฝังในแหล่ง)', async () => {
    expect([...resolveJourneyGroups(undefined, 'SALES')]).toEqual(['credit', 'sale', 'collections', 'service']);
    expect([...resolveJourneyGroups(['chat', 'payment'], 'ACCOUNTANT')]).toEqual(['chat', 'payment']);
    await paymentSource(untouchable, ['c1'], { limit: 30 }, SALES);
    await collectionsSource(untouchable, ['c1'], { limit: 30 }, SALES);
    expect(customerContractEvents).toHaveBeenCalledTimes(2);
  });

  it('แชท · ลิงก์แชทใน entries · สเตทเม้นในเครดิต ตามกลุ่ม chat ของตาราง', async () => {
    await expect(chatSource(untouchable, ['c1'], { limit: 30 }, SALES)).resolves.toEqual([]);

    const credit = {
      creditCheck: { findMany: jest.fn().mockResolvedValue([{ id: 'cc-chat', createdAt: at('2026-09-02T03:00:00.000Z'), roomAnalysis: { roomId: 'r1' } }]) },
      customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([]) },
      roomCreditAnalysis: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      creditApproval: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const creditEvents = await creditSource(credit as unknown as PrismaService, ['c1'], { limit: 30 }, ACCOUNTANT);
    expect(credit.roomCreditAnalysis.findMany).toHaveBeenCalledTimes(1);
    expect(creditEvents[0]).toMatchObject({ id: 'credit-cc-chat', href: '/inbox/r1' });

    const entryRow = { id: 'handoff', kind: 'BOT_HANDOFF', origin: 'SYSTEM', occurredAt: at('2026-09-02T03:00:00.000Z'), actorType: 'BOT', roomId: 'r2', refType: null, refId: null, data: null, channel: null, outcome: null, lostReason: null, heardFrom: null, actorUser: null };
    const entries = { customerJourneyEntry: { findMany: jest.fn().mockResolvedValue([entryRow]) }, customerTag: { findMany: jest.fn() }, chatRoom: { findMany: jest.fn() } };
    const groups = new Set<JourneyEventGroup>(['chat']);
    await expect(entriesSourceFor(groups)(entries as unknown as PrismaService, ['c1'], { limit: 30 }, ACCOUNTANT)).resolves.toMatchObject([{ id: 'entry-handoff', href: '/inbox/r2' }]);
  });
});
