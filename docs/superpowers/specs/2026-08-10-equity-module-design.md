# Equity Transaction Module — Design (2026-08-10)

> ที่มา: prototype `EquityModule.jsx` + `Handover.md` (ส่งมอบ พ.ค. 2569) ที่เจ้าของสั่งทำ
> เป้าหมาย: นำ 7 ประเภทธุรกรรมส่วนของผู้ถือหุ้นเข้าระบบ BESTCHOICE โดย **reuse โครง journal
> ที่มีอยู่ทั้งหมด** — ไม่สร้าง engine ใหม่ตาม schema greenfield ใน Handover §12
> คำตัดสินเจ้าของ (brainstorm 2026-08-10): 7 ประเภทตัด YE_CLOSE · ตาราง Shareholder ใหม่แยก ·
> workflow ตาม OtherIncome pattern · OWNER+FM+ACC สร้าง / OWNER+FM โพสต์ ·
> รายงานปันผล+ภ.ง.ด.2 ใหม่ + อัพเกรด SOCE เดิม

## 1. Scope

### In scope (v1)

| Txn Type | ชื่อ | JE |
|---|---|---|
| `CAP_INIT` | เริ่มลงทุนตั้งบริษัท (ชำระบางส่วนได้) | Dr เงินสด/ธนาคาร [paid] + Dr 11-1310 [unpaid] / Cr 31-1101 [par รวม] |
| `CAP_INC` | เพิ่มทุน (+premium) | Dr เงิน [amount+premium] / Cr 31-1101 [amount] + Cr 31-1102 [premium] |
| `CAP_DEC` | ลดทุน | Dr 31-1101 / Cr เงิน |
| `DRAW` | กรรมการถอนเงิน | Dr 22-1102 (Contra) / Cr เงิน |
| `DIV_DEC` | ประกาศจ่ายปันผล | Dr 32-1101 / Cr 21-4104 |
| `DIV_PAY` | จ่ายปันผลจริง (หัก WHT) | Dr 21-4104 [gross] / Cr เงิน [net] + Cr 21-3104 [wht] |
| `PRIOR_ADJ` | ปรับปรุงงบย้อนหลัง (TAS 8) | คู่กับ 32-1101 ตามทิศทางที่เลือก (ห้ามแตะ 33-1101) |

- ทะเบียนผู้ถือหุ้น (CRUD, ~3 ราย)
- รายงาน: ทะเบียนปันผล + ภ.ง.ด.2 (ใหม่) · เพิ่ม block สถานะทุนใน SOCE เดิม
- เพิ่มบัญชี **11-1310 ค่าหุ้นค้างชำระ (Unpaid Capital)** ลง `finance-coa.csv`

### Out of scope (ตาม Handover §3.2 + คำตัดสิน brainstorm)

- `YE_CLOSE` — ใช้หน้า `/finance/year-end-closing` เดิม (อ่าน GL จริง ดีกว่ากรอกมือของ prototype); หน้า equity แสดงลิงก์ชี้ไปแทน
- Capital Call (เรียกเก็บค่าหุ้นค้างชำระภายหลัง — JE ในอนาคต: Dr เงิน / Cr 11-1310) — เฟส 2
- Stock split, treasury stock, ESOP, หุ้นบุริมสิทธิ, multi-currency, dual approval วงเงิน
- SHOP-side equity (S31-XXXX) — ทุนของนิติบุคคลบันทึกฝั่ง FINANCE เท่านั้น (สอดคล้อง year-end closing เดิม)
- DBD notification อัตโนมัติ — มีแค่ popup เตือนใน UI
- ส่งเอกสารให้ผู้ถือหุ้นทาง LINE/email

## 2. Data model (Prisma)

ทุก model: UUID id, `createdAt`/`updatedAt`/`deletedAt` ตาม rules

```prisma
enum EquityTxnType { CAP_INIT CAP_INC CAP_DEC DRAW DIV_DEC DIV_PAY PRIOR_ADJ }
enum EquityDocStatus { DRAFT READY POSTED REVERSED }   // ไม่มี APPROVED (บทเรียน W5 other-income)
enum ShareholderType { INDIVIDUAL JURISTIC_TH JURISTIC_FOREIGN }

model Shareholder {
  name        String
  taxId       String?          // เลขผู้เสียภาษี — ใช้ใน ภ.ง.ด.2
  shares      Int      @default(0)
  sharePct    Decimal? @db.Decimal(5, 2)
  type        ShareholderType @default(INDIVIDUAL)
  note        String?
  isActive    Boolean  @default(true)
}

model EquityDocument {
  docNumber            String  @unique        // EQ-YYYYMMDD-NNNN (EquityDocNumberService, BKK advisory lock)
  companyId            String                 // FINANCE เสมอใน v1
  txnType              EquityTxnType
  txnDate              DateTime               // วันที่ลง JE — ต้องอยู่ในงวดเปิด
  description          String?
  resolutionNo         String?                // บังคับเมื่อ txnType ต้องมีมติ
  resolutionDate       DateTime?
  paymentAccountCode   String?                // ตรวจกับ CASH_ACCOUNT_CODES กลาง (6 รหัส)
  paAccountCode        String?                // PRIOR_ADJ เท่านั้น
  paAmount             Decimal? @db.Decimal(12, 2)
  paDirection          String?                // 'DR_OTHER_CR_RE' | 'DR_RE_CR_OTHER'
  status               EquityDocStatus @default(DRAFT)
  makerId              String                 // FK User
  approverId           String?
  journalEntryId       String?  @unique       // JE ที่โพสต์
  reverseJournalEntryId String? @unique
  reverseReason        String?
  postedAt             DateTime?
  reversedAt           DateTime?
  lines                EquityShareholderLine[]
  attachments          EquityAttachment[]
}

model EquityShareholderLine {
  documentId      String   // FK EquityDocument, onDelete: Restrict
  shareholderId   String   // FK Shareholder, onDelete: Restrict
  shareholderName String   // snapshot — history ไม่เพี้ยนถ้าแก้ master
  amount          Decimal @db.Decimal(12, 2)  // par (CAP_INIT/INC/DEC) หรือจำนวนเงิน (DRAW/DIV_*)
  premium         Decimal @db.Decimal(12, 2) @default(0)  // CAP_INC เท่านั้น
  paid            Decimal @db.Decimal(12, 2) @default(0)  // CAP_INIT เท่านั้น
  wht             Decimal @db.Decimal(12, 2) @default(0)  // DIV_PAY เท่านั้น
  lineNo          Int
  @@unique([documentId, shareholderId])       // V_SH_UNIQUE ระดับ DB
}

model EquityAttachment {
  documentId   String  // FK EquityDocument, onDelete: Restrict
  fileKey      String  // S3 key
  fileName     String
  uploadedById String
}
```

- แก้ร่าง (DRAFT เท่านั้น): ลบ `EquityShareholderLine` ทิ้งแล้วสร้างใหม่ทั้งชุด — pattern เดียวกับ
  `interco updateBatch` (ปลอดภัยเพราะยังไม่มี JE อ้างถึง)
- `DRAW` ใช้ shareholder ที่เป็นกรรมการ (ไม่บังคับตรวจตำแหน่ง — บริษัทเล็ก คุมด้วยสิทธิ์)

## 3. Backend — module `apps/api/src/modules/equity/`

โครงตาม `other-income`:

```
equity.module.ts / equity.controller.ts / equity.service.ts
equity-journal.builder.ts        # pure function: (doc, lines) → JournalLine[] — port จาก generateJournal
services/equity-doc-number.service.ts  # สำเนา pattern BKK-day advisory lock ของ other-income
                                       # (ไม่มี DocNumberService กลางให้ inject — แต่ละ module ถือสำเนาเอง
                                       #  ตาม precedent: other-income / repair-tickets / interco)
dto/                             # class-validator, error message ภาษาไทย
__tests__/
```

### JE posting

- โพสต์ผ่าน `JournalAutoService.createAndPost` ใน `$transaction` เดียวกับการเปลี่ยน status
- `metadata`: `{ flow: 'equity', idempotencyKey: 'equity:<docId>', equityDocId, txnType, docNumber }`
  — กันโพสต์ซ้ำด้วย `journal_entries_idempotency_idx` เดิม
- entry date = `txnDate` · period guard: `validatePeriodOpen(tx, txnDate, financeCompanyId)`
- เงิน: `Prisma.Decimal` ทั้งเส้นทาง ห้าม `Number()` · WHT ปัดเศษ `ROUND_HALF_UP` 2 ตำแหน่ง

### Workflow + สิทธิ์

```
DRAFT → READY → POSTED → REVERSED     (maker-checker ON)
DRAFT ————————→ POSTED → REVERSED     (maker-checker OFF — default)
READY → DRAFT (withdraw, maker เท่านั้น)
```

- SystemConfig **`EQUITY_MAKER_CHECKER_ENABLED`** — อ่านในทรานแซกชันโพสต์ แบบเดียวกับ
  `OTHER_INCOME_MAKER_CHECKER_ENABLED`; ไม่ seed (missing = OFF); เมื่อ ON: ต้องผ่าน READY และ
  approver ≠ maker
- `@Roles` ต่อ endpoint: ดู/สร้าง/แก้ร่าง/submit = `OWNER, FINANCE_MANAGER, ACCOUNTANT` ·
  post/reverse = `OWNER, FINANCE_MANAGER` · ไม่มี BranchGuard (ไม่มีมิติสาขา)
- V11 (ห้ามแก้เอกสาร POSTED) คุมที่ service (status guard + CAS ใน `$transaction`) —
  **ไม่ใช้ DB trigger** ตาม pattern ระบบ (trigger มีเฉพาะ audit_logs)

### Endpoints

| Method | Path | Roles | หมายเหตุ |
|---|---|---|---|
| GET | `/equity/documents` | O, FM, ACC | filter: txnType, status, ช่วงวันที่ · pagination มาตรฐาน |
| GET | `/equity/documents/:id` | O, FM, ACC | รวม lines + attachments + JE |
| POST | `/equity/documents` | O, FM, ACC | สร้าง DRAFT |
| PATCH | `/equity/documents/:id` | O, FM, ACC | DRAFT เท่านั้น · ลบ+สร้าง lines ใหม่ |
| DELETE | `/equity/documents/:id` | O, FM, ACC | DRAFT เท่านั้น · soft delete |
| POST | `/equity/documents/:id/submit` | O, FM, ACC | DRAFT→READY (validate ครบก่อน) |
| POST | `/equity/documents/:id/withdraw` | O, FM, ACC | READY→DRAFT, maker เท่านั้น |
| POST | `/equity/documents/:id/post` | O, FM | โพสต์ JE + POSTED (จาก DRAFT ถ้า MC OFF / READY ถ้า ON) |
| POST | `/equity/documents/:id/reverse` | O, FM | reason ≥10 ตัวอักษร · mirror-reverse |
| POST | `/equity/documents/:id/attachments` | O, FM, ACC | S3 upload — magic-byte check, PDF/JPEG/PNG/WEBP ≤5MB (pattern interco uploadSlip) |
| DELETE | `/equity/documents/:id/attachments/:attId` | O, FM, ACC | DRAFT/READY เท่านั้น |
| POST | `/equity/journal-preview` | O, FM, ACC | รับ draft payload → คืน JE lines จาก builder (wizard step 2 ใช้ — single source of truth ฝั่ง server) |
| GET/POST/PATCH | `/equity/shareholders` | O, FM, ACC | CRUD ทะเบียนผู้ถือหุ้น (ปิดใช้งานด้วย isActive) |
| GET | `/equity/dividend-register?year=` | O, FM, ACC | aggregate ต่อผู้ถือหุ้นจากเอกสาร DIV_PAY ที่ POSTED |
| GET | `/tax/pnd2-preview?year=&month=` | O, FM, ACC | ใน finance-tax — อ่านจากเอกสาร DIV_PAY POSTED (pattern เดียวกับ previewPayrollWHT ที่อ่านจากเอกสาร ไม่เดิน GL) |

### Validation (service layer, ข้อความไทย)

| Rule | เงื่อนไข | ระดับ |
|---|---|---|
| V1/V2/V5 balanced ฯลฯ | ได้จาก `JournalAutoService` (unbalanced → throw + Sentry, hardening v4) | ฟรี |
| V3 บัญชีมีจริง | builder อ้างรหัสคงที่ + validate `paymentAccountCode` กับ `CASH_ACCOUNT_CODES` | block |
| V8 แนบไฟล์ | CAP_INIT/CAP_INC/CAP_DEC/DIV_DEC/PRIOR_ADJ ต้องมี attachment ≥1 ก่อน submit/post | block |
| V_RESOLUTION | ประเภทเดียวกับ V8 ต้องมี resolutionNo + resolutionDate | block |
| V10 งวดเปิด | `validatePeriodOpen` ที่ txnDate | block |
| V11 POSTED แก้ไม่ได้ | status guard + reverse เท่านั้น | block |
| V_INIT_25 | CAP_INIT: Σpaid ≥ 25% ของ Σpar (ป.พ.พ. ม.1110) | block |
| V_INIT_PAID_LE_PAR | ต่อบรรทัด: 0 ≤ paid ≤ amount | block |
| V_INIT_ONCE | มี CAP_INIT อื่นที่ status ≠ REVERSED (ไม่นับ soft-deleted) → ห้ามสร้าง/โพสต์ | block |
| V_SH_UNIQUE | ผู้ถือหุ้นซ้ำในใบเดียว → reject (+ DB unique) — ปิด edge case Handover §17.2 | block |
| V_DIV_WHT | DIV_PAY: wht รวม > 0 ต้องมีบรรทัด 21-3104 (builder รับประกันโดยโครงสร้าง — มี spec ยืนยัน) | block |
| DIV_VS_RE | DIV_DEC: Σประกาศ > ยอด GL 32-1101 (Cr) ณ ตอนโพสต์ → **เตือน ไม่ block** (เผื่อปันผลระหว่างกาลก่อนปิดปี) — UI แสดง confirm dialog | warning |
| V_DIV_PAY_LE_PAYABLE | DIV_PAY: Σgross ≤ ยอด GL 21-4104 (Cr) จริง ณ ตอนโพสต์ — กันจ่ายปันผลที่ไม่เคยประกาศ/เกินประกาศ ทำให้หนี้สินติดลบ (pattern outstanding guard ของ RefundPayoutTemplate) | block |
| V_CAP_DEC_LE_CAPITAL | CAP_DEC: Σamount ≤ ยอด GL 31-1101 (Cr) จริง ณ ตอนโพสต์ — กันลดทุนเกินทุนที่มี | block |

- การเทียบทุกตัว (รวม V_INIT_25) ใช้ `Prisma.Decimal` ตรงๆ (`gte`/`lte`) — ไม่ใช้ float
  tolerance แบบ prototype (`−0.001`)

- WHT default: server คำนวณ 10% (`ROUND_HALF_UP`) เมื่อ shareholder.type = `INDIVIDUAL` และ client ไม่ส่งค่า ·
  `JURISTIC_TH` default 0 (ม.65 ทวิ(10)) · `JURISTIC_FOREIGN` default 10% แก้ได้ (DTA) ·
  ค่าที่ส่งมาต้อง 0 ≤ wht ≤ amount

### Reverse

- Mirror-reverse ตาม pattern ระบบ: สลับ Dr/Cr ทุกบรรทัด, `metadata.tag='REVERSAL'`,
  `metadata.flow='equity-reverse'`, `idempotencyKey='equity-reverse:<originalJeId>'`,
  `reversesEntryId` · JE เดิมคง POSTED + stamp `metadata.reversed`
- ลงวันที่ปัจจุบัน (ไม่ใช่ txnDate เดิม) + period guard ที่วันโพสต์กลับ
- UI: reverse `CAP_INIT/CAP_INC/CAP_DEC` แสดง ConfirmDialog เตือนต้องแจ้ง DBD (อัพเดตทุนจดทะเบียน)
- Reverse `DIV_DEC` หลังมี `DIV_PAY` โพสต์ไปแล้ว: ถ้ายอด GL 21-4104 (Cr) < ยอดที่จะกลับ →
  เตือนใน ConfirmDialog ว่าจะทำให้ 21-4104 ติดลบ (ควร reverse DIV_PAY ก่อน) — เตือน ไม่ block

### AuditLog

`entity = 'equity_document'` (+ `'shareholder'` สำหรับ master) · action strings:
`EQUITY_POSTED`, `EQUITY_REVERSED`, `EQUITY_SUBMITTED`, `EQUITY_WITHDRAWN` (CRUD ทั่วไปได้จาก
AuditInterceptor เดิม)

## 4. Chart of Accounts

- เพิ่ม 1 บัญชี: **`11-1310` ค่าหุ้นค้างชำระ (Unpaid Capital)** — สินทรัพย์, Dr, กลุ่ม 11-13XX
  ใน `finance-coa.csv` (บัญชีอื่นที่ต้องใช้มีครบแล้ว: 21-3104, 21-4104, 22-1101, 22-1102,
  31-1101, 31-1102, 32-1101, 33-1101)
- **Prod ต้องรัน `npm --prefix apps/api run seed:coa` หลัง deploy** (บทเรียน 21-1107 —
  บัญชีใหม่ไม่ seed อัตโนมัติใน pipeline) — เขียนไว้ใน runbook + PR description

## 5. Frontend

| หน้า | Route | เนื้อหา |
|---|---|---|
| Equity hub | `/finance/equity` | list เอกสาร + stat cards (ทุนจดทะเบียน/ชำระแล้ว/ค้างชำระ/ปันผลปีนี้/รออนุมัติ) + tab "ทะเบียนผู้ถือหุ้น" + ลิงก์ไปหน้า year-end-closing เดิม |
| Wizard | `/finance/equity/new`, `/finance/equity/:id` | 3 ขั้นตาม prototype: (1) ประเภท+รายละเอียด+ผู้ถือหุ้น+ช่องเงิน (2) preview JE จาก `/equity/journal-preview` — BALANCED badge (3) แนบไฟล์+สรุป → บันทึกร่าง / ส่งอนุมัติ (MC ON) / ลงบัญชี (MC OFF + role) |
| ทะเบียนปันผล | `/finance/dividend-register` | aggregate ต่อผู้ถือหุ้น (gross/WHT/net/ครั้ง) + ภ.ง.ด.2 + พิมพ์หนังสือรับรองหักภาษี ต่อคน — reuse component 50 ทวิ จาก `/finance/wht-annual` |

- Form: react-hook-form + zod (convention v4) · data: React Query + `QueryBoundary` ·
  lazy-load + `ProtectedRoute` · toast จาก sonner
- **สีทั้งหมดใช้ semantic tokens** — ห้าม port hex จาก prototype (`#1F3864`, `#B7791F` ฯลฯ
  ผิด rule frontend) · ใช้ธีม Zinc+Emerald เดิม · ไทยใช้ `leading-snug`
- วันที่: เก็บ `DateTime` (ค.ศ.) แสดงผล พ.ศ. ผ่าน formatter เดิมของระบบ — ไม่ใช้ string พ.ศ.
  แบบ prototype
- เมนู: โซนการเงิน กลุ่มเดียวกับ year-end-closing — label "ส่วนของผู้ถือหุ้น (Equity)" ·
  role ตามสิทธิ์ข้างต้น · ลง CommandPalette ด้วย

## 6. Reports

### ทะเบียนปันผล + ภ.ง.ด.2 (ใหม่)

- แหล่งข้อมูล: เอกสาร `DIV_PAY` ที่ POSTED (ไม่เดิน GL — pattern เดียวกับ ภ.ง.ด.1 ที่เขียนใหม่
  2026-08-06: ใบ VOID/REVERSED หลุดอัตโนมัติ, คนภาษี 0 ปรากฏครบ)
- ภ.ง.ด.2 นำส่งภายในวันที่ 7 ของเดือนถัดจากเดือนที่จ่าย (ม.52) — preview รายเดือน + export XLSX
  ตาม pattern form ภาษีอื่น

### SOCE เดิม — อัพเกรด

- `getEquityStatementFromJournal` เพิ่ม block `capitalStatus`:
  `authorized` = GL 31-1101 (Cr), `unpaid` = GL 11-1310 (Dr), `paidUp = authorized − unpaid`,
  `premium` = GL 31-1102 (Cr)
- ปิด gap เดิมที่ documented: caveat "ค่าประมาณกำไรปีปัจจุบัน…" เปลี่ยนจาก static string เป็น
  conditional — ถ้าปีนั้นมี year-end closing batch (metadata.flow='year-end-closing' ที่ไม่ถูก
  reverse) ให้เปลี่ยน/ตัดข้อความ caveat

## 7. Testing

- **Builder golden specs** (unit, ต่อ 7 ประเภท) — ตัวเลขจาก Handover §8 เช่น CAP_INIT
  1,000,000 / paid 700,000 → Dr bank 700,000 + Dr 11-1310 300,000 / Cr 31-1101 1,000,000 ·
  DIV_PAY 200,000 → Cr cash 180,000 + Cr 21-3104 20,000
- **Validation specs**: V_INIT_25 (ผ่าน 25% พอดี / ไม่ผ่าน 24.99%), V_INIT_PAID_LE_PAR,
  V_INIT_ONCE (บล็อกใบที่สอง / อนุญาตหลัง reverse), V_SH_UNIQUE, V8/V_RESOLUTION, WHT default
  ต่อ ShareholderType
- **Service integration** (`*.integration.spec.ts` — DB จริง): โพสต์ → GL ถูกต้อง → reverse →
  net 0 ทุกบัญชี · idempotency (โพสต์ซ้ำไม่ double) · maker-checker ON/OFF · period guard ·
  GL guards (V_DIV_PAY_LE_PAYABLE / V_CAP_DEC_LE_CAPITAL)
- **CI**: เพิ่มบรรทัด `EQUITY_FILES=$(ls src/modules/equity/__tests__/*.integration.spec.ts)`
  ใน vitest step ของ `deploy-gcp.yml` — glob เป็น `ls` รายโฟลเดอร์แบบ explicit
  (deploy-gcp.yml:171-183) module ใหม่ไม่ถูกรันอัตโนมัติ (บทเรียน jp5-vat-split ที่ไม่เคยรันใน CI)
- **Web tests**: wizard validation state + preview rendering (ตามกำลัง — อย่างน้อย journal
  preview + summary panel)

## 8. Rollout runbook

1. Merge + deploy → รัน `seed:coa` บน prod (เพิ่ม 11-1310)
2. สร้างทะเบียนผู้ถือหุ้นจริง (~3 ราย ตาม บอจ.5)
3. เอกสารแรก `CAP_INIT` backfill ทุนตามบอจ.5 — **CPA-gated, ห้ามโพสต์เงียบๆ**:
   สมุดทั้งระบบไม่เคยตั้งยอดยกมา (GL ธนาคาร = ยอดสะสมจาก flow ตั้งแต่เริ่มใช้ระบบ ไม่ใช่ยอด
   statement จริง) การโพสต์ขา Dr เงินสด/ธนาคารตอนนี้จะยิ่งบิดจากความจริง — ประเด็นเดียวกับ
   opening-balance gap ที่รอ CPA ใน interco spec §11 · ให้ CPA เคาะ**ชุดยอดยกมาทั้งก้อน
   พร้อมกัน** (ทุน 31-1101 + เงินสด/ธนาคาร + กำไรสะสม 32-1101) แล้วค่อยโพสต์ ·
   ลงวันที่ในงวดปัจจุบันที่เปิดอยู่ (ไม่ backdate — ติด period guard) ใส่คำอธิบาย
   "ยอดยกมา ณ วันเริ่มใช้ระบบ"
4. ตรวจ TB scope=FINANCE ยัง balance + 31-1101 ตรง บอจ.5
5. ถ้าเจ้าของต้องการ segregation of duties: ตั้ง SystemConfig `EQUITY_MAKER_CHECKER_ENABLED='true'`

## 9. คำถามเปิด (ไม่ block v1)

- ยอดกำไรสะสมยกมา (32-1101 opening) — ถ้างบปีก่อนมีกำไรสะสมจริงแต่ระบบไม่เคยบันทึก
  อาจต้องตั้งยอดยกมาผ่าน `PRIOR_ADJ` — รอตัวเลขจาก CPA (แนวเดียวกับ opening-balance gap
  ใน interco spec §11)
- แบบฟอร์ม ภ.ง.ด.2 ทางการ (ไฟล์ยื่นสรรพากร) — v1 มี preview + XLSX; แบบยื่นเต็มตามฟอร์แมต
  กรมสรรพากรค่อยเพิ่มเมื่อใช้จริง
