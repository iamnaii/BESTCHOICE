# C2 · Payroll Custom Income/Deduction (V16–V18)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
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
| C2.1 | V16 validator — Taxable Income calc + WHT base override | P1 | ⬜ | — | File: `apps/api/src/modules/expense-documents/expense-documents.service.ts` (add after V15) |
| C2.2 | V17 validator — Custom Income account must match `custom_income_accounts_whitelist` setting | P1 | ⬜ | — | Same file |
| C2.3 | V18 validator — `Σ(deduction) ≤ base + Σ(income)` invariant | P1 | ⬜ | — | Same file |
| C2.4 | Schema: `payroll_custom_income[]` + `payroll_custom_deduction[]` nested under `Payroll` (Prisma) | P1 | ⬜ | — | Migration adds two new tables FK'd to payroll |
| C2.5 | `PayrollTemplate.execute` — emit Dr lines for each custom_income.account_code; Dr 53-1101 for `base + custom_income`; deductions reduce the net Cr cash leg | P1 | ⬜ | — | File: `apps/api/src/modules/journal/cpa-templates/payroll.template.ts` |
| C2.6 | UI: PayrollFormV4 expandable rows — Custom Income / Custom Deduction tables with quick-add buttons + V16 warning (ม.42 tax-exempt) | P1 | ⬜ | — | Mockup page 02B |
| C2.7 | Slip auto-generate — PDF per employee + email send (slip lists base, custom income, custom deduction, WHT, SSO, net) | P1 | ⬜ | — | Reuses voucher reporting infrastructure |

## Decision Log

(empty)

## Open Questions

- [ ] Q: Custom Income account whitelist — store in `system_config` JSON, or new `account_whitelist` table?
- [ ] Q: V16 warning "เงินได้ ม.42 ยกเว้นภาษี" is soft (warning) — UX wants a confirm prompt or just inline note?

## Dependencies

- ✅ T0
- Coexists with B1 (SSO change affects payroll); coordinate fixture updates
- Settings 2.8.1 / 2.8.2 (A1) feed C2.2's whitelist
