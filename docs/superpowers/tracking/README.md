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
| [A1 · Settings Audit Phase 1+2](A1-settings-audit.md) | 102 | 12 | 12% | ✅ Phase 1+2 done | [Phase 2 spec](../specs/2026-05-16-a1-phase2-decision-report.md) | [#879](https://github.com/iamnaii/BESTCHOICE/pull/879) (P1) · this PR (P2) |
| [B1 · SSO 875 Configurable](B1-sso-875.md) | 6 | 6 | 100% | ✅ Done | — | [#861](https://github.com/iamnaii/BESTCHOICE/pull/861) |
| [B2 · Settlement Multi-line Adj](B2-settlement-adjustment.md) | 5 | 5 | 100% | ✅ Done | — | [#863](https://github.com/iamnaii/BESTCHOICE/pull/863) + B2.4 follow-up |
| [B3 · Test Suite J+K](B3-test-suite.md) | 14 | 14 | 100% | ✅ Done | — | [#865](https://github.com/iamnaii/BESTCHOICE/pull/865) · [#866](https://github.com/iamnaii/BESTCHOICE/pull/866) · this PR (J-06) |
| [C1 · Petty Cash](C1-petty-cash.md) | 8 | 7 | 88% | ✅ Done | — | [#867](https://github.com/iamnaii/BESTCHOICE/pull/867) · [#868](https://github.com/iamnaii/BESTCHOICE/pull/868) · this PR (PDF). C1.7 settings → A1 |
| [C2 · Payroll Custom Income/Deduction](C2-payroll-custom.md) | 7 | 7 | 100% | ✅ Done | — | [#871](https://github.com/iamnaii/BESTCHOICE/pull/871) · [#872](https://github.com/iamnaii/BESTCHOICE/pull/872) · this PR (slip PDF) |
| [C3 · Reverse Dialog + V19](C3-reverse-dialog.md) | 5 | 4 | 80% | ✅ Done | — | [#875](https://github.com/iamnaii/BESTCHOICE/pull/875) · this PR (UI). C3.5 settings → A1 |
| [C4 · Credit Note 2-Mode](C4-credit-note-2mode.md) | 4 | 4 | 100% | ✅ Done | — | [#877](https://github.com/iamnaii/BESTCHOICE/pull/877) · this PR (UI) |
| [D1 · Settings Audit Phase 4](D1-settings-implement.md) | ~75 | 13 | 17% | 🟢 In Progress (one PR/item) | [Phase 2 spec](../specs/2026-05-16-a1-phase2-decision-report.md) | #882-#893 · this PR |
| **TOTAL** | **~159** | **80** | **~50%** | | | |

## 🎯 Current Focus

- **Active:** 🟢 **D1 Settings Implementation in progress.** Owner expanded scope ("ทำ DEFER และ skip") = ~75 items / 18 sub-sections, one PR each per anti-pattern #3. Starting Q-unblocked items.
- **Optional housekeeping:** EQ-002 missing เม.ย. depreciation (~฿287). Not a blocker; owner can run `POST /admin/depreciation/run?period=2026-04` for catch-up at convenience. พ.ค. depreciation will tick automatically on May 31.
- **Next:** Owner reviews [A1 audit findings](A1-settings-audit.md) + 5 open questions → signals go-ahead → Phase 2 (REPORT only) → STOP again → owner approves scope → D1 implements.

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
