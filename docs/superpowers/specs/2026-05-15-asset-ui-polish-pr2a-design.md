# Asset Module — PR 2a Design: List + Entry UI Polish (P3-P8)

**Date:** 2026-05-15
**Branch:** `feat/asset-ui-polish-pr2a` (off `feat/asset-sidebar-merge` / PR #845)
**Scope:** PR 2a of 2 — Important fixes P3-P8 from accountant's ImplementationReview v1.2 (Day 2 of 3-day accountant timeline)
**Effort:** ~7.75 hours (matches accountant's 8hr ETA)
**Next PR:** PR 2b — P9-P17 (~4.5hr)

---

## 1. Context

Continuation of accountant's review of PR #828. PR #845 shipped Critical fixes (P1+P2). PR 2a ships P3-P8.

Owner directive (durable): **"ทำตาม PDF เท่านั้น"** — strict PDF-literal implementation, no scope expansion, no over-engineering.

---

## 2. Scope per PDF §8 (Action Plan)

| # | Page | Change | ETA per PDF |
|---|------|--------|-------------|
| **P3** | AssetsListPage | Stat Cards reduce from 6 (per PDF accountant saw) to 4: ทั้งหมด / รอดำเนินการ (DRAFT) / ลงบัญชี (POSTED) / ยกเลิก (REVERSED) | 1hr |
| **P4** | AssetsListPage | Tab Bar — เอาออก | 30min |
| **P5** | AssetEntrySection2Cost | Label "ค่า capitalize อื่น" → "ต้นทุนสินทรัพย์อื่น ๆ (ค่า capitalize อื่น)" | 15min |
| **P6** | AssetEntrySection3Vendor | text input → Combobox จาก vendor master + auto-fill เลขผู้เสียภาษี 13 หลัก + ปุ่ม "+ เพิ่มผู้ขายใหม่" + เพิ่มฟิลด์ "จำนวนเงินที่จ่าย" | 3hr |
| **P7** | AssetEntrySection5Approver | redesign: ไม่ใช่ approval flow → Permission settings (user picker + view/edit/post per user) | 2hr |
| **P8** | Cross-cutting | "NBV" → "มูลค่าตามบัญชีสุทธิ (NBV)" ทุกที่ในระบบ | 1hr |

**Total: 7hr 45min** (matches PDF 8hr Day 2 estimate)

### PDF-literal interpretation of ambiguous items

**P4 — Tab Bar:**
- PDF shows screenshot with tabs `[ซื้อทรัพย์สิน] [รายได้อื่น] [รายงาน] [ค่าเสื่อม] [Audit]`
- Code investigation (grep `AccountingModuleTabBar`, `ซื้อทรัพย์สิน`): **component does not exist in current codebase**
- PR #806 (2026-05-11 per memory) introduced `AccountingModuleTabBar`; subsequent refactors removed it
- Conclusion: P4 is a no-op verification (similar to P1 from PR #845). Manual UAT confirms no Tab Bar in screenshot.

**P7 — Permission settings:**
- PDF says "กำหนดว่าใคร view/edit/post ได้บ้าง · ใช้ user picker จาก user master"
- PDF ETA: 2hr → enforces lightweight implementation
- Per "ทำตาม PDF เท่านั้น":
  - UI: user picker + 3 checkboxes (view/edit/post) per selected user
  - Persist: JSON field on FixedAsset model (`permissionConfig: { userId: string; canView: bool; canEdit: bool; canPost: bool }[]`)
  - **No enforcement at endpoint level** — PDF doesn't request it, 2hr budget doesn't allow it
  - Replaces existing `approverId` single-user dropdown
- Migration: existing `approverId` rows → seed `permissionConfig` with `{userId: approverId, canView: true, canEdit: false, canPost: true}` so audit trail preserved

---

## 3. P3 — Stat Cards (4 cards Thai labels)

**Current** ([AssetsListPage.tsx:138-174](apps/web/src/pages/assets/AssetsListPage.tsx#L138-L174)):
```ts
statCards = [
  { label: 'DRAFT', caption: 'ฉบับร่าง', value: summary.draft },
  { label: 'POSTED', caption: 'บันทึกแล้ว', value: summary.posted },
  { label: 'REVERSED', caption: 'กลับรายการ', value: summary.reversed },
  { label: 'TOTAL COST', caption: 'ราคาทุนรวม', value: summary.totalPurchaseCost },
]
```

**Target** (per PDF page 4):
```ts
statCards = [
  { label: 'ทั้งหมด', caption: 'เอกสารทั้งหมด', value: draft + posted + reversed, icon: Files, tone: 'info' },
  { label: 'รอดำเนินการ', caption: 'ฉบับร่าง', value: summary.draft, icon: FileEdit, tone: 'muted' },
  { label: 'ลงบัญชี', caption: 'บันทึกแล้ว', value: summary.posted, icon: CheckCircle2, tone: 'success' },
  { label: 'ยกเลิก', caption: 'กลับรายการ', value: summary.reversed, icon: RotateCcw, tone: 'warning' },
]
```

- Remove `TOTAL COST` card entirely (PDF says 4 cards, not 5)
- Add `ทั้งหมด` card with sum-derived count
- Status badges in table + filter dropdown remain English (`DRAFT/POSTED/REVERSED`) — only stat card labels are Thai per PDF

---

## 4. P4 — Tab Bar verify (no-op)

Verification steps:
1. `grep -rn "AccountingModuleTabBar\|ซื้อทรัพย์สิน" apps/web/src` → expect 0 hits in components
2. Visual inspection of `/assets` page after PR #845 + PR 2a deploy → no horizontal tabs above content area
3. Document in PR description that P4 was no-op (code already correct)

No code change.

---

## 5. P5 — Label change

**File:** `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx`

Find input label "ค่า capitalize อื่น" → change to "ต้นทุนสินทรัพย์อื่น ๆ (ค่า capitalize อื่น)"

15min. No data model change.

---

## 6. P6 — Vendor Database integration

**Current** ([AssetEntrySection3Vendor.tsx](apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx)):
```tsx
<Label>ชื่อผู้ขาย / บริษัท *</Label>
<Input {...register('vendorName')} />

<Label>เลขประจำตัวผู้เสียภาษี (13 หลัก)</Label>
<Input {...register('vendorTaxId')} />
```

**Target:**
1. Replace `vendorName` text input with Combobox sourced from `/suppliers` API
2. Auto-fill `vendorTaxId` when Supplier selected (`supplier.taxId` → form value)
3. Add "+ เพิ่มผู้ขายใหม่" action in Combobox empty state → opens dialog to POST `/suppliers` then auto-select the new entry
4. Add new field "จำนวนเงินที่จ่าย" (vendorAmountPaid: Decimal) — manual input, used to inform JE preview (allows partial payment scenarios per PDF intent)
5. Keep manual entry mode as fallback (if user doesn't want to create vendor master record)

**Schema changes:**
- `apps/web/src/pages/assets/schema.ts` — add `vendorId?: string`, `vendorAmountPaid?: number`
- `apps/api/prisma/schema.prisma` — `FixedAsset.vendorId String?` + `vendorAmountPaid Decimal? @db.Decimal(12, 2)` + relation to `Supplier`
- `apps/api/src/modules/asset/dto/*` — accept new fields

**Supplier reuse:** `/suppliers` API already exists ([apps/web/src/pages/SuppliersPage](apps/web/src/pages/SuppliersPage)) — reuse existing endpoint, no new API.

**Live JE preview:** When `vendorAmountPaid > 0`, the Section 4 Journal preview should reflect partial payment (Cr cash = vendorAmountPaid, Cr ผู้ขาย-เจ้าหนี้ = remaining balance). If `vendorAmountPaid = 0` or null, behaves as before (full immediate payment).

**Out of scope:** complex AP aging integration with vendor — that's a future module enhancement.

---

## 7. P7 — Permission settings UI (PDF-literal, lightweight)

**Current** ([AssetEntrySection5Approver.tsx](apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx)):
- Single Select dropdown for `approverId` (from OWNER + FINANCE_MANAGER users)
- SoD warning if `approverId === currentUser.id`

**Target** (PDF page 6 + page 13):
```
Section 5: กำหนดสิทธิ์ (Permission)
────────────────────────────────────
[+ เพิ่มผู้ใช้]                    [User picker dropdown]
────────────────────────────────────
┌──────────────────────────────────────────────┐
│ User: สุทธินีย์ คงเดช (OWNER)              X │
│   [✓] ดู (view)   [✓] แก้ไข (edit)   [✓] ลงบัญชี (post)  │
├──────────────────────────────────────────────┤
│ User: เอกนรินทร์ คงเดช (FINANCE_MANAGER)    X │
│   [✓] ดู (view)   [ ] แก้ไข (edit)   [✓] ลงบัญชี (post)  │
└──────────────────────────────────────────────┘
หมายเหตุ: การควบคุมสิทธิ์ที่ระบุไว้นี้บันทึกไว้เป็น metadata ของเอกสาร · 
การบังคับสิทธิ์ที่ระดับ API จะเพิ่มในเฟสถัดไป
```

**Data model:**
```ts
// schema.ts
permissionConfig: z.array(z.object({
  userId: z.string().uuid(),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canPost: z.boolean(),
})).default([])

// Prisma
permissionConfig Json @default("[]")
```

**Migration of existing data:**
- For each FixedAsset row with `approverId != null`:
  - INSERT `permissionConfig = [{ userId: approverId, canView: true, canEdit: false, canPost: true }]`
- Keep `approverId` column for backward compat (NOT removed in this PR)
- Audit log entry: `ASSET_PERMISSION_MIGRATED` (one-time)

**No enforcement at API endpoints in this PR.** Permission data captured + displayed + editable. Actual permission checks are a separate Phase ถัดไป task (out of scope per PDF 2hr ETA).

**Section header label change:** "ผู้รับผิดชอบ" → "กำหนดสิทธิ์ (Permission)"

---

## 8. P8 — NBV terminology

**Search-replace:** "NBV" (English) → "มูลค่าตามบัญชีสุทธิ (NBV)" (Thai-first with English in parens)

**Scope (per PDF page 5+6+7+13):**
- หน้าทะเบียน (`/assets/register`) — column header, stat card, tooltip
- หน้าสรุป (`/assets/summary-report`)
- หน้า Schedule (`/assets/:id/schedule`)
- All asset table headers, stat cards, tooltips

**Implementation:**
- grep `'NBV'` → enumerate all hits → edit each
- Exclude: backend code, API field names (only UI labels)
- Exclude: `assetMenuItem.children` (already says "มูลค่าตามบัญชีสุทธิ (NBV)" from PR #845)
- Exclude: variable names / API response keys (no DB/API changes)

**Variants to NOT touch:**
- TypeScript variable `nbv` (stays English)
- API field `netBookValue` (stays English)

Only user-facing **rendered text** is updated.

---

## 9. Testing

### Unit/Integration tests

| Item | Test | File |
|------|------|------|
| P3 | renders 4 stat cards with Thai labels + correct totals | `apps/web/src/pages/assets/__tests__/AssetsListPage.statcards.test.tsx` (new) |
| P6 | combobox lists suppliers, auto-fills taxId, "+ เพิ่ม" calls POST `/suppliers` | `apps/web/src/pages/assets/__tests__/AssetEntrySection3Vendor.test.tsx` (new) |
| P7 | renders permission rows with 3 checkboxes, persists permissionConfig on submit | `apps/web/src/pages/assets/__tests__/AssetEntrySection5Permission.test.tsx` (new) |
| P7 backend | DTO accepts permissionConfig array, Prisma create persists JSON | `apps/api/src/modules/asset/__tests__/asset-permission-config.spec.ts` (new) |

### Manual UAT post-deploy (3 roles)

1. `/assets` → see 4 stat cards in Thai: ทั้งหมด / รอดำเนินการ / ลงบัญชี / ยกเลิก
2. `/assets` → confirm no Tab Bar above content (P4)
3. `/assets/new` → Section 2 → see label "ต้นทุนสินทรัพย์อื่น ๆ (ค่า capitalize อื่น)"
4. `/assets/new` → Section 3 → Vendor combobox → select existing → taxId auto-fills
5. `/assets/new` → Section 3 → type new name → "+ เพิ่มผู้ขายใหม่" → opens dialog → saves → vendor selected
6. `/assets/new` → Section 3 → enter "จำนวนเงินที่จ่าย" = 5000 (partial) → Section 4 JE preview shows split
7. `/assets/new` → Section 5 → see new Permission UI → add user → toggle view/edit/post → save → reload → permissions preserved
8. `/assets/register` → see column header "มูลค่าตามบัญชีสุทธิ (NBV)" (not "NBV" alone)

---

## 10. Files to change

| File | Change |
|------|--------|
| `apps/web/src/pages/assets/AssetsListPage.tsx` | P3 stat cards refactor |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | P5 label change |
| `apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx` | P6 Vendor combobox + amount paid |
| `apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx` → rename to `AssetEntrySection5Permission.tsx` | P7 redesign |
| `apps/web/src/pages/assets/schema.ts` | P6 + P7 form fields |
| `apps/web/src/pages/assets/api.ts` | P6 useSuppliers query, P7 permissionConfig field |
| `apps/web/src/pages/assets/types.ts` | P6 vendorId/amountPaid, P7 PermissionConfigEntry |
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | wire new Section 5 component |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | P8 NBV→มูลค่าตามบัญชีสุทธิ (NBV) |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | P8 NBV terminology |
| `apps/web/src/pages/assets/AssetSchedulePage.tsx` | P8 NBV terminology |
| Cross-cutting: any other file with `'NBV'` in user-visible strings | P8 |
| `apps/api/prisma/schema.prisma` | add FixedAsset.vendorId, vendorAmountPaid, permissionConfig |
| `apps/api/prisma/migrations/2026XXXXXXXXXX_asset_vendor_permission/migration.sql` | new migration |
| `apps/api/src/modules/asset/dto/create-asset.dto.ts` | accept new fields |
| `apps/api/src/modules/asset/dto/update-asset.dto.ts` | accept new fields |
| `apps/api/src/modules/asset/asset.service.ts` | persist new fields + permissionConfig migration script |
| 4 new test files (per Testing section) | tests |

---

## 11. Out of Scope (PDF-literal cuts)

- **P7 enforcement at API endpoints** — PDF doesn't ask + 2hr budget excludes
- **AP aging integration** with Vendor amount paid — beyond P6 scope
- **Pagination UI on Audit Log** — that was PR #845's I4 (deferred)
- **P9-P17** — PR 2b
- **E2E tests** — PDF doesn't ask
- **Old `approverId` column removal** — kept for backward compat; cleanup in future PR

---

## 12. References

- PDF 4: `ImplementationReview_v1.2.pdf` §1+§2+§3+§8 (page 4-6 + page 13)
- Owner durable instruction: "ทำตาม PDF เท่านั้น"
- Prior work: PR #845 closed P1+P2 (Sign-off Criteria #6+#7)
- Existing module:
  - [AssetsListPage.tsx:138](apps/web/src/pages/assets/AssetsListPage.tsx#L138) — statCards array
  - [AssetEntrySection3Vendor.tsx](apps/web/src/pages/assets/components/AssetEntrySection3Vendor.tsx) — current vendor text input
  - [AssetEntrySection5Approver.tsx](apps/web/src/pages/assets/components/AssetEntrySection5Approver.tsx) — current approver dropdown
  - `apps/web/src/pages/SuppliersPage` — vendor master module (reused for P6)
