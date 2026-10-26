# Parcel Label (ใบปะหน้าพัสดุ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a 100×150 mm parcel label (or the same label on A4) from a sale: recipient prefilled from the customer and editable, carrier tick, items + IMEI, QR that opens the sale.

**Architecture:** One small API addition (`bundleProducts` on `GET /sales/:id`). Web: a pure `parcelLabel.ts` (address parsing, draft builder, print CSS), a paper component `ParcelLabelCard`, a page `/sales/:id/parcel-label` that composes form + preview + print, and a link from the sale detail sheet. Label format is a per-device localStorage choice.

**Tech Stack:** NestJS + Prisma (jest) · React + react-query + `qrcode.react` (already a dependency) · vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-10-22-parcel-label-design.md`

## Global Constraints

- No new settings keys, no DB changes. Label format lives in `localStorage` key `parcel-label:format` (`'LABEL_100x150' | 'A4'`, default `'A4'`), every read/write in try/catch.
- Paper CSS uses mm/pt units, black/white only, Thai `line-height ≥ 1.35`, no `position:absolute`, no `overflow:hidden` on text.
- Thai copy exactly as the spec table (ใบปะหน้าพัสดุ · ขนส่ง · ผู้รับ · หมายเหตุถึงขนส่ง · ของในกล่อง · เก็บเงินปลายทาง · ผู้ส่ง · ยิง QR ตอนส่ง/รับคืน เพื่อเปิดใบขาย).
- Carriers: `FLASH` Flash · `KERRY` Kerry · `JT_EXPRESS` J&T · `THAILAND_POST` ไปรษณีย์ (this order).
- Dropdowns use `NativeSelect` from `@/components/ui/native-select` (raw `<select>` is forbidden by `native-select.inventory.test`).
- `apps/web/package.json` version → `26.10.50`.

## Review Focus

1. Customer address with the province name embedded in the district ("อ.เมืองลพบุรี จ.ลพบุรี 15000") must yield province ลพบุรี and lines without the trailing province/zip (Task 2 test).
2. A customer with no `addressCurrent` and no phone must still produce a printable draft with empty fields, not a crash (Task 2 test).
3. A voided sale must show no print button (Task 4 test).
4. localStorage unavailable (throws) must fall back to A4 without breaking the page (Task 2 test for `readLabelFormat`).
5. Long recipient name / address must wrap inside the 100×150 paper rather than overflow (Task 3: card uses `overflow-wrap: anywhere`; verified by rendering in Task 4's manual check with Chromium if available).

---

### Task 1: `bundleProducts` on `GET /sales/:id`

**Files:**
- Modify: `apps/api/src/modules/sales/services/sales-query.service.ts` (`findOne`)
- Test: `apps/api/src/modules/sales/services/sales-query.service.spec.ts`

**Interfaces:**
- Produces: `findOne` result gains `bundleProducts: { id: string; name: string }[]`.

- [ ] **Step 1: Write the failing tests** — new `describe('Sales findOne bundle products')`: db mock `{ sale: { findFirst }, product: { findMany } }`; sale row `{ id: 's1', bundleProductIds: ['acc1','acc2'], customer: { id: 'c1', name: 'x', phone: '08', nationalId: null }, product: { id: 'p1', costPrice: '1' }, costSnapshot: null }`; `product.findMany` → `[{ id: 'acc1', name: 'เคสใส' }, { id: 'acc2', name: 'ฟิล์มกระจก' }]`. Assert `result.bundleProducts` equals those two and `findMany` called with `{ where: { id: { in: ['acc1','acc2'] }, deletedAt: null }, select: { id: true, name: true } }`. Second test: `bundleProductIds: []` → `bundleProducts: []` and `findMany` not called. Actor `{ id: 'owner', role: 'OWNER' }`.
- [ ] **Step 2: Run** — `cd apps/api && npx jest --testPathIgnorePatterns=integration -- src/modules/sales/services/sales-query.service.spec.ts`. Expected: FAIL (`bundleProducts` undefined).
- [ ] **Step 3: Implement** in `findOne` after the null check: resolve names when `sale.bundleProductIds.length > 0`; return `projectSaleForActor({ ...sale, receiptBreakdown: bookingReceipt(sale), bundleProducts }, actor)`.
- [ ] **Step 4: Run** — same. Expected: PASS. Lint: `npx eslint -c eslint.config.mjs src/modules/sales/services/sales-query.service.ts src/modules/sales/services/sales-query.service.spec.ts`.
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/sales && git commit -m "feat(sales): bundle product names on sale detail"`

### Task 2: `parcelLabel.ts` (pure)

**Files:**
- Create: `apps/web/src/pages/ParcelLabelPage/parcelLabel.ts`
- Test: `apps/web/src/pages/ParcelLabelPage/parcelLabel.test.ts`

**Interfaces:**
- Produces: `export type CarrierCode = 'FLASH' | 'KERRY' | 'JT_EXPRESS' | 'THAILAND_POST'`; `export const CARRIERS: { code: CarrierCode; label: string }[]`; `export type ParcelLabelFormat = 'LABEL_100x150' | 'A4'`; `export const PARCEL_LABEL_FORMAT_KEY = 'parcel-label:format'`; `export function readLabelFormat(): ParcelLabelFormat`; `export function writeLabelFormat(f: ParcelLabelFormat): void`; `export function parseThaiAddress(text: string | null | undefined): { lines: string; province: string | null; postalCode: string | null }`; `export interface ParcelLabelDraft` (spec shape); `export interface ParcelLabelSources { sale: { id; saleNumber; customer: { id; name; phone: string | null }; product: { name; imeiSerial: string | null; serialNumber: string | null }; bundleProducts?: { id; name }[] }; customer: { prefix: string | null; name: string; phone: string | null; addressCurrent: string | null } | null; company: { nameTh: string; address: string; phone: string | null } | null; origin: string }`; `export function buildParcelLabelDraft(src: ParcelLabelSources): ParcelLabelDraft`; `export function labelStyles(format: ParcelLabelFormat): string`.

- [ ] **Step 1: Write the failing tests** (`parcelLabel.test.ts`):
  - `parseThaiAddress('99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี จ.ลพบุรี 15000')` → `{ lines: '99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี', province: 'ลพบุรี', postalCode: '15000' }`
  - `'123 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กทม. 10110'` → province `'กรุงเทพมหานคร'`, lines `'123 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย'`
  - `'45 หมู่ 3 ต.บางพลี'` → province null, postalCode null, lines unchanged
  - `'ลพบุรี 15000'` → lines `''`, province ลพบุรี, zip 15000
  - `''` and `null` → `{ lines: '', province: null, postalCode: null }`
  - `buildParcelLabelDraft` full: prefix+name `'นางสาว สมหญิง ใจดี'` when prefix `'นางสาว'`; phone falls back to `sale.customer.phone` when customer phone null; `item.extras` = bundle names; `item.imei` = serialNumber when imeiSerial null; `sender` from company; `qrValue === 'https://app.test/sales?saleId=s1'`; `carrier null`, `cod 'ไม่มี'`, `note ''`.
  - `buildParcelLabelDraft` with `customer: null, company: null` → recipientName `sale.customer.name`, address fields `''`, sender `{ name: 'BESTCHOICE', address: '', phone: '' }`.
  - `readLabelFormat()` returns `'A4'` when `localStorage.getItem` throws (stub via `vi.spyOn(Storage.prototype, 'getItem')`), returns `'LABEL_100x150'` when stored; `writeLabelFormat` swallows a throwing `setItem`.
  - `labelStyles('LABEL_100x150')` contains `size: 100mm 150mm` and `labelStyles('A4')` contains `size: A4`.
- [ ] **Step 2: Run** — `npx vitest run --root /abs/apps/web src/pages/ParcelLabelPage/parcelLabel.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** — provinces = unique first column of `THAI_ADDRESS_DATA` (`@/data/thai-address-data`); aliases `กทม.`/`กทม`/`กรุงเทพฯ`/`กรุงเทพ` → กรุงเทพมหานคร; find the province occurrence with the greatest index (check aliases too), strip optional `จ.`/`จังหวัด` prefix and the 5-digit zip (`/(?:^|\s)(\d{5})(?!\d)/g` last match); collapse whitespace. CSS per spec (zones, mm sizes).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add apps/web/src/pages/ParcelLabelPage && git commit -m "feat(parcel-label): address parsing, draft builder, print css"`

### Task 3: `ParcelLabelCard.tsx`

**Files:**
- Create: `apps/web/src/pages/ParcelLabelPage/ParcelLabelCard.tsx`
- Test: `apps/web/src/pages/ParcelLabelPage/ParcelLabelCard.test.tsx`

**Interfaces:**
- Consumes: `ParcelLabelDraft`, `CARRIERS` from Task 2; `QRCodeSVG` from `qrcode.react`; `formatDateMedium` from `@/utils/formatters`.
- Produces: `export default function ParcelLabelCard({ draft, printedAt }: { draft: ParcelLabelDraft; printedAt?: Date })` rendering `<article class="parcel-label" data-testid="parcel-label">` per spec zones; carrier boxes `<span role="img" aria-label="<label> เลือกแล้ว|ยังไม่เลือก">`.

- [ ] **Step 1: Write the failing tests**: render with a draft (carrier `KERRY`, imei, extras `['เคสใส','ฟิล์มกระจก']`, note `'โทรก่อนส่ง'`) → text `ใบปะหน้าพัสดุ`, sale number twice (header + under QR), `Kerry เลือกแล้ว` img present and `Flash ยังไม่เลือก`, `IMEI 357200606382344`, `+ เคสใส · ฟิล์มกระจก`, `หมายเหตุถึงขนส่ง: โทรก่อนส่ง`, `เก็บเงินปลายทาง` + `ไม่มี`, QR `getByRole('img', { name: 'QR เปิดใบขาย S-20261022-0001' })`, sender line `บริษัท เบสท์ช้อยส์โฟน จำกัด` and `โทร 02-000-0000`. Second test: imei null / extras [] / note '' → no `IMEI` text, no `+ ` line, note renders `หมายเหตุถึงขนส่ง: —`, all four carriers `ยังไม่เลือก`.
- [ ] **Step 2: Run** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** per spec table with class names `pl-head pl-zone pl-carrier pl-cb pl-recipient pl-name pl-phone pl-address pl-province pl-zip pl-note pl-items pl-item-title pl-item-imei pl-item-extras pl-cod pl-qr pl-sender`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(parcel-label): paper card"`

### Task 4: Page, route, sheet link, version

**Files:**
- Create: `apps/web/src/pages/ParcelLabelPage/index.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import + `<Route path="/sales/:id/parcel-label" element={<ParcelLabelPage />} />` next to `/sales`)
- Modify: `apps/web/src/pages/SalesHistoryPage.tsx` (Link "พิมพ์ใบปะหน้าพัสดุ" in the sheet, hidden when `deletedAt`)
- Modify: `apps/web/package.json` (version 26.10.50)
- Test: `apps/web/src/pages/ParcelLabelPage/ParcelLabelPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–3; `api.get('/sales/:id')`, `api.get('/customers/:id')`, `api.get('/company/public')`; `QueryBoundary`, `PageHeader`, `NativeSelect`, `Textarea`, `Input`, `Label`, `Button`.

- [ ] **Step 1: Write the failing tests** (`ParcelLabelPage.test.tsx`, `MemoryRouter initialEntries={['/sales/s1/parcel-label']}` + `Routes`): mock api by path; sale (active) + customer (`addressCurrent: '99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี จ.ลพบุรี 15000'`, prefix 'นางสาว') + company. Tests: (a) form prefilled — `getByLabelText('ชื่อผู้รับ')` value `นางสาว สมหญิง ใจดี`, `getByLabelText('จังหวัด')` `ลพบุรี`, `getByLabelText('รหัสไปรษณีย์')` `15000`; (b) editing the name updates the preview (`within(getByTestId('parcel-label')).getByText(...)`); (c) clicking carrier `Kerry` ticks it in the preview (`Kerry เลือกแล้ว`); (d) changing the format select to `LABEL_100x150` writes localStorage key and the `<style>` contains `size: 100mm 150mm`; (e) voided sale (`deletedAt`) → no button `พิมพ์ใบปะหน้า` and text `ใบขายนี้ถูกยกเลิกแล้ว`; (f) print button calls `window.print` (spy).
- [ ] **Step 2: Run** — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** page per spec; route; sheet Link (`to={`/sales/${id}/parcel-label`}`, visible only when `!deletedAt`); bump version.
- [ ] **Step 4: Run** — page test, then `npx vitest run --root /abs/apps/web src/pages/ParcelLabelPage src/pages/SalesHistoryPage` (if a SalesHistoryPage test exists), eslint `src/pages/ParcelLabelPage src/pages/SalesHistoryPage.tsx src/App.tsx`, `npx tsc --noEmit -p /abs/apps/web/tsconfig.json`. Expected: all green.
- [ ] **Step 5: Commit** — `git commit -am "feat(sales): parcel label page + link from sale detail"`
