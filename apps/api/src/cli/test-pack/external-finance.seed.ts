import { Prisma } from '@prisma/client';

import { TEST_NAME_PREFIX, testName, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * สร้างเฉพาะ "ทะเบียนบริษัทไฟแนนซ์ภายนอก"
 * ใบขาย + FinanceReceivable ต้องเกิดจาก SaleWriterService ในเฟส 3 เท่านั้น (R2)
 * เพราะการขายผ่านไฟแนนซ์ภายนอกโพสต์ Dr S11-3101 และการรับเงินโพสต์ Dr S51-1106 —
 * และ FinanceReceivable.receivedAmount เป็นการเซ็ตทับ (JE คิดจากส่วนต่าง) ⇒ ยอดที่ seed
 * ตรง ๆ ไม่มีวันขึ้นสมุด
 */
const ROWS: Array<{ name: string; rate: number }> = [
  { name: 'ไฟแนนซ์ภายนอก ก', rate: 0.05 },
  { name: 'ไฟแนนซ์ภายนอก ข', rate: 0.08 },
];

export const externalFinanceSeeder: DomainSeeder = {
  key: 'external-finance',
  label: 'บริษัทไฟแนนซ์ภายนอก',
  routes: ['/external-finance-companies/:id', '/finance-receivable'],
  markerDoc: `ExternalFinanceCompany.name ขึ้นต้น "${TEST_NAME_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: testName(r.name),
      detail: `ค่าธรรมเนียมตั้งต้น ${(r.rate * 100).toFixed(0)}% — ลูกหนี้จะเกิดตอนขายจริงในเฟส 3`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    for (const r of ROWS) {
      const name = testName(r.name);
      // name เป็น @unique เต็มตาราง (ไม่ใช่ partial) — แถวที่ cleanup soft delete ไปแล้ว
      // ยังถือชื่ออยู่ ⇒ probe โดยไม่กรอง deletedAt แล้ว "กู้คืน" แทนการสร้างซ้ำ
      // ไม่งั้น seed หลัง cleanup ชน P2002
      const any = await ctx.prisma.externalFinanceCompany.findUnique({
        where: { name },
        select: { id: true, deletedAt: true },
      });
      if (any && !any.deletedAt) {
        stat.skipped += 1;
        continue;
      }
      if (any) {
        // กู้คืน + รีเซ็ตกลับค่าตั้งต้น — ผู้ทดสอบอาจแก้อัตรา/เบอร์/โน้ตไปก่อนถูกล้าง
        await ctx.prisma.externalFinanceCompany.update({
          where: { id: any.id },
          data: {
            deletedAt: null,
            isActive: true,
            defaultCommissionRate: new Prisma.Decimal(r.rate),
            contactPhone: '021230000',
            notes: testNote('บริษัทไฟแนนซ์สำหรับทดสอบ — ลบได้'),
          },
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืน "${name}" ที่เคยถูกล้าง (ชื่อเป็น unique เต็มตาราง — แถวกู้คืนนับเป็น skipped ไม่ใช่ created)`,
        );
        continue;
      }
      await ctx.prisma.externalFinanceCompany.create({
        data: {
          name,
          defaultCommissionRate: new Prisma.Decimal(r.rate),
          contactPhone: '021230000',
          notes: testNote('บริษัทไฟแนนซ์สำหรับทดสอบ — ลบได้'),
        },
      });
      stat.created += 1;
    }
    stat.notes.push(
      'ลูกหนี้ไฟแนนซ์ (/finance-receivable) จะมีของก็ต่อเมื่อรันด้วย DRIVE=1 หรือขายผ่านหน้าจอ POS เอง',
    );
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.externalFinanceCompany.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const r of rows) console.log(`     "${r.name}"`);
    if (!dryRun && rows.length) {
      await ctx.prisma.externalFinanceCompany.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { บริษัทไฟแนนซ์ภายนอก: rows.length },
      warnings: rows.length
        ? [
            'ตาราง external_finance_companies อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้จะรอดข้าม factory reset ไปปนทะเบียนจริงตอนใช้งานจริง',
          ]
        : [],
    };
  },
};
