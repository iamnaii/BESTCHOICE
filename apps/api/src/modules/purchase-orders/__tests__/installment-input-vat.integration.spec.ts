/**
 * ก้อน 5 — ภาษีซื้อของเครื่องที่ขายผ่อน (FINANCE Dr 11-4101 / Cr 42-1108) พิสูจน์บน DB จริง
 * (ฝ่ายบัญชี 05/10/2569 ข้อ 2.1–2.5 · เจ้าของเคาะ Q1–Q6 · บัญชี 42-1108)
 *
 * ทุกการเปลี่ยนสถานะมาจาก service จริง (`PurchaseOrdersService.create/goodsReceiving` · `ContractWorkflowService.activate` ·
 * `ContractCancellationService.requestCancellation/approveCancellation` · `GoodsReceivingTaxInvoiceService.record`) —
 * ไม่เขียน JE / ใบรับของ / สินค้าด้วย prisma ตรง ๆ (ยกเว้น fixture สัญญา DRAFT ที่ผ่านด่านลายเซ็น/PDPA แล้ว — แบบ product-lifecycle)
 *
 *   1. รับของ TAX_INVOICE ผู้จัดจำหน่ายจด VAT (A 9,800 + B 4,900 · VAT 1,029) → receivedVat A 686 / B 343 → เปิดสัญญาบน A →
 *      JE Dr 11-4101 686 / Cr 42-1108 686 companyId FINANCE · metadata ครบ · สัญญา CLAIMED
 *   2. ยกเลิกสัญญา (C-1) → ตัวกวาดกระจก JE นี้ · สัญญา REVERSED · เปิดสัญญาใหม่บนเครื่องเดิม → เคลมใหม่ (key ต่อสัญญา)
 *   3. รับด้วยใบส่งของ → เปิดสัญญา = PENDING_INVOICE ไม่มี JE → บันทึกใบกำกับ → JE ลงวันเปิดสัญญา · CLAIMED · บันทึกซ้ำโดย OWNER = JE ใบเดิม
 *   4. ผู้จัดจำหน่ายไม่จด VAT → NOT_ELIGIBLE เหตุผล · ไม่มี JE · ไม่มี Todo
 *   5. สัญญา PENDING_INVOICE ถูกยกเลิกก่อนได้ใบกำกับ → REVERSED · บันทึกใบกำกับทีหลังไม่เคลมสัญญานั้น (Review Focus 2)
 *   6. getVatMonthly: vatInputInstallment = ยอดเคลมของเดือน · บรรทัดใน installmentInputVatLines (Task 10)
 *   7. บันทึกใบกำกับพร้อมกันสองคอนเนกชัน → JE ใบเดียว · อีกฝั่ง HttpException (Review Focus 1)
 *
 * Runner: vitest · ต้องมี DB จริง:
 *   cd apps/api && npx vitest run --no-file-parallelism src/modules/purchase-orders/__tests__/installment-input-vat.integration.spec.ts
 * CI: glob `PO_FILES` ครอบแล้ว · Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { GoodsReceivingTaxInvoiceService } from '../services/goods-receiving-tax-invoice.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';
import { ShopSupplierPaymentTemplate } from '../../journal/cpa-templates/shop-supplier-payment.template';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { InstallmentInputVatTemplate, INSTALLMENT_INPUT_VAT_FLOW } from '../../journal/cpa-templates/installment-input-vat.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { ContractCancellationTemplate } from '../../journal/cpa-templates/contract-cancellation.template';
import { ContractWorkflowService } from '../../contracts/contract-workflow.service';
import { ContractCancellationService } from '../../contracts/services/contract-cancellation.service';
import { ProductsService } from '../../products/products.service';
import { FinanceTaxService } from '../../finance-tax/finance-tax.service';
import { INPUT_VAT_PERIOD_TODO_TAG } from '../../journal/input-vat/installment-input-vat.claim';
import { seedVerifiedContractApproval } from '../../contracts/__tests__/credit-approval.fixture';
import { ContractQueryService } from '../../contracts/services/contract-query.service';
import { bangkokCalendarParts } from '../../../utils/date.util';

const prisma = new PrismaClient();
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const inputVatTemplate = new InstallmentInputVatTemplate(journal, prisma as never, companyResolver);
const poService = new PurchaseOrdersService(
  prisma as never,
  new ShopGoodsReceivingTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  companyResolver,
  new ShopSupplierPaymentTemplate(journal, prisma as never, companyResolver),
);
const storageStub = { upload: async (k: string) => k, delete: async () => undefined } as never;
const auditStub = { log: async () => undefined } as never;
const taxInvoiceService = new GoodsReceivingTaxInvoiceService(prisma as never, inputVatTemplate, storageStub, auditStub);
const workflow = new ContractWorkflowService(
  prisma as never,
  null as never, // notifications — เรียกหลัง tx และมี guard
  journal,
  new ContractActivation1ATemplate(journal, prisma as never),
  new ProductsService(prisma as never),
  null as never, // exchange — ไม่มีสัญญาเปลี่ยนเครื่องในไฟล์นี้
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver),
  new ShopDownPaymentTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  inputVatTemplate,
);
const cancellations = new ContractCancellationService(
  prisma as never,
  () => new ContractCancellationTemplate(prisma as never, new ExchangeCancelReversalTemplate(journal, prisma as never), new EclStageReverseTemplate(journal, prisma as never)),
  () => companyResolver,
);
const financeTax = new FinanceTaxService(prisma as never);
const contractQuery = new ContractQueryService(prisma as never);
// คอนเนกชันที่สอง — เทสแข่งกัน (ข้อ 7)
const prisma2 = new PrismaClient({ transactionOptions: { timeout: 20_000 } });
const taxInvoiceService2 = new GoodsReceivingTaxInvoiceService(
  prisma2 as never,
  new InstallmentInputVatTemplate(new JournalAutoService(prisma2 as never), prisma2 as never, new CompanyResolverService(prisma2 as never)),
  storageStub,
  auditStub,
);

const PREFIX = 'IVATTEST-';
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const dec = (v: string | number | Decimal) => new Decimal(v);

const createdPoIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdContractIds: string[] = [];
const createdPdpaIds: string[] = [];
const createdBranchIds: string[] = [];
let adminId: string;
let financeCompanyId: string;
let imeiSeq = 0;
const nextImei = () => `${PREFIX}${RUN}-${String(++imeiSeq).padStart(3, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);

async function seedSupplier(tag: string, hasVat: boolean) {
  const s = await prisma.supplier.create({ data: { name: `${PREFIX}Supplier ${tag} ${RUN}`, contactName: 'ทดสอบ', phone: '020000000', hasVat } });
  createdSupplierIds.push(s.id);
  return s;
}

/** PO สองรายการ A 9,800 / B 9,800 ×… — ค่าเริ่มต้น A 9,800 + B 4,900 (VAT 7% = 686 + 343 = 1,029) */
async function createOrderedPo(supplierId: string) {
  const po = await poService.create(
    {
      supplierId,
      orderDate: today(),
      items: [
        { brand: `${PREFIX}Brand`, storage: '128GB', category: 'PHONE_NEW', model: `${PREFIX}A`, quantity: 1, unitPrice: 9800 },
        { brand: `${PREFIX}Brand`, storage: '128GB', category: 'PHONE_NEW', model: `${PREFIX}B`, quantity: 1, unitPrice: 4900 },
      ],
    } as never,
    adminId,
    'OWNER',
  );
  createdPoIds.push(po.id);
  return po;
}

type Doc = { supplierDocType: 'TAX_INVOICE' | 'DELIVERY_NOTE' | 'CASH_BILL'; supplierDocNumber: string };
/** รับทั้งสองเครื่องเข้าคลัง (มือถือใหม่ IN_STOCK ทันที) — คืน product A/B */
async function receiveBoth(po: { id: string; items: { id: string; model: string | null }[] }, doc: Doc) {
  const item = (m: string) => po.items.find((i) => i.model === `${PREFIX}${m}`)!;
  const result = await poService.goodsReceiving(
    po.id,
    {
      items: [
        { poItemId: item('A').id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 12000, installmentPrice: 13000 },
        { poItemId: item('B').id, imeiSerial: nextImei(), status: 'PASS', sellingPrice: 6000, installmentPrice: 6500 },
      ],
      ...doc,
      supplierDocDate: today(),
    } as never,
    adminId,
  );
  const products = await prisma.product.findMany({ where: { poId: po.id, deletedAt: null }, include: { receivingItem: { include: { receiving: true } } } });
  const a = products.find((p) => p.model === `${PREFIX}A`)!;
  const b = products.find((p) => p.model === `${PREFIX}B`)!;
  return { result, a, b, receivingId: a.receivingItem!.receivingId };
}

async function seedCustomer(tag: string) {
  const c = await prisma.customer.create({ data: { name: `${PREFIX}Customer ${tag}`, phone: `09${RUN_NUM}${tag}`.slice(0, 12), nationalId: `${PREFIX}${RUN}-${tag}` } });
  createdCustomerIds.push(c.id);
  return c;
}

/** สัญญา DRAFT ที่ผ่านด่านก่อนสินค้าครบ (APPROVED + PDPA + ลายเซ็น 4) บนเครื่อง `productId` สาขาเดียวกับเครื่อง — ตัวเลข golden 17K/12M */
async function seedSignedDraftContract(tag: string, customerId: string, product: { id: string; branchId: string }) {
  const consent = await prisma.pDPAConsent.create({ data: { customerId, consentVersion: '1.0', privacyNoticeText: 'test', status: 'GRANTED', grantedAt: new Date() } });
  createdPdpaIds.push(consent.id);
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${RUN}-${tag}`, customerId, productId: product.id, branchId: product.branchId, salespersonId: adminId,
      pdpaConsentId: consent.id, planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'), downPayment: dec('2000.00'), downPaymentMethod: 'CASH', downPaymentReceivedAt: new Date(),
      financedAmount: dec('10000.00'), interestRate: dec('0.0500'), totalMonths: 12, interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'), vatAmount: dec('1190.00'), vatPct: dec('0.0700'), monthlyPayment: dec('1515.83'), paymentDueDay: 1,
      status: 'DRAFT', workflowStatus: 'APPROVED',
    },
  });
  createdContractIds.push(contract.id);
  await seedVerifiedContractApproval(prisma, contract.id, adminId);
  for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const) {
    await prisma.signature.create({ data: { contractId: contract.id, signerType, signatureImage: 'data:image/png;base64,AA==' } });
  }
  return contract;
}

async function inputVatEntries(contractId: string) {
  return prisma.journalEntry.findMany({
    where: { AND: [{ metadata: { path: ['flow'], equals: INSTALLMENT_INPUT_VAT_FLOW } as never }, { metadata: { path: ['contractId'], equals: contractId } as never }], deletedAt: null },
    include: { lines: { orderBy: { accountCode: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
}
const contractRow = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id }, select: { inputVatStatus: true, inputVatAmount: true, inputVatJournalEntryId: true, inputVatReason: true, status: true } });

describe('ก้อน 5 — ภาษีซื้อเครื่องขายผ่อน (FINANCE Dr 11-4101 / Cr 42-1108)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    const finance = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } });
    financeCompanyId = finance.id;
    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' } });
    }
    adminId = admin.id;

    // การรับของลงคลังกลาง (เงื่อนไขเดียวกับ po-receiving.service.ts: isMainWarehouse → สาขาแรกที่ active) —
    // สัญญาที่เปิดบนเครื่องในคลังนี้โพสต์ ShopDownPayment ซึ่งต้องมีบัญชีเงินสดสาขา (fail-closed)
    let warehouse = await prisma.branch.findFirst({ where: { isMainWarehouse: true, isActive: true, deletedAt: null } });
    if (!warehouse) warehouse = await prisma.branch.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!warehouse) {
      warehouse = await prisma.branch.create({ data: { name: `${PREFIX}warehouse`, companyId: shop.id, isMainWarehouse: true, shopCashAccountCode: 'S11-1101' } });
      createdBranchIds.push(warehouse.id);
    } else if (!warehouse.shopCashAccountCode) {
      await prisma.branch.update({ where: { id: warehouse.id }, data: { shopCashAccountCode: 'S11-1101' } });
    }

    // ผังต้องมี 42-1108 (Task 1 — CSV + migration)
    expect(await prisma.chartOfAccount.findUnique({ where: { code: '42-1108' } })).not.toBeNull();
  }, 180_000);

  afterAll(async () => {
    try {
      for (const cid of createdContractIds) {
        const c = await prisma.contract.findUnique({ where: { id: cid }, select: { contractNumber: true } });
        if (c) await prisma.todo.deleteMany({ where: { tags: { has: INPUT_VAT_PERIOD_TODO_TAG }, title: { contains: c.contractNumber } } });
      }
      const jeIds = new Set<string>();
      for (const cid of createdContractIds) {
        (await prisma.journalEntry.findMany({ where: { metadata: { path: ['contractId'], equals: cid } as never }, select: { id: true } })).forEach((r) => jeIds.add(r.id));
      }
      for (const poId of createdPoIds) {
        (await prisma.journalEntry.findMany({ where: { metadata: { path: ['poId'], equals: poId } as never }, select: { id: true } })).forEach((r) => jeIds.add(r.id));
      }
      const products = await prisma.product.findMany({ where: { poId: { in: createdPoIds } }, select: { id: true } });
      const productIds = products.map((p) => p.id);
      for (const pid of productIds) {
        (await prisma.journalEntry.findMany({ where: { metadata: { path: ['acceptedProductId'], equals: pid } as never }, select: { id: true } })).forEach((r) => jeIds.add(r.id));
      }
      const sales = await prisma.sale.findMany({ where: { OR: [{ productId: { in: productIds } }, { contractId: { in: createdContractIds } }] }, select: { id: true } });
      const saleIds = sales.map((s) => s.id);
      for (const sid of saleIds) {
        (await prisma.journalEntry.findMany({ where: { metadata: { path: ['saleId'], equals: sid } as never }, select: { id: true } })).forEach((r) => jeIds.add(r.id));
      }
      // กระจกของตัวกวาดยกเลิกสัญญาชี้ต้นทางผ่าน reversesEntryId
      for (const id of [...jeIds]) {
        (await prisma.journalEntry.findMany({ where: { metadata: { path: ['reversesEntryId'], equals: id } as never }, select: { id: true } })).forEach((r) => jeIds.add(r.id));
      }
      const jeIdList = [...jeIds];
      // contract_cancellations.reversal_journal_entry_id FK → ลบใบยกเลิกก่อนรายการบัญชี
      await prisma.contractCancellation.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

      await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.customerTag.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.salesCommission.deleteMany({ where: { OR: [{ saleId: { in: saleIds } }, { contractId: { in: createdContractIds } }] } });
      await prisma.saleCostSnapshot.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.shopTender.deleteMany({ where: { OR: [{ saleId: { in: saleIds } }, { contractId: { in: createdContractIds } }] } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
      await prisma.badDebtProvision.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.signature.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.creditApproval.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.creditCheck.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
      await prisma.pDPAConsent.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });

      await prisma.goodsReceivingItem.deleteMany({ where: { receiving: { poId: { in: createdPoIds } } } });
      await prisma.goodsReceiving.deleteMany({ where: { poId: { in: createdPoIds } } });
      await prisma.productPrice.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.productPhoto.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.productReservation.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.pOItem.deleteMany({ where: { poId: { in: createdPoIds } } });
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPoIds } } });
      await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
      await prisma.branch.deleteMany({ where: { id: { in: createdBranchIds } } });
    } finally {
      await prisma.$disconnect();
      await prisma2.$disconnect();
    }
  }, 180_000);

  it('1. รับ TAX_INVOICE จาก VAT supplier → receivedVat 686/343 · เปิดสัญญา A → Dr 11-4101 686 / Cr 42-1108 686 FINANCE · สัญญา CLAIMED', async () => {
    const supplier = await seedSupplier('VAT1', true);
    const po = await createOrderedPo(supplier.id);
    expect(dec(po.vatAmount.toString()).toFixed(2)).toBe('1029.00');
    const { a, b } = await receiveBoth(po, { supplierDocType: 'TAX_INVOICE', supplierDocNumber: `IV-${RUN}-1` });
    expect(dec(a.receivingItem!.receivedVat!.toString()).toFixed(2)).toBe('686.00');
    expect(dec(b.receivingItem!.receivedVat!.toString()).toFixed(2)).toBe('343.00');

    const customer = await seedCustomer('C1');
    const contract = await seedSignedDraftContract('C1', customer.id, a);
    await workflow.activate(contract.id);

    const [je] = await inputVatEntries(contract.id);
    expect(je).toBeDefined();
    expect(je.companyId).toBe(financeCompanyId);
    expect(je.status).toBe('POSTED');
    expect(je.lines.map((l) => [l.accountCode, dec(l.debit ?? 0).toFixed(2), dec(l.credit ?? 0).toFixed(2)])).toEqual([
      ['11-4101', '686.00', '0.00'],
      ['42-1108', '0.00', '686.00'],
    ]);
    expect(je.metadata).toMatchObject({
      tag: 'INSTALLMENT_INPUT_VAT', flow: INSTALLMENT_INPUT_VAT_FLOW, idempotencyKey: `input-vat:${contract.id}`,
      contractId: contract.id, productId: a.id, receivingId: a.receivingItem!.receivingId, taxInvoiceNumber: `IV-${RUN}-1`, companyCode: 'FINANCE', amount: '686.00', invoiceAgeMonths: 0,
    });
    for (const k of ['saleId', 'shopReceivableType', 'paymentId']) expect(je.metadata).not.toHaveProperty(k);
    expect(await contractRow(contract.id)).toMatchObject({ inputVatStatus: 'CLAIMED', inputVatJournalEntryId: je.id });
    expect(dec((await contractRow(contract.id)).inputVatAmount!.toString()).toFixed(2)).toBe('686.00');
    // B ยังไม่ขาย — ไม่มี JE ของ B
    expect(await prisma.journalEntry.count({ where: { metadata: { path: ['productId'], equals: b.id } as never, deletedAt: null } })).toBe(0);

    // Q5 (final review C1 / Review Focus 5): response ทั้งก้อนของ BM/SALES ต้องไม่มียอด VAT เลย — OWNER เห็น
    const bmUser = { id: adminId, role: 'BRANCH_MANAGER', branchId: a.branchId } as never;
    const bmContract = JSON.stringify(await contractQuery.findOne(contract.id, bmUser));
    expect(bmContract).not.toContain('686');
    expect(bmContract).toContain('"inputVatStatus":"CLAIMED"');
    const bmList = JSON.stringify(await contractQuery.findAll({ search: contract.contractNumber }, bmUser));
    expect(bmList).not.toContain('686');
    const bmPo = JSON.stringify(await poService.findOne(po.id, 'BRANCH_MANAGER'));
    expect(bmPo).not.toContain('686.00');
    expect(bmPo).not.toContain('343.00');
    expect(bmPo).toContain('"taxInvoice":{');
    const ownerPo = JSON.stringify(await poService.findOne(po.id, 'OWNER'));
    expect(ownerPo).toContain('686');
    const ownerContract = JSON.stringify(await contractQuery.findOne(contract.id, { id: adminId, role: 'OWNER' } as never));
    expect(ownerContract).toContain('"amount":"686.00"');
  }, 180_000);

  it('2. ยกเลิกสัญญา (C-1) → ตัวกวาดกระจก JE ภาษีซื้อ · สัญญา REVERSED · เปิดสัญญาใหม่บนเครื่องเดิม → เคลมใหม่', async () => {
    const supplier = await seedSupplier('VAT2', true);
    const po = await createOrderedPo(supplier.id);
    const { a } = await receiveBoth(po, { supplierDocType: 'TAX_INVOICE', supplierDocNumber: `IV-${RUN}-2` });
    const customer = await seedCustomer('C2');
    const c1 = await seedSignedDraftContract('C2A', customer.id, a);
    await workflow.activate(c1.id);
    const [original] = await inputVatEntries(c1.id);

    const req = await cancellations.requestCancellation(c1.id, adminId, 'ทดสอบยกเลิกก้อน 5', 0);
    await cancellations.approveCancellation(req.id, adminId);

    const mirror = await prisma.journalEntry.findFirst({ where: { metadata: { path: ['reversesEntryId'], equals: original.id } as never, deletedAt: null }, include: { lines: true } });
    expect(mirror).not.toBeNull();
    expect(mirror!.lines.map((l) => [l.accountCode, dec(l.debit ?? 0).toFixed(2), dec(l.credit ?? 0).toFixed(2)]).sort()).toEqual([
      ['11-4101', '0.00', '686.00'],
      ['42-1108', '686.00', '0.00'],
    ]);
    expect(((await prisma.journalEntry.findUniqueOrThrow({ where: { id: original.id } })).metadata as Record<string, unknown>).reversed).toBe(true);
    expect(await contractRow(c1.id)).toMatchObject({ status: 'CANCELED', inputVatStatus: 'REVERSED' });

    // เครื่องกลับ SHOP IN_STOCK → เปิดสัญญาใหม่ → เคลมใหม่ด้วย key ของสัญญาใหม่
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(fresh.status).toBe('IN_STOCK');
    const c2 = await seedSignedDraftContract('C2B', customer.id, a);
    await workflow.activate(c2.id);
    const [second] = await inputVatEntries(c2.id);
    expect(second.id).not.toBe(original.id);
    expect(await contractRow(c2.id)).toMatchObject({ inputVatStatus: 'CLAIMED', inputVatJournalEntryId: second.id });
  }, 180_000);

  it('3. รับด้วยใบส่งของ → เปิดสัญญา = PENDING_INVOICE ไม่มี JE → บันทึกใบกำกับ → JE ลงวันเปิดสัญญา · CLAIMED · บันทึกซ้ำ (OWNER) ไม่ได้ JE ใบใหม่', async () => {
    const supplier = await seedSupplier('VAT3', true);
    const po = await createOrderedPo(supplier.id);
    const { a, receivingId } = await receiveBoth(po, { supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: `DN-${RUN}-3` });
    const customer = await seedCustomer('C3');
    const contract = await seedSignedDraftContract('C3', customer.id, a);
    await workflow.activate(contract.id);
    expect(await contractRow(contract.id)).toMatchObject({ inputVatStatus: 'PENDING_INVOICE', inputVatJournalEntryId: null });
    expect(await inputVatEntries(contract.id)).toHaveLength(0);
    expect(await prisma.todo.count({ where: { tags: { has: INPUT_VAT_PERIOD_TODO_TAG }, title: { contains: contract.contractNumber } } })).toBe(0);

    const out = await taxInvoiceService.record(po.id, receivingId, { number: `IV-${RUN}-3`, date: today() }, undefined, { id: adminId, role: 'BRANCH_MANAGER' });
    expect(out.claimed).toHaveLength(1);
    expect(out.claimed[0]).toMatchObject({ contractId: contract.id, amount: null, postedOnInvoiceDate: false }); // BM ไม่เห็นยอด (Q5)
    expect(dec((await contractRow(contract.id)).inputVatAmount!.toString()).toFixed(2)).toBe('686.00');
    expect(out.accountingNotified).toBe(false);
    const [je] = await inputVatEntries(contract.id);
    const oneA = await prisma.journalEntry.findFirstOrThrow({ where: { AND: [{ metadata: { path: ['tag'], equals: '1A' } as never }, { metadata: { path: ['contractId'], equals: contract.id } as never }] } });
    expect(je.postedAt!.toISOString()).toBe(oneA.postedAt!.toISOString()); // ลงวันเปิดสัญญา (Q2)
    expect(je.metadata).toMatchObject({ taxInvoiceNumber: `IV-${RUN}-3` });
    expect(je.metadata).not.toHaveProperty('postedOnInvoiceDate');
    expect(await contractRow(contract.id)).toMatchObject({ inputVatStatus: 'CLAIMED', inputVatJournalEntryId: je.id });

    // BM แก้ไม่ได้ · OWNER แก้ได้ แต่ไม่โพสต์ซ้ำ (contract ไม่ PENDING แล้ว)
    await expect(taxInvoiceService.record(po.id, receivingId, { number: `IV-${RUN}-3X`, date: today() }, undefined, { id: adminId, role: 'BRANCH_MANAGER' })).rejects.toThrow('เฉพาะเจ้าของหรือฝ่ายบัญชี');
    const again = await taxInvoiceService.record(po.id, receivingId, { number: `IV-${RUN}-3X`, date: today() }, undefined, { id: adminId, role: 'OWNER' });
    expect(again.claimed).toHaveLength(0);
    const after = await inputVatEntries(contract.id);
    expect(after).toHaveLength(1);
    // I2 — metadata ของ JE ที่เคลมไว้ตามใบกำกับใหม่ (รายงาน ภ.พ.30 อ่านจาก metadata)
    expect(after[0].metadata).toMatchObject({ taxInvoiceNumber: `IV-${RUN}-3X` });
    // Q5 — ผู้บันทึกครั้งแรกเป็น BRANCH_MANAGER: บันทึกได้แต่ไม่เห็นยอด ⇒ claimed[].amount = null (ยอดจริงอยู่ใน JE/คอลัมน์สัญญา)
    expect(out.claimed[0].amount).toBeNull();
    expect(JSON.stringify(out)).not.toContain('686');
  }, 180_000);

  it('4. ผู้จัดจำหน่ายไม่จด VAT → receivedVat 0 · เปิดสัญญา = NOT_ELIGIBLE เหตุผล · ไม่มี JE · ไม่มี Todo · บันทึกใบกำกับถูกปฏิเสธ', async () => {
    const supplier = await seedSupplier('NOVAT', false);
    const po = await createOrderedPo(supplier.id);
    expect(dec(po.vatAmount.toString()).toFixed(2)).toBe('0.00');
    const { a, receivingId } = await receiveBoth(po, { supplierDocType: 'CASH_BILL', supplierDocNumber: `CB-${RUN}-4` });
    expect(dec(a.receivingItem!.receivedVat!.toString()).toFixed(2)).toBe('0.00');
    const customer = await seedCustomer('C4');
    const contract = await seedSignedDraftContract('C4', customer.id, a);
    await workflow.activate(contract.id);
    expect(await contractRow(contract.id)).toMatchObject({ inputVatStatus: 'NOT_ELIGIBLE', inputVatReason: expect.stringContaining('ไม่จด VAT') });
    expect(await inputVatEntries(contract.id)).toHaveLength(0);
    await expect(taxInvoiceService.record(po.id, receivingId, { number: 'IV-X', date: today() }, undefined, { id: adminId, role: 'OWNER' })).rejects.toThrow('ไม่จด VAT');
  }, 180_000);

  it('5. สัญญา PENDING_INVOICE ถูกยกเลิกก่อนได้ใบกำกับ → REVERSED · ใบกำกับที่มาทีหลังไม่เคลมสัญญานั้น (Review Focus 2)', async () => {
    const supplier = await seedSupplier('VAT5', true);
    const po = await createOrderedPo(supplier.id);
    const { a, receivingId } = await receiveBoth(po, { supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: `DN-${RUN}-5` });
    const customer = await seedCustomer('C5');
    const contract = await seedSignedDraftContract('C5', customer.id, a);
    await workflow.activate(contract.id);
    const req = await cancellations.requestCancellation(contract.id, adminId, 'ยกเลิกก่อนใบกำกับมา', 0);
    await cancellations.approveCancellation(req.id, adminId);
    expect(await contractRow(contract.id)).toMatchObject({ inputVatStatus: 'REVERSED', inputVatReason: 'สัญญาถูกยกเลิกก่อนได้ใบกำกับภาษี' });
    const out = await taxInvoiceService.record(po.id, receivingId, { number: `IV-${RUN}-5`, date: today() }, undefined, { id: adminId, role: 'OWNER' });
    expect(out.claimed).toHaveLength(0);
    expect(await inputVatEntries(contract.id)).toHaveLength(0);
  }, 180_000);

  it('6. getVatMonthly: vatInputInstallment รวมยอดเคลมของเดือนนี้ (สุทธิหลังกระจก) และบรรทัดอยู่ใน installmentInputVatLines', async () => {
    const { year, month } = bangkokCalendarParts(new Date());
    const report = await financeTax.getVatMonthly(year, month + 1, financeCompanyId);
    const mine = report.installmentInputVatLines.filter((l) => l.contractNumber?.startsWith(PREFIX));
    // เคส 1 (+686) · เคส 2 (+686 กระจก −686 +686) · เคส 3 (+686) = 686 × 3 สุทธิ จากสัญญาของไฟล์นี้
    const sum = mine.reduce((s, l) => s.plus(l.amount), dec(0));
    expect(sum.toFixed(2)).toBe('2058.00');
    expect(mine.some((l) => l.reversal)).toBe(true);
    expect(dec(report.vatInputInstallment).gte(sum)).toBe(true);
    expect(dec(report.vatInput).toFixed(2)).toBe(dec(report.vatInputExpense).plus(report.vatInputInstallment).toFixed(2));
  }, 60_000);

  it('7. บันทึกใบกำกับพร้อมกันสองคอนเนกชัน → JE ภาษีซื้อใบเดียว · ผู้แพ้ได้ HttpException ไม่ใช่ error ดิบ (Review Focus 1)', async () => {
    const supplier = await seedSupplier('VAT7', true);
    const po = await createOrderedPo(supplier.id);
    const { a, receivingId } = await receiveBoth(po, { supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: `DN-${RUN}-7` });
    const customer = await seedCustomer('C7');
    const contract = await seedSignedDraftContract('C7', customer.id, a);
    await workflow.activate(contract.id);
    const dto = { number: `IV-${RUN}-7`, date: today() };
    const results = await Promise.allSettled([
      taxInvoiceService.record(po.id, receivingId, dto, undefined, { id: adminId, role: 'OWNER' }),
      taxInvoiceService2.record(po.id, receivingId, dto, undefined, { id: adminId, role: 'OWNER' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(HttpException);
    expect(await inputVatEntries(contract.id)).toHaveLength(1);
    expect(await contractRow(contract.id)).toMatchObject({ inputVatStatus: 'CLAIMED' });
  }, 180_000);
});
