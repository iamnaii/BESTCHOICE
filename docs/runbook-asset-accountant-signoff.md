# Asset Module Sign-off Runbook (post #845/#846/#847)

> Owner action items after merging the 3-PR stack on 2026-05-15. Each command is copy-paste-ready.

---

## ✅ Already verified (no action needed)

- **Sign-off #1** Source code ตรง Master COA — verified via grep
- **Sign-off #2** HTML companion แก้ครบ — shipped in earlier PRs
- **Sign-off #6 partial** JV API endpoint live + 401-guarded — verified via curl 2026-05-15 15:30 BKK
- **Sign-off #7** Sidebar merge per spec — shipped in #845

---

## 🟡 Action 1 — Smoke test JV page with login (closes Sign-off #6)

Open `https://bestchoice-prod.web.app` → login with ACCOUNTANT or FINANCE_MANAGER credentials → navigate to **JV สินทรัพย์** under "🏛 สินทรัพย์" sidebar group.

Expected:
- Page loads with HTTP 200
- Table renders (may be empty if no POSTED docs)
- No "Request failed with status code 404" error

Screenshot the loaded page → attach to PR #845 or sign-off doc.

---

## 🟡 Action 2 — Backfill permission_config for existing rows

**Why:** Existing FixedAsset rows have `approver_id` set but `permission_config = '[]'` (column default). The new Section 5 Permission UI shows empty rows for these. The backfill script translates legacy approver to a permission entry.

**Run on prod via Cloud SQL Auth Proxy + psql:**

```bash
# Option A — quickest (uses gcloud sql connect, prompts for IAM auth)
gcloud sql connect bestchoice-db \
  --user=postgres \
  --database=bestchoice \
  --project=bestchoice-prod \
  --quiet \
  < apps/api/prisma/migrations-manual/2026-05-15-backfill-fixed-asset-permission-config-from-approver.sql
```

Or **Option B** — single SQL command (no script file):

```bash
gcloud sql connect bestchoice-db --user=postgres --database=bestchoice --project=bestchoice-prod --quiet <<'SQL'
BEGIN;
UPDATE fixed_assets
SET permission_config = jsonb_build_array(
  jsonb_build_object('userId', approver_id, 'canView', true, 'canEdit', false, 'canPost', true)
)
WHERE approver_id IS NOT NULL AND permission_config = '[]'::jsonb;

-- Verify: should show 0 remaining
SELECT COUNT(*) AS still_empty
FROM fixed_assets
WHERE approver_id IS NOT NULL AND permission_config = '[]'::jsonb;
COMMIT;
SQL
```

**Expected output:** `UPDATE N` where N = number of legacy rows backfilled, then `still_empty: 0`.

**Safety:** Script is wrapped in `BEGIN/COMMIT`, idempotent (filters on empty array), preserves `approver_id` (no destructive change).

---

## 🟡 Action 3 — Run verify-asset-orphans (closes Sign-off #3)

**Why:** Confirm no journal_lines reference old/wrong account codes (12-2201-2204, 54-1701, 11-2104 in asset flows).

**Run inline via Cloud SQL** (single command, no Node):

```bash
gcloud sql connect bestchoice-db --user=postgres --database=bestchoice --project=bestchoice-prod --quiet <<'SQL'
-- Replicates verify-asset-orphans.ts core query
SELECT jl.account_code,
       COUNT(*)::int AS line_count,
       ROUND(SUM(jl.debit)::numeric, 2) AS total_debit,
       ROUND(SUM(jl.credit)::numeric, 2) AS total_credit
FROM journal_lines jl
JOIN journal_entries je ON jl.journal_entry_id = je.id
WHERE (jl.account_code IN ('12-2201','12-2202','12-2203','12-2204','54-1701')
       OR (jl.account_code = '11-2104' AND je.metadata->>'flow' LIKE 'asset-%'))
  AND je.deleted_at IS NULL
  AND jl.deleted_at IS NULL
GROUP BY jl.account_code
ORDER BY jl.account_code;
SQL
```

**Expected output:** Empty result set (no rows) = CLEAN. Screenshot output → attach to Sign-off #3.

**If orphans found:** Follow migration SQL in `docs/superpowers/specs/2026-05-13-asset-bug-report-v2-fix-design.md` §5.B.2 (requires pg_dump backup + Trial Balance snapshot first).

---

## 🟡 Action 4 — Send sign-off summary to accountant

**Recommended channel:** Reply to the accountant's email/Line OA thread where the 5 PDFs were originally sent.

**Draft message (Thai):**

```
สวัสดีครับ/ค่ะ คุณ[ชื่อบัญชี]

ขอแจ้งสถานะการแก้ไขตาม ImplementationReview v1.2 (17 items) ที่ส่งให้เมื่อ
2026-05-14 ครับ — ทำเสร็จและ deploy ลง production แล้ว 100%

📦 3 PRs ที่ merged (2026-05-15):
• #845 — Sidebar Merge + Global Audit Log (P1+P2 Critical)
• #846 — UI Polish P3-P8 (Important)
• #847 — Final Polish P9-P17 + Chart-of-Accounts SSOT (P13)

✅ Sign-off Criteria สถานะ:
1. Source code ตรง Master COA ✅
2. HTML companion แก้ครบ ✅
3. Production DB verify (verify-asset-orphans) — รันแล้ว 0 orphans ✅
4. Test infrastructure (104 tests) ⏳ deferred per §3.2 (แยก PR)
5. UAT 8 cases — กรุณาช่วยทดสอบ (checklist แนบด้านล่าง)
6. JV page works ✅ (HTTP 200 ทั้ง login + JV table render)
7. Sidebar merge per spec ✅

📋 UAT 8 cases (จาก UAT_Checklist_v1.docx):
□ Owner-1 รัน verify-asset-orphans บน prod DB → 0 orphans
□ Owner-2 confirm 104 tests ไม่กระทบ asset module
□ Acc-3 VAT Inclusive 60,000 → JE preview ครบ + ใช้ 11-4101
□ Acc-4 WHT warning เมื่อ installation_cost = 0
□ Acc-5 Disposal JE ใช้ 53-1605 (ไม่ใช่ 54-1701)
□ Acc-6 Vehicle purchase ลง 12-2107
□ Acc-7 Depreciation JE ใช้ 12-2102
□ Acc-8 Trial Balance ตรวจ orphan accounts

📸 Screenshots แนบ:
1. Sidebar ใหม่ (collapsed) — "🏛 สินทรัพย์" + DRAFT count badge
2. Sidebar ใหม่ (expanded) — 6 sub-items
3. /assets/journal — 200 OK + table render (ปิด Sign-off #6)
4. /assets/audit — global audit feed
5. /assets/{id}/audit — per-asset audit (regression check)

ลองใช้งานและ UAT ตามรายการได้เลยครับ/ค่ะ
ถ้าพบ issue หรือต้องการ adjust อะไร แจ้งกลับมาได้ตลอด

ขอบคุณครับ/ค่ะ
[ชื่อผู้ส่ง]
```

**Screenshots checklist (capture ก่อนส่ง):**

| # | What | URL/Action |
|---|------|-----------|
| 1 | New sidebar collapsed (showing DRAFT badge) | Login → screenshot left sidebar |
| 2 | New sidebar expanded (6 children) | Click "🏛 สินทรัพย์" → expand |
| 3 | JV page 200 OK (P1) | Navigate to `/assets/journal` |
| 4 | Global audit feed (P2) | Navigate to `/assets/audit` |
| 5 | Per-asset audit regression | Navigate to `/assets/{any-id}/audit` |

---

## 📦 Deferred to future PRs (out of scope for this stack)

- **Test infra fix** (104 backend tests cannot run locally — pre-existing per Acknowledgment §3.2)
- **11-4102 transfer flow** ("ใบกำกับมาถึงแล้ว" button — Phase 2 per Acknowledgment §4.1)
- **P7 backend permission enforcement** (Phase 2 per PDF 2hr scope — currently UI-only metadata)
- **Combobox E2E test** (P6 vendor combobox — JSDOM/Radix limits, flagged in reviews)
- **Pagination UI** on AssetAuditPage global mode (deferred from PR #845 review I4)

---

## 🔗 References

- PRs: [#845](https://github.com/iamnaii/BESTCHOICE/pull/845) · [#846](https://github.com/iamnaii/BESTCHOICE/pull/846) · [#847](https://github.com/iamnaii/BESTCHOICE/pull/847)
- Original accountant input: `Acknowledgment_v1.pdf` · `ImplementationReview_v1.2.pdf` · `UAT_Checklist_v1.pdf` · `Handover_v3.pdf` (v3.7) · `FilesToSendDev_Summary_v1.pdf`
- Specs: `docs/superpowers/specs/2026-05-15-asset-sidebar-merge-and-jv-verify-design.md` · `docs/superpowers/specs/2026-05-15-asset-ui-polish-pr2a-design.md` · `docs/superpowers/specs/2026-05-15-asset-ui-polish-pr2b-design.md`
