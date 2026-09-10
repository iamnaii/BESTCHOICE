/**
 * เติม users.accessible_companies / users.primary_company ให้แถวที่ยังว่าง (เลเยอร์ 1 ของ hotfix
 * user-company-access lockout)
 *
 * WHY
 * ---
 * `accessibleCompanies String[] @default([])` ไม่เคยมีเส้นทางไหนเขียนค่าให้เลย พอฝั่ง web (PR #1541)
 * เอาไปกรอง work zone ทุกคนจึงเห็นหน้าจอ "ไม่มีสิทธิ์เข้าถึงบริษัท" ตัว hotfix แก้ที่ตรรกะแล้ว
 * (array ว่าง = "ยังไม่ตั้งค่า" → resolve เป็นค่า default ของ role) ดังนั้น CLI ตัวนี้ **ไม่ใช่**
 * ตัวดับ outage — มันแค่ทำให้ข้อมูลในฐานตรงกับสิ่งที่ตรรกะ resolve ให้อยู่แล้ว
 *
 * ลำดับสำคัญ: ต้องรัน **หลัง** deploy โค้ดชุดนี้เท่านั้น ถ้ารัน CLI เวอร์ชันเก่า (ROLE_ACCESS_MAP เดิม)
 * มันจะเขียน FINANCE_MANAGER = ['FINANCE'] และ VIEWER = ['SHOP'] ซึ่งผิด และเมื่อคอลัมน์กลายเป็น
 * non-empty แล้ว fallback จะไม่ทำงานอีก = ค่าผิดกลายเป็นค่าถาวร ดู
 * docs/runbooks/2026-09-10-user-companies-backfill-runbook.md
 *
 * GUARDS (ตระกูล CONFIRM_BACKFILL เหมือน backfill-payment-receipts.cli.ts)
 * ------
 * - EXPECTED_DB_NAME บังคับ; ต้องตรงกับ SELECT current_database() → ไม่ตรง exit 1
 * - DRY-RUN เป็นค่าเริ่มต้น: พิมพ์แผนอย่างเดียว ไม่เขียนอะไรเลย
 * - CONFIRM_BACKFILL=YES_I_AM_SURE → เขียนจริง
 * - แตะ prod (NODE_ENV=production **หรือ** ฐานชื่อ `bestchoice`) ต้องมี ALLOW_PROD_BACKFILL ด้วย
 * - หน่วง 5 วินาทีก่อนเขียนจริง
 * - idempotent: query เลือกเฉพาะแถวที่ accessible_companies ยังว่าง และ updateMany ยังกันซ้ำอีกชั้น
 *
 * PRODUCTION INVOCATION
 * ---------------------
 *   Dry-run:  EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run backfill:user-companies
 *   Live:     CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice \
 *             ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production \
 *             npm --prefix apps/api run backfill:user-companies
 */

import { PrismaClient } from '@prisma/client';
import { ROLE_COMPANY_ACCESS, roleCompanyAccess } from '@installment/shared';

// map เดิมของไฟล์นี้ (ROLE_ACCESS_MAP) ถูกลบทิ้ง — source of truth มีชุดเดียวที่
// packages/shared/src/company-access.ts และถูกใช้ร่วมกับ JwtStrategy / EntityScope / เมนูฝั่ง web
// ถ้ามี map ตัวที่สองในไฟล์นี้อีก backfill จะเขียนค่าที่ไม่ตรงกับสิ่งที่ระบบ resolve ให้ตอน runtime
export { ROLE_COMPANY_ACCESS, roleCompanyAccess };

const TAG = '[backfill-user-companies]';
const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const SAMPLE_SIZE = 5;
const BATCH_SIZE = 100;
const LABEL_WIDTH = 22;

// ชื่อฐาน prod จริงคือ `bestchoice` (docs/guides/FULL-SYSTEM-TEST-CHECKLIST/README.md:30)
// ไม่ใช่ `bestchoice_prod` ที่ backfill 3 ตัวในบ้านเดาไว้ — guard ของสามตัวนั้นจึงไม่เคยยิงเลย
const PROD_DB_NAME = 'bestchoice';

// ─── ตรรกะล้วน (export ไว้ให้เทสต์เรียกโดยไม่ต้องต่อ DB) ────────────────────────

export interface BackfillCandidate {
  id: string;
  email: string;
  role: string;
}

export interface PlannedUpdate extends BackfillCandidate {
  accessible: string[];
  primary: string;
}

export interface RoleCount {
  role: string;
  count: number;
}

/** แปลงแถวที่ยังว่างเป็นค่าที่จะเขียน — derive จาก role ผ่าน source of truth ตัวเดียวเสมอ */
export function planUserCompanyUpdates(users: readonly BackfillCandidate[]): PlannedUpdate[] {
  return users.map((u) => {
    const access = roleCompanyAccess(u.role);
    return { ...u, accessible: [...access.accessible], primary: access.primary };
  });
}

/**
 * นับจำนวนต่อ role เรียงตามลำดับใน ROLE_COMPANY_ACCESS (role แปลกปลอมต่อท้ายแบบเรียงตัวอักษร)
 * `roleOrder` ใช้ตอนทำบล็อก RESULT เพื่อบังคับให้ label ตรงกับ SUMMARY บรรทัดต่อบรรทัด
 * แม้บาง role จะอัปเดตได้ 0 แถว
 */
export function countByRole(
  plan: readonly PlannedUpdate[],
  roleOrder?: readonly string[],
): RoleCount[] {
  const tally = new Map<string, number>();
  for (const p of plan) tally.set(p.role, (tally.get(p.role) ?? 0) + 1);

  const order =
    roleOrder ??
    [
      ...Object.keys(ROLE_COMPANY_ACCESS).filter((r) => tally.has(r)),
      ...[...tally.keys()].filter((r) => !(r in ROLE_COMPANY_ACCESS)).sort(),
    ];

  return order.map((role) => ({ role, count: tally.get(role) ?? 0 }));
}

/**
 * บล็อกสรุปหนึ่งก้อน — ใช้ฟังก์ชันเดียวกันทั้ง SUMMARY (แผน) และ RESULT (ผลจริง)
 * เพื่อให้สองบล็อกอ่านเทียบกันได้บรรทัดต่อบรรทัดใน Cloud Logging ที่มี log ปนกัน
 */
export function formatCountBlock(
  heading: string,
  counts: readonly RoleCount[],
  totalSuffix = '',
): string[] {
  const lines = [`${TAG} ===== ${heading} =====`];
  for (const { role, count } of counts) {
    lines.push(`${TAG}   ${role.padEnd(LABEL_WIDTH)}: ${count}`);
  }
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  lines.push(`${TAG}   ${'total'.padEnd(LABEL_WIDTH)}: ${total}${totalSuffix}`);
  return lines;
}

/** ตัวอย่างไม่เกิน SAMPLE_SIZE แถว + บรรทัด "... and N more" เพื่อให้เห็นของจริงก่อนกดเขียน */
export function formatSampleLines(plan: readonly PlannedUpdate[]): string[] {
  const lines = plan
    .slice(0, SAMPLE_SIZE)
    .map(
      (p) =>
        `${TAG}     ${p.email} (${p.role}) → accessible=[${p.accessible.join(',')}] primary=${p.primary}`,
    );
  if (plan.length > SAMPLE_SIZE) {
    lines.push(`${TAG}     ... and ${plan.length - SAMPLE_SIZE} more`);
  }
  return lines;
}

// ─── ตัวรันจริง (ทำงานเฉพาะตอนถูกเรียกตรง ๆ ไม่ใช่ตอน Jest import) ──────────────

async function main(): Promise<void> {
  // guard ราคาถูกก่อน — ยังไม่ต่อ DB
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error(`${TAG} ERROR: EXPECTED_DB_NAME required`);
    console.error(
      `${TAG} Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run backfill:user-companies`,
    );
    process.exit(1);
  }

  // DRY-RUN เป็นค่าเริ่มต้นเสมอ — ต้องออกแรงพิมพ์ consent ถึงจะเขียน
  const dryRun = process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT;

  const prisma = new PrismaClient();

  const [{ current_database: actualDb }] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`${TAG} ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // เช็ค **ทั้งสอง** เงื่อนไข: NODE_ENV อย่างเดียวมีรูตอนรันจาก laptop ผ่าน cloud-sql-proxy
  // (NODE_ENV ไม่ถูกตั้ง) ส่วนชื่อฐานอย่างเดียวก็พลาดได้ถ้ามีสำเนา prod ชื่ออื่น
  const touchingProd = process.env.NODE_ENV === 'production' || actualDb === PROD_DB_NAME;
  if (!dryRun && touchingProd && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error(
      `${TAG} ERROR: Refusing to write to production DB "${actualDb}" without ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`${TAG} DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  try {
    // ข้าม system user: system@bestchoice.internal ถูกสองที่แย่ง upsert ด้วย role ต่างกัน
    // (canned-response-sender = SALES, collections-foundation.seed = OWNER) การ derive จาก role
    // จึงให้ผลไม่แน่นอน — U4 เขียนค่าคงที่ให้ตอนสร้างแทน ส่วน legacy-import@bestchoice.com
    // ก็ไม่เคยล็อกอิน
    const candidates = await prisma.user.findMany({
      where: { accessibleCompanies: { equals: [] }, deletedAt: null, isSystemUser: false },
      select: { id: true, email: true, role: true },
      orderBy: { email: 'asc' },
    });

    const plan = planUserCompanyUpdates(candidates);
    const planCounts = countByRole(plan);

    console.log('');
    for (const line of formatCountBlock('SUMMARY', planCounts, dryRun ? '  (would-update)' : '')) {
      console.log(line);
    }
    for (const line of formatSampleLines(plan)) console.log(line);
    console.log('');

    // พิมพ์แผนก่อนเขียนเสมอ แล้วจึงตัดจบตรงนี้ตอน dry-run — ไม่มีเส้นทางไหนเขียนก่อนพิมพ์
    if (dryRun) {
      console.log(
        `${TAG} DRY-RUN — ยังไม่เขียนอะไร รันจริงด้วย CONFIRM_BACKFILL=${REQUIRED_CONSENT}`,
      );
      return;
    }
    if (plan.length === 0) {
      console.log(`${TAG} ไม่มีแถวที่ต้องอัปเดต — จบงาน`);
      return;
    }

    console.warn(`${TAG} LIVE prod run starting in 5s — Ctrl+C to abort.`);
    await new Promise((r) => setTimeout(r, 5000));

    const applied: PlannedUpdate[] = [];
    for (let i = 0; i < plan.length; i += BATCH_SIZE) {
      const batch = plan.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(async (tx) => {
        for (const p of batch) {
          // updateMany + เงื่อนไข "ยังว่างอยู่" ซ้ำอีกชั้น: ถ้ามีใครเขียนค่าให้แถวนี้ระหว่างที่เรา
          // สแกนกับที่เราเขียน (เช่น เจ้าตัวล็อกอินแล้ว U4 เขียนให้ตอนเปลี่ยน role) ให้ข้ามไป
          // ไม่ทับของใหม่ — และทำให้ตัวเลขในบล็อก RESULT เป็นจำนวนแถวที่เขียนจริง
          const { count } = await tx.user.updateMany({
            where: { id: p.id, accessibleCompanies: { equals: [] } },
            data: { accessibleCompanies: p.accessible, primaryCompany: p.primary },
          });
          if (count > 0) applied.push(p);
        }
      });
      console.log(`${TAG}   ...processed ${Math.min(i + BATCH_SIZE, plan.length)}/${plan.length}`);
    }

    console.log('');
    const resultCounts = countByRole(
      applied,
      planCounts.map((c) => c.role),
    );
    for (const line of formatCountBlock('RESULT', resultCounts)) console.log(line);
    const skipped = plan.length - applied.length;
    if (skipped > 0) {
      console.log(`${TAG}   ${'skipped (already set)'.padEnd(LABEL_WIDTH)}: ${skipped}`);
    }
    console.log('');
    console.log(`${TAG} Done.`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error(`${TAG} FATAL:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
