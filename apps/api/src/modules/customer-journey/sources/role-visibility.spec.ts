import type { JourneyEventGroup } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { resolveJourneyGroups } from '../customer-journey.service';
import { chatSource } from './chat.source';
import { collectionsSource } from './collections.source';
import { customerContractEvents } from './contract-timeline';
import { creditSource } from './credit.source';
import { entriesSourceFor } from './entries.source';
import { paymentSource } from './payment.source';

// ตารางสมมติ (ไม่ใช่ค่าจริง — ค่าจริงหลัง OD-10 คือ { ACCOUNTANT: ['chat'] }): SALES ถูกซ่อนแชทแต่เห็นยอดชำระ/ติดตามหนี้ · ACCOUNTANT เห็นแชท
// พิสูจน์ว่าแก้ที่ shared ที่เดียวแล้วทุกแหล่งตาม (ไม่มีชื่อบทบาทฝังในแหล่ง)
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

  it('แถวไฟล์ในแชท · ร้านตอบครั้งแรก ตามกลุ่ม chat ของตาราง — บทบาทที่ถูกซ่อนไม่ได้ทั้งสองแถวและไม่ยิง DB · บทบาทที่เห็นได้ทั้งสองแถว', async () => {
    // ตารางสมมติของไฟล์นี้ซ่อน chat จาก SALES ⇒ ไม่แตะ prisma เลย (รวมแคช state ของแถวร้านตอบครั้งแรก)
    await expect(chatSource(untouchable, ['c1', 'p1'], { limit: 30 }, SALES)).resolves.toEqual([]);

    const chat = {
      chatRoom: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', channel: 'FACEBOOK', createdAt: at('2026-09-10T02:00:00.000Z') }]) },
      $queryRaw: jest.fn().mockResolvedValue([{
        roomId: 'r1', day: '2026-09-10', customer: 3, staff: 1, bot: 0, files: 2, lastFileAt: at('2026-09-10T02:07:00.000Z'),
        firstCustomerAt: at('2026-09-10T02:00:00.000Z'), lastAt: at('2026-09-10T02:15:00.000Z'),
      }]),
      todo: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      customerJourneyState: {
        findUnique: jest.fn().mockResolvedValue({ customerId: 'c1', firstStaffReplyAt: at('2026-09-10T02:15:00.000Z'), contactedAt: at('2026-09-10T02:00:00.000Z'), firstChannel: 'CHAT_FACEBOOK' }),
      },
    };
    const events = await chatSource(chat as unknown as PrismaService, ['c1', 'p1'], { limit: 30 }, ACCOUNTANT);
    expect(events.find((e) => e.type === 'CHAT_CUSTOMER_FILE')).toMatchObject({ id: 'chatfile-r1-2026-09-10', title: 'ลูกค้าส่งไฟล์ในแชท 2 ไฟล์', href: '/inbox/r1' });
    expect(events.find((e) => e.type === 'FIRST_STAFF_REPLY')).toMatchObject({ id: 'staffreply-c1', title: 'ร้านตอบครั้งแรก (หลังทัก 15 นาที)' });
    // ids[0] = ลูกค้าที่ยังมีชีวิต — ไม่ค้นแคชของ placeholder
    expect(chat.customerJourneyState.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'c1' } }));
  });
});
