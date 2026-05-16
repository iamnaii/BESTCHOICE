# A1 Settings Audit — Phase 2 Decision Report

**Created:** 2026-05-16 · **Branch:** `chore/a1-settings-audit-phase2`
**Stacks on:** PR #879 (Phase 1 findings, R1+R2+R3 reviewed)
**Status:** 🚦 Phase 2 REPORT — 🛑 STOP for owner D1 scope approval before any implementation

## Purpose

Phase 1 (PR #879) audited 102 settings, found 12 ✅ / 18 ◐ / 71 ❌ / 1 SKIP. This Phase 2 report synthesizes those findings into a **per-sub-section verdict** (✅ APPROVE / 🟡 DEFER / ⏸ SKIP) using the Decision Framework, and proposes a concrete **D1 scope** for owner approval.

**Anti-pattern reminder:** Phase 2 is REPORT only — no implementation. Owner approves D1 scope, then D1 begins per "one PR per item, no bundling."

## Decision Framework (codified from PR #879)

From `_owner-package/Settings_Audit_Index.md`:
- ✅ APPROVE: P0 ≥ 80% missing + P1 ≥ 50% missing → implement
- 🟡 DEFER: P0 ≥ 50% missing but P1 < 50% → P0 only this sprint
- ⏸ SKIP: P0 < 50% missing → system already covers

**Tie-breaker** (R2 codified): ◐ Partial counts toward Missing because every Partial in this audit is one of: (a) consumer doesn't read configured value (dead config), (b) UI offers subset of spec range, (c) value exists in code but not OWNER-editable. All require D1 implementation work.

## Aggregate verdict (whole audit)

Under the tie-breaker:
- P0 missing = (11 ❌ + 11 ◐) / 29 (excl SKIP) = **76%** (just under 80% threshold)
- P1 missing = (32 ❌ + 3 ◐) / 37 = **95%** (well over 50%)
- P2 missing = 100%
- P3 missing = 80%

**Aggregate: ✅ APPROVE** (P0 essentially at threshold; P1 overwhelmingly missing). But "APPROVE for everything" is unrealistic for one sprint — we go sub-section by sub-section.

## Per-sub-section verdicts

Legend: 🟢 = ship in D1 · 🟡 = defer to later sprint · ⏸ = skip (already covered)

### P0 sub-sections (sec 1.1–1.6, 30 items)

| § | Sub-section | Items | Coverage | Verdict | Rationale |
|---|---|---|---|---|---|
| 1.1 | Account Role Map | 7 | 1✅/1◐/5❌ (86% miss) | **🟢 APPROVE** | Schema table exists but no API/UI/audit. Wire CRUD endpoints + admin UI for OWNER. **Pre-req:** Q7 — decide if `account_role_map` consumers should wire up or table should be dropped |
| 1.2 | Document Numbering | 5 | 0✅/2◐/3❌ (100% miss) | **🟡 DEFER** | Format mismatch (YYYYMMDD-NNNN vs YYMMNNN spec) is a breaking change touching every doc number. Wait for Q3 answer. SKIP unless owner overrides spec. |
| 1.3 | Tax Rates | 5+1SKIP | 0✅/5◐ (100% miss) | **🟢 APPROVE** | **Includes Q6 mini-PR (P0 product bug):** VAT_RATE/vat_pct orphan-key fix. Plus WHT rates table + admin UI + effective-date support. Modest scope |
| 1.4 | SSO Configurable | 4 | 4✅ (0% miss) | **⏸ SKIP** | B1 #861 completed. Already done |
| 1.5 | Petty Cash | 5 | 2✅/1◐/2❌ (60% miss) | **🟡 DEFER** | Q1 (account default) + Q8 (replenish dead-setting) unanswered. The biggest gap is 1.5.5 custodian-FK — needs schema change + assignment UI. Wait for owner answers |
| 1.6 | Adjustment Routing | 3 | 0✅/2◐/1❌ (100% miss) | **🟢 APPROVE** | "Wire-up existing dead config" — `account_role_map` already seeds adj_underpay/overpay. Pure wiring exercise across 4 consumer sites (~half-day work). Tied to Q7 |

### P1 sub-sections (sec 2.1–2.8, 37 items)

| § | Sub-section | Items | Coverage | Verdict | Rationale |
|---|---|---|---|---|---|
| 2.1 | Approval Workflow | 6 | 0✅/1◐/5❌ (100% miss) | **🟡 DEFER** | This is a full feature (new state machine + doctype filter + notifier + amount-threshold gate), not a "setting" add. Recommend separate sub-project under its own multi-PR plan. Out of scope for A1 settings sweep |
| 2.2 | Voucher Branding | 7 | 0✅/0◐/7❌ (100% miss) | **🟢 APPROVE** | `CompanyInfo` schema is ready but `PaymentVoucherPage.tsx` has 4 hardcoded `<h1>` headers. Pure wiring exercise — query CompanyInfo, render fields. Logo upload may need 1 storage endpoint |
| 2.3 | Display Preferences | 6 | 1✅/0◐/5❌ (83% miss) | **🟡 DEFER (partial)** | `User.preferences` JSON mechanism is in production (A1.2.3.6 ✅). Wiring 5 individual formatter knobs is sprawling. Recommend pick top 2 (date_format BE↔ค.ศ., decimal_places) for D1; defer the rest |
| 2.4 | Templates Management | 5 | 0✅/1◐/4❌ (100% miss) | **🟡 DEFER** | Templates feature works in basic form. Quotas + ACL + categories = gold-plating. SKIP unless owner has specific complaint |
| 2.5 | Voucher Print Modes | 3 | 0✅/0◐/3❌ (100% miss) | **🟡 DEFER** | Owner hasn't flagged print-mode issues. Skip |
| 2.6 | Date & Period Controls | 4 | 0✅/1◐/3❌ (100% miss) | **🟢 APPROVE** | `period_grace_days` is **referenced in the project deadline** ("grace through 5 มิ.ย. 2569 per `period_grace_days`") — real owner-facing config. Backdate warning threshold (currently hardcoded 30d) is small. Modest scope |
| 2.7 | Reverse Entry | 4 | 0✅/0◐/4❌ (100% miss) | **🟢 APPROVE** | C3 #875/#876 just shipped backend + UI. These 4 settings are owner-facing toggles for the C3 dialog (reason whitelist, required flag, manager-approval window, cascade block). Cheap to add as DB-driven config now while C3 context is fresh |
| 2.8 | Custom Income/Deduction | 2 | 1✅/0◐/1❌ (50% miss) | **🟢 APPROVE** | Only A1.2.8.2 (tax-exempt warning toggle) missing. C2 #871 already shipped whitelist. 1-item fix |

### P2 sub-sections (sec 3.1–3.6, 20 items)

| § | Sub-section | Items | Coverage | Verdict | Rationale |
|---|---|---|---|---|---|
| 3.1 | Notifications | 4 | 0✅/1◐/3❌ (100% miss) | **🟡 DEFER** | Notifications work via current channels (LINE + email). Adding feature flags is non-urgent |
| 3.2 | User Permissions RBAC | 4 | 0✅/0◐/4❌ (100% miss) | **🟡 DEFER** | Q4 — adding Viewer role is schema change; runtime-editable role assignment is a big feature. Defer |
| 3.3 | Integration | 4 | 0✅/0◐/4❌ (100% miss) | **🟡 DEFER** | Existing endpoints work; no complaint |
| 3.4 | Smart Switch | 2 | 0✅/0◐/2❌ (100% miss) | **⏸ SKIP** | Smart switch SAMEDAY→ACCRUAL works fine. Toggling off is rarely needed |
| 3.5 | Expense Summary | 3 | 0✅/0◐/3❌ (100% miss) | **🟡 DEFER** | Existing summary works. Date-range default + warnings nice-to-have |
| 3.6 | Multi-bill Picker | 3 | 0✅/0◐/3❌ (100% miss) | **🟡 DEFER** | V12 multi-line adjustment B2 already covers the underlying functionality |

### P3 sub-sections (sec 4.1–4.3, 15 items)

| § | Sub-section | Items | Coverage | Verdict | Rationale |
|---|---|---|---|---|---|
| 4.1 | UI & UX Defaults | 4 | 0✅/2◐/2❌ (100% miss) | **⏸ SKIP** | Per-user via localStorage works (sidebar, dark mode). OWNER-level default is gold-plating |
| 4.2 | Performance Tuning | 5 | 0✅/0◐/5❌ (100% miss) | **⏸ SKIP** | No perf complaints; these are dev concerns. SKIP |
| 4.3 | Audit & Compliance | 6 | 3✅/1◐/2❌ (50% miss) | **🟢 APPROVE (1 item only)** | A1.4.3.1 `audit_log_retention_days` is **legal compliance** per พ.ร.บ.บัญชี ม.7 — must raise default 180d→1825d (Q2). Other 2 ❌ items (document_retention enforcement, data_export_format) defer until DSAR demand surfaces |

## D1 scope — **OWNER EXPANDED 2026-05-16: "ทำ DEFER และ skip"**

Original Phase 2 proposed 22 items (APPROVE only). Owner directive: include all DEFER items too. SKIP sub-sections stay excluded.

### D1 in scope — 18 sub-sections, ~75 items

🟢 **Originally APPROVE (8 sub-sections, 22 items)**

| § | Sub-section | Items in D1 | Est. effort |
|---|---|---|---|
| 1.1 | Account Role Map | 6 (1.1.1.2–7 — API + UI + validation + audit + admin guard) | 1–2 days |
| 1.3 | Tax Rates | **Q6 mini-PR** (VAT_RATE bug) + 5 ◐ items | 2–3 days |
| 1.6 | Adjustment Routing | 3 (wire 4 consumers + optional auto-route flag) | 0.5 day |
| 2.2 | Voucher Branding | 7 (CompanyInfo wiring + logo storage + QR optional) | 1–2 days |
| 2.6 | Date & Period | 4 (period_grace_days settable + backdate warning configurable + future-date toggle + period_close_day) | 1 day |
| 2.7 | Reverse Entry | 4 (C3 toggles: reason_required + reasons_dropdown + manager_approval_days + cascade_block) | 1 day |
| 2.8 | Custom Income | 1 (A1.2.8.2 tax-exempt warning toggle) | 2 hrs |
| 4.3 | Audit & Compliance | 1 (A1.4.3.1 retention 180→1825d compliance) | 2 hrs |

**Originally approved: ~22 items / 7–11 working days.**

🟡 **Originally DEFER — NOW MOVED INTO D1 (10 sub-sections, ~53 items)**

| § | Sub-section | Items in D1 | Notes |
|---|---|---|---|
| 1.2 | Document Numbering | 3 ❌ + 2 ◐ = 5 | Gated on **Q3** (rename prefixes or accept current). Recommend accept-current → just add SystemConfig override capability without changing format |
| 1.5 | Petty Cash | 2 ❌ + 1 ◐ = 3 (excl 2 ✅) | Gated on **Q1** (default 11-1201 vs 11-1103) + **Q8** (replenish threshold). 1.5.5 custodian-FK is biggest lift |
| 2.1 | Approval Workflow | 5 ❌ + 1 ◐ = 6 | **Largest feature** — new DocumentStatus values, threshold gate, doctype filter, notifier. Likely separate multi-PR sub-project |
| 2.3 | Display Preferences | 5 ❌ (excl 1 ✅) | Wire User.preferences to date_format/decimal_places |
| 2.4 | Templates Management | 4 ❌ + 1 ◐ = 5 | Feature flag + quota + ACL + category taxonomy + variables |
| 2.5 | Voucher Print Modes | 3 ❌ | Print-mode toggle, include-adjustment, partial-columns |
| 3.1 | Notifications | 3 ❌ + 1 ◐ = 4 | Gated on **Q5** (sendgrid vs SMTP). 4 toggleable settings |
| 3.2 | User Permissions RBAC | 4 ❌ | Gated on **Q4** (UserRole enum). Largest schema impact |
| 3.3 | Integration | 4 ❌ | Export flags, recon mode, webhook default-off, api_keys admin |
| 3.5 | Expense Summary | 3 ❌ | Range default + warning + pagination size |
| 3.6 | Multi-bill Picker | 3 ❌ | Max bills + default tick + partial toggle |

**Expanded total: ~75 items.** At avg 0.5–1 day per item (one PR each per anti-pattern #3) → **~5–10 weeks of solo work**. Within the 5 มิ.ย. grace window (~3 weeks left) only the cheapest ~30–40 items are realistic. Recommended D1 sub-prioritization:
1. **Q-unblocked + cheap (start now)**: 2.2 / 2.6 / 2.7 / 2.8 / 1.6 / 4.3.1 / 2.3 / 2.4 / 2.5 / 3.3 / 3.5 / 3.6 (~30 items)
2. **Q-unblocked + big**: 2.1 Approval Workflow (separate sub-project recommended)
3. **Q-blocked**: 1.1 / 1.2 / 1.3 / 1.5 / 3.1 / 3.2 (wait for Q1–Q8)

⏸ **Still SKIP — stays out of D1 (5 sub-sections, 18 items)**

- 1.4 SSO Configurable — already done via B1
- 3.4 Smart Switch (2 items) — works as-is
- 4.1 UI & UX Defaults (4 items) — per-user localStorage works
- 4.2 Performance Tuning (5 items) — no perf complaints; dev-internal concern
- 4.3 partial (5 of 6 items; A1.4.3.1 moved into APPROVE)

## Owner inputs required during D1 execution

D1 will start immediately on Q-unblocked items per owner directive. Q-blocked items wait for answers — please reply to PR #879 with answers to Q1–Q8 (or in this PR's comments). Each Q gates specific sub-sections:
   - Q1 petty_cash_account (11-1201 vs 11-1103) — gates 1.5
   - Q2 audit_log_retention (180→1825d) — confirm for 4.3.1
   - Q3 doc_prefix abbreviations — gates 1.2
   - Q4 UserRole enum changes — gates 3.2
   - Q5 email_provider (drop sendgrid?) — gates 3.1 if approved
   - **Q6 VAT_RATE orphan-key bug** — gates 1.3. Pick fix path
   - **Q7 account_role_map dead-config** — gates 1.1 + 1.6. Wire up or drop?
   - **Q8 petty_cash_replenish_threshold dead-setting** — gates 1.5
D1 follows "one PR per item, no bundling" per anti-pattern #3. PR titles use the schema `feat(a1): D1.<section>.<subsection>.<item> — <short>` so tracking stays atomic.

## Phase 2 complete — D1 begins on Q-unblocked items

Owner approved expanded scope (2026-05-16: "ทำ DEFER และ skip"). This PR remains report-only (no code changes outside `docs/`), but D1 implementation PRs follow in parallel branches per anti-pattern #3 (one PR per item).
