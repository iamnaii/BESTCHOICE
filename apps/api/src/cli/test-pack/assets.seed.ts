import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextNumberFrom, round2, sumLine } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** ปัด 4 ตำแหน่งสำหรับอัตราค่าเสื่อม — คอลัมน์เป็น @db.Decimal(12, 4) */
const round4 = (n: Prisma.Decimal): Prisma.Decimal =>
  n.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

/**
 * R2 — DRAFT เท่านั้น (POSTED โพสต์ JE ซื้อทรัพย์สิน แล้วเข้าคิวค่าเสื่อมรายเดือน)
 * แถวที่สองตั้ง vatAccount = 11-4102 เพื่อทดสอบ flow "ใบกำกับมาถึงแล้ว"
 * (.claude/rules/accounting.md — Asset VAT 11-4102 deferred → 11-4101 transfer)
 * คู่บัญชีต่อ category ตรงกับ CATEGORY_CHART ใน asset-purchase.template.ts
 */
const ROWS: Array<{
  key: string;
  name: string;
  category: 'EQUIPMENT' | 'FURNITURE' | 'VEHICLE' | 'IMPROVEMENT';
  basePrice: number;
  months: number;
  hasVat: boolean;
  vatAccount: string | null;
  coaCost: string;
  coaDepr: string;
  coaExpense: string;
}> = [
  {
    key: 'aircon',
    name: 'ทดสอบระบบ เครื่องปรับอากาศสาขา',
    category: 'EQUIPMENT',
    basePrice: 32000,
    months: 60,
    hasVat: true,
    vatAccount: '11-4101',
    coaCost: '12-2101',
    coaDepr: '12-2102',
    coaExpense: '53-1601',
  },
  {
    key: 'shelf',
    name: 'ทดสอบระบบ ชั้นวางสินค้า (ใบกำกับยังไม่มา)',
    category: 'FURNITURE',
    basePrice: 18000,
    months: 60,
    hasVat: true,
    vatAccount: '11-4102',
    coaCost: '12-2105',
    coaDepr: '12-2106',
    coaExpense: '53-1603',
  },
  {
    key: 'novat',
    name: 'ทดสอบระบบ ป้ายหน้าร้าน (ไม่มี VAT)',
    category: 'IMPROVEMENT',
    basePrice: 9500,
    months: 36,
    hasVat: false,
    vatAccount: null,
    coaCost: '12-2103',
    coaDepr: '12-2104',
    coaExpense: '53-1602',
  },
];

const descOf = (key: string) => testNote(`ทรัพย์สิน/${key}`);

export const assetsSeeder: DomainSeeder = {
  key: 'assets',
  label: 'ทรัพย์สินถาวร',
  routes: [
    '/assets',
    '/assets/:id',
    '/assets/new',
    '/assets/:id/edit',
    '/assets/register',
    '/assets/depreciation',
    '/assets/transfers',
    '/assets/:id/dispose',
    '/assets/audit',
    '/assets/:id/audit',
    '/assets/period-close',
    '/assets/journal',
    '/assets/summary-report',
    '/assets/:id/schedule',
  ],
  markerDoc: `FixedAsset.description ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" · docNo เดินตามลำดับ ASSET-YYMM- จริง · assetCode ใช้ลำดับแยก "TESTASSET-" โดยตั้งใจ เพราะรหัสจริงเป็นรายหมวด (COMP-001) ซึ่งจะถูกเผาถาวรถ้าเอาไปตั้งให้แถวทดสอบที่ถูก soft-delete`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => {
      const s = sumLine(r.basePrice, 1, r.hasVat ? 7 : 0);
      return {
        label: `ASSET ${r.key}`,
        detail: `DRAFT · ${r.name} · ฿${r.basePrice.toLocaleString('th-TH')} · ${r.months} เดือน${
          r.vatAccount === '11-4102' ? ' · VAT รอใบกำกับ (11-4102)' : ''
        } · รวม VAT ฿${s.total.toNumber().toLocaleString('th-TH')}`,
      };
    });
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    // ASSET-YYMM-NNNN ตามรูปแบบในคอมเมนต์ของ schema
    const ym = `${String(ctx.today.getUTCFullYear()).slice(2)}${String(
      ctx.today.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const docPrefix = `ASSET-${ym}-`;
    const codePrefix = 'TESTASSET-';
    for (const r of ROWS) {
      const description = descOf(r.key);
      const exists = await ctx.prisma.fixedAsset.findFirst({
        where: { description, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const [lastDoc, lastCode] = await Promise.all([
        ctx.prisma.fixedAsset.findFirst({
          where: { docNo: { startsWith: docPrefix } },
          orderBy: { docNo: 'desc' },
          select: { docNo: true },
        }),
        ctx.prisma.fixedAsset.findFirst({
          where: { assetCode: { startsWith: codePrefix } },
          orderBy: { assetCode: 'desc' },
          select: { assetCode: true },
        }),
      ]);
      // Decimal ล้วน — base ยังเป็น literal แต่กันคนแก้ทีหลังใส่ค่าที่ไม่ใช่ literal แล้วสืบทอด float
      const base = new Prisma.Decimal(r.basePrice);
      const vat = r.hasVat ? round2(base.mul(7).div(100)) : new Prisma.Decimal(0);
      const monthlyDepr = round4(base.div(r.months));
      await ctx.prisma.fixedAsset.create({
        data: {
          assetCode: nextNumberFrom(codePrefix, lastCode?.assetCode ?? null, 3),
          docNo: nextNumberFrom(docPrefix, lastDoc?.docNo ?? null),
          name: r.name,
          description,
          category: r.category,
          branchId: ctx.refs.branchId,
          basePrice: r.basePrice,
          hasVat: r.hasVat,
          vatAmount: vat,
          vatAccount: r.vatAccount,
          purchaseCost: r.basePrice,
          usefulLifeMonths: r.months,
          monthlyDepr,
          dailyDepr: round4(base.div(new Prisma.Decimal(r.months).div(12).mul(365))),
          netBookValue: r.basePrice,
          coaCostAccount: r.coaCost,
          coaDeprAccount: r.coaDepr,
          coaExpenseAccount: r.coaExpense,
          purchaseDate: ctx.today,
          supplierName: 'ทดสอบระบบ ผู้ขายทรัพย์สิน',
          // นับเป็น optional ที่ schema (FixedAsset.paymentAccount String?) แต่
          // **บังคับตอนโพสต์** — asset-purchase.template.ts:98 throw ถ้าว่าง
          // (ใช้เป็นขา Cr เงินสด/ธนาคาร = purchaseCost + VAT − WHT).
          // ฟอร์มจริงส่ง '11-1201' เสมอ (AssetEntryPage.tsx:59) seeder จึงเป็น
          // เส้นทางเดียวที่สร้างเอกสารที่โพสต์ไม่ได้ — พบจริงตอนรัน DRIVE บน prod 2026-08-27.
          // ทรัพย์สินชุดนี้เป็นฝั่ง FINANCE (ผัง 12-21xx/53-16xx ไม่มี S นำหน้า)
          paymentAccount: '11-1201',
          status: 'DRAFT',
          createdById: ctx.refs.reviewerId,
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.fixedAsset.findMany({
      where: { description: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, assetCode: true, docNo: true, invoiceTransferJournalEntryId: true },
    });
    // JE ของทรัพย์สินมี 2 ทาง: โอน VAT 11-4102→11-4101 มี FK บนตาราง ส่วน **JE ซื้อทรัพย์สิน
    // ตอน post ไม่มี FK** — `AssetPurchaseTemplate` stamp `metadata.assetId` + `flow: 'asset-purchase'`
    // ⇒ กวาดทาง metadata เหมือนที่ใบจองทำ ไม่งั้นผู้ทดสอบที่กด post ในหน้าจอจะทิ้ง JE ค้างในสมุด
    const metaJes = rows.length
      ? await ctx.prisma.journalEntry.findMany({
          where: {
            OR: rows.map((r) => ({ metadata: { path: ['assetId'], equals: r.id } as never })),
          },
          select: { id: true },
        })
      : [];
    const jeIds = [
      ...rows.map((r) => r.invoiceTransferJournalEntryId).filter((x): x is string => !!x),
      ...metaJes.map((j) => j.id),
    ].filter((id, i, all) => all.indexOf(id) === i);
    for (const r of rows) {
      console.log(
        `     ${r.docNo} (${r.assetCode})${r.invoiceTransferJournalEntryId ? ' (มี JE โอน VAT)' : ''}`,
      );
    }
    if (jeIds.length) {
      console.log(`     กวาดรายการบัญชีที่ผูกกับทรัพย์สินทดสอบทั้งหมด ${jeIds.length} ใบ:`);
      // เลข JE คือหลักฐานบัญชี และครึ่งหนึ่งของ sweep นี้มาจาก JSON path (metadata.assetId)
      // — พิมพ์ให้คนกดเห็นก่อนลบถาวรเสมอ ทั้ง dry-run และ live (M1, 2026-08-26)
      const jeNumbers = await ctx.prisma.journalEntry.findMany({
        where: { id: { in: jeIds } },
        select: { entryNumber: true },
        orderBy: { entryNumber: 'asc' },
      });
      for (const j of jeNumbers) console.log(`       ${j.entryNumber}`);
    }
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        // ค่าเสื่อมที่ cron เคยลงให้ต้องออกก่อน ไม่งั้น FK ค้าง
        await tx.depreciationEntry.deleteMany({
          where: { assetId: { in: rows.map((r) => r.id) } },
        });
        if (jeIds.length) {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.fixedAsset.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: { invoiceTransferJournalEntryId: null },
          });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.fixedAsset.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: {
        ทรัพย์สิน: rows.length,
        'รายการบัญชีของทรัพย์สิน (ลบถาวร)': jeIds.length,
      },
      warnings: [],
    };
  },
};
