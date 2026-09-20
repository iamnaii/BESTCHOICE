/**
 * สมุดเงินหน้าร้าน + บิลจ่ายผสม — วงจรจริงบน DB จริง (สเปค 2026-09-20-shop-tenders-daily-cash)
 *
 * พิสูจน์สิ่งที่ unit test (mock prisma) มองไม่เห็น:
 *  1. ขายสดจ่ายผสม → ยอดบัญชีลิ้นชัก/ธนาคาร = ยอดของแต่ละวิธีพอดี → ยกเลิกใบขาย → สุทธิ 0 + แถวเงินออก
 *  2. เงินดาวน์จ่ายผสม → ลบร่างสัญญา → สุทธิ 0 (JE แยกยอดถูก mirror ด้วย) + แถวเงินออก
 *  3. เงินดาวน์จ่ายผสม → เปิดใช้ → ยกเลิกสัญญา **ต้องไม่ชน cash tripwire** (JE แยกยอดจงใจไม่ stamp contractId)
 *  4. หน้าสรุปเงินรายวันอ่านแถวเหล่านี้ได้จริง + ป้ายเลขอ้างอิงซ้ำ
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
import { ProductsService } from '../../products/products.service';
import { SalesService } from '../../sales/sales.service';
import { SaleVoidService } from '../../sales/services/sale-void.service';
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
import { ShopTenderRecorder } from '../../shop-tenders/shop-tender.recorder';
import { normalizeTenders } from '../../shop-tenders/shop-tender.util';
import { ShopTendersReportService } from '../../shop-tenders/shop-tenders-report.service';
import { bangkokDateString } from '../../../utils/date.util';
import { countShopTenders, deleteShopTenders, findTenderSplitEntries, testTenderWhere } from '../../../cli/shop-tender-cleanup.util';
import { seedVerifiedContractApproval } from './credit-approval.fixture';

const prisma = new PrismaClient();
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const shopAccountResolver = new ShopAccountResolver(prisma as never);
const shopDownPayment = new ShopDownPaymentTemplate(journal, prisma as never, companyResolver);

const workflow = new ContractWorkflowService(
  prisma as never, null as never, journal, new ContractActivation1ATemplate(journal, prisma as never),
  new ProductsService(prisma as never), null as never,
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver), shopDownPayment, shopAccountResolver,
);
const lifecycle = new ContractLifecycleService(
  prisma as never, new ContractQueryService(prisma as never), shopDownPayment,
  new ShopDownPaymentReversalTemplate(journal, prisma as never, companyResolver), shopAccountResolver,
);
const cancellationTemplate = new ContractCancellationTemplate(
  prisma as never, new ExchangeCancelReversalTemplate(journal, prisma as never), new EclStageReverseTemplate(journal, prisma as never),
);
const cancellations = new ContractCancellationService(prisma as never, () => cancellationTemplate, () => companyResolver);
const salesService = new SalesService(
  prisma as never, null as never, new ShopCashSaleTemplate(journal, prisma as never, companyResolver), shopAccountResolver,
  new ShopExternalFinanceSaleTemplate(journal, prisma as never, companyResolver), { notify: async () => {} } as never,
);
const saleVoidService = new SaleVoidService(prisma as never, new ExchangeCancelReversalTemplate(journal, prisma as never));
const report = new ShopTendersReportService(prisma as never);

const PREFIX = 'TENDERTEST-';
const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const dec = (s: string) => new Decimal(s);
/** บัญชีลิ้นชักเฉพาะของเทสนี้ — ไม่ปนกับยอดของสาขาอื่นในฐานเดียวกัน */
const TILL = 'S11-1103';
const BANK = 'S11-1201';

const created = { contracts: [] as string[], products: [] as string[], customers: [] as string[], sales: [] as string[] };
let adminId: string;
let shopCompanyId: string;
let branchId: string;

async function seedPhone(tag: string) {
  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Phone ${tag}`, brand: `${PREFIX}Brand`, model: `${PREFIX}Model-${tag}`, storage: '128GB',
      imeiSerial: `${PREFIX}${RUN}-${tag}`, category: 'PHONE_NEW', costPrice: dec('6000.00'), cashPrice: dec('9900.00'),
      branchId, status: 'IN_STOCK', ownedByCompanyId: shopCompanyId, stockInDate: new Date(),
    },
  });
  created.products.push(product.id);
  return product;
}

async function seedCustomer(tag: string) {
  const customer = await prisma.customer.create({
    data: { name: `${PREFIX}Customer ${tag}`, phone: `09${RUN_NUM}${tag}`.slice(0, 12), nationalId: `${PREFIX}${RUN}-${tag}` },
  });
  created.customers.push(customer.id);
  return customer;
}

/** ยอดสุทธิ (Dr − Cr) ของบัญชี นับเฉพาะ JE ที่สร้างหลัง `since` — แยกผลของเทสแต่ละเคสออกจากกัน */
async function accountNetSince(accountCode: string, since: Date): Promise<string> {
  const lines = await prisma.journalLine.findMany({
    where: { accountCode, journalEntry: { status: 'POSTED', deletedAt: null, createdAt: { gte: since } } },
    select: { debit: true, credit: true },
  });
  return lines.reduce((sum, l) => sum.plus(l.debit.toString()).minus(l.credit.toString()), new Decimal(0)).toFixed(2);
}

/** ร่างสัญญา + รับเงินดาวน์จ่ายผสม 2,000 สด + 3,000 QR ผ่าน template + recorder ตัวจริง (เหมือนที่ create() ทำใน tx เดียว) */
async function seedDraftWithSplitDown(tag: string, opts: { signed: boolean }) {
  const phone = await seedPhone(tag);
  const customer = await seedCustomer(tag);
  const consent = await prisma.pDPAConsent.create({
    data: { customerId: customer.id, consentVersion: '1.0', privacyNoticeText: 'test', status: 'GRANTED', grantedAt: new Date() },
  });
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${RUN}-${tag}`, customerId: customer.id, productId: phone.id, branchId,
      salespersonId: adminId, pdpaConsentId: consent.id, planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('15000.00'), downPayment: dec('5000.00'), downPaymentMethod: 'CASH', downPaymentReference: `QR${RUN}${tag}`,
      downPaymentReceivedAt: new Date(), financedAmount: dec('10000.00'), interestRate: dec('0.0500'), totalMonths: 12,
      interestTotal: dec('6000.00'), storeCommission: dec('1000.00'), vatAmount: dec('1190.00'), vatPct: dec('0.0700'),
      monthlyPayment: dec('1515.83'), paymentDueDay: 1, status: 'DRAFT', workflowStatus: opts.signed ? 'APPROVED' : 'CREATING',
    },
  });
  created.contracts.push(contract.id);
  await prisma.product.update({ where: { id: phone.id }, data: { status: 'RESERVED' } });
  const tenders = normalizeTenders(
    [{ method: 'CASH', amount: 2000 }, { method: 'QR_EWALLET', amount: 3000, reference: `QR${RUN}${tag}` }], '5000.00');
  await prisma.$transaction(async (tx) => {
    await shopDownPayment.execute({ idempotencyKey: `shop-down-payment:${contract.id}`, contractId: contract.id,
      contractNumber: contract.contractNumber, cashAccountCode: TILL, downAmount: dec('5000.00') }, tx);
    await new ShopTenderRecorder(prisma as never).recordInflow(tx, { kind: 'CONTRACT_DOWN', branchId, actorId: adminId,
      doc: { contractId: contract.id }, docNumber: contract.contractNumber, tenders });
  });
  if (opts.signed) {
    await seedVerifiedContractApproval(prisma, contract.id, adminId);
    for (const signerType of ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const) {
      await prisma.signature.create({ data: { contractId: contract.id, signerType, signatureImage: 'data:image/png;base64,AA==' } });
    }
  }
  return { contract, phone, customer };
}

const tendersOf = (where: Record<string, string>) => prisma.shopTender.findMany({ where, orderBy: [{ direction: 'asc' }, { seq: 'asc' }] });

describe('สมุดเงินหน้าร้าน + บิลจ่ายผสม — วงจรจริงบน DB จริง', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    shopCompanyId = (await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } })).id;
    await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } });
    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) admin = await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' } });
    adminId = admin.id;
    const branch = await prisma.branch.create({ data: { name: `${PREFIX}Branch ${RUN}`, companyId: shopCompanyId, shopCashAccountCode: TILL } });
    branchId = branch.id;
  });

  // ล้างทุกแถวที่ไฟล์นี้สร้าง — เทสพี่น้องในฐานเดียวกันล้างตาราง contract / journalEntry ทั้งตาราง
  // (`deleteMany({})`) ⇒ ลายเซ็น, รายการยกเลิกสัญญา หรือ JE ที่ค้างจากไฟล์นี้จะทำให้ชุดอื่นล้มที่ FK ทั้งชุด
  // (พบจริงบน CI 2026-09-20). ลำดับตาม contract-bundles.integration.spec.ts + แถว shop_tenders และ JE แยกยอด.
  afterAll(async () => {
    const products = created.products;
    const sales = await prisma.sale.findMany({ where: { productId: { in: products } }, select: { id: true } });
    const saleIds = sales.map((sale) => sale.id);
    const jeIds = new Set<string>();
    const collect = async (path: string, ids: string[]) => {
      for (const id of ids) {
        const rows = await prisma.journalEntry.findMany({ where: { metadata: { path: [path], equals: id } as never }, select: { id: true } });
        rows.forEach((row) => jeIds.add(row.id));
      }
    };
    await collect('contractId', created.contracts);
    await collect('saleId', saleIds);
    // JE แยกยอดของสัญญาจงใจไม่ stamp contractId — ตามจาก tenderDocId
    await collect('tenderDocId', [...created.contracts, ...saleIds]);
    // mirror ตอนยกเลิก/ลบร่าง/void ไม่ carry key เดิมเสมอไป — ตามจาก reversesEntryId (สองชั้นพอ)
    for (let depth = 0; depth < 2 && jeIds.size; depth += 1) {
      const mirrors = await prisma.journalEntry.findMany({
        where: { OR: [...jeIds].map((id) => ({ metadata: { path: ['reversesEntryId'], equals: id } as never })) },
        select: { id: true },
      });
      mirrors.forEach((row) => jeIds.add(row.id));
    }
    const jeIdList = [...jeIds];

    if (branchId) await prisma.shopTender.deleteMany({ where: { branchId } });
    await prisma.contractCancellation.updateMany({ where: { contractId: { in: created.contracts } }, data: { reversalJournalEntryId: null } });
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });
    await prisma.salesCommission.deleteMany({ where: { OR: [{ saleId: { in: saleIds } }, { contractId: { in: created.contracts } }] } });
    await prisma.saleCostSnapshot.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contractCancellation.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.signature.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.creditApproval.deleteMany({ where: { customerId: { in: created.customers } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: created.customers } } });
    await prisma.kycVerification.deleteMany({ where: { contractId: { in: created.contracts } } });
    await prisma.contract.deleteMany({ where: { id: { in: created.contracts } } });
    await prisma.productReservation.deleteMany({ where: { productId: { in: products } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.pDPAConsent.deleteMany({ where: { customerId: { in: created.customers } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
    if (branchId) {
      try { await prisma.branch.delete({ where: { id: branchId } }); } catch { /* ถูกอ้างอิงจากแถวนอกขอบเขต — ปล่อยไว้ */ }
    }
    await prisma.$disconnect();
  }, 180_000);

  it('ขายสดจ่ายผสม: ลิ้นชักได้ 5,000 ธนาคารได้ 4,900 → ยกเลิกใบขาย → สุทธิ 0 และมีแถวเงินออกคู่กัน', async () => {
    const since = new Date();
    const phone = await seedPhone('S1');
    const customer = await seedCustomer('S1');
    const sale = await salesService.create({
      saleType: 'CASH', customerId: customer.id, productId: phone.id, branchId, sellingPrice: 9900, discount: 0,
      paymentMethod: 'CASH', previouslyDamagedAcknowledged: false,
      tenders: [{ method: 'CASH', amount: 5000 }, { method: 'BANK_TRANSFER', amount: 4900, reference: `TR${RUN}S1` }],
    } as never, adminId, 'OWNER', branchId);
    created.sales.push(sale.id);

    expect(await accountNetSince(TILL, since)).toBe('5000.00');
    expect(await accountNetSince(BANK, since)).toBe('4900.00');
    const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stored.paymentMethod).toBe('CASH'); // คอลัมน์เดิม = วิธีของบรรทัดแรก
    const inRows = await tendersOf({ saleId: sale.id });
    expect(inRows.map((t) => [t.direction, t.kind, t.method, t.amount.toFixed(2), t.reference, t.actorId, t.seq, t.seqTotal])).toEqual([
      ['IN', 'CASH_SALE', 'CASH', '5000.00', null, adminId, 1, 2],
      ['IN', 'CASH_SALE', 'BANK_TRANSFER', '4900.00', `TR${RUN}S1`, adminId, 2, 2],
    ]);

    await saleVoidService.voidSale(sale.id, { id: adminId, role: 'OWNER', branchId: null } as never, 'คีย์ผิดรุ่น ทดสอบจ่ายผสม');

    expect(await accountNetSince(TILL, since)).toBe('0.00');
    expect(await accountNetSince(BANK, since)).toBe('0.00');
    const all = await tendersOf({ saleId: sale.id });
    expect(all.filter((t) => t.direction === 'OUT').map((t) => [t.kind, t.method, t.amount.toFixed(2)])).toEqual([
      ['SALE_VOID_REFUND', 'CASH', '5000.00'],
      ['SALE_VOID_REFUND', 'BANK_TRANSFER', '4900.00'],
    ]);
    expect(await statusOfProduct(phone.id)).toBe('IN_STOCK');
  });

  it('โอน/QR ไม่มีเลขอ้างอิง และยอดรวมไม่ครบ ถูกปฏิเสธก่อนแตะสต๊อก', async () => {
    const phone = await seedPhone('S2');
    const customer = await seedCustomer('S2');
    const base = { saleType: 'CASH', customerId: customer.id, productId: phone.id, branchId, sellingPrice: 9900, discount: 0,
      paymentMethod: 'BANK_TRANSFER', previouslyDamagedAcknowledged: false };
    await expect(salesService.create(base as never, adminId, 'OWNER', branchId)).rejects.toThrow(/เลขอ้างอิง/);
    await expect(salesService.create({ ...base, tenders: [{ method: 'CASH', amount: 9500 }] } as never, adminId, 'OWNER', branchId))
      .rejects.toThrow(/ยังขาด 400/);
    expect(await statusOfProduct(phone.id)).toBe('IN_STOCK');
    expect(await prisma.shopTender.count({ where: { sale: { productId: phone.id } } })).toBe(0);
  });

  it('เงินดาวน์จ่ายผสม → ลบร่างสัญญา: ลิ้นชักและธนาคารกลับเป็น 0 (JE แยกยอดถูก mirror) + แถวเงินออก', async () => {
    const since = new Date();
    const { contract } = await seedDraftWithSplitDown('D1', { signed: false });
    expect(await accountNetSince(TILL, since)).toBe('2000.00');
    expect(await accountNetSince(BANK, since)).toBe('3000.00');

    await lifecycle.softDelete(contract.id, adminId);

    expect(await accountNetSince(TILL, since)).toBe('0.00');
    expect(await accountNetSince(BANK, since)).toBe('0.00');
    const out = (await tendersOf({ contractId: contract.id })).filter((t) => t.direction === 'OUT');
    expect(out.map((t) => [t.kind, t.method, t.amount.toFixed(2)])).toEqual([
      ['CONTRACT_DOWN_REFUND', 'CASH', '2000.00'],
      ['CONTRACT_DOWN_REFUND', 'QR_EWALLET', '3000.00'],
    ]);
  });

  it('เงินดาวน์จ่ายผสม → เปิดใช้ → ยกเลิกสัญญา: ไม่ชน cash tripwire และเงินดาวน์ยังอยู่ที่ลิ้นชัก/ธนาคารตามจริง', async () => {
    const since = new Date();
    const { contract } = await seedDraftWithSplitDown('A1', { signed: true });
    await workflow.activate(contract.id);

    // ค่าคอมพนักงานขาย (เจ้าของเคาะ 2026-09-20): เกิดตอนเปิดใช้สัญญา กติกาเดียวกับขายสด = อัตรา × ราคาขาย
    const rule = await prisma.commissionRule.findFirst({ where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    const rate = rule?.rate ? Number(rule.rate) : 0.03;
    const earned = await prisma.salesCommission.findMany({ where: { contractId: contract.id } });
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ status: 'PENDING', salespersonId: adminId, snapshotSalespersonId: adminId });
    expect(Number(earned[0].saleAmount)).toBe(15000);
    expect(Number(earned[0].commissionAmount)).toBeCloseTo(15000 * rate, 2);

    // เปิดใช้สัญญา = ระบบออกใบขาย INSTALLMENT ให้ และมันอยู่ในประวัติการขาย
    const activeSale = await prisma.sale.findFirstOrThrow({ where: { contractId: contract.id, deletedAt: null } });
    const owner = { id: adminId, role: 'OWNER' };
    expect((await salesService.findAll({ branchId }, owner)).data.map((row) => row.id)).toContain(activeSale.id);

    const request = await cancellations.requestCancellation(contract.id, adminId, 'ทดสอบยกเลิกสัญญาที่รับดาวน์จ่ายผสม', 0);
    await expect(cancellations.approveCancellation(request.id, adminId)).resolves.toBeDefined();

    // ยกเลิกสัญญา = การขายไม่เกิดขึ้น ⇒ ใบขายผ่อนถูกยกเลิกไปด้วยและหลุดจากประวัติการขาย (คำตัดสินเจ้าของ 2026-09-20)
    const voidedSale = await prisma.sale.findUniqueOrThrow({ where: { id: activeSale.id } });
    expect(voidedSale.deletedAt).not.toBeNull();
    expect(voidedSale.voidedById).toBe(adminId);
    expect(voidedSale.voidReason).toContain(contract.contractNumber);
    expect((await salesService.findAll({ branchId }, owner)).data.map((row) => row.id)).not.toContain(activeSale.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'contract', entityId: contract.id, action: 'CONTRACT_CANCELED' } });
    expect((audit.newValue as Record<string, unknown>).voidedSaleNumbers).toEqual([activeSale.saleNumber]);

    // JE ดาวน์จงใจไม่ถูก mirror ตอนยกเลิกสัญญา (S21-2001 ค้างรอคืนลูกค้า) ⇒ JE แยกยอดก็ต้องอยู่ครบเช่นกัน
    expect(await accountNetSince(TILL, since)).toBe('2000.00');
    expect(await accountNetSince(BANK, since)).toBe('3000.00');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe('CANCELED');
    // ยกเลิกสัญญา = เรียกคืนค่าคอมที่ยังไม่จ่าย
    const clawed = await prisma.salesCommission.findUniqueOrThrow({ where: { id: earned[0].id } });
    expect(clawed.status).toBe('CLAWED_BACK');
    expect(clawed.clawbackReason).toContain(contract.contractNumber);
  });

  it('cleanup ข้อมูลทดสอบ: ตามเจอ JE แยกยอดของสัญญาจาก tenderDocId + ใบกลับรายการ และลบแถวสมุดเงินได้ครบ', async () => {
    // JE แยกยอดของสัญญาไม่ stamp contractId ⇒ cleanup ที่ตามด้วย contractId มองไม่เห็น — helper นี้คือทางเดียวที่เจอ
    const { contract } = await seedDraftWithSplitDown('C1', { signed: false });
    const byContractId = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['contractId'], equals: contract.id } as never }, select: { metadata: true } });
    expect(byContractId.some((je) => (je.metadata as { flow?: string }).flow === 'shop-tender-split')).toBe(false);
    expect(await findTenderSplitEntries(prisma, [contract.id])).toHaveLength(1);

    await lifecycle.softDelete(contract.id, adminId); // คืนเงิน ⇒ mirror ของ JE แยกยอด + แถว OUT
    expect(await findTenderSplitEntries(prisma, [contract.id])).toHaveLength(2);

    const where = testTenderWhere([{ contractId: { in: [contract.id] } }]);
    expect(await countShopTenders(prisma, where)).toBe(4); // IN 2 + OUT 2
    expect(await deleteShopTenders(prisma, where)).toBe(4); // OUT ชี้ IN ผ่าน reversesTenderId (SET NULL) — ลบรวดเดียวได้
    expect(await countShopTenders(prisma, where)).toBe(0);
    expect(await countShopTenders(prisma, testTenderWhere([]))).toBe(0); // ไม่มีเงื่อนไข = ไม่แตะอะไรเลย (ไม่ใช่ลบทั้งตาราง)
    expect(await deleteShopTenders(prisma, testTenderWhere([]))).toBe(0);
  });

  it('หน้าสรุปเงินรายวันอ่านแถวของสาขานี้ได้: ยอดลิ้นชัก แยกพนักงาน และป้ายเลขอ้างอิงซ้ำ', async () => {
    // ใช้เลขอ้างอิงของใบขายเคสแรกซ้ำกับเงินดาวน์อีกสัญญา → ต้องขึ้นป้าย
    const phone = await seedPhone('R1');
    const customer = await seedCustomer('R1');
    const sale = await salesService.create({
      saleType: 'CASH', customerId: customer.id, productId: phone.id, branchId, sellingPrice: 9900, discount: 0,
      paymentMethod: 'BANK_TRANSFER', previouslyDamagedAcknowledged: false,
      tenders: [{ method: 'BANK_TRANSFER', amount: 9900, reference: `qr${RUN}d1`.toUpperCase() }],
    } as never, adminId, 'OWNER', branchId);
    created.sales.push(sale.id);

    const summary = await report.getDailySummary({ date: bangkokDateString(), branchId }, { id: adminId, role: 'OWNER', branchId: null });
    expect(summary.scope).toBe('ALL');
    expect(summary.rows.every((r) => r.branchId === branchId)).toBe(true);
    // เงินสดเข้า: 5,000 (S1) + 2,000 (D1) + 2,000 (A1) · เงินสดออก: 5,000 (void S1) + 2,000 (ลบร่าง D1)
    expect(summary.totals).toMatchObject({ cashIn: '9000.00', cashOut: '7000.00', expectedCashInDrawer: '2000.00' });
    expect(summary.byStaff).toHaveLength(1);
    expect(summary.byStaff[0]).toMatchObject({ actorId: adminId, netCash: '2000.00' });
    const flagged = summary.rows.filter((r) => r.duplicateReference).map((r) => r.docNumber);
    const { saleNumber } = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id }, select: { saleNumber: true } });
    expect(flagged).toEqual(expect.arrayContaining([saleNumber, `${PREFIX}${RUN}-D1`]));

    // พนักงานขายคนอื่นไม่เห็นแถวของ admin
    const other = await report.getDailySummary({ date: bangkokDateString() }, { id: '00000000-0000-0000-0000-000000000000', role: 'SALES', branchId });
    expect(other.rows).toEqual([]);
  });
});

async function statusOfProduct(id: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id } })).status;
}
