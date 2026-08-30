# คู่มือทดสอบทั้งระบบ — ตารางครอบคลุม route และวิธีล้างข้อมูลทดสอบ

> **ไฟล์นี้ generate จากโค้ด — อย่าแก้ด้วยมือ**
> สร้างใหม่: `DOCGEN=1 npm --prefix apps/api run seed:test-pack` (ไม่ต้องมีฐานข้อมูล)
> แหล่งข้อมูล: `apps/api/src/cli/test-pack/_registry.ts` (`routes` + `markerDoc`
> ของแต่ละโดเมน) + รายการ route จาก `apps/web/src/App.tsx`

## 0. คำเตือนก่อนใช้

- **แพ็กนี้ยังไม่เคยถูกรัน seed → cleanup ครบวงจรกับฐานข้อมูลจริง** (พัฒนาบนเครื่องที่ไม่มี
  Postgres — ผ่าน unit tests + type check เท่านั้น) ⇒ รอบแรกให้รันบน dev/staging และถือว่า
  การรันนั้นเป็นส่วนหนึ่งของการทดสอบ อย่าเริ่มที่ prod
- ทั้ง seed และ cleanup เริ่มที่ **DRY-RUN เสมอ** เมื่อไม่ใส่ `CONFIRM_*` — อ่านผล dry-run
  ก่อนยืนยันทุกครั้ง
- ก่อนรัน LIVE บน prod: สร้าง backup ก่อนเสมอ (PITR ของ Cloud SQL ปิดอยู่ — จุดกู้คืนมีแค่
  backup รายวัน): `gcloud sql backups create --instance=bestchoice-db --description="before-test-pack"`
- ตอน cleanup ให้อ่าน **warnings** ที่พิมพ์ออกมาเสมอ — แถวในตารางข้อ 2 ที่มี ⚠️ คือตาราง
  KEEP ที่ factory reset ไม่ล้างให้ ต้องพึ่ง cleanup ของแพ็กนี้เท่านั้น
- **อย่ารัน seed ระหว่างเวลาทำการ** — ตัวจองเลขเอกสารของแพ็ก (`nextDocNumber`) เป็น
  max+1 แบบ**ไม่มี advisory lock** (ต่างจาก `DocNumberService` ของจริง): รัน seed พร้อมกับ
  ที่พนักงานกำลังออกเอกสาร `EX`/`OI`/`PR` จริง เลขเอกสารอาจชนกัน — ฝั่งใดฝั่งหนึ่งพัง
  ด้วยเลขซ้ำ (P2002) โดยไม่มีข้อความอธิบายว่าทำไม
- **ใบเงินเดือนทดสอบ (DRAFT) จองช่องกันซ้ำของงวดจริง** — ด่านกันซ้ำของ payroll คือ
  (สาขา + งวด + ฝั่ง) และใบทดสอบใช้งวดเดือนปัจจุบันจริง ⇒ สร้างใบเงินเดือนจริงของ
  สาขา/งวด/ฝั่งเดียวกันจะถูกปฏิเสธ **จนกว่าจะ cleanup โดเมน `payroll` ก่อน**
- รอบจ่ายค่าคอมทดสอบผูกกับ**พนักงานขายจริงคนแรกในระบบ** ที่งวด `TEST-YYYY-MM` —
  ไม่บล็อกรอบจ่ายจริง (งวดจริงรูป `YYYY-MM` เป็นคนละ tuple ใน
  `@@unique([salespersonId, period])` และ `generatePayouts` รับเฉพาะรูปแบบจริง)
  แต่แถวทดสอบจะโผล่ในหน้ารอบจ่ายของพนักงานคนนั้นจนกว่าจะ cleanup
- ชื่อฐานข้อมูลบน prod คือ `bestchoice` (ไม่ใช่ `bestchoice_prod` ตามที่ runbook เก่า
  บางฉบับเขียน)

## 1. วิธีรัน

### Seed (สร้างข้อมูลทดสอบ)

```bash
# dry-run — พิมพ์ว่าจะสร้างอะไร ไม่เขียน DB
EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack

# สร้างจริง (เฟส 1-2: เขียน Prisma ตรง — ไม่มี JE)
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack

# เฉพาะบางโดเมน (key ตามตารางข้อ 2)
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> DOMAINS=contracts,expenses \
  npm --prefix apps/api run seed:test-pack

# เฟส 3 — เดินเรื่องผ่าน service จริง (JE ทุกใบมาจากโค้ด production เท่านั้น)
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> DRIVE=1 \
  npm --prefix apps/api run seed:test-pack
# เพิ่ม POST_DATE=YYYY-MM-DD ได้ ถ้าต้องการโพสต์ลงวันอื่นที่งวดบัญชียังเปิด

# บน prod ต้องเพิ่ม: NODE_ENV=production ALLOW_PROD_SEED=YES_I_AM_SURE
```

- seed มีด่าน **preflight** — ถ้าเงื่อนไขตั้งต้นไม่ครบ (เช่น งวดบัญชีของเดือนที่จะโพสต์ปิดอยู่)
  จะพิมพ์ปัญหาเป็นภาษาไทยแล้วหยุดก่อนเขียนอะไรทั้งสิ้น
- รันซ้ำได้ — แถวที่มีอยู่แล้วถูกข้าม (พิมพ์เป็น "ข้าม")

### Cleanup (ล้างข้อมูลทดสอบ)

```bash
# dry-run — พิมพ์รายการที่จะลบ (ด่านสุดท้ายของคนกดก่อนยืนยัน)
EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack

# ลบจริง — เดินย้อนลำดับการสร้างเสมอ (โดเมนหลังถือ FK ของโดเมนหน้า)
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack

# ล้างรายโดเมน: เพิ่ม DOMAINS=<key>
# บน prod ต้องเพิ่ม: NODE_ENV=production ALLOW_PROD_CLEANUP=YES_I_AM_SURE
```

## 2. โดเมนและวิธีล้าง (19 โดเมน)

คอลัมน์ "วิธีที่ cleanup ค้นแถว" คือ marker ที่ cleanup ใช้ตามหาข้อมูลทดสอบของโดเมนนั้น —
ถ้าสร้างข้อมูลเพิ่มระหว่างเทสด้วยมือ ให้ใช้ marker เดียวกันจึงจะถูกกวาดตอนล้าง

| โดเมน (`DOMAINS=`) | ชื่อ | จำนวน route | วิธีที่ cleanup ค้นแถว |
|---|---|---|---|
| `contracts` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า | 11 | Contract.contractNumber ขึ้นต้น "TEST-" · Customer.addressCurrent = "ข้อมูลทดสอบระบบ — ลบได้" · Product.imeiSerial ขึ้นต้น "TEST-" (สัญญาที่เปิดผ่าน UI ระหว่างเทสจะได้เลขจริง BCP- แต่ถูกกวาดตามลูกค้า/เครื่อง) |
| `expenses` | ค่าใช้จ่าย | 7 | ExpenseDocument.note ขึ้นต้นด้วย "[ทดสอบระบบ]" (เลข EX- ปล่อยตามลำดับจริง ห้ามใส่ TEST- เพราะจะพัง sequence) |
| `payroll` | เงินเดือน | 3 | ExpenseDocument.note ขึ้นต้นด้วย "[ทดสอบระบบ]" และ documentType = PAYROLL |
| `other-income` | รายได้อื่น | 7 | OtherIncome.customerNote ขึ้นต้นด้วย "[ทดสอบระบบ]" (เลข OI- ปล่อยตามลำดับจริง) |
| `assets` | ทรัพย์สินถาวร | 14 | FixedAsset.description ขึ้นต้นด้วย "[ทดสอบระบบ]" · docNo เดินตามลำดับ ASSET-YYMM- จริง · assetCode ใช้ลำดับแยก "TESTASSET-" โดยตั้งใจ เพราะรหัสจริงเป็นรายหมวด (COMP-001) ซึ่งจะถูกเผาถาวรถ้าเอาไปตั้งให้แถวทดสอบที่ถูก soft-delete |
| `equity` | ส่วนของผู้ถือหุ้น | 6 | EquityDocument.description ขึ้นต้นด้วย "[ทดสอบระบบ]" · Shareholder.name ขึ้นต้นด้วย "ทดสอบระบบ" (⚠️ shareholders เป็น KEEP table — factory reset ไม่ล้างให้) |
| `suppliers-po` | ซัพพลายเออร์ + ใบสั่งซื้อ | 4 | Supplier.name ขึ้นต้น "ทดสอบระบบ" · PurchaseOrder.poNumber ขึ้นต้น "TEST-PO-" (⚠️ ทั้งสองตารางเป็น KEEP — factory reset ไม่ล้างให้) |
| `stock-ops` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) | 8 | StockCount.countNumber ขึ้นต้น "TEST-COUNT-" · StockTransfer/StockAdjustment.notes ขึ้นต้นด้วย "[ทดสอบระบบ]" · ReorderPoint/StockAlert.model = "TEST-รุ่นแจ้งเตือน" (ค่าตรงตัว) |
| `bookings` | ใบจอง | 1 | Booking.bookingNumber ขึ้นต้น "TEST-BK-" |
| `online-orders` | ออเดอร์ออนไลน์ + การจองเครื่อง | 3 | OnlineOrder.orderNumber ขึ้นต้น "TEST-ORD-" · ProductReservation.sessionId ขึ้นต้น "TEST-SESSION-" |
| `applications` | ใบสมัครผ่อนออนไลน์ + ตรวจเครดิต | 2 | OnlineInstallmentApplication.applicationNumber ขึ้นต้น "TEST-APP-" · CreditCheck.reviewNotes = "[ทดสอบระบบ] ใบตรวจเครดิตรอตรวจ — สร้างโดยชุดข้อมูลทดสอบ" |
| `inspections` | ใบตรวจสภาพเครื่อง | 2 | Inspection.notes ขึ้นต้นด้วย "[ทดสอบระบบ]" |
| `repair` | ใบซ่อม / ประกัน | 5 | RepairTicket.ticketNumber ขึ้นต้น "TEST-RT-" |
| `device-swap` | คำขอเปลี่ยนเครื่อง | 3 | ContractExchangeRequest.conditionNote ขึ้นต้นด้วย "[ทดสอบระบบ]" |
| `commissions` | ค่าคอมมิชชั่น | 1 | SalesCommission.period และ CommissionPayout.period ขึ้นต้น "TEST-" (เช่น TEST-2026-08 — period เป็น String อิสระ จึงแยกจากงวดจ่ายจริงเด็ดขาด และ generatePayouts ของจริงรับเฉพาะ YYYY-MM จึงมองไม่เห็นงวดทดสอบ) |
| `external-finance` | บริษัทไฟแนนซ์ภายนอก | 2 | ExternalFinanceCompany.name ขึ้นต้น "ทดสอบระบบ" |
| `saving-plans` | แผนออมเครื่อง | 1 | SavingPlan.planNumber ขึ้นต้น "TEST-SP-" (SavingPlanPayment ไม่มี marker — ตามจาก FK savingPlanId และไม่มี deletedAt จึงลบถาวร) |
| `trade-in` | รับซื้อเครื่องมือสอง | 1 | TradeIn.notes ขึ้นต้นด้วย "[ทดสอบระบบ]" (เครื่องที่เกิดจากการกดรับซื้อระหว่างเทสได้ imeiSerial "TEST-" — กวาดโดยโดเมน contracts) · แถว seed เป็น flow EXCHANGE โดยเจตนา: การกดรับซื้อ flow BUYBACK โพสต์ JE "shop-trade-in:<id>" ที่ไม่มี marker/metadata ให้ cleanup กวาดถึง — รายการทดสอบที่เป็น BUYBACK ต้องให้ฝ่ายบัญชีกลับรายการ JE เองก่อนรัน cleanup |
| `todos` | กระดานงาน (Todo) | 1 | Todo.title ขึ้นต้นด้วย "[ทดสอบระบบ]" |

## 3. route → โดเมนที่ทำให้มีข้อมูล (81 route)

| route | โดเมน |
|---|---|
| `/payments` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/contracts` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/contracts/:id` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/overdue` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/collections` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/letters` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/repossessions` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/early-payoff` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/pos` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/receipts` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/finance/contract-cancellation` | สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า (`contracts`) |
| `/expenses` | ค่าใช้จ่าย (`expenses`) |
| `/expenses/:id` | ค่าใช้จ่าย (`expenses`) |
| `/expenses/new` | ค่าใช้จ่าย (`expenses`) |
| `/expenses/:id/voucher` | ค่าใช้จ่าย (`expenses`) |
| `/expenses/ap-aging` | ค่าใช้จ่าย (`expenses`) |
| `/expenses/daily-summary` | ค่าใช้จ่าย (`expenses`) |
| `/expenses/favorites` | ค่าใช้จ่าย (`expenses`) |
| `/finance/sso-report` | เงินเดือน (`payroll`) |
| `/finance/wht-report` | เงินเดือน (`payroll`) |
| `/finance/wht-annual` | เงินเดือน (`payroll`) |
| `/other-income` | รายได้อื่น (`other-income`) |
| `/other-income/:id` | รายได้อื่น (`other-income`) |
| `/other-income/new` | รายได้อื่น (`other-income`) |
| `/other-income/:id/edit` | รายได้อื่น (`other-income`) |
| `/other-income/daily-sheet` | รายได้อื่น (`other-income`) |
| `/other-income/pending-approval` | รายได้อื่น (`other-income`) |
| `/other-income/templates` | รายได้อื่น (`other-income`) |
| `/assets` | ทรัพย์สินถาวร (`assets`) |
| `/assets/:id` | ทรัพย์สินถาวร (`assets`) |
| `/assets/new` | ทรัพย์สินถาวร (`assets`) |
| `/assets/:id/edit` | ทรัพย์สินถาวร (`assets`) |
| `/assets/register` | ทรัพย์สินถาวร (`assets`) |
| `/assets/depreciation` | ทรัพย์สินถาวร (`assets`) |
| `/assets/transfers` | ทรัพย์สินถาวร (`assets`) |
| `/assets/:id/dispose` | ทรัพย์สินถาวร (`assets`) |
| `/assets/audit` | ทรัพย์สินถาวร (`assets`) |
| `/assets/:id/audit` | ทรัพย์สินถาวร (`assets`) |
| `/assets/period-close` | ทรัพย์สินถาวร (`assets`) |
| `/assets/journal` | ทรัพย์สินถาวร (`assets`) |
| `/assets/summary-report` | ทรัพย์สินถาวร (`assets`) |
| `/assets/:id/schedule` | ทรัพย์สินถาวร (`assets`) |
| `/finance/equity` | ส่วนของผู้ถือหุ้น (`equity`) |
| `/finance/equity/new` | ส่วนของผู้ถือหุ้น (`equity`) |
| `/finance/equity/:id` | ส่วนของผู้ถือหุ้น (`equity`) |
| `/finance/equity/:id/edit` | ส่วนของผู้ถือหุ้น (`equity`) |
| `/finance/dividend-register` | ส่วนของผู้ถือหุ้น (`equity`) |
| `/finance/equity-statement` | ส่วนของผู้ถือหุ้น (`equity`) |
| `/suppliers` | ซัพพลายเออร์ + ใบสั่งซื้อ (`suppliers-po`) |
| `/suppliers/:id` | ซัพพลายเออร์ + ใบสั่งซื้อ (`suppliers-po`) |
| `/purchase-orders` | ซัพพลายเออร์ + ใบสั่งซื้อ (`suppliers-po`) |
| `/purchase-orders/qc` | ซัพพลายเออร์ + ใบสั่งซื้อ (`suppliers-po`) |
| `/stock` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/stock/products` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/stock/transfers` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/stock/count` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/stock/adjustments` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/stock/alerts` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/stock/workflow` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/inventory` | งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน) (`stock-ops`) |
| `/bookings` | ใบจอง (`bookings`) |
| `/online-orders` | ออเดอร์ออนไลน์ + การจองเครื่อง (`online-orders`) |
| `/product-holds` | ออเดอร์ออนไลน์ + การจองเครื่อง (`online-orders`) |
| `/slip-review` | ออเดอร์ออนไลน์ + การจองเครื่อง (`online-orders`) |
| `/installment-applications` | ใบสมัครผ่อนออนไลน์ + ตรวจเครดิต (`applications`) |
| `/credit-checks` | ใบสมัครผ่อนออนไลน์ + ตรวจเครดิต (`applications`) |
| `/inspections` | ใบตรวจสภาพเครื่อง (`inspections`) |
| `/inspections/:id` | ใบตรวจสภาพเครื่อง (`inspections`) |
| `/insurance` | ใบซ่อม / ประกัน (`repair`) |
| `/insurance/:id` | ใบซ่อม / ประกัน (`repair`) |
| `/insurance/new` | ใบซ่อม / ประกัน (`repair`) |
| `/insurance/warranty-check` | ใบซ่อม / ประกัน (`repair`) |
| `/insurance/exchange-requests` | ใบซ่อม / ประกัน (`repair`) · คำขอเปลี่ยนเครื่อง (`device-swap`) |
| `/defect-exchange` | คำขอเปลี่ยนเครื่อง (`device-swap`) |
| `/insurance/exchange-request/new` | คำขอเปลี่ยนเครื่อง (`device-swap`) |
| `/commissions` | ค่าคอมมิชชั่น (`commissions`) |
| `/external-finance-companies/:id` | บริษัทไฟแนนซ์ภายนอก (`external-finance`) |
| `/finance-receivable` | บริษัทไฟแนนซ์ภายนอก (`external-finance`) |
| `/saving-plans` | แผนออมเครื่อง (`saving-plans`) |
| `/trade-in` | รับซื้อเครื่องมือสอง (`trade-in`) |
| `/todos` | กระดานงาน (Todo) (`todos`) |

## 4. route ที่ไม่มีโดเมน seed ครอบ (99 route)

รายการนี้คือคำประกาศตรง ๆ ว่าแพ็กนี้ **ไม่ได้** seed อะไรบ้าง — ให้อ่านว่า "ไม่ครอบโดยตั้งใจ"
ไม่ใช่ "ลืม" ส่วนใหญ่เป็นสามกลุ่ม:

- **รายงาน/แดชบอร์ด** ที่อ่านข้อมูลจากโดเมนอื่น (งบทดลอง, สรุปรายวัน, รายงานภาษี ฯลฯ) —
  มีข้อมูลให้ดูทันทีที่โดเมนต้นทางถูก seed แล้วเดินเรื่องด้วย DRIVE=1
- **หน้า public / LIFF** ที่ต้องมี token หรือ session จริง — ทดสอบด้วยการทำจริงบนหน้าจอ
- **โดเมนที่ตัดออกจากขอบเขตโดยเจตนา** (spec §12): แชท, CRM, รีวิว, โฆษณา, ใบขายนำเข้า
  (imported sales), MDM

- `/`
- `/accounting/intercompany`
- `/accounting/periods`
- `/accounting/tax-disallowed-summary`
- `/ads`
- `/analytics`
- `/audit-logs`
- `/branches`
- `/broadcast`
- `/canned-responses`
- `/chat`
- `/chat-analytics`
- `/chatbot-finance`
- `/chatbot-finance/knowledge`
- `/chatbot-finance/learning`
- `/chatbot-finance/sessions`
- `/cn/:token`
- `/collection-dashboard`
- `/contacts`
- `/contacts/:id`
- `/contract`
- `/contract-templates`
- `/contracts/:id/sign`
- `/contracts/create`
- `/crm`
- `/customer-access/:token`
- `/customers`
- `/customers/:id`
- `/depreciation`
- `/document-dashboard`
- `/finance-portfolio`
- `/finance/aging-report`
- `/finance/bad-debt-report`
- `/finance/balance-sheet`
- `/finance/bank-accounts`
- `/finance/cash-flow`
- `/finance/e-receipt-auto`
- `/finance/e-tax`
- `/finance/general-journal`
- `/finance/general-ledger`
- `/finance/intercompany-report`
- `/finance/peak-export`
- `/finance/vat`
- `/finance/vat-auto-journal`
- `/finance/wht`
- `/finance/year-end-closing`
- `/financial-audit`
- `/forgot-password`
- `/history`
- `/imported-sales`
- `/inbox`
- `/landing`
- `/liff`
- `/liff/*`
- `/liff/branches`
- `/liff/contract`
- `/liff/debug`
- `/liff/early-payoff`
- `/liff/finance-verify`
- `/liff/history`
- `/liff/notifications`
- `/liff/profile`
- `/liff/receipts`
- `/liff/register`
- `/login`
- `/mdm`
- `/migration`
- `/monthly-close`
- `/notifications`
- `/overdue/*`
- `/pay/:token`
- `/payments/import-csv`
- `/pdpa`
- `/privacy`
- `/privacy/data-deletion`
- `/products`
- `/products/:id`
- `/products/create`
- `/profile`
- `/profit-loss`
- `/promotions`
- `/purchase-orders/:id/goods-receivings/:receivingId/print`
- `/register`
- `/reports`
- `/reset-password`
- `/reviews`
- `/sales`
- `/shop/accounting`
- `/stickers`
- `/stock/branch-receiving`
- `/system-status`
- `/tax-reports`
- `/terms`
- `/users`
- `/users/:id`
- `/users/new`
- `/verify/:id`
- `/verify/:receiptNumber`
- `/webhooks`
