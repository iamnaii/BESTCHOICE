import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ActualJe } from './golden-je-matcher';

export interface StandardContract {
  id: string;
  financedAmount: Decimal;
  commission: Decimal;
  interest: Decimal;
  vatTotal: Decimal;
  installmentCount: number;
  installmentTotal: Decimal; // 1515.83
  startDate: Date;
}

// ---------------------------------------------------------------------------
// Parent-record helpers (idempotent — safe to call multiple times per test run)
// ---------------------------------------------------------------------------

async function ensureTestCompany(prisma: PrismaClient): Promise<string> {
  const code = 'TEST_FINANCE';
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: code } });
  if (existing) return existing.id;
  const created = await prisma.companyInfo.create({
    data: {
      nameTh: 'Test Finance Co.',
      taxId: '0000000000000',
      companyCode: code,
      address: '1 Test Rd.',
      directorName: 'Test Director',
      vatRegistered: true,
      vatRate: new Decimal('0.0700'),
    },
  });
  return created.id;
}

async function ensureTestBranch(prisma: PrismaClient, companyId: string): Promise<string> {
  const existing = await prisma.branch.findFirst({
    where: { name: '__test_branch__', deletedAt: null },
  });
  if (existing) return existing.id;
  const created = await prisma.branch.create({
    data: {
      name: '__test_branch__',
      companyId,
    },
  });
  return created.id;
}

async function ensureTestUser(prisma: PrismaClient, branchId: string): Promise<string> {
  const email = 'test-salesperson@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      password: 'hashed_placeholder',
      name: 'Test Salesperson',
      role: 'SALES',
      branchId,
    },
  });
  return created.id;
}

async function ensureTestCustomer(prisma: PrismaClient): Promise<string> {
  const phone = '0800000000';
  const nationalId = 'TEST_NATIONAL_ID_001';
  const existing = await prisma.customer.findFirst({ where: { phone } });
  if (existing) return existing.id;
  const created = await prisma.customer.create({
    data: {
      name: 'Test Customer',
      phone,
      nationalId,
    },
  });
  return created.id;
}

async function ensureTestProduct(prisma: PrismaClient, branchId: string): Promise<string> {
  const existing = await prisma.product.findFirst({
    where: { imeiSerial: 'TEST_IMEI_000000', deletedAt: null },
  });
  if (existing) return existing.id;
  const created = await prisma.product.create({
    data: {
      name: 'Test Phone',
      brand: 'TestBrand',
      model: 'TestModel',
      imeiSerial: 'TEST_IMEI_000000',
      category: 'PHONE_NEW',
      costPrice: new Decimal('8000.00'),
      branchId,
      status: 'IN_STOCK',
    },
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// Standard 17K / 12M fixture
// ---------------------------------------------------------------------------

/**
 * Seeds a STANDARD_17K_12M contract scenario into the test DB.
 *
 * Loan math:
 *   financedAmount  = 10,000.00  (device price – down payment)
 *   commission      =  1,000.00  (10 % of financed amount)
 *   interest        =  6,000.00  (flat 60 % of financed, 12 months)
 *   grossExclVat    = 17,000.00
 *   vatTotal        =  1,190.00  (7 % of gross)
 *   grandTotal      = 18,190.00
 *   installmentExclVat = 1,416.67  (17,000 / 12, last-cent adjusted)
 *   vatPerInst         =    99.17  (1,190 / 12, last-cent adjusted)
 *   installmentTotal   = 1,515.83  (per installment incl. VAT)
 */
export async function seedStandard17k12m(prisma: PrismaClient): Promise<StandardContract> {
  const financedAmount = new Decimal('10000.00');
  const commission = new Decimal('1000.00');
  const interest = new Decimal('6000.00');
  const vatTotal = new Decimal('1190.00');
  const installmentCount = 12;

  const grossExclVat = financedAmount.plus(commission).plus(interest); // 17,000
  const installmentExclVat = grossExclVat.div(installmentCount).toDecimalPlaces(2); // 1,416.67
  const vatPerInstallment = vatTotal.div(installmentCount).toDecimalPlaces(2); //    99.17
  const installmentTotal = installmentExclVat.plus(vatPerInstallment); // 1,515.83 (but may be 1515.84?)

  const startDate = new Date('2025-01-01');

  // Ensure parent records exist
  const companyId = await ensureTestCompany(prisma);
  const branchId = await ensureTestBranch(prisma, companyId);
  const salespersonId = await ensureTestUser(prisma, branchId);
  const customerId = await ensureTestCustomer(prisma);
  const productId = await ensureTestProduct(prisma, branchId);

  // Build a unique contract number per run to avoid collisions
  const contractNumber = `TEST-${Date.now()}`;

  const contract = await prisma.contract.create({
    data: {
      contractNumber,
      customerId,
      productId,
      branchId,
      salespersonId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal('12000.00'), // device selling price
      downPayment: new Decimal('2000.00'), // financedAmount = 12000 - 2000 = 10000
      financedAmount,
      interestRate: new Decimal('0.6000'), // 60% flat
      totalMonths: installmentCount,
      interestTotal: interest,
      storeCommission: commission,
      vatAmount: vatTotal,
      vatPct: new Decimal('0.0700'),
      monthlyPayment: installmentTotal,
      status: 'ACTIVE',
    },
  });

  // Seed 12 installment_schedule rows
  const principalPerInst = financedAmount.div(installmentCount).toDecimalPlaces(2);
  const interestPerInst = interest.div(installmentCount).toDecimalPlaces(2);
  const amountDuePerInst = principalPerInst.plus(interestPerInst).plus(vatPerInstallment);

  for (let i = 1; i <= installmentCount; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    await prisma.installmentSchedule.create({
      data: {
        contractId: contract.id,
        installmentNo: i,
        dueDate,
        principal: principalPerInst,
        interest: interestPerInst,
        amountDue: amountDuePerInst,
      },
    });
  }

  return {
    id: contract.id,
    financedAmount,
    commission,
    interest,
    vatTotal,
    installmentCount,
    installmentTotal,
    startDate,
  };
}

// ---------------------------------------------------------------------------
// JE block formatter
// ---------------------------------------------------------------------------

/**
 * Reads all JournalEntries linked to contractId via referenceId,
 * and returns them as ActualJe blocks sorted by postedAt asc.
 *
 * NOTE: JournalLine uses `debit`/`credit` columns (not `dr`/`cr`).
 * We map them to the ActualJe interface which uses `dr`/`cr`.
 */
export async function formatJEsAsBlocks(
  prisma: PrismaClient,
  contractId: string,
): Promise<ActualJe[]> {
  const entries = await prisma.journalEntry.findMany({
    where: { referenceId: contractId },
    include: { lines: true },
    orderBy: { postedAt: 'asc' },
  });
  return entries.map((e) => ({
    tag: ((e.metadata as Record<string, unknown>)?.tag ?? '?') as string,
    lines: e.lines.map((l) => ({
      code: l.accountCode,
      dr: new Decimal(l.debit.toString()),
      cr: new Decimal(l.credit.toString()),
    })),
  }));
}
