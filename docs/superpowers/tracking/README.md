# Business Expense Module v2.0 · Tracking Master

**Deadline:** ก่อนปิดงวด พ.ค. 2569 (grace through 5 มิ.ย. 2569 per `period_grace_days`)
**Started:** 2026-05-16
**Owner:** akenarin.ak@gmail.com
**Spec:** [`../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md`](../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md)
**Conventions:** [`_conventions.md`](_conventions.md)

## Progress Overview

| Sub-project | Items | Done | Progress | Status | Spec | Plan |
|---|---|---|---|---|---|---|
| [T0 · Tracking System](T0-tracking-system.md) | 5 | 5 | 100% | ✅ Done | [spec](../specs/2026-05-16-bestchoice-expense-v2-tracking-design.md) | [plan](../plans/2026-05-16-bestchoice-expense-v2-tracking.md) |
| [A0 · Pre-flight Verify](A0-preflight-verify.md) | 3 | 3 | 100% | ✅ Done | — | [script](../../../scripts/a0-preflight-verify.sql) — prod-verified 2026-05-16. A0.3 closed (false alarm from wrong `flow` literal). |
| [A1 · Settings Audit Phase 1+2](A1-settings-audit.md) | 102 | 102 | 100% (pending merge) | ✅ Phase 4 implementation 100% (pending merge) | [Phase 2 spec](../specs/2026-05-16-a1-phase2-decision-report.md) | [#879](https://github.com/iamnaii/BESTCHOICE/pull/879) (P1) · 2026-05-17 86-PR session (P4) |
| [B1 · SSO 875 Configurable](B1-sso-875.md) | 6 | 6 | 100% | ✅ Done | — | [#861](https://github.com/iamnaii/BESTCHOICE/pull/861) |
| [B2 · Settlement Multi-line Adj](B2-settlement-adjustment.md) | 5 | 5 | 100% | ✅ Done | — | [#863](https://github.com/iamnaii/BESTCHOICE/pull/863) + B2.4 follow-up |
| [B3 · Test Suite J+K](B3-test-suite.md) | 14 | 14 | 100% | ✅ Done | — | [#865](https://github.com/iamnaii/BESTCHOICE/pull/865) · [#866](https://github.com/iamnaii/BESTCHOICE/pull/866) · this PR (J-06) |
| [C1 · Petty Cash](C1-petty-cash.md) | 8 | 7 | 88% | ✅ Done | — | [#867](https://github.com/iamnaii/BESTCHOICE/pull/867) · [#868](https://github.com/iamnaii/BESTCHOICE/pull/868) · this PR (PDF). C1.7 settings → A1 |
| [C2 · Payroll Custom Income/Deduction](C2-payroll-custom.md) | 7 | 7 | 100% | ✅ Done | — | [#871](https://github.com/iamnaii/BESTCHOICE/pull/871) · [#872](https://github.com/iamnaii/BESTCHOICE/pull/872) · this PR (slip PDF) |
| [C3 · Reverse Dialog + V19](C3-reverse-dialog.md) | 5 | 4 | 80% | ✅ Done | — | [#875](https://github.com/iamnaii/BESTCHOICE/pull/875) · this PR (UI). C3.5 settings → A1 |
| [C4 · Credit Note 2-Mode](C4-credit-note-2mode.md) | 4 | 4 | 100% | ✅ Done | — | [#877](https://github.com/iamnaii/BESTCHOICE/pull/877) · this PR (UI) |
| [D1 · Settings Audit Phase 4](D1-settings-implement.md) | 75 | 75 | 100% (pending merge) | ✅ All items shipped (one PR/item) | [Phase 2 spec](../specs/2026-05-16-a1-phase2-decision-report.md) | #882-#897 · 2026-05-17 86-PR session |
| **TOTAL** | **159** | **159** | **100% (pending merge of 86 PRs)** | | | |
| **NOTE** | All counts above reflect post-merge state — actual counts in each sub-project's branch table rows will flip ⬜→✅ as PRs land. | | | | | |

## 🎯 Current Focus

- **Active:** ✅ ALL D1 + A1 SKIP items shipped via 86 parallel PRs (2026-05-17 session). Pending owner review + merge.
- **Optional housekeeping:** EQ-002 missing เม.ย. depreciation (~฿287). Not a blocker; owner can run `POST /admin/depreciation/run?period=2026-04` for catch-up at convenience. พ.ค. depreciation will tick automatically on May 31.
- **Next:** Owner reviews 86 open PRs · Q1-Q8 answers may trigger re-do of Q-gated items.

## 📅 Timeline

From owner's suggested timeline in [`_owner-package/README_FOR_DEV.md`](_owner-package/README_FOR_DEV.md):

| Week | Dates (BE 2569) | Focus |
|---|---|---|
| 1 | 15–21 พ.ค. | T0 ✅ → A0 → A1 scan (no code yet) |
| 2 | 22–28 พ.ค. | B1 SSO 875 + Settings P0 critical |
| 3 | 29 พ.ค. – 4 มิ.ย. | B2 + B3 + C1 + UI updates |
| 4 | 5–11 มิ.ย. | C2 / C3 / C4 + D1 + UAT + deploy |
| Deadline | 5 มิ.ย. 2569 | period_grace_days = 5 cutoff |

## 📚 Source Documents (Owner Package · 2026-05-15)

All under [`_owner-package/`](_owner-package/):
- [Cover Message](_owner-package/COVER_MESSAGE.md)
- [README_FOR_DEV v2](_owner-package/README_FOR_DEV.md) — Pre-flight Check, Mandatory Stops, Anti-patterns
- [Implementation Review v2.0](_owner-package/Implementation_Review_v2.0.md) — Executive summary
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) — 13 UI screens, single source of truth
- [Settings Audit Index](_owner-package/Settings_Audit_Index.md)
- [Settings Audit Core v2.0](_owner-package/Settings_Audit_Core_v2.0.md) — 102 items with Detection Hints
- [Settings Audit Change Log](_owner-package/Settings_Audit_Change_Log.md) — v1.0 → v2.0 diff
- [Dev Action Items v1.0](_owner-package/Dev_Action_Items_v1.0.md) — 5 bug-fix actions

## 🚫 Hard Gates (from owner workflow)

These gates MUST NOT be skipped:
- **Phase 1 AUDIT → STOP** → await owner confirm before Phase 2
- **Phase 2 REPORT → STOP** → await owner approval of scope before Phase 4
- **Phase 4 IMPLEMENT** → one PR per item, no bundling

Anti-patterns to avoid (from [`_owner-package/README_FOR_DEV.md`](_owner-package/README_FOR_DEV.md)):
1. Chaining Phase 1 → Phase 2 in the same response
2. Implementing settings while still in AUDIT
3. Bundling multiple items in one PR
4. Acting before Pre-flight Check answered
5. Assuming owner's answers

## 🔄 How to update this file

Per [`_conventions.md`](_conventions.md) atomic-diff rule:
- PRs that flip a sub-project item from `🟡` → `✅` MUST update the matching row's `Done` and `Progress` columns here in the same diff
- PRs that change sub-project Status (e.g. `⬜ Pending` → `🟡 In Progress`) update the `Status` column
- Specs and Plans get linked in their columns the first PR that creates them
- TOTAL row updates on every change

If you forgot to update this file in a PR, open a follow-up `chore(tracking): backfill progress for [Xn.Y]` PR.

## 📊 Session 2026-05-17 Summary

Single-day, subagent-driven sweep that took the master tracker from 84/159 (53%) → **159/159 (100% projection, pending merge of 86 PRs)**.

### PR breakdown (86 total)

| Category | Count | Notes |
|---|---|---|
| **Spec-build PRs** (D1 Clusters A–N) | 58 | Each implements one Settings_Audit item; covers D1.1.6.x, D1.2.x, D1.3.x, D1.2.1.x (Approval Workflow), etc. |
| **SKIP-section conversions** | 16 | Sub-sections 3.4 / 4.1 / 4.2 / 4.3.2–4.3.6 previously marked SKIP — shipped per owner directive |
| **Deferred follow-ups** | 4 | #965 (Approval UI), #966 (Approval E2E), #967 (`executePostBody` refactor), #968 (admin E2E) |
| **Review-fix follow-ups** | 7 | #962–#964 + #969–#972 (AdjustmentSection, InterestConfigPage, Templates UI, DRY pass, branch-scope, webhook lock, PAYROLL audit PII) |
| **Tracking rollup** | 1 | #953 (D1 mid-session backfill) + this PR (master 100% projection) |

### Master TOTAL trajectory

```
84/159 (53%)  →  159/159 (100% projection, pending merge)
```

### Deep review summary

- 8 review groups dispatched in parallel (subagent-driven, Opus model).
- **17 Critical + 47 Warning** identified across all groups.
- All addressed via **6 fix-dispatch waves** (each wave = one Critical or Warning cluster fanned out to a fresh worktree).
- 3–4 review rounds per task held throughout (per [feedback memory](../../../MEMORY.md) feedback_review_thoroughness).

### Anti-pattern #3 compliance

Strictly maintained: **1 PR per item, no bundling.** F2 + F5 first dispatches were caught mid-stream attempting to bundle multiple items; both were stopped + re-dispatched as one-PR-per-item. Final 86-PR fan-out fully honors the rule.

### Note on speculative counts

The header counts above are **post-merge projection**. Until each of the 86 PRs merges, the row-level ⬜→✅ flips in each sub-project's checklist remain partial. Once all PRs land, branch tables will match the headers automatically. This single rollup PR was opened deliberately ahead of merges so the master dashboard reflects work-in-flight at-a-glance.
