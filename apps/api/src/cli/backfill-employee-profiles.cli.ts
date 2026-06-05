/**
 * One-time backfill CLI: provision an EmployeeProfile for every real
 * (non-system, active) User that doesn't have one yet (spec §5.2.1).
 *
 * position/baseSalary are left NULL for the OWNER to fill in the master UI.
 * Idempotent: users that already have a profile are skipped (set difference).
 * Dry-run by default. Run with --apply (or APPLY=true) to write.
 *
 * Usage (dev dry-run):  EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:employee-profiles
 * Usage (dev apply):    EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:employee-profiles -- --apply
 * Usage (prod apply):   Cloud Run Job, --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod,APPLY=true,ALLOW_PROD_BACKFILL=YES_I_AM_SURE
 */
import { PrismaClient } from '@prisma/client';

// ─── Pure logic (exported for unit tests) ───────────────────────────────────
export interface CandidateUser {
  id: string;
  isSystemUser: boolean;
  deletedAt: Date | null;
}

/** Active, non-system users that have no EmployeeProfile yet. */
export function selectProfileCandidates(
  users: CandidateUser[],
  existingProfileUserIds: Set<string>,
): CandidateUser[] {
  return users.filter(
    (u) => !u.isSystemUser && u.deletedAt === null && !existingProfileUserIds.has(u.id),
  );
}

// ─── Runnable glue (only under require.main === module) ──────────────────────
const TAG = '[backfill-employee-profiles]';
const SAMPLE_SIZE = 5;
const BATCH_SIZE = 100;

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME is required (e.g. EXPECTED_DB_NAME=bestchoice_dev).');
    process.exit(1);
  }
  const applyMode =
    process.argv.includes('--apply') || (process.env.APPLY ?? '').toLowerCase() === 'true';

  const prisma = new PrismaClient();
  try {
    const [{ current_database: actualDb }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    if (actualDb !== expectedDb) {
      console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
      process.exit(1);
    }
    if (applyMode && actualDb === 'bestchoice_prod') {
      if (process.env.ALLOW_PROD_BACKFILL !== 'YES_I_AM_SURE') {
        console.error('ERROR: production --apply requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE');
        process.exit(1);
      }
      console.warn(`${TAG} LIVE prod run starting in 5s — Ctrl+C to abort.`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    console.log(`${TAG} DB: ${actualDb}  mode: ${applyMode ? 'APPLY' : 'DRY_RUN'}`);

    // Load eligible users + the set of userIds that already have a profile.
    const users = await prisma.user.findMany({
      where: { isSystemUser: false, deletedAt: null },
      select: { id: true, isSystemUser: true, deletedAt: true, name: true },
    });
    // F4 — NO deletedAt filter: employee_profiles.user_id is @unique, so a
    // soft-deleted profile still owns its userId. Filtering to deletedAt:null
    // would (a) inflate the "to provision" count, (b) attempt a create that
    // hits P2002, and (c) wrongly try to resurrect profiles the OWNER
    // intentionally removed. Treat ANY existing profile row as "userId taken".
    const existing = await prisma.employeeProfile.findMany({
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((e) => e.userId));
    const candidates = selectProfileCandidates(users, existingIds);

    console.log('');
    console.log(`${TAG} ===== SUMMARY =====`);
    console.log(`${TAG}   eligible users (non-system, active) : ${users.length}`);
    console.log(`${TAG}   already have a profile              : ${existingIds.size}`);
    console.log(`${TAG}   to provision                        : ${candidates.length}${applyMode ? '' : '  (would-create)'}`);
    for (const u of candidates.slice(0, SAMPLE_SIZE)) {
      console.log(`    user=${u.id}  ${(u as { name?: string }).name ?? ''}`);
    }
    if (candidates.length > SAMPLE_SIZE) console.log(`    ... and ${candidates.length - SAMPLE_SIZE} more`);
    console.log('');

    if (!applyMode) {
      console.log(`${TAG} DRY_RUN — nothing created. Re-run with --apply to commit.`);
      return;
    }
    if (candidates.length === 0) {
      console.log(`${TAG} Nothing to apply.`);
      return;
    }

    let created = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      await prisma.$transaction(async (tx) => {
        for (const u of batch) {
          // Idempotency: skipDuplicates via try/catch on the unique userId.
          // (employee_profiles.user_id is @unique — a concurrent/duplicate
          // create throws P2002, which we swallow so re-runs are safe.)
          try {
            await tx.employeeProfile.create({ data: { userId: u.id } });
            created++;
          } catch (e) {
            if ((e as { code?: string })?.code !== 'P2002') throw e;
          }
        }
      });
      console.log(`${TAG}   ...processed ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}`);
    }
    console.log(`${TAG} Done. created=${created}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`${TAG} FATAL:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
