import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient, type AccountingPeriodStatus } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { InstallmentAccrualCron } from './installment-accrual.cron';
import { JournalAutoService } from '../journal-auto.service';
import { bangkokCalendarParts } from '../../../utils/date.util';

const prisma = new PrismaClient();

describe('InstallmentAccrualCron', () => {
  beforeAll(async () => {
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await seedFinanceCoa(prisma);

    const systemEmail = 'admin@bestchoice.com';
    const existing = await prisma.user.findFirst({ where: { email: systemEmail } });
    if (!existing) {
      const anyBranch = await prisma.branch.findFirst({ where: { deletedAt: null } });
      let branchId = anyBranch?.id;
      if (!branchId) {
        const co = await prisma.companyInfo.findFirst({ where: { deletedAt: null } });
        let companyId = co?.id;
        if (!companyId) {
          const created = await prisma.companyInfo.create({
            data: {
              nameTh: 'System Co',
              taxId: '9999999999999',
              companyCode: 'SYSTEM',
              address: '1 System Rd',
              directorName: 'System',
              vatRegistered: false,
            },
          });
          companyId = created.id;
        }
        const b = await prisma.branch.create({ data: { name: '__system__', companyId } });
        branchId = b.id;
      }
      await prisma.user.create({
        data: {
          email: systemEmail,
          password: 'hashed_placeholder',
          name: 'Admin',
          role: 'OWNER',
          branchId,
        },
      });
    }
  });

  it('processes today-due installments and is idempotent', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);

    // Activate the contract (1A) to set up HP receivable
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Shift installment #1 due_date to today so the cron picks it up
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: new Date() },
    });

    // scenario-helpers.seedStandard17k12m hardcodes startDate=2025-01-01, so
    // installments #2-12 (Mar 2025 – Jan 2026) drift into the past as real
    // wall-clock time advances past that window. The cron's backfill query
    // (dueDate < tomorrow) then sweeps them up too, breaking this test's
    // "only installment #1 is due" assumption — pin them safely in the future
    // so this assertion stays isolated to installment #1 regardless of when
    // the suite runs.
    await prisma.installmentSchedule.updateMany({
      where: { contractId: c.id, installmentNo: { gt: 1 } },
      data: { dueDate: new Date(Date.now() + 365 * 86_400_000) },
    });

    const cron = new InstallmentAccrualCron(
      prisma as any,
      new InstallmentAccrual2ATemplate(new JournalAutoService(prisma as any), prisma as any),
    );

    // First run — should process at least 1 installment
    const r1 = await cron.tick();
    expect(r1.processed).toBeGreaterThanOrEqual(1);
    expect(r1.failed).toBe(0);

    // Second run — installment already accrued, should skip (processed = 0)
    const r2 = await cron.tick();
    expect(r2.processed).toBe(0);
    expect(r2.failed).toBe(0);

    // Exactly 1 accrual JE for this contract (queried via metadata JSONB)
    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['contractId'], equals: c.id } },
    });
    const tag2A = entries.filter((e) => (e.metadata as any)?.tag === '2A');
    expect(tag2A.length).toBe(1);
  });

  it('backfills past-due installments missed by previous runs', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);

    // Activate the contract (1A) to set up HP receivable
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Shift installment #1 due_date to 7 days ago — simulates a missed run
    // (cron skipped, contract created with backdated due, or legacy import).
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: sevenDaysAgo, accrualJournalEntryId: null },
    });

    const cron = new InstallmentAccrualCron(
      prisma as any,
      new InstallmentAccrual2ATemplate(new JournalAutoService(prisma as any), prisma as any),
    );

    const result = await cron.tick();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    // The accrued installment should now have an accrualJournalEntryId
    const after = await prisma.installmentSchedule.findFirstOrThrow({
      where: { id: inst.id },
    });
    expect(after.accrualJournalEntryId).not.toBeNull();

    // The accrual JE postedAt should match the original (past) dueDate,
    // not the cron run date — so the accounting period is correct.
    const accrualJe = await prisma.journalEntry.findFirstOrThrow({
      where: { entryNumber: after.accrualJournalEntryId! },
    });
    expect(accrualJe.postedAt).not.toBeNull();
    // Compare date-only to avoid Postgres timestamp precision flakes; both
    // values are seeded with setHours(0,0,0,0) so day equality is sufficient.
    expect(accrualJe.postedAt!.toDateString()).toBe(sevenDaysAgo.toDateString());
  });

  // impact C2 ของการตั้ง branches.company_id = SHOP (2026-10-31): 2A ลงฝั่ง FINANCE ⇒ ด่านงวดต้องตรวจงวดของ FINANCE ไม่ใช่บริษัทของสาขา
  // (เดิมอ่าน `contract.branch.companyId` — สาขา NULL = ไม่ตรวจเลย · สาขา SHOP = ตรวจงวดของ SHOP แล้วข้าม 2A ของ FINANCE)
  describe('period guard checks FINANCE, not the branch company', () => {
    /** งวดบัญชี ก.ย. 2569 — พ้นสิ้นเดือน + ช่วงผ่อนผันค่าเริ่มต้น (5 วัน) ไปแล้วเสมอเมื่อเทสรัน */
    const SEP_DUE = new Date('2026-09-15T00:00:00+07:00');

    async function ensureCompany(code: 'SHOP' | 'FINANCE') {
      const found = await prisma.companyInfo.findFirst({
        where: { companyCode: code, deletedAt: null },
      });
      if (found) return found.id;
      return (
        await prisma.companyInfo.create({
          data: {
            nameTh: `Test ${code}`,
            taxId: '0000000000000',
            companyCode: code,
            address: '1 Test Rd.',
            directorName: 'Test',
            vatRegistered: code === 'FINANCE',
          },
        })
      ).id;
    }

    /** สัญญาที่สาขาผูกบริษัท SHOP · งวด 1 ครบกำหนด `due` · งวดอื่นเลื่อนไปอนาคต (ให้รอบนี้เห็นแค่งวด 1 ของสัญญานี้) */
    async function seedOnShopBranch(due: Date) {
      const shopId = await ensureCompany('SHOP');
      await ensureCompany('FINANCE');
      const c = await seedStandard17k12m(prisma);
      await new ContractActivation1ATemplate(
        new JournalAutoService(prisma as never),
        prisma as never,
      ).execute(c.id);
      const branch = await prisma.branch.create({
        data: { name: `__accrual_c2_${Date.now()}__`, companyId: shopId },
      });
      await prisma.contract.update({ where: { id: c.id }, data: { branchId: branch.id } });
      await prisma.installmentSchedule.updateMany({
        where: { contractId: c.id, installmentNo: { gt: 1 } },
        data: { dueDate: new Date(Date.now() + 365 * 86_400_000) },
      });
      const inst = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });
      await prisma.installmentSchedule.update({
        where: { id: inst.id },
        data: { dueDate: due, accrualJournalEntryId: null },
      });
      return inst.id;
    }

    /** ตั้งสถานะงวด (บริษัท, ปี, เดือน) ชั่วคราว + `period_grace_days` (ถ้าส่ง) แล้วคืนค่าเดิมเสมอ */
    async function withPeriods(
      periods: {
        code: 'SHOP' | 'FINANCE';
        year: number;
        month: number;
        status: AccountingPeriodStatus;
      }[],
      grace: string | undefined,
      run: () => Promise<void>,
    ) {
      const restores: (() => Promise<unknown>)[] = [];
      try {
        for (const p of periods) {
          const companyId = await ensureCompany(p.code);
          const where = { companyId_year_month: { companyId, year: p.year, month: p.month } };
          const before = await prisma.accountingPeriod.findUnique({ where });
          await prisma.accountingPeriod.upsert({
            where,
            create: { companyId, year: p.year, month: p.month, status: p.status },
            update: { status: p.status },
          });
          restores.push(() =>
            before
              ? prisma.accountingPeriod.update({ where, data: { status: before.status } })
              : prisma.accountingPeriod.delete({ where }),
          );
        }
        if (grace !== undefined) {
          const before = await prisma.systemConfig.findUnique({
            where: { key: 'period_grace_days' },
          });
          await prisma.systemConfig.upsert({
            where: { key: 'period_grace_days' },
            create: { key: 'period_grace_days', value: grace },
            update: { value: grace },
          });
          restores.push(() =>
            before
              ? prisma.systemConfig.update({
                  where: { key: 'period_grace_days' },
                  data: { value: before.value },
                })
              : prisma.systemConfig.delete({ where: { key: 'period_grace_days' } }),
          );
        }
        await run();
      } finally {
        for (const restore of restores.reverse()) await restore();
      }
    }

    const newCron = () =>
      new InstallmentAccrualCron(
        prisma as never,
        new InstallmentAccrual2ATemplate(new JournalAutoService(prisma as never), prisma as never),
      );
    const accrualOf = async (id: string) =>
      (await prisma.installmentSchedule.findUniqueOrThrow({ where: { id } })).accrualJournalEntryId;

    it('SHOP period closed + FINANCE open ⇒ the FINANCE accrual still runs', async () => {
      const id = await seedOnShopBranch(SEP_DUE);
      await withPeriods(
        [
          { code: 'SHOP', year: 2026, month: 9, status: 'CLOSED' },
          { code: 'FINANCE', year: 2026, month: 9, status: 'OPEN' },
        ],
        undefined,
        async () => {
          const result = await newCron().tick();
          expect(result.failed).toBe(0);
          expect(await accrualOf(id)).not.toBeNull();
        },
      );
    });

    it('FINANCE period closed past grace (SHOP open) ⇒ the accrual is skipped and reported', async () => {
      const id = await seedOnShopBranch(SEP_DUE);
      await withPeriods(
        [
          { code: 'SHOP', year: 2026, month: 9, status: 'OPEN' },
          { code: 'FINANCE', year: 2026, month: 9, status: 'CLOSED' },
        ],
        undefined,
        async () => {
          const result = await newCron().tick();
          expect(result.skippedClosedPeriod).toBeGreaterThanOrEqual(1);
          expect(await accrualOf(id)).toBeNull();
        },
      );
    });

    it('FINANCE closes the current month early with grace 0 ⇒ an installment due today still accrues (grace rule 2026-10-31)', async () => {
      const id = await seedOnShopBranch(new Date());
      const { year, month } = bangkokCalendarParts(new Date());
      await withPeriods(
        [{ code: 'FINANCE', year, month: month + 1, status: 'CLOSED' }],
        '0',
        async () => {
          const result = await newCron().tick();
          expect(result.failed).toBe(0);
          expect(await accrualOf(id)).not.toBeNull();
        },
      );
    });
  });
});
