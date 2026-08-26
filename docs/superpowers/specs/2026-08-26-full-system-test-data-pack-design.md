# ชุดข้อมูลทดสอบทั้งระบบ (Full-System Test Data Pack) — 2026-08-26

> ต้นเรื่อง: `PROMPT-FULL-SYSTEM-TEST.md` — คู่มือทดสอบ 182 route × 13 มุม
> สถานะระบบตอนออกแบบ: prod ผ่าน factory reset 2026-08-25/26 แล้ว **สมุดบัญชีว่างเปล่า**
> (ทะเบียนสาขา/ผู้ใช้/ลูกค้า/สินค้า 604 เครื่อง/ผัง CoA ยังอยู่ — แต่ไม่มีสัญญา ใบขาย หรือ JE แม้แต่ใบเดียว)

---

## 1. ปัญหา

`seed:test-contracts` ที่มีอยู่ครอบแค่สายเดียว — สัญญาผ่อน/รับชำระ/ยึดเครื่อง/ปิดยอด
(7 สัญญา + 3 เครื่องว่าง + 2 ลูกค้าเปล่า) เหลืออีก ~15 โดเมนใน 182 route **ไม่มีข้อมูลให้ดูเลย**
และ docstring ของ `cleanup-test-contracts.cli.ts` ยอมรับช่องว่างนี้ไว้ตรง ๆ:

> *"Accounting documents created manually during testing (expense/payroll/other income)
> must be voided/reversed through the UI — they are not contract-linked."*

ปัญหาที่ใหญ่กว่าคือ **สมุดว่างทำให้รายงานตรวจไม่ได้**: MD ข้อ 12 สั่งตรวจงบทดลอง/P&L/งบดุล/ECL/ภ.พ.30
และ ~60 route ในระบบเป็นรายงานอ่านอย่างเดียว — เมื่อทุกบัญชีเป็น 0.00 จะแยก
*"ว่างเพราะไม่มีข้อมูล"* ออกจาก *"ว่างเพราะบั๊ก"* ไม่ได้ และ `isAllBalanced` (ที่บังคับให้ SHOP กับ
FINANCE สมดุล**แยกกัน**) ก็ผ่านเสมอเพราะ `0 = 0`

---

## 2. คำตัดสิน (เจ้าของ 2026-08-26)

| # | คำตัดสิน |
|---|---|
| **D1** | ขยาย seeder ให้ครบทุกโดเมน — ไม่ใช่แค่ทำเอกสาร checklist |
| **D2** | ข้อมูลมาใน **สถานะกลาง** (DRAFT/PENDING/OPEN) ที่ยังมีปุ่มให้กดต่อ ไม่ใช่ข้อมูลตั้งต้นล้วน |
| **D3** | ครอบ **สายเงิน + ปฏิบัติการ** — ไม่แตะแชท/CRM/รีวิว/โฆษณา (เป็น KEEP table, factory reset ไม่ล้างให้) |
| **D4** | **2-3 แถวต่อโดเมน** ครอบ state หลัก + เคสขอบ — ไม่ใช่ 1 แถวพอไม่ว่าง และไม่ใช่ครบทุก state |
| **D5** | โครงสร้าง **modular test-pack** — orchestrator + โมดูลต่อโดเมน (ไม่ขยายไฟล์เดิมเป็น 2,500 บรรทัด) |
| **D6** | มี **โหมดเดินเรื่อง** — เรียก service จริงให้เดินเอกสารบางส่วนถึง POSTED ⇒ JE มาจากโค้ด production ไม่ใช่ของปลอม |

---

## 3. กฎเหล็ก 3 ข้อ (ละเมิดข้อไหนคือแบบผิด ไม่ใช่แค่ไม่สวย)

### R1 — seeder ห้ามเขียน JE เอง

JE ทุกใบต้องมาจาก template จริงผ่าน service จริง เหตุผลสองชั้น:

1. สิ่งที่กำลังทดสอบคือ *โค้ดเขียนบัญชีถูกไหม* — ถ้า seeder เขียนเอง สิ่งที่ทดสอบกลายเป็นตัว seeder
2. JE ปลอมที่ไม่ผ่าน template จะไม่มี `metadata.flow` / `idempotencyKey` ตามแบบแผน ⇒ เลนส์ INTER-CO,
   reconcile cron และ ECL delta จะอ่านมันไม่เจอ แล้วรายงานเป็นรายการผิดปกติทุกเดือนโดยไม่มีเลขสัญญาให้ตามต่อ

### R2 — เฟสที่เขียน DB ตรงต้องหยุดที่สถานะสุดท้าย "ก่อนเงินขยับ"

สำรวจแล้วว่าโมดูลไหนโพสต์ JE:

| โพสต์ JE | ไม่โพสต์ JE |
|---|---|
| `bookings` · `finance-receivable` · `sales` · `trade-in` (ตอน `ACCEPTED`) · `assets` · `expense-documents` · `other-income` · `equity` · `contracts` | `purchase-orders` · `stock-transfers` · `stock` · `commissions` · `saving-plans` · `repair-tickets` · `inspections` · `online-orders` |

**เคสที่พิสูจน์ว่ากฎนี้จำเป็น** — `bookings.service.ts:444` เรียก `ShopBookingDepositTemplate` ตอนรับมัดจำ
ถ้า seeder เขียน `Booking.status = 'PAID'` ตรง ๆ โดยไม่มี JE จะได้ใบจองที่บอกว่ารับเงินแล้วแต่
`S21-2002 เงินมัดจำ` ไม่เคยถูกเครดิต — พอผู้ทดสอบกด "แปลงเป็นใบขาย" `ShopBookingDepositAppliedTemplate`
จะ `Dr S21-2002` บนยอดที่ไม่มีอยู่ ⇒ **บัญชีติดลบถาวร**

เคสเดียวกันกับ `FinanceReceivable.receivedAmount > 0`: JE ใช้ **ส่วนต่าง** เพราะ `receivedAmount`
เป็นการเซ็ตทับไม่ใช่บวกสะสม (`.claude/rules/accounting.md`) ⇒ ยอดที่ seeder ใส่ไว้จะไม่มีวันขึ้นสมุด

### R3 — ห้าม bootstrap `AppModule`

`app.module.ts:170` มี `ScheduleModule.forRoot()` และ **ไม่มี env ปิด cron** (grep `DISABLE_CRON` /
`CRON_ENABLED` แล้วไม่เจอเลย) ⇒ `NestFactory.createApplicationContext(AppModule)` จะลงทะเบียน cron
ทั้งหมดรวม 2A accrual (00:01), ECL (00:30), VAT 60 วัน (02:00)

ตรวจแล้วว่า `ScheduleModule.forRoot()` อยู่ที่ **`app.module.ts` ที่เดียว** และ BullMQ
(`BullModule.forRoot`) อยู่ที่ `notifications/notification-queue.module.ts` ที่เดียว
⇒ **สร้าง `TestPackModule` ของตัวเอง** ที่ import เฉพาะ feature module ที่ต้องใช้:
ได้ DI ครบเหมือน production แต่ไม่มี cron ไม่มี worker

> ถ้าโมดูลไหน import `NotificationsModule` มาโดยอ้อมจนดึง BullMQ ติดมา ให้ override provider นั้น
> ด้วย no-op ใน `TestPackModule` แทนการปล่อยให้ต่อ Redis จริง

---

## 4. โครงสร้าง

```
apps/api/src/cli/
  seed-test-pack.cli.ts            orchestrator: preflight + guards + dry-run + สรุป
  cleanup-test-pack.cli.ts         orchestrator: ล้างย้อนลำดับ
  test-pack/
    _types.ts                      DomainSeeder interface + SeedContext + PlanRow
    _context.ts                    resolveRefs (สาขา/ผู้ใช้/บริษัท) + marker constants ร่วม
    _module.ts                     TestPackModule (ใช้เฉพาะเฟส 3)
    _preflight.ts                  ตรวจ 4 ข้อก่อนเริ่ม
    _drive.ts                      แผนเดินเรื่องเฟส 3
    assets.seed.ts
    equity.seed.ts
    expenses.seed.ts
    ...(18 ไฟล์ ไฟล์ละ ~100-180 บรรทัด — 19 โดเมนลบ `contracts` ที่เป็นตัวห่อของเดิม)
```

### interface บังคับ

```ts
export interface DomainSeeder {
  key: string;                                   // 'assets' — ใช้กับ DOMAINS=assets,equity
  label: string;                                 // 'ทรัพย์สินถาวร'
  routes: string[];                              // route ที่โดเมนนี้ปลดล็อก → generate ตาราง README
  markerDoc: string;                             // วิธีที่ cleanup ค้นแถวของโดเมนนี้ (ข้อความไทย)
  plan(ctx: SeedContext): Promise<PlanRow[]>;    // dry-run — ไม่เขียน DB
  seed(ctx: SeedContext): Promise<SeedStat>;
  cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat>;
}
```

`seed` กับ `cleanup` **อยู่ไฟล์เดียวกันบังคับ** — เพิ่มโดเมนใหม่แล้วลืมเขียนวิธีล้าง = compile error
ไม่ใช่ค้นพบตอนล้างไม่ออก และ `markerDoc` + `routes` ทำให้ตารางใน MD ข้อ 6-7 generate จากโค้ดได้
แทนที่จะเขียนมือแล้วล้าสมัย

### seeder เดิมไม่ถูกแตะ

`seed:test-contracts` / `cleanup:test-contracts` ยังอยู่และยังใช้ได้เหมือนเดิม test-pack ใหม่
ห่อมันเป็นโดเมนแรก (`contracts`) ผ่าน export ที่มีอยู่แล้ว (`seedTestContracts` / `cleanupTestContracts`)

---

## 5. สามเฟส

| เฟส | วิธีเขียน | สร้างอะไร | พังแล้วเป็นไง |
|---|---|---|---|
| **1 master** | Prisma ตรง | ลูกค้า · เครื่อง · ซัพพลายเออร์ · ผู้ถือหุ้น · บ.ไฟแนนซ์ภายนอก · โปรไฟล์พนักงาน | หยุด (เฟสหลังพึ่งทั้งหมด) |
| **2 documents** | Prisma ตรง | เอกสาร DRAFT/pre-money ทุกโดเมน ~40 แถว | รายโดเมน — โดเมนอื่นเดินต่อ |
| **3 drive** | เรียก service ผ่าน `TestPackModule` | เดินเอกสารบางส่วนถึง POSTED ⇒ JE จริง | **เฟส 1-2 ยังอยู่ครบ** ทดสอบมือต่อได้ |

`DRIVE=0` (default) หยุดที่เฟส 2 · `DRIVE=1` เดินต่อ

- **ทำไมเฟส 2 เขียน DB ตรงได้:** DRAFT ไม่มีผลบัญชีเลย (R2 การันตี) ⇒ ไม่มี JE ให้ปลอม
- **ทำไมเฟส 3 ต้องผ่าน service:** มีผลบัญชี ⇒ R1 บังคับ

---

## 6. โดเมนและเพดานสถานะ (19 โดเมน ~55 แถว)

| # | โดเมน | เพดานที่ seed ได้ (เฟส 2) | route ที่ปลดล็อก |
|---|---|---|---|
| 1 | `contracts` *(ห่อของเดิม)* | 7 สัญญา + 3 เครื่องว่าง + 2 ลูกค้าเปล่า | `/payments` `/contracts` `/overdue` `/letters` `/repossessions` `/early-payoff` `/pos` |
| 2 | `assets` | `DRAFT` ×3 (ธรรมดา · VAT `11-4102` รอใบกำกับ · ยอดเคสขอบ) | `/assets/*` 11 route |
| 3 | `equity` | Shareholder ×3 + EquityDocument `DRAFT` `READY` | `/finance/equity*` `/finance/dividend-register` `/finance/equity-statement` |
| 4 | `expenses` | `DRAFT` `PENDING_APPROVAL` + ExpenseLine | `/expenses/*` 7 route |
| 5 | `payroll` | PayrollDetail `DRAFT` ×2 (SHOP + FINANCE scope) + PayrollLine | `/finance/sso-report` `/finance/wht-report` `/finance/wht-annual` |
| 6 | `other-income` | `DRAFT` `READY` | `/other-income/*` 6 route |
| 7 | `suppliers-po` | Supplier ×2 (1 ตัว `isRepairCenter`) + PO ×2 + GoodsReceiving | `/suppliers` `/purchase-orders` `/purchase-orders/qc` |
| 8 | `stock-ops` | StockTransfer ×2 · StockCount กำลังนับ · StockAdjustment · StockAlert | `/stock/*` 8 route |
| 9 | `trade-in` | `PENDING_APPRAISAL` `APPRAISED` | `/trade-in` |
| 10 | `bookings` | `PENDING_DEPOSIT` ×2 (ปกติ · **เลยวันหมดอายุ** รอ cron) | `/bookings` |
| 11 | `online-orders` | `PENDING_PAYMENT` `PENDING_BANK_REVIEW` (มีสลิปรอตรวจ) + ProductReservation | `/online-orders` `/product-holds` `/slip-review` |
| 12 | `applications` | OnlineInstallmentApplication ×2 + CreditCheck | `/installment-applications` `/customer-intake` |
| 13 | `inspections` | Inspection ×2 + InspectionResult | `/inspections` `/inspections/:id` |
| 14 | `repair` | `OPEN` `IN_PROGRESS` `READY_FOR_PICKUP` + RepairStatusLog | `/insurance/*` 5 route |
| 15 | `device-swap` | ContractExchangeRequest ×1 MEMO รออนุมัติ | `/defect-exchange` `/insurance/exchange-requests` |
| 16 | `commissions` | SalesCommission `PENDING` `APPROVED` `PAID` + CommissionPayout `DRAFT` | `/commissions` |
| 17 | `external-finance` | **ExternalFinanceCompany เท่านั้น** (Sale/FinanceReceivable ไปเฟส 3) | `/external-finance-companies/:id` |
| 18 | `saving-plans` | `ACTIVE` `COMPLETED` + SavingPlanPayment | `/saving-plans` |
| 19 | `todos` | `TODO` `DOING` `REVIEW` + TodoComment | `/todos` |

---

## 7. แผนเดินเรื่อง (เฟส 3)

เลือกให้ครอบบัญชีสำคัญด้วยจำนวนก้าวน้อยที่สุด — ทุกก้าวเป็น service จริง:

| ก้าว | service | บัญชีที่ได้ | ปลดล็อก |
|---|---|---|---|
| เปิดสัญญาผ่อน 1 ใบ | `ContractWorkflowService.activate` | `11-2101` `21-1101` `21-1102` `11-2106` `21-2102` + SHOP leg `S11-3001/3002` `S41-1101` `S50-1101` | **`/accounting/intercompany` มีคิวรอจ่าย** |
| รับชำระ 2 งวด | `PaymentReceiptOrchestrator.recordPayment` | `11-1101` `11-2103` `21-2101` | `/receipts` `/finance/vat` |
| ขายสด POS 1 ใบ | `SaleWriterService.createCashSale` | `S11-1101` `S41-1101` `S50-1101` `S11-2001` | `/sales` `/shop/accounting` |
| ขายผ่านไฟแนนซ์ภายนอก 1 ใบ | `SaleWriterService` | **`S11-3101`** | **`/finance-receivable` มีลูกหนี้** |
| รับมัดจำใบจอง 1 ใบ | `BookingsService` | **`S21-2002`** | `/bookings` ขา PAID |
| post ค่าใช้จ่าย · รายได้อื่น · ทรัพย์สิน · equity อย่างละ 1 | service ของแต่ละโมดูล | `S52-xxxx` `42-xxxx` `12-2101` `31-1101` | ~60 route รายงาน |

ผลลัพธ์: **งบทดลองมีทั้ง SHOP และ FINANCE** ⇒ `isAllBalanced` ตรวจได้จริง

### สิ่งที่เฟส 3 จงใจไม่ทำ

- **ไม่ approve รอบจ่าย INTER-CO** — JE รอบจ่าย stamp `metadata.items[]` ไม่ใช่ `contractId`
  ⇒ cleanup ตามลบไม่ได้ (MD ข้อ 5 ห้ามไว้แล้ว) เฟส 3 แค่ทำให้**คิว**มีของ ให้ผู้ทดสอบตัดสินใจเอง
- **ไม่ยิง QR PaySolutions จริง / ไม่ส่ง LINE จริง** — รับชำระใช้วิธี `CASH`/`TRANSFER` เท่านั้น
- **ไม่แตะ MDM** — สัญญาเทสไม่มีเครื่องจริง

---

## 8. Preflight (หยุดพร้อมบอกวิธีแก้ ไม่ใช่พังกลางทาง)

| # | ตรวจ | ถ้าไม่ผ่าน |
|---|---|---|
| 1 | `SELECT current_database()` ตรง `EXPECTED_DB_NAME` | exit 1 |
| 2 | มี branch · SALES user · OWNER/BM user · CompanyInfo ทั้ง SHOP + FINANCE | exit 1 พร้อมบอกว่าขาดอะไร |
| 3 | ผังบัญชีมีรหัสที่เฟส 3 ต้องใช้ครบ — โดยเฉพาะ `S11-3101` `S51-1106` `S21-2002` ที่เพิ่งเพิ่ม | บอกว่า *"รัน `npm --prefix apps/api run seed:coa` ก่อน"* |
| 4 | งวดบัญชีของวันที่จะโพสต์ **เปิดอยู่ทั้ง SHOP และ FINANCE** | บอกเดือนที่ปิด + ทางแก้ (เปิดงวด หรือใช้ `POST_DATE=`) |

ข้อ 3-4 ตรวจเฉพาะเมื่อ `DRIVE=1`

---

## 9. Marker 3 ชั้น

| ชนิดแถว | marker | ทำไม |
|---|---|---|
| เลขเอกสารที่ seeder คุมเอง (`Contract` `Booking` `StockCount` `PurchaseOrder` `SavingPlan` `RepairTicket`) | prefix `TEST-` | เห็นบนหน้าจอทันที |
| เลขที่ `DocNumberService` คุม (`EX-` `OI-` `EQ-` `ASSET-` `RT-`) | **ห้ามแตะเลข** → marker ที่ `note`/`description`/`notes`/`customerNote` ขึ้นต้น `[ทดสอบระบบ]` | prefix เลขจะพัง advisory-lock per-day sequence และ parser รายงานปลายทางอ่านไม่ออก |
| ทะเบียนหลัก (`Supplier` `Shareholder` `ExternalFinanceCompany` `Customer`) | ชื่อขึ้นต้น `ทดสอบระบบ` + `note` | ค้นง่าย แยกจากของจริงชัด |

marker ของเดิมคงไว้ทุกตัว: `TEST_CUSTOMER_ADDRESS = 'ข้อมูลทดสอบระบบ — ลบได้'` ·
`TEST_IMEI_PREFIX = 'TEST-'` · `TEST_CONTRACT_PREFIX = 'TEST-'`

---

## 10. Cleanup

**กลยุทธ์เดียวกับ `cleanup-test-contracts` เดิม:** JE = **hard-delete** (คืนงบทดลอง) ·
ที่เหลือ = **soft-delete** (เลี่ยง FK cascade) · พิมพ์รายการที่จะลบ **ทั้งสองโหมด** ให้ตรวจก่อนยืนยัน

**กวาด JE ของเฟส 3 แบบเป๊ะ ไม่เดา metadata** — เอกสารเกือบทุกตัวถือ FK ไป JE เอง:

| เอกสาร | ทางที่ cleanup ใช้หา JE |
|---|---|
| `ExpenseDocument` · `OtherIncome` | `journalEntryId` |
| `EquityDocument` | `journalEntryId` + `reverseJournalEntryId` |
| `FixedAsset` | `invoiceTransferJournalEntryId` |
| `Booking` | ไม่มี FK → `metadata.bookingId` (template stamp ไว้ที่ `shop-booking-deposit.template.ts:120`) |
| `Sale` | `metadata.saleId` |
| `Contract` | `metadata.contractId` (ของเดิม) |

**FK sweep ก่อน hard-delete JE** ต้องทำเหมือนเดิมทุกประการ (`JournalPostAuditLog` ·
`ContractCancellation.reversalJournalEntryId` · `FixedAsset.invoiceTransferJournalEntryId`) —
Postgres default FK = NO ACTION ซึ่งจะ abort **ทั้ง transaction** ถ้าไม่เคลียร์ก่อน

### คำเตือนพิเศษ 2 โดเมน

`shareholders` และ `suppliers` อยู่ใน `KEEP_TABLES` ของ factory reset ⇒ **ถ้าลืมล้าง มันจะรอดข้าม
factory reset ไปปนกับทะเบียนจริง** cleanup ของสองโดเมนนี้พิมพ์คำเตือนแยก

### ของเหลือที่ล้างไม่ได้ (ยอมรับ)

- `audit_logs` — immutable DB trigger
- ช่องว่างของ running number — เลขไม่เคยถูกเรียกคืนโดยตั้งใจ
- JE ของรอบจ่าย INTER-CO — stamp `metadata.items[]` ไม่ใช่ `contractId`
  (เฟส 3 ไม่สร้าง และ playbook ห้าม approve อยู่แล้ว)

---

## 11. คำสั่ง

```bash
npm --prefix apps/api run build

# ดูก่อน (dry-run เป็น default)
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run seed:test-pack

# สร้างจริง หยุดที่ DRAFT
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice \
  npm --prefix apps/api run seed:test-pack

# สร้างจริง + เดินเรื่องให้มี JE
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice DRIVE=1 \
  npm --prefix apps/api run seed:test-pack

# เลือกโดเมน
DOMAINS=assets,equity,expenses ... npm --prefix apps/api run seed:test-pack

# ล้าง
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run cleanup:test-pack           # dry-run
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice \
  npm --prefix apps/api run cleanup:test-pack
```

`NODE_ENV=production` ต้องมี `ALLOW_PROD_SEED` / `ALLOW_PROD_CLEANUP` เพิ่ม — guard shape
เดียวกับ `seed-test-contracts.cli.ts` ทุกประการ

---

## 12. นอกขอบเขต (เขียนเหตุผลลง README ด้วย)

| ไม่ทำ | เหตุผล |
|---|---|
| `/imported-sales` | ข้อมูลจริง 3,403 รายการจาก Tooltify — MD ข้อ 5 ห้ามแตะ |
| `/mdm` | ต่อ PJ-Soft จริง สัญญาเทสไม่มีเครื่องจริง |
| `/chat` `/crm` `/reviews` `/ads` `/broadcast` `/analytics` | KEEP table — ข้อมูลเทสจะรอดข้าม factory reset ไปปนประวัติจริง (D3) |
| `/accounting/intercompany` (ขา approve) | คิวเป็น **มุมมองของ GL** ไม่ใช่ตาราง — เฟส 3 ทำให้มีของแล้ว แต่การ approve ต้องให้คนตัดสิน |
| ~60 route รายงาน | อ่านจากโดเมนข้างบน ไม่มี entity ของตัวเอง — เฟส 3 ทำให้มีตัวเลขแล้ว |
| ~20 route public/LIFF (`/pay/:token` `/cn/:token` `/liff/*`) | ต้องการ **token ที่เกิดจาก flow จริง** ไม่ใช่แถวใน DB |

---

## 13. ความเสี่ยงที่รู้ตัว

| ความเสี่ยง | การจัดการ |
|---|---|
| เฟส 3 พังกลางทาง เหลือข้อมูลครึ่ง ๆ | เฟส 1-2 แยก transaction จากเฟส 3 — พังแล้วเฟสก่อนยังครบ · แต่ละก้าวของเฟส 3 รายงานผลแยก |
| `TestPackModule` ดึง BullMQ ติดมาโดยอ้อม | override provider ด้วย no-op — ห้ามปล่อยให้ต่อ Redis จริง |
| งวดบัญชีปิดระหว่างรัน | Preflight ข้อ 4 + `POST_DATE=` ให้ pin วันโพสต์ |
| รันซ้ำแล้วข้อมูลซ้ำ | ทุกโดเมนต้อง re-run safe — เช็ค marker ก่อนสร้าง (pattern เดียวกับ spare products ของเดิม) |
| IMEI `TEST-` ชนกับเครื่องจริงที่พิมพ์มือ | cleanup พิมพ์ identity ทุกแถวทั้งสองโหมด — เป็นด่านสุดท้ายของคนกด (ของเดิมทำอยู่แล้ว) |

---

## 14. งานที่ตามมา (ไม่อยู่ในสเปคนี้)

`docs/guides/FULL-SYSTEM-TEST-CHECKLIST/` ตามที่ `PROMPT-FULL-SYSTEM-TEST.md` สั่ง — ตาราง
route × 13 มุม + ตาราง KEEP/WIPE **generate จาก `routes` และ `markerDoc` ของแต่ละ `DomainSeeder`**
เพื่อไม่ให้เอกสารกับโค้ดหลุดกัน
