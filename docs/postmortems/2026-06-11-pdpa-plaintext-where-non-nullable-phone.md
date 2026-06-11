# Post-mortem — PDPA plaintext-detection query rejected by Prisma on the non-nullable `phone` column

**Date:** 2026-06-11 · **Fix:** PR #1254 (merged to `main` `d3a5e611`) · **Owner:** akenarin · **Area:** `apps/api` PDPA encryption seam

## Summary

The PDPA plaintext-detection where-clause emitted `{ phone: { not: null } }`, but `Customer.phone` is a non-nullable `String`. Prisma rejects `not: null` on a required field at runtime with `Argument \`not\` must not be null`, throwing `PrismaClientValidationError`. This broke the `backfill:encrypt-pii` cursor and the `/settings#pdpa` strict-mode status counts — so the 4 legacy plaintext customer rows could never be encrypted, and the PDPA status card couldn't render. Fixed by dropping `{ not: null }` and keeping `{ not: '' }` only (proven equivalent via the generated SQL), consolidated into one shared clause helper.

## Symptom

Running `npm run backfill:encrypt-pii`, or hitting the `/settings#pdpa` status endpoint, threw:

```
PrismaClientValidationError:
Invalid `prisma.customer.count()` invocation
  where: { ... phone: { not: null } ... }
                       ~~~~~~~~~~
Argument `not` must not be null.
```

No row was ever encrypted; the headline "X customers not yet encrypted" count on `/settings#pdpa` failed to load. Prod had 4 legacy plaintext rows (`national_id` set, `national_id_hash` NULL) that the backfill was supposed to neutralize but never could.

## Root cause

The plaintext-detection query iterates `PII_COLUMNS` (`apps/api/src/modules/pdpa/services/pdpa-backfill.util.ts`) — 10 `[plaintext, encrypted]` column pairs — and, per column, built an `AND` of three clauses:

```ts
{ [plain]: { not: '' } }      // non-empty
{ [plain]: { not: null } }    // <-- the bug
{ [enc]:   null }             // not yet encrypted
```

Nine of the ten plaintext columns (`nationalId`, `email`, `phoneSecondary`, the address + guardian fields) are `String?` (nullable) — `{ not: null }` is valid on them. But `Customer.phone` is `String` (non-nullable, `apps/api/prisma/schema.prisma:856`). Prisma's filter type for a required `String` field is `StringFilter`, whose `not` accepts a string or a nested filter but **not `null`**. At runtime Prisma validates the where-object against the real field types (client-side, before the DB round-trip) and throws `Argument \`not\` must not be null`.

The clause lived in three call sites, all hitting the `phone` column:
- `plaintextWhere()` — backfill cursor + aggregate count (`getAnyPlaintextCount`)
- `PdpaStatusService.getPlaintextCountsByColumn()` — per-column count (throws on the `phone` iteration)
- `PdpaStatusService.getAnyPlaintextCount()` — one OR query containing the phone clause → the whole query throws

## Why it produced the symptom

Two things turned a type-level mistake into a silent runtime failure:

1. **The cast hid it from `tsc`.** Each clause is written `{ [plain]: { not: null } } as Prisma.CustomerWhereInput`. `[plain]` is a computed string key, so the literal's inferred type is `{ [x: string]: { not: null } }`, and the `as` cast forces it to `Prisma.CustomerWhereInput` — erasing the information that `phone` can't take `not: null`. `./tools/check-types.sh api` stayed green.
2. **Prisma validates against the schema only at query time.** The error surfaces when `prisma.customer.count()` serializes the where-object, not at compile time. Because `getAnyPlaintextCount` ORs all 10 column clauses into one query, the single invalid `phone` clause fails the entire count — so both the backfill cursor and the status headline died.

## Fix

PR #1254. Drop `{ not: null }`; use `{ not: '' }` only. Verified against the dev DB that `{ col: { not: '' } }` generates `WHERE col <> $1`, and in PostgreSQL `NULL <> ''` evaluates to *unknown* → NULL rows are already excluded. So `{ not: '' }` alone yields exactly the intended non-empty, non-null set; `{ not: null }` was both **redundant** and **invalid on `phone`**. The change is semantics-preserving for all 10 columns.

Consolidated the per-column clause into a single helper so the three call sites can't drift again:

```ts
// pdpa-backfill.util.ts
export function plaintextColumnAnd(plain: string, enc: string): Prisma.CustomerWhereInput[] {
  return [
    { [plain]: { not: '' } } as Prisma.CustomerWhereInput,
    { [enc]: null } as Prisma.CustomerWhereInput,
  ];
}
```

`plaintextWhere()`, `getPlaintextCountsByColumn()`, and `getAnyPlaintextCount()` all route through it.

This addresses the root cause (the invalid filter on a non-nullable column) rather than hiding the symptom — e.g. a `try/catch` around the count, or special-casing `phone` out of the loop, would have left the wrong query shape in place.

## How it was found

- The memory pointer named `pdpa-encryption.service.ts:158/180/577` — those lines no longer exist; the query had moved into `services/pdpa-backfill.util.ts` + `services/pdpa-status.service.ts` during the PDPA god-service decompose. Re-located the live sites by grepping for `{ not:` across the module.
- **Hypothesis:** the offending field is non-nullable. Checked `schema.prisma` — of the 10 PII columns, only `phone` is `String` (not `String?`).
- **Confirmed by controlled reproduction** (read-only `customer.count` against the dev DB, one variable changed):
  - `{ nationalId: { not: null } }` (nullable) → OK
  - `{ phone: { not: null } }` (non-nullable) → THROW `PrismaClientValidationError: Argument \`not\` must not be null`
  - `{ phone: { not: '' } }` → OK
- **Disproved the "null-semantics" worry** (the reason the prior session didn't hasty-fix): captured Prisma's generated SQL with query logging — `{ not: '' }` → `WHERE national_id <> $1`, plain `<> ''` with no `OR IS NULL`. Postgres 3-valued logic excludes NULLs, so dropping `{ not: null }` changes nothing.

## Why it slipped through

Two-layer test gap, blameless:

1. **The `as Prisma.CustomerWhereInput` cast on a computed-key object** is a known escape hatch that erases filter-type checking — `tsc` can't catch an invalid `not: null` once the object is cast.
2. **The PDPA service specs mock `prisma.count`** (`pdpa-encryption.service.spec.ts` supplies `perColumnCounts` overrides), so they never validate the where-clause against real Prisma. Every unit test was green while the real query threw.

No CI path exercised the backfill/status query against a real Postgres, and prod had never successfully run `backfill:encrypt-pii` — so the workload that would have surfaced it never ran until now.

## Validation

- **Regression test** `apps/api/src/modules/pdpa/services/pdpa-backfill.util.spec.ts` (new) pins "no `{ not: null }` anywhere" in the builders. Mutation-tested: re-introducing `{ not: null }` turns 3 of its tests red.
- **End-to-end against the dev DB:** the real `plaintextWhere()` and every per-column count — including `phone`, which previously threw — return cleanly (`phone` count `THROW → 1`).
- `./tools/check-types.sh api` OK · `eslint` clean · `pdpa` suite **53/53** green.
- **Coverage caveat:** validated on the **dev** DB only. Not run against prod — per the standing rule, the agent does not run `backfill:*` CLIs; the owner runs the prod backfill.

## Action items / follow-ups

- ✅ Regression test added at the where-builder seam: `pdpa-backfill.util.spec.ts`. (akenarin, merged in #1254.)
- ⬜ **Owner: run `backfill:encrypt-pii` on prod** to neutralize the 4 legacy plaintext rows (`national_id` set, `national_id_hash` NULL) — now unblocked. (akenarin; guarded by `CONFIRM_BACKFILL` + `EXPECTED_DB_NAME`.)
- ⬜ Class-of-bug audit: grep for `as Prisma.*WhereInput` on computed-key objects elsewhere; those spots can hide the same filter-type error from `tsc`. (akenarin, optional.)
