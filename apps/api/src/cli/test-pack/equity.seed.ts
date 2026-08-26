import { Prisma } from '@prisma/client';

import { TEST_NAME_PREFIX, TEST_NOTE_MARKER, testName, testNote } from './_context';
import { nextNumberFrom, round2 } from './_helpers';
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

/** แตกยอดรวมตามสัดส่วน % — Decimal ล้วนตาม Global Constraint (ห้าม float กับเงิน) */
const splitByPct = (total: Prisma.Decimal, pct: number): Prisma.Decimal =>
  round2(total.mul(pct).div(100));

/** บรรทัดผู้ถือหุ้นของเอกสาร — holderKey คือชื่อใน SHAREHOLDERS (ยังไม่เติม prefix) */
interface LineSeed {
  holderKey: string;
  amount: Prisma.Decimal;
  premium?: Prisma.Decimal;
}

const CAP_INC_PAR_TOTAL = new Prisma.Decimal(1_000_000);
const DIV_DEC_TOTAL = new Prisma.Decimal(300_000);
const DRAW_TOTAL = new Prisma.Decimal(50_000);

const capIncLines: LineSeed[] = SHAREHOLDERS.map((s) => {
  const par = splitByPct(CAP_INC_PAR_TOTAL, s.pct);
  return { holderKey: s.name, amount: par, premium: splitByPct(par, 10) };
});
const divDecLines: LineSeed[] = SHAREHOLDERS.map((s) => ({
  holderKey: s.name,
  amount: splitByPct(DIV_DEC_TOTAL, s.pct),
}));
/** DRAW = ผู้ถือหุ้นใหญ่รายเดียว — txnType เดียวที่โพสต์ได้โดยไม่ต้องแนบไฟล์มติ (D2) */
const drawLines: LineSeed[] = [{ holderKey: SHAREHOLDERS[0].name, amount: DRAW_TOTAL }];

/**
 * R2 — เพดานคือ READY (POSTED โพสต์ JE ทุนจดทะเบียน/ปันผล)
 * ทุกเอกสารต้องมีบรรทัดผู้ถือหุ้น (NEEDS_SHAREHOLDERS — ไม่มีบรรทัด = SH_REQUIRED ทางตัน ผิด D2).
 * DRAW อยู่ในชุดเพราะเป็น txnType เดียวที่ seed แล้ว "กดโพสต์ได้ทันที": ต้องมีผู้ถือหุ้น + ช่องทางเงิน
 * แต่ไม่อยู่ใน NEEDS_RESOLUTION ⇒ ไม่บังคับแนบไฟล์มติ (V8). ส่วน CAP_INC/DIV_DEC ผู้ทดสอบต้อง
 * อัปโหลดไฟล์มติเองก่อนโพสต์ — ห้าม seed แถว EquityAttachment หลอก (ไฟล์จริงอยู่ S3, แถว
 * metadata เปล่าทำปุ่มดูเอกสารพัง) เพราะขั้นอัปโหลดคือสิ่งที่ต้องทดสอบอยู่แล้ว
 */
const DOCS: Array<{
  key: string;
  txnType: 'CAP_INC' | 'DIV_DEC' | 'DRAW';
  status: 'DRAFT' | 'READY';
  desc: string;
  /** CAP_INC/DIV_DEC อยู่ใน NEEDS_RESOLUTION — ใส่เลขที่/วันที่มติไว้ให้ เหลือแค่แนบไฟล์ */
  withResolution: boolean;
  /** เฉพาะ txnType ใน NEEDS_PAYMENT (CAP_INC, DRAW) — DIV_DEC ไม่ใช้ช่องทางเงิน */
  withPayment: boolean;
  lines: LineSeed[];
}> = [
  {
    key: 'cap-inc',
    txnType: 'CAP_INC',
    status: 'DRAFT',
    desc: 'เพิ่มทุนจดทะเบียน (ร่าง)',
    withResolution: true,
    withPayment: true,
    lines: capIncLines,
  },
  {
    key: 'div-dec',
    txnType: 'DIV_DEC',
    status: 'READY',
    desc: 'ประกาศจ่ายเงินปันผล (รออนุมัติ)',
    withResolution: true,
    withPayment: false,
    lines: divDecLines,
  },
  {
    key: 'draw',
    txnType: 'DRAW',
    status: 'READY',
    desc: 'ถอนใช้ส่วนตัวผู้ถือหุ้นใหญ่ (โพสต์ได้ทันที)',
    withResolution: false,
    withPayment: true,
    lines: drawLines,
  },
];

const descOf = (key: string) => testNote(`ส่วนของผู้ถือหุ้น/${key}`);

const sumOf = (lines: LineSeed[]): Prisma.Decimal =>
  lines.reduce((s, ln) => s.plus(ln.amount), new Prisma.Decimal(0));

/** payload บรรทัด — ชื่อคอลัมน์ตรง schema: shareholderId/shareholderName/lineNo/amount/premium */
const lineCreateData = (lines: LineSeed[], holderIds: Map<string, string>) =>
  lines.map((ln, i) => ({
    shareholderId: holderIds.get(ln.holderKey)!,
    shareholderName: testName(ln.holderKey),
    lineNo: i + 1,
    amount: ln.amount,
    ...(ln.premium ? { premium: ln.premium } : {}),
  }));

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
        detail:
          `${d.status} · ${d.txnType} · ${d.desc} · บรรทัดผู้ถือหุ้น ${d.lines.length} รายการ ` +
          `รวม ${sumOf(d.lines).toNumber().toLocaleString('th-TH')} บาท`,
      })),
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    if (!ctx.refs.financeCompanyId) {
      stat.notes.push('ข้ามเอกสาร — ไม่พบนิติบุคคล FINANCE (EquityDocument.companyId บังคับ)');
    }

    /** ชื่อใน SHAREHOLDERS (ยังไม่เติม prefix) → Shareholder.id — บรรทัดเอกสารต้องอ้าง id จริง */
    const holderIds = new Map<string, string>();
    for (const s of SHAREHOLDERS) {
      const name = testName(s.name);
      const exists = await ctx.prisma.shareholder.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        holderIds.set(s.name, exists.id);
        stat.skipped += 1;
        continue;
      }
      const created = await ctx.prisma.shareholder.create({
        data: {
          name,
          shares: s.shares,
          sharePct: s.pct,
          type: s.type,
          note: testNote('ผู้ถือหุ้นสำหรับทดสอบ — ลบก่อนใช้จริง'),
        },
        select: { id: true },
      });
      holderIds.set(s.name, created.id);
      stat.created += 1;
    }

    if (!ctx.refs.financeCompanyId) return stat;

    const prefix = `EQ-${ctx.dateStr}-`;
    for (const d of DOCS) {
      const description = descOf(d.key);
      const exists = await ctx.prisma.equityDocument.findFirst({
        where: { description, deletedAt: null },
        select: { id: true, docNumber: true, _count: { select: { lines: true } } },
      });
      if (exists) {
        // เอกสารรุ่นก่อน fix D2 ไม่มีบรรทัดผู้ถือหุ้น (ทางตัน SH_REQUIRED) — เติมให้แทนการปล่อยไว้
        if (exists._count.lines === 0) {
          await ctx.prisma.equityShareholderLine.createMany({
            data: lineCreateData(d.lines, holderIds).map((ln) => ({
              ...ln,
              documentId: exists.id,
            })),
          });
          stat.notes.push(
            `เติมบรรทัดผู้ถือหุ้นให้ ${exists.docNumber} (เอกสารรุ่นเก่าไม่มีบรรทัด)`,
          );
        }
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
          ...(d.withResolution
            ? { resolutionNo: `TEST-MTG-${ctx.dateStr}`, resolutionDate: ctx.today }
            : {}),
          ...(d.withPayment ? { paymentAccountCode: '11-1201' } : {}),
          makerId: ctx.refs.reviewerId,
          lines: { create: lineCreateData(d.lines, holderIds) },
        },
      });
      stat.created += 1;
    }

    stat.notes.push(
      'เอกสาร CAP_INC/DIV_DEC ต้องแนบไฟล์มติที่ประชุมก่อนโพสต์ (V8 — ขั้นอัปโหลดไฟล์คือสิ่งที่ต้องทดสอบ) · เอกสาร DRAW โพสต์ได้ทันทีไม่ต้องแนบไฟล์',
    );
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
    const docIds = docs.map((d) => d.id);
    const lineCount = docIds.length
      ? await ctx.prisma.equityShareholderLine.count({ where: { documentId: { in: docIds } } })
      : 0;
    const jeIds = docs
      .flatMap((d) => [d.journalEntryId, d.reverseJournalEntryId])
      .filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.docNumber}`);
    for (const h of holders) console.log(`     ผู้ถือหุ้น "${h.name}"`);

    if (!dryRun && (docs.length || holders.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        if (docs.length) {
          // FK ชื่อ documentId ไม่ใช่ equityDocumentId — บรรทัดไม่มี deletedAt จึง hard delete ได้
          await tx.equityShareholderLine.deleteMany({ where: { documentId: { in: docIds } } });
          if (jeIds.length) {
            await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.equityDocument.updateMany({
              where: { id: { in: docIds } },
              data: { journalEntryId: null, reverseJournalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
          }
          await tx.equityDocument.updateMany({
            where: { id: { in: docIds } },
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
        'บรรทัดผู้ถือหุ้นในเอกสาร (ลบถาวร)': lineCount,
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
