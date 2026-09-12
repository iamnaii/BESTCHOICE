# Sales Contract Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** ยอดที่เสนอและสร้างจริงตรงกัน เงินดาวน์ระบุวิธีรับ และทางเข้าสัญญาใช้กติกาเดียวกัน

**Architecture:** แยกการ resolve quote ออกจากการ persist ใน lifecycle เดิม ใช้ผล quote ชุดเดียวกับหน้าเว็บโดยคงสูตร/schedule/credit gates ปัจจุบัน รักษา compatibility ของ API เก่าจนตรวจผู้เรียกครบ และให้ UI ใช้ `/contracts` เสมอ

**Tech Stack:** NestJS, Prisma/PostgreSQL, Decimal, shared installment utilities, React Query

**Spec:** [แผนหลัก](2026-09-11-sales-remediation.md), scrutinize S01/S03/S04/S08 และ audit F12

## Global Constraints

- ใช้ Global Constraints ในแผนหลักทั้งหมด; quote ไม่มี side effect, ไม่ใช้ credit approval และไม่จองเครื่อง
- การ create ยัง recheck สิทธิ์/stock/credit ใน transaction; ห้าม trust ยอดจาก client
- ไม่เปลี่ยนอัตรา VAT/ดอกเบี้ย/เวลารับเงินของธุรกิจในงานรวมคำนวณนี้; แสดงแหล่ง effective config ให้ตรวจได้
- สัญญาเดิมที่ไม่มีวิธีรับเงินไม่ถูก backfill จากการคาดเดา; migration additive และข้อมูลเดิมอ่านได้

## File Map

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts` | create/update ใช้ผล resolve เดียว |
| `apps/api/src/modules/contracts/services/contract-quote.service.ts` (ใหม่) | prepare effective amounts/config และสร้าง quote |
| `apps/api/src/modules/contracts/dto/contract-quote.dto.ts` (ใหม่) | validated quote input |
| `apps/api/src/modules/contracts/{contracts.controller,contracts.service,contracts.module}.ts` | route/facade/DI ของ quote |
| `apps/api/src/utils/{config,get-rate-for-months,installment}.util.ts` | reuse calculation; ทำ DB interface ให้รับ transaction เฉพาะ delegates ที่ใช้ |
| `apps/api/src/modules/interest-config/interest-config.service.ts` | เลือก config ของ category อย่าง deterministic ตรงกับ quote |
| `packages/shared/src/contract-quote.ts` (ใหม่), `packages/shared/src/index.ts` | quote response DTO ที่ serializable |
| `apps/web/src/pages/ContractCreatePage/hooks/{useContractCreateData,useContractCalculation}.ts` | query quote, freshness, submit |
| `apps/web/src/pages/ContractCreatePage/components/{PlanDetailsStep,ContractSummaryPanel}.tsx` | แสดงยอด/วิธีรับ/การเปลี่ยน quote |
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261001000000_contract_down_payment_tender/migration.sql` (ใหม่) | เก็บวิธีรับ/เวลา/เลขอ้างอิงแบบ nullable สำหรับข้อมูลเดิม; ชื่อเรียงหลัง migrations ที่มีอยู่ ณ revision นี้ |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | activation ใช้ receipt metadata ที่สร้างไว้ ไม่กำหนด CASH ทับ |
| `apps/api/src/modules/contracts/services/contract-cancellation.service.ts` | reversal ใช้ข้อมูลรับเดิม/JE ต้นทาง |
| `apps/api/e2e/contract-sales-consistency.e2e-spec.ts` (ใหม่) | quote→create→activate→cancel และ compatibility |

## Task C1: Server quote และ create ใช้ effective config เดียวกัน

**Interfaces:** เพิ่ม `POST /contracts/quote` เป็น read-only calculation ใช้ roles/branch/company guards เดียวกับ create ก่อน dynamic `:id` routes; response types เป็น decimal strings:

```ts
export interface ContractQuote {
  fingerprint: string;
  sellingPrice: string;
  downPayment: string;
  cashDownPayment: string;
  tradeInCreditAmount: string;
  configId: string | null;
  vatSource: 'BRANCH_COMPANY' | 'CONFIG_FALLBACK';
  effectiveVatPct: string;
  ratePct: string;
  principal: string;
  interestTotal: string;
  storeCommission: string;
  vatAmount: string;
  totalPayable: string;
  monthlyPayment: string;
  lastPayment: string;
  totalMonths: number;
  firstDueDate: string;
}
// Quote DTO uses the create fields needed for math only:
// customerId, productId, branchId, sellingPrice, downPayment,
// totalMonths, paymentDueDay, interestRate?, tradeInCreditId?
// create DTO adds optional quoteFingerprint for compatibility with old callers.
```

`ContractQuoteService.resolve(dto: ContractQuoteDto, actor: { id: string; role: string; branchId?: string | null }, tx?: Prisma.TransactionClient): Promise<ContractQuote>` ใช้ injected PrismaService เมื่อไม่มี tx; create ส่ง transaction client เสมอ ยอด sellingPrice/downPayment ที่คืนเป็น effective amounts หลังเตรียม trade-in เพียงครั้งเดียว ส่วน cashDownPayment เป็นเงินรับใหม่ ไม่รวม credit; persist ใช้ effective amounts นี้และ claim trade-in จาก input เดิมเพื่อไม่หัก bonus/base ซ้ำ

- [x] เพิ่ม `contract-quote.service.spec.ts` + integration cases VAT false/true, flag false/true, หลาย active configs, rate หาย, วัน31/ก.พ., rounding งวดสุดท้าย, trade-in และผล quote stale ก่อน submit
- [x] ตัวอย่าง golden fixture ต้องผ่านทั้ง GET config เดิม/quote ใหม่/create จริง ไม่ป้อน config ข้าม resolver:

```ts
// Fixture: sellingPrice=10000, downPayment=2000, months=6,
// scalar interest=.01, commission=.10, branch vatRegistered=false.
expect(quote.monthlyPayment).toBe('1546.66');
expect(quote.effectiveVatPct).toBe('0.0000');
expect(contract.monthlyPayment.toFixed(2)).toBe(quote.monthlyPayment);
expect(schedule.reduce((sum, row) => sum.plus(row.amountDue), new Decimal(0)).toFixed(2))
  .toBe(quote.totalPayable);
```

`quote`, `contract`, `schedule` ใน integration test มาจาก quote endpoint → lifecycle.create → Prisma payment.findMany ของ contract เดียวกัน ใช้ seed/providers ของ `credit-payment-flow.e2e-spec.ts` และ company VAT false จริงใน DB

- [x] รัน `npm run test --workspace=apps/api -- --runInBand contract-quote.service.spec.ts`; คาด FAIL เพราะ service ยังไม่มี; เพิ่ม spec เข้า harness discovery ตาม A1
- [x] Extract resolver จาก lifecycle: deterministic config `createdAt asc, id asc`; ใช้ `loadInstallmentConfig`, `resolveInstallmentParams`, `resolveVatPctForBranch`, `getRateForMonths` เดิม; เพิ่ม id tie-break ใน InterestConfigService.findByCategory ที่ wizard ใช้อยู่ด้วย ไม่ใช้ `resolveBcConfig` ตรง ๆ เพราะมันไม่มี branch VAT/feature flag policy เดียวกัน และไม่เปลี่ยน quote ของ bot/storefront ในงานนี้
- [x] ใช้ `calculateInstallmentWithInterest` และ `generatePaymentSchedule` จริง แยก principal (`contract.financedAmount` เดิม) จาก totalPayable (ผลรวมลูกค้าจ่าย) ห้าม rename/ย้ายความหมาย field ฐานข้อมูลเพียงเพราะชื่อคล้ายกัน
- [x] ให้ schedule รับ anchor `Date` ที่ส่งเข้าได้โดยเพิ่ม optional parameter ท้าย signature เดิม เพื่อ quote/create ใช้วันไทยเดียวกัน; fingerprint รวม effective input, configId/rate/VAT, trade-in result, first due date และทุกจำนวนเงิน ใช้ `createHash('sha256')` ของ canonical ordered object ไม่รวม timestamp ที่เปลี่ยนทุกครั้ง
- [x] ก่อน create claim credit/stock/JE ให้ re-resolve ภายใน transaction ถ้า client ส่ง fingerprint ที่ต่างให้ตอบ409 code `CONTRACT_QUOTE_CHANGED` พร้อม quote ใหม่; client ให้ทบทวนแล้วกดยืนยันใหม่ ไม่ auto-submit และไม่ต้อง claim quote ใน DB เพราะ create คำนวณเงินเอง

```ts
if (dto.quoteFingerprint && dto.quoteFingerprint !== quote.fingerprint) {
  throw new ConflictException({ code: 'CONTRACT_QUOTE_CHANGED',
    message: 'เงื่อนไขหรือยอดผ่อนเปลี่ยน กรุณาทบทวนอีกครั้ง', quote });
}
```

- [x] Hook ใช้ query key ครบ customer/product/branch/ราคา/ดาวน์/งวด/วัน/เทิร์น; summary และ credit-cap comparison ใช้ quote เดียวกัน ขณะ loading/error/stale ห้ามยืนยันด้วยค่ารอบก่อน; สถานะ query เทิร์น/credit ไม่ถูกลดความเข้ม
- [x] ทดสอบ VAT false quote1546.66 vs true1654.93, last row residual, schedule total, config change409 ไม่มี contract/JE/approval claim; เงินดาวน์/ส่วนลด/เทิร์นไม่ถูกนับซ้ำ; unit/web/harness/`local:check`, review/commit `fix(contracts): resolve previews and creation from one quote`

## Task C2: เก็บ tender ดาวน์และใช้ตลอด lifecycle

**Interfaces:** เพิ่มใน Contract แบบ nullable เพื่ออ่านข้อมูลเดิม:

```prisma
downPaymentMethod     PaymentMethod? @map("down_payment_method")
downPaymentReceivedAt DateTime?      @map("down_payment_received_at")
downPaymentReference  String?        @map("down_payment_reference")
```

CreateContractDto เพิ่ม `downPaymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET'`, `downPaymentReference?: string`; เวลา server บันทึกเมื่อรับจริงในคำสั่งนี้ ไม่ให้ client ส่งย้อนหลังโดยไม่มี workflow เดิมรองรับ Client ใหม่ส่ง method เมื่อมี cashDown>0; client เก่าที่ไม่ส่งยังเป็น CASH ตาม behavior เดิมและบันทึกที่มาว่า legacy default ใน audit ห้ามตีความวิธีรับของสัญญาเก่าที่ null ว่าเคยยืนยันเงินสด

- [x] เพิ่ม lifecycle unit test ด้วย transfer tender ตรวจ resolver call และ Sale ตอน activate:

```ts
expect(shopAccountResolver.resolveInflowCashAccount)
  .toHaveBeenCalledWith(branchId, 'BANK_TRANSFER', expect.anything());
expect(createdContract.downPaymentMethod).toBe('BANK_TRANSFER');
expect(activatedSale.paymentMethod).toBe('BANK_TRANSFER');
```

ใช้ providers/fixture ใน `contract-lifecycle.service.spec.ts` และ `contract-workflow.service.spec.ts` ที่มีจริง พร้อมเพิ่ม mock method ใหม่ก่อน assertion; test ต้องตรวจเงินสดดาวน์จริงหลังหักแหล่ง trade-in ไม่ใช้ contractual down ทั้งก้อน

- [x] รัน `npm run test --workspace=apps/api -- --runInBand contract-lifecycle.service.spec.ts contract-workflow.service.spec.ts`; คาด FAIL ที่ไม่เก็บ/ไม่ใช้ BANK_TRANSFER
- [x] สร้าง additive migration ตาม workflow; method validate enum/ref ความยาวจำกัด; create เรียก `resolveInflowCashAccount` ด้วย method และใช้ `cashDownPayment`/trade-in cash amount ที่มีอยู่ ไม่ลงเครดิตเทิร์นเป็นเงินสด
- [x] activation ใช้ persisted method/reference และ JE ต้นทาง ไม่ default CASH ทับสัญญาใหม่; receipt/cancel/refund/reversal ใช้ account ของเงินรับเดิม/ต้นทาง JE ไม่ใช้ account setting ที่เพิ่งเปลี่ยน
- [x] review step แสดง “ดาวน์ที่ตกลง”, “เครดิตเทิร์น”, “รับเงินเพิ่มครั้งนี้”, method/ref และข้อความปุ่มว่าการสร้างสัญญานี้บันทึกรับดาวน์ด้วย; cashDown0 ไม่สร้าง receipt เวลา/วิธีรับปลอม
- [x] PostgreSQL test BANK_TRANSFER/CASH/QR, trade-in+cashDown, cashDown0, create rollback, activate retry, cancel/refund, เปลี่ยนบัญชีสาขาภายหลัง; ผล JE แยก SHOP/FINANCE และไม่ซ้ำ
- [x] dry-run migration บน DB ชั่วคราวพร้อม legacy row null; unit/web/harness/`local:check`, review/commit `fix(contracts): preserve down-payment tender through activation`

## Task C3: ทางเข้าสัญญาและ required signer ตรง backend

**Files เพิ่มเติม:** `apps/api/src/modules/sales/dto/sale.dto.ts`, `apps/api/src/modules/sales/services/sale-writer.service.ts`, `apps/api/src/modules/sales/services/sale-creation.service.ts`, `apps/api/src/modules/sales/services/sales-query.service.ts`; `apps/api/src/modules/contracts/services/contract-create-policy.ts` (ใหม่), `apps/api/src/modules/contracts/services/contract-signature-requirements.ts` (ใหม่), `apps/api/src/modules/contracts/services/contract-query.service.ts`; `apps/web/src/pages/ContractDetailPage.tsx`; `apps/web/src/components/signing/SigningWizard.tsx`

**Interfaces:** ทั้งสอง paths อ่าน active contracts หลัง customer lock ใน transaction แล้วใช้ pure policy + quote C1 + tender C2 + customer snapshot เดียวกัน; เพิ่ม interfaces ในไฟล์ policy/requirements:

```ts
export function assertActiveContractCreationAllowed(
  activeContracts: { id: string; contractNumber: string; status: string }[],
  actorRole: string, overrideActiveContractCheck: boolean,
): void;
export interface SignatureRequirement {
  key: string; label: string; acceptedSignerTypes: string[]; signed: boolean;
}
export function getSignatureRequirements(
  birthDate: Date | null, signatures: { signerType: string }[],
): SignatureRequirement[];
// Contract detail adds signatureRequirements: SignatureRequirement[]
```

- [x] ค้น callers ของ POST sales INSTALLMENT และ `createInstallmentSale` ใน repo, tests, docs/integrations บันทึก caller inventory และ response fields ที่ต้องรักษาใน verification report; ไม่ถือว่า grep ไม่พบแปลว่าไม่มี external consumer
- [x] เพิ่ม contract/legacy path parity tests: วัน31, active-contract override OWNER/BM, SALES ห้าม override, approval expired/used, current-debt cap, customer snapshot, quote totals และ down tender; credit claim จริงต้องเกิดครั้งเดียว
- [x] รัน DTO/service tests ก่อนแก้; คาด FAIL วัน31/explicit active-contract gate; extract policy จาก lifecycle และให้ writer เรียกใน transaction หลัง customer lock ตามเดิม:

```ts
if (activeContracts.length > 0 &&
    !((actorRole === 'OWNER' || actorRole === 'BRANCH_MANAGER') && overrideActiveContractCheck)) {
  throw new ConflictException({ code: 'CUSTOMER_HAS_ACTIVE_CONTRACT',
    message: 'ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่', activeContracts });
}
```

- [x] UI คง `/contracts/create` เป็นทางเดียว; legacy `/sales` INSTALLMENT คง response สำหรับผู้เรียกเดิมแต่ใช้กติกาเดียวกัน adapter map `CreateSaleDto.paymentMethod` เป็น contract downPaymentMethod ของ C2 ใน task นี้แก้ SalesQuery ให้ Sale ที่ผูก DRAFT ไม่ถูกนับเป็นขายสำเร็จใน summary/list/daily/top default และแสดงสถานะเตรียมสัญญาใน view ที่เรียกชัด; activation ของ legacy row ต้องอัปเดตข้อมูลให้ตรงสัญญาและไม่สร้าง Sale ซ้ำ; D1 ใช้ predicate นี้ต่อโดยไม่เขียนใหม่
- [x] การลบ INSTALLMENT writer เก่าทำได้เมื่อย้ายผู้เรียกครบและมี contract สำหรับ response ใหม่; งานชุดนี้ส่งมอบ parity และไม่มี UI ใหม่ใช้เส้นทางเก่า ไม่กล่าวอ้างว่า physical Sale ถูกสร้างเวลาเดียวกันแล้ว
- [x] backend สร้าง signatureRequirements จาก `checkAgeEligibility` และกติกาเดิม: CUSTOMER, COMPANY (accept STAFF), WITNESS_1, WITNESS_2, GUARDIAN เมื่อจำเป็น; approval/activate กับ detail ใช้ helper เดียว ไม่ให้ frontendคำนวณอายุซ้ำคนละ timezone
- [x] regression age17/19/20 และ duplicate signer: คนเดิมเซ็นซ้ำไม่เพิ่มตัวนับ; COMPANY/STAFF เป็นช่องเดียว; 4/5 ต้องแสดงยังไม่ครบและพาไป signer ที่ขาด; guardian backend gates ยังอยู่
- [x] ทดสอบทั้ง wizard และ legacy create/sign/activate ใน isolated DB พร้อมรายงาน draft exclusions; unit/web/harness/`local:check`, review/commit แยก parity และ signer เพื่อ review ได้ทีละเรื่อง

## Execution notes — 2026-09-11

C1–C3 implemented and independently reviewed. Regression coverage is consolidated into the existing disposable `credit-payment-flow.e2e-spec.ts` harness rather than a second financial fixture. Shared signer requirements live in `packages/shared/src/signature-requirements.ts`; backend age policy remains in validation utilities. Additive migration is `20261000900000_contract_down_payment_tender`. See the verification report for actual commands, scope and counts; browser writes are intercepted. List-page signer display will use the same response in D.
