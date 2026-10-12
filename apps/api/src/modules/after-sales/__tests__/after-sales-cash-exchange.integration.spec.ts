import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';

import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { AuditService } from '../../audit/audit.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { InstallmentInputVatTemplate } from '../../journal/cpa-templates/installment-input-vat.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ExchangeNewContract1ATemplate } from '../../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../../journal/cpa-templates/exchange-ecl-reversal.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopCashExchangeTemplate } from '../../journal/cpa-templates/shop-cash-exchange.template';
import { ShopStockWriteOffTemplate } from '../../journal/cpa-templates/shop-stock-writeoff.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ContractExchangeService } from '../../contract-exchange/contract-exchange.service';
import { ExchangeCancelService } from '../../contract-exchange/contract-exchange-cancel.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { DefectExchangeReversalTemplate } from '../../journal/cpa-templates/defect-exchange-reversal.template';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { RepairTicketDocNumberService } from '../../repair-tickets/services/doc-number.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { ExpenseDocumentCreateService } from '../../expense-documents/services/expense-document-create.service';
import { LineAggregatorService } from '../../expense-documents/services/line-aggregator.service';
import { DocNumberService as ExpenseDocNumberService } from '../../expense-documents/services/doc-number.service';
import { SettingsService } from '../../settings/settings.service';
import { SettingsFlagsService } from '../../settings/services/settings-flags.service';
import { StockAdjustmentsService } from '../../inventory/stock-adjustments.service';
import { StockAdjustmentNumberService } from '../../inventory/stock-adjustment-number.service';
import { SaleVoidService } from '../../sales/services/sale-void.service';
import { resolveShopWarrantyDays } from '../../warranty/shop-warranty-policy';

import { AfterSalesLookupService } from '../services/after-sales-lookup.service';
import { AfterSalesCaseService } from '../services/after-sales-case.service';
import { AfterSalesQueryService } from '../services/after-sales-query.service';
import { AfterSalesRepairService } from '../services/after-sales-repair.service';
import { AfterSalesExchangeService } from '../services/after-sales-exchange.service';
import { AfterSalesLineService } from '../services/after-sales-line.service';
import { AfterSalesDocNumberService } from '../services/after-sales-doc-number.service';
import { AfterSalesDocumentService } from '../services/after-sales-document.service';
import type { AfterSalesPdfRenderer } from '../documents/after-sales-pdf.renderer';
import { AfterSalesService } from '../after-sales.service';
import {
  CASH_DAY7_REASON,
  CASH_NOT_USED_REASON,
  CASH_OUT_OF_WINDOW_REASON,
} from '../utils/after-sales-outcomes.util';

/**
 * after-sales — เปลี่ยนรุ่นเดิมขายสด (PR 5, CASH_SAME_MODEL_EXCHANGE) บน DB จริง — สเปก §12.
 *
 * Wiring ลอก after-sales-exchange.integration.spec.ts (instance จริงด้วย `new`) + deps ของกิ่งขายสด
 * (ShopCashExchangeTemplate / ShopAccountResolver / CompanyResolverService) · ไฟล์นี้ลง JE จริง
 * (สลับต้นทุน + ตัดจำหน่าย) จึงต้อง `seedShopCoa` ก่อน.
 *
 * Runner (vitest — jest ignore `*.integration.spec.ts`):
 *   source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && cd apps/api && \
 *     npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts
 *
 * CI: glob AFTERSALES_FILES ใน .github/workflows/deploy-gcp.yml (`src/modules/after-sales/__tests__/*.integration.spec.ts`).
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง (ลูกก่อนแม่) — audit_logs ลบไม่ได้ (immutable) · user/branch ปล่อยไว้.
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const audit = new AuditService(prisma as never);
const shopAccounts = new ShopAccountResolver(prisma as never);

const contractExchange = new ContractExchangeService(
  prisma as never,
  audit,
  new ExchangeNewContract1ATemplate(journal, prisma as never),
  new ExchangeCloseOld21_1106Template(journal, prisma as never),
  new ExchangeBuybackReceivable11_2107Template(journal, prisma as never),
  new ShopExchangeReturnTemplate(journal, prisma as never, companyResolver),
  new ExchangeEclReversalTemplate(journal, prisma as never),
  companyResolver,
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver),
  shopAccounts,
  new InstallmentInputVatTemplate(journal, prisma as never, companyResolver),
);
const cancelReversal = new ExchangeCancelReversalTemplate(journal, prisma as never);
const exchangeCancel = new ExchangeCancelService(prisma as never, audit, companyResolver, cancelReversal);
const defectReversal = new DefectExchangeReversalTemplate(journal, prisma as never);

const settingsFlags = new SettingsFlagsService(prisma as never);
const settingsSvc = new SettingsService(settingsFlags, null as never, null as never);
const expenseDocNumber = new ExpenseDocNumberService(settingsSvc);
const lineAggregator = new LineAggregatorService();
const expenseCreator = new ExpenseDocumentCreateService(
  prisma as never,
  expenseDocNumber,
  lineAggregator,
  null as never,
  null as never,
  null as never,
  null as never,
);
const expenseDocs = new ExpenseDocumentsService(prisma as never, null as never, null as never, expenseCreator);
const repairTicketDocNumber = new RepairTicketDocNumberService(prisma as never);
const repairTickets = new RepairTicketsService(
  prisma as never,
  audit,
  expenseDocs,
  null as never,
  null as never,
  repairTicketDocNumber,
);
const defect = new DefectExchangeService(prisma as never, journal, defectReversal, repairTickets);

const productPhotosFake = {
  getPhotos: async () => ({
    photos: { front: null, back: null, left: null, right: null, top: null, bottom: null },
  }),
} as never;
const lookupSvc = new AfterSalesLookupService(prisma as never, repairTickets, defect, productPhotosFake);
const afterSalesDocNumber = new AfterSalesDocNumberService(prisma as never);

const notificationsFake = {
  sendFromTemplate: vi.fn().mockResolvedValue({ id: 'n1', status: 'SENT' }),
} as never;
const integrationConfigFake = { getValue: async () => 'liff-test' } as never;
const line = new AfterSalesLineService(prisma as never, notificationsFake, integrationConfigFake);

const files = new Map<string, Buffer>();
const storage = {
  upload: async (k: string, b: Buffer) => {
    files.set(k, b);
    return k;
  },
  delete: async (k: string) => {
    files.delete(k);
  },
  getStream: async (k: string) => Readable.from(files.get(k)!),
  getSignedDownloadUrl: async (k: string) => `https://signed/${k}`,
} as never;

const caseSvc = new AfterSalesCaseService(
  prisma as never,
  storage,
  audit,
  repairTickets,
  afterSalesDocNumber,
  lookupSvc,
  contractExchange,
  defect,
  line,
);
const querySvc = new AfterSalesQueryService(prisma as never);
const repairSvc = new AfterSalesRepairService(prisma as never, storage, repairTickets, querySvc, audit, line);
const exchangeSvc = new AfterSalesExchangeService(
  prisma as never,
  querySvc,
  defect,
  repairTickets,
  audit,
  contractExchange,
  exchangeCancel,
  lookupSvc,
  line,
  new ShopCashExchangeTemplate(journal, prisma as never, companyResolver),
  shopAccounts,
  companyResolver,
);
const svc = new AfterSalesService(lookupSvc, caseSvc, querySvc, repairSvc, exchangeSvc);
const saleVoid = new SaleVoidService(prisma as never, cancelReversal);
const stockAdjust = new StockAdjustmentsService(
  prisma as never,
  new ShopStockWriteOffTemplate(journal, prisma as never, companyResolver),
  shopAccounts,
  companyResolver,
  storage,
  new StockAdjustmentNumberService(prisma as never),
  audit,
);
// CI job "Integration" ไม่มี Chromium — PDF จริงปักที่ doc-render.smoke.spec (job "PDF documents") · ที่นี่ทดสอบ
// เส้นทาง compose/HTML/สิทธิ์/PRINTED บน DB จริง จึง stub htmlToPdf ให้คืน HTML ที่ compose ได้เป็น Buffer
const pdfRenderer = {
  htmlToPdf: async (html: string) => Buffer.from(html, 'utf8'),
} as unknown as AfterSalesPdfRenderer;
const docs = new AfterSalesDocumentService(prisma as never, storage, querySvc, pdfRenderer);

// ---------------------------------------------------------------------------
// Fixtures / run markers
// ---------------------------------------------------------------------------
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const PREFIX = 'AFCASHTEST-';
const USED_COST_OLD = '10700.00';
const USED_COST_NEW = '10500.00';

let adminId: string;
let salesUserId: string;
let bmUserId: string;
let branchId: string;
let phoneSeq = 0;

const OWNER = () => ({ id: adminId, role: 'OWNER', branchId: null as string | null });
const SALES_USER = () => ({ id: salesUserId, role: 'SALES', branchId });
const BM_USER = () => ({ id: bmUserId, role: 'BRANCH_MANAGER', branchId });

const createdCaseIds: string[] = [];
const createdSaleIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdAdjustmentIds: string[] = [];

function fakeJpeg(name: string): Express.Multer.File {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return {
    fieldname: 'photos',
    originalname: name,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: buf.length,
    buffer: buf,
    stream: undefined as never,
    destination: '',
    filename: name,
    path: '',
  };
}

async function seedCashSaleFixture(opts: {
  tag: string;
  daysAgo: number;
  saleType?: 'CASH' | 'EXTERNAL_FINANCE';
  category?: 'PHONE_USED' | 'PHONE_NEW';
}) {
  const soldAt = new Date(Date.now() - opts.daysAgo * 86_400_000);
  const saleType = opts.saleType ?? 'CASH';
  phoneSeq += 1;
  const customer = await prisma.customer.create({
    data: {
      name: `${PREFIX}Customer-${opts.tag}-${RUN}`,
      phone: `097${RUN_NUM.slice(0, 5)}${String(phoneSeq).padStart(2, '0')}`,
    },
  });
  createdCustomerIds.push(customer.id);
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Old-${opts.tag}`,
      brand: `${PREFIX}Brand`,
      model: `${PREFIX}Model-${opts.tag}`,
      storage: '128GB',
      imeiSerial: `${PREFIX}${RUN}-${opts.tag}-OLD`,
      category: opts.category ?? 'PHONE_USED',
      costPrice: new Prisma.Decimal(USED_COST_OLD),
      branchId,
      status: saleType === 'EXTERNAL_FINANCE' ? 'SOLD_INSTALLMENT' : 'SOLD_CASH',
    },
  });
  createdProductIds.push(product.id);
  const sale = await prisma.sale.create({
    data: {
      saleNumber: `${PREFIX}${RUN}-${opts.tag}-SL`,
      saleType,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: adminId,
      sellingPrice: new Prisma.Decimal('13900.00'),
      netAmount: new Prisma.Decimal('13900.00'),
      createdAt: soldAt,
      shopWarrantyStartDate: soldAt,
      shopWarrantyEndDate: new Date(soldAt.getTime() + 60 * 86_400_000),
      ...(saleType === 'EXTERNAL_FINANCE' ? { financeCompany: 'GFIN' } : {}),
      costSnapshot: { create: { mainProductCost: new Prisma.Decimal(USED_COST_OLD) } },
    },
  });
  createdSaleIds.push(sale.id);
  return {
    customerId: customer.id,
    productId: product.id,
    saleId: sale.id,
    imei: product.imeiSerial as string,
    brand: product.brand,
    model: product.model,
    saleNumber: sale.saleNumber,
  };
}

async function seedReplacement(
  tag: string,
  fx: { brand: string; model: string },
  over: { status?: 'IN_STOCK' | 'SOLD_CASH'; branch?: string } = {},
) {
  const p = await prisma.product.create({
    data: {
      name: `${PREFIX}New-${tag}`,
      brand: fx.brand,
      model: fx.model,
      storage: '128GB',
      imeiSerial: `${PREFIX}${RUN}-${tag}-NEW`,
      category: 'PHONE_USED',
      costPrice: new Prisma.Decimal(USED_COST_NEW),
      branchId: over.branch ?? branchId,
      status: over.status ?? 'IN_STOCK',
    },
  });
  createdProductIds.push(p.id);
  return p;
}

/** Σ(debit − credit) ของบัญชี code ในรายการ POSTED ที่ metadata.saleId = saleId */
async function gl(code: string, saleId: string): Promise<string> {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountCode: code,
      deletedAt: null,
      journalEntry: {
        status: 'POSTED',
        deletedAt: null,
        metadata: { path: ['saleId'], equals: saleId },
      },
    },
    select: { debit: true, credit: true },
  });
  return lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), new Prisma.Decimal(0)).toFixed(2);
}

async function openCashCase(fx: { imei: string }, replacementId: string, user: ReturnType<typeof OWNER>) {
  const r = await svc.createCase(
    {
      imei: fx.imei,
      symptom: 'จอแตกมุมขวา กดไม่ติด',
      accessories: { box: true, charger: true },
      unlockConfirmed: true,
      outcome: 'CASH_SAME_MODEL_EXCHANGE',
      branchId,
      replacementProductId: replacementId,
    } as never,
    [fakeJpeg('intake.jpg')],
    user,
  );
  createdCaseIds.push(r.id);
  return r;
}

describe('after-sales — เปลี่ยนรุ่นเดิมขายสด (PR 5) บน DB จริง', () => {
  beforeAll(async () => {
    await seedShopCoa(prisma);
    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const branchName = '__after_sales_cash_exchange_test_branch__';
    const existingBranch = await prisma.branch.findFirst({ where: { name: branchName, deletedAt: null } });
    branchId = existingBranch
      ? existingBranch.id
      : (await prisma.branch.create({ data: { name: branchName, companyId: shop.id } })).id;

    salesUserId = (
      await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}sales-${RUN}@test.local`,
          password: 'x',
          name: 'after-sales-cash-test-sales',
          role: 'SALES',
          branchId,
        },
      })
    ).id;
    bmUserId = (
      await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}bm-${RUN}@test.local`,
          password: 'x',
          name: 'after-sales-cash-test-bm',
          role: 'BRANCH_MANAGER',
          branchId,
        },
      })
    ).id;
  }, 120_000);

  it('1) lookup: มือสอง 3 วัน → เปิด · เครื่องใหม่ → ปิด (มือสองเท่านั้น) · 10 วัน → เกินกรอบ · 7 วันพอดี → ครบกำหนด', async () => {
    const used3 = await seedCashSaleFixture({ tag: 'L1', daysAgo: 3 });
    const new3 = await seedCashSaleFixture({ tag: 'L2', daysAgo: 3, category: 'PHONE_NEW' });
    const used10 = await seedCashSaleFixture({ tag: 'L3', daysAgo: 10 });
    const used7 = await seedCashSaleFixture({ tag: 'L4', daysAgo: 7 });
    const pick = async (imei: string) =>
      (await svc.lookup({ imei }, OWNER())).outcomes.find((o) => o.outcome === 'CASH_SAME_MODEL_EXCHANGE')!;
    expect(await pick(used3.imei)).toMatchObject({ enabled: true, implemented: true });
    expect(await pick(new3.imei)).toMatchObject({ enabled: false, reason: CASH_NOT_USED_REASON });
    expect(await pick(used10.imei)).toMatchObject({ enabled: false, reason: CASH_OUT_OF_WINDOW_REASON });
    expect(await pick(used7.imei)).toMatchObject({ enabled: false, reason: CASH_DAY7_REASON });
  });

  it('2) เปิดเคส → BM ยืนยัน → GL/ใบขาย/เครื่อง/เคส ถูกต้อง และ getCase ซ้ำไม่ถอย stage', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C2', daysAgo: 3 });
    const next = await seedReplacement('C2', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    expect(created).toMatchObject({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL' });

    const r = await svc.confirmSameModel(created.id, {}, BM_USER());
    expect(r).toMatchObject({ stage: 'READY_FOR_PICKUP', replacementSaleId: fx.saleId, saleNumber: fx.saleNumber });
    if (!('journalEntryNo' in r)) throw new Error('expected cash confirm result');
    expect(r.journalEntryNo).toMatch(/^JE-/);

    expect(await gl('S11-2002', fx.saleId)).toBe('200.00');
    expect(await gl('S50-1102', fx.saleId)).toBe('-200.00');
    expect(await gl('S41-1102', fx.saleId)).toBe('0.00');
    expect(await gl('S11-1201', fx.saleId)).toBe('0.00');

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId }, include: { costSnapshot: true } });
    expect(sale.productId).toBe(next.id);
    expect(sale.exchangeCaseId).toBe(created.id);
    expect(sale.costSnapshot!.mainProductCost.toFixed(2)).toBe(USED_COST_NEW);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.productId } })).status).toBe('DEFECT_RETURN');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('SOLD_CASH');

    const row = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({
      stage: 'READY_FOR_PICKUP',
      replacementSaleId: fx.saleId,
      replacementProductId: next.id,
      replacementContractId: null,
    });
    // Review Focus 3 — reconcile ตอนอ่านต้องไม่ดันกลับ
    const again = await querySvc.getCase(created.id, SALES_USER());
    expect(again.stage).toBe('READY_FOR_PICKUP');
    expect((await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } })).stage).toBe('READY_FOR_PICKUP');
  });

  it('3) SALES ยืนยัน → 403 · สองคำขอพร้อมกัน → 1 สำเร็จ 1 ได้ 409 · JE 1 ใบ', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C3', daysAgo: 2 });
    const next = await seedReplacement('C3', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await expect(svc.confirmSameModel(created.id, {}, SALES_USER())).rejects.toBeInstanceOf(ForbiddenException);
    const results = await Promise.allSettled([
      svc.confirmSameModel(created.id, {}, BM_USER()),
      svc.confirmSameModel(created.id, {}, OWNER()),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    const jes = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['afterSalesCaseId'], equals: created.id }, deletedAt: null },
    });
    expect(jes).toHaveLength(1);
  });

  it('4) เครื่องทดแทนถูกขายก่อนยืนยัน → 409 · ใบขายไม่สลับ · ไม่มี JE · การจองเคสถูกปล่อย', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C4', daysAgo: 1 });
    const next = await seedReplacement('C4', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await prisma.product.update({ where: { id: next.id }, data: { status: 'SOLD_CASH' } });
    await expect(svc.confirmSameModel(created.id, {}, BM_USER())).rejects.toThrow(/เครื่องทดแทน/);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } })).productId).toBe(fx.productId);
    expect(
      await prisma.journalEntry.count({ where: { metadata: { path: ['afterSalesCaseId'], equals: created.id } } }),
    ).toBe(0);
    expect((await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id } })).approvedAt).toBeNull();
  });

  it('5) ส่งมอบ → ประกัน/กรอบ 7 วันนับใหม่ · เคส CLOSED · DELIVERED มีอุปกรณ์ · เปิดเคสใหม่บนเครื่องทดแทนได้ทางออกเปิดอีกครั้ง', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C5', daysAgo: 6 });
    const next = await seedReplacement('C5', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    const before = Date.now();
    await svc.deliver(created.id, SALES_USER(), { accessories: { box: true, charger: true }, note: 'ลูกค้ารับเอง' });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } });
    expect(sale.shopWarrantyStartDate!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // จำนวนวันประกันร้านมือสอง = นโยบายร้าน (config `warranty.shopWarrantyDays` หรือ default 60)
    const cfg = await prisma.systemConfig.findFirst({ where: { key: 'warranty.shopWarrantyDays', deletedAt: null } });
    const expectedDays = resolveShopWarrantyDays({ category: 'PHONE_USED', shopWarrantyDays: null }, cfg?.value ?? null);
    expect(expectedDays).not.toBeNull();
    expect(
      Math.round((sale.shopWarrantyEndDate!.getTime() - sale.shopWarrantyStartDate!.getTime()) / 86_400_000),
    ).toBe(expectedDays);
    const row = await prisma.afterSalesCase.findUniqueOrThrow({ where: { id: created.id }, include: { events: true } });
    expect(row.stage).toBe('CLOSED');
    expect(row.closedAt).not.toBeNull();
    expect(row.events.find((e) => e.kind === 'DELIVERED')!.note).toContain('อุปกรณ์: กล่อง, สายชาร์จ');
    // เปลี่ยนซ้ำ: เครื่องทดแทนมีปัญหาอีก → lookup ด้วย IMEI ทดแทน → กรอบนับจากวันส่งมอบ (วันนี้) ⇒ เปิด
    const again = await svc.lookup({ imei: next.imeiSerial! }, OWNER());
    expect(again.sale?.id).toBe(fx.saleId);
    expect(again.outcomes.find((o) => o.outcome === 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: true });
  });

  it('6) เอกสาร: AWAITING → 400 · READY → return.pdf / handover.pdf / exchange-docs.pdf ได้ Buffer + PRINTED 3 แบบ', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C6', daysAgo: 2 });
    const next = await seedReplacement('C6', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await expect(docs.render(created.id, 'RETURN', OWNER())).rejects.toBeInstanceOf(BadRequestException);
    await svc.confirmSameModel(created.id, {}, BM_USER());
    for (const kind of ['RETURN', 'HANDOVER'] as const) {
      const { pdf } = await docs.render(created.id, kind, OWNER());
      expect(pdf.length).toBeGreaterThan(1000);
    }
    const both = await docs.renderCashExchangeDocs(created.id, OWNER());
    expect(both.pdf.length).toBeGreaterThan(1000);
    const printed = await prisma.afterSalesEvent.findMany({ where: { caseId: created.id, kind: 'PRINTED' } });
    expect(printed.map((e) => e.note)).toEqual(
      expect.arrayContaining(['ใบรับคืนเครื่อง', 'ใบส่งมอบเครื่องทดแทน', 'พิมพ์ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน']),
    );
  }, 120_000);

  it('7) ยกเลิกใบขายที่เปลี่ยนเครื่องแล้ว → 400 G9', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C7', daysAgo: 2 });
    const next = await seedReplacement('C7', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    await expect(
      saleVoid.voidSale(fx.saleId, { id: adminId, role: 'OWNER' } as never, 'ลูกค้าเปลี่ยนใจไม่ซื้อแล้ว'),
    ).rejects.toThrow(/เปลี่ยนเครื่องแล้ว/);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: fx.saleId } })).deletedAt).toBeNull();
  });

  it('8) ขอตัดจำหน่ายเครื่อง DEFECT_RETURN → เจ้าของอนุมัติ → Dr S53-1102 / Cr S11-2002 10,700', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C8', daysAgo: 2 });
    const next = await seedReplacement('C8', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    const req = await stockAdjust.createRequest(
      { productId: fx.productId, reason: 'WRITE_OFF', notes: 'เคลมไม่ได้' } as never,
      [],
      OWNER() as never,
    );
    createdAdjustmentIds.push(req.id);
    await stockAdjust.approve(req.id, OWNER() as never);
    const adj = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: req.id } });
    expect(adj.status).toBe('APPROVED');
    expect(adj.journalEntryId).toBeTruthy();
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: adj.journalEntryId! },
      include: { lines: true },
    });
    const lines = je.lines;
    expect(lines.find((l) => l.accountCode === 'S53-1102')!.debit.toFixed(2)).toBe(USED_COST_OLD);
    expect(lines.find((l) => l.accountCode === 'S11-2002')!.credit.toFixed(2)).toBe(USED_COST_OLD);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.productId } })).status).toBe('WRITTEN_OFF');
  });

  it('9) ไฟแนนซ์นอก → เครื่อง SOLD_INSTALLMENT ก่อน/หลัง · JE ลงตามปกติ', async () => {
    const fx = await seedCashSaleFixture({ tag: 'C9', daysAgo: 2, saleType: 'EXTERNAL_FINANCE' });
    const next = await seedReplacement('C9', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    await svc.confirmSameModel(created.id, {}, BM_USER());
    expect((await prisma.product.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('SOLD_INSTALLMENT');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.productId } })).status).toBe('DEFECT_RETURN');
    expect(await gl('S11-2002', fx.saleId)).toBe('200.00');
  });

  it('10) งวดบัญชี SHOP เดือนปัจจุบันถูกปิด → ยังยืนยันได้ในช่วงผ่อนผัน (กติกา validatePeriodOpen เดียวกับทุกรายการ) · JE ลง', async () => {
    // บรีฟเดิมคาดว่า "งวดปิด → 400" — แต่ validatePeriodOpen ผ่อนผันถึง (วันสิ้นเดือนของงวด + period_grace_days)
    // รายการที่ลงวันนี้ในเดือนปัจจุบันจึงไม่ถูกบล็อกโดยนิยาม (เหมือนทุก flow ในระบบ) — ปักพฤติกรรมจริงไว้แทน
    const fx = await seedCashSaleFixture({ tag: 'C10', daysAgo: 2 });
    const next = await seedReplacement('C10', fx);
    const created = await openCashCase(fx, next.id, SALES_USER());
    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });
    const now = new Date();
    const key = { companyId: shop.id, year: now.getFullYear(), month: now.getMonth() + 1 };
    const existing = await prisma.accountingPeriod.findUnique({ where: { companyId_year_month: key } });
    const period = existing
      ? await prisma.accountingPeriod.update({ where: { id: existing.id }, data: { status: 'CLOSED', closedAt: new Date(now.getTime() - 48 * 3600_000) } })
      : await prisma.accountingPeriod.create({ data: { ...key, status: 'CLOSED', closedAt: new Date(now.getTime() - 48 * 3600_000) } });
    try {
      const r = await svc.confirmSameModel(created.id, {}, BM_USER());
      expect(r.stage).toBe('READY_FOR_PICKUP');
      expect(await gl('S11-2002', fx.saleId)).toBe('200.00');
    } finally {
      if (existing) {
        await prisma.accountingPeriod.update({
          where: { id: period.id },
          data: { status: existing.status, closedAt: existing.closedAt },
        });
      } else {
        await prisma.accountingPeriod.delete({ where: { id: period.id } });
      }
    }
  });

  afterAll(async () => {
    try {
      const jeWhere: Prisma.JournalEntryWhereInput[] = [
        ...createdCaseIds.map((id) => ({ metadata: { path: ['afterSalesCaseId'], equals: id } as never })),
        ...createdAdjustmentIds.map((id) => ({ metadata: { path: ['adjustmentId'], equals: id } as never })),
      ];
      if (createdAdjustmentIds.length) {
        await prisma.stockAdjustment.deleteMany({ where: { id: { in: createdAdjustmentIds } } });
      }
      if (jeWhere.length) {
        const jes = await prisma.journalEntry.findMany({ where: { OR: jeWhere }, select: { id: true } });
        const jeIds = jes.map((j) => j.id);
        if (jeIds.length) {
          await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
      }
      if (createdSaleIds.length) {
        await prisma.sale.updateMany({ where: { id: { in: createdSaleIds } }, data: { exchangeCaseId: null } });
      }
      if (createdCaseIds.length) {
        await prisma.afterSalesEvent.deleteMany({ where: { caseId: { in: createdCaseIds } } });
        await prisma.afterSalesCase.deleteMany({ where: { id: { in: createdCaseIds } } });
      }
      if (createdSaleIds.length) {
        await prisma.saleCostSnapshot.deleteMany({ where: { saleId: { in: createdSaleIds } } });
        await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
      }
      if (createdProductIds.length) {
        await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      }
      if (createdCustomerIds.length) {
        await prisma.creditCheck.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
        await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      }
      // sales/bm user + branch + admin: ปล่อยไว้ (actor ของ audit_logs ที่ลบไม่ได้) — precedent ไฟล์พี่
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);
});
