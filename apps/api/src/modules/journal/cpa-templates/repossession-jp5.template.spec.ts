import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { BadRequestException } from '@nestjs/common';
import { RepossessionJP5Template } from './repossession-jp5.template';
import { ShopCollectSettlementTemplate } from './shop-collect-settlement.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
  // them first or this deleteMany trips P2003 when an asset spec ran earlier.
  await prisma.journalPostAuditLog.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  // NOT wiped: badDebtWriteOffAuditLog is immutable (DB trigger, T1-C7) —
  // deleteMany({}) throws once any row exists (see cn-issue-on-writeoff.spec.ts).
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
  // contract written off via the real writeOffBadDebt() has a permanent
  // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
  await seedFinanceCoa(prisma);

  const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
  if (!exists) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

/**
 * PR-843/I2 Phase 5d — the legacy PaymentReceipt2BTemplate was deleted. This
 * reproduces its full-clear posting for one installment directly: creates the
 * PAID Payment row (which the JP5 flow reads to determine the unpaid/accrued
 * count) and posts Dr deposit / Cr 11-2103 for installmentTotal (mirrors what
 * the new primitive would post). The JP5 golden assertions only diff the
 * repossession JE's own lines and depend on the paid/unpaid state, so they are
 * unchanged.
 */
async function postPriorReceipt(
  journal: JournalAutoService,
  contractId: string,
  inst: { id: string; installmentNo: number; dueDate: Date },
): Promise<void> {
  const installmentTotal = new Decimal('1515.83');
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const payment = await prisma.payment.create({
    data: {
      contractId,
      installmentNo: inst.installmentNo,
      dueDate: inst.dueDate,
      amountDue: installmentTotal,
      amountPaid: installmentTotal,
      paidDate: new Date(),
      paidAt: new Date(),
      status: 'PAID',
    },
  });
  await journal.createAndPost({
    description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${contract.contractNumber}`,
    reference: payment.id,
    metadata: {
      tag: 'receipt',
      contractId,
      installmentScheduleId: inst.id,
      paymentId: payment.id,
    },
    lines: [
      { accountCode: '11-1101', dr: installmentTotal, cr: new Decimal(0), description: 'รับเงิน' },
      {
        accountCode: '11-2103',
        dr: new Decimal(0),
        cr: installmentTotal,
        description: 'ล้างลูกหนี้ค้างชำระ',
      },
    ],
  });
}

describe('RepossessionJP5Template', () => {
  // (2026-07-03, #1333) Straight-line ตามงวด is the ruled treatment — the Phase 4
  // "EIR migration" regenerated this CSV to EIR (3,012.50) but production never
  // switched: the 2A cron accrues 500/งวด straight-line, so remaining deferred
  // interest for periods 5..12 = 500×8 = 4,000. First-ever CI run of this suite
  // (PR #1330) surfaced the divergence; owner ruled straight-line and the CSV
  // was restored. If CPA later mandates EIR, that is a production change
  // (2A cron + JP4 + JP5), not a fixture edit.
  it('CSV golden case — straight-line allocation matches fixture (#1333)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pay 4 installments
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (let i = 0; i < 4; i++) {
      await accrual.execute(insts[i].id);
      await postPriorReceipt(journal, c.id, insts[i]);
    }

    // Repossession with value 7000 (loss scenario)
    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('7000.00'),
    });

    // Load golden fixture and find the close-out block (tag "3" containing 51-1102)
    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-5-repossession.csv'),
    );
    const closeoutBlock = expected.entries.find((e) =>
      e.lines.some((l) => l.code === '51-1102' && new Decimal(l.dr).gt(0)),
    );
    expect(closeoutBlock, 'closeout block with 51-1102 Dr not found in CSV').toBeDefined();

    // Find the repossession JE posted
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['flow'], equals: 'repossession' } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);

    const actual = [
      {
        tag: closeoutBlock!.tag,
        lines: entries[0].lines.map((l) => ({
          code: l.accountCode,
          dr: new Decimal(l.debit.toString()),
          cr: new Decimal(l.credit.toString()),
        })),
      },
    ];

    const diff = diffGoldenJE([closeoutBlock!], actual);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('uses 41-1102 (gain) when repossessionValue > remainingTotal', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    // repossessionValue 20000 >> remainingTotal (~18k) → gain path
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('20000.00'),
    });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      include: { lines: true },
    });

    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);

    const gain = entries[0].lines.find((l) => l.accountCode === '41-1102');
    expect(gain, '41-1102 gain line should exist').toBeDefined();
    expect(new Decimal(gain!.credit.toString()).gt(0), '41-1102 credit should be positive').toBe(
      true,
    );

    const loss = entries[0].lines.find((l) => l.accountCode === '51-1102');
    expect(loss, '51-1102 loss line should not exist in gain path').toBeUndefined();
  });

  it('shop-collect (2026-07-08): deposit leg lands on 11-2107, metadata stamped, and the generic settlement clears it', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    // Caller (repossessions.service) substitutes depositAccountCode='11-2107'
    // when collectedByShop — mirror that contract here.
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-2107',
      repossessionValue: new Decimal('7000.00'),
      collectedByShop: true,
    });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      include: { lines: true },
    });
    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);

    // Deposit leg parked as shop receivable — NOT a cash account.
    const shopLeg = entries[0].lines.find((l) => l.accountCode === '11-2107');
    expect(shopLeg, 'Dr 11-2107 leg should exist').toBeDefined();
    expect(new Decimal(shopLeg!.debit.toString()).toFixed(2)).toBe('7000.00');

    // Metadata pairs the JE with its later settlement (same convention as JP4).
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.collectedByShop).toBe(true);
    expect(meta.shopReceivable).toBe('11-2107');
    expect(meta.contractId).toBe(c.id);

    // The generic settlement (sums 11-2107 by metadata.contractId) must find
    // and clear the JP5-originated receivable — Dr KBank / Cr 11-2107.
    const settlement = new ShopCollectSettlementTemplate(journal, prisma as any);
    await settlement.execute({
      contractId: c.id,
      depositAccountCode: '11-1201',
      amount: new Decimal('7000.00'),
    });

    const lines = await prisma.journalLine.findMany({
      where: {
        accountCode: '11-2107',
        journalEntry: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } } as any,
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      },
      select: { debit: true, credit: true },
    });
    const outstanding = lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())).minus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(outstanding.toFixed(2), '11-2107 fully cleared after settlement').toBe('0.00');

    // Second settlement on the same contract must be rejected (nothing left).
    await expect(
      settlement.execute({
        contractId: c.id,
        depositAccountCode: '11-1201',
        amount: new Decimal('1.00'),
      }),
    ).rejects.toThrow(/ไม่มียอด 11-2107/);
  });

  /**
   * finding C-3 — ถังพักงวดสุดท้าย (21-1103) ตอนยึดคืน.
   *
   * `computePayoffQuote` หักถังพักออกจากยอดปิดให้ลูกค้าแล้ว (ทั้ง JP4 และ JP5 ใช้
   * ฟังก์ชันเดียวกัน) แต่ JP5 เดิมไม่มีขา 21-1103 เลย → เครดิตผีค้างบนสัญญาที่ยึด
   * ไปแล้ว และ plug ขาดทุน/กำไรบวมเกินจริงเท่ายอดถังพัก.
   *
   * ขา `Dr 21-1103` ถูกวาง **ก่อน** คำนวณ plug (pattern เดียวกับ customerRefund /
   * 21-1107) → plug ดูดซับให้เอง: ขาดทุนลด/กำไรเพิ่มเท่ายอดปลดหนี้พอดี ไม่มีสูตรใหม่.
   */
  describe('park relief (Dr 21-1103 · ถังพักงวดสุดท้าย · owner 2026-08-16)', () => {
    /** JE จำลอง 6a: Dr เงินสด / Cr 21-1103 — เครดิตเข้าถังพักบนสัญญานี้ */
    async function seedParkCredit(
      journal: JournalAutoService,
      contractId: string,
      amount: Decimal,
    ): Promise<void> {
      await prisma.contract.update({
        where: { id: contractId },
        data: { rescheduleAdvanceBalance: amount },
      });
      await journal.createAndPost({
        description: 'ค่าธรรมเนียมปรับดิว (6a) — พักงวดสุดท้าย',
        reference: `${contractId}:reschedule-fee`,
        metadata: { tag: '6a', flow: 'reschedule-fee', contractId },
        lines: [
          {
            accountCode: '11-1101',
            dr: amount,
            cr: new Decimal(0),
            description: 'รับค่าธรรมเนียม',
          },
          {
            accountCode: '21-1103',
            dr: new Decimal(0),
            cr: amount,
            description: 'เงินรับล่วงหน้างวดสุดท้าย',
          },
        ],
      });
    }

    async function jp5LinesFor(contractId: string) {
      const entries = await prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['contractId'], equals: contractId } } as any,
            { metadata: { path: ['flow'], equals: 'repossession' } } as any,
          ],
        },
        include: { lines: true },
      });
      expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);
      const lines = entries[0].lines.map((l) => ({
        code: l.accountCode,
        dr: new Decimal(l.debit.toString()),
        cr: new Decimal(l.credit.toString()),
      }));
      return { entry: entries[0], lines };
    }

    it('ขาดทุน (loss branch): plug 51-1102 ลดลงเท่ายอดปลดหนี้ 354.00 เป๊ะ ๆ · Dr 21-1103 ปรากฏ · JE ยัง balanced', async () => {
      const journal = await setup();
      const tmpl = new RepossessionJP5Template(journal, prisma as any);
      const activation = new ContractActivation1ATemplate(journal, prisma as any);

      // A) ไม่มีถังพัก — baseline
      const noPark = await seedStandard17k12m(prisma);
      await activation.execute(noPark.id);
      await tmpl.execute({
        contractId: noPark.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('7000.00'),
      });
      const a = await jp5LinesFor(noPark.id);
      const lossA = a.lines.find((l) => l.code === '51-1102')!.dr;
      expect(
        a.lines.find((l) => l.code === '21-1103'),
        'ไม่มีถังพัก → ห้ามมีขา 21-1103',
      ).toBe(undefined);

      // B) ถังพัก 354 — สัญญาแยกใบ ข้อมูลอื่นเหมือนกันทุกอย่าง
      const withPark = await seedStandard17k12m(prisma);
      await activation.execute(withPark.id);
      await seedParkCredit(journal, withPark.id, new Decimal('354.00'));
      const res = await tmpl.execute({
        contractId: withPark.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('7000.00'),
        parkRelief: new Decimal('354.00'),
      });
      const b = await jp5LinesFor(withPark.id);

      const park = b.lines.find((l) => l.code === '21-1103');
      expect(park, 'ต้องมีขา Dr 21-1103').toBeDefined();
      expect(park!.dr.toFixed(2)).toBe('354.00');
      expect(park!.cr.toFixed(2)).toBe('0.00');
      expect(res.parkRelief.toFixed(2)).toBe('354.00');
      expect((b.entry.metadata as Record<string, unknown>).parkRelief).toBe('354.00');

      // plug ดูดซับเอง: ขาดทุนลดลงเท่ายอดปลดหนี้พอดี (ไม่ใช่สูตรแยก)
      const lossB = b.lines.find((l) => l.code === '51-1102')!.dr;
      expect(lossA.minus(lossB).toFixed(2)).toBe('354.00');

      // ขาอื่นทุกขาต้องเท่าเดิมทุกบาท — ที่ขยับมีแค่ 21-1103 (ใหม่) กับ 51-1102 (plug)
      const sig = (lines: typeof a.lines) =>
        lines
          .filter((l) => l.code !== '21-1103' && l.code !== '51-1102')
          .map((l) => `${l.code}:${l.dr.toFixed(2)}/${l.cr.toFixed(2)}`)
          .sort();
      expect(sig(b.lines)).toEqual(sig(a.lines));

      const drB = b.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
      const crB = b.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
      expect(drB.toFixed(2)).toBe(crB.toFixed(2));

      // 21-1103 ของสัญญานี้ต้องกลับมาเป็น 0 (เครดิต 354 ถูกปลดครบ)
      const remaining = await prisma.journalLine.findMany({
        where: {
          accountCode: '21-1103',
          journalEntry: {
            metadata: { path: ['contractId'], equals: withPark.id },
            status: 'POSTED',
            deletedAt: null,
          },
        },
        select: { debit: true, credit: true },
      });
      const bal = remaining.reduce(
        (s, l) => s.plus(l.credit.toString()).minus(l.debit.toString()),
        new Decimal(0),
      );
      expect(bal.toFixed(2), '21-1103 ของสัญญานี้ต้องถูกล้างหมด').toBe('0.00');
    });

    it('กำไร (gain branch): plug 41-1102 เพิ่มขึ้นเท่ายอดปลดหนี้เป๊ะ ๆ', async () => {
      const journal = await setup();
      const tmpl = new RepossessionJP5Template(journal, prisma as any);
      const activation = new ContractActivation1ATemplate(journal, prisma as any);

      const noPark = await seedStandard17k12m(prisma);
      await activation.execute(noPark.id);
      await tmpl.execute({
        contractId: noPark.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('20000.00'),
      });
      const gainA = (await jp5LinesFor(noPark.id)).lines.find((l) => l.code === '41-1102')!.cr;

      const withPark = await seedStandard17k12m(prisma);
      await activation.execute(withPark.id);
      await seedParkCredit(journal, withPark.id, new Decimal('354.00'));
      await tmpl.execute({
        contractId: withPark.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('20000.00'),
        parkRelief: new Decimal('354.00'),
      });
      const b = await jp5LinesFor(withPark.id);
      const gainB = b.lines.find((l) => l.code === '41-1102')!.cr;

      expect(gainB.minus(gainA).toFixed(2)).toBe('354.00');
      expect(b.lines.find((l) => l.code === '21-1103')!.dr.toFixed(2)).toBe('354.00');
      const dr = b.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
      const cr = b.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
      expect(dr.toFixed(2)).toBe(cr.toFixed(2));
    });

    it('clamp ด้วยยอด GL 21-1103 จริง — ขอปลด 900 แต่มีเครดิตจริง 354 → ปลดได้ 354 ห้ามดัน 21-1103 ติดลบ', async () => {
      const journal = await setup();
      const c = await seedStandard17k12m(prisma);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
      await seedParkCredit(journal, c.id, new Decimal('354.00'));

      const res = await new RepossessionJP5Template(journal, prisma as any).execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('7000.00'),
        parkRelief: new Decimal('900.00'),
      });

      expect(res.parkRelief.toFixed(2), 'clamp ที่ยอด GL จริง').toBe('354.00');
      const b = await jp5LinesFor(c.id);
      expect(b.lines.find((l) => l.code === '21-1103')!.dr.toFixed(2)).toBe('354.00');
    });

    it('parkRelief 0 / ไม่ส่ง → ไม่มีขา 21-1103 และ metadata ไม่มี parkRelief (JE เดิมไม่ขยับ)', async () => {
      const journal = await setup();
      const c = await seedStandard17k12m(prisma);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
      await seedParkCredit(journal, c.id, new Decimal('354.00'));

      const res = await new RepossessionJP5Template(journal, prisma as any).execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('7000.00'),
        parkRelief: new Decimal('0'),
      });

      expect(res.parkRelief.toFixed(2)).toBe('0.00');
      const b = await jp5LinesFor(c.id);
      expect(b.lines.find((l) => l.code === '21-1103')).toBeUndefined();
      expect((b.entry.metadata as Record<string, unknown>).parkRelief).toBeUndefined();
    });
  });

  it('throws when no unpaid installments remain', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Mark all installments as PAID
    const allInsts = await prisma.installmentSchedule.findMany({ where: { contractId: c.id } });
    for (const inst of allInsts) {
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          dueDate: inst.dueDate,
          amountDue: new Decimal('1515.83'),
          amountPaid: new Decimal('1515.83'),
          paidDate: new Date(),
          paidAt: new Date(),
          status: 'PAID',
        },
      });
    }

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    const exec = tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('7000.00'),
    });
    // Must be a 400 BadRequestException (Thai message), never a raw Error →
    // the controller would otherwise surface it as 500 INTERNAL_ERROR.
    await expect(exec).rejects.toThrow(BadRequestException);
    await expect(
      tmpl.execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('7000.00'),
      }),
    ).rejects.toThrow(/nothing to repossess/i);
  });
});
