# Pre-Merge Guard Report — 2026-04-19 (v5)

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-19  
**Branches reviewed**: `feat/audit-log-merkle-chain`, `feat/ghost-sale-detection`, `feat/dunning-legal-approval-gate`

---

## Branch 1: `feat/audit-log-merkle-chain`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit**: `4faf247f feat(audit): Merkle hash chain + nightly verify cron (T2-C4 ext)`

### File Changes Summary

| File | Change |
|------|--------|
| `prisma/migrations/20260525100000_audit_log_merkle_chain/migration.sql` | +35 — adds `sequence_number`, `row_hash`, `prev_row_hash` + sequence backfill |
| `prisma/schema.prisma` | +9 — 3 new nullable fields on `AuditLog`, 1 new index |
| `audit/audit.service.ts` | +165/-10 — `log()` → transaction + sequence + hash; new `computeRowHash()`, `verifyChain()` |
| `audit/audit-chain-verify.cron.ts` | +50 (new) — nightly 03:45 BKK cron, Sentry `fatal` on mismatch |
| `audit/audit.controller.ts` | +16 — `GET /audit/verify-chain` (OWNER only) |
| `audit/audit.module.ts` | +3/-1 — registers `AuditChainVerifyCron` as provider |
| `audit/audit.service.spec.ts` | +181 (new) — 12 tests: `computeRowHash` determinism + `verifyChain` tamper scenarios |

---

### Issues

#### 🟡 WARNING — Should fix before merge

**W1: `verifyChain` inner-loop uses `rows.indexOf(r)` — O(n²)**  
File: `apps/api/src/modules/audit/audit.service.ts` (2× inside loop)

```typescript
// Both mismatch early-returns call rows.indexOf(r):
return {
  rowsChecked: rows.indexOf(r),   // ← O(n) per iteration ⇒ O(n²) total
  ...
};
```

With the default `take: 50_000` this is ~2.5B comparisons on a full walk. Replace with an integer counter variable:

```typescript
let idx = 0;
for (const r of rows) {
  // ... checks ...
  return { rowsChecked: idx, ... };   // ← O(1)
  lastHash = r.rowHash;
  idx++;
}
return { ok: true, rowsChecked: idx, ... };
```

The tests pass because test datasets are small — this won't surface in CI.

---

**W2: Concurrent audit writes can produce false-positive chain breaks**  
File: `apps/api/src/modules/audit/audit.service.ts` (~line 60)

The hash-chain approach assumes sequential writes, but two concurrent transactions can both call `nextval` and get seq N and N+1. Transaction N+1 then tries to `findFirst({ where: { sequenceNumber: N } })` — but N may not be committed yet, so it reads `prevRowHash = null` and seals itself with the wrong linkage. The nightly cron will then flag this as tampering (a false alarm), requiring manual investigation.

This is inherent to non-serializable transactions with a sequence, but since audit log writes happen in high-concurrency paths (every mutating API request triggers one), this will produce noise. Two mitigation options:

1. **Accept and document** — add a comment in `verifyChain` explaining that gaps caused by concurrent writes are expected and distinguishable from tampering by checking if `prevRowHash IS NULL` and the previous row exists with a non-null hash.
2. **Use serializable isolation** for the audit log transaction: `this.prisma.$transaction(..., { isolationLevel: 'Serializable' })` — guarantees seq N is visible before N+1 inserts. (Higher overhead per write.)

At minimum, the Sentry alert should note `firstMismatchPrevHashNull: true` to help triage false alarms.

---

**W3: Audit log `log()` failures not forwarded to Sentry**  
File: `apps/api/src/modules/audit/audit.service.ts` (~line 100)

The `catch` block only logs to `Logger`. Previously the write was a simple `create()`; now it's a `$transaction` with sequence fetch + hash computation — more failure modes. A failed audit write (DB down, sequence exhausted, hash collision) produces a chain gap that `verifyChain` will flag every night. Sentry capture in the catch would let ops correlate the gap with the original write failure:

```typescript
} catch (err) {
  this.logger.error('Failed to write audit log', err);
  Sentry.captureException(err, { tags: { kind: 'audit-chain', method: 'log' } });
}
```

---

#### 🔵 INFO

**I1: BigInt JSON serialization**  
`AuditLog.sequenceNumber` is `BigInt`. The controller correctly converts to string in `verifyChain` response (`firstMismatchSeq?.toString() ?? null`). The cron also converts via `.toString()`. ✓ No issue, noted for awareness.

**I2: Future migration timestamp**  
Migration folder is `20260525100000_…` (May 2026) while today is 2026-04-19. Prisma applies migrations in lexicographic filename order. Any April 2026 migration added later would sort before this one and apply first — no ordering conflict. Low risk.

---

### Verdict: 🔍 REVIEW

| # | Severity | Description |
|---|----------|-------------|
| W1 | Warning | `rows.indexOf(r)` O(n²) — fix with counter |
| W2 | Warning | Concurrent-write false-positive chain breaks — document or use Serializable isolation |
| W3 | Warning | Silent audit-log failures without Sentry — add captureException |

No Critical issues. W1 is a quick fix. W2 and W3 are production-quality hardening recommended before merge.

---

## Branch 2: `feat/ghost-sale-detection`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit**: `b15dd5e0 feat(contracts): ghost sale + rapid-void detection cron (T5-C5)`

### File Changes Summary

| File | Change |
|------|--------|
| `contracts/contracts.module.ts` | +2/-1 — registers `GhostSaleCron` as provider |
| `contracts/crons/ghost-sale.cron.ts` | +129 (new) — daily 02:30 cron, 2 detection patterns |
| `contracts/crons/ghost-sale.cron.spec.ts` | +100 (new) — 6 tests covering both fraud patterns + Sentry assertions |

---

### Issues

#### 🟡 WARNING — Should fix before merge

**W1: `take: 200` truncation not reflected in Sentry alert**  
File: `apps/api/src/modules/contracts/crons/ghost-sale.cron.ts` (~lines 56, 77)

Both `ghostContracts` and `rapidVoids` queries hard-cap at 200 rows. If the actual count exceeds 200, the alert says "Ghost sale detection: 200 contract(s)" but the real number is unknown. An attacker farming ghost sales could intentionally keep the count at 199 to stay near the threshold without triggering a fuller investigation. Add a truncation flag:

```typescript
Sentry.captureMessage(
  `Ghost sale detection: ${ghostContracts.length}${ghostContracts.length === 200 ? '+' : ''} ACTIVE contract(s)…`,
  { extra: { truncated: ghostContracts.length === 200, ... } },
);
```

---

**W2: No idempotency — persistent unresolved ghosts re-alert daily**  
File: `apps/api/src/modules/contracts/crons/ghost-sale.cron.ts`

Legitimate ghost contracts that are under dispute investigation will fire a Sentry `warning` every day until resolved. There's no ack/snooze mechanism. Over time this trains ops to ignore the alert (alert fatigue). Suggest either:
- Adding a `ghostFlaggedAt` field so already-alerted contracts are excluded from subsequent scans, or
- Deduplicating on Sentry fingerprint so Sentry itself groups repeated occurrences.

This is an operational concern, not a correctness bug — acceptable to defer if documented.

---

#### 🔵 INFO

**I1: `rapidVoids` query assumes `deletedAt ≥ createdAt` ordering**  
The query `{ deletedAt: { gte: cutoff }, createdAt: { gte: cutoff } }` is logically correct (both events within 30 days) but doesn't enforce `deletedAt > createdAt`. If data anomalies exist (e.g., migration-era records with incorrect timestamps), false positives could appear. Low risk.

**I2: `salespersonId` may be null**  
`groupBy(rapidVoids, 'salespersonId')` maps null salespersonId to `'UNKNOWN'`. Acceptable behavior.

---

### Verdict: ✅ APPROVE (with notes)

| # | Severity | Description |
|---|----------|-------------|
| W1 | Warning | `take: 200` truncation not surfaced in alert |
| W2 | Warning | Daily re-alerts for persistent ghosts — alert fatigue risk |

No Critical issues. Clean implementation with good test coverage. W2 can be deferred; W1 is a 2-line fix.

---

## Branch 3: `feat/dunning-legal-approval-gate`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit**: `184eebd7 feat(overdue): FINAL_WARNING + LEGAL_ACTION manual approval gate (T4-C2)`

### File Changes Summary

| File | Change |
|------|--------|
| `prisma/migrations/20260524700000_add_pending_dunning_stage/migration.sql` | +8 — adds `pending_dunning_stage`, `pending_dunning_since` to `contracts` |
| `prisma/schema.prisma` | +7 — 2 new nullable fields on `Contract` with `///` doc comments |
| `overdue/overdue.controller.ts` | +32 — 3 new endpoints (pending-escalations, approve, reject) |
| `overdue/overdue.service.ts` | +126 — `approveDunningEscalation`, `rejectDunningEscalation`, `getPendingEscalations` + pending-park logic in escalation engine |
| `overdue/overdue.service.spec.ts` | +77 — 5 tests for approve/reject flows |

---

### Issues

#### 🟡 WARNING — Should fix before merge

**W1: `rejectEscalation` controller uses inline type instead of DTO**  
File: `apps/api/src/modules/overdue/overdue.controller.ts` (new `rejectEscalation` method)

```typescript
rejectEscalation(
  @Param('id') id: string,
  @Body() body: { reason: string },   // ← inline type, no class-validator
  ...
)
```

Project standard (per `backend.md`) requires a named DTO class with class-validator decorators. The service already validates `reason.trim().length < 5` so there's no crash, but an empty body `{}` or `{ reason: null }` bypasses the transport-layer validation. Create a minimal DTO:

```typescript
// dto/reject-escalation.dto.ts
export class RejectEscalationDto {
  @IsString()
  @MinLength(5, { message: 'ต้องระบุเหตุผลการปฏิเสธ (≥ 5 ตัวอักษร)' })
  reason: string;
}
```

---

#### 🔵 INFO

**I1: Service-level role checks are redundant but acceptable defense-in-depth**  
Both `approveDunningEscalation` and `rejectDunningEscalation` duplicate the `@Roles('OWNER', 'FINANCE_MANAGER')` guard that `RolesGuard` already enforces at the controller. However, duplicating critical access control at the service layer is a deliberate defense-in-depth pattern — consistent with other sensitive services (e.g., `journal.service.ts`, `commission.service.ts`). No change needed.

**I2: Future migration timestamps**  
Migration `20260524700000_…` is dated May 2026. Same issue as Branch 1 — low risk for ordering but inconsistent with current date. Cosmetic.

**I3: `getPendingEscalations` is cross-branch**  
`getPendingEscalations` returns all contracts with `pendingDunningStage` across all branches. Access is limited to `OWNER` and `FINANCE_MANAGER` (both cross-branch roles per `branch-access.util.ts`). `BranchGuard` on the controller class does not restrict these roles. ✓ Correct.

---

### Verdict: 🔍 REVIEW

| # | Severity | Description |
|---|----------|-------------|
| W1 | Warning | Missing DTO class for `rejectEscalation` body — use `RejectEscalationDto` with class-validator |

No Critical issues. W1 is a minor fix (~10 lines). Logic and access control are sound.

---

## Summary

| Branch | Files Changed | Recommendation | Issues |
|--------|---------------|----------------|--------|
| `feat/audit-log-merkle-chain` | 7 | 🔍 REVIEW | W1 O(n²), W2 concurrent chain break, W3 missing Sentry on failure |
| `feat/ghost-sale-detection` | 3 | ✅ APPROVE | W1 truncation alert, W2 alert fatigue |
| `feat/dunning-legal-approval-gate` | 5 | 🔍 REVIEW | W1 missing DTO class |

No Critical (BLOCK-level) issues found across all three branches. All issues are Warnings correctable in-branch before merge.
