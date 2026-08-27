import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextDocNumber, sumLine } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * R2 — เพดานคือ PENDING_APPROVAL เท่านั้น
 * ACCRUAL/POSTED โพสต์ JE ⇒ ต้องให้ผู้ทดสอบกด post เองในหน้าจอ
 */
const ROWS: Array<{
  key: string;
  status: 'DRAFT' | 'PENDING_APPROVAL';
  vendorName: string;
  /**
   * **รหัสบัญชีฝั่ง FINANCE เท่านั้น (`5x-xxxx`) — ห้ามใส่ชื่อบัญชี**
   * `ExpenseLine.category` ถูกอ่านเป็น accountCode โดยตรงที่
   * `expense-accrual.template.ts:89` ⇒ lookup CoA ไม่เจอ = throw ตอนโพสต์
   * (เกิดจริงบน prod 2026-08-27: `Account code not found in CoA: ค่าสาธารณูปโภค`)
   * seeder เขียนผ่าน prisma.create ตรง ๆ จึงข้าม regex ของ DTO
   * (`expense-line-input.dto.ts:13-16`) ที่เคยกันความผิดนี้ไว้
   */
  category: string;
  unitPrice: number;
  qty: number;
  vatPct: number;
  whtPct: number;
  desc: string;
}> = [
  {
    // เดิมเป็น "ค่าเช่าร้าน" — เปลี่ยนเพราะ **ผัง FINANCE ไม่มีบัญชีค่าเช่าเลย**
    // (มีแต่ S52-1101 ค่าเช่าสาขา ฝั่ง SHOP ซึ่ง DTO ของโมดูลนี้ไม่รับ — regex ^5\d-\d{4}$)
    // จุดประสงค์ของแถวนี้คือ "ใบที่มีทั้ง VAT และ WHT" ซึ่งค่าบริการบัญชีทำหน้าที่เดียวกัน
    // (WHT ค่าบริการ = 3% ตามกฎหมาย — ค่าเช่า 5% ใช้กับบัญชีค่าเช่าเท่านั้น)
    key: 'service',
    status: 'DRAFT',
    vendorName: 'ทดสอบระบบ สำนักงานบัญชี',
    category: '53-1401',
    unitPrice: 25000,
    qty: 1,
    vatPct: 7,
    whtPct: 3,
    desc: 'ค่าบริการบัญชี (ร่าง — มี VAT + หัก ณ ที่จ่าย 3%)',
  },
  {
    key: 'utility',
    status: 'DRAFT',
    vendorName: 'ทดสอบระบบ การไฟฟ้า',
    category: '53-1302',
    unitPrice: 3800,
    qty: 1,
    vatPct: 7,
    whtPct: 0,
    desc: 'ค่าไฟฟ้า (ร่าง — มี VAT ไม่มี WHT)',
  },
  {
    key: 'approval',
    status: 'PENDING_APPROVAL',
    vendorName: 'ทดสอบระบบ ร้านวัสดุ',
    category: '53-1305',
    unitPrice: 12500,
    qty: 1,
    vatPct: 7,
    whtPct: 3,
    desc: 'ค่าซ่อมแซมร้าน (รออนุมัติ — ทดสอบสิทธิ์ผู้อนุมัติ)',
  },
  {
    key: 'zero',
    status: 'DRAFT',
    vendorName: 'ทดสอบระบบ ผู้ขายรายย่อย',
    category: '53-1201',
    unitPrice: 0,
    qty: 1,
    vatPct: 0,
    whtPct: 0,
    desc: 'เคสขอบ — ยอด 0 บาท ไม่มี VAT',
  },
];

const noteOf = (key: string) => testNote(`ค่าใช้จ่าย/${key}`);

export const expensesSeeder: DomainSeeder = {
  key: 'expenses',
  label: 'ค่าใช้จ่าย',
  routes: [
    '/expenses',
    '/expenses/:id',
    '/expenses/new',
    '/expenses/:id/voucher',
    '/expenses/ap-aging',
    '/expenses/daily-summary',
    '/expenses/favorites',
  ],
  markerDoc: `ExpenseDocument.note ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (เลข EX- ปล่อยตามลำดับจริง ห้ามใส่ TEST- เพราะจะพัง sequence)`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => {
      const s = sumLine(r.unitPrice, r.qty, r.vatPct);
      return {
        label: `EX ${r.key}`,
        detail: `${r.status} · ${r.desc} · ยอดรวม ฿${s.total.toNumber().toLocaleString('th-TH')}`,
      };
    });
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    for (const r of ROWS) {
      const note = noteOf(r.key);
      const exists = await ctx.prisma.expenseDocument.findFirst({
        where: { note, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const s = sumLine(r.unitPrice, r.qty, r.vatPct);
      const whtAmount = s.amountBeforeVat
        .mul(r.whtPct)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const number = await nextDocNumber(ctx.prisma, 'EX', ctx.dateStr);
      await ctx.prisma.expenseDocument.create({
        data: {
          number,
          documentType: 'EXPENSE',
          branchId: ctx.refs.branchId,
          documentDate: ctx.today,
          vendorName: r.vendorName,
          description: r.desc,
          subtotal: s.amountBeforeVat,
          vatAmount: s.vatAmount,
          withholdingTax: whtAmount,
          whtFormType: r.whtPct > 0 ? 'PND3' : null,
          totalAmount: s.total,
          netPayment: s.total.minus(whtAmount),
          status: r.status,
          note,
          createdById: ctx.refs.reviewerId,
          expenseDetail: {
            create: {
              lines: {
                create: [
                  {
                    lineNo: 1,
                    category: r.category,
                    description: r.desc,
                    quantity: r.qty,
                    unitPrice: r.unitPrice,
                    vatPercent: r.vatPct,
                    whtPercent: r.whtPct,
                    whtFormType: r.whtPct > 0 ? 'PND3' : null,
                    supplierName: r.vendorName,
                    amountBeforeVat: s.amountBeforeVat,
                    vatAmount: s.vatAmount,
                    whtAmount,
                  },
                ],
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
    const marked = await ctx.prisma.expenseDocument.findMany({
      where: { note: { startsWith: TEST_NOTE_MARKER }, documentType: 'EXPENSE', deletedAt: null },
      select: { id: true, number: true, journalEntryId: true },
    });
    const markedIds = marked.map((d) => d.id);
    // เอกสารต่อยอดจากใบทดสอบ (S3, 2026-08-26): ExpenseDocumentCreateService สร้างใบลดหนี้
    // (CREDIT_NOTE) และใบชำระเจ้าหนี้ (VENDOR_SETTLEMENT) เป็นเอกสาร "ใหม่" ที่ตั้ง note จาก
    // dto ของผู้ใช้ — ไม่ inherit marker ⇒ filter documentType EXPENSE มองไม่เห็น และ JE ของมัน
    // จะค้างถาวร (รูเดียวกับใบ -R ของ other-income). ตามผ่าน FK จริงใน schema:
    // CreditNoteDetail.originalDocumentId / SettlementLine.clearedDocumentId
    const creditNotes = markedIds.length
      ? await ctx.prisma.expenseDocument.findMany({
          where: {
            documentType: 'CREDIT_NOTE',
            deletedAt: null,
            creditNote: { is: { originalDocumentId: { in: markedIds } } },
          },
          select: { id: true, number: true, journalEntryId: true },
        })
      : [];
    // settlement ตามได้ทั้งจากใบทดสอบตรง ๆ และจากใบลดหนี้ที่ต่อยอดมาอีกชั้น
    const settleTargets = [...markedIds, ...creditNotes.map((d) => d.id)];
    const settlements = settleTargets.length
      ? await ctx.prisma.expenseDocument.findMany({
          where: {
            documentType: 'VENDOR_SETTLEMENT',
            deletedAt: null,
            settlement: {
              is: { settlementLines: { some: { clearedDocumentId: { in: settleTargets } } } },
            },
          },
          select: { id: true, number: true, journalEntryId: true },
        })
      : [];
    const docs = [...marked, ...creditNotes, ...settlements];
    const jeIds = docs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const d of marked) console.log(`     ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    // เอกสารต่อยอดไม่มี marker — บรรทัดนี้คือช่องทางเดียวที่ผู้รันเห็นเลขก่อนถูกกวาด
    // ⇒ พิมพ์เสมอทั้ง dry-run และ live (pattern เดียวกับ repair.seed.ts)
    for (const d of creditNotes)
      console.log(`     ใบลดหนี้ต่อจากใบทดสอบ ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    for (const d of settlements)
      console.log(
        `     ใบชำระเจ้าหนี้ต่อจากใบทดสอบ ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`,
      );
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
        ใบค่าใช้จ่าย: marked.length,
        'ใบลดหนี้ต่อจากใบทดสอบ (ไม่มี marker — ตามจาก FK)': creditNotes.length,
        'ใบชำระเจ้าหนี้ต่อจากใบทดสอบ (ไม่มี marker — ตามจาก FK)': settlements.length,
        'รายการบัญชีของใบค่าใช้จ่าย (ลบถาวร)': jeIds.length,
      },
      warnings: [],
    };
  },
};
