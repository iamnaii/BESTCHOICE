# Employee Master — PR-D (Backfill CLIs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two manually-run, idempotent backfill CLIs that bring historical data forward without touching snapshots: (1) provision an `EmployeeProfile` for every real (non-system, active) `User`; (2) link legacy `PayrollLine` rows to a `User` by taxId (tier-1, auto) then by exact name (tier-2, manual-review + audited).

**Architecture:** Both follow the established `backfill:expense-vendor-fk` pattern exactly — a pure exported decision helper (unit-tested) + a `main()` runnable guarded by `require.main === module` (so importing in jest never connects to a DB). Raw `PrismaClient` for reads/writes; dry-run by default; `--apply`/`APPLY=true` to commit; `EXPECTED_DB_NAME` must equal `current_database()`; prod `--apply` needs `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` + 5s cooldown. Tier-2's `PAYROLL_FK_MATCHED_BY_NAME` audit reuses `AuditService` (constructed with the CLI's existing `PrismaClient` cast to `PrismaService` — F2) so the audit row is sealed into the Merkle chain — a raw `auditLog.create` would leave `rowHash`/`sequenceNumber` null (unsealed). Never touches `employeeName`/`employeeTaxId` snapshots; unmatched rows stay `userId = null`.

**Tech Stack:** TypeScript CLI run via `node dist/src/cli/<name>.cli.js` (build first); jest for the pure helpers (`npm --prefix apps/api test -- --runInBand <name>.cli.spec`). Prisma 6, raw `PrismaClient`.

**Spec (source of truth):** `docs/superpowers/specs/2026-06-04-employee-master-design.md` §5.2 (backfill), §7 (edge cases). Pattern reference: `apps/api/src/cli/backfill-expense-vendor-fk.cli.ts` (+ its `.spec.ts`).

---

## ⚠️ Branch point & dependencies (READ FIRST)

- **Branch:** `feat/payroll-backfill` off **`main`**.
- **DO NOT START until merged to main:** **#1151 (PR-A)** — `EmployeeProfile` schema/`employee_profiles` table; **PR-C** — `PayrollLine.userId` column. CLI A needs `prisma.employeeProfile`; CLI B needs `payroll_lines.user_id`. Verify: `gh pr view 1151 --json state` MERGED + the PR-C PR MERGED, then `git fetch origin && git switch -c feat/payroll-backfill origin/main`.
- These CLIs are **run manually AFTER deploy** (not in CI, not auto-run). Run order in prod: **CLI A first** (provision profiles) → **CLI B** (link payroll; tier-1 then tier-2). They are idempotent — safe to re-run.

## Key decisions (confirm in scrutinize)

- **D-1 — Audit chain integrity (tier-2).** The tier-2 (`PAYROLL_FK_MATCHED_BY_NAME`) audit MUST be written through `AuditService.log()`, not a raw `prisma.auditLog.create`. `AuditService` (`apps/api/src/modules/audit/audit.service.ts`) seals each row into a SHA-256 Merkle chain via `nextval('audit_logs_seq')`; a raw insert leaves `rowHash`/`sequenceNumber` null, so `verifyChain()` silently skips it (unsealed, not tamper-evident). `AuditService`'s only constructor dep is `PrismaService` and it touches only the `PrismaClient` surface (`$transaction`/`$queryRaw`/`auditLog`), so the CLI reuses its existing `PrismaClient` (cast to `PrismaService`) — no second connection, no `new PrismaService()` constructability risk (F2). `AuditLog.userId` is **NOT nullable** and `AuditService.log` early-returns when `userId` is falsy — so tier-2 `--apply` **requires `BACKFILL_ACTOR_USER_ID=<real user uuid>`** (the operator running it) as the audit actor; the CLI validates that user exists.
- **D-2 — taxId match key (tier-1).** Match `PayrollLine.employeeTaxId` against `User.nationalId` (exact, the common case per spec §5.2.2). `EmployeeProfile.taxIdOverride` (rare, foreign workers) is NOT used as a tier-1 key — an override taxId that differs from nationalId falls through to tier-2/unmatched rather than risking a wrong auto-link. Flag if the owner wants override-matching too.
- **D-3 — CLI A scope.** Provisions a profile for ALL `isSystemUser = false AND deletedAt IS NULL` users (spec §5.2.1) with `position`/`baseSalary` left null for the OWNER to fill. This may create profiles for staff not actually on payroll (e.g. commission-only sales) — acceptable per spec ("presence = is a payroll employee"); the OWNER soft-deletes profiles for anyone not on payroll. Profiles are created with `ssoEligible` defaulting to the schema default (`true`).

---

## File Structure

- Create: `apps/api/src/cli/backfill-employee-profiles.cli.ts` (CLI A: pure `selectProfileCandidates` + `main`)
- Create: `apps/api/src/cli/backfill-employee-profiles.cli.spec.ts` (unit-test the pure helper)
- Create: `apps/api/src/cli/backfill-payroll-user-fk.cli.ts` (CLI B: pure `resolvePayrollMatch` + `main`)
- Create: `apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts` (unit-test the pure matcher)
- Modify: `apps/api/package.json` — register 4 scripts (each CLI + its `:help`)

---

## Task 1: CLI A — `backfill:employee-profiles`

**Files:** Create `apps/api/src/cli/backfill-employee-profiles.cli.ts`; Test `apps/api/src/cli/backfill-employee-profiles.cli.spec.ts`; Modify `apps/api/package.json`

The only non-trivial logic is "which users still need a profile" — a pure set difference. TDD that; the runnable `main()` is operational glue (copy the guard/summary boilerplate from `backfill-expense-vendor-fk.cli.ts`).

- [ ] **Step 1: Write the failing test** — `apps/api/src/cli/backfill-employee-profiles.cli.spec.ts`:

```typescript
import { selectProfileCandidates } from './backfill-employee-profiles.cli';

describe('selectProfileCandidates', () => {
  const users = [
    { id: 'u1', isSystemUser: false, deletedAt: null },
    { id: 'u2', isSystemUser: false, deletedAt: null },
    { id: 'sys', isSystemUser: true, deletedAt: null },
    { id: 'gone', isSystemUser: false, deletedAt: new Date() },
  ];

  it('returns active non-system users that have no profile yet', () => {
    const out = selectProfileCandidates(users, new Set(['u2'])); // u2 already has a profile
    expect(out.map((u) => u.id)).toEqual(['u1']);
  });

  it('excludes system users and soft-deleted users', () => {
    const out = selectProfileCandidates(users, new Set());
    expect(out.map((u) => u.id).sort()).toEqual(['u1', 'u2']); // not sys, not gone
  });

  it('is empty when every eligible user already has a profile (idempotent re-run)', () => {
    const out = selectProfileCandidates(users, new Set(['u1', 'u2']));
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect failure.**

Run: `npm --prefix apps/api test -- --runInBand backfill-employee-profiles.cli`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement the CLI.** Create `apps/api/src/cli/backfill-employee-profiles.cli.ts`. The guard/summary/`require.main` scaffold is copied from `backfill-expense-vendor-fk.cli.ts` (lines 97–143 for the env/DB guards, 337–345 for the bottom guard) with the tag changed to `backfill-employee-profiles`:

```typescript
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
```

> `EmployeeProfile` defaults (`employmentType=MONTHLY`, `ssoEligible=true`) come from the schema — we only set `userId`. `position`/`baseSalary`/`bankName`/etc stay null for the OWNER.

- [ ] **Step 4: Run the test — expect pass.**

Run: `npm --prefix apps/api test -- --runInBand backfill-employee-profiles.cli`
Expected: PASS (all 3). The `main()` glue is not exercised (no `require.main` in jest).

- [ ] **Step 5: Register npm scripts.** In `apps/api/package.json` `scripts`, add (next to `backfill:expense-vendor-fk`):

```json
    "backfill:employee-profiles": "node dist/src/cli/backfill-employee-profiles.cli.js",
    "backfill:employee-profiles:help": "echo 'Usage: EXPECTED_DB_NAME=<db> [APPLY=true] [ALLOW_PROD_BACKFILL=YES_I_AM_SURE] npm run backfill:employee-profiles  (dry-run default; pass --apply or APPLY=true to write)'",
```

- [ ] **Step 6: Typecheck + commit.**

Run: `./tools/check-types.sh api` → OK

```bash
git add apps/api/src/cli/backfill-employee-profiles.cli.ts apps/api/src/cli/backfill-employee-profiles.cli.spec.ts apps/api/package.json
git commit -m "feat(backfill): backfill:employee-profiles CLI (provision profiles for active staff) (PR-D)"
```

---

## Task 2: CLI B — `backfill:payroll-user-fk`

**Files:** Create `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`; Test `apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts`; Modify `apps/api/package.json`

The decision core is `resolvePayrollMatch`: tier-1 (taxId === nationalId, exactly one), tier-2 (exact name, exactly one), tier-2-ambiguous (multiple name matches), unmatched. TDD it thoroughly, then wire the apply paths.

- [ ] **Step 1: Write the failing test** — `apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts`:

```typescript
import { resolvePayrollMatch } from './backfill-payroll-user-fk.cli';

const users = [
  { id: 'u1', name: 'สมชาย ใจดี', nationalId: '1234567890123' },
  { id: 'u2', name: 'สมหญิง แซ่ลี้', nationalId: '9999999999999' },
  { id: 'u3', name: 'สมหญิง แซ่ลี้', nationalId: '8888888888888' }, // duplicate NAME, different id
];

describe('resolvePayrollMatch', () => {
  it('tier-1: exact taxId === nationalId, unique → confident link', () => {
    expect(resolvePayrollMatch({ employeeName: 'อะไรก็ได้', employeeTaxId: '1234567890123' }, users))
      .toEqual({ kind: 'tier1', userId: 'u1' });
  });

  it('tier-2: no taxId match, exact unique name → name match (manual review)', () => {
    expect(resolvePayrollMatch({ employeeName: 'สมชาย ใจดี', employeeTaxId: null }, users))
      .toEqual({ kind: 'tier2', userId: 'u1' });
  });

  it('tier-2-ambiguous: exact name matches MORE THAN ONE user → never auto-link', () => {
    expect(resolvePayrollMatch({ employeeName: 'สมหญิง แซ่ลี้', employeeTaxId: null }, users))
      .toEqual({ kind: 'tier2-ambiguous', candidateIds: ['u2', 'u3'] });
  });

  it('name match is case/space-insensitive', () => {
    expect(resolvePayrollMatch({ employeeName: '  สมชาย ใจดี  ', employeeTaxId: null }, users))
      .toEqual({ kind: 'tier2', userId: 'u1' });
  });

  it('taxId takes precedence over name', () => {
    // taxId points at u1, name points at u2 — tier-1 wins
    expect(resolvePayrollMatch({ employeeName: 'สมหญิง แซ่ลี้', employeeTaxId: '1234567890123' }, users))
      .toEqual({ kind: 'tier1', userId: 'u1' });
  });

  it('unmatched: no taxId match and no name match → leave null', () => {
    expect(resolvePayrollMatch({ employeeName: 'คนแปลกหน้า', employeeTaxId: '0000000000000' }, users))
      .toEqual({ kind: 'unmatched' });
  });

  it('ambiguous taxId (should not happen — nationalId unique) falls through, not auto-linked', () => {
    const dup = [{ id: 'a', name: 'X', nationalId: '5' }, { id: 'b', name: 'Y', nationalId: '5' }];
    expect(resolvePayrollMatch({ employeeName: 'Z', employeeTaxId: '5' }, dup))
      .toEqual({ kind: 'unmatched' }); // 2 taxId matches → not tier-1; no name match → unmatched
  });
});
```

- [ ] **Step 2: Run it — expect failure.**

Run: `npm --prefix apps/api test -- --runInBand backfill-payroll-user-fk.cli`
Expected: FAIL — function not found.

- [ ] **Step 3: Implement the CLI.** Create `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`. Boilerplate guards copied from `backfill-expense-vendor-fk.cli.ts`; novel logic (matcher, tier-2 CSV, tier-2 audit via `AuditService`) given in full:

```typescript
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
const SAMPLE_SIZE = 5;
const BATCH_SIZE = 100;
const CSV_PATH = 'matched-by-name.csv';

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
    writeFileSync(CSV_PATH, csvRows.join('\n'), 'utf-8');
    console.log(`${TAG} wrote ${tier2.length + tier2Ambiguous.length} name-match row(s) to ${CSV_PATH} (local file).`);
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
      await prisma.$transaction(async (tx) => {
        for (const { line, userId } of batch) {
          // updateMany + userId:null guard = idempotent; count 0 means already linked.
          const res = await tx.payrollLine.updateMany({
            where: { id: line.id, userId: null },
            data: { userId },
          });
          linked1 += res.count;
        }
      });
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
```

> **Verify at execution:** (1) `PrismaService` import path is `../prisma/prisma.service` — used only as the cast target type (`prisma as unknown as PrismaService`); we do NOT construct it (F2). (2) `audit_logs_seq` Postgres sequence exists in the target DB (created by the audit migration) — `AuditService.log` calls `nextval('audit_logs_seq')`. (3) Importing this file in jest must NOT open a DB connection — it doesn't, because `prisma`/`AuditService` are created inside `main()` (under `require.main`). The top-level `import` of `PrismaService`/`AuditService` is type+class only, no side effects.

- [ ] **Step 4: Run the test — expect pass.**

Run: `npm --prefix apps/api test -- --runInBand backfill-payroll-user-fk.cli`
Expected: PASS (all 7).

- [ ] **Step 5: Register npm scripts.** In `apps/api/package.json`:

```json
    "backfill:payroll-user-fk": "node dist/src/cli/backfill-payroll-user-fk.cli.js",
    "backfill:payroll-user-fk:help": "echo 'Usage: EXPECTED_DB_NAME=<db> [APPLY=true] [TIER2=true BACKFILL_ACTOR_USER_ID=<uuid>] [ALLOW_PROD_BACKFILL=YES_I_AM_SURE] npm run backfill:payroll-user-fk  (dry-run default; --apply does tier-1; --apply --tier=2 does name matches + audit)'",
```

- [ ] **Step 6: Typecheck + commit.**

Run: `./tools/check-types.sh api` → OK

```bash
git add apps/api/src/cli/backfill-payroll-user-fk.cli.ts apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts apps/api/package.json
git commit -m "feat(backfill): backfill:payroll-user-fk CLI (tier-1 taxId auto, tier-2 name audited) (PR-D)"
```

---

## Task 3: Runbook + verify + PR

**Files:** Modify `apps/api/package.json` (done in Tasks 1–2); optionally add a runbook note to the PR body.

- [ ] **Step 1: Both CLI specs green.**

Run: `npm --prefix apps/api test -- --runInBand backfill-employee-profiles.cli backfill-payroll-user-fk.cli`
Expected: all green (3 + 7).

- [ ] **Step 2: Typecheck + build (CLIs run from `dist`).**

Run: `./tools/check-types.sh api && npm --prefix apps/api run build`
Expected: 0 errors; `dist/src/cli/backfill-employee-profiles.cli.js` + `dist/src/cli/backfill-payroll-user-fk.cli.js` exist.

- [ ] **Step 3: Dev-DB smoke — REQUIRED for the tier-2 path (F5).** The tier-2 apply+audit glue is NOT covered by the pure-helper unit tests, so exercise it end-to-end on a dev DB before opening the PR. Seed ≥1 legacy `PayrollLine` (userId null) whose `employeeName` matches a dev user, then:

```bash
# dry-run both (summaries print; nothing written; CLI B emits CSV file + full stdout dump)
EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:employee-profiles
EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:payroll-user-fk
# apply: profiles → tier-1 → tier-2 (tier-2 needs a real actor uuid)
EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:employee-profiles -- --apply
EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run backfill:payroll-user-fk -- --apply
EXPECTED_DB_NAME=bestchoice_dev BACKFILL_ACTOR_USER_ID=<dev-owner-uuid> npm --prefix apps/api run backfill:payroll-user-fk -- --apply --tier=2
```
Confirm: (a) the seeded line gets `userId`; (b) a `PAYROLL_FK_MATCHED_BY_NAME` audit row exists for it; (c) the reconcile prints NO `WARN` (linked == audit written); (d) re-running links/audits nothing (idempotent); (e) the full CSV appears in stdout between the BEGIN/END markers.

- [ ] **Step 4: Push + open PR (do NOT merge — owner merges).**

```bash
git push -u origin feat/payroll-backfill
gh pr create --base main --head feat/payroll-backfill \
  --title "feat(backfill): Employee Master backfill CLIs — profiles + payroll userId (PR-D)" \
  --body "PR-D of Employee Master. Two manually-run, idempotent, dry-run-by-default CLIs (pattern: backfill:expense-vendor-fk):
- backfill:employee-profiles — provision EmployeeProfile for every non-system active User (position/baseSalary left null for OWNER).
- backfill:payroll-user-fk — link legacy PayrollLine.userId: tier-1 (employeeTaxId === User.nationalId, exactly one → auto on --apply); tier-2 (exact unique name → matched-by-name.csv for review, applied only with --apply --tier=2 + PAYROLL_FK_MATCHED_BY_NAME audit via AuditService/Merkle chain); ambiguous + unmatched left null. Snapshots never touched.

Depends on PR-A (#1151, EmployeeProfile) + PR-C (PayrollLine.userId). RUN MANUALLY AFTER DEPLOY: CLI A first, then CLI B (--apply for tier-1, review CSV, then --apply --tier=2 with BACKFILL_ACTOR_USER_ID). Pure matchers unit-tested; CLIs guarded by require.main + EXPECTED_DB_NAME + ALLOW_PROD_BACKFILL.

Decisions for review: (D-1) tier-2 audit via AuditService not raw insert (Merkle chain). (D-2) tier-1 matches User.nationalId only, not taxIdOverride. (D-3) CLI A provisions ALL active non-system users."
```

- [ ] **Step 5: Update memory.** Per the project memory `party-master-mandatory-epic-status` / handoff, once PR-C + PR-D land, record that the Employee Master epic is complete and the two backfill CLIs must be run manually (dry-run → apply, CLI A before CLI B). (Do this after merge, not in the PR.)

---

## Self-Review checklist

**1. Spec §5.2 coverage:**
- §5.2.1 provision profiles for non-system active users, null position/baseSalary, idempotent → Task 1 ✅
- §5.2.2 tier-1 taxId exact (auto, idempotent) → Task 2 `resolvePayrollMatch` tier1 + tier-1 apply ✅
- §5.2.2 tier-2 name match → manual review CSV + separate `--tier=2` apply + `PAYROLL_FK_MATCHED_BY_NAME` audit per row → Task 2 ✅
- never touches snapshot; unmatched → null; idempotent (userId:null guard) → Task 2 ✅
- both dry-run → `--apply`, run manually → Tasks 1–2 ✅

**2. Placeholder scan:** pure helpers + apply/audit/CSV logic given in full; boilerplate guards explicitly "copy from backfill-expense-vendor-fk.cli.ts" (a concrete file, not a placeholder). Commands have expected output. ✅

**3. Type consistency:** `resolvePayrollMatch` return union (`tier1`/`tier2`/`tier2-ambiguous`/`unmatched`) matches the `main()` switch. `MatchUser`/`CandidateUser` shapes match the Prisma `select`s. `AuditService.log` args match its `AuditEntry` interface (userId/action/entity/entityId/newValue).

**4. Edge cases (spec §7):**
- resigned/soft-deleted employee with legacy payroll: tier-1/tier-2 match against `deletedAt: null` users only — a resigned user (User.deletedAt set) won't match → line stays null (snapshot preserved). ✅ (If a resigned employee's User is still active but `EmployeeProfile.resignedDate` is set, they still match by nationalId/name — acceptable: we're linking historical payroll to the real person, not asserting current employment.)
- duplicate nationalId (shouldn't happen): tier-1 requires exactly one → 2+ falls through, never mis-links. ✅
- name collisions: tier-2-ambiguous, never auto-linked, listed in CSV. ✅
- re-run after partial apply: `userId IS NULL` scan + `updateMany` guard → no double-link, no double-audit. ✅

**5. Verify at execution:** `PrismaService` standalone constructability + `audit_logs_seq` existence (Task 2 Step 3 note); jest import safety (matcher only, no DB).

## Scrutinize — done (2026-06-05)
Plan was scrutinized before implementation. Findings + resolutions:
- **F1 (major) — RESOLVED.** `matched-by-name.csv` was written only to the (ephemeral) CWD → lost in a Cloud Run Job, defeating the tier-2 manual-review step. Fix: dump the FULL CSV to stdout (Cloud Logging) between BEGIN/END markers, in addition to the local file (Task 2 Step 3).
- **F2 (minor) — RESOLVED.** Audit now reuses the CLI's existing `PrismaClient` (`new AuditService(prisma as unknown as PrismaService)`) instead of `new PrismaService()` — removes the second connection + the constructability risk.
- **F3 (minor) — RESOLVED.** tier-2 links FIRST then audits (never audit a non-existent link); a before/after `auditLog.count` reconcile prints a `WARN` if linked ≠ audit-written (catches audit.log's swallowed errors / mid-loop crash). True atomicity isn't possible (AuditService opens its own tx); this is the correct lesser-evil + a detector.
- **F4 (minor) — RESOLVED.** CLI A's `existingIds` no longer filters `deletedAt: null` — a soft-deleted profile still owns its unique `user_id`, so it's correctly counted as "taken" (accurate count, no doomed P2002 create, no resurrecting removed staff).
- **F5 (minor) — RESOLVED.** The dev-DB tier-2 smoke (apply + audit + reconcile + idempotent re-run) is now REQUIRED before opening the PR (Task 3 Step 3), since the unit tests only cover the pure matcher.
- **F6 (nit) — NOTED (confirm intent).** CLI B links to any active `User` by nationalId/name regardless of `EmployeeProfile` presence, whereas PR-C's create path requires an active employee profile. This is intentional leniency (backfill reconciles history to the real person); flag if the owner wants CLI B restricted to users that have a profile.

**Before merge:** re-run `scrutinize` on the actual PR diff to confirm the AuditService cast seals the chain in practice (`audit_logs_seq` present) and the reconcile fires correctly.
