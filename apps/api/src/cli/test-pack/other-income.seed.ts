import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextNumberFrom, round2, sumLine } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** R2 — เพดานคือ READY (POSTED โพสต์ JE + ออกใบเสร็จ RT-) */
const ROWS: Array<{
  key: string;
  status: 'DRAFT' | 'READY';
  accountCode: string;
  accountName: string;
  counterparty: string;
  unitAmount: number;
  vatPct: number;
  whtPct: number;
}> = [
  {
    key: 'bank-interest',
    status: 'DRAFT',
    accountCode: '42-1102',
    accountName: 'ดอกเบี้ยเงินฝาก',
    counterparty: 'ทดสอบระบบ ธนาคาร',
    unitAmount: 1250,
    vatPct: 0,
    whtPct: 15,
  },
  {
    key: 'late-fee',
    status: 'DRAFT',
    accountCode: '42-1103',
    accountName: 'ค่าปรับชำระล่าช้า',
    counterparty: 'ทดสอบระบบ ลูกค้าจ่ายค่าปรับอย่างเดียว',
    unitAmount: 100,
    vatPct: 0,
    whtPct: 0,
  },
  {
    key: 'ready',
    status: 'READY',
    accountCode: '42-1105',
    accountName: 'กำไรจากการจำหน่ายสินทรัพย์',
    counterparty: 'ทดสอบระบบ ผู้ซื้อทรัพย์สิน',
    unitAmount: 8000,
    vatPct: 7,
    whtPct: 0,
  },
];

const noteOf = (key: string) => testNote(`รายได้อื่น/${key}`);

export const otherIncomeSeeder: DomainSeeder = {
  key: 'other-income',
  label: 'รายได้อื่น',
  routes: [
    '/other-income',
    '/other-income/:id',
    '/other-income/new',
    '/other-income/:id/edit',
    '/other-income/daily-sheet',
    '/other-income/pending-approval',
    '/other-income/templates',
  ],
  markerDoc: `OtherIncome.customerNote ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (เลข OI- ปล่อยตามลำดับจริง)`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => {
      const s = sumLine(r.unitAmount, 1, r.vatPct);
      // .toNumber() เฉพาะตอน format — ห้ามเอาไปคำนวณต่อ
      return {
        label: `OI ${r.key}`,
        detail: `${r.status} · ${r.accountCode} ${r.accountName} · ฿${s.total
          .toNumber()
          .toLocaleString('th-TH')}${r.whtPct ? ` · หัก ณ ที่จ่าย ${r.whtPct}%` : ''}`,
      };
    });
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    if (!ctx.refs.financeCompanyId) {
      stat.notes.push('ข้ามทั้งโดเมน — ไม่พบนิติบุคคล FINANCE (OtherIncome.companyId บังคับ)');
      return stat;
    }
    for (const r of ROWS) {
      const customerNote = noteOf(r.key);
      const exists = await ctx.prisma.otherIncome.findFirst({
        where: { customerNote, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const s = sumLine(r.unitAmount, 1, r.vatPct);
      // WHT คิดจากฐานก่อน VAT (V17) — Decimal ล้วน ห้าม float
      const whtAmount = round2(s.amountBeforeVat.mul(r.whtPct).div(100));
      const prefix = `OI-${ctx.dateStr}-`;
      const last = await ctx.prisma.otherIncome.findFirst({
        where: { docNumber: { startsWith: prefix } },
        orderBy: { docNumber: 'desc' },
        select: { docNumber: true },
      });
      await ctx.prisma.otherIncome.create({
        data: {
          docNumber: nextNumberFrom(prefix, last?.docNumber ?? null),
          companyId: ctx.refs.financeCompanyId,
          status: r.status,
          issueDate: ctx.today,
          priceType: 'EXCLUSIVE',
          counterpartyName: r.counterparty,
          paymentAccountCode: '11-1101',
          incomeGross: s.amountBeforeVat,
          vatAmount: s.vatAmount,
          whtAmount,
          totalAmount: s.total,
          netReceived: round2(s.total.minus(whtAmount)),
          // V10 (other-income validation.service.ts:180-192) บังคับว่า
          // amountReceived ต้องเท่า netReceived ไม่งั้นต้องมีบัญชีปรับผลต่าง.
          // คอลัมน์นี้ @default(0) (schema.prisma:6783) ⇒ ไม่ใส่ = 0 ⇒ diff เท่า
          // ยอดเต็ม ⇒ POST ไม่ผ่าน. เส้นทางจริงไม่เจอเพราะ create() ของ service
          // บังคับค่านี้จาก DTO เสมอ — seeder ที่เขียน prisma ตรงจึงเป็นทางเดียวที่หลุด
          // (พบจริงตอนรัน DRIVE บน prod 2026-08-27)
          amountReceived: round2(s.total.minus(whtAmount)),
          customerNote,
          createdById: ctx.refs.reviewerId,
          items: {
            create: [
              {
                lineNo: 1,
                accountCode: r.accountCode,
                accountName: r.accountName,
                description: r.accountName,
                quantity: 1,
                unitAmount: r.unitAmount,
                vatPct: r.vatPct,
                whtPct: r.whtPct,
                amountBeforeVat: s.amountBeforeVat,
                vatAmount: s.vatAmount,
                whtAmount,
              },
            ],
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const marked = await ctx.prisma.otherIncome.findMany({
      where: { customerNote: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, docNumber: true, journalEntryId: true },
    });
    // ใบกลับรายการ (`<เลขเดิม>-R`) **เขียนทับ `customerNote` เป็น "กลับรายการ: ..."** ⇒ marker หาย
    // ตามด้วย marker ไม่เจอ แต่ตามด้วย FK `reversesId` ได้เป๊ะ — ถ้าไม่กวาด จะเหลือทั้งใบ -R
    // และ JE กลับรายการค้างในสมุด (ทั้งที่ทั้งคู่เกิดจากใบทดสอบ)
    const reversals = marked.length
      ? await ctx.prisma.otherIncome.findMany({
          where: { reversesId: { in: marked.map((d) => d.id) }, deletedAt: null },
          select: { id: true, docNumber: true, journalEntryId: true },
        })
      : [];
    const docs = [...marked, ...reversals];
    const jeIds = docs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.docNumber}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && docs.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jeIds.length) {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.otherIncome.updateMany({
            where: { id: { in: docs.map((d) => d.id) } },
            data: { journalEntryId: null },
          });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.otherIncome.updateMany({
          where: { id: { in: docs.map((d) => d.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: {
        ใบรายได้อื่น: docs.length,
        'รายการบัญชีของรายได้อื่น (ลบถาวร)': jeIds.length,
      },
      warnings: [],
    };
  },
};
