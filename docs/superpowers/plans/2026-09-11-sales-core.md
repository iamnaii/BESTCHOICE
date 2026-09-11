# Sales Core Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดการอ่านใบขายผิดสิทธิ์ แก้ราคาสดและยอดรับ external finance และป้องกันการไปลงนามเมื่อเอกสารยังไม่พร้อม

**Architecture:** ส่ง actor จาก controller ผ่าน facade ถึง query ทุก endpoint ใช้ branch utility และ PII masking เดิม แก้จุดเลือกค่า/สถานะใน component และ writer โดยไม่ย้าย transaction ขนาดใหญ่

**Tech Stack:** NestJS/Prisma, React, Jest/Vitest/Playwright, isolated PostgreSQL

**Spec:** [แผนหลักและ Global Constraints](2026-09-11-sales-remediation.md), audit F01/F05/F13 และ scrutinize S02/S05

## Global Constraints

ข้อกำหนดทั้งหมดในแผนหลักใช้กับทุก task; ไม่มี schema migration ใน A2–A5; ห้ามใช้ผู้ใช้หรือ DATABASE_URL จริงใน tests; ไม่แก้พฤติกรรม voided-detail ที่ตั้งใจเปิดดูได้

## File Map

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/sales/sales.controller.ts`, `sales.service.ts` | ส่ง actor ผ่าน public read interfaces |
| `apps/api/src/modules/sales/services/sales-query.service.ts` | ใช้ scope และ projection กับข้อมูล/summary |
| `apps/api/src/modules/sales/sales-read.types.ts` (ใหม่) | Actor/filter types ของ sales reads |
| `apps/api/src/modules/sales/services/sales-read-policy.ts` (ใหม่) | ประกอบ branch predicate; ใช้ `getBranchScope` เดิม |
| `apps/api/src/modules/sales/services/sale-writer.service.ts` | ยอดรับจริงเมื่อ external finance ดาวน์ 0 |
| `apps/web/src/pages/POSPage/index.tsx` | ตั้งราคาตรง sale type และ price ID |
| `apps/web/src/components/signing/StepContractReview.tsx`, `SigningWizard.tsx`, `apps/web/src/pages/ContractSignPage.tsx` | ส่ง loading/error/retry/ready state และกั้น next |

## Task A1: ทำ baseline ให้ใช้ตรวจงานได้

**Files:** อ่าน `package-lock.json`, `apps/web-shop/package.json`, `tools/local-check.mjs`, `tools/test-chat-credit.sh`; แก้ `apps/api/e2e/jest-chat-credit.json` เพื่อ discovery test ใหม่ตาม task ที่สร้าง

**Interfaces:** คง `bash tools/test-chat-credit.sh` เป็น entry point เดิม; ใช้ `LOCAL_PREVIEW_PORT` เดิม; ไม่สร้าง harness ฐานข้อมูลอีกชุด

- [x] บันทึก `git status --short`, revision และผล `npm ls gsap --workspace=@installment/web-shop --depth=0` ก่อนแก้
- [x] ตรวจ lockfile ว่าล็อก `gsap` และ `@gsap/react` แล้ว; คืน dependency จาก lock เดิมด้วย `npm ci --ignore-scripts` ใน checkout นี้ ตรวจ diff ว่า manifest/lock ไม่ถูกอัปเกรด จากนั้นรัน Prisma generate/build ผ่าน `local:check` ตามเดิม
- [x] รัน `LOCAL_PREVIEW_PORT=5207 npm run local:check` โดยตรวจเจ้าของ process ก่อนใช้พอร์ต; บันทึก failure ที่เหลือเป็น baseline ไม่ลบ tests เพื่อให้ผ่าน
- [ ] เมื่อเพิ่ม DB spec ใน task ถัดไป เพิ่มชื่อ `sales-read-scope`, `sales-money-regression`, `bookings-lifecycle`, `contract-sales-consistency` ใน `testRegex` ของ `apps/api/e2e/jest-chat-credit.json` และตรวจ discovery:

```sh
cd apps/api
../../node_modules/.bin/jest --config e2e/jest-chat-credit.json --listTests
```

- [x] แต่ละ spec ใหม่ใช้ guard เดียวกับ e2e เดิมก่อนสร้าง PrismaClient:

```ts
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Run tools/test-chat-credit.sh with its disposable database');
}
```

**ตรวจรับ:** missing-module failure หายหรือมี root cause ใหม่ที่ระบุชัด; test ใหม่ถูก discover จริง ไม่อ้างว่า command ผ่านเมื่อไม่ได้รัน test นั้น

## Task A2: ใบขายทุก read endpoint ใช้ actor และคืนข้อมูลตามสิทธิ์

**Files:** แก้ controller/facade/query ใน File Map; สร้าง types/policy; เพิ่ม `apps/api/src/modules/sales/services/sales-read-policy.spec.ts`, `apps/api/e2e/sales-read-scope.e2e-spec.ts`; ปรับ tests ผู้เรียกใน `sales.service.spec.ts`

**Interfaces:**

```ts
export type SalesReadActor = { id: string; role: string; branchId?: string | null };
export interface SalesReadFilters {
  saleType?: string; branchId?: string; search?: string;
  startDate?: string; endDate?: string; paymentMethod?: string;
  salespersonId?: string; contractStatus?: string; includeVoided?: boolean;
  page?: number; limit?: number;
}
// policy module
export function salesBranchWhere(actor: SalesReadActor, branchId?: string): Prisma.SaleWhereInput;
// facade/query; preserve each existing response envelope
findAll(filters: SalesReadFilters, actor: SalesReadActor)
findOne(id: string, actor: SalesReadActor)
getDailySummary(date: string, actor: SalesReadActor, branchId?: string)
getTopSellingProducts(actor: SalesReadActor, limit?: number)
getSalespersons(actor: SalesReadActor)
```

- [x] เพิ่ม test policy ดังนี้ และ HTTP tests ที่สร้างข้อมูลสองสาขาใน disposable DB โดยใช้ Nest guards/EntityScopeInterceptor จริง เปลี่ยนเฉพาะ JWT principal fixture ตาม pattern `stock-groups.e2e-spec.ts`:

```ts
it('fails closed when branch-scoped actor has no branch', () => {
  expect(salesBranchWhere({ id: 'u', role: 'SALES' })).toEqual({ id: { in: [] } });
});
it('rejects an explicit foreign branch', () => {
  expect(() => salesBranchWhere({ id: 'u', role: 'SALES', branchId: 'a' }, 'b'))
    .toThrow(ForbiddenException);
});
it('allows an owner to choose the report scope', () => {
  expect(salesBranchWhere({ id: 'u', role: 'OWNER' }, 'b')).toEqual({ branchId: 'b' });
});
```

- [x] ตรวจ RED ผ่าน HTTP ก่อนแก้: 10 failures ตรงขอบเขตสาขาและ projection; policy unit test เพิ่มหลัง implementation แล้วตรวจรวม facade อีกครั้ง (ไม่ได้อ้างว่ามี unit RED ก่อนสร้าง policy)
- [x] ใช้ implementation เล็กที่ประกอบ query เดิมด้วย `AND` เพื่อไม่ทับ empty-ID predicate หรือ id ของ detail:

```ts
export function salesBranchWhere(actor: SalesReadActor, branchId?: string): Prisma.SaleWhereInput {
  const scope = getBranchScope(actor);
  if (scope.all) return branchId ? { branchId } : {};
  if (!scope.branchId) return { id: { in: [] } };
  if (branchId && branchId !== scope.branchId) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงสาขานี้');
  return { branchId: scope.branchId };
}
// detail: findFirst({ where: { AND: [{ id }, salesBranchWhere(actor)] }, ... })
```

- [x] ส่ง `@CurrentUser()` ที่มี branchId ทุก read; ย้าย required actor ไปก่อน optional query parameters ใน controller เพื่อให้ TypeScript ถูกต้อง; ลบ `userRole` ที่ผู้เรียกใส่ใน filters แล้วใช้ `actor.role`; list/count/aggregate/groupBy ใช้ predicate เดียวกัน รวม daily-summary/top-products; getSalespersons ใช้ getBranchScope กับ User query และคืน [] เมื่อ BRANCH_MANAGER ไม่มีสาขา
- [x] non-OWNER ไม่คืน `product.costPrice` ทั้ง list/detail และไม่คำนวณกำไรให้หลุดผ่าน summary; SALES ใช้ `maskNationalId` จาก `utils/pii.util.ts` เหมือน CustomersController; เปลี่ยน `contract: true` ใน detail เป็น select เฉพาะฟิลด์ที่ผู้ใช้หน้ารายละเอียดต้องใช้ เพื่อไม่ปล่อย snapshot/PII ซ้อนหลบ mask ตรวจผู้เรียกก่อนลด fields
- [x] HTTP tests ต้องยืนยัน branch A อ่าน B ได้ 404 เมื่อเปิด ID; list/daily/top ไม่รวม B; branchless ได้ศูนย์; OWNER/FM/ACCOUNTANT ใช้ scope ตาม role; non-OWNER ไม่มี cost; SALES ไม่มี nationalId เต็ม; ผู้ไม่มี company grant ยังถูกปฏิเสธ; voided detail ในสาขาที่มีสิทธิ์ยังเปิดได้
- [x] รัน unit tests และ `bash tools/test-chat-credit.sh`; รัน `local:check` แล้ว review/commit เฉพาะไฟล์ task: `fix(sales): scope reads and mask restricted detail fields`

## Task A3: CASH เลือกราคาเงินสดและไม่อ้าง price ID คนละราคา

**Files:** `apps/web/src/pages/POSPage/index.tsx`, `components/SaleDetailsForm.tsx`; เพิ่ม `apps/web/src/pages/POSPage/POSPage.test.tsx`; reuse `apps/web/src/utils/getDisplayPrices.ts`

**Interfaces:** คง CreateSaleDto; CASH ใช้ `getPositiveDisplayPrices(product).cash`; EXTERNAL_FINANCE คงการตั้งต้นของทางเดิมและป้ายแสดงแหล่งราคา; ไม่เปลี่ยนค่าที่พนักงานปรับเองจาก effect ที่รันทุก render

- [x] เพิ่ม rendered-page test ด้วย fixture ที่ CASH=9000, INSTALLMENT=10000; เลือกสินค้าแล้วอ่าน input/summary และ submit payload:

```ts
expect(screen.getByLabelText(/ราคาขาย/)).toHaveValue(9000);
expect(postedSale).toMatchObject({ saleType: 'CASH', sellingPrice: 9000 });
```

`postedSale` ใน test เก็บ body จาก mock `api.post('/sales', body)`; ห้ามทดสอบเฉพาะ utility จนไม่ผ่าน handler ของหน้าจอ เพิ่มกรณี column ไม่มีค่าแต่ canonical cash price row มี, ไม่พบราคาสด, เลือกเครื่องถัดไป และเปลี่ยน sale type

- [x] รัน `npm run test --workspace=apps/web -- src/pages/POSPage/POSPage.test.tsx`; คาด FAIL 10000 แทน 9000
- [x] ใน `handleSelectProduct` เลือก `cash` เมื่อ CASH; ใช้ราคาประเภทเดิมสำหรับ external; จับคู่ selectedPriceId ตาม label/source และ amount ไม่ใช้ `product.prices[0].id` เมื่อราคาไม่ตรง หาก cash price ไม่มี ให้แสดง “ยังไม่ได้ตั้งราคาเงินสด” และให้เลือกปุ่มราคาที่มีตามสิทธิ์เดิม; ช่องราคายังคง read-only (ตรวจ implementation แล้วไม่มีสิทธิ์ manual-price เดิม); ห้ามแอบ fallback เป็นราคาผ่อน

```ts
const prices = getPositiveDisplayPrices(product);
const sellingPriceValue = saleType === 'CASH'
  ? prices.cash
  : prices.installment ?? prices.cash;
saleForm.setValue('sellingPrice', sellingPriceValue ?? 0, { shouldValidate: true });
```

- [ ] ทดสอบ manual price/discount/bundle/trade-in ไม่ถูก reset หลังเปลี่ยน customer หรือ rerender; browser 1440/390 แสดง CASH 9000 และคำเตือนเมื่อไม่มีราคา
- [x] ผ่าน targeted tests, `local:check`, review แล้ว commit `fix(pos): select the cash price for cash sales`

## Task A4: External finance ดาวน์ศูนย์ไม่สร้างยอดรับเทียม

**Files:** `apps/api/src/modules/sales/services/sale-writer.service.ts`, `sale-writer.service.spec.ts`; เพิ่ม `apps/api/e2e/sales-money-regression.e2e-spec.ts`

**Interfaces:** คง `createExternalFinanceSale(dto, salespersonId, netAmount, discount)`; `Sale.amountReceived` ตอนสร้างเท่ากับเงินดาวน์ที่รับในคำสั่งนี้; FinanceReceivable ยังคงแยกยอดรอรับ

- [x] เพิ่ม test ใน describe ที่มี `service`, `tx` ของ writer เดิม ใช้ setup externalFinanceCompany/financeReceivable จาก test `(g)` และเพิ่ม cases ดาวน์ 0/2000:

```ts
await service.createExternalFinanceSale({ saleType: 'EXTERNAL_FINANCE', customerId: 'c1',
  productId: 'p1', branchId: 'b1', sellingPrice: 10000, downPayment: 0,
  financeAmount: 10000, financeCompany: 'TEST FINANCE' }, 'u1', 10000, 0);
expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ amountReceived: 0, downPaymentAmount: 0 }),
}));
```

- [x] รัน `npm run test --workspace=apps/api -- --runInBand sale-writer.service.spec.ts`; คาด FAIL amountReceived=10000
- [x] แก้ writer เป็น `amountReceived: downPayment` และใช้ nullish handling ของ input ให้ explicit 0 ไม่กลายเป็นยอดอื่น ตรวจ validation ยอดสุทธิ/ดาวน์/ยอดจัด; ไม่แก้ settlement service หรือลด expectedAmount ซ้ำ
- [x] DB test ใช้ JournalAutoService/resolver/template จริงจาก `credit-payment-flow.e2e-spec.ts`: ดาวน์ 0 ไม่มีเดบิตเงินสด 10000; receivable=10000; ดาวน์2000/จัด8000 แยกถูก; settlement รับครั้งเดียว; void คืนสต็อกและ reverse ตาม existing flow
- [x] ไล่ read consumers ของ `amountReceived` ด้วย `rg` และเพิ่มรายงาน read-only ของรายการเก่าที่เงื่อนไขนี้เข้าได้ใน `remediation-verification.md`; ไม่ backfill ว่าได้รับเงินจริงโดยไม่มี receipt
- [x] รัน unit + isolated DB + `local:check`, review/commit `fix(sales): record only received down payment for external finance`

## Task A5: preview สัญญาต้องพร้อมก่อนยืนยันอ่าน

**Files:** `apps/web/src/pages/ContractSignPage.tsx`, `apps/web/src/components/signing/SigningWizard.tsx`, `StepContractReview.tsx`; เพิ่ม `StepContractReview.test.tsx`

**Interfaces:** ส่ง `previewState: 'loading' | 'error' | 'ready'`, `onRetryPreview: () => void` และ `previewHtml: string | null` จาก query ผ่าน wizard; component ใช้ iframe `onLoad` เพิ่ม rendered gate; reset confirmation เมื่อ contractId/html เปลี่ยน

- [x] เพิ่ม test ของ failed/loading state และการ retry สำเร็จ:

```tsx
const next = vi.fn();
render(<StepContractReview contractId="c1" previewHtml={null} previewState="error"
  onRetryPreview={vi.fn()} onComplete={next} onBack={vi.fn()} />);
expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
expect(screen.getByRole('checkbox')).toBeDisabled();
expect(screen.getByRole('button', { name: /ลองใหม่/ })).toBeEnabled();
```

- [x] รัน `npm run test --workspace=apps/web -- src/components/signing/StepContractReview.test.tsx`; คาด FAIL ก่อนเพิ่ม state/retry
- [x] ส่ง `isPending/isError/refetch` ของ query จริง ห้ามตี error เป็น loading ตลอด; ready ต้องมี html ไม่ว่างและ iframe load; disabled checkbox/next ทั้ง loading/error และยังไม่ load; คลิก next ใช้ guard ซ้ำ:

```ts
const canConfirm = previewState === 'ready' && Boolean(previewHtml?.trim()) && rendered;
const canContinue = canConfirm && confirmed;
const continueToSign = () => { if (canContinue) onComplete(); };
```

- [x] ตรวจเปลี่ยน html/contract แล้ว confirmation ไม่ติดไปเอกสารใหม่; 503→retry→ready ต้องติ๊กใหม่; browser บังคับ503 และยืนยันว่าอยู่หน้าอ่าน ไม่มี signature submission การโหลดได้ไม่ใช่การพิสูจน์ว่าลูกค้าอ่านครบทุกคำ จึงไม่เพิ่ม scroll gate ที่กล่าวอ้างเกินจริง
- [x] targeted tests + `local:check`, review/commit `fix(signing): require a loaded contract preview before confirmation`

## Execution checkpoint

- ใช้ read-only code reviewer ตาม repository; parent แก้ทั้งหมด ไม่มีการส่งงานเขียนขนาน
- PostgreSQL รวม 8 suites / 91 tests ผ่าน; web targeted POS 7 + signing 12 = 19 tests; API targeted 81 tests
- เพิ่ม `SigningWizard.test.tsx` เพื่อครอบ consent หลังไปขั้นเซ็นและ callback ค้างจากรอบก่อน นอกเหนือจาก review-component test เดิม
- รายละเอียดผล `local:check`, browser 1440/390, ข้อจำกัด และ read-only legacy query อยู่ใน [verification report](../../review/2026-09-11-sales/remediation-verification.md)
- Test discovery ตอนนี้เพิ่มเฉพาะ `sales-read-scope` และ `sales-money-regression` ที่สร้างจริง; booking/contract specs รอชุด B/C

- Final checkpoint: `local:check` PASS 21 checks; Web 1928 / shared77 / storefront31; browser core 8 states (1440/390) ไม่ล้น ไม่มี uncaught error/การเขียนธุรกรรมจริง
