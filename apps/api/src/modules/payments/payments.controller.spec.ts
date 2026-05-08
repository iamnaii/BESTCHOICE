import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RescheduleService } from '../installments/reschedule.service';
import { UserThrottlerGuard } from '../../guards/user-throttler.guard';
import { RecordPaymentDto, BulkRecordPaymentDto } from './dto/payment.dto';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let _prisma: unknown;
  let paymentsService: PaymentsService;
  let rescheduleService: RescheduleService;

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
      recordPayment: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'PAID' }),
      autoAllocatePayment: jest.fn().mockResolvedValue({ allocatedPayments: [], totalAllocated: 0, overpayment: 0 }),
      getPendingPayments: jest.fn().mockResolvedValue([]),
      getDailySummary: jest.fn().mockResolvedValue({ totalPayments: 0 }),
    };

    const mockRescheduleService = {
      execute: jest.fn().mockResolvedValue({
        rescheduleFee: new Decimal('808.44'),
        shiftedInstallmentIds: ['inst-5', 'inst-6', 'inst-7'],
        oldDueDates: {},
        newDueDates: {},
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaySolutionsService, useValue: { createPartialPaymentQR: jest.fn() } },
        { provide: RescheduleService, useValue: mockRescheduleService },
      ],
    })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentsController>(PaymentsController);
    _prisma = module.get<PrismaService>(PrismaService);
    paymentsService = module.get<PaymentsService>(PaymentsService);
    rescheduleService = module.get<RescheduleService>(RescheduleService);
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

  describe('case=RESCHEDULE wiring (Wave 3 / T3)', () => {
    it('routes to RescheduleService.execute() with variant=6b for splitMode=SINGLE', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 1, // wizard sends amount placeholder; service uses daysToShift
        paymentMethod: 'CASH',
        evidenceUrl: 'https://slip.jpg',
        case: 'RESCHEDULE',
        daysToShift: 16,
        splitMode: 'SINGLE',
      } as unknown as RecordPaymentDto;

      const result = await controller.recordPayment(dto, user);

      expect(rescheduleService.execute).toHaveBeenCalledWith({
        contractId: 'contract-1',
        fromInstallmentNo: 5,
        daysToShift: 16,
        userId: 'user-1',
        variant: '6b',
      });
      // Should NOT have called recordPayment (the normal-payment service path)
      expect(paymentsService.recordPayment).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        case: 'RESCHEDULE',
        variant: '6b',
        rescheduleFee: '808.44',
        shiftedInstallmentCount: 3,
      });
    });

    it('routes to RescheduleService.execute() with variant=6a for splitMode=SPLIT', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-1' };
      const dto = {
        contractId: 'contract-1',
        installmentNo: 5,
        amount: 1,
        paymentMethod: 'CASH',
        evidenceUrl: 'https://slip.jpg',
        case: 'RESCHEDULE',
        daysToShift: 10,
        splitMode: 'SPLIT',
      } as unknown as RecordPaymentDto;

      await controller.recordPayment(dto, user);
      expect(rescheduleService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ variant: '6a', daysToShift: 10 }),
      );
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
      expect(rescheduleService.execute).not.toHaveBeenCalled();
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
      expect(rescheduleService.execute).not.toHaveBeenCalled();
    });
  });

  describe('pending payments branch filtering', () => {
    it('should force branchId for SALES user', () => {
      const user = { role: 'SALES', branchId: 'branch-1' };
      controller.getPendingPayments(undefined, undefined, undefined, undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-1' }),
      );
    });

    it('should not force branchId for OWNER', () => {
      const user = { role: 'OWNER', branchId: 'branch-1' };
      controller.getPendingPayments(undefined, undefined, undefined, undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: undefined }),
      );
    });

    it('should allow OWNER to query specific branch', () => {
      const user = { role: 'OWNER', branchId: 'branch-1' };
      controller.getPendingPayments('branch-2', undefined, undefined, undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-2' }),
      );
    });
  });
});
