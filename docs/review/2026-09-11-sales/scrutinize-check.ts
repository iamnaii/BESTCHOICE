// Run from repository root with the command recorded in scrutinize.md.
// Uses real controllers/services and in-memory dependencies. No database/network writes.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../apps/api/src/prisma/prisma.service';
import { SalesController } from '../../../apps/api/src/modules/sales/sales.controller';
import { SalesService } from '../../../apps/api/src/modules/sales/sales.service';
import { SaleVoidService } from '../../../apps/api/src/modules/sales/services/sale-void.service';
import { JwtAuthGuard } from '../../../apps/api/src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../apps/api/src/modules/auth/guards/roles.guard';
import { BranchGuard } from '../../../apps/api/src/modules/auth/guards/branch.guard';
import { EntityScopeInterceptor } from '../../../apps/api/src/interceptors/entity-scope.interceptor';
import { CreateSaleDto } from '../../../apps/api/src/modules/sales/dto/sale.dto';
import { CreateContractDto } from '../../../apps/api/src/modules/contracts/dto/contract.dto';
import { BookingsService } from '../../../apps/api/src/modules/bookings/bookings.service';
import { SaleCreationService } from '../../../apps/api/src/modules/sales/services/sale-creation.service';
import { SaleWriterService } from '../../../apps/api/src/modules/sales/services/sale-writer.service';
import { resolveVatPctForBranch } from '../../../apps/api/src/utils/config.util';
import { calculateInstallmentWithInterest } from '../../../apps/api/src/utils/installment.util';

const result: unknown[] = [];
const salesUser = { id: 'sales-a', role: 'SALES', branchId: 'branch-a', accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' };
const dec = (n: number) => new Prisma.Decimal(n);

async function checkSalesHttp() {
  let lastQuery: any;
  const row = { id: 'sale-b', branchId: 'branch-b', customer: { id: 'customer-b', nationalId: '1234567890123' }, product: { id: 'p-b', costPrice: dec(6000) } };
  const db: any = { sale: {
    findMany: async (query: any) => { lastQuery = query; return [row]; },
    findUnique: async (query: any) => { lastQuery = query; return row; },
    count: async () => 1, aggregate: async () => ({ _sum: { netAmount: dec(10000), discount: dec(0) } }), groupBy: async () => [],
  } };
  const service = new SalesService(db, {} as any, {} as any, {} as any, {} as any, {} as any);
  const module = await Test.createTestingModule({ controllers: [SalesController], providers: [
    { provide: SalesService, useValue: service }, { provide: SaleVoidService, useValue: {} }, { provide: PrismaService, useValue: db }, RolesGuard, BranchGuard,
  ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => { context.switchToHttp().getRequest().user = salesUser; return true; } }).compile();
  const app = module.createNestApplication();
  app.useGlobalInterceptors(new EntityScopeInterceptor());
  await app.init();
  try {
    const list = await request(app.getHttpServer()).get('/sales?company=shop');
    assert.equal(list.status, 200); assert.equal(lastQuery.where.branchId, undefined);
    assert.equal(list.body.data[0].product.costPrice, undefined);
    const detail = await request(app.getHttpServer()).get('/sales/sale-b?company=shop');
    assert.equal(detail.status, 200); assert.equal(detail.body.product.costPrice, '6000');
    assert.equal(detail.body.customer.nationalId, '1234567890123');
    result.push({ case: 'Sales HTTP with simulated SALES principal, real Roles/Branch/Entity guards and service', listStatus: list.status, detailStatus: detail.status, detailWhere: lastQuery.where, listCostHidden: true, detailCostVisible: true, detailFullNationalIdVisible: true });
  } finally { await app.close(); }
}

async function checkDueDay() {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const values = { customerId: 'c', productId: 'p', branchId: 'b', saleType: 'INSTALLMENT', sellingPrice: 10000, downPayment: 3000, totalMonths: 6, paymentDueDay: 31 };
  const contract = await pipe.transform(values, { type: 'body', metatype: CreateContractDto });
  assert.equal(contract.paymentDueDay, 31);
  let saleError: any;
  try { await pipe.transform(values, { type: 'body', metatype: CreateSaleDto }); } catch (error: any) { saleError = error.getResponse(); }
  assert.ok(saleError.message.some((m: string) => m.includes('28')));
  result.push({ case: 'Same end-of-month payment day through two real DTOs/global pipe settings', contractsAccepted: 31, salesRejected: saleError });
}

function bookingHarness(patch: Record<string, unknown> = {}, productPatch: Record<string, unknown> = {}) {
  const booking: any = { id: 'b1', bookingNumber: 'BK-1', status: 'PAID', branchId: 'branch-a', customerId: 'c1', customer: { name: 'Synthetic customer', phone: '0000000000', addressCurrent: null }, totalAmount: dec(10000), depositAmount: dec(1000), depositMethod: 'CASH', expireDate: new Date(Date.now() + 86400000), convertedToSaleId: null, items: [{ productId: 'p1' }], ...patch };
  const product: any = { id: 'p1', name: 'Synthetic product', imeiSerial: 'SYNTHETIC-1', po: null, deletedAt: null, status: 'IN_STOCK', branchId: 'branch-a', category: 'PHONE_NEW', costPrice: dec(5000), wasPreviouslyDamaged: false, ...productPatch };
  const journalCalls: unknown[] = [], writes: any[] = [];
  const tx: any = {
    booking: { updateMany: async (q: any) => { writes.push(q); return { count: 1 }; }, update: async (q: any) => ({ ...booking, ...q.data }), findFirst: async () => booking },
    product: { findUnique: async () => product, update: async (q: any) => { writes.push(q); return product; } },
    sale: { findFirst: async () => null, create: async (q: any) => { writes.push(q); return { id: 's1', ...q.data }; } },
    productReservation: { updateMany: async () => ({ count: 0 }) }, commissionRule: { findFirst: async () => null }, salesCommission: { create: async () => ({}) }, auditLog: { create: async () => ({}) },
  };
  const db: any = { booking: { findFirst: async () => booking }, $transaction: async (fn: any) => fn(tx) };
  const journal: any = { execute: async (q: any) => { journalCalls.push(q); } };
  const resolver: any = { resolveInflowCashAccount: async () => 'S11-1101', resolveProductAccounts: () => ({ inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' }) };
  const service = new BookingsService(db, journal, journal, journal, journal, journal, resolver);
  return { service, booking, product, journalCalls, writes, db, tx, resolver, journal };
}

async function checkBookingTransitions() {
  for (const scenario of [
    { name: 'expired PAID booking still converts before cron', patch: { expireDate: new Date('2000-01-01T00:00:00Z') }, productPatch: {} },
    { name: 'branch A booking converts product from branch B', patch: {}, productPatch: { branchId: 'branch-b' } },
    { name: 'SALES converts previously damaged product without acknowledgement', patch: {}, productPatch: { wasPreviouslyDamaged: true } },
  ]) {
    const h = bookingHarness(scenario.patch, scenario.productPatch);
    const output = await h.service.convertToSale('b1', { collectBalance: true }, salesUser.id, salesUser);
    assert.equal(output.sale.id, 's1');
    result.push({ case: scenario.name, converted: true, productBranch: h.product.branchId, saleBranch: output.sale.branchId, journalsCalled: h.journalCalls.length });
    if (h.product.wasPreviouslyDamaged) {
      const directDb: any = { customer: { findFirst: async () => h.booking.customer }, product: { findUnique: async () => h.product, findMany: async () => [h.product] } };
      const direct = new SaleCreationService(directDb, {} as any, {} as any, {} as any);
      await assert.rejects(() => direct.create({ saleType: 'CASH', customerId: 'c1', productId: 'p1', branchId: 'branch-a', sellingPrice: 10000 }, salesUser.id, salesUser.role), /previouslyDamagedAcknowledged/);
      result.push({ case: 'same damaged-product input through normal sale orchestrator', rejected: true });
    }
  }
}

async function main() {
  await checkSalesHttp(); await checkDueDay(); await checkBookingTransitions();
  const ext = bookingHarness();
  let receivable: any;
  Object.assign(ext.tx, { systemConfig: { findUnique: async () => null }, repossession: { updateMany: async () => ({ count: 0 }) }, externalFinanceCompany: { upsert: async () => ({ id: 'finance-a' }) }, financeReceivable: { create: async (q: any) => { receivable = q.data; return q.data; } } });
  const writer = new SaleWriterService(ext.db, {} as any, ext.journal, ext.resolver, ext.journal);
  const external = await writer.createExternalFinanceSale({ saleType: 'EXTERNAL_FINANCE', customerId: 'c1', productId: 'p1', branchId: 'branch-a', sellingPrice: 10000, downPayment: 0, financeAmount: 10000, financeCompany: 'Synthetic finance', paymentMethod: 'BANK_TRANSFER' }, salesUser.id, 10000, 0);
  assert.equal(external.amountReceived, 10000); assert.equal(receivable.expectedAmount, 10000);
  result.push({ case: 'External finance with zero down payment', downPayment: external.downPaymentAmount, amountReceived: external.amountReceived, stillExpectedFromFinance: receivable.expectedAmount, receiptEventSupplied: false });
  const browser = JSON.parse(readFileSync('docs/review/2026-09-11-sales/evidence/scrutinize-browser.json', 'utf8'));
  const previewText = browser.captures.find((c: any) => c.name === 'scrutinize-create-calculation').text;
  const vat = await resolveVatPctForBranch({ branch: { findUnique: async () => ({ company: { vatRegistered: false, vatRate: dec(0) } }) } } as any, 'branch-a', 0.07);
  const calculation = calculateInstallmentWithInterest(10000, 2000, 480, 6, 0.1, vat);
  assert.ok(previewText.includes('1,654.93'));
  assert.equal(calculation.monthlyPayment, 1546.66);
  result.push({ case: 'Actual browser contract preview vs real backend calculation with non-VAT branch', input: { price: 10000, down: 2000, months: 6, monthlyInterestRate: 0.01, commissionRate: 0.1, configVat: 0.07 }, browserMonthlyPayment: 1654.93, backendMonthlyPayment: calculation.monthlyPayment, backendEffectiveVat: vat, scope: 'Browser config response and backend branch record are fixtures; not a persisted contract' });
  writeFileSync('docs/review/2026-09-11-sales/evidence/scrutinize-check.json', JSON.stringify({ scope: 'In-memory Prisma/templates; simulated authenticated user; no real DB transactions or posting', result }, null, 2));
  console.log(JSON.stringify({ checks: result.length, result }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
