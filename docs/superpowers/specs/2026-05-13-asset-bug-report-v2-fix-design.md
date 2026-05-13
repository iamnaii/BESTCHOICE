# Asset Module — Bug Report v2 Fix (100% PDF Coverage)

**Date**: 2026-05-13
**Status**: Design — pending implementation
**Scope**: Fix all 7 tasks listed in `BugReport_Asset_v2.pdf` Section 5
**References**:
- `BugReport_Asset_v2.pdf` (provided by accountant 2026-05-13)
- `Handover.pdf` v3.5 (master spec)
- `MasterCOA_AssetModule_v1.pdf` (99-account FINANCE chart)

---

## 1. Context

Accountant ตรวจสอบ Asset Acquisition Module deployed 2026-05-11 (PR #806) เทียบกับ Master COA Reference v1.0 และพบ:
- **6 Critical bugs** เกี่ยวกับ chart-of-accounts mapping
- **3 Important issues** UX/documentation

**ข้อค้นพบจากการตรวจ codebase 2026-05-13:** Critical #1-6 ทั้งหมด **ถูกต้องในโค้ดแล้ว** (`asset-purchase.template.ts`, `asset-disposal.template.ts`, `depreciation.template.ts`). Bug รายงานน่าจะมาจาก companion HTML doc (`docs/accounting/journey-asset-v3.html`) ที่ยังมีรหัสบัญชีเก่า — ไม่ใช่ live code.

อย่างไรก็ตาม owner กำหนด **"ทำทั้งหมดที่เกี่ยวกับ PDF 100%"** — รวม production DB verify, doc update, frontend fixes.

---

## 2. Scope (7 Tasks per PDF Section 5)

| # | PDF Task | Stream | Status |
|---|---------|--------|--------|
| 1 | Migrate COA in DB | B | Verify + migrate if needed |
| 2 | Refactor category mapping | A | ✓ Already correct |
| 3 | Run validation script | B | Read-only SELECT |
| 4 | Re-test JE templates | A | Run existing test suites |
| 5 | Update PDF documentation | C | Edit journey-asset-v3.html |
| 6 | Add UI guard for WHT base (= Important issue #8) | D | Frontend fix |
| 7 | Fix "ราคาก่อน VAT" label in Inclusive mode (= Important issue #9) | D | Frontend fix |

**Note on numbering**: PDF uses TWO numbering schemes — Section 1 lists 9 numbered issues (Critical 1-6, Important 7-9), Section 5 lists 7 numbered tasks. This doc uses **Important issue numbers (#8, #9)** when referring to the WHT/VAT fixes (matching PDF Section 4 detail headings).

---

## 3. Architecture (4 Parallel Streams)

```
┌─────────────────────────────────────────────────────────┐
│  Stream A — Backend Verify (5 min)                      │
│  cd apps/api && npm test -- asset                       │
│  → Confirms category mapping correct, no code change    │
├─────────────────────────────────────────────────────────┤
│  Stream B — Prod DB Verify + Migrate (15-30 min)        │
│  Cloud Run Job (ephemeral, node -e + Prisma)            │
│  Phase B.1: Read-only SELECT for orphan accounts        │
│  Phase B.2 (conditional): pg_dump + UPDATE/DELETE       │
├─────────────────────────────────────────────────────────┤
│  Stream C — Update journey-asset-v3.html (15 min)       │
│  ~16 sed-style replacements                             │
│  12-2201/02/03/04 → 12-2102/04/06/08                    │
│  11-2104 → 11-4101                                       │
│  54-1701 → 53-1605                                       │
├─────────────────────────────────────────────────────────┤
│  Stream D — Frontend Fixes (10 min)                     │
│  apps/web/src/pages/assets/components/                  │
│    AssetEntrySection2Cost.tsx                           │
│  Fix #9: VAT label dynamic (inclusive/exclusive)        │
│  Fix #8: WHT base warning when no installation cost     │
└─────────────────────────────────────────────────────────┘
```

Streams run in **parallel via subagents** (per owner feedback "subagent-driven dev works well").

---

## 4. Stream A — Backend Verify

### A.1 Commands attempted

```bash
cd apps/api
npx vitest run src/modules/asset            # vitest
npx jest src/modules/journal/cpa-templates --testPathPattern='asset|depreciation'
```

### A.2 Actual outcome (2026-05-13)

**Test infrastructure broken in dev environment** — both runners failed at setup:

- vitest: `--reporter=basic` unsupported by installed version (4.1.5)
- jest: 5 suites failed at `beforeAll` seed/cleanup with `column chart_of_accounts.createdAt does not exist` and `table public.asset_transfer_history does not exist` (schema drift; A.4 migration not applied to local test DB)

**Fell back to static verification**:
- Read `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.ts` lines 8-13 — confirmed `CATEGORY_CHART` mappings correct
- Read `apps/api/src/modules/asset/dto/create-asset.dto.ts` line 40 — confirmed VAT enum `['11-4101', '11-4102']`
- Read `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` line 15 — confirmed `LOSS_ON_DISPOSAL_CODE = '53-1605'`

PDF Critical #1-6 confirmed as **false positives against documentation, not code**.

### A.3 Follow-up (out of scope of PDF, deferred)

- Fix test DB seed scripts (A.4 migration not applied to local test DB) — separate task
- Eventually run full test suite in CI to confirm runtime mapping

---

## 5. Stream B — Production DB Verify + Migrate

### B.0 Execution status (2026-05-13)

**Deferred to owner — prod DB access denied by harness permissions** during this session.

Deliverable: `apps/api/scripts/verify-asset-orphans.ts` (read-only verification script) — owner can run locally with `npx tsx` or via Cloud Run Job ephemeral container. The script outputs JSON with orphan accounts, asset JE count, CoA presence, and all JE flows. Exit code: 0 = clean, 2 = orphans found, 1 = error.

**Cloud Run Job invocation** (for owner reference):
```bash
SCRIPT_B64=$(base64 -i apps/api/scripts/verify-asset-orphans.ts | tr -d '\n')
JOB="asset-verify-$(date +%s)"
gcloud run jobs create $JOB \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<current-prod-tag> \
  --region=asia-southeast1 \
  --set-cloudsql-instances=bestchoice-prod:asia-southeast1:bestchoice-db \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --cpu=1 --memory=512Mi --task-timeout=120s \
  --command=sh --args="-c,echo $SCRIPT_B64 | base64 -d > /tmp/s.ts && npx tsx /tmp/s.ts"
gcloud run jobs execute $JOB --region=asia-southeast1 --wait
```

If verification returns 0 orphan codes (expected — Asset module deployed 2026-05-11 with correct codes), Phase B.2 (migration) is unnecessary.

### B.1 Phase 1 — Read-only verification (script implementation)

**Pattern**: Cloud Run Job + node/tsx + Prisma Client (verified 2026-04-23).

**SQL** (adapted from PDF Section 5 Step 7):
```sql
SELECT jl.account_code, COUNT(*) AS line_count
FROM journal_lines jl
JOIN journal_entries je ON jl.journal_entry_id = je.id
WHERE jl.account_code IN ('12-2201','12-2202','12-2203','12-2204','54-1701')
   OR (jl.account_code = '11-2104' AND je.metadata->>'flow' LIKE 'asset-%')
GROUP BY jl.account_code;
```

**Adaptation from PDF**: 11-2104 is a **legitimate** account for ม.83/6 (VAT-on-behalf-of-foreign-vendor) — NOT exclusively asset-related. Filter only Asset Module JEs via `metadata.flow LIKE 'asset-%'`.

**Expected result**: 0 rows (since Asset module deployed 2026-05-11 with correct codes; no legacy data).

### B.2 Phase 2 — Migration (conditional)

**Trigger**: Only if Phase 1 returns ≥1 row.

**Pre-flight**:
1. `pg_dump` snapshot of journal_lines + journal_entries + chart_of_accounts
2. Capture Trial Balance totals BEFORE migration (Dr/Cr sum)
3. Get explicit owner confirmation showing exact records to be updated

**Migration SQL** (atomic single CASE — avoids the collision trap where sequential UPDATEs would re-rename freshly-updated rows. Example collision: Step 1 renames `12-2201 → 12-2102`; Step 2 then sees the newly-renamed rows alongside legitimate `12-2102` rows and reclassifies BOTH as IMPROVEMENT cost. The CASE expression evaluates source codes ONCE per row, so the mapping is unambiguous.):

```sql
BEGIN;

-- Single-pass atomic remap. CASE evaluates the ORIGINAL account_code for each
-- row exactly once — no intermediate state where a row could match two rules.
UPDATE journal_lines SET account_code = CASE account_code
    WHEN '12-2201' THEN '12-2102'  -- EQUIPMENT contra
    WHEN '12-2202' THEN '12-2104'  -- IMPROVEMENT contra
    WHEN '12-2203' THEN '12-2106'  -- FURNITURE contra
    WHEN '12-2204' THEN '12-2108'  -- VEHICLE contra
    WHEN '12-2102' THEN '12-2103'  -- IMPROVEMENT cost (was mislabeled)
    WHEN '12-2103' THEN '12-2105'  -- FURNITURE cost (was mislabeled)
    WHEN '12-2104' THEN '12-2107'  -- VEHICLE cost (was mislabeled)
    WHEN '11-2104' THEN '11-4101'  -- VAT input (Asset scope only)
    WHEN '54-1701' THEN '53-1605'  -- Loss on disposal
    ELSE account_code              -- safety: leave unrelated codes untouched
  END
  WHERE account_code IN ('12-2201','12-2202','12-2203','12-2204',
                         '12-2102','12-2103','12-2104',
                         '11-2104','54-1701')
    AND journal_entry_id IN (
      SELECT id FROM journal_entries
      WHERE metadata->>'flow' LIKE 'asset-%' AND deleted_at IS NULL
    )
    AND deleted_at IS NULL;

-- Verify Trial Balance unchanged
SELECT SUM(debit) - SUM(credit) AS net FROM journal_lines WHERE deleted_at IS NULL;
-- Expected: 0 (unchanged)

COMMIT; -- only if Trial Balance still balanced
```

**Important caveats**:
- Do NOT delete `11-2104` from `chart_of_accounts` — used by ม.83/6 flow (other modules).
- The CASE expression is essential: sequential UPDATEs would corrupt data because target codes (`12-2102`, `12-2103`, `12-2104`) collide with source codes in the rename map.
- The WHERE-clause IN-list is critical safety: without it, every row would re-write itself to `ELSE account_code` (no-op but full table scan + bloat).
- All scope by `metadata->>'flow' LIKE 'asset-%'` to avoid touching non-Asset journal lines.

### B.3 Verification

Re-run Phase 1 SELECT → expect 0 rows.

---

## 6. Stream C — Update `journey-asset-v3.html`

### C.1 File

`/Users/iamnaii/Desktop/App/BESTCHOICE/docs/accounting/journey-asset-v3.html` (77KB, ~877 lines)

### C.2 Replacements (≥16 occurrences)

| Line(s) | Old | New |
|--------|-----|-----|
| 139 | `Dr 11-2104 (ลูกหนี้-VAT)` | `Dr 11-4101 (ภาษีซื้อ)` |
| 186 | `12-2201` (EQUIPMENT contra) | `12-2102` |
| 187 | `12-2202` IMPROVEMENT contra; text mentions `12-2102` | contra `12-2104`; text mentions `12-2103` |
| 188 | `12-2203` FURNITURE contra; text mentions `12-2103` | contra `12-2106`; text mentions `12-2105` |
| 189 | `12-2204` VEHICLE contra; text mentions `12-2104` | contra `12-2108`; text mentions `12-2107` |
| 191-194 | Expense pairings referencing wrong contras | Update to paired contra codes |
| 426, 501, 518, 762 | `12-2201` in JE examples | `12-2102` |
| 519, 658 | `54-1701` | `53-1605` |
| 646 | Sum `12-2201 + 12-2202 + 12-2203 + 12-2204` | `12-2102 + 12-2104 + 12-2106 + 12-2108` |

### C.3 Verification

```bash
grep -n "12-2201\|12-2202\|12-2203\|12-2204\|11-2104\|54-1701" docs/accounting/journey-asset-v3.html
```
Expected: 0 matches (or only contextual matches like "เปลี่ยนจาก 11-2104 เป็น 11-4101").

---

## 7. Stream D — Frontend Fixes

### D.1 File

`apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx`

### D.2 Fix #9 — "ราคาก่อน VAT" label in Inclusive mode

**Bug**: In Inclusive mode, user types 60,000 (including VAT). UI shows label "ราคาก่อน VAT" but value displayed = 60,000 (user input), not the extracted 56,074.77.

**Root cause**:
- Line 47 input label hardcoded "ราคาก่อน VAT *"
- Line 222 live totals label "ราคาก่อน VAT" with `{fmt(basePrice)}` (form-watched user input)

**Fix**:

Input label (line 47):
```tsx
<Label>{vatInclusive && hasVat ? 'ราคาที่กรอก (รวม VAT)' : 'ราคาก่อน VAT'} *</Label>
```

Live totals (line 222-224):
```tsx
<div className="flex items-center gap-1.5 text-muted-foreground">
  <Coins className="size-3.5" />
  ราคาก่อน VAT
</div>
<div className="text-xl font-semibold tabular-nums">{fmt(calc.basePrice)}</div>
```
(Changed `{fmt(basePrice)}` → `{fmt(calc.basePrice)}` — `useAssetCalculation` already returns extracted ex-VAT amount.)

### D.3 Fix #8 — WHT base UI guard

**Bug**: When user toggles `hasWht=true` but installationCost = 0 and whtBaseAmount is empty, WHT silently computes to 0. User assumes WHT is being deducted but it's not.

**Fix**: Add warning UI inside WHT block when both inputs are zero/empty.

```tsx
{hasWht && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-6">
    {/* ... existing inputs ... */}
  </div>
)}
{hasWht && (Number(whtBaseAmount) || 0) === 0 && (Number(installationCost) || 0) === 0 && (
  <div className="ml-6 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
    <p className="font-medium text-warning flex items-center gap-1.5">
      <AlertTriangle className="size-4" />
      ไม่มีฐานคำนวณ WHT
    </p>
    <p className="mt-1 text-muted-foreground">
      ไม่มีค่าติดตั้งและไม่ระบุฐาน WHT → ระบบจะไม่หัก WHT (= 0). WHT หักเฉพาะค่าบริการตาม ทป.4/2528 — ถ้าซื้อสินค้าอย่างเดียวให้ปิด toggle WHT
    </p>
  </div>
)}
```

(Watch `installationCost` and `whtBaseAmount` via `useFormContext`.)

---

## 8. Testing Strategy

### 8.1 Existing tests (Stream A — verified via static read only)
- `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` — verifies 53-1605, 11-4101 mappings
- `apps/api/src/modules/journal/cpa-templates/asset-purchase.template.spec.ts` (sibling, no `__tests__/`)
- `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.spec.ts` (sibling)

(Could not run in dev — see §4.A.2 for fallback verification path.)

### 8.2 New tests delivered (Stream D)

**Vitest hook spec** at `apps/web/src/pages/assets/hooks/useAssetCalculation.test.ts` (7 tests, all green):

- VAT extraction — Inclusive 60,000 → basePrice 56,074.77 + VAT 3,925.23
- VAT extraction — Exclusive 100,000 → basePrice 100,000 + VAT 7,000
- VAT — `hasVat=false` → basePrice unchanged
- WHT — `installation=3000` defaults whtBase
- WHT — `installation=0 + whtBaseAmount=0` → whtAmount=0 (UI-warning-territory)
- WHT — `whtBaseAmount` overrides installation default
- JE balance — full purchase with VAT + WHT lines balances

**Deferred** (not in PDF strict scope, follow-up work):
- RTL component test for WHT warning visibility — defer until React Testing Library setup added for assets page (no existing precedent in `apps/web/src/pages/`)

### 8.3 Manual UAT (recommended before PR merge)
- Open `/assets/new`, toggle VAT inclusive ON, input 60,000 → live total displays 56,074.77 with label "ราคาก่อน VAT" (extracted basePrice)
- Toggle WHT ON without installation → expect warning box visible
- Add installation cost 3,000 → warning hides; WHT calculated 90 (= 3,000 × 3%)

---

## 9. Error Handling

### 9.1 Stream B (DB)
- If `pg_dump` fails → abort, do not proceed to UPDATE
- If Trial Balance differs after migration → ROLLBACK, alert owner
- If owner declines migration approval → exit with verify-only state

### 9.2 Streams C, D
- Standard error handling: if test fails, fix-forward
- No data migration risk (HTML edits + frontend TSX)

---

## 10. Deployment Plan

1. Stream A finishes first (test suite ~5 min) — confirm baseline green
2. Stream B Phase 1 (read-only) finishes — confirm no orphans (likely path)
3. Streams C + D run in parallel via subagents
4. After all 4 streams green: run full type-check (`./tools/check-types.sh all`)
5. Commit per stream (atomic commits for revert clarity):
   - `docs(asset): update journey-asset-v3.html to match Master COA` (18 edits)
   - `chore(asset): add verify-asset-orphans.ts prod verification script` (Stream B deliverable)
   - `fix(asset): VAT label + WHT base UI guard (Bug Report v2 #8, #9)` (Stream D + new vitest spec)
6. Push as single PR titled `fix(asset): Bug Report v2 — PDF compliance`

---

## 11. Out of Scope

- ❌ Migrate the older `journey-asset-module.html` (v2, May 9) — superseded by v3
- ❌ Update Handover.pdf v3.5 — it's already correct (has §0 Master COA Enforcement)
- ❌ Re-architecting category → COA pinning (already done in Fix #1.2)
- ❌ Adding new asset categories (out of bug report scope)

---

## 12. Success Criteria — Final Status (2026-05-13)

- [x] **Stream A** (static): Code mappings verified via direct read — `asset-purchase.template.ts:8-13`, `asset-disposal.template.ts:15`, DTO enum. Test runner blocked by env (test DB schema drift) — runtime verification deferred to CI.
- [ ] **Stream B**: Prod DB verify deferred to owner via `apps/api/scripts/verify-asset-orphans.ts`. Expected: 0 orphans. Owner to run before/after PR merge.
- [x] **Stream C**: `grep "12-2201\|12-2202\|12-2203\|12-2204\|54-1701" docs/accounting/journey-asset-v3.html` returns 0 matches (18 edits applied). 11-2104 removed from primary references; remaining matches (if any) are contextual.
- [x] **Stream D code**: Component edits applied + 7 vitest tests pass. **Manual UAT pending** — recommend owner test in `/assets/new` before merge.
- [ ] **PR**: To be created with description mapping each fix to PDF task # (1-7).

**Round-by-round review log**:
- Round 1 — 0 critical, 2 warnings (basePrice dead code removed; SQL design verified)
- Round 2A (accounting policy) — PASS, all JE examples balanced + correct codes
- Round 2B (frontend edge cases) — PASS, 6/6 checks
- Round 3 (cross-stream consistency) — found 7 spec/reality gaps, amended in this revision
- Round 4 — pending
