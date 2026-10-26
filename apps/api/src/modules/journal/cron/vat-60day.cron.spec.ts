import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../cpa-templates/contract-activation-1a.template';
import { Vat60dayMandatoryTemplate } from '../cpa-templates/vat-60day-mandatory.template';
import { Vat60dayCron } from './vat-60day.cron';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { InstallmentAccrualCron } from './installment-accrual.cron';
import { JournalAutoService } from '../journal-auto.service';
import { Decimal } from '@prisma/client/runtime/library';

/** Σ(เครดิต − เดบิต) ของบัญชีหนึ่งเฉพาะรายการ POSTED ที่ stamp `metadata.contractId` = สัญญานั้น */
async function contractNet(contractId: string, accountCode: string): Promise<string> {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountCode,
      deletedAt: null,
      journalEntry: {
        status: 'POSTED',
        deletedAt: null,
        metadata: { path: ['contractId'], equals: contractId },
      },
    },
    select: { debit: true, credit: true },
  });
  return lines
    .reduce((acc, l) => acc.add(new Decimal(l.credit.toString())).sub(new Decimal(l.debit.toString())), new Decimal(0))
    .toFixed(2);
}

const prisma = new PrismaClient();
const DAYS_70_AGO = () => new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
const NEXT_YEAR = () => new Date(Date.now() + 365 * 86_400_000);

/**
 * ฝ่ายบัญชี 16/10/2569 ข้อ 11.1 / 11.2 — รอบภาษีขาย 60 วันต้องข้าม (ก) งวดที่ตั้งลูกหนี้งวด (21-2101) แล้ว
 * (ข) สัญญาที่ยึดคืน/ปิดไปแล้ว — คัดออกตั้งแต่ตัวเลือกผู้สมัคร ไม่ใช่พึ่ง template อย่างเดียว
 */
describe('Vat60dayCron', () => {
  beforeAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.receipt.deleteMany({});
    await prisma.eDocument.deleteMany({});
    await prisma.signature.deleteMany({});
    await prisma.contractDocument.deleteMany({});
    await prisma.partialPaymentLink.deleteMany({});
    await prisma.warrantyAuditLog.deleteMany({});
    await prisma.promiseSlot.deleteMany({});
    await prisma.callLog.deleteMany({});
    await prisma.dunningAction.deleteMany({});
    await prisma.repossession.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({
      where: { contractNumber: { startsWith: 'TEST-' }, id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });
    await seedFinanceCoa(prisma);
    const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
    if (!exists) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
  });

  it('ตั้งเฉพาะงวดที่ยังไม่ได้ตั้ง 21-2101 ของสัญญาที่ยังเดินอยู่ — ข้ามงวดที่ตั้งลูกหนี้แล้วและสัญญาที่ปิด/ยึด', async () => {
    const journal = new JournalAutoService(prisma as any);
    const oneA = new ContractActivation1ATemplate(journal, prisma as any);

    // สัญญา A (ACTIVE): งวด 1 เกิน 60 วัน ยังไม่ตั้งลูกหนี้งวด → ต้องตั้ง · งวด 2 เกิน 60 วัน ตั้งลูกหนี้งวดแล้ว → ข้าม
    const a = await seedStandard17k12m(prisma);
    await oneA.execute(a.id);
    await prisma.installmentSchedule.updateMany({
      where: { contractId: a.id },
      data: { dueDate: NEXT_YEAR() },
    });
    const a1 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: a.id, installmentNo: 1 } });
    const a2 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: a.id, installmentNo: 2 } });
    await prisma.installmentSchedule.update({ where: { id: a1.id }, data: { dueDate: DAYS_70_AGO() } });
    await prisma.installmentSchedule.update({
      where: { id: a2.id },
      data: { dueDate: DAYS_70_AGO(), accrualJournalEntryId: 'JE-TEST-2A-A2' },
    });
    // งวด 3 เกิน 60 วัน ตั้งลูกหนี้งวด**บางส่วน**แล้ว (ก1 — ลิงก์ยังว่าง แต่คอลัมน์ยอดสะสม > 0) → ข้ามตั้งแต่ตัวเลือกผู้สมัคร
    const a3 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: a.id, installmentNo: 3 } });
    await prisma.installmentSchedule.update({
      where: { id: a3.id },
      data: {
        dueDate: DAYS_70_AGO(),
        accruedAmount: new Decimal('1000.00'),
        accruedVat: new Decimal('65.42'),
        accruedInterest: new Decimal('329.85'),
      },
    });

    // สัญญา B (TERMINATED): งวด 1 เกิน 60 วัน ยังไม่ตั้งลูกหนี้งวด → ข้ามเพราะสถานะ
    const b = await seedStandard17k12m(prisma);
    await oneA.execute(b.id);
    await prisma.installmentSchedule.updateMany({
      where: { contractId: b.id },
      data: { dueDate: NEXT_YEAR() },
    });
    const b1 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: b.id, installmentNo: 1 } });
    await prisma.installmentSchedule.update({ where: { id: b1.id }, data: { dueDate: DAYS_70_AGO() } });
    await prisma.contract.update({ where: { id: b.id }, data: { status: 'TERMINATED' } });

    const cron = new Vat60dayCron(prisma as any, new Vat60dayMandatoryTemplate(journal, prisma as any));
    const r1 = await cron.tick();
    expect(r1).toEqual({ processed: 1, failed: 0 });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['tag'], equals: 'VAT60-MANDATORY' } } as any,
    });
    expect(entries).toHaveLength(1);
    expect((entries[0].metadata as Record<string, unknown>).installmentScheduleId).toBe(a1.id);

    const after = await prisma.installmentSchedule.findMany({
      where: { id: { in: [a1.id, a2.id, a3.id, b1.id] } },
      select: { id: true, vat60dayJournalEntryId: true },
    });
    const byId = Object.fromEntries(after.map((r) => [r.id, r.vat60dayJournalEntryId]));
    expect(byId[a1.id]).toBe(entries[0].entryNumber);
    expect(byId[a2.id]).toBeNull();
    expect(byId[a3.id]).toBeNull();
    expect(byId[b1.id]).toBeNull();

    // รอบถัดไปไม่ตั้งซ้ำ และไม่นับงวดที่ถูกข้ามเป็น processed
    const r2 = await cron.tick();
    expect(r2).toEqual({ processed: 0, failed: 0 });
  });

  // ผู้ตรวจอิสระ I1 (16/10/2569): งวดอาจถูกตั้งภาษีขาย 60 วันไว้ก่อน ขณะที่รอบ 2A ยังลงไม่ได้ (งวดบัญชีของวันครบกำหนดปิด
  // แล้วเปิดใหม่ · สัญญากลับมาเดินหลังส่งกลับใบรับเครื่องคืน · รอบก่อนลงไม่สำเร็จ) — เมื่อ 2A ตั้งภาษีของงวดเข้า 21-2101 ทีหลัง
  // ต้องกลับ 21-2103 ในธุรกรรมเดียวกัน ไม่งั้นภาษีของงวดเดียวกันอยู่ทั้งสองบัญชีและ ภ.พ.30 (รวม 21-2103 สุทธิ) นับซ้ำ
  it('I1 — ตั้งภาษีขาย 60 วันไว้ก่อน แล้วรอบ 2A ตั้งลูกหนี้งวดทีหลัง → กลับ 21-2103 ในธุรกรรมเดียวกัน (ภาษีของงวดนับครั้งเดียว)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const oneA = new ContractActivation1ATemplate(journal, prisma as any);

    const c = await seedStandard17k12m(prisma);
    await oneA.execute(c.id);
    await prisma.installmentSchedule.updateMany({ where: { contractId: c.id }, data: { dueDate: NEXT_YEAR() } });
    const c1 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 1 } });
    await prisma.installmentSchedule.update({ where: { id: c1.id }, data: { dueDate: DAYS_70_AGO() } });

    // ขั้น 1 — รอบภาษีขาย 60 วันเห็นงวดที่ยังไม่ตั้งลูกหนี้งวด → ตั้ง 21-2103 (งวด a1 ของเทสก่อนถูกประทับแล้ว จึงเหลือ c1 ใบเดียว)
    const vatCron = new Vat60dayCron(prisma as any, new Vat60dayMandatoryTemplate(journal, prisma as any));
    expect(await vatCron.tick()).toEqual({ processed: 1, failed: 0 });
    const stamped = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: c1.id } });
    expect(stamped.vat60dayJournalEntryId).not.toBeNull();
    expect(await contractNet(c.id, '21-2103')).toBe('99.17');

    // ขั้น 2 — รอบ 2A ตั้งลูกหนี้งวด c1 (เส้นทางเดียวกับ cron 00:01)
    const accrualCron = new InstallmentAccrualCron(
      prisma as any,
      new InstallmentAccrual2ATemplate(journal, prisma as any),
    );
    const r = await accrualCron.tick();
    expect(r.failed).toBe(0);

    const row = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: c1.id } });
    expect(row.accrualJournalEntryId).not.toBeNull();
    expect(row.vat60dayJournalEntryId).toBeNull();

    const reversal = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'VAT60-REVERSAL' } },
          { metadata: { path: ['installmentScheduleId'], equals: c1.id } },
        ],
      } as any,
    });
    expect(reversal).not.toBeNull();
    expect((reversal!.metadata as Record<string, unknown>).reversesEntry).toBe(stamped.vat60dayJournalEntryId);

    // ภาษีของงวดนับครั้งเดียว: อยู่ใน 21-2101 (2A) และ 21-2103 สุทธิของสัญญากลับเป็น 0 — ภ.พ.30 ที่รวม 21-2103 สุทธิจึงไม่ซ้ำ
    expect(await contractNet(c.id, '21-2101')).toBe('99.17');
    expect(await contractNet(c.id, '21-2103')).toBe('0.00');
    // ลูกหนี้-VAT ที่ออกแทน (11-2104) ถูกล้างด้วย — เดบิตตอนตั้ง = เครดิตตอนกลับ
    expect(await contractNet(c.id, '11-2104')).toBe('0.00');
  });
});
