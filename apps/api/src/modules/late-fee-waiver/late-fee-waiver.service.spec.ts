import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LateFeeWaiverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import { LateFeeWaiverService } from './late-fee-waiver.service';

/**
 * Focused tests covering the create → approve → reject lifecycle and the
 * invariants the service must guard:
 *   - approve waives only the fee the ledger has not collected
 *   - approve settles (PAID + completion) only when the principal is covered
 *   - create skips PAID rows / rows with nothing waivable
 *   - approve/reject only operate on PENDING rows
 *   - SoD: requester ≠ approver
 * DB-backed counterpart with real receipt journal entries:
 * payments/services/late-fee-waiver-settlement.integration.spec.ts
 */

const D = (v: number | string) => new Prisma.Decimal(v);

const tx = {
  lateFeeWaiverRequest: { findFirst: jest.fn(), update: jest.fn() },
  payment: { findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  contract: { findFirst: jest.fn(), update: jest.fn() },
  feeWaiverApproval: { create: jest.fn() },
  journalEntry: { findMany: jest.fn() },
  callLog: { updateMany: jest.fn() },
};

const mockPrisma = {
  contract: { findFirst: jest.fn() },
  payment: { findMany: jest.fn() },
  journalEntry: { findMany: jest.fn() },
  lateFeeWaiverRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
};

const audit = { logPaymentEvent: jest.fn() };
const products = { transferOwnership: jest.fn() };

const pendingRequest = (paymentIds: string[]) => ({
  id: 'req-1',
  contractId: 'c-1',
  status: LateFeeWaiverStatus.PENDING,
  requesterUserId: 'user-collector',
  paymentIds,
  reason: 'ลูกค้าป่วย',
});

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  contractId: 'c-1',
  installmentNo: 1,
  status: 'OVERDUE',
  amountDue: D('1515.83'),
  amountPaid: D(0),
  lateFee: D(100),
  lateFeeWaived: false,
  notes: null,
  deletedAt: null,
  ...overrides,
});

/** Receipt JE crediting `fee` to 42-1103 for `paymentId`. */
const feeEntry = (paymentId: string, fee: number) => ({
  metadata: { tag: 'receipt', paymentId },
  status: 'POSTED',
  deletedAt: null,
  lines: [{ accountCode: '42-1103', debit: D(0), credit: D(fee), deletedAt: null }],
});

describe('LateFeeWaiverService', () => {
  let service: LateFeeWaiverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    tx.lateFeeWaiverRequest.findFirst.mockResolvedValue({ status: LateFeeWaiverStatus.PENDING });
    tx.lateFeeWaiverRequest.update.mockImplementation((args: { data: object }) =>
      Promise.resolve({ id: 'req-1', ...args.data }),
    );
    tx.payment.update.mockResolvedValue({});
    tx.payment.count.mockResolvedValue(1); // checkContractCompletion: something still unpaid
    tx.contract.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    tx.feeWaiverApproval.create.mockResolvedValue({});
    tx.journalEntry.findMany.mockResolvedValue([]);
    mockPrisma.journalEntry.findMany.mockResolvedValue([]);
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LateFeeWaiverService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: audit },
        { provide: ProductsService, useValue: products },
      ],
    }).compile();
    service = mod.get(LateFeeWaiverService);
  });

  describe('create()', () => {
    it('snapshots totalWaiveAmount from the listed payments and persists PENDING', async () => {
      mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.payment.findMany.mockResolvedValue([
        row('p-1', { lateFee: D(150) }),
        row('p-2', { lateFee: D(250) }),
      ]);
      mockPrisma.lateFeeWaiverRequest.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({ id: 'req-1', ...args.data }),
      );

      const result = await service.create(
        { contractId: 'c-1', paymentIds: ['p-1', 'p-2'], reason: 'ลูกค้าป่วยเข้า รพ.' },
        'user-collector',
      );

      expect(result.status).toBe(LateFeeWaiverStatus.PENDING);
      expect(result.totalWaiveAmount.toString()).toBe('400');
      expect(result.requesterUserId).toBe('user-collector');
      expect(result.paymentIds).toEqual(['p-1', 'p-2']);
    });

    it('rejects when one of the requested payments is already waived (count mismatch)', async () => {
      mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.payment.findMany.mockResolvedValue([row('p-1', { lateFee: D(150) })]);

      await expect(
        service.create(
          { contractId: 'c-1', paymentIds: ['p-1', 'p-2'], reason: 'reason ok' },
          'user-collector',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips PAID rows and rows whose fee the ledger already collected', async () => {
      mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.payment.findMany.mockResolvedValue([
        row('p-open'),
        row('p-paid', { status: 'PAID', amountPaid: D('1615.83') }),
        // fee-first receipt of exactly amountDue: the 100 fee is already income
        row('p-collected', { status: 'PARTIALLY_PAID', amountPaid: D('1515.83') }),
      ]);
      mockPrisma.journalEntry.findMany.mockResolvedValue([feeEntry('p-collected', 100)]);
      mockPrisma.lateFeeWaiverRequest.create.mockImplementation((args: { data: object }) =>
        Promise.resolve({ id: 'req-1', ...args.data }),
      );

      const result = await service.create(
        { contractId: 'c-1', paymentIds: ['p-open', 'p-paid', 'p-collected'], reason: 'reason ok' },
        'user-collector',
      );

      expect(result.paymentIds).toEqual(['p-open']);
      expect(result.totalWaiveAmount.toString()).toBe('100');
    });

    it('refuses a request where nothing is waivable', async () => {
      mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.payment.findMany.mockResolvedValue([
        row('p-paid', { status: 'PAID', amountPaid: D('1615.83') }),
      ]);
      await expect(
        service.create({ contractId: 'c-1', paymentIds: ['p-paid'], reason: 'reason ok' }, 'u'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.lateFeeWaiverRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('approve()', () => {
    it('waives each unpaid fee, keeps open rows unsettled and flips request to APPROVED', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1', 'p-2']));
      tx.payment.findMany.mockResolvedValue([
        row('p-1', { lateFee: D(150) }),
        row('p-2', { lateFee: D(250), installmentNo: 2 }),
      ]);

      const out = await service.approve('req-1', 'user-owner');

      expect(tx.payment.update).toHaveBeenCalledTimes(2);
      const p1 = tx.payment.update.mock.calls.find((c: Array<{ where: { id: string } }>) => c[0].where.id === 'p-1')?.[0];
      expect(p1.data.lateFee.toString()).toBe('0');
      expect(p1.data.waivedAmount.toString()).toBe('150');
      expect(p1.data.lateFeeWaived).toBe(true);
      expect(p1.data.waivedApprovedById).toBe('user-owner');
      expect(p1.data.status).toBeUndefined(); // nothing paid → stays OVERDUE
      expect(tx.feeWaiverApproval.create).toHaveBeenCalledTimes(2);
      expect(tx.payment.count).not.toHaveBeenCalled(); // no completion check
      expect(out.status).toBe(LateFeeWaiverStatus.APPROVED);
      expect(out.approverUserId).toBe('user-owner');
      expect((out.totalWaiveAmount as Prisma.Decimal).toString()).toBe('400');
      expect(audit.logPaymentEvent).toHaveBeenCalledTimes(2);
      expect(audit.logPaymentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LATE_FEE_WAIVED', paymentId: 'p-1', amount: 150 }),
      );
    });

    it('fee-first receipt of exactly amountDue: nothing waived, row stays PARTIALLY_PAID', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1']));
      tx.payment.findMany.mockResolvedValue([
        row('p-1', { status: 'PARTIALLY_PAID', amountPaid: D('1515.83') }),
      ]);
      tx.journalEntry.findMany.mockResolvedValue([feeEntry('p-1', 100)]);

      const out = await service.approve('req-1', 'user-owner');

      expect(tx.payment.update).not.toHaveBeenCalled();
      expect((out.totalWaiveAmount as Prisma.Decimal).toString()).toBe('0');
    });

    it('settles a principal-covered row and runs the completion check in the same tx', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1']));
      // Legacy shape: principal paid, fee charged, no fee journal entry.
      tx.payment.findMany.mockResolvedValue([
        row('p-1', { status: 'PARTIALLY_PAID', amountPaid: D('1515.83') }),
      ]);

      await service.approve('req-1', 'user-owner');

      const data = tx.payment.update.mock.calls[0][0].data;
      expect(data.status).toBe('PAID');
      expect(data.paidDate).toBeInstanceOf(Date);
      expect(data.waivedAmount.toString()).toBe('100');
      expect(tx.payment.count).toHaveBeenCalledWith({
        where: { contractId: 'c-1', status: { not: 'PAID' }, deletedAt: null },
      });
    });

    it('does not settle on a contract the receipt path cannot collect for', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1']));
      tx.contract.findFirst.mockResolvedValue({ status: 'TERMINATED' });
      tx.payment.findMany.mockResolvedValue([
        row('p-1', { status: 'PARTIALLY_PAID', amountPaid: D('1515.83') }),
      ]);

      await service.approve('req-1', 'user-owner');

      expect(tx.payment.update.mock.calls[0][0].data.status).toBeUndefined();
      expect(tx.payment.count).not.toHaveBeenCalled();
    });

    it('skips rows that became PAID after the request', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1']));
      tx.payment.findMany.mockResolvedValue([
        row('p-1', { status: 'PAID', amountPaid: D('1615.83') }),
      ]);

      await service.approve('req-1', 'user-owner');

      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('refuses when approver === requester (Segregation of Duties)', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue({
        ...pendingRequest(['p-1']),
        requesterUserId: 'user-same',
      });
      await expect(service.approve('req-1', 'user-same')).rejects.toThrow(ForbiddenException);
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('refuses to approve a non-PENDING request (idempotency guard)', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue({
        ...pendingRequest(['p-1']),
        status: LateFeeWaiverStatus.APPROVED,
      });
      await expect(service.approve('req-1', 'user-owner')).rejects.toThrow(BadRequestException);
    });

    it('re-checks PENDING inside the transaction (concurrent approval)', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1']));
      tx.lateFeeWaiverRequest.findFirst.mockResolvedValue({ status: LateFeeWaiverStatus.APPROVED });
      await expect(service.approve('req-1', 'user-owner')).rejects.toThrow(BadRequestException);
      expect(tx.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('reject()', () => {
    it('flips PENDING → REJECTED with the supplied reason and does not touch payments', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(pendingRequest(['p-1']));
      mockPrisma.lateFeeWaiverRequest.update.mockImplementation((args: { data: object }) =>
        Promise.resolve({ id: 'req-1', ...args.data }),
      );

      const out = await service.reject('req-1', 'user-owner', 'หลักฐานไม่พอ');

      expect(out.status).toBe(LateFeeWaiverStatus.REJECTED);
      expect(out.rejectedReason).toBe('หลักฐานไม่พอ');
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the request does not exist', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(null);
      await expect(service.reject('missing', 'user-owner', 'reason ok')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
