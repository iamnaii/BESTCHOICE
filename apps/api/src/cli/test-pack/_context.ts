import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedRefs } from './_types';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER } from '../../utils/test-data-markers';

/** ค่าคงที่ marker ย้ายไป `src/utils/test-data-markers.ts` (แหล่งเดียวกับรั้ว/CLI ล้างคลัง) — re-export ให้ผู้เรียกเดิม */
export { TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER };

export const testNote = (what: string): string => `${TEST_NOTE_MARKER} ${what}`;
export const testName = (what: string): string => `${TEST_NAME_PREFIX} ${what}`;

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** YYYYMMDD ตามเวลาไทย — ไม่ขึ้นกับ TZ ของ runtime (Cloud Run Job เป็น UTC) */
export function bkkDateStr(now: Date): string {
  const t = new Date(now.getTime() + BKK_OFFSET_MS);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(
    t.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** เที่ยงคืนของวันไทยวันนั้น (เก็บเป็น UTC midnight ของวันเดียวกัน — พอสำหรับวันครบกำหนด) */
export function bkkMidnight(now: Date): Date {
  const t = new Date(now.getTime() + BKK_OFFSET_MS);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export async function resolveRefs(prisma: PrismaService): Promise<SeedRefs> {
  const [branches, sales, reviewer, owner, shopCo, financeCo] = await Promise.all([
    prisma.branch.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: 2,
    }),
    prisma.user.findFirst({
      where: { role: 'SALES', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
    // reviewer: เลือก BRANCH_MANAGER ก่อนเสมอ (คนละคนกับ ownerId โดยธรรมชาติ) แล้วค่อย fallback
    // เป็น OWNER เมื่อไม่มี BM เลย — ทุก query ใส่ orderBy ให้ได้คนเดิมทุกรอบ ไม่แล้วแต่ Postgres
    // ⚠️ interface นี้ **ไม่การันตี** ว่า reviewerId ≠ ownerId: ระบบที่มีผู้ใช้ OWNER คนเดียว
    // (ไม่มี BM) จะได้คนเดียวกันทั้งสองช่อง — โดเมนที่ต้องการ 4-eyes ต้องเช็คเองก่อนใช้
    (async () =>
      (await prisma.user.findFirst({
        where: { role: 'BRANCH_MANAGER', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })) ??
      prisma.user.findFirst({
        where: { role: 'OWNER', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }))(),
    prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    }),
    prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    }),
  ]);

  const missing: string[] = [];
  if (!branches.length) missing.push('สาขา');
  if (!sales) missing.push('ผู้ใช้ role SALES');
  if (!reviewer) missing.push('ผู้ใช้ role OWNER หรือ BRANCH_MANAGER');
  if (!owner) missing.push('ผู้ใช้ role OWNER');
  if (missing.length) {
    throw new Error(`สร้างข้อมูลทดสอบไม่ได้ — ขาดข้อมูลอ้างอิง: ${missing.join(', ')}`);
  }

  return {
    branchId: branches[0].id,
    branchName: branches[0].name,
    secondBranchId: branches[1]?.id ?? null,
    salespersonId: sales!.id,
    reviewerId: reviewer!.id,
    ownerId: owner!.id,
    shopCompanyId: shopCo?.id ?? null,
    financeCompanyId: financeCo?.id ?? null,
  };
}
