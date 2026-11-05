import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LateFeeWaiverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LateFeeWaiverService } from './late-fee-waiver.service';

/**
 * 5 focused tests covering the create → approve → reject lifecycle and the
 * two invariants the service must guard:
 *   - approve actually zeros lateFee on the listed Payment rows
 *   - approve/reject only operate on PENDING rows
 *   - SoD: requester ≠ approver
 */

const approveTxState = {
  paymentUpdate: jest.fn(),
  requestUpdate: jest.fn(),
  paymentFindMany: jest.fn(),
};

const mockPrisma = {
  contract: { findFirst: jest.fn() },
  payment: { findMany: jest.fn() },
  lateFeeWaiverRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  // Service uses $transaction(callback). Run the callback with a tx proxy
  // that delegates to the per-test mocks above.
  $transaction: jest.fn(async (cb: any) =>
    cb({
      payment: {
        findMany: approveTxState.paymentFindMany,
        update: approveTxState.paymentUpdate,
      },
      lateFeeWaiverRequest: {
        update: approveTxState.requestUpdate,
      },
    }),
  ),
};

describe('LateFeeWaiverService', () => {
  let service: LateFeeWaiverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LateFeeWaiverService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(LateFeeWaiverService);
  });

  describe('create()', () => {
    it('snapshots totalWaiveAmount from the listed payments and persists PENDING', async () => {
      mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'p-1', lateFee: new Prisma.Decimal(150), status: 'OVERDUE' },
        { id: 'p-2', lateFee: new Prisma.Decimal(250), status: 'OVERDUE' },
      ]);
      mockPrisma.lateFeeWaiverRequest.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'req-1', ...args.data }),
      );

      const result = await service.create(
        {
          contractId: 'c-1',
          paymentIds: ['p-1', 'p-2'],
          reason: 'ลูกค้าป่วยเข้า รพ.',
        },
        'user-collector',
      );

      expect(result.status).toBe(LateFeeWaiverStatus.PENDING);
      // Decimal — compare via toString to avoid Prisma.Decimal identity quirks.
      expect(result.totalWaiveAmount.toString()).toBe('400');
      expect(result.requesterUserId).toBe('user-collector');
      expect(result.paymentIds).toEqual(['p-1', 'p-2']);
    });

    it('rejects when one of the requested payments is already waived (count mismatch)', async () => {
      mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
      // Asked for 2 payments but DB only returned 1 → the other is already
      // waived or on a different contract.
      mockPrisma.payment.findMany.mockResolvedValue([
        { id: 'p-1', lateFee: new Prisma.Decimal(150), status: 'OVERDUE' },
      ]);

      await expect(
        service.create(
          { contractId: 'c-1', paymentIds: ['p-1', 'p-2'], reason: 'reason ok' },
          'user-collector',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approve()', () => {
    it('zeros lateFee on each payment and flips request to APPROVED', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: LateFeeWaiverStatus.PENDING,
        requesterUserId: 'user-collector',
        paymentIds: ['p-1', 'p-2'],
        reason: 'ลูกค้าป่วย',
      });
      approveTxState.paymentFindMany.mockResolvedValue([
        { id: 'p-1', lateFee: new Prisma.Decimal(150), lateFeeWaived: false },
        { id: 'p-2', lateFee: new Prisma.Decimal(250), lateFeeWaived: false },
      ]);
      approveTxState.paymentUpdate.mockResolvedValue({});
      approveTxState.requestUpdate.mockImplementation((args: any) =>
        Promise.resolve({ id: 'req-1', ...args.data }),
      );

      const out = await service.approve('req-1', 'user-owner');

      // Both payments mutated with lateFee=0 + lateFeeWaived=true.
      expect(approveTxState.paymentUpdate).toHaveBeenCalledTimes(2);
      const p1Call = approveTxState.paymentUpdate.mock.calls.find(
        (c: any[]) => c[0].where.id === 'p-1',
      )?.[0];
      expect(p1Call.data.lateFee).toBe(0);
      expect(p1Call.data.lateFeeWaived).toBe(true);
      expect(p1Call.data.waivedApprovedById).toBe('user-owner');
      expect(out.status).toBe(LateFeeWaiverStatus.APPROVED);
      expect(out.approverUserId).toBe('user-owner');
      // totalWaived recomputed inside tx = 150 + 250
      expect((out.totalWaiveAmount as Prisma.Decimal).toString()).toBe('400');
    });

    it('refuses when approver === requester (Segregation of Duties)', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: LateFeeWaiverStatus.PENDING,
        requesterUserId: 'user-same',
        paymentIds: ['p-1'],
        reason: 'r',
      });
      await expect(service.approve('req-1', 'user-same')).rejects.toThrow(
        ForbiddenException,
      );
      expect(approveTxState.paymentUpdate).not.toHaveBeenCalled();
    });

    it('refuses to approve a non-PENDING request (idempotency guard)', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: LateFeeWaiverStatus.APPROVED, // already approved
        requesterUserId: 'user-collector',
        paymentIds: ['p-1'],
        reason: 'r',
      });
      await expect(service.approve('req-1', 'user-owner')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reject()', () => {
    it('flips PENDING → REJECTED with the supplied reason and does not touch payments', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: LateFeeWaiverStatus.PENDING,
        requesterUserId: 'user-collector',
        paymentIds: ['p-1'],
        reason: 'r',
      });
      mockPrisma.lateFeeWaiverRequest.update.mockImplementation((args: any) =>
        Promise.resolve({ id: 'req-1', ...args.data }),
      );

      const out = await service.reject('req-1', 'user-owner', 'หลักฐานไม่พอ');

      expect(out.status).toBe(LateFeeWaiverStatus.REJECTED);
      expect(out.rejectedReason).toBe('หลักฐานไม่พอ');
      expect(approveTxState.paymentUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the request does not exist', async () => {
      mockPrisma.lateFeeWaiverRequest.findFirst.mockResolvedValue(null);
      await expect(service.reject('missing', 'user-owner', 'reason ok')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
