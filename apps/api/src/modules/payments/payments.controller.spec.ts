import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserThrottlerGuard } from '../../guards/user-throttler.guard';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let _prisma: any;
  let paymentsService: any;

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
        if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') return;
        if (mockContract.branchId !== user.branchId) {
          throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
        }
      }),
      recordPayment: jest.fn().mockResolvedValue({ id: 'payment-1', status: 'PAID' }),
      autoAllocatePayment: jest.fn().mockResolvedValue({ allocatedPayments: [], totalAllocated: 0, overpayment: 0 }),
      getPendingPayments: jest.fn().mockResolvedValue([]),
      getDailySummary: jest.fn().mockResolvedValue({ totalPayments: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(UserThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentsController>(PaymentsController);
    _prisma = module.get<PrismaService>(PrismaService);
    paymentsService = module.get<PaymentsService>(PaymentsService);
  });

  describe('branch access control', () => {
    it('should allow OWNER to record payment for any branch', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as any, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });

    it('should allow ACCOUNTANT to record payment for any branch', async () => {
      const user = { id: 'user-1', role: 'ACCOUNTANT', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as any, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });

    it('should allow SALES to record payment for own branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-1' }; // same branch as contract
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as any, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });

    it('should reject SALES recording payment for different branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' }; // different branch
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await expect(controller.recordPayment(dto as any, user)).rejects.toThrow(ForbiddenException);
    });

    it('should reject BRANCH_MANAGER recording payment for different branch', async () => {
      const user = { id: 'user-1', role: 'BRANCH_MANAGER', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await expect(controller.recordPayment(dto as any, user)).rejects.toThrow(ForbiddenException);
    });

    it('should allow BRANCH_MANAGER to record payment for own branch', async () => {
      const user = { id: 'user-1', role: 'BRANCH_MANAGER', branchId: 'branch-1' };
      const dto = { contractId: 'contract-1', installmentNo: 1, amount: 3000, paymentMethod: 'CASH', evidenceUrl: 'http://slip.jpg' };

      await controller.recordPayment(dto as any, user);
      expect(paymentsService.recordPayment).toHaveBeenCalled();
    });
  });

  describe('auto-allocate branch access', () => {
    it('should reject SALES auto-allocating for different branch', async () => {
      const user = { id: 'user-1', role: 'SALES', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', amount: 5000, paymentMethod: 'CASH' };

      await expect(controller.autoAllocatePayment(dto as any, user)).rejects.toThrow(ForbiddenException);
    });

    it('should allow OWNER to auto-allocate for any branch', async () => {
      const user = { id: 'user-1', role: 'OWNER', branchId: 'branch-2' };
      const dto = { contractId: 'contract-1', amount: 5000, paymentMethod: 'CASH' };

      await controller.autoAllocatePayment(dto as any, user);
      expect(paymentsService.autoAllocatePayment).toHaveBeenCalled();
    });
  });

  describe('pending payments branch filtering', () => {
    it('should force branchId for SALES user', () => {
      const user = { role: 'SALES', branchId: 'branch-1' };
      controller.getPendingPayments(undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-1' }),
      );
    });

    it('should not force branchId for OWNER', () => {
      const user = { role: 'OWNER', branchId: 'branch-1' };
      controller.getPendingPayments(undefined, undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: undefined }),
      );
    });

    it('should allow OWNER to query specific branch', () => {
      const user = { role: 'OWNER', branchId: 'branch-1' };
      controller.getPendingPayments('branch-2', undefined, undefined, undefined, user);
      expect(paymentsService.getPendingPayments).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-2' }),
      );
    });
  });
});
