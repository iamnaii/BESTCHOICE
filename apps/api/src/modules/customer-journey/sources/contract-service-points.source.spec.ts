import type { PrismaService } from '../../../prisma/prisma.service';
import { contractEventSources } from '../../overdue/contract-event-sources';
import { collectionsSource } from './collections.source';
import { paymentSource } from './payment.source';
import { pointsSource } from './points.source';
import { serviceSource } from './service.source';

jest.mock('../../overdue/contract-event-sources', () => ({ contractEventSources: jest.fn() }));

const at = (iso: string) => new Date(iso);
const OWNER = { id: 'o1', role: 'OWNER' };
const CALL = { id: 'call-1', type: 'CALL', timestamp: '2026-09-10T07:32:00.000Z', title: 'นัดชำระ', subtitle: 'แนน', metadata: { result: 'PROMISED', notes: 'โทร 0812345678', voiceMemoUrl: 'https://s/m.webm' } };
const ROWS = [
  { contractId: 'k1', actorUserId: 'u-nan', event: CALL },
  { contractId: 'k2', actorUserId: 'u-fin', event: { id: 'payment-1', type: 'PAYMENT', timestamp: '2026-09-09T03:00:00.000Z', title: 'ชำระ 4,200 ฿ (งวด 6)', metadata: { amount: '4200', method: 'TRANSFER' } } },
  { contractId: 'k1', actorUserId: null, event: { id: 'dunning-1', type: 'DUNNING_ACTION', timestamp: '2026-09-08T03:00:00.000Z', title: 'ส่ง LINE: เตือนก่อนครบกำหนด', subtitle: 'คุณสมชาย โทร 0812345678', metadata: { status: 'SENT', channel: 'LINE' } } },
  { contractId: 'k1', actorUserId: 'u-owner', event: { id: 'audit-1', type: 'STATUS_CHANGE', timestamp: '2026-09-06T00:00:00.000Z', title: 'สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE', metadata: { action: 'STATUS_CHANGE', newValue: { address: 'บ้านเลขที่ 1' } } } },
  { contractId: 'k1', actorUserId: null, event: { id: 'future-1', type: 'NEW_KIND', timestamp: '2026-09-04T00:00:00.000Z', title: 'ชนิดใหม่' } },
  { contractId: 'k-gone', actorUserId: null, event: { id: 'payment-orphan', type: 'PAYMENT', timestamp: '2026-09-03T00:00:00.000Z', title: 'ชำระ 1 ฿ (งวด 1)' } },
] as unknown as Awaited<ReturnType<typeof contractEventSources>>;

describe('paymentSource / collectionsSource', () => {
  const prisma = { contract: { findMany: jest.fn() } };
  const db = prisma as unknown as PrismaService;
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.contract.findMany.mockResolvedValue([{ id: 'k1', contractNumber: 'CT-2569-0042' }, { id: 'k2', contractNumber: 'CT-2569-0043' }]);
    jest.mocked(contractEventSources).mockResolvedValue(ROWS);
  });

  it('payment: เรียก contractEventSources ครั้งเดียวด้วยทุกสัญญาที่ไม่ใช่ร่าง + window (limit = scanTake) · เลขสัญญาจาก row.contractId · ผู้บันทึกจาก row.actorUserId · approximate', async () => {
    await expect(paymentSource(db, ['c1', 'p1'], { limit: 30 }, OWNER)).resolves.toEqual([
      { id: 'payment-1', type: 'PAYMENT_RECEIVED', group: 'payment', stage: null, timestamp: '2026-09-09T03:00:00.000Z', title: 'ชำระ 4,200 ฿ (งวด 6) · CT-2569-0043', actor: { type: 'STAFF', id: 'u-fin' }, reliability: 'approximate', origin: 'SOURCE', href: '/contracts/k2', metadata: { amount: '4200', method: 'TRANSFER' } },
    ]);
    expect(prisma.contract.findMany).toHaveBeenCalledWith({ where: { customerId: { in: ['c1', 'p1'] }, deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, contractNumber: true } });
    expect(contractEventSources).toHaveBeenCalledTimes(1);
    expect(contractEventSources).toHaveBeenCalledWith(db, ['k1', 'k2'], { before: undefined, from: undefined, to: undefined, limit: 231 });
  });

  it('cursor/from/to ส่งต่อถึง contractEventSources · ไม่มีสัญญา → ไม่ยิง', async () => {
    const window = { limit: 10, before: { ts: '2026-09-09T03:00:00.000Z', id: 'payment-9' }, from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-30T00:00:00.000Z') };
    await collectionsSource(db, ['c1'], window, OWNER);
    expect(contractEventSources).toHaveBeenCalledWith(db, ['k1', 'k2'], { before: window.before, from: window.from, to: window.to, limit: 211 });
    jest.clearAllMocks();
    prisma.contract.findMany.mockResolvedValue([]);
    await expect(paymentSource(db, ['c1'], { limit: 30 }, OWNER)).resolves.toEqual([]);
    expect(contractEventSources).not.toHaveBeenCalled();
  });

  it('collections: ตัดข้อความที่ส่ง โน้ต เสียง newValue และชนิดที่ไม่รู้จัก · ผู้โทรมี id จาก row · SALES ได้รูปเดียวกันและตัด PDPA ชุดเดียวกัน (OD-10)', async () => {
    const events = await collectionsSource(db, ['c1'], { limit: 30 }, OWNER);
    expect(events.map((e) => e.type)).toEqual(['COLLECTION_CALL', 'COLLECTION_DUNNING', 'CONTRACT_STATUS_CHANGE']);
    expect(events[0]).toMatchObject({ title: 'โทรติดตาม: นัดชำระ · CT-2569-0042', actor: { type: 'STAFF', id: 'u-nan', name: 'แนน' }, metadata: { result: 'PROMISED' } });
    expect(events[1]).not.toHaveProperty('subtitle');
    expect(events[2].metadata).toEqual({ action: 'STATUS_CHANGE' });
    expect(JSON.stringify(events)).not.toMatch(/0812345678|voiceMemoUrl|notes|newValue|บ้านเลขที่|คุณสมชาย|ชนิดใหม่/);
    // OD-10: SALES เห็นทั้งสองกลุ่ม — ต้องได้ผลเดียวกับ OWNER ทุกไบต์ (ไม่มีโน้ตโทร/ข้อความทวง/เบอร์) และ metadata อยู่ในชุดคีย์ที่อนุญาตเท่านั้น
    const SALES = { id: 's1', role: 'SALES' };
    const salesCollections = await collectionsSource(db, ['c1'], { limit: 30 }, SALES);
    const salesPayments = await paymentSource(db, ['c1'], { limit: 30 }, SALES);
    expect(salesCollections).toEqual(events);
    expect(salesPayments.map((e) => [e.id, e.metadata])).toEqual([['payment-1', { amount: '4200', method: 'TRANSFER' }]]);
    const salesJson = JSON.stringify([...salesCollections, ...salesPayments]);
    expect(salesJson).not.toMatch(/0812345678|voiceMemoUrl|notes|newValue|messageContent|บ้านเลขที่|คุณสมชาย|ชนิดใหม่/);
    const allowedMetadata = ['result', 'status', 'channel', 'action', 'letterNumber', 'amount', 'method'];
    for (const event of [...salesCollections, ...salesPayments]) {
      expect(event).not.toHaveProperty('subtitle');
      expect(Object.keys(event.metadata ?? {}).filter((key) => !allowedMetadata.includes(key))).toEqual([]);
    }
  });
});

describe('serviceSource / pointsSource', () => {
  it('ใบซ่อม + ประวัติสถานะ ลิงก์ /insurance/:id ไม่อ่านอาการเสีย/โน้ต/IMEI · แต้ม/แลกแต้ม ส่งช่วงเวลาไป DB', async () => {
    const prisma = {
      repairTicket: { findMany: jest.fn().mockResolvedValue([{ id: 't1', ticketNumber: 'RT-0001', deviceBrand: 'Apple', deviceModel: 'iPhone 15', createdAt: at('2026-09-01T03:00:00.000Z'), createdBy: { id: 'u1', name: 'แนน' },
        statusLogs: [{ id: 'l1', toStatus: 'READY_FOR_PICKUP', createdAt: at('2026-09-05T03:00:00.000Z'), changedBy: { id: 'u2', name: 'บอย' } }] }]) },
      loyaltyPoint: { findMany: jest.fn().mockResolvedValue([{ id: 'lp1', points: 42, reason: 'ON_TIME_PAYMENT', createdAt: at('2026-09-05T03:00:00.000Z'), contract: { contractNumber: 'CT-2569-0042' } }]) },
      loyaltyRedemption: { findMany: jest.fn().mockResolvedValue([{ id: 'lr1', points: 100, discountAmount: '100.00', createdAt: at('2026-09-06T03:00:00.000Z') }]) },
    };
    const db = prisma as unknown as PrismaService;
    const service = await serviceSource(db, ['c1'], { limit: 30 }, OWNER);
    expect(service.map((e) => [e.id, e.title, e.href])).toEqual([
      ['repairlog-l1', 'ใบซ่อม RT-0001: รอลูกค้ารับ', '/insurance/t1'],
      ['repair-t1', 'เปิดใบซ่อม/เคลม RT-0001 · Apple iPhone 15', '/insurance/t1'],
    ]);
    const select = prisma.repairTicket.findMany.mock.calls[0][0].select;
    for (const field of ['defectDescription', 'notes', 'deviceImei', 'deviceSerial']) expect(select).not.toHaveProperty(field);
    const points = await pointsSource(db, ['c1'], { limit: 2, before: { ts: '2026-09-10T00:00:00.000Z', id: 'zzz' } }, OWNER);
    expect(points.map((e) => [e.id, e.title, e.group])).toEqual([
      ['redeem-lr1', 'แลกแต้ม 100 แต้ม เป็นส่วนลด 100 บาท', 'points'],
      ['points-lp1', 'ได้แต้ม 42 แต้ม (จ่ายตรงเวลา · CT-2569-0042)', 'points'],
    ]);
    expect(prisma.loyaltyPoint.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: { in: ['c1'] }, deletedAt: null, createdAt: { lte: new Date('2026-09-10T00:00:00.000Z') } }, take: 203 }));
    expect(prisma.loyaltyRedemption.findMany.mock.calls[0][0].select).not.toHaveProperty('reason');
  });
});
