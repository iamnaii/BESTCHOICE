import { SalesQueryService } from '../src/modules/sales/services/sales-query.service';
import { ShopDownPaymentTemplate } from '../src/modules/journal/cpa-templates/shop-down-payment.template';
import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedShopCoa } from '../prisma/seed-coa-shop';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { CompanyResolverService } from '../src/modules/journal/company-resolver.service';
import { ShopAccountResolver } from '../src/modules/journal/shop-account-resolver.service';
import { ShopCashSaleTemplate } from '../src/modules/journal/cpa-templates/shop-cash-sale.template';
import { ShopExternalFinanceSaleTemplate } from '../src/modules/journal/cpa-templates/shop-external-finance-sale.template';
import { ShopExternalFinanceReceiptTemplate } from '../src/modules/journal/cpa-templates/shop-external-finance-receipt.template';
import { ExchangeCancelReversalTemplate } from '../src/modules/journal/cpa-templates/exchange-cancel-reversal.template';
import { SaleCreationService } from '../src/modules/sales/services/sale-creation.service';
import { SaleWriterService } from '../src/modules/sales/services/sale-writer.service';
import { SaleVoidService } from '../src/modules/sales/services/sale-void.service';
import { InterCompanyService } from '../src/modules/inter-company/inter-company.service';
import { FinanceReceivableService } from '../src/modules/finance-receivable/finance-receivable.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}

describe('External finance received cash and real journal on isolated PostgreSQL', () => {
  const db = new PrismaService();
  const prefix = `ISOLATED-SALES-MONEY-${randomUUID()}`;
  let sales: SaleCreationService, voids: SaleVoidService, receivables: FinanceReceivableService;
  let branchId: string, shopId: string, ownerId: string, customerId: string;
  const entries = (saleId: string) => db.journalEntry.findMany({
    where: { deletedAt: null, metadata: { path: ['saleId'], equals: saleId } }, include: { lines: true },
  });
  type Entries = Awaited<ReturnType<typeof entries>>;
  const netDebit = (rows: Entries, accountCode: string) => rows.flatMap(row => row.lines)
    .filter(line => line.accountCode === accountCode)
    .reduce((total, line) => total.plus(line.debit).minus(line.credit), new Decimal(0)).toNumber();

  beforeAll(async () => {
    await db.$connect();
    await seedShopCoa(db);
    shopId = (await db.companyInfo.upsert({ where: { companyCode: 'SHOP' }, create: {
      companyCode: 'SHOP', nameTh: 'ISOLATED SHOP', taxId: '9999999999996', address: 'Synthetic Road',
      directorName: 'Synthetic Director', vatRegistered: true, vatRate: '0.0700',
    }, update: {} })).id;
    // JournalAutoService resolves its system actor through this existing fixture convention.
    await db.user.upsert({ where: { email: 'admin@bestchoice.com' }, create: {
      email: 'admin@bestchoice.com', password: 'unused', name: 'ISOLATED OWNER', role: 'OWNER',
    }, update: {} });
    ownerId = (await db.user.create({ data: { name: prefix, email: `${prefix}@example.invalid`,
      password: 'unused', role: 'OWNER' } })).id;
    branchId = (await db.branch.create({ data: { name: prefix, companyId: shopId, shopCashAccountCode: 'S11-1101' } })).id;
    customerId = (await db.customer.create({ data: { name: prefix, phone: '0800000000', nationalId: '7900000000002' } })).id;
    const journal = new JournalAutoService(db), companies = new CompanyResolverService(db);
    const accounts = new ShopAccountResolver(db), interco = new InterCompanyService(db);
    const writer = new SaleWriterService(db, interco, new ShopCashSaleTemplate(journal, db, companies), accounts,
      new ShopExternalFinanceSaleTemplate(journal, db, companies), new ShopDownPaymentTemplate(journal, db, companies));
    // Only the external warranty notification is substituted; all monetary writes are real.
    sales = new SaleCreationService(db, writer, interco, { notify: async () => undefined } as never);
    voids = new SaleVoidService(db, new ExchangeCancelReversalTemplate(journal, db));
    receivables = new FinanceReceivableService(db, new ShopExternalFinanceReceiptTemplate(journal, db, companies));
  });
  afterAll(async () => { await db.$disconnect(); });

  const createSale = async (downPayment: number) => {
    const product = await db.product.create({ data: { name: prefix, brand: 'SYNTHETIC', model: 'MONEY',
      category: 'PHONE_NEW', imeiSerial: `${prefix}-${randomUUID()}`, branchId, ownedByCompanyId: shopId,
      costPrice: 6000, cashPrice: 10000, status: 'IN_STOCK' } });
    const sale = await sales.create({ saleType: 'EXTERNAL_FINANCE', productId: product.id, branchId, customerId,
      sellingPrice: 10000, downPayment, financeAmount: 10000 - downPayment,
      financeCompany: prefix, paymentMethod: 'CASH' }, ownerId, 'OWNER');
    const receivable = await db.financeReceivable.findFirstOrThrow({ where: { saleId: sale.id } });
    return { sale, product, receivable };
  };

  it.each([0, 2000])('records only %s received now and the rest as an external receivable', async down => {
    const { sale, receivable } = await createSale(down);
    const stored = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stored.amountReceived?.toNumber()).toBe(down);
    expect(stored.downPaymentAmount?.toNumber()).toBe(down);
    expect(receivable.expectedAmount.toNumber()).toBe(10000 - down);
    expect(receivable.receivedAmount?.toNumber() ?? 0).toBe(0);
    expect(receivable.status).toBe('PENDING');
    const rows = await entries(sale.id);
    expect(rows).toHaveLength(1); // No skipped or mocked accounting template.
    expect(netDebit(rows, 'S11-1101')).toBe(down);
    expect(netDebit(rows, 'S11-3101')).toBe(10000 - down);
    expect(netDebit(rows, 'S11-2001')).toBe(-6000);
    expect(netDebit(rows, 'S41-1101')).toBe(-10000);
  });

  it('freezes cost, excludes missing history and never exposes it to staff', async () => {
    const { sale, product } = await createSale(0);
    await db.product.update({ where: { id: product.id }, data: { costPrice: 9999 } });
    const read = new SalesQueryService(db);
    const owner = { id: ownerId, role: 'OWNER' };
    const stored = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    const filters = { search: stored.saleNumber };
    const result = await read.findAll(filters, owner);
    expect(result.data[0].costPriceSnapshot?.toString()).toBe('6000');
    expect(result.summary).toMatchObject({ totalProfit: 4000, missingCostCount: 0 });
    const staff = await read.findOne(sale.id, { id: ownerId, role: 'SALES', branchId });
    expect(staff).not.toHaveProperty('costPriceSnapshot');
    expect(staff).not.toHaveProperty('costSnapshot');
    expect(staff.product).not.toHaveProperty('costPrice');
    const snapshot = await read.exportRows(filters, owner);
    expect(snapshot.data[0].costPriceSnapshot?.toString()).toBe('6000');
    expect(snapshot.asOf).toBeTruthy();
  });

  it('receives the pending balance once without counting it as the original down payment', async () => {
    const { sale, receivable } = await createSale(0);
    const dto = { receivedAmount: 10000, receivedDate: new Date().toISOString(), bankRef: 'SYNTHETIC-TRANSFER', depositAccountCode: 'S11-1201' };
    await receivables.recordReceive(receivable.id, dto, ownerId);
    await expect(receivables.recordReceive(receivable.id, dto, ownerId)).rejects.toThrow(/ได้รับเงินครบแล้ว/);
    const rows = await entries(sale.id);
    expect(rows).toHaveLength(2);
    expect(netDebit(rows, 'S11-1101')).toBe(0);
    expect(netDebit(rows, 'S11-1201')).toBe(10000);
    expect(netDebit(rows, 'S11-3101')).toBe(0);
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).amountReceived?.toNumber()).toBe(0);
    await expect(voids.voidSale(sale.id, { id: ownerId, role: 'OWNER' }, 'Synthetic void after receipt'))
      .rejects.toThrow(); // Existing rule: settled finance cannot be voided as unpaid.
  });

  it.each([0, 2000])('voids an unsettled sale with %s down and reverses stock, cash and receivable', async down => {
    const { sale, product, receivable } = await createSale(down);
    const before = await entries(sale.id);
    const result = await voids.voidSale(sale.id, { id: ownerId, role: 'OWNER' }, 'Synthetic unpaid finance cancellation');
    expect(result.restoredProductIds).toContain(product.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('IN_STOCK');
    expect((await db.financeReceivable.findUniqueOrThrow({ where: { id: receivable.id } })).deletedAt).not.toBeNull();
    const reversals = await db.journalEntry.findMany({
      where: { entryNumber: { in: result.reversalEntryNumbers } }, include: { lines: true },
    });
    expect(reversals).toHaveLength(1);
    for (const account of ['S11-1101', 'S11-3101', 'S11-2001', 'S41-1101', 'S50-1101']) {
      expect(netDebit([...before, ...reversals], account)).toBe(0);
    }
  });
});
