# Pre-Merge Guard Report — 2026-05-23

**Generated:** 2026-05-23  
**Reviewer:** Pre-Merge Guard Agent  
**Branches reviewed:** 3 (top by recency, excluding guard/watchdog/debug branches)

---

## Summary Table

| Branch | Files Δ | Critical | Warning | Info | Verdict |
|--------|---------|----------|---------|------|---------|
| `fix/menu-revenue-dedupe` | 1 (−3) | 0 | 0 | 0 | ✅ APPROVE |
| `feat/sp5p2-warranty-check-unify` | 12 (+1048/−579) | 0 | 4 | 3 | 🟡 REVIEW |
| `feat/sp5p2-wizard` | 24 (+2226/−47) | 0 | 6 | 6 | 🟡 REVIEW |

---

## Branch 1: `fix/menu-revenue-dedupe`

**Verdict: ✅ APPROVE**

### Changes
- 1 file: `apps/web/src/config/menu.ts` — 3 lines deleted
- Removes duplicate OWNER menu entries (`ติดตามลูกค้าค้างชำระ`, `ล็อคเครื่อง (MDM)`, `ยึดคืนเครื่อง`) that were incorrectly appearing under the "รายรับ" (revenue) zone as well as their correct "ติดตามหนี้" section

### Issues
None. Pure config cleanup — no API, no guards, no data paths touched.

---

## Branch 2: `feat/sp5p2-warranty-check-unify`

**Verdict: 🟡 REVIEW — 0 critical, 4 warnings, 3 info**

### Changes
12 files, +1,048 / −579 lines. Pure frontend refactor:
- Deletes `CreateRepairTicketPage.tsx` (superseded)
- Adds `WarrantyCheckPage.tsx` + unit test (`WarrantyCheckPage.test.tsx`)
- Adds `DefectExchangeRedirect.tsx` (redirect shim for old `/defect-exchange` route)
- Updates `App.tsx` routing, `menu.ts`, `InsurancePage.tsx`, `RepairTicketDetailPage.tsx`
- 3 new E2E specs for the warranty check flow

### Critical
None.

### Warning

**W1 — `WarrantyCheckPage.tsx:97-98` — "ลูกค้า" search tab requires raw UUID input**  
The customer search tab shows `placeholder='Customer UUID (จาก /customers — รอ integrate autocomplete)'`. Staff must know the exact database UUID to use this tab — no autocomplete exists yet. This tab is functionally unusable for SALES staff in production. Either hide the tab (behind a feature flag or comment) until autocomplete is integrated, or replace the input with name/phone search that maps to a backend `customerSearch` string param.

**W2 — `App.tsx:624-625` — `/defect-exchange` redirect → 403 for FINANCE_MANAGER**  
The original `/defect-exchange` route included `roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}`. The new redirect sends all roles to `/insurance/new` which only allows `['OWNER', 'BRANCH_MANAGER', 'SALES']`. A FINANCE_MANAGER hitting `/defect-exchange` via a direct link will be silently redirected into a 403. Their sidebar link was removed in this branch, so the path is rare — but still a confusing UX. Consider redirecting FINANCE_MANAGER to `/insurance` (list page) instead.

**W3 — `menu.ts:167-171`, `225-231`, `553-560` — All three role configs use identical `ShieldCheck` icon for parent group AND both children**  
The `รับซ่อม/รับประกัน` collapsible group and its two children all use `ShieldCheck`. Compared to other grouped items in the menu (where parent and children have distinct icons), this makes the section visually undifferentiated. `Search` or `ScanLine` would better represent the "เช็คประกัน" child.

**W4 — `WarrantyCheckPage.tsx` — No `toast.error()` on query failure; only `QueryBoundary` inline error block**  
When the backend returns `NotFoundException` ("ไม่พบเครื่องที่ IMEI นี้"), `QueryBoundary` renders an error block rather than a contextual Thai toast. Other similar pages in the codebase use `useEffect` + `isError` + `toast.error(getErrorMessage(error))` for user-friendly error feedback. Worth aligning for consistency.

### Info

**I1 — `WarrantyCheckPage.tsx:163` — `key={d.product.id ?? i}` index fallback**  
`d.product.id` is always a non-null UUID from the API; the `?? i` fallback is unreachable but would cause stale React state if it ever fires. Use `d.product.id` unconditionally.

**I2 — `WarrantyCheckPage.test.tsx` — No test for "ลูกค้า" (customer UUID) mode**  
Given the tab is currently unusable (see W1), a test asserting the placeholder renders and submit is disabled for short input would serve as a regression guard. Mirrors the pattern in `insurance-warranty-check.spec.ts` for IMEI mode.

**I3 — `insurance-wizard-exchange.spec.ts:299-315` — Comment misrepresents test assertion**  
Comment says "calcInitialStep() returns step 4 via the skipWarrantyPreview + presetContractId path" but the assertion is `getByText('1. ลูกค้า')` (step 1). The comment contradicts what is tested. Update comment to reflect actual assertion.

---

## Branch 3: `feat/sp5p2-wizard`

**Verdict: 🟡 REVIEW — 0 critical, 6 warnings, 6 info**

### Changes
24 files, +2,226 / −47 lines:
- New backend: `warrantyPreview` + `warrantyLookup` endpoints on `RepairTicketsController` (guards and roles correct)
- New frontend: `CreateInsuranceWizardPage` + 5 step components (`CustomerStep`, `DeviceStep`, `WarrantyPreviewStep`, `DefectDescriptionStep`, `ExchangeProductPickerStep`)
- New `WarrantyWindowCard` component + tests
- Walk-in customer support (nullable `nationalId` on `Customer`)
- SHOP CoA account code corrections (`S51-1105`, `S42-1101`)
- 309 new service spec tests + 215 frontend component tests

### Critical
None. All new controller methods inherit class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. All new endpoints carry `@Roles(...)`. No `$queryRaw`. No hardcoded secrets. `deletedAt: null` present in every new Prisma query. `estimatedCost` wrapped in `new Prisma.Decimal(...)` before DB write.

### Warning

**W1 — `WarrantyPreviewStep.tsx:43` — Missing `enabled` guard on `useQuery` [HIGH PRIORITY]**  
The query fires immediately on mount with no `enabled` option. When all three params (`customerId`, `contractId`, `productId`) are `undefined` (normal state when wizard reaches Step 3 via the free-text device path), the request fires to `/repair-tickets/warranty-preview?` with an empty query string. The backend throws `BadRequestException` and the component renders an error banner in a valid wizard state. **Fix:** add `enabled: !!(customerId || contractId || productId)`.

**W6 — `CreateInsuranceWizardPage.tsx:~1240` — Walk-in customer POST uses `useEffect` + raw `api.post()` instead of `useMutation` [HIGH PRIORITY]**  
The frontend rule requires `useMutation` for mutations; using `api.post()` inside a `useEffect` bypasses React Query. The current implementation also misses `queryClient.invalidateQueries(['customers'])` after the walk-in customer is created, leaving the customers list cache stale. **Fix:** refactor to `useMutation` with `onSuccess: () => queryClient.invalidateQueries(['customers'])`.

**W3 — `DefectDescriptionStep.tsx` — `isRepairCenter` filter is client-side only**  
`GET /suppliers?search=...&limit=20` returns up to 20 suppliers; the component then filters `.filter((s) => s.isRepairCenter === true)` client-side. If 20+ suppliers match the search term but none of the first 20 are repair centers, the dropdown shows empty even though valid repair centers exist. Backend enforces `isRepairCenter` on ticket create (not a security gap), but this is a real functional UX defect for shops with many suppliers. Track as follow-up: add `?isRepairCenter=true` query param to `GET /suppliers`.

**W4 — `repair-tickets.service.ts` — `any[]` typed locals in `warrantyLookup`**  
`let contracts: any[] = []`, `let customer: any = null`, and `.map((c: any) => ...)` lose type safety through the entire `warrantyLookup` data pipeline. Use `Prisma.ContractGetPayload<{ include: { product: true; customer: true } }>` or a local named type.

**W2 — `DefectDescriptionStep.tsx:7` — `useQuery` declared in parent, used only inside nested `RepairSupplierSection` function**  
`useQuery` is imported at the file level but consumed only inside a nested function component defined in the same file. A TODO acknowledges this ("replace with SupplierCombobox when extracted"). Acceptable for now, but makes future extraction harder.

**W5 — `WarrantyPreviewStep.tsx:58-62` — `eslint-disable-next-line react-hooks/exhaustive-deps` suppresses `onChoose`/`onPayerDetected` from deps**  
Correct for the current implementation (these are stable `useState` setters), but if a future refactor wraps either in an inline arrow function, the suppression will silently cause stale-closure bugs. Use `useCallback` on the parent side to make stability explicit.

### Info

**I1 — `ExchangeProductPickerStep.tsx` — Hardcoded `bg-amber-50`, `text-amber-700` etc.**  
Project frontend rule: use design tokens, not raw Tailwind color classes. Amber warning callouts should use a semantic `bg-warning`/`text-warning` token or `bg-muted` as appropriate.

**I2 — `WarrantyWindowCard.tsx` — Hardcoded `text-red-600`, `text-emerald-600`, `text-amber-600` in traffic-light logic**  
Same issue as I1. Tests assert on these exact class names so fixing requires updating both component and test.

**I3 — `repair-tickets.service.ts` — `audit.log(...).catch(() => {})` silently swallows audit failures**  
Used twice (`warrantyPreview`, `warrantyLookup`). Pattern is consistent with other read endpoints in the codebase, but at minimum add `.catch((e) => Sentry.captureException(e))` so AuditService failures surface in monitoring without blocking the response.

**I4 — `DefectDescriptionStep.tsx` — 2 unresolved TODOs**  
`SupplierCombobox` extraction and `isRepairCenter` backend param. Acceptable for shipping; should be tracked as issues.

**I5 — `repair-tickets.service.ts` — `blockingReasons: undefined as string[] | undefined` dead type cast**  
The `as string[] | undefined` cast on `undefined` is a no-op. Remove cast (`blockingReasons: undefined`) or implement the field.

**I6 — `repair-tickets.service.ts` — Service now 963 lines (approaching split threshold)**  
The +272-line addition brings the service close to the recommended limit. A `WarrantyQueryService` extracting `computeWarrantyWindows`, `warrantyPreview`, and `warrantyLookup` would reduce cognitive load. Defer to follow-up PR.

---

## Action Items Before Merge

### `feat/sp5p2-wizard` — Fix before merge
1. **W1** — Add `enabled: !!(customerId || contractId || productId)` to `WarrantyPreviewStep` useQuery
2. **W6** — Refactor walk-in customer creation from `useEffect + api.post()` to `useMutation` + `queryClient.invalidateQueries(['customers'])`

### `feat/sp5p2-warranty-check-unify` — Fix before merge
1. **W1** — Hide or replace the "ลูกค้า" search tab until autocomplete is integrated
2. **W2** — Handle FINANCE_MANAGER gracefully on `/defect-exchange` redirect (redirect to `/insurance` list instead)

### Tracked as follow-up issues (post-merge acceptable)
- Add `isRepairCenter` query param to `GET /suppliers` (W3 on wizard)
- Type `warrantyLookup` locals properly (W4 on wizard)
- Distinct child icons in `รับซ่อม/รับประกัน` menu group (W3 on warranty-check-unify)
- Amber/red hardcoded Tailwind colors → design tokens (I1, I2 on wizard)
- `repair-tickets.service.ts` extraction into WarrantyQueryService (I6 on wizard)
