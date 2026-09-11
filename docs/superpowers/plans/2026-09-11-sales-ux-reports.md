# Sales Reports and UX/UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** รายงานใช้ชุดข้อมูลเดียวกันทุกหน้า ผู้ใช้ค้นข้อมูลครบ ส่งต่องานได้ และทั้ง 6 เมนูมี UX/UI ที่สอดคล้อง

**Architecture:** ใช้ query/filter/permission เดิมที่แก้ใน A–C และ reuse PageHeader, PaginationBar, usePaginationParams, date utilities และ React Query แยก query state ออกจาก layout ไม่เพิ่ม global sales store หรือเปลี่ยนเมนูให้ใช้ API ที่ยังไม่รองรับ

**Tech Stack:** React/TypeScript, React Query, Tailwind/shadcn, Excel export utility, NestJS/Prisma, Vitest/Playwright

**Spec:** [แผนหลักและตาราง UX/UI รายหน้า](2026-09-11-sales-remediation.md), audit F06/F07/F09/F10/F11/F14/F16/F17/F18, scrutinize S08

## Global Constraints

- Global Constraints ในแผนหลักใช้ครบ; ใช้ `ui-ux-pro-max` และ tokens/font เดิม; ไม่เพิ่ม library UI/chart/animation เพื่อแก้รายการนี้
- Export รับสิทธิ์จาก API เหมือน list; ไม่ fetch ด้วยบัญชี OWNER เพื่อเลี่ยง mask
- “ยอดขาย”, “ยอดรับครั้งนี้”, “มัดจำที่รับแล้ว”, “ยอดจัด”, “ยอดคงเหลือ”, “ยอดเกินกำหนด” เป็นคนละค่า
- เวลาทำงานอิง Asia/Bangkok; บันทึกเป็น Gregorian ISO UTC; แสดงวันที่ พ.ศ. ด้วย helper เดิม

## File Map

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/sales/services/sales-query.service.ts` | summary ของ filter ทั้งชุด; reuse scope A2 |
| `apps/api/src/utils/date.util.ts`, `apps/web/src/lib/date.ts` | วันไทยจาก date-only และขอบเขตช่วงวัน |
| `apps/web/src/lib/fetch-export-pages.ts` (ใหม่) | โหลด export ตาม filters ทีละหน้าไม่เกิน200 |
| `apps/web/src/lib/invalidate-sales-queries.ts` (ใหม่) | invalidate caches ที่ได้รับผลจาก mutation |
| `apps/web/src/pages/{CustomersPage,CustomerDetailPage,CreditChecksPage,BookingsPage,ContractsPage,ContractDetailPage,SalesHistoryPage}.tsx` | filters/pagination/permission/layout/copy |
| `apps/web/src/pages/POSPage/index.tsx`, `ContractCreatePage/hooks/useContractCreateData.ts` | handoff และ mutation invalidation |
| `apps/web/src/config/menu.ts` | ชื่อรายการขายใน menu configs ทุก role ที่เข้าถึง route /sales |
| `apps/web/src/lib/contract-return.ts` | คง allowlist return URL; ไม่ส่ง free-form payload ผ่าน URL |
| `apps/web/e2e/sales-menu-regression.spec.ts` (ใหม่) | six-menu browser matrix |
| `apps/web/e2e/pos-sales.spec.ts` | cash/external/POS regression ที่มีอยู่ |

## Task D1: ยอดรวมและวันไทยตรงชุดข้อมูล

**Interfaces:** คง sales list envelope; totalProfit ใช้ filter scope ทั้งชุดสำหรับ OWNER; เพิ่ม `bangkokDateRange(startDate?: string, endDate?: string): { gte?: Date; lt?: Date }` ใน API date.util.ts และ `toBangkokDateString(date?: Date): string` ใน web date.ts

- [x] เพิ่ม `sales-query.service.spec.ts` ที่ fixture มีสองใบ (net100/cost60, net200/cost50) แบ่ง page ละ1 แต่ summary totalAmount300/totalProfit190 ทั้งสองหน้า:

```ts
expect(page1.summary.totalProfit).toBe(190);
expect(page2.summary.totalProfit).toBe(190);
expect(page1.summary.totalAmount).toBe(page2.summary.totalAmount);
```

ใช้ `SalesQueryService.findAll({page: 1, limit: 1}, owner)` จริงและ stub Prisma delegates ใน unit test; integration ใช้ sale fixtures สองสาขาเพื่อยืนยัน where ไม่หลุด A2

- [x] เพิ่ม date helper tests ไม่ขึ้นกับ TZ ของ process:

```ts
expect(bangkokDateRange('2026-09-01', '2026-09-30')).toEqual({
  gte: new Date('2026-08-31T17:00:00.000Z'),
  lt: new Date('2026-09-30T17:00:00.000Z'),
});
expect(() => bangkokDateRange('2026-02-30', '2026-03-01')).toThrow();
```

- [x] รัน API tests ก่อนแก้; คาด FAIL กำไรเฉพาะ page และ date helper ไม่พบ; implement strict YYYY-MM-DD/calendar validation, reject start>end, ใช้ exclusive upper bound ของวันถัดไป เวลาไม่ผ่าน `setHours` ตาม server TZ
- [x] สร้าง `where` ชุดเดียวกับ A2; owner-profit aggregate ใช้ `sale.groupBy({by:['productId'], where, _sum:{netAmount:true}, _count:{_all:true}})` แล้วอ่าน cost ของ product IDs ชุดนั้นและรวมด้วย Decimal; ไม่เอา page data มา reduce และไม่โหลด customer/contract/PII ทั้งชุดเพื่อคำนวณกำไร

```ts
profit = profit.plus(group._sum.netAmount ?? 0)
  .minus(new Prisma.Decimal(costByProduct.get(group.productId) ?? 0).mul(group._count._all));
```

สูตรนี้คง “ยอดสุทธิ−ต้นทุนเครื่องตามสูตรเดิม” ข้าม pagination ไม่เปลี่ยนเป็นกำไรบัญชีที่รวมดอกเบี้ย/commission/ภาษี; ใส่นิยามใต้ KPI และรายงานข้อจำกัดว่าต้นทุนยังอ่านจาก product ปัจจุบัน ไม่อ้างว่าเป็น historical cost snapshot

- [x] ตาม C3 แยก Sale ที่ผูก contract DRAFT ออกจากยอดขายสำเร็จทั้ง list/summary/daily/top default; explicit draft filter ดูรายการเตรียมสัญญาได้แต่ระบุความหมาย; voided ยังคง exclude default และ explicit includeVoided แสดง flags ชัด
- [x] ปุ่มวันนี้/เดือนนี้/เดือนก่อนใน SalesHistory ใช้ Bangkok calendar helpers ไม่ใช้ `toISOString().split('T')[0]`; Booking expireDate date-only แปลงเป็นสิ้นวันไทยและเก็บ UTC; date parser ใช้ซ้ำใน daily summary
- [x] แก้ semantics: ContractDetail แยกยอดคงเหลือทั้งหมดจากเกินกำหนด; Contracts portfolio ไม่ติดป้าย sellingPrice เป็นหนี้คงเหลือ; credit avg ไม่มีคะแนนแสดง “ยังไม่มีคะแนน” ไม่ใช่0; ยังไม่เพิ่ม cash-received KPI จาก sale.createdAt
- [x] unit/web/harness/`local:check`, review/commit `fix(sales): align report totals and Bangkok date filters`

## Task D2: Pagination และ export ได้ข้อมูลครบตาม filters

**Files เพิ่มเติม:** reuse `apps/web/src/hooks/usePaginationParams.ts`, `apps/web/src/components/ui/PaginationBar.tsx`, `apps/web/src/utils/excel.util.ts`; เพิ่ม `apps/web/src/lib/fetch-export-pages.test.ts`, `apps/api/src/modules/sales/dto/sales-list-query.dto.ts`; แก้ `apps/api/src/modules/sales/sales.controller.ts`

**Interfaces:**

```ts
export interface ExportPage<T> { data: T[]; total: number }
export async function fetchExportPages<T extends { id: string }>(
  fetchPage: (page: number, limit: number) => Promise<ExportPage<T>>,
): Promise<T[]>;
```

- [x] test independent of current UI page; fetcher fixture page1=200/page2=1, total201:

```ts
const rows = Array.from({ length: 201 }, (_, index) => ({ id: String(index) }));
const fetchPage = vi.fn(async (page: number, limit: number) => ({
  data: rows.slice((page - 1) * limit, page * limit), total: rows.length,
}));
expect(await fetchExportPages(fetchPage)).toHaveLength(201);
expect(fetchPage.mock.calls).toEqual([[1, 200], [2, 200]]);
```

- [x] รัน `npm run test --workspace=apps/web -- src/lib/fetch-export-pages.test.ts`; คาด FAIL module ยังไม่มี
- [x] helper เริ่ม page1/limit200 ทุกครั้ง; เก็บ first total; ทุกหน้า total ต้องเท่าเดิมและ id ไม่ซ้ำ; ถ้าหน้าว่างก่อนครบหรือจำนวนเกิน total ให้ throw ข้อความ “ข้อมูลเปลี่ยนระหว่างส่งออก กรุณาลองใหม่”; ไม่มีไฟล์ครึ่งเดียวเมื่อ request ใดล้มเหลว; ไม่ retry วนไม่สิ้นสุด

```ts
if (response.total !== expectedTotal || response.data.some(row => seen.has(row.id))) {
  throw new Error('ข้อมูลเปลี่ยนระหว่างส่งออก กรุณาลองใหม่');
}
```

- [x] แต่ละหน้ามี builder filters เดียวที่ใช้ทั้ง list/export; export ignore current page แต่คง search/branch/company/status/tier/date/sort/includeVoided; Contracts เลิก export เฉพาะ `contracts.map` เมื่อเลือก “ตามตัวกรองทั้งหมด”; มีตัวเลือก “หน้าปัจจุบัน” ที่ระบุชัด
- [x] API pagination order ใช้ tie-break `createdAt,id` หรือ sort field+id; เพิ่ม page controls ให้ Bookings/CreditChecks; query key รวม page/size/filters; filter เปลี่ยน reset page1; customer picker เปลี่ยนเป็น debounced server search ไม่โหลดเพียง200แล้วค้นใน client
- [x] SalesListQueryDto extends PaginationDto เดิม (page>=1, limit1–200) และใช้ @Query() DTO แทน parseInt แบบไม่ validate; คง filter names ตาม A2; HTTP tests page0/NaN/limit201 ต้อง400 และ export helper limit200 ผ่าน
- [x] Contracts kanban ระบุว่าข้อมูลชุดใดและมี pagination ที่เข้าถึงได้ใน view นั้น; จำนวนหัวคอลัมน์ใช้จำนวนรวมจาก API หรือเขียน “ในหน้านี้” เมื่อเป็น page count ไม่แสดงเหมือนทั้งพอร์ต
- [x] rendered-page tests ต้องเปิดหน้า2/ตั้ง tier+sort แล้ว export ได้ทุกแถวตรง filters; API limit ไม่เกิน200; last page ที่หายหลัง mutation กลับหน้า valid ได้; error/retry ไม่ทำ selection หาย
- [x] ขอบเขตความสอดคล้อง: paged export นี้ไม่ใช่ DB snapshot ข้ามคำขอ หากข้อมูลเปลี่ยนแต่ total เท่าเดิมบางแบบตรวจไม่ได้ ให้แสดงเวลาที่ดึงและไม่เรียกว่า snapshot; ถ้าต้องใช้ปิดบัญชีแบบ snapshot ให้ใช้ server export/report ที่รับรอง transaction แยก ไม่กล่าวอ้างเกินสิ่งที่สร้าง
- [x] web tests + API pagination tests + `local:check`, review/commit `fix(sales): paginate queues and export the selected dataset`

## Task D3: เชื่อมงาน สิทธิ์ปุ่ม และ refresh ข้ามหน้า

**Interfaces:** reuse `contractReturnUrl(value: string | null): string | null`, `customerCreditUrl(customerId, returnTo)` และ `useDraftStorage` เดิม; เพิ่ม `invalidateSalesQueries(qc: QueryClient, event: SalesMutationEvent): Promise<void>`

```ts
export type SalesMutationEvent =
  'sale-created' | 'sale-voided' | 'booking-updated' | 'booking-converted' | 'contract-created';
```

- [x] rendered POS test เลือกลูกค้า/สินค้าแล้วเปิดผ่อน ต้องเข้าหน้า wizard พร้อม IDs เดิม; return URL ไม่รับ external/คนละลูกค้า:

```ts
const params = new URLSearchParams({ customerId: selectedCustomer.id, productId: selectedProduct.id });
const destination = contractReturnUrl(`/contracts/create?${params}`);
expect(destination).toContain(`customerId=${selectedCustomer.id}`);
expect(destination).toContain(`productId=${selectedProduct.id}`);
```

เพิ่ม assertion การ navigate จริงและ restore selection ของ wizard ใช้ `RestoredSelection.test.tsx` เดิม ไม่จบที่ helper string

- [x] รัน POS/restore/credit-return regression ครอบคลุม URL และการคืน selection; เทียบ baseline ที่ POS ส่งต่อ URL ว่าง (ไม่มี red log แยกสำหรับ handoff ในชุด D)
- [x] แสดง dialog ก่อนส่งต่อว่าใช้ลูกค้า/เครื่องเดิม แต่ wizard จะคำนวณราคาผ่อนใหม่; ส่วนลด ของแถม ราคา override และมัดจำที่ไม่มี field ในปลายทางต้องสรุปว่าไม่ถูกย้ายและให้กลับไปแก้ได้ ไม่หายเงียบหรือแอบใส่ query param ที่ถูก allowlist ทิ้ง; down/months ส่งเฉพาะที่ปลายทางรองรับ
- [x] แยก `canEditCustomer` จาก `canStartCredit`/`canUploadDocuments` ตาม decorators ของ endpoints จริง; Contracts create CTA ตรง ProtectedRoute และ POST roles; company grants ยังจำกัด action; error403 ไม่แสดงเป็น empty list
- [x] เพิ่ม invalidation helper ตาม pattern `PaymentsPage/invalidatePaymentQueries.ts`; prefix จริงที่ต้องตรวจคือ `sales-history`, `top-products`, `pos-products`, `products`, `products-available`, `bookings`, `booking`, `contracts`, `contract`, `trade-in-credits` ใช้ event map เพื่อไม่ invalidate ทุกหน้าโดยไม่จำเป็น

```ts
await Promise.all(keys.map(key => qc.invalidateQueries({ queryKey: [key] })));
```

`keys` มาจาก event map: sale-created/voided → sales+stock+top+trade; booking-updated → booking/list; booking-converted → booking+sales+stock+top; contract-created → contracts+stock+trade และ customer latest credit ที่ถูก claim

- [x] regression เริ่มจาก cache warm staleTime3นาที → mutation → เปิดหน้าที่เกี่ยวข้องทันทีต้องข้อมูลใหม่; mutation error ไม่ล้าง draft หรือแสดง success; กลับจากเครดิตคืน draft แยกตาม user/customer
- [x] web targeted tests + `local:check`, review/commit `fix(sales): preserve handoff context and refresh related views`

## Task D4: ปรับ UX/UI ทีละหน้าโดยคง design system

**Interfaces:** reuse PageHeader/QueryBoundary/form controls/StatusBadge/PaginationBar; UI รับ response เดิมหรือ additive fields จาก A–C; ไม่มี schema/financial mutation ใหม่ใน task นี้

- [x] เก็บ before screenshots ทุก view ตามตารางในแผนหลัก ที่1440/390 และจดตำแหน่งปุ่มหลัก/สถานะ error/current data; ใช้ evidence รอบ audit เป็น baseline เปรียบเทียบ ไม่แทนภาพหลังแก้
- [x] แก้ CustomerDetail tab container ก่อน: parent `min-w-0`, tabs `max-w-full overflow-x-auto`, content `min-w-0`; table overflow อยู่ใน region ที่เลื่อนได้ ไม่ซ่อนเนื้อหาด้วย body overflow

```tsx
<div className="min-w-0">
  <div className="max-w-full overflow-x-auto" aria-label="หมวดข้อมูลลูกค้า">
    {tabs}
  </div>
</div>
```

`tabs` เป็น tab controls ที่มีอยู่ในหน้า ไม่สร้าง div นี้ครอบ interactive controls จน keyboard semantics เปลี่ยน

- [x] ลูกค้า/เครดิต: header action หลัก1ปุ่ม, search/filters ในแถวเดียวเมื่อพอพื้นที่; mobile เปิด filters ใน sheet; status มี text ไม่อาศัยสี; empty state แยกไม่มีข้อมูลกับค้นไม่พบ; AI score null ใช้ข้อความตาม D1
- [x] POS/Booking/Contract wizard: hierarchy ลูกค้า→เครื่อง→เงื่อนไข→เงิน→ยืนยัน; summary monetary line items จาก backend ที่แก้แล้ว; sticky area ไม่บัง input/keyboard; ปุ่มระบุผล “บันทึกรับมัดจำ”, “รับส่วนต่างและขาย”, “สร้างสัญญาและบันทึกรับดาวน์” เมื่อ action ทำจริงตามนั้น
- [x] Contracts/detail/signing: งานถัดไปตามสถานะ/role; sign action เฉพาะสถานะที่รองรับ; ACTIVE เปิดเอกสารจริง; required signers จาก C3; อ่านเอกสารผิดพลาดมี retry ตาม A5; DRAFT total ไม่ใช้คำยอดเกินกำหนด
- [x] SalesHistory: ใช้ชื่อ “รายการขาย” ใน sidebar/title/breadcrumb ที่อ้างถึง route เดียวกัน คง URL; คอลัมน์หลักเลขใบ/วัน ลูกค้า+เครื่อง ประเภท ยอดสุทธิ สถานะ; ข้อมูลรองอยู่รายละเอียดที่ deep link ได้ และไม่ลดข้อมูลที่จำเป็นต่อ export
- [x] ใช้ typography/spacing/token เดิม, label+helper text, tabular numbers สำหรับเงิน, focus-visible, dialog focus return, touch targets ใช้งานนิ้วได้ และ reduced-motion เดิม; ไม่มี card ทุกบรรทัดหรือ gradient ตกแต่งเพิ่ม
- [x] ไม่สร้าง unit tests ที่ snapshot className; ใช้ browser overflow/keyboard/errors/action tests ใน D5 และ tests ของ logic ที่เปลี่ยนจริง; รัน `local:check`, review/commit แยก API / UI / browser tests ตาม helper ที่ใช้ร่วมกัน

## Task D5: Browser coverage ครบทั้งหกเมนู

**Files:** เพิ่ม `apps/web/e2e/sales-menu-regression.spec.ts`; เก็บ evidence ใน `docs/review/2026-09-11-sales/remediation-evidence/`; ปรับ test fixture support เฉพาะจำเป็น อย่าใช้ production route ใน tests

**Interfaces:** tests รับ baseURL ที่เป็น web checkout นี้; fixture tests แยกจาก API-backed integration; report ทุก case บอกว่า mocked API หรือ isolated PostgreSQL

- [x] เพิ่ม Playwright matrix ทุกหน้าจากตารางแผนหลัก แยก test titles ตามหน้า/role/viewport/state; checks หลัก:

```ts
expect(await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
)).toBe(true);
await expect(page.getByRole('main')).toBeVisible();
await page.keyboard.press('Tab');
await expect(page.locator(':focus')).toBeVisible();
```

- [x] ใช้ fixtures 201+ลูกค้า, 51+เครดิต/จอง, หลาย page sale+contract, สองสาขา, missing-price, no-score, expired, paid, voided, guardian และ503preview; ทดสอบ action ที่เปลี่ยน state ด้วย assertions จาก response/DB ไม่ใช้ screenshot อย่างเดียว
- [x] เติม full API flow ที่ limited preview ยังไม่มีด้วย Nest test app+Prisma จริงใน e2e harness (ใช้ pattern `credit-payment-flow.e2e-spec.ts` และ principal fixtures แบบ `stock-groups.e2e-spec.ts`); AI/OTP/storage/notification ใช้ stub และระบุให้ชัด; ไม่ยิงเงินหรือข้อความจริง
- [x] รัน `npm run test:e2e --workspace=apps/web -- e2e/sales-menu-regression.spec.ts` กับ test fixture environment ที่ config ของ suite ระบุ; ใช้ `bash tools/test-chat-credit.sh` สำหรับ API/ledger flows และตรวจชื่อ test ถูก discover
- [x] ตรวจชุด regression เดิม POS, booking, credit, contract-create, signing, void และ return link; ผล pass ต้องอ้าง command/time/revision; failure ที่ยังอยู่ไม่ถูกนับเป็น complete
- [x] รัน `local:check` แล้วอัปเดต verification report ตาม M1 พร้อม URL ของ server ที่ตรวจจริง; commit `test(sales): cover six-menu workflows and responsive states`

## Execution checkpoint

- D1–D5 ผ่านแล้ว: API198, web targeted121, PostgreSQL123, six-menu Playwright18 และ browserเดิม8+20+10 states; final `local:check`21 checks ผ่าน12:55:36 วันที่11 กันยายน2569
- ใช้ `toBangkokDateString`/expiry helpers จากชุด B และ components/tokens เดิมตาม ui-ux-pro-max; ไม่มี UI library เพิ่ม
- Commit ตามชั้นที่แชร์โค้ด: `50a21b5d5` API, `eb7000344` UI/export/cache/handoff, `b86687bd2` browser tests. ผลจริงและข้อจำกัดอยู่ใน [verification report](../../review/2026-09-11-sales/remediation-verification.md)
- ใช้ config `playwright.sales.config.ts` แยกจาก default E2E login เพื่อไม่ใช้ฐาน inherited; loopback-only และ intercept API ทั้งหมด. จำนวนผู้สมัครมากใน tier export ยังไม่ได้วัด performance จริง; paged export ไม่ใช่ database snapshot
- Independent read-only reviewer ยืนยันไม่มี Critical/Warning หลังแก้; ไม่มี deploy/merge หรือเขียนข้อมูลจริง
