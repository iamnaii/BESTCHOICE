# Stock Inventory Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปิดภาพรวมคลังด้วยเฉพาะเครื่อง และให้ตัวเลือกเครื่อง/อุปกรณ์เสริม/ทั้งหมดควบคุมยอด กราฟ และรายการปลายทางอย่างสอดคล้องกัน

**Architecture:** ใช้ `inventoryScope` เป็นสัญญาร่วมและ URL เป็นแหล่งเดียวของตัวเลือก ส่ง filter ผ่าน controller และ domain access boundary ไปยัง Prisma/SQL ก่อนรวมยอดและแบ่งหน้า รักษา API ที่ไม่ส่ง scope ให้ทำงานเหมือนเดิม และใช้ UI เดิมเพิ่มตัวเลือกเดียวเหนือ KPI

**Tech Stack:** React 19, React Router, TanStack Query, Radix ToggleGroup, Tailwind, NestJS, Prisma, PostgreSQL, Vitest/Jest/Playwright

**Spec:** `docs/superpowers/specs/2026-11-22-stock-inventory-scope-design.md`

## Global Constraints

- `inventoryScope=devices|accessories|all`; devices = PHONE_NEW/PHONE_USED/TABLET, accessories = ACCESSORY
- `/stock` default devices; API และ `/stock/products` ที่ไม่ส่ง scope default all
- แยก `inventoryScope` จาก `view=ready|all`; เก็บ branch/zone และการกลับหน้าผ่าน URL
- ทุกตัวเลขกรองที่ server ก่อน aggregate/group/sort/page; dashboard นับหน่วยจริง
- ไม่เปลี่ยนข้อมูลนำเข้า ราคา IMEI จำนวนของแถม บัญชี หรือสิทธิ์บริษัท/สาขา; ไม่ต้องมี migration
- ยอดขายใช้แหล่งเดิมและระบุ “ขายใน BESTCHOICE เดือนนี้” / “ไม่รวมประวัติ Tooltify”
- คง cost redaction และ domainAccessClient/currentProductScopeSql ทุกเส้นทาง
- ใช้ PostgreSQL isolated harness สำหรับ DB tests; ไม่ใช้ฐานจริงหรือฐาน restore ของการย้ายข้อมูลทดสอบเขียน
- ส่ง local preview จาก checkout ที่แก้จริงพร้อม local:check และ stock-flow checks; ไม่ deploy/merge อัตโนมัติ

## Review Focus

1. Filter หายที่ domain access boundary หรือ raw SQL ทำให้เห็นข้ามสาขา/เห็นอุปกรณ์ซ้ำ — Task 1/2 persisted permission tests
2. คลิก QC แล้ว ready view กลบสถานะ หรือคลิก 90+ แต่เปิดทุกเครื่อง — Task 3 URL + boundary-age tests
3. ตารางรวมของแถมเป็นรุ่นทำให้เลขชิ้นกลายเป็นเลขแถว — Task 3 physical-unit count tests
4. สลับ scope/สาขาเร็วและ response กลับสลับลำดับ — Task 4 delayed-request + Back/Forward tests
5. ไม่มีข้อมูล/มีแต่ของแถมศูนย์บาท/ผู้ใช้ไม่มีสิทธิ์ต้นทุน — Task 2/4 empty, zero-price and redaction tests

## ตรวจพบจากโค้ดปัจจุบัน

- `OverviewPage.tsx` เรียก `useStockOverview(branch)`; summary และ dashboard แยก endpoint และยังไม่มี scope
- `stock-overview.service.ts` ใช้สินค้าทุกหมวดสำหรับ aging และ breakdown; pending transfer และ warranty ต้องกรองผ่าน product relation
- `StockActionZone.tsx` ยังไม่แสดง qcPending; aging ส่งเพียง IN_STOCK และไม่มี age predicate
- `useStockProducts.ts` ใช้ ready view เป็นค่าเริ่มต้น และใช้ `/products` + groupAccessories; raw grouped SQL อยู่ `products-stock-groups.ts`
- `access-shop-boundaries.ts` เรียก controller โดยตรงพร้อม positional arguments; เพิ่ม query แค่ controller ไม่พอ
- `StockTransfersPage.tsx` ปัจจุบันไม่รักษา scope/branch ตอนเปิด pending; ต้องรองรับบริบทอ่านจากภาพรวมอย่างจำกัด

## Task 1: สัญญา scope และตัวกรองที่ใช้ร่วมกัน

**Files:**
- Create `packages/shared/src/stock-inventory-scope.ts`, `packages/shared/src/stock-inventory-scope.test.ts`
- Modify `packages/shared/src/index.ts`
- Create `apps/api/src/modules/products/stock-inventory-filter.ts`, `stock-inventory-filter.spec.ts`
- Create `apps/api/src/modules/products/dto/stock-scope-query.dto.ts`
- Modify `apps/api/src/modules/products/dto/stock-list-pagination.dto.ts`

**Interfaces:**
- Shared: `STOCK_INVENTORY_SCOPES`, `type StockInventoryScope = 'devices' | 'accessories' | 'all'`, `isStockInventoryScope(value: unknown): value is StockInventoryScope`
- Backend: `stockInventoryWhere(scope: StockInventoryScope = 'all'): Prisma.ProductWhereInput`
- Backend: `stockInventorySql(scope: StockInventoryScope = 'all'): Prisma.Sql` ใช้ alias `p` และ parameter binding
- Backend: `stockOver90Where(asOf: Date): Prisma.ProductWhereInput`, `stockOver90Sql(asOf: Date): Prisma.Sql`
- `StockScopeQueryDto`: optional scalar `inventoryScope` IsIn ทั้งสามค่า; `StockListPaginationDto` เพิ่ม optional inventoryScope และ `aging` IsIn `['over90']` โดย reuse validator ไม่เปลี่ยน pagination defaults

- [ ] เขียน failing tests: devices ไม่รวม ACCESSORY, accessories ไม่รวม TABLET, all ไม่เพิ่ม category restriction; `undefined` API เท่ากับ all; array/object/unknown scope ไม่ผ่าน validation
- [ ] เขียน age tests: age 90 วัน 23:59:59 ยังไม่เข้า over90; 91 วันพอดีเข้า; stockInDate มีค่าต้องชนะ createdAt; fallback createdAt เมื่อ null เท่านั้น
- [ ] รัน `npm run test --workspace=@installment/shared -- stock-inventory-scope.test.ts` และ `npm run test --workspace=@installment/api -- --runInBand stock-inventory-filter.spec.ts`; ต้อง fail ที่ behavior ใหม่ก่อนแก้
- [ ] ทำ implementation ขั้นต่ำ: over90 cutoff = asOf ลบ 91×86,400,000 ms, refDate <= cutoff ทั้ง Prisma และ SQL; category filter เดิม AND กับ scope ไม่ overwrite กัน
- [ ] รันชุดเดิมให้ผ่านและตรวจ formatted scope constants/exports; commit เฉพาะ Task 1

## Task 2: กรอง aggregate และเส้นทางอ่านจริง

**Files:**
- Modify `apps/api/src/modules/products/services/stock-overview.service.ts`
- Modify `apps/api/src/modules/products/products-stock.service.ts`, `products.controller.ts`
- Modify `apps/api/src/modules/products/services/stock-transfer.service.ts` (pending read เท่านั้น)
- Modify `apps/api/src/modules/employee-access/access-shop-boundaries.ts`
- Modify `apps/api/src/modules/products/products.controller.dashboard-cost.spec.ts`, `products.controller.spec.ts`
- Create `apps/api/src/modules/products/services/__tests__/stock-overview-scope.integration.spec.ts`
- Extend `apps/api/src/modules/employee-access/access-shop.integration.spec.ts`

**Interfaces:**
- getStock filters เพิ่ม `inventoryScope?: StockInventoryScope`
- Service/facade `getStockDashboard(branchId?: string, inventoryScope: StockInventoryScope = 'all')`
- Service/facade `getWarrantyExpiring(daysAhead = 30, branchId?: string, inventoryScope: StockInventoryScope = 'all')`
- Service/facade `getPendingTransfers(branchId?: string, inventoryScope: StockInventoryScope = 'all')`
- Controller รับ scope query ที่ validate แล้วเป็น trailing argument และ boundary ส่งให้ครบ; getStock ใช้ DTO ที่มี pagination+scope
- Response dashboard รักษา shape เดิม; ไม่เพิ่มยอดที่หลุดจาก redaction

- [ ] สร้าง synthetic fixture ตรึงเวลา 22 พ.ย. 2569: ready devices 40 / cost 707187, QC devices 3; ready accessories 608 / cost 29755, QC accessory 1; ให้ device mean age 12 และ over90 2, accessory mean 68 และ over90 84, combined mean 65 (หลีกเลี่ยงข้อมูลส่วนตัวจริง)
- [ ] กำหนดอายุ fixture ให้ตรวจซ้ำได้: devices 2 หน่วยอายุ 91 วัน +32 หน่วยอายุ 8 วัน +6 หน่วยอายุ 7 วัน; accessories 84 หน่วยอายุ 100 วัน +524 หน่วยอายุ 63 วัน; createdAt ต่างจาก stockInDate เพื่อพิสูจน์ fallback
- [ ] เพิ่ม tests: dashboard all currentStock=648, devices=40, accessories=608; device aging sum=40; slowMovers/breakdowns/statuses/margin/newProducts/soldProducts ไม่ปนอุปกรณ์; getStock summary total devices=43; stockQty ไม่เปลี่ยนเพราะราคา 0
- [ ] เพิ่ม test 2 สาขาและทั้ง SHOP/FINANCE: company/branch grants ยังคุมข้อมูล, requesting inaccessible branch ไม่เพิ่มการเข้าถึง; เจ้าของกับพนักงานใช้ scope แล้วได้ counts ตามสิทธิ์เดียวกัน และ cost redaction ทุกช่องเหมือนเดิม
- [ ] เพิ่ม test pending transfer ที่ product คนละหมวดและ destination branch ต่างกัน: count ตรง getPendingTransfers รายการจริง; exclude deleted transfer/product ตามนิยามเดียวกัน; warranty ต้องตามทั้ง scope และ branch
- [ ] รัน `bash tools/test-db-vitest.sh src/modules/products/services/__tests__/stock-overview-scope.integration.spec.ts` และ `bash tools/test-employee-access-shop.sh` ให้ fail ก่อนทำ implementation
- [ ] ใช้ Task 1 predicate กับ queries ทั้งสี่ของ dashboard, summary, warranty และ pending transfer โดยคง company execution context; จับ asOf ครั้งเดียวต่อ dashboard request
- [ ] ส่ง query scalar ผ่าน boundary validation + explicit controller dispatch ให้ครบ รวม request เป็น array/object ต้อง 400 ทั้งทาง controller และ boundary; ไม่ขยาย role หรือเปลี่ยน access manifest เพื่อหลบ check
- [ ] รัน isolated tests ให้ผ่าน, Jest controller tests และ `node tools/check-access-coverage.mjs`; review diff แล้ว commit Task 2

## Task 3: ให้รายการปลายทางตรงกับ scope/สถานะ/อายุ และนับหน่วยจริง

**Files:**
- Modify `apps/api/src/modules/products/products-stock-groups.ts`, `products.service.ts`, `products.controller.ts`
- Modify `apps/api/src/modules/employee-access/access-shop-boundaries.ts`
- Create `apps/api/src/modules/products/__tests__/stock-list-scope.integration.spec.ts`
- Modify `apps/web/src/pages/StockPage/hooks/useStockProducts.ts`, `ProductsPage.tsx`, `ProductsPage.test.tsx`
- Modify `apps/web/src/pages/StockTransfersPage.tsx`; Create `StockTransfersPage.inventory-scope.test.tsx`
- Modify `apps/web/src/pages/StockPage/types.ts` สำหรับ unit metadata

**Interfaces:**
- `StockListFilters` เพิ่ม `inventoryScope?: StockInventoryScope`, `aging?: 'over90'`
- Stock-list response เพิ่ม `totalUnits: number` (หลัง status filter) และ `unitCounts: { ready: number; all: number }` (ก่อน status filter); รักษา total/viewCounts/totalPages เดิมเป็นจำนวนแถว/กลุ่ม
- `/products` ที่ไม่ส่ง scope/aging และ POS compatibility ต้องคง behavior เดิม; paths ของ stock grouped/ungrouped ต้องใช้ predicates เดียวกัน
- ปลายทาง aging: `/stock/products?inventoryScope=devices&view=ready&aging=over90&branchId=...`
- ปลายทาง QC: `/stock/products?inventoryScope=devices&view=all&status=QC_PENDING&branchId=...`
- Pending transfer: `/stock/transfers?view=outgoing&status=PENDING&inventoryScope=devices&branchId=...`; แสดงบริบท destination branch และ scope; ปุ่มล้างหรือเปลี่ยน view/status ออกจาก PENDING ล้างบริบทนี้พร้อม URL ไม่มี filter ซ่อน

- [ ] เขียน DB tests: devices list และ summary ตรงกันแม้เกิน 1 หน้า; category=ACCESSORY AND devices ได้ 0 ไม่ broaden; grouped accessories ที่มี 608 units แสดง totalUnits=608 แต่ total เป็นจำนวนกลุ่มจริง
- [ ] เพิ่ม tests age predicate ที่ 90/91 วันทั้ง raw SQL และ Prisma paths; device over90 ต้องมี 2 unit จริง, accessoryGroup ที่อายุปนกันนับเฉพาะหน่วยตรงเงื่อนไขก่อน group/sort
- [ ] เพิ่ม frontend tests: QC link ใช้ view=all; aging link ส่ง aging=over90; category/group/page/bulk selection ไม่ค้างเมื่อ scope เปลี่ยน; ปุ่มกลับภาพรวมรักษา branch/zone/scope; scope ไม่หายเมื่อแก้ sort/search รวดเร็ว
- [ ] เพิ่ม transfer UI test: URL pending ส่ง branchId+inventoryScope ทั้ง queryKey/request; reset/view change ไม่ทิ้ง filter แอบแฝงและไม่แก้ mutation payload ของ dispatch/receive
- [ ] รัน `bash tools/test-db-vitest.sh src/modules/products/__tests__/stock-list-scope.integration.spec.ts` และ `npm run test --workspace=@installment/web -- src/pages/StockPage/ProductsPage.test.tsx src/pages/StockTransfersPage.inventory-scope.test.tsx` ให้ fail
- [ ] ผูก predicates ผ่าน grouped SQL/ungrouped Prisma/counts/ordering อย่าง AND; ใช้ unitCount ก่อน pagination ไม่บวกจากหน้าเดียว; ขยาย scalar validation/dispatch ใน boundary ด้วย
- [ ] เพิ่ม visible scope context/filter บนรายการสินค้า; ใช้ “ชิ้น” สำหรับ physical count และ “รุ่น/รายการ” สำหรับ grouped rows/pagination เพื่อไม่ให้ 608 ถูกแสดงเป็นจำนวนรุ่น
- [ ] รัน `npm run test --workspace=@installment/api -- --runTestsByPath src/modules/products/products-stock-groups.spec.ts` และ `npm run test --workspace=@installment/web -- src/pages/StockPage/hooks/__tests__/useStockProducts.rapidWrites.test.tsx` ให้ผ่าน; commit Task 3

## Task 4: ตัวเลือกทั้งหน้า การโหลด และข้อความที่อธิบายยอดชัดเจน

**Files:**
- Create `apps/web/src/pages/StockPage/components/InventoryScopeFilter.tsx`
- Create `apps/web/src/pages/StockPage/hooks/useStockInventoryScope.ts`
- Modify `apps/web/src/pages/StockPage/OverviewPage.tsx`, `hooks/useStockOverview.ts`, `types.ts`
- Modify `components/StockHeroKpi.tsx`, `StockActionZone.tsx`, `BranchSummaryCards.tsx`, `StockDashboardTab.tsx`
- Create `apps/web/src/pages/StockPage/OverviewPage.inventory-scope.test.tsx`
- Extend `components/__tests__/StockDashboardCostRedaction.test.tsx`

**Interfaces:**
- `useStockInventoryScope(defaultScope: StockInventoryScope): { inventoryScope: StockInventoryScope; setInventoryScope(scope: StockInventoryScope): void }` ใช้ useLatestSearchParams เดิมเพื่อไม่ทับ rapid URL writes
- `InventoryScopeFilter({ value, onValueChange }: { value: StockInventoryScope; onValueChange(scope: StockInventoryScope): void })` ใช้ ToggleGroup single + labels “เครื่อง”, “อุปกรณ์เสริม”, “ทั้งหมด”; ignore deselect empty value
- `useStockOverview(filterBranch: string, inventoryScope: StockInventoryScope)` เพิ่ม scope+branch ในทุก queryKey และ params รวม warranty; ส่ง loading/error/retry สำหรับแต่ละ section
- `StockActionZone.onNavigateToList` เปลี่ยนเป็น callback รับ `{ status?: string; aging?: 'over90' }`; pending transfer callback รับบริบทจาก OverviewPage แทนประกอบ URL ข้าม filter ใน component
- Scope/unit label props ส่งเข้าการ์ดและกราฟ ไม่ copy data มาคำนวณ filter อีกครั้งในแต่ละ component

- [ ] เขียน tests `/stock` ไม่มี query → devices และ request scope=devices; toggle all → ready=648; Back/Forward restore; refresh/deep-link accessories →608; invalid URL ถูก normalize
- [ ] เขียน delayed-response test เปลี่ยน devices→accessories และ branch A→B: response เก่าไม่เปลี่ยนยอดใหม่; skeleton แทน old-scope figures; failed request ไม่แสดงศูนย์/“ไม่มีงาน” และ retry ส่ง filters ล่าสุด
- [ ] เขียน tests keyboard/accessible label/pressed state; controls เลือกหนึ่งค่าเสมอ; zero-products → “—” สำหรับ age/margin และ empty copy; พนักงานไม่เห็นทุนทั้งใน responsive layout และ loading/error states
- [ ] เขียน tests QC_PENDING แยกจาก INSPECTION และรวมยอดใน action zone; all มี QC 4, devices 3, accessories 1; title งานแสดงเป็นจำนวนงานที่อาจซ้ำสินค้ากัน ไม่อ้างว่าเป็น unique products
- [ ] รัน `npm run test --workspace=@installment/web -- src/pages/StockPage/OverviewPage.inventory-scope.test.tsx src/pages/StockPage/components/__tests__/StockDashboardCostRedaction.test.tsx` ให้ fail
- [ ] ทำ UI ตาม spec: control ก่อน KPI, copy scope/device units/cost basis, sales source note + link `/imported-sales`, movement/top-seller source note, visible error/retry และ stable card dimensions; reuse tokens/Lucide/ToggleGroup เดิม
- [ ] รัน tests ให้ผ่าน; ตรวจ diff ไม่มี hardcoded migration totals, dependency ใหม่ หรือการอ่านฐานจริงใน frontend; commit Task 4

## Task 5: ตรวจครบเส้นทางและส่ง local preview

**Files:**
- Create `apps/web/e2e/stock-inventory-scope.spec.ts` และ `apps/web/playwright.stock-inventory.config.ts` (ไม่ inherit globalSetup/storageState เดิม)
- เก็บผลตรวจใน `.tmp/` ของ checkout และอัปเดต task checkboxes ในแผนนี้

- [ ] เพิ่ม E2E 375px และ desktop: สลับสามกลุ่ม, keyboard, branch, aging/QC drilldown, grouped unit count, Back/Forward, reload และ API error/retry; tests mock network ต้องระบุว่าเป็น UI checks ไม่ใช้แทน DB integration
- [ ] รัน `bash tools/test-db-vitest.sh src/modules/products/services/__tests__/stock-overview-scope.integration.spec.ts src/modules/products/__tests__/stock-list-scope.integration.spec.ts`; แยก `bash tools/test-employee-access-shop.sh` ซึ่งเป็น Jest harness คนละชุด ห้ามส่ง Jest spec เข้า Vitest; รัน frontend tests ที่เปลี่ยนและ controller redaction regressions
- [ ] ใช้ Playwright config เฉพาะงานที่รับ STOCK_PREVIEW_URL แบบ loopback เท่านั้น ไม่มี auth/state จากเครื่องเดิม และไม่เปิดหรือ reuse server ที่ไม่ได้เป็นเจ้าของ; รัน `npm run test:e2e --workspace=@installment/web -- --config=playwright.stock-inventory.config.ts` โดยกำหนด URL preview ที่ตรวจแล้ว
- [ ] ให้ code-reviewer ตรวจ diff ตาม `.claude/CLAUDE.md`; แก้ blockers ก่อน handoff (ไม่ต้องแยก implementer agents สำหรับงานชุดนี้)
- [ ] รัน `npm run local:check` จาก checkout ที่แก้; ถ้าพอร์ตชนใช้ LOCAL_PREVIEW_PORT ว่าง ห้ามฆ่า process อื่น
- [ ] เปิด stock flow ของ frontend + backend ที่สร้างจาก checkout เดียวกันด้วย synthetic DB; ตรวจ manual keyboard, 375px/desktop, 200% zoom, dark mode และ reduced motion; เก็บ URL/ผลจริง การ preview มาตรฐานอย่างเดียวไม่ครอบคลุมหน้านี้
- [ ] ยืนยันมุมมอง devices ได้ fixture 40/707187/12/2 และ QC3; accessories 608/29755/QC1; all648/736942/65/86/QC4; click-through count ตรงและไม่มี API mutation จากการเปลี่ยน filter
- [ ] ส่งลิงก์ local preview ที่ยังเปิดอยู่ ผล checks และข้อจำกัด mock/real backend ให้เจ้าของตรวจ ก่อนงาน deploy แยกต่างหาก

## Self-review และลำดับทำงาน

- Harness audit: access-shop เป็น Jest/EMPLOYEE_ACCESS_TEST_DATABASE_URL ใช้ script เฉพาะ; DB specs ใหม่ใช้ Vitest harness; Playwright config ปกติมี globalSetup จึงแยก config ของงานนี้
- Spec coverage: scope/default/backward compatibility →1; aggregate/access/warranty/transfers →2; lists/units/aging/QC navigation →3; UX/copy/async/empty →4; responsive + real isolated backend →5
- ชื่อ query/type/method ใช้ inventoryScope/StockInventoryScope ตรงกันทุก task; status view และ inventory scope เป็นคนละแกน
- ไม่เพิ่มประวัติ Tooltify ลงยอดขายปัจจุบัน ไม่แตะข้อมูลย้ายสำเร็จหรือแก้สูตร margin
- แนะนำทำตามลำดับ 1→2→3→4→5 ใน session เดียว เพราะ API และ URL contract พึ่งกัน แล้วใช้ reviewer ตรวจทั้งชุดก่อนส่ง งานรอบนี้ส่งมอบ **แผน** ยังไม่ได้เริ่มเขียน product code
