# Pre-Merge Guard Report — 2026-06-15

**Generated**: 2026-06-15 (run4)
**Reviewer**: Automated guard (claude-sonnet-4-6)
**Branches reviewed**: 3 newly unreviewed branches (Party Master / Contact Picker stack)
**Total unmerged branches in repo**: 383

---

## Summary

| Branch | Commits (vs main) | Author | Critical | Warning | Info | Recommendation |
|---|---|---|---|---|---|---|
| `feat/contact-picker-slice1` | 9 | Akenarin Kongdach | 0 | 1 | 1 | ✅ APPROVE |
| `feat/party-master-mandatory-p3` | 3 (+ ~10 from p0-p2 + slice1) | Akenarin Kongdach | 0 | 2 | 1 | ⚠️ REVIEW |
| `feat/contacts-followups` | 2 (downstream of p3) | Akenarin Kongdach | 0 | 0 | 1 | ✅ APPROVE |

**Note on stacking**: These 3 branches form a stacked series.
`feat/contact-picker-slice1` → `feat/party-master-mandatory-p3` → `feat/contacts-followups`.
Merge in order: slice1 first, then p3, then contacts-followups.

---

## Branch 1: `feat/contact-picker-slice1`

**Author**: Akenarin Kongdach  
**Last updated**: 2026-06-04  
**Commits (9)**: ContactCombobox component + `POST /contacts/:id/ensure-role` backend endpoint + tests

### Files Changed
- `apps/api/src/modules/contacts/contact-resolver.service.ts` — adds `ensureRole()` method
- `apps/api/src/modules/contacts/contacts.controller.ts` — new `POST :id/ensure-role` endpoint
- `apps/api/src/modules/contacts/contacts.service.ts` — wraps resolver in tx + audit log
- `apps/api/src/modules/contacts/dto/ensure-role.dto.ts` — new DTO
- `apps/web/src/components/contacts/ContactCombobox.tsx` — new reusable PEAK-style picker (178 lines)
- `apps/web/src/lib/api/contacts.ts` — adds `ensureRole` client method
- 3 new test files (controller + service + resolver specs)
- 1 spec doc file

### Security Checks

| Check | Result |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controller endpoints | ✅ Class-level guards on `ContactsController` |
| `@Roles()` on `POST :id/ensure-role` | ✅ `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT` |
| `deletedAt: null` in `ensureRole` queries | ✅ All contact/supplier queries include filter |
| No `Number()` on money fields | ✅ N/A (no money in this branch) |
| No raw `fetch()` in frontend | ✅ Uses `contactsApi.ensureRole()` → `api.post()` |
| No raw `$queryRaw` | ✅ Clean |
| Hardcoded hex colors | ✅ None |
| Secrets/API keys committed | ✅ None |

### Issues Found

#### Warning
**W1 — `ensureRole` mutation has no `invalidateQueries` for the contact list**

After `ensureRole` provisions a SUPPLIER role on a contact, the contact's `roles` array in the react-query cache is stale (still shows old roles). The next time the picker opens with the same search, the badge showing "ผู้ขาย" won't appear until the cache expires (1 min `staleTime`).

Not a functional bug (the picker closes after selection), but could confuse users who reopen the picker and see the role badge missing.

```tsx
// ContactCombobox.tsx — ensureRoleMutation.onSuccess
onSuccess: (res, c) => {
  // Missing: queryClient.invalidateQueries({ queryKey: contactKeys.detail(c.id) })
  onSelect({ contactId: c.id, childId, name: c.name, taxId: c.taxId ?? '' });
  setOpen(false);
},
```

**Severity**: Low — UX annoyance, not a security or data issue.

#### Info
**I1 — `onTypeName` prop removed in later stacked branch (P4 cleanup in p3)**

The `ContactCombobox` in this branch still accepts `onTypeName?: (name: string) => void` as a prop. The P4 cleanup commit in `party-master-mandatory-p3` removes it. This is intentional sequencing — not a bug in slice1 itself.

### Recommendation: ✅ APPROVE

All security checks pass. The W1 warning is a minor UX issue. The P4 cleanup (removal of `onTypeName`) in the stacked p3 branch resolves the I1 note.

---

## Branch 2: `feat/party-master-mandatory-p3`

**Author**: Akenarin Kongdach  
**Last updated**: 2026-06-04  
**Commits (3 unique, ~13 total vs main)**: P3 backend (expense FK migration), P3 frontend (VendorCombobox sends supplierId), P4 cleanup (remove dead free-text chain + stub-upgrade guard)

### Files Changed (unique to this branch beyond slice1)
- `apps/api/prisma/migrations/20260968000000_add_expense_vendor_supplier_fk/migration.sql` — new
- `apps/api/src/modules/expense-documents/expense-documents.service.ts` — persist vendorSupplierId
- `apps/api/src/modules/expense-documents/dto/create.dto.ts` — add vendorSupplierId (`@IsString`)
- `apps/api/src/modules/expense-documents/dto/create-credit-note.dto.ts` — add vendorSupplierId (`@IsString`)
- `apps/api/src/modules/expense-documents/dto/create-petty-cash.dto.ts` — add supplierId per-line (`@IsString`)
- `apps/api/src/modules/expense-documents/dto/create-settlement.dto.ts` — add vendorSupplierId (`@IsString`)
- `apps/api/src/modules/customers/customers.service.ts` — P4 stub-upgrade guard
- `apps/web/src/components/contacts/ContactCombobox.tsx` — v2: remove `onTypeName`, add `CreateContactModal`, support `TRADE_IN_SELLER` role
- `apps/web/src/components/contacts/CreateContactModal.tsx` — new (279 lines)
- `apps/web/src/components/expense-form-v4/VendorCombobox.tsx` — removes `onTypeName`, sends `supplierId`
- `apps/web/src/components/expense-form-v4/types.ts` — adds vendorSupplierId/supplierId to form state
- `apps/web/src/pages/insurance/WizardSteps/CustomerPickerStep.tsx` — uses `ContactCombobox roleNeeded="CUSTOMER"`
- `apps/web/src/pages/other-income/components/CounterpartyPicker.tsx` — uses `ContactCombobox roleNeeded="CUSTOMER"`
- + various test file updates

### Security Checks

| Check | Result |
|---|---|
| Guards on modified controller endpoints | ✅ No new controllers; existing ContactsController guards unchanged |
| `@Roles()` on ensure-role endpoint | ⚠️ Now includes `SALES` (added for trade-in flow) — see W2 |
| `deletedAt: null` in new queries | ✅ All new queries include filter |
| Migration safety | ✅ Nullable FK columns; `ON DELETE SET NULL`; indexed |
| No `Number()` on money fields | ✅ Clean |
| No raw `fetch()` in frontend | ✅ Uses `api` client throughout |
| Hardcoded hex colors | ✅ None |
| Thai validation messages | ⚠️ See W1 |

### Issues Found

#### Warning

**W1 — DTO validators use `@IsString()` instead of `@IsUUID('4')` for supplier FK fields**

4 DTOs add optional `vendorSupplierId` / `supplierId` FK fields with `@IsString()` instead of `@IsUUID('4')`. A non-UUID string would be accepted and sent to the DB, where the FK constraint would throw a PostgreSQL error (unhandled 500 rather than a clean 400 validation error).

Affected files:
- `create.dto.ts` → `vendorSupplierId`
- `create-credit-note.dto.ts` → `vendorSupplierId`
- `create-petty-cash.dto.ts` → `supplierId` (per-line)
- `create-settlement.dto.ts` → `vendorSupplierId`

**Note**: This is fixed in the downstream `feat/contacts-followups` branch (upgrades all 4 to `@IsUUID('4')`). If merging p3 first, these will temporarily have weak validation until contacts-followups lands. Low risk in practice since the frontend always sends a UUID from the picker.

```typescript
// Current (p3 branch — weak):
@IsString()
@IsOptional()
vendorSupplierId?: string;

// Fixed (contacts-followups branch):
@IsUUID('4', { message: 'รหัสซัพพลายเออร์ไม่ถูกต้อง' })
@IsOptional()
vendorSupplierId?: string;
```

---

**W2 — Customer stubs created by `ensureRole('CUSTOMER')` store phone in plain text**

`ContactResolverService.ensureRole` now handles `role='CUSTOMER'`. It creates a Customer stub with:
```typescript
await tx.customer.create({
  data: { name: contact.name, phone: contact.phone ?? '', contactId },
  select: { id: true },
});
```

The Customer table normally stores PII with encryption (`phoneEncrypted`, `phoneHash`, `nationalIdEncrypted`, etc.). This stub bypasses all PII encryption — the `phone` field is stored as plain text.

**Triggers in this branch**:
- `insurance/WizardSteps/CustomerPickerStep.tsx` — `<ContactCombobox roleNeeded="CUSTOMER" />`
- `other-income/components/CounterpartyPicker.tsx` — `<ContactCombobox roleNeeded="CUSTOMER" />`

**Mitigating factors**:
1. The stub is intentionally documented as "PII encryption/hash columns are left null and filled when the customer record is properly completed"
2. The P4 stub-upgrade guard (in `customers.service.ts`, same branch) properly fills encrypted fields when a full Customer is later created
3. Cloud SQL encrypts data at rest
4. The stub only contains `name` and `phone` (no nationalId)

**Residual risk**: If an insurance or other-income counterparty never gets a formal customer record created, the stub with unencrypted phone persists indefinitely. Under PDPA, individual natural persons' phone numbers should be protected.

**Recommendation**: Before merging, confirm with the owner that stubs from these two flows (insurance counterparty, other-income counterparty) are acceptable to store without PII encryption, OR add a `phoneEncrypted` write in the CUSTOMER stub path using the existing `piiEncrypt()` utility.

#### Info
**I1 — Migration timestamp `20260968000000` uses month `69` (likely typo)**

The migration file is named `20260968000000_add_expense_vendor_supplier_fk`. Month `69` is not a real month — this is likely `20260604` or similar. Prisma runs migrations by filename sort order, not by actual date, so this is a naming/documentation issue only, not functional. Worth correcting for traceability.

### Recommendation: ⚠️ REVIEW

No Critical blockers. Two Warnings to review with owner before merging:
1. **W1** (DTO validation) is self-healing once contacts-followups merges — acceptable if both branches merge together
2. **W2** (CUSTOMER stub PII) requires explicit owner sign-off on the data handling approach

---

## Branch 3: `feat/contacts-followups`

**Author**: Akenarin Kongdach  
**Last updated**: 2026-06-05  
**Commits (2)**: Repair-ticket expense sets `vendorSupplierId`; safe backfill CLI for historical expense vendor FK

### Files Changed
- `apps/api/src/cli/backfill-expense-vendor-fk.cli.ts` — new (345 lines)
- `apps/api/src/cli/backfill-expense-vendor-fk.cli.spec.ts` — new (65 lines)
- `apps/api/src/modules/expense-documents/expense-documents.service.ts` — adds `vendorSupplierId` to `createDraftForRepair`
- `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` — passes `repairSupplierId` as `vendorSupplierId`
- `apps/api/src/modules/expense-documents/dto/*.dto.ts` — upgrades 4 DTOs to `@IsUUID('4')` (fixes W1 from p3)
- `apps/api/src/modules/trade-in/dto/trade-in.dto.ts` — upgrades 2 fields to `@IsUUID('4')`

### Security Checks

| Check | Result |
|---|---|
| No new controllers | ✅ No new endpoints |
| Backfill CLI prod guards | ✅ EXPECTED_DB_NAME + ALLOW_PROD_BACKFILL + current_database() check |
| `deletedAt: null` in CLI queries | ✅ Both `supplier.findMany` and `expenseDocument.findMany` include filter |
| Backfill idempotency | ✅ Only processes `vendorSupplierId IS NULL` rows; batch 100 with per-row idempotency guard |
| Dry-run default | ✅ Must pass `--apply` or `APPLY=true` explicitly |
| No `Number()` on money | ✅ Not applicable |
| No hardcoded secrets | ✅ Clean |

### Issues Found

**None Critical or Warning.**

#### Info
**I1 — Backfill CLI uses `require.main === module` guard**

The CLI is a Node.js script with `require.main === module` so importing it in Jest doesn't execute DB operations. This is the correct pattern and consistent with other CLIs in the project. No issue.

### Recommendation: ✅ APPROVE

Clean branch. Fixes the W1 DTO validation issue from p3 and adds a well-hardened backfill CLI. Should merge after p3.

---

## Merge Order Recommendation

```
1. feat/contact-picker-slice1   → APPROVE  (foundation: ContactCombobox + ensure-role API)
2. feat/party-master-mandatory-p3 → REVIEW first, then APPROVE after owner sign-off on W2
3. feat/contacts-followups      → APPROVE  (after p3; self-healing W1 fix)
```

**Owner action required before p3 merge**: Confirm acceptable handling of Customer stubs with plain-text phone created from insurance wizard / other-income counterparty picker, OR add `phoneEncrypted` write to the CUSTOMER stub creation path.
