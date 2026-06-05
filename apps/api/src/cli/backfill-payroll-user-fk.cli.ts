/**
 * One-time backfill CLI: link legacy PayrollLine rows to a User (spec §5.2.2).
 *
 *   tier-1  employeeTaxId === User.nationalId, exactly one active user
 *           → CONFIDENT, auto-linked on --apply. Idempotent.
 *   tier-2  exact employeeName === User.name, exactly one active user
 *           → RISKY (false positives). Written to matched-by-name.csv for
 *             owner review. Applied ONLY with --tier=2 (or TIER2=true), and
 *             every linked row gets a PAYROLL_FK_MATCHED_BY_NAME audit row.
 *   tier-2-ambiguous  name matches 2+ users → never auto-linked (listed).
 *   unmatched         → left null (legacy free-text stays as-is, not re-linked).
 *
 * NEVER touches employeeName/employeeTaxId snapshots — only fills userId.
 * Idempotent: only rows with userId IS NULL are scanned; updateMany guards on
 * userId:null so a re-run never double-links or double-audits.
 *
 * Run CLI A (backfill:employee-profiles) FIRST so match targets have profiles.
 *
 * Usage (dev dry-run):   EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:payroll-user-fk
 * Usage (dev tier-1):    EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:payroll-user-fk -- --apply
 * Usage (dev tier-2):    EXPECTED_DB_NAME=bestchoice_dev BACKFILL_ACTOR_USER_ID=<uuid> npm --prefix apps/api run backfill:payroll-user-fk -- --apply --tier=2
 * Usage (prod):          Cloud Run Job, --update-env-vars=EXPECTED_DB_NAME=bestchoice_prod,APPLY=true,ALLOW_PROD_BACKFILL=YES_I_AM_SURE[,TIER2=true,BACKFILL_ACTOR_USER_ID=<uuid>]
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../modules/audit/audit.service';

// ─── Pure matcher (exported for unit tests) ──────────────────────────────────
export interface MatchUser {
  id: string;
  name: string;
  nationalId: string | null;
}
export type PayrollMatch =
  | { kind: 'tier1'; userId: string }
  | { kind: 'tier2'; userId: string }
  | { kind: 'tier2-ambiguous'; candidateIds: string[] }
  | { kind: 'unmatched' };

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Decide how to link one legacy PayrollLine. taxId (→ nationalId) wins when it
 * resolves to exactly one user; otherwise fall back to exact name; multiple
 * name matches are ambiguous (never auto-linked).
 */
export function resolvePayrollMatch(
  line: { employeeName: string; employeeTaxId: string | null },
  activeUsers: MatchUser[],
): PayrollMatch {
  const taxId = (line.employeeTaxId ?? '').trim();
  if (taxId) {
    const byTax = activeUsers.filter((u) => u.nationalId && u.nationalId === taxId);
    if (byTax.length === 1) return { kind: 'tier1', userId: byTax[0].id };
    // 0 or 2+ taxId matches → do NOT tier-1; try name below.
  }
  const name = norm(line.employeeName);
  if (name) {
    const byName = activeUsers.filter((u) => norm(u.name) === name);
    if (byName.length === 1) return { kind: 'tier2', userId: byName[0].id };
    if (byName.length > 1) return { kind: 'tier2-ambiguous', candidateIds: byName.map((u) => u.id) };
  }
  return { kind: 'unmatched' };
}

// ─── Runnable glue ───────────────────────────────────────────────────────────
const TAG = '[backfill-payroll-user-fk]';
const BATCH_SIZE = 100;
// Cloud Run containers have a read-only root FS — only /tmp is writable.
// The stdout dump (below) is the authoritative output for Cloud Logging; this
// file is a convenience for local runs. Overridable via CSV_OUT.
const CSV_PATH = process.env.CSV_OUT ?? '/tmp/matched-by-name.csv';

interface LineRow {
  id: string;
  employeeName: string;
  employeeTaxId: string | null;
  payrollId: string;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME is required.');
    process.exit(1);
  }
  const applyMode =
    process.argv.includes('--apply') || (process.env.APPLY ?? '').toLowerCase() === 'true';
  const tier2Mode =
    process.argv.includes('--tier=2') || (process.env.TIER2 ?? '').toLowerCase() === 'true';
  const actorId = process.env.BACKFILL_ACTOR_USER_ID;

  const prisma = new PrismaClient();
  try {
    const [{ current_database: actualDb }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    if (actualDb !== expectedDb) {
      console.error(`ERROR: DB mismatch: "${actualDb}" != EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
      process.exit(1);
    }
    if (applyMode && actualDb === 'bestchoice_prod' && process.env.ALLOW_PROD_BACKFILL !== 'YES_I_AM_SURE') {
      console.error('ERROR: production --apply requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE');
      process.exit(1);
    }
    // tier-2 apply needs a real audit actor (AuditLog.userId is NOT nullable).
    if (applyMode && tier2Mode) {
      if (!actorId) {
        console.error('ERROR: tier-2 --apply requires BACKFILL_ACTOR_USER_ID=<real user uuid> (audit actor).');
        process.exit(1);
      }
      const actor = await prisma.user.findFirst({ where: { id: actorId, deletedAt: null }, select: { id: true } });
      if (!actor) {
        console.error(`ERROR: BACKFILL_ACTOR_USER_ID="${actorId}" is not an existing user.`);
        process.exit(1);
      }
    }
    if (applyMode && actualDb === 'bestchoice_prod') {
      console.warn(`${TAG} LIVE prod run starting in 5s — Ctrl+C to abort.`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    console.log(`${TAG} DB: ${actualDb}  mode: ${applyMode ? 'APPLY' : 'DRY_RUN'}  tier2: ${tier2Mode}`);

    // Load active users + unlinked payroll lines.
    const activeUsers: MatchUser[] = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, nationalId: true },
    });
    const lines: LineRow[] = await prisma.payrollLine.findMany({
      where: { userId: null },
      select: { id: true, employeeName: true, employeeTaxId: true, payrollId: true },
    });
    console.log(`${TAG} loaded ${activeUsers.length} active user(s), ${lines.length} unlinked payroll line(s).`);

    // Classify.
    const tier1: Array<{ line: LineRow; userId: string }> = [];
    const tier2: Array<{ line: LineRow; userId: string }> = [];
    const tier2Ambiguous: Array<{ line: LineRow; candidateIds: string[] }> = [];
    const unmatched: LineRow[] = [];
    for (const line of lines) {
      const m = resolvePayrollMatch(line, activeUsers);
      if (m.kind === 'tier1') tier1.push({ line, userId: m.userId });
      else if (m.kind === 'tier2') tier2.push({ line, userId: m.userId });
      else if (m.kind === 'tier2-ambiguous') tier2Ambiguous.push({ line, candidateIds: m.candidateIds });
      else unmatched.push(line);
    }

    console.log('');
    console.log(`${TAG} ===== CLASSIFICATION =====`);
    console.log(`${TAG}   tier-1 (taxId, auto)        : ${tier1.length}`);
    console.log(`${TAG}   tier-2 (name, manual review): ${tier2.length}`);
    console.log(`${TAG}   tier-2 ambiguous (skipped)  : ${tier2Ambiguous.length}`);
    console.log(`${TAG}   unmatched (left null)       : ${unmatched.length}`);
    console.log('');

    // Always write the name-match review CSV (tier-2 + ambiguous) for the owner.
    const nameById = new Map(activeUsers.map((u) => [u.id, u.name]));
    const csvRows = [
      'kind,payrollLineId,payrollDocId,employeeName,employeeTaxId,candidateUserIds,candidateNames',
      ...tier2.map((t) =>
        `tier2,${t.line.id},${t.line.payrollId},"${t.line.employeeName}",${t.line.employeeTaxId ?? ''},${t.userId},"${nameById.get(t.userId) ?? ''}"`),
      ...tier2Ambiguous.map((t) =>
        `ambiguous,${t.line.id},${t.line.payrollId},"${t.line.employeeName}",${t.line.employeeTaxId ?? ''},${t.candidateIds.join(' ')},"${t.candidateIds.map((id) => nameById.get(id) ?? '').join(' | ')}"`),
    ];
    // Best-effort local file — never fatal. On a read-only FS the stdout dump
    // below is the real deliverable, so a write failure just logs a warning.
    try {
      writeFileSync(CSV_PATH, csvRows.join('\n'), 'utf-8');
      console.log(`${TAG} wrote ${tier2.length + tier2Ambiguous.length} name-match row(s) to ${CSV_PATH} (local file).`);
    } catch (e) {
      console.warn(`${TAG} could not write ${CSV_PATH} (${(e as Error).message}) — using stdout dump below instead.`);
    }
    // F1 — Cloud Run Jobs have an ephemeral FS; the local CSV is lost when the
    // job exits. Dump the FULL CSV to stdout so the owner can retrieve every
    // name-match row from Cloud Logging for review (not just a sample).
    console.log(`${TAG} ----- BEGIN matched-by-name.csv (${csvRows.length - 1} row(s)) -----`);
    for (const row of csvRows) console.log(row);
    console.log(`${TAG} ----- END matched-by-name.csv -----`);
    console.log('');

    if (!applyMode) {
      console.log(`${TAG} DRY_RUN — nothing linked. Re-run with --apply (tier-1) then --apply --tier=2 (after CSV review).`);
      return;
    }

    // ── Apply tier-1 (auto, no audit — confident taxId match) ──────────────
    let linked1 = 0;
    for (let i = 0; i < tier1.length; i += BATCH_SIZE) {
      const batch = tier1.slice(i, i + BATCH_SIZE);
      // Accumulate the batch count INSIDE the tx, return it, and only add to
      // linked1 AFTER the tx commits — so a rolled-back batch never overcounts
      // the summary (the increment runs only if `await` resolves).
      const batchLinked = await prisma.$transaction(async (tx) => {
        let n = 0;
        for (const { line, userId } of batch) {
          // updateMany + userId:null guard = idempotent; count 0 means already linked.
          const res = await tx.payrollLine.updateMany({
            where: { id: line.id, userId: null },
            data: { userId },
          });
          n += res.count;
        }
        return n;
      });
      linked1 += batchLinked;
    }
    console.log(`${TAG} tier-1 linked: ${linked1}`);

    // ── Apply tier-2 (only with --tier=2, audited) ─────────────────────────
    let linked2 = 0;
    if (tier2Mode && tier2.length > 0) {
      // F2 — reuse the CLI's existing `prisma` connection for audit. AuditService
      // only touches the PrismaClient surface ($transaction/$queryRaw/auditLog),
      // so the cast is safe and avoids a second connection + the new
      // PrismaService() constructability question.
      const audit = new AuditService(prisma as unknown as PrismaService);
      // F3 — snapshot the audit-row count before/after the loop. AuditService.log
      // swallows its own errors, so this delta is how we detect a silent audit
      // failure (or a link-without-audit left by a crash on a prior run). It MUST
      // equal linked2.
      const auditBefore = await prisma.auditLog.count({
        where: { action: 'PAYROLL_FK_MATCHED_BY_NAME', entity: 'payroll_line' },
      });
      for (const { line, userId } of tier2) {
        // Link FIRST, then audit — never audit a link that didn't happen.
        // updateMany count===1 = linked just now (idempotent: a re-run finds
        // userId already set → count 0 → no duplicate link/audit).
        const res = await prisma.payrollLine.updateMany({
          where: { id: line.id, userId: null },
          data: { userId },
        });
        if (res.count === 1) {
          linked2++;
          await audit.log({
            userId: actorId!,
            action: 'PAYROLL_FK_MATCHED_BY_NAME',
            entity: 'payroll_line',
            entityId: line.id,
            newValue: { userId, matchedByName: line.employeeName, payrollDocId: line.payrollId, tier: 2 },
          });
        }
      }
      const auditWritten =
        (await prisma.auditLog.count({
          where: { action: 'PAYROLL_FK_MATCHED_BY_NAME', entity: 'payroll_line' },
        })) - auditBefore;
      console.log(`${TAG} tier-2 linked: ${linked2}  (audit rows written this run: ${auditWritten})`);
      if (auditWritten !== linked2) {
        console.warn(
          `${TAG} WARN: linked ${linked2} tier-2 row(s) but wrote ${auditWritten} audit row(s) — ` +
            `a link may be missing provenance (audit.log failure or mid-loop crash). Investigate before trusting the audit trail.`,
        );
      }
    } else if (tier2.length > 0) {
      console.log(`${TAG} tier-2 SKIPPED — review ${CSV_PATH} then re-run with --apply --tier=2 (+ BACKFILL_ACTOR_USER_ID).`);
    }

    console.log('');
    console.log(`${TAG} ===== APPLY SUMMARY =====`);
    console.log(`${TAG}   tier-1 linked : ${linked1}`);
    console.log(`${TAG}   tier-2 linked : ${linked2}`);
    console.log(`${TAG}   ambiguous     : ${tier2Ambiguous.length}  (manual — see ${CSV_PATH})`);
    console.log(`${TAG}   unmatched     : ${unmatched.length}  (left null)`);
    console.log(`${TAG} Done.`);
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
