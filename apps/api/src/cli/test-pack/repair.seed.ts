import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * prefix จริงของเลขใบซ่อมทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ
 * seed/cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26)
 */
const TICKET_NO_PREFIX = `${TEST_DOC_PREFIX}RT-`;

/** R2 — ปิดที่ READY_FOR_PICKUP · CLOSED สร้างเอกสารบัญชีอัตโนมัติ ให้คนกดเอง */
const ROWS: Array<{
  key: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_PICKUP';
  payer: 'SHOP' | 'CUSTOMER';
  warranty: 'IN_SHOP_WARRANTY' | 'OUT_OF_WARRANTY' | 'WALK_IN';
  defect: string;
  cost: number;
}> = [
  {
    key: 'open',
    status: 'OPEN',
    payer: 'SHOP',
    warranty: 'IN_SHOP_WARRANTY',
    defect: 'จอไม่ติด — รับเครื่องเข้าระบบแล้ว',
    cost: 0,
  },
  {
    key: 'inprogress',
    status: 'IN_PROGRESS',
    payer: 'CUSTOMER',
    warranty: 'OUT_OF_WARRANTY',
    defect: 'แบตเสื่อม — ส่งศูนย์ซ่อมแล้ว',
    cost: 1200,
  },
  {
    key: 'ready',
    status: 'READY_FOR_PICKUP',
    payer: 'SHOP',
    warranty: 'WALK_IN',
    defect: 'เปลี่ยนกระจกหลัง — ซ่อมเสร็จรอลูกค้ามารับ',
    cost: 850,
  },
];

export const repairSeeder: DomainSeeder = {
  key: 'repair',
  label: 'ใบซ่อม / ประกัน',
  routes: [
    '/insurance',
    '/insurance/:id',
    '/insurance/new',
    '/insurance/warranty-check',
    '/insurance/exchange-requests',
  ],
  markerDoc: `RepairTicket.ticketNumber ขึ้นต้น "${TICKET_NO_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `${TEST_DOC_PREFIX}RT ${r.key}`,
      detail: `${r.status} · ผู้จ่าย ${r.payer} · ${r.warranty} · ${r.defect}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({
      where: { name: { startsWith: 'ทดสอบ' }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!customer) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    const repairSupplier = await ctx.prisma.supplier.findFirst({
      where: { isRepairCenter: true, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    // ticketNumber เป็น @unique เต็มตาราง (ไม่ใช่ partial) — แถวที่ cleanup soft delete ไปแล้ว
    // ยังถือเลขอยู่ ⇒ จองเลขแบบ max+1 โดย "ไม่กรอง deletedAt" (doctrine เดียวกับ nextDocNumber)
    // และ probe ความซ้ำที่ notes marker รายใบแทนเลขเอกสาร — brief เดิมใช้เลขตายตัวต่อ key
    // ซึ่งชนแถว soft-deleted ถ้า seed ซ้ำวันเดียวกันหลัง cleanup
    const prefix = `${TICKET_NO_PREFIX}${ctx.dateStr}-`;
    for (const r of ROWS) {
      const notes = testNote(`ใบซ่อมสำหรับทดสอบ/${r.key}`);
      const exists = await ctx.prisma.repairTicket.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const last = await ctx.prisma.repairTicket.findFirst({
        where: { ticketNumber: { startsWith: prefix } },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });
      await ctx.prisma.repairTicket.create({
        data: {
          ticketNumber: nextNumberFrom(prefix, last?.ticketNumber ?? null),
          status: r.status,
          customerId: customer.id,
          deviceBrand: 'ทดสอบระบบ',
          deviceModel: 'รุ่นทดสอบ',
          deviceImei: `TEST-RT-${r.key}`,
          defectDescription: r.defect,
          warrantyStatus: r.warranty,
          repairSupplierId: repairSupplier?.id ?? null,
          // เงินเป็น Prisma.Decimal เสมอ — Global Constraint (cost 0 = ไม่ประเมิน ⇒ null)
          estimatedCost: r.cost ? new Prisma.Decimal(r.cost) : null,
          actualCost: r.status === 'READY_FOR_PICKUP' ? new Prisma.Decimal(r.cost) : null,
          payer: r.payer,
          notes,
          branchId: ctx.refs.branchId,
          createdById: ctx.refs.salespersonId,
          ...(r.status !== 'OPEN' ? { sentToRepairAt: ctx.today } : {}),
          ...(r.status === 'READY_FOR_PICKUP' ? { repairedAt: ctx.today } : {}),
        },
      });
      stat.created += 1;
    }
    if (!repairSupplier)
      stat.notes.push(
        'ไม่พบซัพพลายเออร์ที่เป็นศูนย์ซ่อม — ใบซ่อมถูกสร้างโดยไม่ผูกศูนย์ซ่อม (รันโดเมน suppliers-po ก่อนถ้าต้องการ)',
      );
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.repairTicket.findMany({
      where: { ticketNumber: { startsWith: TICKET_NO_PREFIX }, deletedAt: null },
      select: {
        id: true,
        ticketNumber: true,
        expenseDocumentId: true,
        otherIncomeId: true,
        replacementContractId: true,
      },
    });
    // log สถานะเกิดตอนผู้ทดสอบกดเปลี่ยนสถานะ (repair-ticket-lifecycle.service.ts) — ไม่มี marker
    // ติดตัว ตามได้จาก FK ticketId เท่านั้น และไม่มี deletedAt (append-only log) ⇒ hard delete
    const logs = rows.length
      ? await ctx.prisma.repairStatusLog.findMany({
          where: { ticketId: { in: rows.map((r) => r.id) } },
          select: { id: true, ticketId: true },
        })
      : [];
    // ปิดใบซ่อม (CLOSED) สร้าง ExpenseDocument (payer SHOP) / OtherIncome (payer CUSTOMER)
    // โดยไม่มี marker ทดสอบ — โดเมน expenses/other-income กรองด้วย note marker จึงมองไม่เห็น
    // ⇒ ตามจาก FK ตรงบนใบซ่อม (expenseDocumentId/otherIncomeId — @unique ทั้งคู่) แล้วกวาด
    // ด้วยลำดับเดียวกับสองโดเมนนั้นเป๊ะ (JE hard-delete ก่อน แล้วค่อย soft-delete เอกสาร)
    const expenseIds = rows.map((r) => r.expenseDocumentId).filter((x): x is string => !!x);
    const otherIncomeIds = rows.map((r) => r.otherIncomeId).filter((x): x is string => !!x);
    const expenseDocs = expenseIds.length
      ? await ctx.prisma.expenseDocument.findMany({
          where: { id: { in: expenseIds }, deletedAt: null },
          select: { id: true, number: true, journalEntryId: true },
        })
      : [];
    const oiMarked = otherIncomeIds.length
      ? await ctx.prisma.otherIncome.findMany({
          where: { id: { in: otherIncomeIds }, deletedAt: null },
          select: { id: true, docNumber: true, journalEntryId: true },
        })
      : [];
    // mirror other-income.seed.ts: ใบกลับรายการ (-R) เขียนทับ customerNote ⇒ ตามด้วย FK reversesId
    const oiReversals = oiMarked.length
      ? await ctx.prisma.otherIncome.findMany({
          where: { reversesId: { in: oiMarked.map((d) => d.id) }, deletedAt: null },
          select: { id: true, docNumber: true, journalEntryId: true },
        })
      : [];
    const oiDocs = [...oiMarked, ...oiReversals];
    const expenseJeIds = expenseDocs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    const oiJeIds = oiDocs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const r of rows) {
      const logCount = logs.filter((l) => l.ticketId === r.id).length;
      const extra = [
        r.expenseDocumentId ? 'มีใบค่าใช้จ่าย (กวาดด้วย)' : '',
        r.otherIncomeId ? 'มีใบรายได้อื่น (กวาดด้วย)' : '',
        r.replacementContractId ? 'มีสัญญาทดแทน' : '',
        logCount ? `log สถานะ ${logCount} รายการ (ลบถาวร)` : '',
      ]
        .filter(Boolean)
        .join(' + ');
      console.log(`     ${r.ticketNumber}${extra ? ` (${extra})` : ''}`);
    }
    // เอกสารพวกนี้ไม่มี marker — บรรทัดนี้คือช่องทางเดียวที่ผู้รันเห็นเลขเอกสารก่อนมันถูกกวาด
    // ⇒ พิมพ์เสมอทั้ง dry-run และ live
    for (const d of expenseDocs)
      console.log(`     ใบค่าใช้จ่ายจากใบซ่อม ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    for (const d of oiDocs)
      console.log(`     ใบรายได้อื่นจากใบซ่อม ${d.docNumber}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        // FK expenseDocumentId/otherIncomeId อยู่ฝั่ง repair_tickets (ON DELETE SET NULL) และ
        // เอกสารถูก soft delete เท่านั้น ⇒ constraint ไม่มีวันทำงาน — คง FK บนใบซ่อมไว้เป็น
        // ร่องรอยตรวจย้อน (ใบซ่อมเองก็ถูก soft delete ในรอบเดียวกัน)
        if (expenseDocs.length) {
          if (expenseJeIds.length) {
            await tx.journalPostAuditLog.deleteMany({
              where: { journalEntryId: { in: expenseJeIds } },
            });
            await tx.expenseDocument.updateMany({
              where: { id: { in: expenseDocs.map((d) => d.id) } },
              data: { journalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: expenseJeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: expenseJeIds } } });
          }
          await tx.expenseDocument.updateMany({
            where: { id: { in: expenseDocs.map((d) => d.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (oiDocs.length) {
          if (oiJeIds.length) {
            await tx.journalPostAuditLog.deleteMany({
              where: { journalEntryId: { in: oiJeIds } },
            });
            await tx.otherIncome.updateMany({
              where: { id: { in: oiDocs.map((d) => d.id) } },
              data: { journalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: oiJeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: oiJeIds } } });
          }
          await tx.otherIncome.updateMany({
            where: { id: { in: oiDocs.map((d) => d.id) } },
            data: { deletedAt: new Date() },
          });
        }
        // RepairStatusLog ไม่มี deletedAt (เป็น log) ⇒ hard · RepairTicket มี ⇒ soft
        await tx.repairStatusLog.deleteMany({ where: { ticketId: { in: rows.map((r) => r.id) } } });
        await tx.repairTicket.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: {
        ใบซ่อม: rows.length,
        'log สถานะใบซ่อม (ลบถาวร)': logs.length,
        'ใบค่าใช้จ่ายจากใบซ่อม (ไม่มี marker — ตามจาก FK)': expenseDocs.length,
        'ใบรายได้อื่นจากใบซ่อม (ไม่มี marker — ตามจาก FK)': oiDocs.length,
        'รายการบัญชีของเอกสารใบซ่อม (ลบถาวร)': expenseJeIds.length + oiJeIds.length,
      },
      warnings: rows.some((r) => r.replacementContractId)
        ? [
            'ใบซ่อมบางใบผูกสัญญาทดแทน (replacementContractId) จาก flow เปลี่ยนเครื่อง — สัญญานั้นไม่มี marker ทดสอบและ cleanup นี้ไม่แตะ ต้องยกเลิกในหน้าจอเอง',
          ]
        : [],
    };
  },
};
