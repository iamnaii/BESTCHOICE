import { Prisma } from '@prisma/client';
import {
  CONTRACT_EVENT_SOURCE_TAKE,
  contractEventSources,
  type ContractEventPrisma,
} from './contract-event-sources';

function mockPrisma() {
  return {
    callLog: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    dunningAction: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    contractLetter: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

type MockPrisma = ReturnType<typeof mockPrisma>;
const asPrisma = (mock: MockPrisma) => mock as unknown as ContractEventPrisma;

function callRow(id: string, contractId: string, calledAtIso: string, callerId: string | null = null) {
  return {
    id,
    contractId,
    callerId,
    calledAt: new Date(calledAtIso),
    result: 'ANSWERED',
    notes: null,
    settlementDate: null,
    voiceMemoUrl: null,
    voiceMemoTier: null,
    caller: callerId ? { id: callerId, name: 'แนน' } : null,
  };
}

describe('contractEventSources', () => {
  it('contractIds ว่าง → คืน [] โดยไม่ query ฐานข้อมูล', async () => {
    const prisma = mockPrisma();
    await expect(contractEventSources(asPrisma(prisma), [])).resolves.toEqual([]);
    expect(prisma.callLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('หลายสัญญา ไม่ส่ง window → ทุก source ใช้ IN + ตัวกรองเดิมของ full-timeline + take 50', async () => {
    const prisma = mockPrisma();
    await contractEventSources(asPrisma(prisma), ['k1', 'k2']);

    expect(CONTRACT_EVENT_SOURCE_TAKE).toBe(50);
    expect(prisma.callLog.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] } },
      include: { caller: { select: { id: true, name: true } } },
      orderBy: { calledAt: 'desc' },
      take: 50,
    });
    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] }, status: 'PAID' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    expect(prisma.dunningAction.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] }, deletedAt: null },
      include: { dunningRule: { select: { name: true, channel: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        entity: { in: ['contract', 'mdm_lock_request'] },
        entityId: { in: ['k1', 'k2'] },
        action: { in: ['STATUS_CHANGE', 'DUNNING_ESCALATION_APPROVED', 'MDM_LOCK_APPROVED', 'MDM_UNLOCK'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    expect(prisma.contractLetter.findMany).toHaveBeenCalledWith({
      where: { contractId: { in: ['k1', 'k2'] }, deletedAt: null, status: { in: ['DISPATCHED', 'DELIVERED'] } },
      orderBy: { dispatchedAt: 'desc' },
      take: 50,
    });
  });

  it('window from/to/before/limit → ขอบบน = ค่าที่น้อยกว่าระหว่าง to กับ before.ts · หนังสือใช้ dispatchedAt ?? createdAt', async () => {
    const prisma = mockPrisma();
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-31T00:00:00.000Z');
    await contractEventSources(asPrisma(prisma), ['k1'], {
      from,
      to,
      before: { ts: '2026-08-20T00:00:00.000Z', id: 'payment-x' },
      limit: 11,
    });
    const range = { gte: from, lte: new Date('2026-08-20T00:00:00.000Z') };

    expect(prisma.callLog.findMany.mock.calls[0][0]).toMatchObject({ where: { contractId: { in: ['k1'] }, calledAt: range }, take: 11 });
    expect(prisma.payment.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'PAID', updatedAt: range }, take: 11 });
    expect(prisma.dunningAction.findMany.mock.calls[0][0]).toMatchObject({ where: { deletedAt: null, createdAt: range }, take: 11 });
    expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({ where: { entityId: { in: ['k1'] }, createdAt: range }, take: 11 });
    expect(prisma.contractLetter.findMany.mock.calls[0][0]).toMatchObject({
      where: { OR: [{ dispatchedAt: range }, { dispatchedAt: null, createdAt: range }] },
      take: 11,
    });
  });

  it('to เร็วกว่า before.ts และไม่มี from → lte = to อย่างเดียว', async () => {
    const prisma = mockPrisma();
    const to = new Date('2026-08-10T00:00:00.000Z');
    await contractEventSources(asPrisma(prisma), ['k1'], { to, before: { ts: '2026-09-01T00:00:00.000Z', id: 'call-z' } });
    expect(prisma.callLog.findMany.mock.calls[0][0].where).toEqual({ contractId: { in: ['k1'] }, calledAt: { lte: to } });
  });

  it('แถวผลลัพธ์ติด contractId + actorUserId ของแต่ละ source และคงลำดับ call → payment → dunning → audit → letter', async () => {
    const prisma = mockPrisma();
    prisma.callLog.findMany.mockResolvedValue([
      callRow('cl-1', 'k1', '2026-08-20T03:00:00.000Z', 'u-nan'),
      callRow('cl-2', 'k2', '2026-08-19T03:00:00.000Z'),
    ]);
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pm-1', contractId: 'k2', recordedById: 'u-fin', updatedAt: new Date('2026-08-21T03:00:00.000Z'), amountPaid: new Prisma.Decimal('4200'), installmentNo: 3, paymentMethod: 'CASH' },
    ]);
    prisma.dunningAction.findMany.mockResolvedValue([
      { id: 'da-1', contractId: 'k1', executedById: null, createdAt: new Date('2026-08-18T03:00:00.000Z'), channel: 'LINE', messageContent: null, status: 'SENT', dunningRule: { name: 'เตือน', channel: 'LINE' } },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'au-1', userId: 'u-owner', entity: 'contract', entityId: 'k2', action: 'STATUS_CHANGE', newValue: { from: 'ACTIVE', to: 'OVERDUE' }, createdAt: new Date('2026-08-17T03:00:00.000Z') },
    ]);
    prisma.contractLetter.findMany.mockResolvedValue([
      { id: 'lt-1', contractId: 'k1', dispatchedById: 'u-bm', createdAt: new Date('2026-08-15T03:00:00.000Z'), dispatchedAt: new Date('2026-08-16T03:00:00.000Z'), letterType: 'RETURN_DEVICE_45D', letterNumber: 'LT-1', trackingNumber: null, status: 'DISPATCHED' },
    ]);

    const rows = await contractEventSources(asPrisma(prisma), ['k1', 'k2']);

    expect(rows.map((row) => [row.contractId, row.actorUserId, row.event.id])).toEqual([
      ['k1', 'u-nan', 'call-cl-1'],
      ['k2', null, 'call-cl-2'],
      ['k2', 'u-fin', 'payment-pm-1'],
      ['k1', null, 'dunning-da-1'],
      ['k2', 'u-owner', 'audit-au-1'],
      ['k1', 'u-bm', 'letter-lt-1'],
    ]);
  });

  it('before → ตัด event ที่ (timestamp, id) ≥ cursor ทิ้ง · เวลาเท่ากันเทียบ id · cursor เขียนเวลาแบบ +07:00 ก็เทียบถูก', async () => {
    const prisma = mockPrisma();
    prisma.callLog.findMany.mockResolvedValue([
      callRow('cl-3', 'k1', '2026-08-20T03:00:00.000Z'),
      callRow('cl-2', 'k1', '2026-08-20T03:00:00.000Z'),
      callRow('cl-1', 'k1', '2026-08-20T02:59:00.000Z'),
    ]);

    const rows = await contractEventSources(asPrisma(prisma), ['k1'], {
      before: { ts: '2026-08-20T10:00:00.000+07:00', id: 'call-cl-3' },
    });

    expect(rows.map((row) => row.event.id)).toEqual(['call-cl-2', 'call-cl-1']);
  });
});
