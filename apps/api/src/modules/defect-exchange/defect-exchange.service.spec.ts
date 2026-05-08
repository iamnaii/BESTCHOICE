import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DefectExchangeService } from './defect-exchange.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DefectExchangeReversalTemplate } from '../journal/cpa-templates/defect-exchange-reversal.template';

// generateContractNumber issues a $queryRaw lock + sequence read; stub it out
// so unit tests don't need a Postgres advisory-lock implementation.
jest.mock('../../utils/sequence.util', () => ({
  generateContractNumber: jest.fn().mockResolvedValue('CT-2026-05-00001'),
}));

describe('DefectExchangeService', () => {
  let service: DefectExchangeService;
  let prisma: any;

  const oldContractId = 'ct-old';
  const newProductId = 'prod-new';
  const userId = 'user-1';

  const futureWindowEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // +5 days

  // Helper: contract within the 7-day defect window with eligible product.
  const baseContract = (overrides: Partial<any> = {}) => ({
    id: oldContractId,
    contractNumber: 'CT-2026-05-OLD',
    customerId: 'cust-1',
    productId: 'prod-old',
    branchId: 'branch-1',
    salespersonId: 'user-2',
    planType: 'INSTALLMENT',
    sellingPrice: 10000,
    downPayment: 1000,
    interestRate: 0,
    totalMonths: 12,
    interestTotal: 0,
    financedAmount: 9000,
    storeCommission: 0,
    vatAmount: 0,
    vatPct: 0,
    monthlyPayment: 750,
    paymentDueDay: 5,
    interestConfigId: null,
    parentContractId: null,
    notes: null,
    status: 'ACTIVE',
    deletedAt: null,
    deviceReceivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    shopWarrantyStartDate: null,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    product: {
      id: 'prod-old',
      brand: 'Apple',
      model: 'iPhone 14',
      storage: '128GB',
      category: 'PHONE_USED',
      status: 'SOLD_INSTALLMENT',
      imeiSerial: 'IMEI-OLD',
      shopWarrantyDays: 30,
      stockInDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      supplierId: 'sup-1',
    },
    payments: [],
    ...overrides,
  });

  // Replacement product matching brand/model/storage of old product.
  const newProductRec = {
    id: newProductId,
    brand: 'Apple',
    model: 'iPhone 14',
    storage: '128GB',
    category: 'PHONE_USED',
    status: 'IN_STOCK',
    shopWarrantyDays: 30,
    stockInDate: new Date(),
    supplierId: 'sup-1',
  };

  beforeEach(async () => {
    const txMock = {
      contract: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'ct-new', contractNumber: 'CT-2026-05-00001' }),
      },
      product: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        count: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    prisma = {
      contract: {
        findUnique: jest.fn(),
      },
      product: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
      __tx: txMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefectExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: {} },
        {
          provide: DefectExchangeReversalTemplate,
          useValue: { reverseContract: jest.fn().mockResolvedValue({ id: 'je-rev' }) },
        },
      ],
    }).compile();

    service = module.get<DefectExchangeService>(DefectExchangeService);
  });

  describe('execute — Wave 3 T2 payment guard (ปพพ.386 C-6)', () => {
    it('throws BadRequestException when contract has any PAID payment record', async () => {
      const contract = baseContract();

      // checkEligibility uses the top-level prisma (not tx) — return contract there.
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      // Tx: payment.count returns 1 (paid record exists) → guard trips.
      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(1);

      await expect(
        service.execute(
          {
            oldContractId,
            newProductId,
            defectReason: 'screen broken',
          } as any,
          userId,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.execute(
          {
            oldContractId,
            newProductId,
            defectReason: 'screen broken',
          } as any,
          userId,
        ),
      ).rejects.toThrow(/มีรายการชำระเงินแล้ว/);
    });

    it('proceeds when contract has zero payments', async () => {
      const contract = baseContract();
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(0);
      tx.contract.findUnique.mockResolvedValue(contract);
      tx.product.findUnique.mockResolvedValue(newProductRec);

      const result = await service.execute(
        {
          oldContractId,
          newProductId,
          defectReason: 'screen broken',
        } as any,
        userId,
      );

      expect(result.newContract).toBeDefined();
      expect(result.oldContract.status).toBe('DEFECT_EXCHANGED');
      expect(tx.payment.count).toHaveBeenCalledWith({
        where: {
          contractId: oldContractId,
          deletedAt: null,
          OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }],
        },
      });
    });

    it('payment guard message includes the count of payment records', async () => {
      const contract = baseContract();
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.product.findUnique.mockResolvedValue(newProductRec);

      const tx = prisma.__tx;
      tx.payment.count.mockResolvedValue(3);

      await expect(
        service.execute(
          {
            oldContractId,
            newProductId,
            defectReason: 'screen broken',
          } as any,
          userId,
        ),
      ).rejects.toThrow(/3 รายการ/);
    });
  });

  // Reference futureWindowEnd to silence unused-var warning if test grows.
  it('windowEnd helper — sanity check', () => {
    expect(futureWindowEnd.getTime()).toBeGreaterThan(Date.now());
  });
});
