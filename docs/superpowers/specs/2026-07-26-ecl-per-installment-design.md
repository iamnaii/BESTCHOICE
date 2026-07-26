# ECL แบบแยกงวด (Per-Installment Aging) + JP5 จัดเต็ม + Workbook v4 — Design

- **วันที่:** 2026-07-26
- **สถานะ:** design approve โดย owner แล้ว (แบบ A) — รอเขียน implementation plan
- **ที่มา:** owner ส่ง workbook CPA "Bug Fix #7" (8 sheets) — sheet Scenarios กำกับว่า **"Aging แยกแต่ละงวด (ที่ถูกต้อง!)"** ขัดกับ sheet หลัก (ทั้งสัญญา×งวดเก่าสุด = วิธีที่ระบบใช้อยู่); owner เคาะ: **แยกงวดคือกติกาใหม่** + JP5 จัดเต็ม + สร้าง workbook ใหม่ทั้งชุด
- Audit workbook (2026-07-26): เลขผิดจริง 3 จุด (Scenario D Net VAT 792.85→793.36, Cash Flow D →−2,245.87, FIN-2024-010 action→พร้อม JP5) + methodology fork + ไม่มี release residual + ไม่มีเคส pro-rate

## 1. การตัดสินใจของ owner

| # | เรื่อง | คำตอบ |
|---|---|---|
| D1 | วิธีคิด ECL | **แยกงวด** — แต่ละงวดค้างใช้ rate ตาม bucket ของอายุงวดตัวเอง แล้วรวมเป็นค่าเผื่อของสัญญา |
| D2 | JP5 | **จัดเต็ม**: (ก) clearing legs → GL-based แบบ write-off template (ปิด backlog over-credit 11-2103 เคส partial) (ข) release ค่าเผื่อส่วนเกินหลัง consume ใน JE เดียวกัน |
| D3 | Workbook | **สร้างใหม่ทั้ง 8 sheets** ด้วยตัวเลขวิธีแยกงวด + แก้ 3 จุดผิด + เพิ่มเคส pro-rate + แถว release — ใช้เป็น golden reference เทียบระบบ/ส่ง CPA |

## 2. หลักการออกแบบ

### 2.1 เครื่องคิดเลขกลางตัวเดียว (installment outstanding engine)

ต่อยอด `computeCnBreakdown` (มีอยู่ — fee-netted FEE-FIRST, clamp [0, installmentTotal], PAID ข้าม, no-Payment-row = เต็มงวด) ให้เป็น helper กลางของ "ยอดค้างรายงวด + อายุ" ที่ **ECL และใบลดหนี้ใช้ร่วมกัน**:

```
computeInstallmentOutstanding(client, contract, opts?) → rows[{
  installmentNo, dueDate, outstanding (fee-netted), daysOverdue, installmentTotal, vatPerInst
}]
```
- CN (`computeCnBreakdown`) refactor เป็น consumer ของ engine นี้ (กรอง accrued + คำนวณ cnVat ต่อจาก rows) — สูตร/goldens CN **ห้ามเปลี่ยน** (33.75 / 38.71 / 232.09 คงเดิม)
- ECL ใช้ rows เดียวกัน → เคสจ่ายบางส่วนได้ pro-rate ในค่าเผื่อโดยอัตโนมัติ และ **ฐาน ECL สอดคล้อง CN เป๊ะ** (นิยาม "ยอดค้างจริง" เดียวกันทั้งระบบ ตาม ruling CPA)
- หมายเหตุ ECL เดิมใช้ `amountDue − amountPaid` ตรงๆ (ไม่ net ค่าปรับ) — เปลี่ยนมาใช้ fee-netted ด้วย = ฐานถูกต้องขึ้น (เงินค่าปรับไม่ใช่การชำระเงินต้น) — ระบุใน CPA note

### 2.2 calculateProvisions ใหม่ (แยกงวด)

ต่อสัญญาใน scope (ACTIVE/OVERDUE/DEFAULT/TERMINATED — เท่าเดิม):
```
provision(contract) = Σ ต่องวดค้าง_i: outstanding_i × rate(bucket_i)
bucket_i = ตัวที่ rate สูงกว่า ระหว่าง (aging bucket ของงวด i) กับ (streak-floor bucket ของสัญญา)
```
- **Streak floor เดิมคงไว้เป็น "ขั้นต่ำต่องวด"** (กติกา CPA §1 consecutive-missed ไม่หาย) — งวดใหม่ๆ ของสัญญาที่ค้างติดกันเยอะจะโดนดันขึ้น
- **TERMINATED ใช้วิธีเดียวกัน** — งวด accrued-ค้าง aging ต่อเนื่องรายงวด; **เลิกใช้ฐาน carrying amount** (`terminatedCarryingAmount` retire) — ส่วน deferred (ยังไม่ accrue) **ไม่ตั้งสำรอง** ตามโมเดล CPA (มูลค่าเครื่องที่จะยึด (recovery) คุ้มครองส่วนนั้น; ขาดทุนจริงรับรู้ตอน JP5) — จุดนี้ + streak composition เขียนเป็น **CPA note** ใน workbook/เอกสารให้เซ็นรับ
- Delta-vs-GL 11-2102, release cap ที่ GL, idempotency ราย runDate, cron รายวัน, dry-run CLI — **กลไกเดิมทั้งหมด ไม่แตะ** (สลับเฉพาะเครื่องคิดเป้าหมาย)
- `reverseStageOnPayment`: คำนวณ target ใหม่ด้วย engine เดียวกัน → release = min(row − target, GL) — เลิกเทียบ "rate ลดลง" (ไม่มี rate เดียวของสัญญาอีกแล้ว); full-reverse เมื่อ target = 0

### 2.3 Schema + รายงาน

- `BadDebtProvision.bucketBreakdown Json?` — `{ "<bucket>": { count, base, provision } }` ต่อสัญญา (ให้ Exec-summary/aging report แบบ workbook ทำได้ — สัญญาเดียวกระจายหลาย bucket ได้แล้ว)
- `agingBucket` (คอลัมน์เดิม) = bucket ของงวดเก่าสุด (display/sort); `provisionRate` = blended (provision/base, 4 ตำแหน่ง) เพื่อ backward-compat กับ UI เดิม
- `getProvisionSummary` byBucket รวมจาก breakdown (ไม่ใช่ต่อสัญญา)

### 2.4 JP5 จัดเต็ม

- Clearing legs เปลี่ยนเป็น **GL-based** (อ่าน balance 11-2103/11-2101/11-2106/11-2105/21-2102 ราย contract — pattern เดียวกับ `BadDebtWriteOffTemplate` ที่พิสูจน์แล้ว) — ปิด bug over-credit 11-2103 เคส partial + เก็บเศษ rounding (ตัวเลขจะต่างจาก workbook CPA ระดับสตางค์ เพราะ workbook ใช้ count-based — **ระบบเป็น canonical**, ดู §4)
- CN VAT pro-rated (มีแล้ว) + consume provision (มีแล้ว) + **ใหม่: release ค่าเผื่อคงเหลือหลัง consume** (`Dr 11-2102 ส่วนเหลือ / Cr 51-1103`) ใน JE เดียวกัน → 11-2102 ของสัญญาเป็นศูนย์เสมอหลัง JP5
- Write-off template: เพิ่ม release-residual leg เดียวกัน (สมมาตร — เคส provision > loss หายาก แต่ต้องไม่ค้าง)
- `BadDebtProvision` rows ของสัญญา → mark REVERSED/WRITTEN_OFF ตอน JP5 (ปิดช่อง stale rows ที่ audit เคยเจอ)

### 2.5 Workbook v4 (สร้างใหม่ — ขั้นสุดท้าย)

สร้างด้วย xlsx skill หลัง goldens ผ่าน — **ตัวเลขทุกช่องมาจากค่าที่ระบบ/test คำนวณจริง**:
- 8 sheets โครงเดิม + แก้ 3 จุดผิด + label fixes (Net VAT "(Period)"→"สะสม", scenario A mark "ต่ำกว่าเกณฑ์ 60 วัน", FIN-003 JE mark "Scenario จำลอง")
- Provision ทุกตัว = วิธีแยกงวด (sheet หลักถูก regenerate); JP5 sheet เพิ่มคอลัมน์ **Release Residual** และ JE ตัวอย่างเพิ่มบรรทัด release
- เพิ่มสัญญาตัวอย่าง 1 แถว **จ่ายบางส่วน** (โชว์ pro-rate ทั้ง ECL base และ CN: 33.75/38.71)
- CPA note box: (ก) streak floor ต่องวด (ข) deferred ไม่ตั้งสำรอง (ค) นโยบายสตางค์ GL-based (ง) fee-netted base
- ไฟล์ commit ที่ `docs/accounting/ECL-workbook-v4-per-installment.xlsx` + ส่งพี่นาย

## 3. Goldens (จาก workbook — วิธีแยกงวด, fixture 17k/12)

| Scenario (สมศักดิ์, ราคากลาง 5,000) | Provision สะสม | Gross Loss | Net Loss (51-1102) | Net VAT |
|---|---|---|---|---|
| A: บอกเลิกงวด 4 (45d) | 30.32 | 8,543.30* | 8,512.98* | 1,090.87 |
| B: งวด 5 (75d) | 257.69 | 8,444.13* | 8,186.44* | 991.70 |
| C: งวด 6 (105d) | 1,015.61 | 8,344.96* | 7,329.35* | 892.53 |
| D: งวด 7 (135d) | 2,152.48 | 8,245.79* | 6,093.31* | **793.36** (แก้จาก 792.85) |

\* ค่า count-based ของ workbook — goldens จริงในระบบ = GL-based จะต่างระดับสตางค์ (เช่น A: loss 8,513.02 เพราะกวาด residual 11-2101 0.08 + 11-2105 0.04 — ปักเลขสุดท้ายตอน implement แล้ว workbook ใช้เลขระบบ) — **นโยบาย: ระบบ canonical, workbook ตาม**
- Per-installment provision series: งวดเดียว 30d → 30.32; ชุด 90/60/30 → 757.92+227.37+30.32 = 1,015.61 ฯลฯ
- FIN-2024-004 (ค้าง 3 งวด 75/45/15d, streak 3 → floor B3): งวดค้าง bucket = max(aging, B3) = B3/B3/B3 → 3×757.92 = 2,273.76 — **หมายเหตุ: streak floor ทำให้เคสนี้ ≠ 1,015.61 ของ aging ล้วน** (workbook sheet Scenarios ไม่มี streak; ตัวอย่างใน workbook v4 ต้องแสดงทั้งสองคอลัมน์ให้ CPA เห็น)

## 4. ผลกระทบ + Rollout

- ค่าเผื่อรวมพอร์ตลดลง (แยกงวด < ทั้งสัญญา) → วันแรก cron release ส่วนต่างอัตโนมัติ (delta-vs-GL) — **dry-run บน prod ก่อน** รายงานให้ owner (ปัจจุบัน prod ไม่มีสัญญาค้าง → ผลจริง = 0, เปลี่ยนเชิงพฤติกรรมล้วน)
- ไม่มี config/enforcement เปลี่ยน; forward-only
- CPA sign-off package = workbook v4 + CPA notes (ให้พี่นายส่ง)

## 5. Out of scope

- CN document layer / LINE (ไม่แตะ — ใช้ engine ผ่าน computeCnBreakdown interface เดิม)
- จดหมาย/letters, NET_PI (ปิดแล้ว), token hygiene follow-up
- Backfill provision ย้อนหลัง (GL self-heal รอบแรก)

## 6. อ้างอิง

- Workbook "Bug Fix #7" 8 sheets (owner ส่ง 2026-07-26) + audit findings ในบทสนทนา
- ระบบปัจจุบัน: `bad-debt.service.ts` (calculateProvisions/reverseStageOnPayment/glBalance), `compute-cn-breakdown.ts`, `repossession-jp5.template.ts`, `bad-debt-writeoff.template.ts`
- Spec เดิมที่ถูก supersede บางส่วน: `2026-07-23-ecl-excel-v3-alignment-design.md` §4 1c (ฐาน TERMINATED carrying amount → retire), whole-contract aging → retire
