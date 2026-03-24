import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../../prisma/prisma.service';

// Mock the utility modules
jest.mock('../../utils/installment.util', () => ({
  calculateInstallment: jest.fn().mockReturnValue({
    interestTotal: 1800,
    financedAmount: 21800,
    monthlyPayment: 1817,
  }),
  generatePaymentSchedule: jest.fn().mockReturnValue([]),
}));

jest.mock('../../utils/config.util', () => ({
  loadInstallmentConfig: jest.fn().mockResolvedValue({}),
  resolveInstallmentParams: jest.fn().mockReturnValue({
    interestRate: 9,
    minDownPaymentPct: 0.1,
    minInstallmentMonths: 1,
    maxInstallmentMonths: 24,
    storeCommissionPct: 0,
    vatPct: 0,
  }),
  BUSINESS_RULES: { EARLY_PAYOFF_DISCOUNT: 0.5 },
}));

jest.mock('../../utils/validation.util', () => ({
  validateIMEI: jest.fn().mockReturnValue(true),
  validateThaiPhone: jest.fn().mockReturnValue(true),
  checkAgeEligibility: jest.fn().mockReturnValue({ eligible: true, requiresGuardian: false }),
  validateAddress: jest.fn().mockReturnValue(true),
  checkRequiredContractFields: jest.fn().mockReturnValue([]),
  checkRequiredDocuments: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
  checkRequiredSignatures: jest.fn().mockReturnValue({ complete: true, checklist: [] }),
}));

jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('BC-2026-TEST-001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

describe('ContractsService', () => {
  let service: ContractsService;
  let prisma: any;

  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
    sellingPrice: 20000,
    downPayment: 2000,
    totalMonths: 12,
    interestRate: 9,
    interestTotal: 1800,
    financedAmount: 21800,
    monthlyPayment: 1817,
    paymentDueDay: 5,
    interestConfigId: null,
    notes: null,
    deletedAt: null,
    pdpaConsentId: null,
    contractHash: null,
    customer: { name: 'Test', nationalId: '1234567890123', phone: '0812345678', addressIdCard: 'addr', addressCurrent: 'addr', references: [], birthDate: null, guardianName: null },
    product: { name: 'iPhone', brand: 'Apple', model: '15', imeiSerial: '123456789012345', category: 'PHONE', prices: [] },
    branch: { id: 'branch-1', name: 'สาขาทดสอบ' },
    salesperson: { id: 'user-1', name: 'Staff' },
    reviewedBy: null,
    interestConfig: null,
    payments: [],
    signatures: [],
    eDocuments: [],
    contractDocuments: [],
    creditCheck: null,
  };

  beforeEach(async () => {
    const txMock = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(mockContract),
      },
      payment: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
      },
    };

    const mockPrisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(mockContract),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'SALES' }),
      },
      interestConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((cb) => cb(txMock)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('update - schedule recalculation protection', () => {
    it('should allow update when no payments have been made', async () => {
      // paidOrPartialCount = 0 (default mock), change sellingPrice but also raise downPayment to pass validation
      await service.update('contract-1', { sellingPrice: 20000, downPayment: 3000 }, 'user-1');
      // Should not throw
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reject financial changes when payments exist', async () => {
      // Override $transaction to make payment count return > 0
      prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const txWithPayments = {
          contract: {
            findUnique: jest.fn().mockResolvedValue(mockContract),
            update: jest.fn().mockResolvedValue(mockContract),
          },
          payment: {
            count: jest.fn().mockResolvedValue(3), // 3 payments already made
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        };
        return cb(txWithPayments);
      });

      // Try to change sellingPrice when payments exist → should reject
      await expect(
        service.update('contract-1', { sellingPrice: 25000, downPayment: 3000 }, 'user-1'),
      ).rejects.toThrow('ไม่สามารถแก้ไขเงื่อนไขทางการเงินได้');
    });

    it('should allow non-financial updates when payments exist', async () => {
      prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const txWithPayments = {
          contract: {
            findUnique: jest.fn().mockResolvedValue(mockContract),
            update: jest.fn().mockResolvedValue(mockContract),
          },
          payment: {
            count: jest.fn().mockResolvedValue(3), // 3 payments made
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        };
        return cb(txWithPayments);
      });

      // Only updating notes (no financial change)
      await service.update('contract-1', { notes: 'updated note' }, 'user-1');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reject editing if not in CREATING/REJECTED status', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        workflowStatus: 'APPROVED',
      });

      await expect(
        service.update('contract-1', { notes: 'test' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject editing by non-creator (unless OWNER)', async () => {
      await expect(
        service.update('contract-1', { notes: 'test' }, 'user-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow OWNER to edit any contract', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'OWNER' });

      await service.update('contract-1', { notes: 'owner note' }, 'user-2');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('should reject deleting active contracts', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        status: 'ACTIVE',
        workflowStatus: 'APPROVED',
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should reject deleting contracts with signatures', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        signatures: [{ signerType: 'CUSTOMER', signerName: 'Test' }],
      });

      await expect(service.softDelete('contract-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });
});
