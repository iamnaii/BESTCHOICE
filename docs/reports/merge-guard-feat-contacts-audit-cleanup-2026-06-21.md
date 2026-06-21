# Merge Guard Report — feat/contacts-audit-cleanup
**Date**: 2026-06-21  
**Run type**: Scheduled pre-merge review  
**Scope**: 1 open PR + 2 recently-active unmerged branches

---

## Open PRs Found: 1

### PR #1150 — feat(contacts): trade-in seller name on contact card + audit cleanup
- **Branch**: `feat/contacts-audit-cleanup` → `main`
- **Opened**: 2026-06-04
- **Author**: iamnaii
- **Commits**: 1 functional commit on top of PR base (`3ad5e99c`)
- **PR URL**: https://github.com/iamnaii/BESTCHOICE/pull/1150

#### File Changes Summary
| File | Lines |
|------|-------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +18 / -8 (TradeInTile grid + seller name field) |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37 / 0 (2 new tests) |
| `docs/superpowers/specs/*-design.md` (×4) | header update: `รออนุมัติ` → `✅ DONE` |

**Nature**: Frontend-only. No backend changes, no Prisma schema, no API routes.

---

## Issues by Severity

### ⛔ Critical — 0 issues
No missing guards, no `Number()` on money fields, no missing `deletedAt: null`, no hardcoded secrets.

---

### ⚠️ Warning — 1 issue

**W1 — PR is behind main; label divergence risks regression on squash-merge**

The PR base SHA (`3ad5e99c`) is **not in current `main`'s git history**. Main has advanced 4+ commits since the PR was opened. Among those post-PR commits, `ba1d5a19` renamed `ผู้ขาย` → `ผู้จัดจำหน่าย` in `ContactDetailPage.tsx` at 4 locations:

| Line | main (`a420359a`) | PR branch (`2d3f7428`) |
|------|-------------------|------------------------|
| `ROLE_LABELS.SUPPLIER` | `'ผู้จัดจำหน่าย'` | `'ผู้ขาย'` |
| `SupplierTile` CardTitle | `ผู้จัดจำหน่าย` | `ผู้ขาย` |
| `SupplierTile` CardLink label | `เปิดข้อมูลผู้จัดจำหน่าย / แก้ไข` | `เปิดข้อมูลผู้ขาย / แก้ไข` |
| Empty-state text | `ยังไม่ผูกกับลูกค้า/ผู้จัดจำหน่าย` | `ยังไม่ผูกกับลูกค้า/ผู้ขาย` |

**The PR commit itself does NOT modify any of these 4 lines** — confirmed via `git diff 3ad5e99c..2d3f7428`. A **3-way merge commit** will correctly take main's `ผู้จัดจำหน่าย` for those untouched lines. A **squash merge** of the branch HEAD would revert the rename.

**Action required before merge:**
1. Rebase `feat/contacts-audit-cleanup` onto current `main`, OR
2. Use **"Create a merge commit"** (not squash). After merge, assert `git grep 'ผู้จัดจำหน่าย' apps/web/src/pages/ContactDetailPage.tsx` returns the 4 expected lines.

---

### ℹ️ Info — 2 notes

**I1 — `label="ชื่อผู้ขาย"` is intentional, not a label regression**

The new field label `"ชื่อผู้ขาย"` in `TradeInTile` refers to the **seller of the second-hand device** (คนเอาเครื่องมาขาย) — this is the same `ผู้ขาย` context explicitly preserved by commit `3530d33c`, which documented keeping the term for trade-in. Not a bug.

**I2 — `Field` component null-safety confirmed**

The new `value` expression:
```tsx
tradeIn.sellerName
  ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
  : tradeIn.sellerPhone
```
When both `sellerName` and `sellerPhone` are null → value is `null`. `Field` renders `'—'` via `{value || '—'}`. Type-safe: `ContactTradeInLink.sellerName/sellerPhone` are both `string | null`.

**Tests added:**
- `shows the seller name in the trade-in tile` — covers name+phone format ✓
- `hides the summary strip when the summary fetch fails` — regression test for C-spec ✓

---

## Additional Branch Scans (not yet PRs)

### `feat/employee-master` — 164 unique commits, no open PR
Spot-check on new controllers:

| Controller | Class-level `@UseGuards` | `@Roles` on each method |
|-----------|--------------------------|-------------------------|
| `EmployeesController` | ✅ `JwtAuthGuard, RolesGuard` | ✅ `OWNER, ACCOUNTANT` / `OWNER, ACCOUNTANT, FINANCE_MANAGER` |
| `TwoFactorController` | ✅ `JwtAuthGuard` | n/a (user-scoped self-service, no role needed) |

PII protection in new `provisionable` endpoint: `nationalId` explicitly excluded from `select` projection. Comment documents intent. Tests verify exclusion.

No `Number()` on Decimal fields found in scanned service files.

### `feat/payroll-backfill` — 6 new commits atop employee-master, no open PR
Spot-check on new files:

| File | Issue |
|------|-------|
| `SsoConfigController` | ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` at class level |
| `backfill-payroll-user-fk.cli.ts` | ✅ EXPECTED_DB_NAME + ALLOW_PROD_BACKFILL guards, idempotent |
| `backfill-employee-profiles.cli.ts` | ✅ Same guard pattern as `wipe-accounting.cli.ts` |
| `expense-documents.controller.ts` delta | Minimal: only adds `user.role` param to `findOne`; no new endpoints |

No `Number()` on financial fields. No raw `$queryRaw` with unparameterized input. Backfill CLIs mirror the established pattern from `wipe-accounting.cli.ts`.

---

## Recommendations

| Item | Status | Action |
|------|--------|--------|
| PR #1150 | **REVIEW** | Rebase onto main first. Use merge commit. Post-merge grep check on `ผู้จัดจำหน่าย`. No code changes required. |
| `feat/employee-master` | No PR yet | Security posture looks healthy. Suggest opening PR when ready. |
| `feat/payroll-backfill` | No PR yet | Backfill CLIs need prod dry-run and owner sign-off before applying. |

**Overall verdict for PR #1150: REVIEW** — functional change is clean; only the merge method needs care to avoid a label regression.
