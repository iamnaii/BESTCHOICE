import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ContractSnapshotService } from './contract-snapshot.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ContractSnapshotService', () => {
  let service: ContractSnapshotService;
  let prisma: {
    contract: { findFirst: jest.Mock };
    payment: { aggregate: jest.Mock; count: jest.Mock };
    callLog: { findFirst: jest.Mock };
    chatMessage: { findFirst: jest.Mock };
  };

  const baseContract = {
    id: 'c1',
    contractNumber: 'BC-2026-001',
    status: 'OVERDUE',
    branchId: 'br1',
    customerId: 'cu1',
    totalMonths: 12,
    monthlyPayment: 1000,
    sellingPrice: 12000,
    downPayment: 0,
    interestTotal: 0,
    storeCommission: 0,
    vatAmount: 0,
    collectionNotes: '',
    updatedAt: new Date('2026-04-25T10:00:00Z'),
    customer: { id: 'cu1', name: 'นายทดสอบ', phone: '0812345678' },
    product: { name: 'iPhone 15 Pro' },
  };

  beforeEach(async () => {
    prisma = {
      contract: { findFirst: jest.fn() },
      payment: { aggregate: jest.fn(), count: jest.fn() },
      callLog: { findFirst: jest.fn() },
      chatMessage: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractSnapshotService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ContractSnapshotService);
  });

  it('throws NotFound when contract missing', async () => {
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.getSnapshot('missing')).rejects.toThrow(NotFoundException);
  });

  it('throws Forbidden when user from another branch lacks cross-branch access', async () => {
    prisma.contract.findFirst.mockResolvedValue(baseContract);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountDue: 0, amountPaid: 0 } });
    prisma.payment.count.mockResolvedValue(0);
    prisma.callLog.findFirst.mockResolvedValue(null);
    prisma.chatMessage.findFirst.mockResolvedValue(null);

    await expect(
      service.getSnapshot('c1', { id: 'u1', role: 'SALES', branchId: 'br2' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns lightweight snapshot with totals + remaining installments', async () => {
    prisma.contract.findFirst.mockResolvedValue({ ...baseContract, totalMonths: 12 });
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amountDue: 12000, amountPaid: 4500 },
    });
    prisma.payment.count.mockResolvedValue(4);
    prisma.callLog.findFirst.mockResolvedValue(null);
    prisma.chatMessage.findFirst.mockResolvedValue(null);

    const snap = await service.getSnapshot('c1');
    expect(snap.contractNumber).toBe('BC-2026-001');
    expect(snap.customer.name).toBe('นายทดสอบ');
    expect(snap.product.name).toBe('iPhone 15 Pro');
    expect(snap.totals.totalAmount).toBe(12000);
    expect(snap.totals.outstanding).toBe(7500);
    expect(snap.totals.installmentsRemaining).toBe(8);
    expect(snap.lastPromise).toBeNull();
    expect(snap.lastLine).toBeNull();
  });

  it('truncates collector comment > 100 chars and flags truncated', async () => {
    const longNote = 'ก'.repeat(150);
    prisma.contract.findFirst.mockResolvedValue({
      ...baseContract,
      collectionNotes: longNote,
    });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountDue: 0, amountPaid: 0 } });
    prisma.payment.count.mockResolvedValue(0);
    prisma.callLog.findFirst.mockResolvedValue(null);
    prisma.chatMessage.findFirst.mockResolvedValue(null);

    const snap = await service.getSnapshot('c1');
    expect(snap.lastCollectorComment?.truncated).toBe(true);
    expect(snap.lastCollectorComment?.text.length).toBe(101); // 100 chars + ellipsis
    expect(snap.lastCollectorComment?.text.endsWith('…')).toBe(true);
  });

  it('returns lastPromise BROKEN when callLog has brokenAt', async () => {
    prisma.contract.findFirst.mockResolvedValue(baseContract);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountDue: 0, amountPaid: 0 } });
    prisma.payment.count.mockResolvedValue(0);
    prisma.callLog.findFirst.mockResolvedValue({
      settlementDate: new Date('2026-04-20T00:00:00Z'),
      result: 'PROMISED',
      settlementNotes: 'จะโอนพรุ่งนี้',
      notes: null,
      brokenAt: new Date('2026-04-22T00:00:00Z'),
    });
    prisma.chatMessage.findFirst.mockResolvedValue(null);

    const snap = await service.getSnapshot('c1');
    expect(snap.lastPromise?.result).toBe('BROKEN');
    expect(snap.lastPromise?.notes).toBe('จะโอนพรุ่งนี้');
  });

  it('returns lastLine read=true when readAt set', async () => {
    prisma.contract.findFirst.mockResolvedValue(baseContract);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amountDue: 0, amountPaid: 0 } });
    prisma.payment.count.mockResolvedValue(0);
    prisma.callLog.findFirst.mockResolvedValue(null);
    prisma.chatMessage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-04-24T08:00:00Z'),
      readAt: new Date('2026-04-24T09:00:00Z'),
      deliveredAt: new Date('2026-04-24T08:00:01Z'),
    });

    const snap = await service.getSnapshot('c1');
    expect(snap.lastLine?.read).toBe(true);
    expect(snap.lastLine?.timestamp).toBe('2026-04-24T08:00:00.000Z');
  });

  it('clamps outstanding to >=0 even if amountPaid > amountDue (overpayment)', async () => {
    prisma.contract.findFirst.mockResolvedValue(baseContract);
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amountDue: 1000, amountPaid: 1500 },
    });
    prisma.payment.count.mockResolvedValue(1);
    prisma.callLog.findFirst.mockResolvedValue(null);
    prisma.chatMessage.findFirst.mockResolvedValue(null);

    const snap = await service.getSnapshot('c1');
    expect(snap.totals.outstanding).toBe(0);
  });
});
