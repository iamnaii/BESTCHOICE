/**
 * สร้างชุดข้อมูลทดสอบทั้งระบบ — orchestrator ของ test-pack
 *
 * Spec: docs/superpowers/specs/2026-08-26-full-system-test-data-pack-design.md
 *
 * เฟส 1-2 (โดเมนทั้งหมดใน registry) เขียน Prisma ตรง — ไม่มี JE
 * เฟส 3 (DRIVE=1) เรียก service จริง — เพิ่มใน Task 12
 *
 * Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack
 * Live:     CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *           [ALLOW_PROD_SEED=YES_I_AM_SURE NODE_ENV=production] [DOMAINS=a,b] \
 *           npm --prefix apps/api run seed:test-pack
 */
import { PrismaService } from '../prisma/prisma.service';
import { bkkDateStr, bkkMidnight, resolveRefs } from './test-pack/_context';
import { runPreflight } from './test-pack/_preflight';
import { ALL_DOMAINS, selectDomains } from './test-pack/_registry';
import type { DomainSeeder, SeedContext } from './test-pack/_types';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error(
      'Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run seed:test-pack',
    );
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_SEED !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[seed-test-pack] DRY-RUN mode (default). To create, re-run with:');
    console.log(
      `  CONFIRM_SEED=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_SEED=${REQUIRED_CONSENT}] npm --prefix apps/api run seed:test-pack`,
    );
    console.log('');
  }
  if (
    !dryRun &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_SEED !== REQUIRED_CONSENT
  ) {
    console.error(
      `ERROR: Refusing to seed in NODE_ENV=production without ALLOW_PROD_SEED=${REQUIRED_CONSENT}`,
    );
    process.exit(1);
  }

  let domains: DomainSeeder[];
  try {
    domains = selectDomains(ALL_DOMAINS, process.env.DOMAINS);
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
    `[seed-test-pack] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'} | โดเมน: ${domains.length}`,
  );
  console.log('');

  const failures: string[] = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  try {
    const now = new Date();
    const refs = await resolveRefs(prisma);

    const drive = process.env.DRIVE === '1';
    const postDate = process.env.POST_DATE
      ? new Date(`${process.env.POST_DATE}T00:00:00.000Z`)
      : bkkMidnight(now);
    const pre = await runPreflight(prisma, refs, { drive, postDate });
    if (!pre.ok) {
      console.error('[seed-test-pack] PREFLIGHT ไม่ผ่าน:');
      for (const p of pre.problems) console.error(`  ✗ ${p}`);
      await prisma.$disconnect();
      process.exit(1);
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
        if (dryRun) {
          const rows = await d.plan(ctx);
          for (const r of rows) console.log(`   • ${r.label} — ${r.detail}`);
          console.log(`   รวม ${rows.length} แถว`);
        } else {
          const stat = await d.seed(ctx);
          totalCreated += stat.created;
          totalSkipped += stat.skipped;
          for (const n of stat.notes) console.log(`   ℹ ${n}`);
          console.log(`   สร้าง ${stat.created} · ข้าม ${stat.skipped} (มีอยู่แล้ว)`);
        }
      } catch (err) {
        // โดเมนหนึ่งพังต้องไม่ล้มทั้งชุด — บันทึกไว้แล้วเดินต่อ
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${d.key}: ${msg}`);
        console.log(`   ✗ ล้มเหลว — ${msg}`);
      }
      console.log('');
    }

    console.log('[seed-test-pack] ===== SUMMARY =====');
    if (dryRun) {
      console.log('  DRY-RUN — ไม่ได้เขียนอะไรลง DB');
    } else {
      console.log(`  สร้างทั้งหมด : ${totalCreated} แถว`);
      console.log(`  ข้าม        : ${totalSkipped} แถว (รันซ้ำ)`);
    }
    if (failures.length) {
      console.log(`  ล้มเหลว     : ${failures.length} โดเมน`);
      for (const f of failures) console.log(`    - ${f}`);
    }
    console.log('');
    console.log('  ล้างข้อมูล : npm --prefix apps/api run cleanup:test-pack');
  } finally {
    await prisma.$disconnect();
  }

  if (failures.length) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-test-pack] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
