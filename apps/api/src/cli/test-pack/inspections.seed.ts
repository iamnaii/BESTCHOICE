import { TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

export const inspectionsSeeder: DomainSeeder = {
  key: 'inspections',
  label: 'ใบตรวจสภาพเครื่อง',
  routes: ['/inspections', '/inspections/:id'],
  markerDoc: `Inspection.notes ขึ้นต้นด้วย "${TEST_NOTE_MARKER}"`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const template = await ctx.prisma.inspectionTemplate.findFirst({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!template)
      return [
        {
          label: 'ข้าม',
          detail: 'ยังไม่มี InspectionTemplate ในระบบ (Inspection.templateId บังคับ)',
        },
      ];
    return [
      { label: 'ใบตรวจ 1', detail: `ใช้เทมเพลต "${template.name}" — รอตรวจ` },
      { label: 'ใบตรวจ 2', detail: `ใช้เทมเพลต "${template.name}" — ตรวจแล้ว (เกรด B)` },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const [template, products] = await Promise.all([
      ctx.prisma.inspectionTemplate.findFirst({
        where: { deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      ctx.prisma.product.findMany({
        where: { imeiSerial: { startsWith: 'TEST-' }, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 2,
      }),
    ]);
    if (!template) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ยังไม่มี InspectionTemplate (Inspection.templateId บังคับ) สร้างเทมเพลตในหน้าตั้งค่าก่อน',
      );
      return stat;
    }
    if (products.length < 2) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ต้องมีเครื่องทดสอบอย่างน้อย 2 เครื่อง (รันโดเมน contracts ก่อน)',
      );
      return stat;
    }
    for (const [i, p] of products.entries()) {
      const notes = testNote(`ใบตรวจสภาพ/${i + 1}`);
      const exists = await ctx.prisma.inspection.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // ใบที่สอง = ตรวจเสร็จแล้ว (ให้ตรงกับ plan) — Inspection ไม่โพสต์อะไร สถานะไหนก็ได้
      const done = i === 1;
      await ctx.prisma.inspection.create({
        data: {
          productId: p.id,
          templateId: template.id,
          inspectorId: ctx.refs.salespersonId,
          notes,
          ...(done
            ? { isCompleted: true, inspectedAt: ctx.today, overallGrade: 'B' as const }
            : {}),
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.inspection.findMany({
      where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, notes: true },
    });
    // ผลตรวจรายข้อเกิดตอนผู้ทดสอบกรอกผลผ่านหน้าจอ — ไม่มี marker ติดตัว ตามได้จาก FK
    // inspectionId เท่านั้น ⇒ พิมพ์ identity ให้คนสั่งล้างเห็น (ทั้ง dry-run และของจริง)
    const results = rows.length
      ? await ctx.prisma.inspectionResult.findMany({
          where: { inspectionId: { in: rows.map((r) => r.id) }, deletedAt: null },
          select: { id: true, inspectionId: true },
        })
      : [];
    for (const r of rows) {
      const n = results.filter((x) => x.inspectionId === r.id).length;
      console.log(`     ${r.notes ?? r.id}${n ? ` (ผลตรวจรายข้อ ${n} ข้อ)` : ''}`);
    }
    if (!dryRun && rows.length) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        // InspectionResult มี deletedAt เหมือนกัน ⇒ soft ทั้งคู่
        await tx.inspectionResult.updateMany({
          where: { inspectionId: { in: rows.map((r) => r.id) } },
          data: { deletedAt: now },
        });
        await tx.inspection.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: now },
        });
      });
    }
    return { removed: { ใบตรวจสภาพ: rows.length, ผลตรวจรายข้อ: results.length }, warnings: [] };
  },
};
