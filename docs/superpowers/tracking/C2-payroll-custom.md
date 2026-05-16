# C2 · Payroll Custom Income/Deduction (V16–V18)

**Status:** ✅ Done  |  **Started:** 2026-05-16  |  **PRs:** #871 (backend) · this PR (UI). Only C2.7 slip PDF still deferred.
**Spec:** —  ·  **Plan:** —

## Context

Extend PAYROLL doc_type with custom income lines (bonus, OT, per-diem allowances) and custom deduction lines (loan repayment, advances). Adds three validators:
- **V16** Taxable Income = base + Σ(income) − Σ(deduction); WHT computes on taxable
- **V17** Custom Income account must be in 53-XXXX (Expense) whitelist
- **V18** Σ(deduction) ≤ base + Σ(income); prevents negative taxable

UI: expandable row in PayrollFormV4 reveals two sub-sections (income / deduction). JE template emits Dr per-account income + standard payroll JE shape.

## Source

- [Settings Audit Core](_owner-package/Settings_Audit_Core_v2.0.md) §2.8
- [Mockup v5](_owner-package/expense_module_mockup_v5.md) page 02B PayrollPage

## Items Checklist

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| C2.1 | V16 validator — Taxable Income calc + WHT base override | P1 | 🔵 | TBD | [PayrollCustomService.validateLine](../../../apps/api/src/modules/expense-documents/services/payroll-custom.service.ts) returns `{ taxableBase }` = baseSalary + Σ(taxable customIncome). Non-taxable rows (ม.42 exempt) Dr the expense account but DON'T count toward WHT base. Future consumers can use `taxableBase` to compute automatic WHT (today the DTO still accepts raw `whtAmount` so callers can pre-compute). |
| C2.2 | V17 validator — Custom Income account must match `custom_income_accounts_whitelist` setting | P1 | 🔵 | TBD | `loadWhitelist()` reads `system_config.custom_income_accounts_whitelist` (JSON array). Default seed `["53-1104","53-1105"]` via migration. Reject with Thai error pointing to the system_config row for owner override. |
| C2.3 | V18 validator — `Σ(deduction) ≤ base + Σ(income)` invariant | P1 | 🔵 | TBD | Same `validateLine` method enforces. Reject before persist so partially-completed payroll can't poison the JE step. |
| C2.4 | Schema: `payroll_custom_income[]` + `payroll_custom_deduction[]` nested under `Payroll` (Prisma) | P1 | 🔵 | TBD | New `PayrollCustomIncome` + `PayrollCustomDeduction` Prisma models FK'd to `PayrollLine` (not `PayrollDetail`) so each employee can have its own custom rows. Migration `20260929000000_payroll_custom_income_deduction` creates 2 tables + seeds V17 default whitelist. Local dry-run: ✅. |
| C2.5 | `PayrollTemplate.execute` — emit Dr lines for each custom_income.account_code; deductions reduce the net Cr cash leg | P1 | 🔵 | TBD | [payroll.template.ts](../../../apps/api/src/modules/journal/cpa-templates/payroll.template.ts) — added 2 aggregation loops (income by accountCode → Dr; deduction by accountCode → Cr) AFTER WHT line but BEFORE the cash leg. `sumNet` was already computed by service to include income+deduction so the cash Cr lands correctly. All Dr/Cr stay balanced. |
| C2.6 | UI: PayrollFormV4 expandable rows — Custom Income / Custom Deduction tables with quick-add buttons + V16 warning (ม.42 tax-exempt) | P1 | ✅ | this PR | [PayrollLinesSection.tsx](../../../apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx) — chevron toggles accordion per employee row; expanded section renders 2 colored sub-tables (emerald = income, amber = deduction). Income table uses dropdown wired to `CUSTOM_INCOME_WHITELIST` constant matching the migration seed. Deduction table is free-form CoA code. Live `netPaid` recomputes including +income/−deduction. Live `taxableBase` shown when it differs from base. POST forwards `customIncome` + `customDeduction` arrays; server V16/V17/V18 re-validate. UI-only `_expanded` field excluded from POST body. |
| C2.7 | Slip auto-generate — PDF per employee + email send | P1 | ⬜ | — | **Deferred to follow-up PR**. Reuses voucher infrastructure (PaymentVoucherPage pattern). Separate session. |

## Decision Log

- **2026-05-16:** Backend bundle (5/7 items) in one PR; UI (C2.6) + slip PDF (C2.7) deferred to follow-ups. Same pattern as B2/C1.
- **2026-05-16:** Q1 answered — `system_config['custom_income_accounts_whitelist']` JSON array. No new table. Default `["53-1104","53-1105"]` seeded via migration.
- **2026-05-16:** Q2 answered — `isTaxable` is a per-row boolean on `payroll_custom_income`. Server enforces V16 (non-taxable rows excluded from WHT base). UI shows inline note only — no confirm prompt; accounting team is expected to know which items qualify for ม.42 exemption.
- **2026-05-16:** Custom rows hang off `PayrollLine` (not `PayrollDetail`) so each employee gets their own — matches real-world (Employee A gets bonus + loan deduction, Employee B doesn't).

## Open Questions

- [x] Q: Custom Income account whitelist — store in `system_config` JSON, or new `account_whitelist` table? — **system_config JSON**. Minimal infra; matches existing pattern.
- [x] Q: V16 warning "เงินได้ ม.42 ยกเว้นภาษี" is soft (warning) — UX wants a confirm prompt or just inline note? — **Inline note**. Boolean flag on the row.

## Dependencies

- ✅ T0
- Coexists with B1 (SSO change affects payroll); coordinate fixture updates
- Settings 2.8.1 / 2.8.2 (A1) feed C2.2's whitelist
