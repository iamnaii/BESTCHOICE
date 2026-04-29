import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

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
        findUnique: jest.fn().mockResolvedValue({ companyCode: 'FINANCE' }),
      },
      chartOfAccount: {
        // Phase A.1a: createAndPost validates lookup codes against
        // (companyId, code). Return whatever codes the call asks for so
        // existing tests don't trip the new validation.
        findMany: jest.fn().mockImplementation(({ where }: { where: { code?: { in?: string[] } } }) => {
          const codes = where?.code?.in ?? [];
          return Promise.resolve(codes.map((code: string) => ({ code, nameTh: code })));
        }),
      },
      // F-6-002: default — no closed period
      accountingPeriod: {
        findFirst: jest.fn().mockResolvedValue(null),
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

  // Helper: capture the lines array passed to journalEntry.create
  function capturedLines(): Array<{ accountCode: string; debit: number; credit: number }> {
    const call = prisma.journalEntry.create.mock.calls[0][0];
    return call.data.lines.create as Array<{ accountCode: string; debit: number; credit: number }>;
  }

  function sumDebits(lines: Array<{ debit: number; credit: number }>) {
    return lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  }

  function sumCredits(lines: Array<{ debit: number; credit: number }>) {
    return lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  }

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

  // ──────────────────────────────────────────────────────────────────────────
  // createExpenseJournal
  // ──────────────────────────────────────────────────────────────────────────
  describe('createExpenseJournal', () => {
    const baseExpense = {
      id: 'exp-1',
      expenseNumber: 'EX-202601-0001',
      accountCode: '52-1101',
      amount: 1000,
      vatAmount: 70,
      totalAmount: 1070,
      description: 'ค่าน้ำมัน',
      expenseDate: new Date('2026-01-15'),
    };

    it('returns null when no active company found', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      const result = await service.createExpenseJournal(prisma, {
        expense: baseExpense,
        userId: 'user-1',
      });

      expect(result).toBeNull();
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('returns null and logs warning when accountCode is missing', async () => {
      const result = await service.createExpenseJournal(prisma, {
        expense: { ...baseExpense, accountCode: undefined },
        userId: 'user-1',
      });

      expect(result).toBeNull();
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('creates balanced journal: Dr Expense + Dr VAT Input = Cr Cash', async () => {
      await service.createExpenseJournal(prisma, {
        expense: baseExpense,
        userId: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      expect(sumDebits(lines)).toBeCloseTo(sumCredits(lines), 2);
    });

    it('uses VAT_INPUT account code on the VAT debit line', async () => {
      await service.createExpenseJournal(prisma, {
        expense: baseExpense,
        userId: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      const vatLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.VAT_INPUT,
      );
      expect(vatLine).toBeDefined();
      expect(Number(vatLine!.debit)).toBeCloseTo(70, 2);
    });

    it('credits the CASH account for the totalAmount (amount + VAT)', async () => {
      await service.createExpenseJournal(prisma, {
        expense: baseExpense,
        userId: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      const cashLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.CASH,
      );
      expect(cashLine).toBeDefined();
      expect(Number(cashLine!.credit)).toBeCloseTo(1070, 2);
    });

    it('uses paymentDate as entryDate when provided', async () => {
      const paymentDate = new Date('2026-02-01');
      await service.createExpenseJournal(prisma, {
        expense: { ...baseExpense, paymentDate },
        userId: 'user-1',
        companyId: 'company-1',
      });

      const createArg = prisma.journalEntry.create.mock.calls[0][0];
      expect(createArg.data.entryDate).toEqual(paymentDate);
    });

    it('falls back to expenseDate when paymentDate is null', async () => {
      await service.createExpenseJournal(prisma, {
        expense: { ...baseExpense, paymentDate: null },
        userId: 'user-1',
        companyId: 'company-1',
      });

      const createArg = prisma.journalEntry.create.mock.calls[0][0];
      expect(createArg.data.entryDate).toEqual(baseExpense.expenseDate);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createContractActivationJournal
  // ──────────────────────────────────────────────────────────────────────────
  describe('createContractActivationJournal', () => {
    // Production formula (installment.util.ts:56):
    //   principal      = sellingPrice - downPayment        = 12300 - 3000 = 9300
    //   financedAmount = principal + commission + interest + vat
    //                  = 9300 + 500 + 800 + 1000           = 11600
    // Activation JE balance:
    //   Dr cash(downPayment 3000) + hpReceivable(financedAmount 11600)            = 14600
    //   Cr revenue(sellingPrice+commission 12800) + interest(800) + vat(1000)     = 14600  ✓
    const baseContract = {
      id: 'contract-1',
      contractNumber: 'BC-202601-0001',
      sellingPrice: 12300,
      downPayment: 3000,
      financedAmount: 11600,
      interestTotal: 800,
      storeCommission: 500,
      vatAmount: 1000,
    };
    const baseProduct = { costPrice: 8000, category: 'NEW_PHONE' };

    it('returns null when no active company found', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      const result = await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: baseProduct,
        userId: 'user-1',
      });

      expect(result).toBeNull();
    });

    it('creates SHOP+FINANCE paired entries each balanced (Phase A.1b)', async () => {
      await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: baseProduct,
        userId: 'user-1',
        shopCompanyId: 'company-1',
        financeCompanyId: 'company-1',
      });

      // 2 entries: SHOP + FINANCE
      expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
      for (const call of prisma.journalEntry.create.mock.calls) {
        const lines = call[0].data.lines.create as Array<{ debit: number; credit: number }>;
        expect(sumDebits(lines)).toBeCloseTo(sumCredits(lines), 2);
      }
    });

    it('debits downPayment to SHOP CASH and financedAmount to FINANCE HP_RECEIVABLE', async () => {
      // Use distinct shop/finance ids so we can route by companyId
      prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
        if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
        if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
        return Promise.resolve(null);
      });

      await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: baseProduct,
        userId: 'user-1',
      });

      const calls = prisma.journalEntry.create.mock.calls.map((c: any[]) => c[0].data);
      const shopEntry = calls.find((d: any) => d.companyId === 'co-SHOP');
      const financeEntry = calls.find((d: any) => d.companyId === 'co-FINANCE');

      const shopLines = shopEntry.lines.create as Array<{ accountCode: string; debit: number; credit: number }>;
      const cashLine = shopLines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.CASH);
      expect(Number(cashLine?.debit)).toBeCloseTo(3000, 2);

      const financeLines = financeEntry.lines.create as Array<{ accountCode: string; debit: number; credit: number }>;
      const hpLine = financeLines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.HP_RECEIVABLE);
      // HP Receivable = financedAmount (already includes principal+commission+interest+vat)
      expect(Number(hpLine?.debit)).toBeCloseTo(11600, 2);
    });

    it('credits VAT_OUTPUT with vatAmount on FINANCE side', async () => {
      prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
        if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
        if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
        return Promise.resolve(null);
      });

      await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: baseProduct,
        userId: 'user-1',
      });

      const calls = prisma.journalEntry.create.mock.calls.map((c: any[]) => c[0].data);
      const financeEntry = calls.find((d: any) => d.companyId === 'co-FINANCE');
      const lines = financeEntry.lines.create as Array<{
        accountCode: string;
        debit: number;
        credit: number;
      }>;

      const vatLine = lines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.VAT_OUTPUT);
      expect(Number(vatLine?.credit)).toBeCloseTo(1000, 2);
    });

    it('always creates 2 paired entries (SHOP + FINANCE) regardless of cost', async () => {
      await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: baseProduct,
        userId: 'user-1',
        shopCompanyId: 'company-1',
        financeCompanyId: 'company-1',
      });

      // Phase A.1b: SHOP+FINANCE = always 2 entries (COGS folded into SHOP)
      expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
    });

    it('still creates 2 entries when costPrice is 0 (no COGS lines on SHOP side)', async () => {
      await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: { costPrice: 0, category: 'NEW_PHONE' },
        userId: 'user-1',
        shopCompanyId: 'company-1',
        financeCompanyId: 'company-1',
      });

      expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);
    });

    it('uses SHOP REVENUE_USED and COGS_USED accounts for used-phone category', async () => {
      prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
        if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
        if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
        return Promise.resolve(null);
      });

      await service.createContractActivationJournal(prisma, {
        contract: baseContract,
        product: { costPrice: 6000, category: 'USED_PHONE' },
        userId: 'user-1',
      });

      const calls = prisma.journalEntry.create.mock.calls.map((c: any[]) => c[0].data);
      const shopEntry = calls.find((d: any) => d.companyId === 'co-SHOP');
      const shopLines = shopEntry.lines.create as Array<{ accountCode: string; debit: number; credit: number }>;

      const revLine = shopLines.find((l) => l.credit > 0 && l.accountCode.startsWith('41'));
      expect(revLine?.accountCode).toBe(JournalAutoService.SHOP_ACC.REVENUE_USED);

      const cogsLine = shopLines.find((l) => l.debit > 0 && l.accountCode === JournalAutoService.SHOP_ACC.COGS_USED);
      expect(cogsLine).toBeTruthy();
    });

    // F-2-001 regression: financedAmount per installment.util.ts:56 already
    // includes principal + commission + interest + vat. The previous code
    // added them again, causing the JE to be unbalanced and createAndPost to
    // throw on every contract activation.
    it('produces balanced JE when financedAmount already includes interest+commission+vat', async () => {
      const principal = new Prisma.Decimal('10000');
      const commission = new Prisma.Decimal('500');
      const interest = new Prisma.Decimal('1000');
      const vat = new Prisma.Decimal('805');
      // Production formula (installment.util.ts:56)
      const financedAmount = principal.plus(commission).plus(interest).plus(vat); // 12305
      // sellingPrice = principal + downPayment (per installment.util.ts:52)
      const downPayment = new Prisma.Decimal('1000');
      const sellingPrice = principal.plus(downPayment); // 11000

      await service.createContractActivationJournal(prisma, {
        contract: {
          id: 'c-fixture',
          contractNumber: 'CT-FIXTURE',
          sellingPrice,
          downPayment,
          financedAmount,
          interestTotal: interest,
          storeCommission: commission,
          vatAmount: vat,
        },
        product: { costPrice: new Prisma.Decimal('8000'), category: 'มือถือใหม่' },
        userId: 'user-1',
        companyId: 'company-1',
      });

      // First call = sales entry
      const salesEntry = prisma.journalEntry.create.mock.calls[0][0];
      const lines = salesEntry.data.lines.create as Array<{ debit: number; credit: number }>;
      const totalDr = sumDebits(lines);
      const totalCr = sumCredits(lines);
      expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.01);
    });

    // ────────────────────────────────────────────────────────────────────
    // Phase A.1b — split SHOP+FINANCE entries (inter-company wiring)
    // ────────────────────────────────────────────────────────────────────
    describe('Phase A.1b — split SHOP+FINANCE entries', () => {
      beforeEach(() => {
        // Make findFirst return SHOP/FINANCE based on companyCode filter
        prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
          if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP', companyCode: 'SHOP' });
          if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE', companyCode: 'FINANCE' });
          return Promise.resolve(null);
        });
      });

      it('creates 2 paired entries (SHOP + FINANCE) for contract activation', async () => {
        const principal = new Prisma.Decimal('10000');
        const commission = new Prisma.Decimal('500');
        const interest = new Prisma.Decimal('1000');
        const vat = new Prisma.Decimal('805');
        const downPayment = new Prisma.Decimal('1000');
        const sellingPrice = principal.plus(downPayment); // 11000
        const financedAmount = principal.plus(commission).plus(interest).plus(vat); // 12305
        const costPrice = new Prisma.Decimal('8000');

        await service.createContractActivationJournal(prisma, {
          contract: {
            id: 'c1',
            contractNumber: 'CT-001',
            sellingPrice,
            downPayment,
            financedAmount,
            interestTotal: interest,
            storeCommission: commission,
            vatAmount: vat,
          },
          product: { costPrice, category: 'มือถือใหม่' },
          userId: 'u1',
          shopCompanyId: 'co-SHOP',
          financeCompanyId: 'co-FINANCE',
        });

        // 2 journalEntry.create calls — one per company entry
        expect(prisma.journalEntry.create).toHaveBeenCalledTimes(2);

        const calls = prisma.journalEntry.create.mock.calls.map((c: any[]) => c[0].data);
        const shopEntry = calls.find((d: any) => d.companyId === 'co-SHOP');
        const financeEntry = calls.find((d: any) => d.companyId === 'co-FINANCE');

        expect(shopEntry).toBeTruthy();
        expect(financeEntry).toBeTruthy();
        expect(shopEntry.description).toMatch(/^\[IC-/);
        expect(financeEntry.description).toMatch(/^\[IC-/);

        // Both share same intercompany id
        const shopIcId = shopEntry.description.match(/\[IC-([0-9a-f-]+)\]/i)?.[1];
        const financeIcId = financeEntry.description.match(/\[IC-([0-9a-f-]+)\]/i)?.[1];
        expect(shopIcId).toBe(financeIcId);

        // SHOP entry balanced
        const shopLines = shopEntry.lines.create as Array<{ accountCode: string; debit: unknown; credit: unknown }>;
        const shopDr = shopLines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
        const shopCr = shopLines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
        expect(Math.abs(shopDr - shopCr)).toBeLessThan(0.01);

        // FINANCE entry balanced
        const financeLines = financeEntry.lines.create as Array<{ accountCode: string; debit: unknown; credit: unknown }>;
        const financeDr = financeLines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
        const financeCr = financeLines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
        expect(Math.abs(financeDr - financeCr)).toBeLessThan(0.01);

        // Inter-company invariant: SHOP Due-from-FINANCE (11-2105) Dr = FINANCE Due-to-SHOP (21-1102) Cr
        const shopDueFrom = Number(shopLines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.DUE_FROM_FINANCE)?.debit ?? 0);
        const financeDueTo = Number(financeLines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.DUE_TO_SHOP)?.credit ?? 0);
        expect(shopDueFrom).toBeCloseTo(financeDueTo, 2);
        // = sellingPrice + commission - downPayment = 11000 + 500 - 1000 = 10500
        expect(shopDueFrom).toBeCloseTo(10500, 2);
      });

      it('SHOP entry contains revenue + commission + COGS lines', async () => {
        await service.createContractActivationJournal(prisma, {
          contract: {
            id: 'c2',
            contractNumber: 'CT-002',
            sellingPrice: 11000,
            downPayment: 1000,
            financedAmount: 12305,
            interestTotal: 1000,
            storeCommission: 500,
            vatAmount: 805,
          },
          product: { costPrice: 8000, category: 'มือถือใหม่' },
          userId: 'u1',
          shopCompanyId: 'co-SHOP',
          financeCompanyId: 'co-FINANCE',
        });

        const calls = prisma.journalEntry.create.mock.calls.map((c: any[]) => c[0].data);
        const shopEntry = calls.find((d: any) => d.companyId === 'co-SHOP');
        const lines = shopEntry.lines.create as Array<{ accountCode: string; debit: unknown; credit: unknown }>;

        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.CASH)?.debit)).toBeCloseTo(1000, 2);
        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.REVENUE_NEW)?.credit)).toBeCloseTo(11000, 2);
        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.COMMISSION_INCOME)?.credit)).toBeCloseTo(500, 2);
        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.COGS_NEW)?.debit)).toBeCloseTo(8000, 2);
        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.SHOP_ACC.INVENTORY_NEW)?.credit)).toBeCloseTo(8000, 2);
      });

      it('FINANCE entry contains HP receivable + interest + VAT lines (no cash, no revenue)', async () => {
        await service.createContractActivationJournal(prisma, {
          contract: {
            id: 'c3',
            contractNumber: 'CT-003',
            sellingPrice: 11000,
            downPayment: 1000,
            financedAmount: 12305,
            interestTotal: 1000,
            storeCommission: 500,
            vatAmount: 805,
          },
          product: { costPrice: 8000, category: 'มือถือใหม่' },
          userId: 'u1',
          shopCompanyId: 'co-SHOP',
          financeCompanyId: 'co-FINANCE',
        });

        const calls = prisma.journalEntry.create.mock.calls.map((c: any[]) => c[0].data);
        const financeEntry = calls.find((d: any) => d.companyId === 'co-FINANCE');
        const lines = financeEntry.lines.create as Array<{ accountCode: string; debit: unknown; credit: unknown }>;

        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.HP_RECEIVABLE)?.debit)).toBeCloseTo(12305, 2);
        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.INTEREST_INCOME)?.credit)).toBeCloseTo(1000, 2);
        expect(Number(lines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.VAT_OUTPUT)?.credit)).toBeCloseTo(805, 2);
        // No cash on FINANCE side
        expect(lines.find((l) => l.accountCode === JournalAutoService.FINANCE_ACC.CASH)).toBeUndefined();
      });

      it('throws when SHOP company missing but FINANCE present', async () => {
        prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
          if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
          return Promise.resolve(null);
        });

        await expect(
          service.createContractActivationJournal(prisma, {
            contract: baseContract,
            product: baseProduct,
            userId: 'u1',
          }),
        ).rejects.toThrow(InternalServerErrorException);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createBadDebtWriteOffJournal
  // ──────────────────────────────────────────────────────────────────────────
  describe('createBadDebtWriteOffJournal', () => {
    it('returns null when no active company found', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      const result = await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        createdById: 'user-1',
      });

      expect(result).toBeNull();
    });

    it('creates balanced write-off entry: Dr Bad Debt Expense / Cr HP Receivable (no provision)', async () => {
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      expect(sumDebits(lines)).toBeCloseTo(sumCredits(lines), 2);
    });

    it('debits BAD_DEBT_EXPENSE for the full amount when no provision', async () => {
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      const badDebtLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.BAD_DEBT_EXPENSE,
      );
      expect(Number(badDebtLine?.debit)).toBeCloseTo(5000, 2);
    });

    it('credits HP_RECEIVABLE for the full writeOffAmount', async () => {
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      const hpLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.HP_RECEIVABLE,
      );
      expect(Number(hpLine?.credit)).toBeCloseTo(5000, 2);
    });

    it('utilises ALLOWANCE_DOUBTFUL for the provision portion (partial provision)', async () => {
      // writeOff = 5000, provision = 2000 → Bad Debt Expense = 3000, Allowance Dr = 2000
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        provisionAmount: 2000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      const badDebtLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.BAD_DEBT_EXPENSE,
      );
      const allowanceLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.ALLOWANCE_DOUBTFUL,
      );
      expect(Number(badDebtLine?.debit)).toBeCloseTo(3000, 2);
      expect(Number(allowanceLine?.debit)).toBeCloseTo(2000, 2);
    });

    it('drops BAD_DEBT_EXPENSE line when provision fully covers writeOff (no extra expense)', async () => {
      // provision = writeOff → incremental expense = 0 → line should be dropped
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        provisionAmount: 5000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      // zero-line filter removes it
      const badDebtLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.BAD_DEBT_EXPENSE,
      );
      expect(badDebtLine).toBeUndefined();
    });

    it('entry is still balanced when provision fully covers writeOff', async () => {
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-1',
        contractNumber: 'BC-202601-0001',
        writeOffAmount: 5000,
        provisionAmount: 5000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      expect(sumDebits(lines)).toBeCloseTo(sumCredits(lines), 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 4.12 — End-to-End Trial Balance
  // Verifies: sum of ALL debit lines = sum of ALL credit lines across a full
  // set of journal entries (activation + payment + expense + bad-debt write-off)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Phase 4.12 — trial balance end-to-end', () => {
    it('total Dr = total Cr across all journal types', async () => {
      // Each journalEntry.create call captures one set of lines.
      // We collect all captured lines across all calls and sum globally.
      const capturedAllLines: Array<{ accountCode: string; debit: number; credit: number }> = [];

      prisma.journalEntry.create.mockImplementation((args: { data: { lines: { create: Array<{ accountCode: string; debit: number; credit: number }> } } }) => {
        const lines = args.data.lines.create as Array<{ accountCode: string; debit: number; credit: number }>;
        capturedAllLines.push(...lines);
        return Promise.resolve({ id: `je-${capturedAllLines.length}` });
      });

      // ── 1. Contract Activation journal ──────────────────────────────────
      // financedAmount = principal(9300) + commission(500) + interest(800) + vat(1000) = 11600
      // Sales JE  : Dr cash(3000) + hpReceivable(11600) = Cr revenue(12800) + interest(800) + vat(1000) = 14600
      // COGS JE   : Dr COGS(8000) = Cr Inventory(8000)
      await service.createContractActivationJournal(prisma, {
        contract: {
          id: 'contract-tb',
          contractNumber: 'BC-TB-0001',
          sellingPrice: 12300,
          downPayment: 3000,
          financedAmount: 11600,
          interestTotal: 800,
          storeCommission: 500,
          vatAmount: 1000,
        },
        product: { costPrice: 8000, category: 'NEW_PHONE' },
        userId: 'user-1',
        companyId: 'company-1',
      });

      // ── 2. Payment journal ───────────────────────────────────────────────
      // Dr Cash (5 900) / Cr HP Receivable (5 500) + Cr Commission (100) + Cr VAT (300)
      await service.createPaymentJournal(prisma, {
        payment: {
          id: 'pay-tb-1',
          installmentNo: 1,
          amountPaid: 5900,
          monthlyPrincipal: 5000,
          monthlyInterest: 500,
          monthlyCommission: 100,
          vatAmount: 300,
          lateFee: 0,
          lateFeeWaived: false,
        },
        contract: { contractNumber: 'BC-TB-0001', branchId: 'branch-1' },
        userId: 'user-1',
        companyId: 'company-1',
      });

      // ── 3. Expense journal ───────────────────────────────────────────────
      // Dr Expense (1 000) + Dr VAT Input (70) / Cr Cash (1 070)
      await service.createExpenseJournal(prisma, {
        expense: {
          id: 'exp-tb',
          expenseNumber: 'EX-TB-0001',
          accountCode: '52-1101',
          amount: 1000,
          vatAmount: 70,
          totalAmount: 1070,
          description: 'ค่าใช้จ่ายทดสอบ',
          expenseDate: new Date('2026-04-01'),
        },
        userId: 'user-1',
        companyId: 'company-1',
      });

      // ── 4. Bad debt write-off journal ────────────────────────────────────
      // Dr Bad Debt Expense (3 000) + Dr Allowance (2 000) / Cr HP Receivable (5 000)
      await service.createBadDebtWriteOffJournal(prisma, {
        contractId: 'contract-tb',
        contractNumber: 'BC-TB-0001',
        writeOffAmount: 5000,
        provisionAmount: 2000,
        createdById: 'user-1',
        companyId: 'company-1',
      });

      // ── Assert: global trial balance ──────────────────────────────────────
      const totalDr = capturedAllLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const totalCr = capturedAllLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

      expect(totalDr).toBeGreaterThan(0);
      expect(totalCr).toBeGreaterThan(0);
      expect(totalDr).toBeCloseTo(totalCr, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Regression: Phase 4.6 — late fee MUST NOT go to VAT_OUTPUT
  // ──────────────────────────────────────────────────────────────────────────
  describe('Phase 4.6 regression — late fee not in VAT Output', () => {
    it('routes lateFee to LATE_FEE_INCOME, not VAT_OUTPUT', async () => {
      const tx = prisma;
      // Dr: amountPaid = 1200 (principal 1000 + lateFee 200)
      // Cr: HP receivable 1000 + late fee income 200
      // No VAT involved (lateFeeWaived = false, vatAmount = 0)
      await service.createPaymentJournal(tx, {
        payment: {
          id: 'pay-late',
          installmentNo: 3,
          amountPaid: 1200,
          monthlyPrincipal: 1000,
          monthlyInterest: 0,
          monthlyCommission: 0,
          vatAmount: 0,
          lateFee: 200,
          lateFeeWaived: false,
        },
        contract: { contractNumber: 'BC-202601-0005', branchId: 'branch-1' },
        userId: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();

      // Late fee should appear on LATE_FEE_INCOME as a credit
      const lateFeeIncomeLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.LATE_FEE_INCOME,
      );
      expect(lateFeeIncomeLine).toBeDefined();
      expect(Number(lateFeeIncomeLine!.credit)).toBeCloseTo(200, 2);

      // VAT_OUTPUT must be zero (or absent) — late fee is VAT-exempt
      const vatOutputLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.VAT_OUTPUT,
      );
      const vatOutputCredit = vatOutputLine ? Number(vatOutputLine.credit) : 0;
      expect(vatOutputCredit).toBe(0);
    });

    it('skips lateFee completely when lateFeeWaived = true', async () => {
      const tx = prisma;
      // amountPaid = principal + interest = 5500, no late fee
      await service.createPaymentJournal(tx, {
        payment: {
          id: 'pay-waived',
          installmentNo: 4,
          amountPaid: 5500,
          monthlyPrincipal: 5000,
          monthlyInterest: 500,
          monthlyCommission: 0,
          vatAmount: 0,
          lateFee: 300, // waived
          lateFeeWaived: true,
        },
        contract: { contractNumber: 'BC-202601-0006', branchId: 'branch-1' },
        userId: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();

      const lateFeeIncomeLine = lines.find(
        (l) => l.accountCode === JournalAutoService.FINANCE_ACC.LATE_FEE_INCOME,
      );
      // Should be absent (zero-line filter removes it)
      expect(lateFeeIncomeLine).toBeUndefined();
    });

    it('entry remains balanced when both lateFee and VAT are present in a single payment', async () => {
      const tx = prisma;
      // Dr: amountPaid = 5900 + 200 = 6100
      // Cr: HP (5000+500) + commission(100) + vat(300) + lateFee(200) = 6100
      await service.createPaymentJournal(tx, {
        payment: {
          id: 'pay-mixed',
          installmentNo: 5,
          amountPaid: 6100,
          monthlyPrincipal: 5000,
          monthlyInterest: 500,
          monthlyCommission: 100,
          vatAmount: 300,
          lateFee: 200,
          lateFeeWaived: false,
        },
        contract: { contractNumber: 'BC-202601-0007', branchId: 'branch-1' },
        userId: 'user-1',
        companyId: 'company-1',
      });

      const lines = capturedLines();
      expect(sumDebits(lines)).toBeCloseTo(sumCredits(lines), 2);
    });
  });

  describe('createAndPost — Decimal precision (F-2-010)', () => {
    it('balance check uses Decimal precision (no floating-point drift) (F-2-010)', async () => {
      // Construct many lines that sum to identical totals via Decimal
      // but might drift in JS Number addition (e.g. 0.1 + 0.1 + ... = 3.0000000000000004).
      const tx = prisma;
      const lines: Array<{ accountCode: string; debit: number; credit: number }> = [];
      for (let i = 0; i < 30; i++) lines.push({ accountCode: '11-1101', debit: 0.1, credit: 0 });
      for (let i = 0; i < 30; i++) lines.push({ accountCode: '21-2101', debit: 0, credit: 0.1 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect((service as any).createAndPost(tx, {
        companyId: 'co1',
        entryDate: new Date(),
        description: 'Decimal precision test',
        referenceType: 'TEST',
        referenceId: 'test-decimal',
        createdById: 'u1',
        lines,
      })).resolves.toBeTruthy();
    });
  });

  describe('resolveCompanyId determinism', () => {
    it('resolveCompanyId returns deterministic company across calls (F-3-027 part 1/3)', async () => {
      const tx = {
        companyInfo: {
          findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (service as any).resolveCompanyId(tx);
      expect(tx.companyInfo.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
        })
      );
      expect(result).toBe('co-FINANCE');
    });
  });

  // Phase A.1a: allowedCompanies removed; chart partitioned by composite (companyId, code).
  // createAndPost now rejects codes that don't exist in the target company's chart.
  describe('createAndPost — chart partition validation (Phase A.1a)', () => {
    it('throws BadRequestException when account code does not exist in target company chart', async () => {
      const tx = {
        companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'SHOP' }) },
        chartOfAccount: {
          // Only 11-1101 exists in SHOP chart. 11-2102 does not (HP_RECEIVABLE is FINANCE-only).
          findMany: jest.fn().mockResolvedValue([
            { code: '11-1101', nameTh: 'เงินสด' },
          ]),
        },
        accountingPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
        journalEntry: { count: jest.fn(), create: jest.fn() },
      };
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).createAndPost(tx, {
          companyId: 'co-SHOP',
          entryDate: new Date(),
          description: 'test',
          referenceType: 'TEST',
          referenceId: 'test',
          createdById: 'u1',
          lines: [
            { accountCode: '11-2102', debit: 100, credit: 0 },
            { accountCode: '11-1101', debit: 0, credit: 100 },
          ],
        }),
      ).rejects.toThrow(/11-2102.*chart.*co-SHOP/);
    });

    it('queries chartOfAccount with composite (companyId, code) filter', async () => {
      const findMany = jest.fn().mockResolvedValue([{ code: '11-1101', nameTh: 'เงินสด' }]);
      const tx = {
        companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'SHOP' }) },
        chartOfAccount: { findMany },
        accountingPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
        journalEntry: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'entry1' }),
        },
      };
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).createAndPost(tx, {
          companyId: 'co-SHOP',
          entryDate: new Date(),
          description: 'test',
          referenceType: 'TEST',
          referenceId: 'test',
          createdById: 'u1',
          lines: [
            { accountCode: '11-1101', debit: 100, credit: 0 },
            { accountCode: '11-1101', debit: 0, credit: 100 },
          ],
        }),
      ).resolves.toBe('entry1');
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'co-SHOP',
            code: { in: ['11-1101'] },
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F-6-002: createAndPost — soft-block CLOSED period
  // ──────────────────────────────────────────────────────────────────────────
  describe('createAndPost — soft-block CLOSED period (F-6-002)', () => {
    it('redirects entryDate to current period if originally in CLOSED period (F-6-002)', async () => {
      const tx = {
        accountingPeriod: { findFirst: jest.fn().mockResolvedValue({ status: 'CLOSED' }) },
        companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'FINANCE' }) },
        chartOfAccount: {
          findMany: jest.fn().mockResolvedValue([
            { code: '11-1101', nameTh: 'เงินสด' },
            { code: '21-2101', nameTh: 'ภาษีขาย' },
          ]),
        },
        journalEntry: {
          count: jest.fn().mockResolvedValue(0),
          create: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve({ id: 'e1', _captured: data })),
        },
      };
      (Sentry.captureMessage as jest.Mock).mockClear();
      const originalDate = new Date('2025-03-15T00:00:00Z');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).createAndPost(tx, {
        companyId: 'co1',
        entryDate: originalDate,
        description: 'Original description',
        referenceType: 'TEST',
        referenceId: 'test-redirect',
        createdById: 'u1',
        lines: [
          { accountCode: '11-1101', debit: 100, credit: 0 },
          { accountCode: '21-2101', debit: 0, credit: 100 },
        ],
      });

      // The captured create call should have a current-period entryDate (year matches now)
      const created = tx.journalEntry.create.mock.calls[0][0].data;
      expect(created.entryDate.getFullYear()).toBe(new Date().getFullYear());
      expect(created.description).toMatch(/^\[Originally for 2025-03\]/);
      expect(Sentry.captureMessage).toHaveBeenCalled();
    });
  });
});
