# ECL ให้ตรง Excel v3 (TFRS for NPAEs Ch.13) — Design

- **วันที่:** 2026-07-23
- **สถานะ:** อนุมัติ design โดย owner แล้ว — รอเขียน implementation plan
- **ที่มา:** owner ส่งไฟล์ `ECL_System_v3.csv` (การตั้งค่าเผื่อระบบ ECL v3.0 Bug Fix #7 — Pattern 2A + Daily Cron) แล้วถามว่าระบบคิดตามนี้หรือไม่ → ตรวจโค้ด 5 มิติ (workflow `verify-ecl-vs-excel`, 2026-07-23) พบว่าแกนหลักตรง แต่มีช่องว่าง 9 ข้อ + bug ที่ template ตั้งสำรอง

## 1. เป้าหมาย

ทำให้วงจร ECL ทั้งระบบ — ตั้งสำรอง → บอกเลิกสัญญา → ยึดเครื่อง/ตัดหนี้สูญ → ใบลดหนี้ ม.82/5 — คิดเลขและเดิน workflow ตรงตาม Excel v3 ของ CPA และแก้ bug งบการเงินที่พบระหว่างตรวจ

## 2. สิ่งที่ตรงอยู่แล้ว (ไม่แตะ)

- Bucket matrix B0–B5 อัตรา 0/2/15/50/75/100% (`DEFAULT_PROVISION_RATES`, bad-debt.service.ts) + override ได้ผ่าน SystemConfig `bad_debt_provision_rates`
- Streak floor (ค้างติดกัน 2/3/4/5 งวด → floor B2/B3/B4/B5, max-severity wins) — ของเพิ่มจาก Excel ที่ owner อนุมัติแล้ว (merge 0a019ddd) คงไว้
- Provision Consume TFRS §B61-B63: JP5 + write-off ใช้ `Dr 11-2102` ก่อน `Dr 51-1102` — มี golden tests
- Credit Note ม.82/5 ขา JE ใน JP5 (แยกงวด accrued/deferred, `Dr 21-2101` เฉพาะงวด accrued)
- VAT 60 วัน (ม.82/3, `11-2104/21-2103`) — คนละมาตรากับ CN, วิ่งแยกถูกต้องแล้ว
- Stage reverse แบบ real-time ตอนรับชำระ (`Dr 11-2102 / Cr 51-1103` ใน tx เดียวกับใบเสร็จ 2B)

## 3. การตัดสินใจของ owner (2026-07-23)

| # | คำถาม | คำตอบ |
|---|---|---|
| D1 | ฐาน ECL | **ยึด 11-2103 รวม VAT** (1,515.83/งวด ตาม Excel ส่วนที่ 1 = โค้ดปัจจุบัน) — คำถาม NET_PI 916.66 ส่ง CPA เป็น follow-up ไม่ block งาน (ดู §9) |
| D2 | จดหมายบอกเลิกอัตโนมัติ 60 วัน | **เปิดเลย — ผ่านการตรวจสอบทางกฎหมายแล้ว** |
| D3 | strict mode ยึดเครื่อง | **บังคับ** — ต้อง dispatch หนังสือบอกเลิก (TERMINATED) ก่อนสร้างใบยึด (ปพพ.386) |
| D4 | เอกสารใบลดหนี้ ม.82/5 | **Gen เลขที่ + PDF + ส่ง LINE อัตโนมัติ** พร้อม delivery tracking + fallback task |
| D5 | gate ตัดหนี้สูญ | **บังคับ** — ตัดหนี้สูญได้เฉพาะสัญญา TERMINATED |

## 4. เฟส 1 — GL Correctness (PR แรก)

> หลักการ: แก้ให้ตัวเลขบัญชีถูกก่อน แล้วค่อยบังคับ workflow (เฟส 2) และออกเอกสาร (เฟส 3)

### 1a. Rework การโพสต์ JE สำรอง (BLOCKER — ถ้าไม่ทำ ข้ออื่นในเฟสนี้ไม่สะท้อนลง GL)

ปัญหาปัจจุบัน (`bad-debt-provision.template.ts`):
1. `provisionAmount.lte(0) → skip` — **delta ติดลบถูกทิ้งเงียบ** ตาราง `BadDebtProvision` ลดแต่ GL 11-2102 ไม่เคยลด (เกิดอยู่แล้ววันนี้กรณี outstanding ลดแต่ bucket ไม่ลด)
2. Idempotency key = `(contractId, period YYYY-MM)` — รันมากกว่า 1 ครั้ง/เดือน ครั้งถัดไปถูก skip → cron รายวัน (ข้อ 1c) จะ undercount ทันที

การแก้:
- Template รับ delta 2 ทิศ: บวก = `Dr 51-1103 / Cr 11-2102` (เดิม), ลบ = กลับทิศ `Dr 11-2102 / Cr 51-1103` (release) — logic อยู่ใน template เดียว
- Idempotency เปลี่ยนเป็น `(contractId, run-date YYYY-MM-DD)`; ด่านแรกยังเป็น delta=0-skip ใน `calculateProvisions` (รันซ้ำวันเดียวกัน prev=new → delta 0 เอง)
- Metadata เพิ่ม `direction: 'increase' | 'release'` เพื่อให้ audit อ่านง่าย

### 1b. ฐานคำนวณเหมือนกันทุกเส้นทาง

- `reverseStageOnPayment` (bad-debt.service.ts:606-623): เพิ่ม filter `dueDate < now` ให้ตรงกับ `calculateProvisions` — ปัจจุบันรวมงวดอนาคต ทำให้ reverse น้อยเกิน (bug)
- ถอด `lateFee` ออกจากฐานทุกจุดที่เรียก `computeOutstanding` (calculateProvisions / writeOffBadDebt / reverseStageOnPayment) — ค่าปรับไม่เคยเป็นสินทรัพย์ใน GL (รับรู้เป็นรายได้ 42-1103 ตอนรับเงินเท่านั้น ตาม spec §3.5) ⇒ ฐาน ECL = 11-2103 จริง และยอด allowance สอบยันกับ 11-2103 × rate ได้
- ผลพลอยได้: ยอดที่ใช้เช็ค tier อนุมัติ write-off (T3-C6) จะอิง GL จริง (ไม่รวมค่าปรับ) — intended

### 1c. ขยาย scope + cron รายวัน

- `calculateProvisions`: เพิ่ม `TERMINATED` เข้า contract status filter → สัญญาบอกเลิกแล้ว escalate ต่อไป B4 75% / B5 100% ตาม Excel ระหว่างรอยึด/ตัดหนี้สูญ
  - ยืนยันแล้วว่าไม่ double-count: ยึดเครื่องเสร็จ contract ถูก set `CLOSED_BAD_DEBT` ทันที (repossessions.service.ts:316-319) หลุด scope เอง และ provision ถูก consume โดย JP5
- Cron `bad-debt-provision.cron.ts`: `'30 0 1 * *'` → `'30 0 * * *'` (ทุกวัน 00:30 BKK — หลัง 2A accrual 00:01)
- JE volume ยอมรับได้เพราะโพสต์เฉพาะสัญญาที่ delta ≠ 0

### 1d. Write-off template แยกขา 11-2101/11-2103 + CN VAT (ขา JE ของข้อ 6 — เป็น bug fix ไม่ใช่ feature)

ปัญหาปัจจุบัน: 2A ย้ายลูกหนี้ `Dr 11-2103 (รวม VAT) / Cr 11-2101 (excl VAT)` ต่องวด (installment-accrual-2a.template.ts:15-21) แต่ `BadDebtWriteOffTemplate` เครดิต **11-2101 เต็มยอด** → สัญญาที่มีงวด accrue ค้างแล้วถูกตัดหนี้สูญ standalone (ไม่ผ่าน JP5): 11-2101 ติดลบได้ + 11-2103 ค้างถาวร + VAT ที่นำส่งแล้วไม่ได้ CN คืน

การแก้ (mirror ตรรกะ JP5 — พิจารณา extract shared helper ตอน implement):
- แยกงวดค้างเป็น accrued/deferred ด้วย `InstallmentSchedule.accrualJournalEntryId`
- งวด accrued: `Dr 21-2101` (CN VAT ม.82/5 = vatPerInst × จำนวนงวด accrued ค้าง) + `Cr 11-2103` (ยอดค้างรวม VAT)
- งวด deferred: `Cr 11-2101` (excl VAT) + ล้าง unearned interest (`Dr 11-2106`) + ล้าง VAT deferred (`Dr 21-2102 / Cr 11-2105`) ตามแบบ JP5 deferred branch
- Provision consume `Dr 11-2102` ก่อน → ส่วนเกิน `Dr 51-1102` (พฤติกรรมเดิม)
- Stamp `metadata.creditNoteIssued + creditNoteVatAmount` (แบบ JP5) — เฟส 3 ใช้ออกเอกสาร และกันออก CN ซ้ำกรณีเคยผ่าน JP5

### Error handling เฟส 1

- JE fail รายสัญญาใน cron loop: non-blocking + Sentry (พฤติกรรมเดิม)
- Unbalanced JE: throw + Sentry (กติกา v4)
- Write-off JE อยู่ใน `$transaction` เดียวกับการเปลี่ยนสถานะ — fail = rollback ทั้งก้อน (พฤติกรรมเดิม)

## 5. เฟส 2 — Workflow Enforcement (PR ที่สอง)

- เปิด `letter_auto_generate_enabled='true'`: แก้ seed (`collections-foundation.seed.ts`) + label (เอา "ปิดไว้จนกว่าจะผ่านการตรวจสอบทางกฎหมาย" ออก) + upsert ค่าบน prod (idempotent script/manual SQL — ระบุใน plan)
- Seed `jp5_require_terminated_status='true'` (key มีใน code แล้ว — repossessions.service.ts:240-249 — แต่ไม่เคย seed, default lenient)
- Gate ตัดหนี้สูญ: `writeOffBadDebt` โยน `BadRequestException` ข้อความไทย ถ้า `contract.status !== 'TERMINATED'`
  - เส้นยึดเครื่องไม่กระทบ — repossession โพสต์ write-off JE ผ่าน template ตรง ไม่ผ่าน service นี้ (verify อีกครั้งตอน implement)
- **สื่อสารทีมก่อนเปิด:** จดหมาย 60 วันจะเข้าคิวอัตโนมัติทุกวัน 09:15, ยึดเครื่อง/ตัดหนี้สูญต้องผ่าน dispatch หนังสือ + เลข EMS ก่อนเสมอ

## 6. เฟส 3 — เอกสารใบลดหนี้ + LINE (PR ที่สาม)

- สร้างเอกสาร CN ตาม pattern receipt-void เดิม (`receiptType='CREDIT_NOTE'` + PDF หัว "ใบลดหนี้" — receipt-void.service.ts / receipt-pdf.service.ts) — ใช้ convention เลขที่เดิมของ flow นั้น
- Trigger: JP5 และ write-off ที่ stamp `creditNoteIssued=true` → สร้าง CN record ใน transaction, PDF gen แบบ async
- ส่ง LINE อัตโนมัติผ่าน OA FINANCE + **delivery tracking**:
  - ส่งสำเร็จ → บันทึกสถานะ + timestamp
  - ส่งไม่ผ่าน (ลูกค้าบล็อก OA / ไม่มีอุปกรณ์ — เครื่องที่มี LINE มักเป็นเครื่องที่ถูกยึด) → notification/task ให้ทีมส่งช่องทางอื่น (แนบซอง EMS เดียวกับหนังสือบอกเลิกได้) + ปุ่ม resend
- UI: แสดง CN ในหน้า receipts + repossession detail

## 7. การทดสอบ

- Golden tests เทียบ fixture 17,000/12 (1,515.83 / VAT 99.17):
  - write-off split: all-accrued / all-deferred / mixed / มีค่าปรับค้าง (ต้องไม่เข้าฐาน) / provision consume ครบ-บางส่วน-ไม่มี
  - provision release JE (delta ติดลบ) + idempotency ราย run-date (รันวันเดียวกันซ้ำ / คนละวัน)
  - TERMINATED escalation (บอกเลิกวันที่ N → วันที่ N+31 bucket ขยับ)
  - stage-reverse ฐานใหม่ (งวดอนาคตไม่เข้าฐาน + ยัง**เคารพ streak floor** ตาม spec เดิม)
- Integration specs ต่อจากชุด `bad-debt.streak-*.integration.spec.ts` (ต้องเป็น `*.integration.spec.ts` เพราะ CI รัน jest กับ DB จริง)
- เฟส 2: spec ของ gate (write-off จาก status อื่น → 400) + strict repossession
- เฟส 3: CN doc creation + LINE fail → task fallback

## 8. Rollout

1. เฟส 1 merge แล้ว **dry-run บน prod-copy ก่อน** (cloud-sql-proxy): รายงาน delta สรุปต่อ bucket — ยอด release จากถอดค่าปรับ + ยอด escalate จาก TERMINATED — ให้ owner เห็นตัวเลขก่อนรันจริง
2. วันแรกบน prod ค่าเผื่อจะขยับก้อนใหญ่ครั้งเดียว (expected, มีตัวเลขจาก dry-run เทียบ)
3. เฟส 2 เปิด config หลังสื่อสารทีมเก็บเงิน
4. เฟส 3 ตามหลังได้อิสระ

## 9. Open question ถึง CPA (ไม่ block)

- Excel ส่วนที่ 2 มีบรรทัด `NET_PI = GROSS_PI − INT_PI = 916.66 "Net Exposure ต่องวด"` ขัดกับส่วนที่ 1 ที่ให้คำนวณจาก 11-2103 (1,515.83 รวม VAT) — ตอนนี้ระบบใช้ 11-2103 ตาม D1; ถ้า CPA ยืนยันภายหลังว่าต้องใช้ NET_PI ให้เปิดงานแก้ฐานแยกอีกใบ (กระทบ: อัตราสำรองลดลง ~40% ของฐาน)
- ไฟล์อ้างอิง "สรุปการบันทึกรับชำระค่างวด.csv §6" ที่ comment ในโค้ดอ้าง ไม่ถูก track ใน repo — ขอไฟล์จาก CPA มาเก็บเข้า fixtures ด้วย

## 10. Out of scope

- เปลี่ยนฐานเป็น NET_PI (รอ CPA — §9)
- SHOP-side ECL (SHOP ไม่มีลูกหนี้ผ่อน)
- Migration ย้อนหลังของ provision รายเดือนที่เคย skip delta ติดลบ — GL จะ self-correct ในรอบแรกที่รันหลังเฟส 1 (delta คิดจาก prev จริงใน DB)

## 11. อ้างอิง

- `apps/api/src/modules/accounting/bad-debt.service.ts` (base/scope/reverse)
- `apps/api/src/modules/accounting/bad-debt-provision.cron.ts` (schedule)
- `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts` (delta skip + idempotency)
- `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` (split legs)
- `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts` (ตรรกะ CN/split ต้นแบบ)
- `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts` (2A moves 11-2101→11-2103)
- `apps/api/src/modules/repossessions/repossessions.service.ts:229-249,316-319` (strict mode + status หลังยึด)
- `apps/api/src/modules/overdue/crons/letter-auto-generate.cron.ts` + `apps/api/prisma/seeds/collections-foundation.seed.ts` (จดหมาย 60 วัน)
- ผลตรวจ 5 มิติ: workflow run `wf_9950ae90-3b2` (2026-07-23)
