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
    // กุญแจกวาดค่าคอมคือ "บริษัททดสอบทุกแถว" รวมที่เคยถูก soft delete ไปรอบก่อน —
    // ค่าคอมไม่มี marker ของตัวเอง ตามได้จาก FK externalFinanceCompanyId (required) เท่านั้น
    // ถ้ากรอง deletedAt ตรงนี้ ค่าคอมที่อ้างบริษัทซึ่งถูกล้างไปแล้วจะเป็นกำพร้าตลอดกาล
    const companies = await ctx.prisma.externalFinanceCompany.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX } },
      select: { id: true, name: true, deletedAt: true },
    });
    const liveCompanies = companies.filter((c) => !c.deletedAt);
    for (const c of liveCompanies) console.log(`     "${c.name}"`);

    // ค่าคอมที่ staff คีย์มือระหว่างเทส (accrue → external-finance-commission.service.ts)
    // อ้างบริษัททดสอบด้วย FK ตรง — แถวมี journalEntryId ได้ ⇒ ต้องกวาด JE ของมันด้วย
    // ไม่งั้นใบ JE ค้างในสมุดถาวรหลังบริษัททดสอบหายไปแล้ว
    const commissionName = new Map(companies.map((c) => [c.id, c.name]));
    const commissions = companies.length
      ? await ctx.prisma.externalFinanceCommission.findMany({
          where: {
            externalFinanceCompanyId: { in: companies.map((c) => c.id) },
            deletedAt: null,
          },
          select: {
            id: true,
            externalFinanceCompanyId: true,
            commissionAmount: true,
            status: true,
            journalEntryId: true,
          },
        })
      : [];
    const jeIds = commissions.map((c) => c.journalEntryId).filter((x): x is string => !!x);
    // ค่าคอมไม่มี marker ติดตัว — บรรทัดนี้คือช่องทางเดียวที่ผู้รันเห็น identity ของมันก่อน
    // ถูกกวาด ⇒ พิมพ์เสมอทั้ง dry-run และ live
    for (const c of commissions) {
      console.log(
        `     ค่าคอมไฟแนนซ์ภายนอก ฿${c.commissionAmount.toFixed(2)} · ${c.status} · "${
          commissionName.get(c.externalFinanceCompanyId) ?? c.externalFinanceCompanyId
        }"${c.journalEntryId ? ' (มี JE — ลบถาวร)' : ''}`,
      );
    }

    if (!dryRun && (liveCompanies.length || commissions.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        if (commissions.length) {
          // ลำดับกวาด JE เดียวกับ repair.seed.ts เป๊ะ: audit log → ปลด FK บนแถวเจ้าของ →
          // journal_lines → journal_entries — สลับลำดับ = abort ทั้ง tx บน DB จริง
          if (jeIds.length) {
            await tx.journalPostAuditLog.deleteMany({
              where: { journalEntryId: { in: jeIds } },
            });
            await tx.externalFinanceCommission.updateMany({
              where: { id: { in: commissions.map((c) => c.id) } },
              data: { journalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
          }
          await tx.externalFinanceCommission.updateMany({
            where: { id: { in: commissions.map((c) => c.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (liveCompanies.length) {
          await tx.externalFinanceCompany.updateMany({
            where: { id: { in: liveCompanies.map((c) => c.id) } },
            data: { deletedAt: new Date() },
          });
        }
      });
    }
    return {
      removed: {
        บริษัทไฟแนนซ์ภายนอก: liveCompanies.length,
        'ค่าคอมไฟแนนซ์ภายนอก (ไม่มี marker — ตามจาก FK บริษัท)': commissions.length,
        'รายการบัญชีของค่าคอมไฟแนนซ์ (ลบถาวร)': jeIds.length,
      },
      warnings: liveCompanies.length
        ? [
            'ตาราง external_finance_companies อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้จะรอดข้าม factory reset ไปปนทะเบียนจริงตอนใช้งานจริง',
          ]
        : [],
    };
  },
};
