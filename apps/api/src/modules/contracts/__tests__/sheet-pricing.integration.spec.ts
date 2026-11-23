/** Real PostgreSQL: sheet quote -> persisted schedule -> accounting basis.
 * Run with tools/test-db-vitest.sh; fixtures roll back, never use an app DB.
 */
import { describe, it, expect } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { bcSheetRows } from '../../../../../../packages/shared/src/__fixtures__/bc-sheet-2026-11-23';
import { ContractQuoteService, contractQuotePayments } from '../services/contract-quote.service';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { accrual2AInputOf, buildAccrual2ALines, buildAccrual2AReversalLines } from '../../journal/build-accrual-2a-lines';

describe('new sheet contracts preserve quoted amounts through accounting', () => {
  it('matches all 53 sheet rows, including every last installment, while preserving legacy policy', async () => {
    const db = new PrismaClient();
    const rollback = new Error('fixture rollback');
    try {
      await db.$transaction(async tx => {
        await tx.interestConfig.updateMany({ data: { isActive: false } });
        await tx.interestConfig.create({ data: { name: 'sheet fixture', productCategories: ['PHONE_NEW', 'PHONE_USED'],
          interestRate: '.0417', minDownPaymentPct: '.15', storeCommissionPct: '.1', vatPct: '.07',
          minInstallmentMonths: 10, maxInstallmentMonths: 12,
          rates: { create: [{ months: 10, ratePct: '.5' }, { months: 12, ratePct: '.5' }] } } });
        await tx.companyInfo.upsert({ where: { companyCode: 'FINANCE' },
          update: { vatRegistered: true, vatRate: '.07', deletedAt: null },
          create: { companyCode: 'FINANCE', nameTh: 'Synthetic finance', taxId: '0000000000000', address: 'test',
            directorName: 'test', vatRegistered: true, vatRate: '.07' } });
        const branch = await tx.branch.create({ data: { name: 'Sheet test' } });
        const user = await tx.user.create({ data: { name: 'Test', email: 'sheet-fixture@test.invalid', password: 'unused', role: 'OWNER' } });
        const customer = await tx.customer.create({ data: { name: 'Synthetic sheet customer', phone: '0800000000', nationalId: 'sheet-fixture' } });
        const service = new ContractQuoteService(db as never);
        let index = 0;
        for (const row of bcSheetRows) {
          const product = await tx.product.create({ data: { name: row.model, brand: 'Apple', model: row.model,
            storage: row.storage, category: row.category, branchId: branch.id, costPrice: 0, status: 'IN_STOCK' } });
          const input = { productId: product.id, customerId: customer.id, branchId: branch.id,
            sellingPrice: row.price, downPayment: row.down, totalMonths: row.months, paymentDueDay: 15 };
          const quote = await service.resolve(input, { id: user.id, role: 'OWNER' }, tx);
          expect(quote.monthlyPayment).toBe(row.monthly.toFixed(2));
          expect(quote.lastPayment).toBe(quote.monthlyPayment);
          expect(quote.installmentRoundingPolicy).toBe('SHEET_WHOLE_BAHT');
          const contract = await tx.contract.create({ data: { contractNumber: `SHEET-FIXTURE-${index++}`,
            customerId: customer.id, productId: product.id, branchId: branch.id, salespersonId: user.id,
            planType: 'STORE_WITH_INTEREST', sellingPrice: quote.sellingPrice, downPayment: quote.downPayment,
            interestRate: quote.interestRate, totalMonths: quote.totalMonths, interestTotal: quote.interestTotal,
            financedAmount: quote.principal, storeCommission: quote.storeCommission, vatAmount: quote.vatAmount,
            vatPct: quote.effectiveVatPct, monthlyPayment: quote.monthlyPayment,
            installmentRoundingPolicy: quote.installmentRoundingPolicy } });
          await tx.payment.createMany({ data: contractQuotePayments(quote, contract.id) });
          const payments = await tx.payment.findMany({ where: { contractId: contract.id }, orderBy: { installmentNo: 'asc' } });
          const sums = { monthlyPrincipal: new Prisma.Decimal(0), monthlyInterest: new Prisma.Decimal(0),
            monthlyCommission: new Prisma.Decimal(0), vatAmount: new Prisma.Decimal(0) };
          for (const payment of payments) {
            expect(payment.amountDue.toNumber()).toBe(row.monthly);
            const basis = accrual2AInputOf(contract, payment.installmentNo);
            const ledger = computeInstallmentBreakdown(basis);
            expect(ledger.installmentTotal.eq(payment.amountDue)).toBe(true);
            expect(ledger.vatPerInst.eq(payment.vatAmount!)).toBe(true);
            expect(ledger.interestPerInst.eq(payment.monthlyInterest!)).toBe(true);
            for (const lines of [buildAccrual2ALines(basis).lines, buildAccrual2AReversalLines(basis).lines]) {
              expect(lines.reduce((sum, line) => sum.plus(line.dr).minus(line.cr), new Prisma.Decimal(0)).isZero()).toBe(true);
            }
            for (const key of Object.keys(sums) as Array<keyof typeof sums>) sums[key] = sums[key].plus(payment[key] ?? 0);
          }
          expect(sums.monthlyPrincipal.eq(contract.financedAmount)).toBe(true);
          expect(sums.monthlyInterest.eq(contract.interestTotal)).toBe(true);
          expect(sums.monthlyCommission.eq(contract.storeCommission!)).toBe(true);
          expect(sums.vatAmount.eq(contract.vatAmount!)).toBe(true);
          // Old scheduleless drafts explicitly keep the legacy resolver.
          const oldQuote = await service.resolve(input, { id: user.id, role: 'OWNER' }, tx, { sheetPricing: false });
          expect(oldQuote.installmentRoundingPolicy).toBeNull();
          expect(oldQuote.fingerprint).not.toBe(quote.fingerprint);
        }
        // Even identical component totals do not silently opt a legacy contract
        // into whole-baht accounting: the persisted marker is mandatory.
        const legacy = { financedAmount: 10600, storeCommission: 1060, interestTotal: '5285.79', vatAmount: '1186.21', totalMonths: 12 };
        expect(computeInstallmentBreakdown(legacy).installmentTotal.toFixed(2)).toBe('1510.99');
        expect(computeInstallmentBreakdown({ ...legacy, installmentRoundingPolicy: 'SHEET_WHOLE_BAHT' }).installmentTotal.toFixed(2)).toBe('1511.00');
        throw rollback;
      }, { timeout: 120000 });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await db.$disconnect(); }
  }, 150000);
});
