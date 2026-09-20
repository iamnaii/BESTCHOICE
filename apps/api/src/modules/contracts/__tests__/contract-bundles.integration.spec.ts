/**
 * ของแถมในสัญญาผ่อน — วงจรจริงบน DB จริง (2026-09-20)
 *
 * ที่มา: เจ้าของถามว่าทำสัญญาผ่อนแล้วต้องมาตัดสต๊อกที่ POS อีกไหม → เครื่องหลักไม่ต้อง แต่ "ของแถม"
 * ที่ให้ไปกับสัญญาผ่อนไม่มีที่ไหนตัดเลย (หน้าสร้างสัญญาไม่มีช่อง และใบขายอัตโนมัติมีของแถมว่างเสมอ)
 * ขัดคำสั่งเจ้าของ 2026-08-26 "ของแถมต้องตัดสต็อกทุกครั้ง"
 *
 * สิ่งที่พิสูจน์ (unit spec mock prisma มองไม่เห็นทั้งหมดนี้):
 *   1. จอง → เปิดใช้ = ของแถม SOLD_CASH + ใบขายอัตโนมัติถือของแถม + ต้นทุนของแถมออกจากสต๊อกอุปกรณ์เสริม
 *   2. ยกเลิกสัญญา = ของแถมกลับ IN_STOCK และบัญชีสต๊อกอุปกรณ์เสริมกลับมาเท่าเดิม (sweep กลับรายการให้)
 *   3. แก้ไขของแถมตอนเป็นร่าง: เพิ่ม = จอง · นำออก = ปล่อย · หลังเปิดใช้ = ปฏิเสธ · SALES แก้สัญญาคนอื่นไม่ได้
 *   4. ลบร่าง = ของแถมกลับ IN_STOCK พร้อมเครื่องหลัก
 *   5. ของแถมที่ถูกจองแล้ว ขาย/แถมซ้ำที่ POS ไม่ได้
 *
 * รัน: vitest (jest มองไม่เห็น *.integration.spec.ts) — CI glob `src/modules/contracts/__tests__/*.integration.spec.ts`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { ContractWorkflowService } from '../contract-workflow.service';
import { ContractLifecycleService } from '../services/contract-lifecycle.service';
import { ContractQueryService } from '../services/contract-query.service';
import { ContractCancellationService } from '../services/contract-cancellation.service';
import { reserveContractBundles } from '../services/contract-bundle.util';
import { ProductsService } from '../../products/products.service';
import { SalesService } from '../../sales/sales.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { ContractCancellationTemplate } from '../../journal/cpa-templates/contract-cancellation.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../../journal/cpa-templates/shop-down-payment-reversal.template';
import { ShopExternalFinanceSaleTemplate } from '../../journal/cpa-templates/shop-external-finance-sale.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { seedVerifiedContractApproval } from './credit-approval.fixture';

const prisma = new PrismaClient();

// Service wiring — instance จริง ไม่ผ่าน Nest DI (pattern เดียวกับ product-lifecycle / contract-cancellation specs)
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const shopDownPayment = new ShopDownPaymentTemplate(journal, prisma as never, companyResolver);

const workflow = new ContractWorkflowService(
  prisma as never,
  null as never, // notificationsService — เรียกหลัง tx และมี guard
  journal,
  new ContractActivation1ATemplate(journal, prisma as never),
  new ProductsService(prisma as never),
  null as never, // contractExchangeService — เฉพาะสัญญาจากเปลี่ยนเครื่อง
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver),
  shopDownPayment,
  shopAccountResolver,
);

const lifecycle = new ContractLifecycleService(
  prisma as never,
  new ContractQueryService(prisma as never),
  shopDownPayment,
  new ShopDownPaymentReversalTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
);

const cancellationTemplate = new ContractCancellationTemplate(
  prisma as never,
  new ExchangeCancelReversalTemplate(journal, prisma as never),
  new EclStageReverseTemplate(journal, prisma as never),
);
const cancellations = new ContractCancellationService(
  prisma as never,
  () => cancellationTemplate,
  () => companyResolver,
);

const salesService = new SalesService(
  prisma as never,
  null as never,
  new ShopCashSaleTemplate(journal, prisma as never, companyResolver),
  shopAccountResolver,
  new ShopExternalFinanceSaleTemplate(journal, prisma as never, companyResolver),
  { notify: async () => {} } as never,
  shopDownPayment,
);

const PREFIX = 'BUNDLETEST-';
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const dec = (s: string) => new Decimal(s);

/** สต๊อกอุปกรณ์เสริมของ SHOP — บัญชีที่ต้นทุนของแถมต้องออก/กลับ */
const ACCESSORY_INVENTORY = 'S11-2003';

const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdUserIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string;
let shopCompanyId: string;
let branchId: string;

async function seedPhone(tag: string) {
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Phone ${tag}`, brand: `${PREFIX}Brand`, model: `${PREFIX}Model-${tag}`, storage: '128GB',
      imeiSerial: `${PREFIX}${RUN}-${tag}`, category: 'PHONE_NEW', costPrice: dec('6000.00'),
      branchId, status: 'IN_STOCK', ownedByCompanyId: shopCompanyId, stockInDate: new Date(),
    },
  });
  createdProductIds.push(product.id);
  return product;
}

async function seedAccessory(tag: string, costPrice: string) {
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}เคส ${tag}`, brand: `${PREFIX}Brand`, model: `${PREFIX}Case-${tag}`,
      imeiSerial: `${PREFIX}${RUN}-ACC-${tag}`, category: 'ACCESSORY', costPrice: dec(costPrice),
      branchId, status: 'IN_STOCK', ownedByCompanyId: shopCompanyId, stockInDate: new Date(),
    },
  });
  createdProductIds.push(product.id);
  return product;
}

async function seedCustomer(tag: string) {
  const customer = await prisma.customer.create({
    data: { name: `${PREFIX}Customer ${tag}`, phone: `09${RUN_NUM}${tag}`.slice(0, 12), nationalId: `${PREFIX}${RUN}-${tag}` },
  });
  createdCustomerIds.push(customer.id);
  return customer;
}

/**
 * สัญญา DRAFT ที่จองเครื่องหลักแล้ว + จองของแถมผ่าน util จริง (เหมือนที่ `ContractLifecycleService.create` ทำ)
 * `signed = true` ⇒ พร้อม activate (APPROVED + PDPA + ลายเซ็นครบ 4) · `false` ⇒ ร่างที่ยังแก้/ลบได้ (CREATING)
 * ตัวเลข = ชุด CPA golden 17K/12M (down 2,000 + financed 10,000 = sellingPrice 12,000)
 */
async function seedDraftWithBundles(tag: string, opts: { signed: boolean; bundleIds: string[]; salespersonId?: string }) {
  const phone = await seedPhone(tag);
  const customer = await seedCustomer(tag);
  const consent = await prisma.pDPAConsent.create({
    data: { customerId: customer.id, consentVersion: '1.0', privacyNoticeText: 'test', status: 'GRANTED', grantedAt: new Date() },
  });
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${RUN}-${tag}`, customerId: customer.id, productId: phone.id, branchId,
      salespersonId: opts.salespersonId ?? adminId, pdpaConsentId: consent.id, planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'), downPayment: dec('2000.00'), downPaymentMethod: 'CASH', downPaymentReceivedAt: new Date(),
      financedAmount: dec('10000.00'), interestRate: dec('0.0500'), totalMonths: 12, interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'), vatAmount: dec('1190.00'), vatPct: dec('0.0700'), monthlyPayment: dec('1515.83'),
      paymentDueDay: 1, status: 'DRAFT', workflowStatus: opts.signed ? 'APPROVED' : 'CREATING',
      bundleProductIds: opts.bundleIds,
    },
  });
  createdContractIds.push(contract.id);
  await prisma.product.update({ where: { id: phone.id }, data: { status: 'RESERVED' } });
  await prisma.$transaction((tx) => reserveContractBundles(tx, {
    bundleProductIds: opts.bundleIds, mainProductId: phone.id, branchId,
    actor: { role: 'OWNER', branchId }, customer,
  }));
  if (opts.signed) {
    await seedVerifiedContractApproval(prisma, contract.id, adminId);
    for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const) {
      await prisma.signature.create({ data: { contractId: contract.id, signerType, signatureImage: 'data:image/png;base64,AA==' } });
    }
  }
  return { contract, phone, customer };
}

const statusOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).status;

/** ยอดสุทธิ (Dr − Cr) ของบัญชีจาก JE ที่ผูกสัญญานี้ (metadata.contractId) */
async function contractAccountNet(contractId: string, accountCode: string): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode, journalEntry: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: contractId } as never } },
    select: { debit: true, credit: true },
  });
  return lines.reduce((sum, l) => sum.plus(l.debit.toString()).minus(l.credit.toString()), new Decimal(0));
}

describe('ของแถมในสัญญาผ่อน — วงจรจริงบน DB จริง', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    shopCompanyId = (await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } })).id;
    await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } });

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) admin = await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' } });
    adminId = admin.id;

    const existing = await prisma.branch.findFirst({ where: { name: '__bundle_test_branch__', deletedAt: null } });
    if (existing) {
      branchId = existing.id;
    } else {
      // ตู้เงินสดสาขา — ShopDownPaymentTemplate fail-closed ถ้าไม่มี (เงินดาวน์ > 0)
      const branch = await prisma.branch.create({ data: { name: '__bundle_test_branch__', companyId: shopCompanyId, shopCashAccountCode: 'S11-1101' } });
      branchId = branch.id;
      createdBranchId = branch.id;
    }
  }, 180_000);

  afterAll(async () => {
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      const rows = await prisma.journalEntry.findMany({ where: { metadata: { path: ['contractId'], equals: cid } as never }, select: { id: true } });
      rows.forEach((r) => jeIds.add(r.id));
    }
    // mirror ตอนยกเลิกไม่ carry contractId เสมอไป — ตามจาก reversesEntryId
    const mirrors = await prisma.journalEntry.findMany({
      where: { OR: [...jeIds].map((id) => ({ metadata: { path: ['reversesEntryId'], equals: id } as never })) },
      select: { id: true },
    });
    mirrors.forEach((r) => jeIds.add(r.id));
    const sales = await prisma.sale.findMany({ where: { productId: { in: createdProductIds } }, select: { id: true } });
    const saleIds = sales.map((s) => s.id);
    for (const sid of saleIds) {
      const rows = await prisma.journalEntry.findMany({ where: { metadata: { path: ['saleId'], equals: sid } as never }, select: { id: true } });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];
    await prisma.contractCancellation.updateMany({ where: { contractId: { in: createdContractIds } }, data: { reversalJournalEntryId: null } });
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });
    await prisma.salesCommission.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.saleCostSnapshot.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contractCancellation.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.signature.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.creditApproval.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.kycVerification.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.productReservation.deleteMany({ where: { productId: { in: createdProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.pDPAConsent.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdBranchId) {
      try { await prisma.branch.delete({ where: { id: createdBranchId } }); } catch { /* ถูกอ้างอิงจากแถวนอกขอบเขต — ปล่อยไว้ */ }
    }
    await prisma.$disconnect();
  }, 180_000);

  it('จอง → เปิดใช้ = ตัดสต๊อกของแถม + ใบขายถือของแถม + ต้นทุนออกจากสต๊อกอุปกรณ์เสริม → ยกเลิก = คืนครบ', async () => {
    const caseA = await seedAccessory('A1', '80.00');
    const film = await seedAccessory('A2', '120.00');
    const { contract, phone, customer } = await seedDraftWithBundles('A', { signed: true, bundleIds: [caseA.id, film.id] });

    // จองแล้ว: หายจากรายการพร้อมขาย และแถมซ้ำที่ POS ไม่ได้
    expect(await statusOf(caseA.id)).toBe('RESERVED');
    expect(await statusOf(film.id)).toBe('RESERVED');
    const otherPhone = await seedPhone('A-POS');
    await expect(
      salesService.create(
        { saleType: 'CASH', customerId: customer.id, productId: otherPhone.id, branchId, sellingPrice: 9000,
          paymentMethod: 'CASH', amountReceived: 9000, bundleProductIds: [caseA.id] } as never,
        adminId, 'OWNER',
      ),
    ).rejects.toThrow('สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว');

    await workflow.activate(contract.id);

    expect(await statusOf(phone.id)).toBe('SOLD_INSTALLMENT');
    expect(await statusOf(caseA.id)).toBe('SOLD_CASH');
    expect(await statusOf(film.id)).toBe('SOLD_CASH');
    const sale = await prisma.sale.findFirstOrThrow({ where: { contractId: contract.id, deletedAt: null } });
    expect(sale.saleType).toBe('INSTALLMENT');
    expect(sale.bundleProductIds).toEqual([caseA.id, film.id]);
    // ต้นทุนของแถม 80 + 120 ออกจากสต๊อกอุปกรณ์เสริม (Cr) — คำสั่งเจ้าของ "ของแถมต้องตัดสต็อกทุกครั้ง"
    expect((await contractAccountNet(contract.id, ACCESSORY_INVENTORY)).toFixed(2)).toBe('-200.00');

    // หลังเปิดใช้: แก้ของแถมไม่ได้ (บัญชีลงแล้ว)
    await expect(lifecycle.updateBundles(contract.id, [], { id: adminId, role: 'OWNER', branchId }))
      .rejects.toThrow('แก้ไขของแถมได้เฉพาะก่อนเปิดใช้สัญญา');

    // ยกเลิกสัญญา (C-1): ของแถมกลับเข้าคลัง + สต๊อกอุปกรณ์เสริมในสมุดกลับมาเท่าเดิม
    const cancellation = await cancellations.requestCancellation(contract.id, adminId, 'ทดสอบยกเลิกสัญญาที่มีของแถม', 0);
    await cancellations.approveCancellation(cancellation.id, adminId);

    expect(await statusOf(phone.id)).toBe('IN_STOCK');
    expect(await statusOf(caseA.id)).toBe('IN_STOCK');
    expect(await statusOf(film.id)).toBe('IN_STOCK');
    // C-1 = "ทุกบัญชี net 0 ต่อสัญญา" — ขา Cr 200 ตอนเปิดใช้ ถูก mirror เป็น Dr 200 (mirror carry contractId)
    expect((await contractAccountNet(contract.id, ACCESSORY_INVENTORY)).toFixed(2)).toBe('0.00');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'contract', entityId: contract.id, action: 'CONTRACT_CANCELED' } });
    expect((audit.newValue as { bundlesRestored?: string[] }).bundlesRestored?.sort()).toEqual([caseA.id, film.id].sort());
  }, 180_000);

  it('แก้ไขของแถมตอนเป็นร่าง: เพิ่ม = จอง · นำออก = ปล่อย · มือถือเป็นของแถมไม่ได้ · SALES แก้สัญญาคนอื่นไม่ได้', async () => {
    const caseB = await seedAccessory('B1', '80.00');
    const film = await seedAccessory('B2', '120.00');
    const { contract } = await seedDraftWithBundles('B', { signed: false, bundleIds: [caseB.id] });
    const owner = { id: adminId, role: 'OWNER', branchId };

    // เพิ่มฟิล์ม + นำเคสออก ในคำขอเดียว
    const updated = await lifecycle.updateBundles(contract.id, [film.id], owner);
    expect(await statusOf(caseB.id)).toBe('IN_STOCK');
    expect(await statusOf(film.id)).toBe('RESERVED');
    expect((updated as { bundleProducts: { id: string }[] }).bundleProducts.map((p) => p.id)).toEqual([film.id]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'contract', entityId: contract.id, action: 'CONTRACT_BUNDLES_UPDATED' } });
    expect(audit.newValue).toMatchObject({ added: [film.id], removed: [caseB.id] });

    // มือถือทั้งเครื่องเป็นของแถมไม่ได้ — และของเดิมต้องไม่ถูกแตะ (tx ย้อนกลับทั้งก้อน)
    const phone = await seedPhone('B-GIFT');
    await expect(lifecycle.updateBundles(contract.id, [film.id, phone.id], owner))
      .rejects.toThrow('ของแถมเลือกได้เฉพาะสินค้าหมวดอุปกรณ์เสริม');
    expect(await statusOf(phone.id)).toBe('IN_STOCK');
    expect(await statusOf(film.id)).toBe('RESERVED');

    // SALES ที่ไม่ใช่เจ้าของสัญญา
    const otherSales = await prisma.user.create({ data: { email: `${PREFIX}${RUN}-sales@test.local`, password: 'x', name: 'other sales', role: 'SALES', branchId } });
    createdUserIds.push(otherSales.id);
    await expect(lifecycle.updateBundles(contract.id, [], { id: otherSales.id, role: 'SALES', branchId }))
      .rejects.toThrow('แก้ไขของแถมได้เฉพาะสัญญาที่ตัวเองสร้าง');
    // BRANCH_MANAGER ต่างสาขา / ไม่มีสาขาติดตัว = fail-closed
    await expect(lifecycle.updateBundles(contract.id, [], { id: adminId, role: 'BRANCH_MANAGER', branchId: null }))
      .rejects.toThrow('แก้ไขของแถมได้เฉพาะสัญญาของสาขาตัวเอง');
    expect(await statusOf(film.id)).toBe('RESERVED');
  }, 180_000);

  it('ลบร่าง = ของแถมกลับเป็นพร้อมขายพร้อมเครื่องหลัก', async () => {
    const caseC = await seedAccessory('C1', '80.00');
    const { contract, phone } = await seedDraftWithBundles('C', { signed: false, bundleIds: [caseC.id] });
    // ร่างนี้ seed ตรง ไม่ได้ผ่าน create() จึงไม่มีใบรับเงินดาวน์ — ตั้งดาวน์เป็น 0 ให้ softDelete ไม่ต้องคืนเงิน
    await prisma.contract.update({ where: { id: contract.id }, data: { downPayment: dec('0'), sellingPrice: dec('10000.00'), downPaymentMethod: null, downPaymentReceivedAt: null } });

    await lifecycle.softDelete(contract.id, adminId);

    expect(await statusOf(phone.id)).toBe('IN_STOCK');
    expect(await statusOf(caseC.id)).toBe('IN_STOCK');
  }, 180_000);
});
