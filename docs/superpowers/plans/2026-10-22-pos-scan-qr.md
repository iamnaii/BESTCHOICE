# POS scan QR / IMEI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter in the POS product search box looks the scanned code up exactly, auto-selects a sellable device, and otherwise shows a red alert with the reason the system knows plus a link to act on it.

**Architecture:** One new read endpoint `GET /products/scan?code=` backed by `ProductScanService` (decision ladder NOT_FOUND → SOLD/ON_CONTRACT → OTHER_BRANCH → RESERVED family → SELLABLE → NOT_READY, returning structured facts). The web keeps copy in a pure `scanOutcome.ts` and wires Enter + two banners into the existing `ProductSearch` component; `POSPage/index.tsx` is untouched.

**Tech Stack:** NestJS + Prisma (jest, mocked PrismaService) · React + react-query + shadcn `Alert` (vitest + testing-library).

**Spec:** `docs/superpowers/specs/2026-10-22-pos-scan-qr-design.md`

## Global Constraints

- Route `@Get('scan')` must be declared before `@Get(':id')` in `products.controller.ts`.
- Roles on the endpoint: `'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'`; `costPrice` stripped for SALES via `omitCostPrice`.
- Exact-match lookup only: `OR: [{ imeiSerial }, { legacyProductCode }, { id }]` with `deletedAt: null`; code trimmed.
- Input `aria-label` stays `ค้นหาสินค้า รุ่น หรือ IMEI` (e2e depends on it); placeholder becomes `ค้นหารุ่น / IMEI / รหัสสินค้า — ยิง QR ได้เลย`.
- Thai copy exactly as the spec table; dates via `formatDateShortThai` / `formatDateTime` from `@/utils/formatters`.
- No raw `<select>`, no hardcoded colours; `Alert` from `@/components/ui/alert` (`variant` success/destructive, `appearance="solid"`).
- Web version bump `apps/web/package.json` → `26.10.49`.

## Review Focus

1. Scanner sends the code faster than React state settles — Enter must use the input's current value, not the debounced one (test: type then Enter in one tick).
2. A device sold at another branch scanned by SALES must read `SOLD`, not `OTHER_BRANCH` (ladder order test in Task 1).
3. SALES with no `branchId` scanning an IN_STOCK device must get `OTHER_BRANCH` (fail-closed), never `SELLABLE`.
4. Selecting a device from the list after a failed scan must clear the red alert (test in Task 4).
5. `NOT_READY` for a status with no web label (future enum value) must render the raw status, not crash (test in Task 3).

---

### Task 1: `ProductScanService` + DTO + module registration

**Files:**
- Create: `apps/api/src/modules/products/services/product-scan.service.ts`
- Create: `apps/api/src/modules/products/dto/scan-product.dto.ts`
- Modify: `apps/api/src/modules/products/products.module.ts` (providers + exports)
- Test: `apps/api/src/modules/products/services/product-scan.service.spec.ts`

**Interfaces:**
- Produces: `export type ScanReason = 'SELLABLE' | 'NOT_FOUND' | 'DELETED' | 'OTHER_BRANCH' | 'BOOKED' | 'DRAFT_CONTRACT' | 'WEB_RESERVED' | 'RESERVED' | 'ON_CONTRACT' | 'SOLD' | 'NOT_READY'`;
  `export interface ScanOutcome { code; reason; sellable; product; branch; booking; contract; sale; reservation }` (shape in spec);
  `export type ScanActor = { role: string; branchId?: string | null }`;
  `class ProductScanService { scan(rawCode: string, actor: ScanActor): Promise<ScanOutcome> }`;
  `class ScanProductDto { code: string }`.

- [ ] **Step 1: Write the failing spec** — `product-scan.service.spec.ts` with a `prisma` mock `{ product: { findFirst }, sale: { findFirst }, contract: { findFirst }, booking: { findFirst }, productReservation: { findFirst }, systemConfig: { findUnique } }` (readStringFlag reads `systemConfig.findUnique` → resolve `null`). Cases:
  - `NOT_FOUND`: both findFirst calls return null → `{ reason: 'NOT_FOUND', sellable: false, product: null }`; first call `where` equals `{ deletedAt: null, OR: [{ imeiSerial: '351000000007919' }, { legacyProductCode: '351000000007919' }, { id: '351000000007919' }] }` after passing `'  351000000007919 '`.
  - `DELETED`: second findFirst returns `{ id }` → `reason: 'DELETED'`.
  - `SELLABLE`: IN_STOCK, branch b1, actor `{ role: 'SALES', branchId: 'b1' }` → `sellable: true`, `product.effectiveShopWarrantyDays` is a number, `branch` = `{ id: 'b1', name: 'ลาดพร้าว' }`.
  - `OTHER_BRANCH`: same product, actor `{ role: 'SALES', branchId: 'b2' }` and actor `{ role: 'SALES', branchId: null }` → `OTHER_BRANCH`; actor `{ role: 'OWNER', branchId: null }` → `SELLABLE`.
  - `BOOKED`: RESERVED + booking row `{ id, bookingNumber: 'BK-20261020-0003', expireDate: Date, customer: { name: 'สมหญิง' } }` → `booking.customerName === 'สมหญิง'`, `expireDate` ISO string.
  - `DRAFT_CONTRACT`, `WEB_RESERVED` (`reservation.expiresAt` ISO; `productReservation.findFirst` called with `expiresAt: { gt: expect.any(Date) }`), `RESERVED` fallback.
  - `ON_CONTRACT`: SOLD_INSTALLMENT + contract `{ status: 'ACTIVE' }` → `contract.status === 'ACTIVE'`; contract findFirst `where.status` = `{ notIn: ['DRAFT', 'CANCELED'] }`.
  - `SOLD`: SOLD_CASH + sale → `sale.saleNumber`, `soldAt` ISO; SOLD_INSTALLMENT with no contract but a sale → `SOLD`; SOLD_RESELL with no sale → `SOLD`, `sale: null`.
  - ladder: SOLD_CASH at branch b2 for SALES b1 → `SOLD` (not OTHER_BRANCH).
  - `NOT_READY`: PHOTO_PENDING → `reason: 'NOT_READY'`, `product.status === 'PHOTO_PENDING'`.
- [ ] **Step 2: Run it** — `cd apps/api && npx jest --testPathIgnorePatterns=integration -- src/modules/products/services/product-scan.service.spec.ts`
  Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `ScanProductDto` (`@IsString({ message: 'กรุณาระบุรหัสที่ยิง' }) @Length(1, 128, { message: 'กรุณาระบุรหัสที่ยิง' })`) and `ProductScanService.scan` per the spec ladder; use `productInclude` exported from `products.service.ts`, `resolveShopWarrantyDays` + `SHOP_WARRANTY_DAYS_CONFIG_KEY` + `readStringFlag` for `effectiveShopWarrantyDays`, `hasCrossBranchAccess` for the branch rule. Register in `ProductsModule` providers and exports.
- [ ] **Step 4: Run it** — same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/products && git commit -m "feat(products): exact scan lookup with sell-block reasons"`

### Task 2: Controller route + cost redaction

**Files:**
- Modify: `apps/api/src/modules/products/products.controller.ts` (new `@Get('scan')` before `@Get(':id')`; inject `ProductScanService`)
- Test: `apps/api/src/modules/products/products.controller.spec.ts`

**Interfaces:**
- Consumes: `ProductScanService.scan`, `ScanProductDto`, `canSeeCost`, `omitCostPrice`.
- Produces: `GET /products/scan?code=` → `ScanOutcome` (product without `costPrice` for SALES).

- [ ] **Step 1: Write the failing tests** in the existing controller spec: provide `ProductScanService` mock `{ scan: jest.fn().mockResolvedValue({ code: 'x', reason: 'SELLABLE', sellable: true, product: { ...productRow }, branch: null, booking: null, contract: null, sale: null, reservation: null }) }`;
  `controller.scan({ code: 'x' }, { role: 'SALES', branchId: 'b-1' })` → `product` has no `costPrice`; OWNER keeps `costPrice: '12000'`; `scan` is called with `('x', { role: 'SALES', branchId: 'b-1' })`; outcome with `product: null` passes through unchanged.
- [ ] **Step 2: Run** — `npx jest --testPathIgnorePatterns=integration -- src/modules/products/products.controller.spec.ts`. Expected: FAIL (`controller.scan is not a function`).
- [ ] **Step 3: Implement** `async scan(@Query() dto: ScanProductDto, @CurrentUser() user: { role: string; branchId?: string | null })`.
- [ ] **Step 4: Run** — same. Expected: PASS. Also run `npx eslint -c eslint.config.mjs src/modules/products` from `apps/api` → no errors.
- [ ] **Step 5: Commit** — `git commit -am "feat(products): GET /products/scan"`

### Task 3: Web `scanOutcome.ts`

**Files:**
- Create: `apps/web/src/pages/POSPage/scanOutcome.ts`
- Modify: `apps/web/src/pages/POSPage/types.ts` (add `legacyProductCode?: string | null` to `Product`)
- Test: `apps/web/src/pages/POSPage/scanOutcome.test.ts`

**Interfaces:**
- Produces: `export type ScanReason`, `export interface ScanOutcome` (same shape as API, `product: Product | null`), `export function isScanCandidate(value: string): boolean`, `export function scanIdLabel(product: Pick<Product, 'id' | 'imeiSerial' | 'legacyProductCode'>): { label: 'IMEI' | 'รหัส' | 'ID'; text: string }`, `export function honorific(name: string): string`, `export function describeScanBlock(outcome: ScanOutcome): { title: string; detail: string | null; link: { label: string; to: string } | null }`.

- [ ] **Step 1: Write the failing tests**: `isScanCandidate` (`'351000000007919'` true · `'iPhone 15'` false · `'ab'` false · `'  P-0001 '` true); `scanIdLabel` three branches; `honorific('สมหญิง') === 'คุณสมหญิง'`, `honorific('นายสมชาย') === 'นายสมชาย'`, `honorific('คุณแดง') === 'คุณแดง'`; `describeScanBlock` for every reason with the spec's exact strings, e.g. BOOKED → `{ title: 'เครื่องนี้ขายไม่ได้ตอนนี้ · จองไว้แล้ว', detail: 'ใบจอง BK-20261020-0003 ของคุณสมหญิง หมดอายุ 25 ต.ค.', link: { label: 'เปิดใบจอง BK-20261020-0003', to: '/bookings?bookingId=bk1' } }` (expireDate `'2026-10-25T00:00:00.000Z'`), SOLD without sale → link null, NOT_READY with `status: 'FUTURE_STATUS'` → title ends with `FUTURE_STATUS`, stock links are `/stock/products?view=all&q=351000000007919`, OTHER_BRANCH link null, unknown reason → raw reason in title (review fix 2026-10-22).
- [ ] **Step 2: Run** — `npx vitest run --root /abs/apps/web src/pages/POSPage/scanOutcome.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** per spec table; `statusLabels` from `@/lib/constants`; `formatDateShortThai`/`formatDateTime` from `@/utils/formatters`; `encodeURIComponent(code)` in `/stock/products?view=all&q=`; `default` branch for unknown reasons.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/POSPage && git commit -m "feat(pos): scan outcome copy"`

### Task 4: `ProductSearch` Enter + banners

**Files:**
- Modify: `apps/web/src/pages/POSPage/components/ProductSearch.tsx`
- Test: `apps/web/src/pages/POSPage/components/ProductSearch.test.tsx` (new)

**Interfaces:**
- Consumes: `isScanCandidate`, `scanIdLabel`, `describeScanBlock`, `ScanOutcome`; `api.get('/products/scan', { params: { code } })`; `getErrorMessage`; `Alert, AlertIcon, AlertTitle, AlertDescription` from `@/components/ui/alert`; `Link` from `react-router`.
- Props unchanged.

- [ ] **Step 1: Write the failing tests** (harness like `CustomerSearch.test.tsx`: `useState` for search, `MemoryRouter`, `QueryClientProvider`; `mocks.get` routes `/products` → `{ data: { data: [] } }` and `/products/scan` → configurable):
  - "Enter on a scan code selects the device and shows the green banner": type `351000000007919`, press Enter → `mocks.get` called with `('/products/scan', { params: { code: '351000000007919' } })`, `onSelectProduct` called with the outcome product; harness then renders selected state → `getByRole('status')` has text `ยิงแล้ว · เลือกเครื่องให้แล้ว` and `IMEI 351000000007919`.
  - "Blocked scan shows the red alert with link and keeps the code": outcome BOOKED → `getByRole('alert')` contains `จองไว้แล้ว` and `ใบจอง BK-20261020-0003 ของคุณสมหญิง หมดอายุ 25 ต.ค.`; `getByRole('link', { name: 'เปิดใบจอง BK-20261020-0003' })` href `/bookings?bookingId=bk1`; input still has value `358504126918951`; click `ยิงเครื่องอื่น` → alert gone, input empty.
  - "Enter on free text does not scan": type `iPhone 15` + Enter → no `/products/scan` call.
  - "Scan failure shows the alert with the error": `mocks.get` rejects for scan → alert contains `ตรวจรหัสไม่สำเร็จ`.
  - "Choosing from the list clears a stale alert": after a blocked scan, `/products` list returns one row; click it → `onSelectProduct` called and no `role="alert"`.
- [ ] **Step 2: Run** — `npx vitest run --root /abs/apps/web src/pages/POSPage/components/ProductSearch.test.tsx`. Expected: FAIL (no scan call / no banner).
- [ ] **Step 3: Implement** in `ProductSearch.tsx`: `useMutation` scan, `scanResult` state, `onKeyDown` Enter guard (`isScanCandidate` + `!scan.isPending`), green `Alert` in the selected branch when `scanResult?.outcome.product?.id === selectedProduct.id`, red `Alert role="alert"` above the input, "ยิงเครื่องอื่น" button (`inputRef.focus()`), clear on list select / เปลี่ยน, placeholder text, pending hint.
- [ ] **Step 4: Run** — same file, then `npx vitest run --root /abs/apps/web src/pages/POSPage` (POSPage.test still green). Expected: PASS. `npx eslint src/pages/POSPage` from `apps/web` → clean. `npx tsc --noEmit -p /abs/apps/web/tsconfig.json` → 0 errors.
- [ ] **Step 5: Bump** `apps/web/package.json` version → `26.10.49`; commit — `git commit -am "feat(pos): scan QR/IMEI on Enter — auto-select or explain why not"`
