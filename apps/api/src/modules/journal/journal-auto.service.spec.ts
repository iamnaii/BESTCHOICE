import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * JournalAutoService tests — validates the double-entry bookkeeping engine.
 *
 * Critical test: unbalanced journal lines must throw (never silently skip),
 * because a silent skip means a financial transaction completes without
 * its accounting record — causing the trial balance to drift.
 */
describe('JournalAutoService', () => {
  let service: JournalAutoService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }),
      },
      journalEntry: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'je-1' }),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'contract-1',
          branchId: 'branch-1',
          branch: { companyId: 'company-1' },
          product: { category: 'NEW_PHONE', costPrice: { toNumber: () => 8000 } },
          sellingPrice: { toNumber: () => 10000 },
          totalInterest: { toNumber: () => 1200 },
          storeCommission: { toNumber: () => 300 },
          vatAmount: { toNumber: () => 700 },
        }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          return fn(prisma);
        }
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalAutoService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<JournalAutoService>(JournalAutoService);
  });

  describe('createAndPost — balance validation', () => {
    it('should throw InternalServerErrorException when Dr != Cr', async () => {
      const tx = prisma;

      // amountPaid (Dr) = 9999, but Cr side = principal(5000) + interest(500) + commission(100) + vat(300) + lateFee(50) = 5950
      // Mismatch → should throw
      await expect(
        service.createPaymentJournal(tx, {
          payment: {
            id: 'pay-1',
            installmentNo: 1,
            amountPaid: 9999,
            monthlyPrincipal: 5000,
            monthlyInterest: 500,
            monthlyCommission: 100,
            vatAmount: 300,
            lateFee: 50,
            lateFeeWaived: false,
          },
          contract: { contractNumber: 'BC-202601-0001', branchId: 'branch-1' },
          userId: 'user-1',
          companyId: 'company-1',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should return null when all lines are zero (no journal needed)', async () => {
      const tx = prisma;
      const result = await service.createPaymentJournal(tx, {
        payment: {
          id: 'pay-2',
          installmentNo: 1,
          amountPaid: 0,
          monthlyPrincipal: 0,
          monthlyInterest: 0,
          monthlyCommission: 0,
          vatAmount: 0,
          lateFee: 0,
          lateFeeWaived: false,
        },
        contract: { contractNumber: 'BC-202601-0002', branchId: 'branch-1' },
        userId: 'user-1',
        companyId: 'company-1',
      });
      expect(result).toBeNull();
    });

    it('should create journal entry when Dr = Cr (balanced)', async () => {
      const tx = prisma;
      // Dr: amountPaid = 5900
      // Cr: HP receivable (principal 5000 + interest 500) + commission 100 + VAT 300 = 5900
      const result = await service.createPaymentJournal(tx, {
        payment: {
          id: 'pay-3',
          installmentNo: 1,
          amountPaid: 5900,
          monthlyPrincipal: 5000,
          monthlyInterest: 500,
          monthlyCommission: 100,
          vatAmount: 300,
          lateFee: 0,
          lateFeeWaived: false,
        },
        contract: { contractNumber: 'BC-202601-0003', branchId: 'branch-1' },
        userId: 'user-1',
        companyId: 'company-1',
      });
      expect(result).toBe('je-1');
      expect(prisma.journalEntry.create).toHaveBeenCalled();
    });
  });
});
