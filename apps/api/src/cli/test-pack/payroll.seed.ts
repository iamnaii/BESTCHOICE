import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextDocNumber } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * ใบเงินเดือน 1 ใบต่อฝั่ง — SHOP (พนักงานสาขา) และ FINANCE (ส่วนกลาง)
 * ตาม .claude/rules/accounting.md หัวข้อ Payroll: entityScope เป็นตัวเลือกผังบัญชี
 * R2 — DRAFT เท่านั้น (POSTED โพสต์ JE เงินเดือน + ปกส. + ภ.ง.ด.1)
 */
const SCOPES: Array<{
  scope: 'SHOP' | 'FINANCE';
  label: string;
  lines: Array<{ name: string; base: number; sso: number; wht: number }>;
}> = [
  {
    scope: 'SHOP',
    label: 'พนักงานสาขา',
    lines: [
      { name: 'ทดสอบระบบ พนักงานขาย ก', base: 15000, sso: 750, wht: 0 },
      { name: 'ทดสอบระบบ พนักงานขาย ข', base: 13000, sso: 650, wht: 0 },
    ],
  },
  {
    scope: 'FINANCE',
    label: 'ส่วนกลาง',
    lines: [{ name: 'ทดสอบระบบ พนักงานบัญชี', base: 28000, sso: 750, wht: 420 }],
  },
];

const noteOf = (scope: string) => testNote(`เงินเดือน/${scope}`);
/** งวดเงินเดือนของเดือนปัจจุบัน — YYYY-MM */
const periodOf = (today: Date) =>
  `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

export const payrollSeeder: DomainSeeder = {
  key: 'payroll',
  label: 'เงินเดือน',
  routes: ['/finance/sso-report', '/finance/wht-report', '/finance/wht-annual'],
  markerDoc: `ExpenseDocument.note ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" และ documentType = PAYROLL`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    return SCOPES.map((s) => ({
      label: `PR ${s.scope}`,
      detail: `DRAFT · ${s.label} ${s.lines.length} คน · งวด ${periodOf(ctx.today)} · รวม ฿${s.lines
        .reduce((a, l) => a.plus(l.base), new Prisma.Decimal(0))
        .toNumber()
        .toLocaleString('th-TH')}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const period = periodOf(ctx.today);
    for (const s of SCOPES) {
      const note = noteOf(s.scope);
      const exists = await ctx.prisma.expenseDocument.findFirst({
        where: { note, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const gross = s.lines.reduce((a, l) => a.plus(l.base), new Prisma.Decimal(0));
      const totalSso = s.lines.reduce((a, l) => a.plus(l.sso), new Prisma.Decimal(0));
      const totalWht = s.lines.reduce((a, l) => a.plus(l.wht), new Prisma.Decimal(0));
      const number = await nextDocNumber(ctx.prisma, 'PR', ctx.dateStr);
      await ctx.prisma.expenseDocument.create({
        data: {
          number,
          documentType: 'PAYROLL',
          branchId: ctx.refs.branchId,
          documentDate: ctx.today,
          description: `เงินเดือน ${s.label} งวด ${period}`,
          subtotal: gross,
          vatAmount: 0,
          withholdingTax: totalWht,
          totalAmount: gross,
          netPayment: gross.minus(totalSso).minus(totalWht),
          status: 'DRAFT',
          note,
          createdById: ctx.refs.reviewerId,
          payroll: {
            create: {
              payrollPeriod: period,
              entityScope: s.scope,
              lines: {
                create: s.lines.map((l) => ({
                  employeeName: l.name,
                  baseSalary: l.base,
                  ssoEmployee: l.sso,
                  whtAmount: l.wht,
                  netPaid: new Prisma.Decimal(l.base).minus(l.sso).minus(l.wht),
                })),
              },
            },
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const docs = await ctx.prisma.expenseDocument.findMany({
      where: { note: { startsWith: TEST_NOTE_MARKER }, documentType: 'PAYROLL', deletedAt: null },
      select: { id: true, number: true, journalEntryId: true },
    });
    const jeIds = docs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && docs.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jeIds.length) {
          // FK sweep ก่อน hard-delete JE — Postgres default FK = NO ACTION จะ abort ทั้ง tx
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.expenseDocument.updateMany({
            where: { id: { in: docs.map((d) => d.id) } },
            data: { journalEntryId: null },
          });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.expenseDocument.updateMany({
          where: { id: { in: docs.map((d) => d.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: {
        ใบเงินเดือน: docs.length,
        'รายการบัญชีของใบเงินเดือน (ลบถาวร)': jeIds.length,
      },
      warnings: [],
    };
  },
};
