/**
 * Task 2 integration test — refund payout (Dr 21-1107 / Cr cash)
 *
 * เงินคืนส่วนต่างลูกค้า (คำสั่งเจ้าของ 2026-08-08 ข้อ 2): JP5 ตั้งหนี้ Cr 21-1107
 * ณ วันยึดเมื่อ customerRefund > 0 — RefundPayoutTemplate ล้างหนี้นั้นตอนจ่ายจริง
 * ผ่าน Dr 21-1107 / Cr depositAccountCode. 21-1107 เป็นบัญชีเจ้าหนี้ (credit-normal)
 * — ตรงข้ามกับ 11-2107 (ลูกหนี้-หน้าร้าน, debit-normal) ที่ ShopCollectSettlementTemplate
 * ล้างอยู่แล้ว — โครง/idempotency/guard ก๊อปมาจากไฟล์นั้นแล้วสลับทิศทาง Dr/Cr +
 * accountCode (ดู doc comment บน RefundPayoutTemplate สำหรับรายละเอียด race
 * handling ที่พิสูจน์แล้วที่ ShopCollectSettlementTemplate — race 2-connection
 * ไม่ต้อง reproduce ซ้ำที่นี่).
 *
 * Runner: vitest (DB-backed, *.integration.spec.ts is jest-ignored)
 * Run:    cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/refund-payout.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { RepossessionJP5Template } from '../journal/cpa-templates/repossession-jp5.template';
import { RefundPayoutTemplate } from '../journal/cpa-templates/refund-payout.template';
import { RefundWaiveTemplate } from '../journal/cpa-templates/refund-waive.template';

const prisma = new PrismaClient();

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

/**
 * Compute the net 21-1107 balance (ΣCr − ΣDr — credit-normal liability) over
 * all POSTED journal lines whose parent JE has metadata.contractId === contractId.
 */
async function getNet21_1107(contractId: string): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountCode: '21-1107',
      journalEntry: {
        AND: [
          { metadata: { path: ['contractId'], equals: contractId } } as any,
          { status: 'POSTED' },
          { deletedAt: null },
        ],
      },
    },
    select: { debit: true, credit: true },
  });
  const totalDr = lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
  const totalCr = lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
  return totalCr.minus(totalDr);
}

/** Seed a contract + JP5 with customerRefund → creates a genuine Cr 21-1107 balance. */
async function seedRefundableRepossession(
  journal: JournalAutoService,
  refundAmount: string,
): Promise<{ contractId: string }> {
  const c = await seedStandard17k12m(prisma);
  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

  const jp5 = new RepossessionJP5Template(journal, prisma as any);
  // No accrual — gain branch (repossessionValue 20,000 vs remainingTotal
  // 18,190.00 → gain 1,810.00 before refund). Any customerRefund <= 1,810.00
  // is safely absorbed by the loss/gain plug without flipping to a loss line
  // (see jp5-vat-split.spec.ts "JP5 customerRefund" describe block for the
  // exact math this mirrors).
  await jp5.execute({
    contractId: c.id,
    depositAccountCode: '11-1101',
    repossessionValue: new Decimal('20000.00'),
    customerRefund: new Decimal(refundAmount),
  });

  return { contractId: c.id };
}

describe('refund-payout integration', () => {
  let journal: JournalAutoService;
  let refundTemplate: RefundPayoutTemplate;

  afterAll(async () => {
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries —
    // clear them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    journal = new JournalAutoService(prisma as any);
    refundTemplate = new RefundPayoutTemplate(journal, prisma as any);
  });

  it('FULL PAYOUT: Dr 21-1107 / Cr 11-1201 zeroes the refund payable balance', async () => {
    const { contractId } = await seedRefundableRepossession(journal, '1810.00');

    const balanceBefore = await getNet21_1107(contractId);
    expect(balanceBefore.toFixed(2)).toBe('1810.00');

    const result = await refundTemplate.execute({
      contractId,
      depositAccountCode: '11-1201',
      amount: balanceBefore.toNumber(),
    });
    expect(result.deduped).toBe(false);

    const balanceAfter = await getNet21_1107(contractId);
    expect(
      balanceAfter.abs().lte('0.01'),
      `Expected net 21-1107 ≈ 0 after payout, got ${balanceAfter.toFixed(2)}`,
    ).toBe(true);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'refund-payout' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(je, 'Expected refund-payout JE to be created').not.toBeNull();

    const drLine = je!.lines.find(
      (l) => l.accountCode === '21-1107' && new Decimal(l.debit.toString()).gt(0),
    );
    expect(drLine, 'Expected Dr 21-1107 line').toBeDefined();

    const crLine = je!.lines.find(
      (l) => l.accountCode === '11-1201' && new Decimal(l.credit.toString()).gt(0),
    );
    expect(crLine, 'Expected Cr 11-1201 line').toBeDefined();

    const totalDr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(totalDr.minus(totalCr).abs().lte('0.01'), 'Refund payout JE must be balanced').toBe(true);
  });

  it('OVER-PAY GUARD: amount > outstanding + 0.01 → BadRequestException', async () => {
    const { contractId } = await seedRefundableRepossession(journal, '1000.00');

    const outstanding = await getNet21_1107(contractId);
    const overAmount = outstanding.plus('100').toNumber();

    await expect(
      refundTemplate.execute({
        contractId,
        depositAccountCode: '11-1201',
        amount: overAmount,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('NO-BALANCE GUARD: contract with no 21-1107 balance → BadRequestException', async () => {
    // Repossess WITHOUT customerRefund — no Cr 21-1107 line is ever created.
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    await expect(
      refundTemplate.execute({
        contractId: c.id,
        depositAccountCode: '11-1201',
        amount: 100,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('PARTIAL PAYOUT: two partial payouts each post a balanced Dr 21-1107 / Cr cash JE and net 21-1107 ends at 0', async () => {
    const { contractId } = await seedRefundableRepossession(journal, '1800.00');

    const outstanding = await getNet21_1107(contractId);
    const amountA = outstanding.div(3).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const amountB = outstanding.minus(amountA);

    await refundTemplate.execute({
      contractId,
      depositAccountCode: '11-1201',
      amount: amountA.toNumber(),
    });
    const midBalance = await getNet21_1107(contractId);
    expect(midBalance.minus(amountB).abs().lte('0.01')).toBe(true);

    await refundTemplate.execute({
      contractId,
      depositAccountCode: '11-1201',
      amount: amountB.toNumber(),
    });
    const finalBalance = await getNet21_1107(contractId);
    expect(finalBalance.abs().lte('0.01')).toBe(true);
  });

  it('requestId เดิมซ้ำ → JE เดียว (retry ปลอดภัย แม้หลังยอดถูกล้างหมดแล้ว)', async () => {
    const { contractId } = await seedRefundableRepossession(journal, '900.00');
    const outstanding = await getNet21_1107(contractId);
    const requestId = '66666666-6666-4666-8666-666666666666';

    const r1 = await refundTemplate.execute({
      contractId,
      depositAccountCode: '11-1201',
      amount: outstanding.toNumber(),
      requestId,
    });
    const r2 = await refundTemplate.execute({
      contractId,
      depositAccountCode: '11-1201',
      amount: outstanding.toNumber(),
      requestId,
    });

    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    expect(r2.entryNo).toBe(r1.entryNo);

    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'refund-payout' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(1);
  });

  it('requestId เดิมซ้ำแต่ยอดเปลี่ยน → ConflictException (ห้ามกลืนเงียบ ยอดใหม่ต้องไม่หาย)', async () => {
    const { contractId } = await seedRefundableRepossession(journal, '1200.00');
    const outstanding = await getNet21_1107(contractId);
    const requestId = '77777777-7777-4777-8777-777777777777';

    const firstAmount = outstanding.div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    await refundTemplate.execute({
      contractId,
      depositAccountCode: '11-1201',
      amount: firstAmount.toNumber(),
      requestId,
    });

    const secondAmount = outstanding.minus(firstAmount).minus('1');
    expect(secondAmount.gt(0)).toBe(true);

    await expect(
      refundTemplate.execute({
        contractId,
        depositAccountCode: '11-1201',
        amount: secondAmount.toNumber(),
        requestId,
      }),
    ).rejects.toThrow(ConflictException);

    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'refund-payout' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // refund-waive — คำสั่งเจ้าของ 2026-08-08 เพิ่มเติม: ล้างยอด 21-1107 คงเหลือ
  // ทั้งหมดเข้ารายได้จากการยึด (41-1102) เมื่อตัดสินใจ "ไม่คืนเงิน". ไม่มี amount
  // input — เคลียร์ทั้งยอดคงเหลือเสมอ.
  // ──────────────────────────────────────────────────────────────────────────
  describe('refund-waive', () => {
    let waiveTemplate: RefundWaiveTemplate;

    beforeAll(() => {
      waiveTemplate = new RefundWaiveTemplate(journal, prisma as any);
    });

    async function getWaiveJe(contractId: string) {
      return prisma.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'refund-waive' } } as any,
            { metadata: { path: ['contractId'], equals: contractId } } as any,
          ],
          deletedAt: null,
        },
        include: { lines: true },
      });
    }

    it('FULL WAIVE: JP5 with refund → waive zeroes 21-1107 and credits 41-1102 exactly the refund', async () => {
      const { contractId } = await seedRefundableRepossession(journal, '1810.00');

      const outstanding = await getNet21_1107(contractId);
      expect(outstanding.toFixed(2)).toBe('1810.00');

      const result = await waiveTemplate.execute({ contractId });
      expect(result.deduped).toBe(false);
      expect(result.waivedAmount).toBe('1810.00');

      const balanceAfter = await getNet21_1107(contractId);
      expect(
        balanceAfter.abs().lte('0.01'),
        `Expected net 21-1107 ≈ 0 after waive, got ${balanceAfter.toFixed(2)}`,
      ).toBe(true);

      const je = await getWaiveJe(contractId);
      expect(je, 'Expected refund-waive JE to be created').not.toBeNull();

      const drLine = je!.lines.find(
        (l) => l.accountCode === '21-1107' && new Decimal(l.debit.toString()).gt(0),
      );
      expect(drLine, 'Expected Dr 21-1107 line').toBeDefined();
      expect(new Decimal(drLine!.debit.toString()).toFixed(2)).toBe('1810.00');

      const crLine = je!.lines.find(
        (l) => l.accountCode === '41-1102' && new Decimal(l.credit.toString()).gt(0),
      );
      expect(crLine, 'Expected Cr 41-1102 line').toBeDefined();
      expect(new Decimal(crLine!.credit.toString()).toFixed(2)).toBe('1810.00');

      const totalDr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
      const totalCr = je!.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
      expect(totalDr.minus(totalCr).abs().lte('0.01'), 'Refund waive JE must be balanced').toBe(true);
    });

    it('PARTIAL PAYOUT THEN WAIVE: waive clears only the remainder into 41-1102', async () => {
      const { contractId } = await seedRefundableRepossession(journal, '1800.00');
      const outstanding = await getNet21_1107(contractId);
      const payoutAmount = outstanding.div(3).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const remainder = outstanding.minus(payoutAmount);

      await refundTemplate.execute({
        contractId,
        depositAccountCode: '11-1201',
        amount: payoutAmount.toNumber(),
      });
      const midBalance = await getNet21_1107(contractId);
      expect(midBalance.minus(remainder).abs().lte('0.01')).toBe(true);

      const result = await waiveTemplate.execute({ contractId });
      expect(result.waivedAmount).toBe(remainder.toFixed(2));

      const finalBalance = await getNet21_1107(contractId);
      expect(finalBalance.abs().lte('0.01')).toBe(true);

      const je = await getWaiveJe(contractId);
      const crLine = je!.lines.find(
        (l) => l.accountCode === '41-1102' && new Decimal(l.credit.toString()).gt(0),
      );
      expect(new Decimal(crLine!.credit.toString()).toFixed(2)).toBe(remainder.toFixed(2));
    });

    it('NO-BALANCE GUARD: waive after outstanding already fully paid out → BadRequestException', async () => {
      const { contractId } = await seedRefundableRepossession(journal, '900.00');
      const outstanding = await getNet21_1107(contractId);

      await refundTemplate.execute({
        contractId,
        depositAccountCode: '11-1201',
        amount: outstanding.toNumber(),
      });

      await expect(waiveTemplate.execute({ contractId })).rejects.toThrow(BadRequestException);
    });

    it('requestId เดิมซ้ำ → JE เดียว (retry ปลอดภัย, deduped:true ครั้งที่สอง)', async () => {
      const { contractId } = await seedRefundableRepossession(journal, '1500.00');
      const requestId = '88888888-8888-4888-8888-888888888888';

      const r1 = await waiveTemplate.execute({ contractId, requestId });
      const r2 = await waiveTemplate.execute({ contractId, requestId });

      expect(r1.deduped).toBe(false);
      expect(r2.deduped).toBe(true);
      expect(r2.entryNo).toBe(r1.entryNo);
      expect(r2.waivedAmount).toBe(r1.waivedAmount);

      const jes = await prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'refund-waive' } } as any,
            { metadata: { path: ['contractId'], equals: contractId } } as any,
          ],
          deletedAt: null,
        },
      });
      expect(jes).toHaveLength(1);
    });
  });
});
