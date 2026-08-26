import { TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * คำขอเปลี่ยนเครื่อง 1 ใบ สถานะรออนุมัติ
 * R2 — ห้าม finalize (finalize โพสต์ JE ชุด A.1-A.5 + SHOP leg)
 *
 * ใบที่ seed ไม่ระบุ mode ⇒ default PRICED โดยไม่มี snapshot แผนผ่อน — ตรงกับรูป
 * "legacy in-flight PENDING" ที่ approvePriced รองรับอยู่แล้ว (`usedSnapshot =
 * req.newTotalMonths != null` เป็น false ⇒ clone งวดคงเหลือจากสัญญาเดิม) จึงกดอนุมัติ
 * จากหน้าจอได้จริงโดยไม่ crash
 */
export const deviceSwapSeeder: DomainSeeder = {
  key: 'device-swap',
  label: 'คำขอเปลี่ยนเครื่อง',
  routes: ['/defect-exchange', '/insurance/exchange-requests', '/insurance/exchange-request/new'],
  // ⚠ โมเดลนี้ไม่มีฟิลด์ชื่อ `reason` — ช่องข้อความที่มีจริงคือ conditionNote /
  // rejectionReason / cancelReason · เลือก conditionNote เพราะเป็นคำบรรยายสภาพเครื่อง
  // ตอนยื่นคำขอ (สองตัวหลังถูกเขียนโดย flow ปฏิเสธ/ยกเลิก ไม่ใช่ตอนสร้าง)
  markerDoc: `ContractExchangeRequest.conditionNote ขึ้นต้นด้วย "${TEST_NOTE_MARKER}"`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const contract = await ctx.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: 'TEST-' }, status: 'ACTIVE', deletedAt: null },
      select: { contractNumber: true },
      orderBy: { contractNumber: 'asc' },
    });
    return contract
      ? [{ label: 'คำขอเปลี่ยนเครื่อง', detail: `รออนุมัติ · สัญญา ${contract.contractNumber}` }]
      : [{ label: 'ข้าม', detail: 'ยังไม่มีสัญญาทดสอบสถานะ ACTIVE (รันโดเมน contracts ก่อน)' }];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const contract = await ctx.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: 'TEST-' }, status: 'ACTIVE', deletedAt: null },
      select: { id: true, productId: true },
      orderBy: { contractNumber: 'asc' },
    });
    // เครื่องปลายทางของ swap ต้องเป็นมือถือ ไม่ใช่หูฟังทดสอบ (เครื่องว่างของโดเมน contracts
    // มี ACCESSORY ปนอยู่) + orderBy ให้ได้เครื่องเดิมทุกรอบ
    const newProduct = await ctx.prisma.product.findFirst({
      where: {
        imeiSerial: { startsWith: 'TEST-' },
        status: 'IN_STOCK',
        category: { in: ['PHONE_NEW', 'PHONE_USED'] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!contract?.productId || !newProduct) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ต้องมีสัญญาทดสอบ ACTIVE ที่ผูกเครื่อง + มือถือทดสอบ IN_STOCK 1 เครื่อง (รันโดเมน contracts ก่อน)',
      );
      return stat;
    }
    const conditionNote = testNote('คำขอเปลี่ยนเครื่องสำหรับทดสอบ — เครื่องเดิมมีตำหนิ');
    const exists = await ctx.prisma.contractExchangeRequest.findFirst({
      where: { conditionNote, deletedAt: null },
      select: { id: true },
    });
    if (exists) {
      stat.skipped += 1;
      return stat;
    }
    await ctx.prisma.contractExchangeRequest.create({
      data: {
        oldContractId: contract.id,
        oldProductId: contract.productId,
        newProductId: newProduct.id,
        requestedById: ctx.refs.salespersonId,
        conditionNote,
        deviceCondition: 'B',
      },
    });
    stat.created += 1;
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.contractExchangeRequest.findMany({
      where: { conditionNote: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, status: true, newContractId: true },
    });
    // ใบที่ถูกอนุมัติแล้วมีสัญญาใหม่ EXCH- (ไม่มี marker) เกาะอยู่ — soft delete คำขอตอนนี้
    // จะตัดเส้นทางยกเลิกเปลี่ยนเครื่องของหน้าจอ (ExchangeCancelService หา request ไม่เจอ)
    // ทิ้งสัญญา EXCH- ค้างถาวร ⇒ ข้ามใบพวกนี้พร้อมเตือน ให้คนกดยกเลิกในหน้าจอก่อนแล้วล้างซ้ำ
    const blocked = rows.filter((r) => r.newContractId);
    const sweepable = rows.filter((r) => !r.newContractId);
    for (const r of rows)
      console.log(
        `     คำขอ ${r.id} [${r.status}]${r.newContractId ? ' — มีสัญญาใหม่เกาะอยู่ (ข้าม ไม่ล้าง)' : ''}`,
      );
    if (!dryRun && sweepable.length) {
      await ctx.prisma.contractExchangeRequest.updateMany({
        where: { id: { in: sweepable.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { คำขอเปลี่ยนเครื่อง: sweepable.length },
      warnings: blocked.map(
        (r) =>
          `คำขอ ${r.id} ถูกอนุมัติไปแล้ว (สัญญาใหม่ ${r.newContractId}) — ไม่ล้างให้ เพราะสัญญา EXCH- ไม่มี marker ทดสอบ: กดยกเลิกเปลี่ยนเครื่องในหน้าจอก่อน แล้วรัน cleanup ซ้ำ`,
      ),
    };
  },
};
