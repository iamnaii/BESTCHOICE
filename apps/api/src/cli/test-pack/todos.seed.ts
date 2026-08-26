import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';
import { TEST_NOTE_MARKER, testNote } from './_context';

/** 3 สถานะหลักของกระดานงาน + หนึ่งใบเลยกำหนดเพื่อดูป้ายเตือน */
const ROWS: Array<{
  title: string;
  status: 'TODO' | 'DOING' | 'REVIEW';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  dueInDays: number;
}> = [
  { title: 'ตรวจสลิปลูกค้าค้างชำระ', status: 'TODO', priority: 'HIGH', dueInDays: -2 },
  { title: 'ตามเอกสารซัพพลายเออร์', status: 'DOING', priority: 'MEDIUM', dueInDays: 3 },
  { title: 'สรุปยอดขายประจำสัปดาห์', status: 'REVIEW', priority: 'LOW', dueInDays: 7 },
];

const titleOf = (t: string) => testNote(t);

export const todosSeeder: DomainSeeder = {
  key: 'todos',
  label: 'กระดานงาน (Todo)',
  routes: ['/todos'],
  markerDoc: `Todo.title ขึ้นต้นด้วย "${TEST_NOTE_MARKER}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: titleOf(r.title),
      detail: `${r.status} · ${r.priority} · ครบกำหนดใน ${r.dueInDays} วัน`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    for (const r of ROWS) {
      const title = titleOf(r.title);
      const exists = await ctx.prisma.todo.findFirst({
        where: { title, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.todo.create({
        data: {
          title,
          description: testNote('ใบงานสำหรับทดสอบระบบ — ลบได้'),
          status: r.status,
          priority: r.priority,
          dueDate: new Date(ctx.today.getTime() + r.dueInDays * 24 * 60 * 60 * 1000),
          createdById: ctx.refs.reviewerId,
          assigneeId: ctx.refs.salespersonId,
          branchId: ctx.refs.branchId,
          tags: ['ทดสอบระบบ'],
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const where = { title: { startsWith: TEST_NOTE_MARKER }, deletedAt: null } as const;
    const rows = await ctx.prisma.todo.findMany({ where, select: { id: true, title: true } });
    if (!dryRun && rows.length) {
      await ctx.prisma.todo.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return { removed: { ใบงาน: rows.length }, warnings: [] };
  },
};
