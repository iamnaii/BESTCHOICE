/**
 * ล้างชุดข้อมูลทดสอบทั้งระบบ — คู่กับ seed-test-pack.cli.ts
 *
 * เดิน cleanup ของแต่ละโดเมน "ย้อนลำดับการสร้าง" เพราะโดเมนหลังถือ FK ของโดเมนหน้า
 * พิมพ์รายการที่จะลบทั้งสองโหมด — dry-run คือด่านสุดท้ายของคนกดก่อนยืนยัน
 *
 * Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack
 * Live:     CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *           [ALLOW_PROD_CLEANUP=YES_I_AM_SURE NODE_ENV=production] [DOMAINS=a,b] \
 *           npm --prefix apps/api run cleanup:test-pack
 */
import { PrismaService } from '../prisma/prisma.service';
import { bkkDateStr, bkkMidnight, resolveRefs } from './test-pack/_context';
import { ALL_DOMAINS, orderForCleanup, selectDomains } from './test-pack/_registry';
import type { DomainSeeder, SeedContext, SeedRefs } from './test-pack/_types';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error(
      'Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run cleanup:test-pack',
    );
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_CLEANUP !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[cleanup-test-pack] DRY-RUN mode (default). To remove, re-run with:');
    console.log(
      `  CONFIRM_CLEANUP=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}] npm --prefix apps/api run cleanup:test-pack`,
    );
    console.log('');
  }
  if (
    !dryRun &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_CLEANUP !== REQUIRED_CONSENT
  ) {
    console.error(
      `ERROR: Refusing to clean up in NODE_ENV=production without ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}`,
    );
    process.exit(1);
  }

  let domains: DomainSeeder[];
  try {
    domains = orderForCleanup(selectDomains(ALL_DOMAINS, process.env.DOMAINS));
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(
      `ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `[cleanup-test-pack] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'} | โดเมน: ${domains.length}`,
  );
  console.log('');

  const failures: string[] = [];
  const allWarnings: string[] = [];
  const grandTotal: Record<string, number> = {};

  try {
    const now = new Date();
    // S5 (2026-08-26): cleanup ทั้ง 19 โดเมนไม่อ่าน ctx.refs เลย (ยืนยันด้วย sweep ทุกไฟล์)
    // — resolveRefs โยนข้อความฝั่ง "สร้าง" เมื่อขาด SALES/OWNER/สาขา ซึ่งเคยบล็อกการล้าง
    // ทั้งชุดเพราะ precondition ที่มันไม่ได้ใช้ (เช่น ปิดบัญชีผู้ใช้ SALES ทดสอบไปแล้ว).
    // จึง resolve แบบ best-effort: ได้ก็ใช้ ไม่ได้ก็เดินต่อด้วยค่าว่าง.
    // ⚠️ ถ้าวันหนึ่ง cleanup ของโดเมนไหนต้องอ่าน refs จริง ต้องเช็คค่าว่างเองก่อนใช้
    let refs: SeedRefs;
    try {
      refs = await resolveRefs(prisma);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[cleanup-test-pack] ℹ ข้อมูลอ้างอิงไม่ครบ (${msg})`);
      console.log(
        '[cleanup-test-pack] ℹ เดินต่อได้ — cleanup ค้นหาข้อมูลทดสอบจาก marker เท่านั้น ไม่ใช้ข้อมูลอ้างอิงชุดนี้',
      );
      console.log('');
      refs = {
        branchId: '',
        branchName: '',
        secondBranchId: null,
        salespersonId: '',
        reviewerId: '',
        ownerId: '',
        shopCompanyId: null,
        financeCompanyId: null,
      };
    }
    const ctx: SeedContext = {
      prisma,
      refs,
      dryRun,
      today: bkkMidnight(now),
      dateStr: bkkDateStr(now),
    };

    for (const d of domains) {
      console.log(`── ${d.label} (${d.key})`);
      try {
        const stat = await d.cleanup(ctx, dryRun);
        const entries = Object.entries(stat.removed).filter(([, n]) => n > 0);
        if (!entries.length) {
          console.log('   ไม่พบข้อมูลทดสอบ');
        } else {
          for (const [what, n] of entries) {
            console.log(`   ${dryRun ? 'จะลบ' : 'ลบแล้ว'} ${what}: ${n}`);
            grandTotal[what] = (grandTotal[what] ?? 0) + n;
          }
        }
        for (const w of stat.warnings) {
          console.log(`   ⚠️  ${w}`);
          allWarnings.push(`${d.label}: ${w}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${d.key}: ${msg}`);
        console.log(`   ✗ ล้มเหลว — ${msg}`);
      }
      console.log('');
    }

    console.log('[cleanup-test-pack] ===== SUMMARY =====');
    const total = Object.values(grandTotal).reduce((a, b) => a + b, 0);
    console.log(`  ${dryRun ? 'จะลบทั้งหมด' : 'ลบแล้วทั้งหมด'} : ${total} แถว`);
    for (const [what, n] of Object.entries(grandTotal)) console.log(`    ${what}: ${n}`);
    if (allWarnings.length) {
      console.log('');
      console.log('  ⚠️  คำเตือน:');
      for (const w of allWarnings) console.log(`    - ${w}`);
    }
    if (failures.length) {
      console.log(`  ล้มเหลว : ${failures.length} โดเมน`);
      for (const f of failures) console.log(`    - ${f}`);
    }
    console.log('');
    console.log('  ของที่ล้างไม่ได้โดยธรรมชาติ: audit_logs (immutable) · ช่องว่างของเลขเอกสาร');
    if (dryRun) {
      console.log('');
      console.log(`  ตรวจรายการข้างบนแล้วค่อยรันจริงด้วย CONFIRM_CLEANUP=${REQUIRED_CONSENT}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  if (failures.length) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[cleanup-test-pack] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
