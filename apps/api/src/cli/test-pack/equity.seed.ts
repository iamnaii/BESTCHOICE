import { TEST_NAME_PREFIX, TEST_NOTE_MARKER, testName, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const SHAREHOLDERS: Array<{
  name: string;
  shares: number;
  pct: number;
  type: 'INDIVIDUAL' | 'JURISTIC_TH' | 'JURISTIC_FOREIGN';
}> = [
  { name: 'ผู้ถือหุ้นบุคคล ก', shares: 6000, pct: 60, type: 'INDIVIDUAL' },
  { name: 'ผู้ถือหุ้นบุคคล ข', shares: 3000, pct: 30, type: 'INDIVIDUAL' },
  { name: 'ผู้ถือหุ้นนิติบุคคลไทย', shares: 1000, pct: 10, type: 'JURISTIC_TH' },
];

/** R2 — เพดานคือ READY (POSTED โพสต์ JE ทุนจดทะเบียน/ปันผล) */
const DOCS: Array<{
  key: string;
  txnType: 'CAP_INC' | 'DIV_DEC';
  status: 'DRAFT' | 'READY';
  desc: string;
}> = [
  { key: 'cap-inc', txnType: 'CAP_INC', status: 'DRAFT', desc: 'เพิ่มทุนจดทะเบียน (ร่าง)' },
  { key: 'div-dec', txnType: 'DIV_DEC', status: 'READY', desc: 'ประกาศจ่ายเงินปันผล (รออนุมัติ)' },
];

const descOf = (key: string) => testNote(`ส่วนของผู้ถือหุ้น/${key}`);

export const equitySeeder: DomainSeeder = {
  key: 'equity',
  label: 'ส่วนของผู้ถือหุ้น',
  routes: [
    '/finance/equity',
    '/finance/equity/new',
    '/finance/equity/:id',
    '/finance/equity/:id/edit',
    '/finance/dividend-register',
    '/finance/equity-statement',
  ],
  markerDoc: `EquityDocument.description ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" · Shareholder.name ขึ้นต้นด้วย "${TEST_NAME_PREFIX}" (⚠️ shareholders เป็น KEEP table — factory reset ไม่ล้างให้)`,

  async plan(): Promise<PlanRow[]> {
    return [
      ...SHAREHOLDERS.map((s) => ({
        label: testName(s.name),
        detail: `${s.shares.toLocaleString('th-TH')} หุ้น · ${s.pct}% · ${s.type}`,
      })),
      ...DOCS.map((d) => ({
        label: `EQ ${d.key}`,
        detail: `${d.status} · ${d.txnType} · ${d.desc}`,
      })),
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    if (!ctx.refs.financeCompanyId) {
      stat.notes.push('ข้ามเอกสาร — ไม่พบนิติบุคคล FINANCE (EquityDocument.companyId บังคับ)');
    }

    for (const s of SHAREHOLDERS) {
      const name = testName(s.name);
      const exists = await ctx.prisma.shareholder.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.shareholder.create({
        data: {
          name,
          shares: s.shares,
          sharePct: s.pct,
          type: s.type,
          note: testNote('ผู้ถือหุ้นสำหรับทดสอบ — ลบก่อนใช้จริง'),
        },
      });
      stat.created += 1;
    }

    if (!ctx.refs.financeCompanyId) return stat;

    const prefix = `EQ-${ctx.dateStr}-`;
    for (const d of DOCS) {
      const description = descOf(d.key);
      const exists = await ctx.prisma.equityDocument.findFirst({
        where: { description, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const last = await ctx.prisma.equityDocument.findFirst({
        where: { docNumber: { startsWith: prefix } },
        orderBy: { docNumber: 'desc' },
        select: { docNumber: true },
      });
      await ctx.prisma.equityDocument.create({
        data: {
          docNumber: nextNumberFrom(prefix, last?.docNumber ?? null),
          companyId: ctx.refs.financeCompanyId,
          txnType: d.txnType,
          status: d.status,
          txnDate: ctx.today,
          description,
          resolutionNo: `TEST-MTG-${ctx.dateStr}`,
          resolutionDate: ctx.today,
          paymentAccountCode: '11-1201',
          makerId: ctx.refs.reviewerId,
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const docs = await ctx.prisma.equityDocument.findMany({
      where: { description: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, docNumber: true, journalEntryId: true, reverseJournalEntryId: true },
    });
    const holders = await ctx.prisma.shareholder.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX }, deletedAt: null },
      select: { id: true, name: true },
    });
    const jeIds = docs
      .flatMap((d) => [d.journalEntryId, d.reverseJournalEntryId])
      .filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.docNumber}`);
    for (const h of holders) console.log(`     ผู้ถือหุ้น "${h.name}"`);

    if (!dryRun && (docs.length || holders.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        if (docs.length) {
          // FK ชื่อ documentId ไม่ใช่ equityDocumentId — บรรทัดไม่มี deletedAt จึง hard delete ได้
          await tx.equityShareholderLine.deleteMany({
            where: { documentId: { in: docs.map((d) => d.id) } },
          });
          if (jeIds.length) {
            await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.equityDocument.updateMany({
              where: { id: { in: docs.map((d) => d.id) } },
              data: { journalEntryId: null, reverseJournalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
          }
          await tx.equityDocument.updateMany({
            where: { id: { in: docs.map((d) => d.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (holders.length) {
          await tx.shareholder.updateMany({
            where: { id: { in: holders.map((h) => h.id) } },
            data: { deletedAt: new Date() },
          });
        }
      });
    }

    return {
      removed: {
        เอกสารส่วนของผู้ถือหุ้น: docs.length,
        ผู้ถือหุ้นทดสอบ: holders.length,
        'รายการบัญชีส่วนของผู้ถือหุ้น (ลบถาวร)': jeIds.length,
      },
      warnings: holders.length
        ? [
            'ตาราง shareholders อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้ ผู้ถือหุ้นทดสอบจะรอดข้าม factory reset ไปปนทะเบียน บอจ.5 จริง',
          ]
        : [],
    };
  },
};
