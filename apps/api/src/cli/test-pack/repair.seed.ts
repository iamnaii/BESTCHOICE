import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

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
  markerDoc: `RepairTicket.ticketNumber ขึ้นต้น "${TEST_DOC_PREFIX}"`,

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
    const prefix = `${TEST_DOC_PREFIX}RT-${ctx.dateStr}-`;
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
      where: { ticketNumber: { startsWith: `${TEST_DOC_PREFIX}RT-` }, deletedAt: null },
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
    for (const r of rows) {
      const logCount = logs.filter((l) => l.ticketId === r.id).length;
      const extra = [
        r.expenseDocumentId ? 'มีใบค่าใช้จ่าย' : '',
        r.otherIncomeId ? 'มีใบรายได้อื่น' : '',
        r.replacementContractId ? 'มีสัญญาทดแทน' : '',
        logCount ? `log สถานะ ${logCount} รายการ (ลบถาวร)` : '',
      ]
        .filter(Boolean)
        .join(' + ');
      console.log(`     ${r.ticketNumber}${extra ? ` (${extra})` : ''}`);
    }
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        // RepairStatusLog ไม่มี deletedAt (เป็น log) ⇒ hard · RepairTicket มี ⇒ soft
        await tx.repairStatusLog.deleteMany({ where: { ticketId: { in: rows.map((r) => r.id) } } });
        await tx.repairTicket.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: { ใบซ่อม: rows.length, 'log สถานะใบซ่อม (ลบถาวร)': logs.length },
      warnings: rows.some((r) => r.expenseDocumentId || r.otherIncomeId || r.replacementContractId)
        ? [
            'ใบซ่อมบางใบสร้างเอกสารบัญชี/สัญญาทดแทนไว้แล้ว (ตอนปิดใบหรือเปลี่ยนเครื่อง) — เอกสารเหล่านั้นไม่มี marker ทดสอบ ต้องยกเลิกในหน้าจอเอง',
          ]
        : [],
    };
  },
};
