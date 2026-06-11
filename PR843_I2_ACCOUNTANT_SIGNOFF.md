# PR-843/I2 — เอกสารขออนุมัติฝ่ายบัญชี (Accountant Sign-off)

> **สถานะ:** โค้ดเสร็จ + reviewed ครบบน branch `feat/payment-receipt-primitive` (PR #1199, ยัง draft). **การ merge ติด gate ที่การเซ็นอนุมัติด้านล่างนี้** — main auto-deploy ขึ้น prod ทันที (มาตรฐาน TFRS for NPAEs)
>
> **⚠️ OWNER DECISION (2026-06-09):** เจ้าของ (akenarin, OWNER) **ยืนยันด้วยตนเองว่า treatment ทั้ง 8 ข้อถูกต้องและขอเดินหน้าโดยไม่รอ CPA ภายนอกเซ็นแยก** — รับผิดชอบบนสิทธิ์เจ้าของ. หมายเหตุ: ผู้พัฒนา/agent ให้ความเห็นเชิงเทคนิคว่าทุกข้อตรง `.claude/rules/accounting.md` แต่ไม่ใช่การรับรองวิชาชีพ. แนะนำให้ CPA review #3 (เงินเกิน→21-1103) + #6 (auto-approve เศษ ≤1฿) เมื่อสะดวก (เป็น policy ใหม่จริง) — แต่ไม่บล็อกการ deploy ตามมติเจ้าของ.

## สิ่งที่เปลี่ยน (ภาพรวม)
รวมการลงบัญชี "รับชำระค่างวด" ของ **4 ช่องทาง** (บันทึกหน้าเคาน์เตอร์, จัดสรรอัตโนมัติ, QR PaySolutions, ใช้เครดิตคงเหลือ) ให้ผ่าน **primitive เดียวกัน** เพื่อให้ทุกลำดับการจ่าย (จ่ายบางส่วนแล้วมาปิด, จ่ายข้ามช่องทาง) ลงบัญชีถูกต้องเหมือนกันเสมอ

**Invariant ที่รับประกัน (พิสูจน์ด้วย real-DB test ทุกช่องทาง):**
- `Σ(เครดิต 11-2103 ต่อ 1 งวด) == installmentTotal` — ล้างลูกหนี้ค้างชำระครั้งเดียวต่อบาท ไม่ซ้ำ
- `Σ(เครดิต 42-1103 ต่อ 1 งวด) == ค่าปรับล่าช้า` — บันทึกค่าปรับครั้งเดียว
- ส่วนปัดเศษ ≤1฿ → 53-1503 (กำไร) / 52-1104 (ขาดทุน) ตามนโยบายเดิม

---

## รายการที่ขออนุมัติ (ต่อหัวข้อ — ทำเครื่องหมาย ✅ / ❌ + ลงชื่อ)

| # | การเปลี่ยน treatment | บัญชีที่กระทบ | เหตุผล | อนุมัติ |
|---|---|---|---|---|
| 1 | **ค่าปรับล่าช้า → 42-1103 ตอนรับเงินทุกครั้ง** รวมการรับบางส่วน (เดิมบางช่องทาง drop หรือรวมเข้า 11-2103) | Cr 42-1103 (รายได้ค่าปรับ, ไม่มี VAT) | ค่าปรับเป็นรายได้เมื่อรับ; สอดคล้อง accounting.md ⚠️ ห้าม book 42-1103 ซ้ำผ่าน Other Income งวดเดียวกัน | ☐ |
| 2 | **บันทึก JE ทุกการรับบางส่วน** (PaySolutions + จัดสรรอัตโนมัติ เดิมไม่ลง JE ตอนจ่ายบางส่วน → เงินเข้าธนาคารแต่ลูกหนี้ไม่ลด) | Dr เงินสด/ธนาคาร / Cr 11-2103 ตาม delta | ลูกหนี้สะท้อนเงินที่รับจริงทันที (เดิม cash understated / 11-2103 overstated จนปิดงวด) | ☐ |
| 3 | **ส่วนเกิน (over-collection) PaySolutions → park เป็นเงินรับล่วงหน้าอัตโนมัติ** (เจ้าของเคาะ 2026-06-09) — ลง JE `Dr 11-1202 / Cr 21-1103` + เพิ่ม `contract.advanceBalance` ในธุรกรรมเดียวกัน เงินที่ park ถูกนำไปหักงวดถัดไปอัตโนมัติได้ | Dr 11-1202 / Cr 21-1103 (เงินรับล่วงหน้า) | เงินรับเกินไม่หาย ลงบัญชีเป็นเงินรับล่วงหน้าทันที (✅ เจ้าของเลือกแล้ว — ขอบัญชียืนยัน treatment) | ☑ เจ้าของเลือก |
| 4 | **การยกเลิกใบเสร็จ / คืนเงิน reverse JE ทุกใบของงวดนั้น** (เดิม reverse ใบเดียว) | กลับ Dr/Cr ของทุก receipt JE ของ payment นั้น | งวดที่จ่ายหลายครั้งต้อง reverse เต็มจำนวน ไม่งั้น 11-2103 ค้างไม่มี credit note | ☐ |
| 5 | **ใช้เครดิตคงเหลือ: แยกค่าปรับเป็น 42-1103** (เดิมรวมในการล้าง 11-2103) + ลง JE ตอนใช้เครดิตบางส่วนด้วย | Dr 21-5101 (ยอดเดิมไม่เปลี่ยน) / Cr 11-2103 + Cr 42-1103 | ค่าปรับที่จ่ายด้วยเครดิตก็เป็นรายได้ 42-1103 | ☐ |
| 6 | **ปัดเศษระบบ ≤1฿ (งวดสุดท้าย amountDue < installmentTotal) → 52-1104 อัตโนมัติ ไม่ต้องผู้อนุมัติ** เฉพาะกรณีลูกค้าจ่ายครบยอดที่ออกบิล (ช่องทางอัตโนมัติ + จ่ายเต็ม) — เจ้าของเคาะ 2026-06-09 (auto-approve) | Dr 52-1104 (≤1฿) | เป็นเศษปัดของระบบ (ฐาน amountDue ≠ installmentTotal) ไม่ใช่ลูกค้าจ่ายขาด — **การจ่ายขาดจริงของลูกค้ายังต้องมีผู้อนุมัติเหมือนเดิม** (✅ เจ้าของเลือกแล้ว — ขอบัญชียืนยัน) | ☑ เจ้าของเลือก |
| 7 | **VAT 60 วัน: กลับรายการตอนรับชำระ** รวมการรับบางส่วน (จัดสรรอัตโนมัติ) | กลับ Vat60dayMandatory JE | เงินสดที่รับลดยอดค้างเกิน 60 วัน — สอดคล้อง recordPayment เดิม | ☐ |

---

| 8 | **เงินรับเกินฝั่ง autoAllocate/POS (คนละวงจรกับข้อ 3) → `Dr cash / Cr 21-5101` + `contract.creditBalance`** (มีอยู่เดิม ไม่ใช่ของใหม่ — แต่เปิดเผยให้ครบ: ระบบมี 2 วงจรเงินรับเกิน) | Dr cash / Cr 21-5101 (เงินเกินของลูกค้า) | autoAllocate ที่รับเกินเก็บเป็น `creditBalance` (21-5101) → ปลดด้วย applyCreditBalance (ข้อ 5). ส่วน PaySolutions QR ใช้ advanceBalance (21-1103, ข้อ 3) — คนละบัญชี คนละ field โดยตั้งใจ | ☐ |

## งานปฏิบัติการก่อน deploy (operational gates — ไม่ใช่บัญชี แต่ต้องทำ)
- [ ] **ยืนยันบัญชีในผัง prod ครบทุกโค้ดที่ JE ใหม่อ้าง** (ไม่ใช่แค่ 21-5101). รัน `npm run seed:coa` (upsert ไม่ทำลายข้อมูล) แล้วตรวจ:
  ```sql
  -- chart_of_accounts ใช้ camelCase "deletedAt"; payments/journal_entries ใช้ snake_case (mixed-case prod)
  SELECT code FROM chart_of_accounts WHERE "deletedAt" IS NULL AND code IN
   ('11-2103','42-1103','52-1104','53-1503','21-1103','21-5101','11-1202',
    '11-1101','11-1102','11-1103','11-1201','11-1203') ORDER BY code;
  -- คาดหวัง: ครบทุกแถว. ขาดตัวใด → template throw 'Account code not found' → post ไม่ได้
  ```
- [ ] รัน query (read-only) นับงวดที่ค้าง partial โดยยังไม่มี receipt JE ก่อน deploy — ถ้า > 0 ต้อง backfill JE ตามจ่ายก่อน (กัน reconstructPrior=0 → over-credit):
  ```sql
  SELECT COUNT(*) FROM payments p WHERE p.deleted_at IS NULL
    AND p.status='PARTIALLY_PAID' AND p.amount_paid>0
    AND NOT EXISTS (SELECT 1 FROM journal_entries je
      WHERE (je.reference_id=p.id::text OR je.metadata->>'paymentId'=p.id::text)
        AND je.metadata->>'tag' IN ('receipt','2B','credit-allocation') AND je.deleted_at IS NULL AND je.status='POSTED');
  ```

## หลัง sign-off
- merge stack #1199 → main (auto-deploy). **2B template ลบไปแล้ว (5d)** — ทั้ง 4 path ใช้ `PaymentReceiptTemplate` ตัวเดียว · งาน defer ที่เหลือ: hardening instSched-null (โยง #1170)

---
**ผู้ขออนุมัติ:** _____________ วันที่ ______
**เจ้าของยืนยัน treatment (waive CPA):** ☑ akenarin (OWNER) — 2026-06-09
**ฝ่ายบัญชี/CPA รับรอง (ภายหลัง, แนะนำ #3/#6):** ☑ ฝ่ายบัญชี (ร่วมกับเจ้าของ) — **2026-06-11 ยืนยันถูกต้องทั้ง #3 (เงินรับเกิน QR → 21-1103 เงินรับล่วงหน้า) และ #6 (ปัดเศษระบบ ≤1฿ งวดสุดท้าย → 52-1104 auto-approve; การจ่ายขาดจริงของลูกค้ายังต้องผู้อนุมัติ)**

> **สถานะ implementation (2026-06-11):** treatment ทั้งหมดนี้ **implement + deploy ไปแล้ว** ผ่าน PR-843/I2 epic (Phase 3 3b `d72b8b16` wire QR onto PaymentReceiptTemplate · #3 over-collection→21-1103 `762e274c` · #6 auto-approve ≤1฿ `a7f47eb5`) — ไม่ใช่งานค้าง. การเซ็นนี้คือการรับรองย้อนหลังของ treatment ที่ deploy แล้ว (เดิม deploy บน owner waiver). spec `PAYSOLUTIONS_I2_FIX_DESIGN.md` stale (เขียน "NOT IMPLEMENTED") — ความจริงคือ defect 1-4 แก้ครบ, `TODO(PR-843/I2)` lock หายแล้ว, callback-money.spec assert พฤติกรรมถูก (delta ไม่ใช่ cumulative · partial ledgered · late fee→42-1103). gate เขียว: refunds 47 + paysolutions callback-money + accounting.pl-expense 7.
