import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RescheduleService } from '../installments/reschedule.service';
import { RescheduleCollectService } from './services/reschedule-collect.service';
import { UserThrottlerGuard } from '../../guards/user-throttler.guard';
import { RecordPaymentDto, BulkRecordPaymentDto } from './dto/payment.dto';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let _prisma: unknown;
  let paymentsService: PaymentsService;
  let paySolutionsService: PaySolutionsService;
  let rescheduleService: RescheduleService;
  let rescheduleCollectService: RescheduleCollectService;

  const mockContract = {
    id: 'contract-1',
    branchId: 'branch-1',
  };

  beforeEach(async () => {
    const mockPrisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
      },
    };

    const mockPaymentsService = {
      validateBranchAccess: jest.fn().mockImplementation(async (contractId: string, user: { role: string; branchId: string | null }) => {
        if (user.role === 'OWNER' || user.role === 'FINANCE_MANAGER' || user.role === 'ACCOUNTANT') return;
        if (mockContract.branchId !== user.branchId) {
          throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
        }
      }),
      // Payment-keyed routes (partial-qr / reschedule-qr) resolve the contract from
      // the payment — same branch rule as validateBranchAccess.
      validateBranchAccessByPayment: jest.fn().mockImplementation(async (paymentId: string, user: { role: string; branchId: string | null }) => {
        if (user.role === 'OWNER' || user.role === 'FINANCE_MANAGER' || user.role === 'ACCOUNTANT') return;
        if (mockContract.branchId !== user.branchId) {
          throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
        }
      }),
      recordPayment: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'PAID' }),
      autoAllocatePayment: jest.fn().mockResolvedValue({ allocatedPayments: [], totalAllocated: 0, overpayment: 0 }),
      getPendingPayments: jest.fn().mockResolvedValue([]),
      getDailySummary: jest.fn().mockResolvedValue({ totalPayments: 0 }),
      getContractJournalEntries: jest.fn().mockResolvedValue([]),
    };

    const mockRescheduleService = {
      execute: jest.fn().mockResolvedValue({
        rescheduleFee: new Decimal('809'),
        shiftedInstallmentIds: ['inst-5', 'inst-6', 'inst-7'],
        oldDueDates: {},
        newDueDates: {},
      }),
    };

    // ปรับดิว collect-first (2026-07-02): the RESCHEDULE branch now routes to
    // RescheduleCollectService.executeWithCollect (collect JE + lateFee reset +
    // shift in one atom) instead of the bare RescheduleService.execute.
    const mockRescheduleCollectService = {
      quote: jest.fn().mockResolvedValue({
        rescheduleFee: '809.00',
        lateFee: '0.00',
        collectAmount: '809.00',
        variant: '6a',
        newDueDate: new Date('2026-08-01').toISOString(),
        currentDueDate: new Date('2026-07-01').toISOString(),
      }),
      executeWithCollect: jest.fn().mockImplementation(async (input: { splitMode: string; daysToShift: number }) => ({
        success: true,
        case: 'RESCHEDULE',
        variant: input.splitMode === 'SPLIT' ? '6a' : '6b',
        rescheduleFee: '809.00',
        lateFeeCollected: '0.00',
        collectAmount: input.splitMode === 'SPLIT' ? '809.00' : '0.00',
        journalEntryNo: 'JE-RESCH-1',
        shiftedInstallmentCount: 3,
        shiftedInstallmentIds: ['inst-5', 'inst-6', 'inst-7'],
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: PaySolutionsService,
          useValue: {
            createPartialPaymentQR: jest.fn(),
            createRescheduleQR: jest.fn().mockResolvedValue({
              partialPaymentLinkId: 'pplink-1',
              paymentUrl: 'https://payment.example/qr',
              orderRef: 'RSQ-1',
              sentToLine: true,
              collectAmount: '1144.00',
              rescheduleFee: '1044.00',
              lateFee: '100.00',
            }),
          },
        },
        { provide: RescheduleService, useValue: mockRescheduleService },
        { provide: RescheduleCollectService, useValue: mockRescheduleCollectService },
      ],
    })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentsController>(PaymentsController);
    _prisma = module.get<PrismaService>(PrismaService);
    paymentsService = module.get<PaymentsService>(PaymentsService);
    paySolutionsService = module.get<PaySolutionsService>(PaySolutionsService);
    rescheduleService = module.get<RescheduleService>(RescheduleService);
    rescheduleCollectService = module.get<RescheduleCollectService>(RescheduleCollectService);
  });

  describe('branch access control', () => {
    it('should allow OWNER to record payment for any branch', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as RecordPaymentDto, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });

    it('should allow ACCOUNTANT to record payment for any branch', async () => {
      const user = { id: 'user-1', role: 'ACCOUNTANT', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as RecordPaymentDto, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });

    it('should allow SALES to record payment for own branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-1' }; // same branch as contract
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as RecordPaymentDto, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });

    it('should reject SALES recording payment for different branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' }; // different branch
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await expect(controller.recordPayment(dto as RecordPaymentDto, user)).rejects.toThrow(ForbiddenException);
    });

    it('should reject BRANCH_MANAGER recording payment for different branch', async () => {
      const user = { id: 'user-1', role: 'BRANCH_MANAGER', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await expect(controller.recordPayment(dto as RecordPaymentDto, user)).rejects.toThrow(ForbiddenException);
    });

    it('should allow BRANCH_MANAGER to record payment for own branch', async () => {
      const user = { id: 'user-1', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as RecordPaymentDto, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });
  });

  describe('auto-allocate branch access', () => {
    it('should reject SALES auto-allocating for different branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', amount: 5000, paymentMethod: 'CASH' };

      await expect(controller.autoAllocatePayment(dto as BulkRecordPaymentDto, user)).rejects.toThrow(ForbiddenException);
    });

    it('should allow OWNER to auto-allocate for any branch', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', amount: 5000, paymentMethod: 'CASH' };

      await controller.autoAllocatePayment(dto as BulkRecordPaymentDto, user);
      expect(paymentsService.autoAllocatePayment).toHaveBeenCalled();
    });
  });

  describe('case=RESCHEDULE wiring (ปรับดิว collect-first, 2026-07-02)', () => {
    it('routes to RescheduleCollectService.executeWithCollect with splitMode=SINGLE (6b)', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 1, // 6b zero-collect placeholder (@Min(0.01)); server ignores when quote = 0
        paymentMethod: 'CASH',
        evidenceUrl: 'https://slip.jpg',
        case: 'RESCHEDULE',
        daysToShift: 16,
        splitMode: 'SINGLE',
      } as unknown as RecordPaymentDto;

      const result = await controller.recordPayment(dto, user);

      expect(rescheduleCollectService.executeWithCollect).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          installmentNo: 5,
          daysToShift: 16,
          splitMode: 'SINGLE',
          amount: 1,
          paymentMethod: 'CASH',
          recordedById: 'user-1',
        }),
      );
      // Should NOT have called recordPayment (the normal-payment service path)
      // nor the bare RescheduleService (the collect service owns that now).
      expect(paymentsService.recordPayment).not.toHaveBeenCalled();
      expect(rescheduleService.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        case: 'RESCHEDULE',
        variant: '6b',
        rescheduleFee: '809.00',
        shiftedInstallmentCount: 3,
      });
    });

    it('routes splitMode=SPLIT (6a) with the collected amount + deposit account', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 809,
        paymentMethod: 'CASH',
        evidenceUrl: 'https://slip.jpg',
        case: 'RESCHEDULE',
        daysToShift: 10,
        splitMode: 'SPLIT',
        depositAccountCode: '11-1201',
      } as unknown as RecordPaymentDto;

      await controller.recordPayment(dto, user);
      expect(rescheduleCollectService.executeWithCollect).toHaveBeenCalledWith(
        expect.objectContaining({
          splitMode: 'SPLIT',
          daysToShift: 10,
          amount: 809,
          depositAccountCode: '11-1201',
        }),
      );
    });

    it('rejects QR method on the synchronous path (must use /payments/:id/reschedule-qr)', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 809,
        paymentMethod: 'QR_EWALLET',
        case: 'RESCHEDULE',
        daysToShift: 10,
        splitMode: 'SPLIT',
      } as unknown as RecordPaymentDto;

      await expect(controller.recordPayment(dto, user)).rejects.toThrow(BadRequestException);
      expect(rescheduleCollectService.executeWithCollect).not.toHaveBeenCalled();
    });

    it('rejects RESCHEDULE without daysToShift', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 1,
        paymentMethod: 'CASH',
        evidenceUrl: 'https://slip.jpg',
        case: 'RESCHEDULE',
        splitMode: 'SINGLE',
      } as unknown as RecordPaymentDto;

      await expect(controller.recordPayment(dto, user)).rejects.toThrow(BadRequestException);
      expect(rescheduleCollectService.executeWithCollect).not.toHaveBeenCalled();
    });

    it('enforces branch access before reschedule (SALES cross-branch rejected)', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' }; // contract is on branch-1
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 1,
        paymentMethod: 'CASH',
        evidenceUrl: 'https://slip.jpg',
        case: 'RESCHEDULE',
        daysToShift: 16,
        splitMode: 'SINGLE',
      } as unknown as RecordPaymentDto;

      await expect(controller.recordPayment(dto, user)).rejects.toThrow(ForbiddenException);
      expect(rescheduleCollectService.executeWithCollect).not.toHaveBeenCalled();
    });
  });

  describe('pending payments branch filtering', () => {
    it('should force branchId for SALES user', () => {
      const user = { role: 'SALES', branchId: 'branch-1' };
      // signature: (branchId, date, dueFrom, dueTo, status, search, dunningStage, page, limit, user)
      controller.getPendingPayments(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-1' }),
      );
    });

    it('should not force branchId for OWNER', () => {
      const user = { role: 'OWNER', branchId: 'branch-1' };
      controller.getPendingPayments(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: undefined }),
      );
    });

    it('should allow OWNER to query specific branch', () => {
      const user = { role: 'OWNER', branchId: 'branch-1' };
      controller.getPendingPayments('branch-2', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-2' }),
      );
    });
  });

  // PR #1314 — GET contract/:contractId/journal-entries (payment-history JE panel).
  // The endpoint's only guard beyond @Roles is the per-contract validateBranchAccess,
  // which must run BEFORE the query service is hit.
  describe('getContractJournalEntries branch access + passthrough', () => {
    const jeRows = [{ id: 'je-1', entryNumber: 'JV-0001', isBalanced: true }];

    beforeEach(() => {
      (paymentsService.getContractJournalEntries as jest.Mock).mockResolvedValue(jeRows);
    });

    it('validates branch access then returns the query-service rows (OWNER, cross-branch)', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-2' };
      const res = await controller.getContractJournalEntries('contract-1', user);

      expect(paymentsService.validateBranchAccess).toHaveBeenCalledWith('contract-1', user);
      expect(paymentsService.getContractJournalEntries).toHaveBeenCalledWith('contract-1');
      expect(res).toBe(jeRows);
    });

    it('allows SALES for own branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-1' };
      await controller.getContractJournalEntries('contract-1', user);
      expect(paymentsService.getContractJournalEntries).toHaveBeenCalledWith('contract-1');
    });

    it('rejects SALES cross-branch BEFORE reaching the query service', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' };
      await expect(controller.getContractJournalEntries('contract-1', user)).rejects.toThrow(
        ForbiddenException,
      );
      expect(paymentsService.getContractJournalEntries).not.toHaveBeenCalled();
    });
  });

  // PR #1326 — GET /payments/reschedule-quote (server-authoritative ปรับดิว quote).
  // Query params arrive as strings; the controller must reject NaN / <1 values
  // BEFORE delegating to RescheduleCollectService.quote with parsed ints.
  describe('getRescheduleQuote param parsing + delegation', () => {
    const owner = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };

    it.each([
      ['NaN installmentNo', 'abc', '16'],
      ['installmentNo < 1', '0', '16'],
      ['negative installmentNo', '-3', '16'],
      ['NaN daysToShift', '5', 'xyz'],
      ['daysToShift < 1', '5', '0'],
    ])('rejects %s with BadRequestException before quoting', async (_label, installmentNo, daysToShift) => {
      await expect(
        controller.getRescheduleQuote('contract-1', installmentNo, daysToShift, 'SPLIT', owner),
      ).rejects.toThrow(BadRequestException);
      expect(rescheduleCollectService.quote).not.toHaveBeenCalled();
    });

    it('delegates to rescheduleCollectService.quote with parsed integer args (SPLIT/6a)', async () => {
      const res = await controller.getRescheduleQuote('contract-1', '5', '16', 'SPLIT', owner);

      expect(paymentsService.validateBranchAccess).toHaveBeenCalledWith('contract-1', owner);
      expect(rescheduleCollectService.quote).toHaveBeenCalledWith({
        contractId: 'contract-1',
        installmentNo: 5,
        daysToShift: 16,
        splitMode: 'SPLIT',
      });
      expect(res).toMatchObject({
        rescheduleFee: '809.00',
        collectAmount: '809.00',
        variant: '6a',
      });
    });

    it('maps any non-SPLIT splitMode to SINGLE (6b default)', async () => {
      await controller.getRescheduleQuote('contract-1', '5', '16', 'weird', owner);
      expect(rescheduleCollectService.quote).toHaveBeenCalledWith(
        expect.objectContaining({ splitMode: 'SINGLE' }),
      );
    });

    it('enforces branch access BEFORE quoting (SALES cross-branch rejected)', async () => {
      const sales = { id: 'user-1', role: 'SALES', branchId: 'branch-2' }; // contract is on branch-1
      await expect(
        controller.getRescheduleQuote('contract-1', '5', '16', 'SPLIT', sales),
      ).rejects.toThrow(ForbiddenException);
      expect(rescheduleCollectService.quote).not.toHaveBeenCalled();
    });
  });

  // PR #1326 — POST /payments/:id/reschedule-qr (async ปรับดิว: QR collects first,
  // the reschedule executes on webhook confirm — เงินไม่เข้า ดิวไม่เลื่อน).
  describe('createRescheduleQr branch access + delegation', () => {
    it('validates branch access by payment FIRST, then delegates with mapped splitMode (SPLIT)', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const res = await controller.createRescheduleQr(
        'payment-1',
        { daysToShift: 10, splitMode: 'SPLIT' as const },
        user,
      );

      expect(paymentsService.validateBranchAccessByPayment).toHaveBeenCalledWith('payment-1', user);
      expect(paySolutionsService.createRescheduleQR).toHaveBeenCalledWith({
        paymentId: 'payment-1',
        daysToShift: 10,
        splitMode: 'SPLIT',
        requestedById: 'user-1',
      });
      // The branch check must run BEFORE the gateway call.
      const accessOrder = (paymentsService.validateBranchAccessByPayment as jest.Mock).mock
        .invocationCallOrder[0];
      const qrOrder = (paySolutionsService.createRescheduleQR as jest.Mock).mock
        .invocationCallOrder[0];
      expect(accessOrder).toBeLessThan(qrOrder);
      expect(res).toMatchObject({ orderRef: 'RSQ-1', collectAmount: '1144.00' });
    });

    it('maps splitMode=SINGLE through unchanged (6b — QR เก็บเฉพาะค่าปรับ)', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      await controller.createRescheduleQr(
        'payment-1',
        { daysToShift: 7, splitMode: 'SINGLE' as const },
        user,
      );
      expect(paySolutionsService.createRescheduleQR).toHaveBeenCalledWith(
        expect.objectContaining({ daysToShift: 7, splitMode: 'SINGLE' }),
      );
    });

    it('rejects SALES cross-branch BEFORE creating the QR', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' }; // contract is on branch-1
      await expect(
        controller.createRescheduleQr('payment-1', { daysToShift: 10, splitMode: 'SPLIT' as const }, user),
      ).rejects.toThrow(ForbiddenException);
      expect(paySolutionsService.createRescheduleQR).not.toHaveBeenCalled();
    });
  });

  // DTO validation for the reschedule-qr body. CreateRescheduleQrDto is declared
  // (unexported) inside the controller file — recover the class from the
  // design:paramtypes metadata Nest emits for the @Body() parameter, then run
  // class-validator directly (same validate + plainToInstance convention as
  // update-letter-evidence.dto.spec.ts).
  describe('CreateRescheduleQrDto validation (class-validator)', () => {
    const CreateRescheduleQrDto = (
      Reflect.getMetadata(
        'design:paramtypes',
        PaymentsController.prototype,
        'createRescheduleQr',
      ) as Array<new () => object>
    )[1];

    async function validateDto(payload: Record<string, unknown>) {
      return validate(plainToInstance(CreateRescheduleQrDto, payload));
    }

    it.each(['SINGLE', 'SPLIT'])('accepts splitMode=%s with daysToShift >= 1', async (splitMode) => {
      const errors = await validateDto({ daysToShift: 10, splitMode });
      expect(errors).toHaveLength(0);
    });

    it.each(['BOTH', 'split', '', 42])(
      'rejects splitMode outside [SINGLE, SPLIT] (%p)',
      async (splitMode) => {
        const errors = await validateDto({ daysToShift: 10, splitMode });
        expect(errors.some((e) => e.property === 'splitMode')).toBe(true);
      },
    );

    it('rejects daysToShift < 1', async () => {
      const errors = await validateDto({ daysToShift: 0, splitMode: 'SPLIT' });
      expect(errors.some((e) => e.property === 'daysToShift')).toBe(true);
    });

    it('rejects non-numeric daysToShift', async () => {
      const errors = await validateDto({ daysToShift: 'ten', splitMode: 'SPLIT' });
      expect(errors.some((e) => e.property === 'daysToShift')).toBe(true);
    });
  });
});
