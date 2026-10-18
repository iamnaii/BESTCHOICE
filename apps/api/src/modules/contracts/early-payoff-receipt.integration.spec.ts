/**
 * ใบปิดยอดก่อนกำหนดเป็นใบกำกับภาษีตามบัญชี (ฝ่ายบัญชี 16/10/2569 ข้อ 16.1/16.2 · 18.1 · mockup เจ้าของเคาะ 18/10/2569):
 * ปิดยอดจริงบนฐานข้อมูล (1A → JP4) ด้วย ReceiptIssuanceService จริง → แถว Receipt ผูก JP4 และเก็บค่าตามบัญชี
 * (ฐาน 17,000 · ภาษี 1,190 · ส่วนลด = 52-1106) · invariant · metadata.receiptTax + บริบท 18.1 · payoffContext ของ PDF
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractPaymentService } from './contract-payment.service';
import { ProductsService } from '../products/products.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { ReceiptIssuanceService } from '../receipts/services/receipt-issuance.service';
import { ReceiptNumberService } from '../receipts/services/receipt-number.service';
import { ReceiptQueryService } from '../receipts/services/receipt-query.service';
import { parseReceiptTax } from '../journal/receipt-tax-breakdown';
import { earlyPayoffWithApproval } from '../../../e2e/helpers/payment-approval';

const prisma = new PrismaClient();
const money = (v: { toString(): string } | null | undefined) => new Decimal((v ?? 0).toString()).toFixed(2);

function buildService(): ContractPaymentService {
  const journal = new JournalAutoService(prisma as any);
  const vat60Reversal = new Vat60dayReversalTemplate(journal, prisma as any);
  const jp4 = new EarlyPayoffJP4Template(journal, prisma as any, vat60Reversal);
  const products = new ProductsService(prisma as any);
  const settlementTemplate = new ShopCollectSettlementTemplate(journal, prisma as any);
  const eclStageReverseTemplate = new EclStageReverseTemplate(journal, prisma as any);
  // ใบเสร็จจริง (ไม่มี LINE) — ContractPaymentService เรียก generateReceipt หลัง commit
  const issuance = new ReceiptIssuanceService(prisma as any, undefined, new ReceiptNumberService(prisma as any));
  return new ContractPaymentService(
    prisma as any,
    products,
    journal,
    jp4,
    settlementTemplate,
    issuance as any,
    eclStageReverseTemplate,
  );
}

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }
}

async function ensureAdminUser(): Promise<string> {
  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
  return admin.id;
}

/** วันครบกำหนดของงวด n: งวด ≤ dueCount อยู่ในอดีต (ถึงกำหนดแล้ว) · ที่เหลืออยู่ในอนาคต — ทั้งแถว Payment และตารางงวด (ตัวนับ 18.1 ตัวเดียวกัน) */
function dueDateFor(installmentNo: number, dueCount: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + (installmentNo - dueCount) * 30 - 15);
  return d;
}

async function seedPendingPayments(contractId: string, installmentCount: number, dueCount: number): Promise<void> {
  const installmentTotal = new Decimal('1515.83');
  for (let installmentNo = 1; installmentNo <= installmentCount; installmentNo++) {
    const dueDate = dueDateFor(installmentNo, dueCount);
    await prisma.payment.upsert({
      where: { contractId_installmentNo: { contractId, installmentNo } },
      create: { contractId, installmentNo, amountDue: installmentTotal, amountPaid: new Decimal('0'), dueDate, status: 'PENDING' },
      update: { amountDue: installmentTotal, amountPaid: new Decimal('0'), dueDate, status: 'PENDING' },
    });
    await prisma.installmentSchedule.updateMany({ where: { contractId, installmentNo }, data: { dueDate } });
  }
}

async function getEarlyPayoffJe(contractId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as any,
        { metadata: { path: ['flow'], equals: 'early-payoff' } } as any,
      ],
    },
    include: { lines: true },
  });
  expect(entries.length, 'expected exactly 1 early-payoff JE').toBe(1);
  return entries[0];
}

async function payoffFresh(userId: string, dueCount: number) {
  const c = await seedStandard17k12m(prisma);
  const journal = new JournalAutoService(prisma as any);
  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
  await seedPendingPayments(c.id, c.installmentCount, dueCount);
  const svc = buildService();
  const result = await earlyPayoffWithApproval(prisma, svc, c.id, userId, {
    paymentMethod: 'BANK_TRANSFER',
    discountPct: 50,
    depositAccountCode: '11-1201',
  } as any);
  const je = await getEarlyPayoffJe(c.id);
  const receipt = await prisma.receipt.findFirst({ where: { contractId: c.id, receiptType: 'EARLY_PAYOFF', deletedAt: null } });
  expect(receipt, 'EARLY_PAYOFF receipt should be issued').not.toBeNull();
  return { contract: c, result, je, receipt: receipt! };
}

describe('early-payoff receipt integration (ใบกำกับภาษีตามบัญชี 16.1/16.2)', () => {
  let userId: string;

  const cleanup = async () => {
    await prisma.receipt.deleteMany({});
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
  };

  beforeAll(async () => {
    await cleanup();
    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    userId = await ensureAdminUser();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('ไม่มีงวดถึงกำหนด (16.1): ใบผูก JP4 · ฐาน 17,000.00 · ภาษี 1,190.00 · ส่วนลด = Dr 52-1106 · ยอด = เงินที่รับ · invariant · stamp ตรงใบ', async () => {
    const { result, je, receipt } = await payoffFresh(userId, 0);

    expect(receipt.sourceJournalEntryId).toBe(je.id);
    expect(money(receipt.amountBeforeVat)).toBe('17000.00');
    expect(money(receipt.vatAmount)).toBe('1190.00');
    const discountLine = je.lines.find((l) => l.accountCode === '52-1106');
    expect(discountLine, 'JP4 ต้องมี Dr 52-1106').toBeDefined();
    expect(money(receipt.discountAmount)).toBe(money(discountLine!.debit));
    expect(new Decimal(money(receipt.discountAmount)).gt(0)).toBe(true);
    expect(money(receipt.amount)).toBe(money(result.totalPayoff));
    expect([money(receipt.advanceAmount), money(receipt.advanceVatAmount), money(receipt.lateFeeAmount)]).toEqual(['0.00', '0.00', '0.00']);
    const identity = new Decimal(money(receipt.amountBeforeVat))
      .plus(money(receipt.vatAmount))
      .plus(money(receipt.roundingAmount))
      .plus(money(receipt.lateFeeAmount))
      .minus(money(receipt.discountAmount));
    expect(identity.toFixed(2)).toBe(money(receipt.amount));

    const meta = je.metadata as Record<string, unknown>;
    expect(parseReceiptTax(meta.receiptTax)?.amount).toBe(money(receipt.amount));
    expect(meta).toMatchObject({ dueMonths: 0, notDueMonths: 12, firstUnpaidInstallmentNo: 1, lastUnpaidInstallmentNo: 12 });

    const view = await new ReceiptQueryService(prisma as any).getReceipt(receipt.id);
    expect(view.payoffContext).toMatchObject({
      unpaidInstallments: 12,
      firstNo: 1,
      lastNo: 12,
      receivableCleared: '18190.00',
      dueMonths: 0,
      notDueMonths: 12,
      discountPct: 50,
      parkReceiptNumber: null,
    });
  });

  it('ถึงกำหนดแล้ว 4 จาก 12 งวด (18.1): ส่วนลดเล็กลงแต่ภาษีบนใบยัง 1,190.00 · metadata dueMonths 4 · payoffContext บอกงวด', async () => {
    const { je, receipt } = await payoffFresh(userId, 4);

    expect(money(receipt.vatAmount)).toBe('1190.00');
    expect(money(receipt.amountBeforeVat)).toBe('17000.00');
    const discountLine = je.lines.find((l) => l.accountCode === '52-1106');
    expect(money(receipt.discountAmount)).toBe(money(discountLine!.debit));
    const meta = je.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ dueMonths: 4, notDueMonths: 8 });
    const view = await new ReceiptQueryService(prisma as any).getReceipt(receipt.id);
    expect(view.payoffContext).toMatchObject({ dueMonths: 4, notDueMonths: 8, firstNo: 1, lastNo: 12 });
  });
});
