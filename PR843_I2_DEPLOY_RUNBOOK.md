# PR-843/I2 — Deploy Runbook (สำหรับ owner รันบน prod)

> โค้ดเสร็จ + verified บน branch `feat/payment-receipt-primitive` / PR #1199 (draft). main **auto-deploy ขึ้น prod ทันทีเมื่อ merge** — ทำตามลำดับนี้เท่านั้น
>
> **ผม (agent) รันให้ไม่ได้:** ผมมีแค่ DB dev (localhost); prod = GCP Cloud SQL (ไม่มี credential). คำสั่งด้านล่างต้องรันด้วยสิทธิ์ owner ผ่าน Cloud Run Job / gcloud

## ลำดับ (ห้ามข้าม)

### ① ก่อน merge — gate ที่ต้องผ่าน
1. **นักบัญชีเซ็น** [PR843_I2_ACCOUNTANT_SIGNOFF.md](PR843_I2_ACCOUNTANT_SIGNOFF.md) (7 ข้อ treatment) — ตัว gate หลัก
2. **ยืนยันบัญชีในผัง prod ครบทุกโค้ดที่ JE ใหม่อ้าง** (ไม่ใช่แค่ 21-5101 — ขาดตัวใด template throw 'Account code not found' → post ไม่ได้). seed upsert ไม่ทำลายข้อมูล:
   ```bash
   # Cloud Run Job (image build แล้ว) ชี้ DATABASE_URL=prod:
   npm run seed:coa          # = node dist/src/cli/seed-coa.cli.js (idempotent upsert ผัง FINANCE+SHOP)
   # ตรวจครบทุกโค้ด:
   psql "$PROD_DATABASE_URL" -tc "SELECT code FROM chart_of_accounts WHERE deleted_at IS NULL AND code IN ('11-2103','42-1103','52-1104','53-1503','21-1103','21-5101','11-1202','11-1101','11-1102','11-1103','11-1201','11-1203') ORDER BY code;"
   # คาดหวัง: ครบ 12 แถว
   ```
3. **นับ Risk-5** (งวด partial ที่ค้างโดยยังไม่มี receipt JE — read-only):
   ```sql
   SELECT COUNT(*) FROM payments p WHERE p.deleted_at IS NULL
     AND p.status='PARTIALLY_PAID' AND p.amount_paid>0
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
       WHERE (je.reference_id=p.id::text OR je.metadata->>'paymentId'=p.id::text)
         AND je.metadata->>'tag' IN ('receipt','2B','credit-allocation') AND je.deleted_at IS NULL AND je.status='POSTED');
   ```
   - **= 0** → ผ่าน ไป ②
   - **> 0** → งวดเหล่านี้ถูกจ่ายบางส่วนผ่าน autoAllocate เดิม (ไม่เคยลง JE) → ถ้าปล่อยไว้ การปิดงวดครั้งถัดไปจะ over-credit 11-2103. ต้อง **backfill JE ตามจ่าย** (Dr cash / Cr 11-2103 ตามยอด amount_paid ของแต่ละงวด) ก่อน deploy — แจ้งผมมาพร้อมจำนวน เดี๋ยวเขียน CLI backfill ให้

### ② Merge → deploy (หลัง ① ผ่านครบ)
```bash
gh pr ready 1199                 # un-draft
gh pr merge 1199 --merge         # ใช้ merge-commit เก็บประวัติราย PR (3.0→...→5d); auto-deploy เริ่ม
```

### ③ หลัง deploy — smoke test
- รับชำระ 1 รายการจริงผ่าน UI → ตรวจว่า JE มี `metadata.tag='receipt'`, Dr cash / Cr 11-2103 ตาม delta
- ปิดงวดที่เคยจ่ายบางส่วน 1 งวด → ยืนยันไม่ throw + Σ(Cr 11-2103) = installmentTotal
- รัน Trial Balance (`scope=FINANCE`) → balanced
- ตรวจ over-collection 1 รายการ (ถ้ามี) → ลง Cr 21-1103 + advanceBalance เพิ่ม

## งานตามหลัง (ไม่บล็อก deploy)
- **5e** instSched-null hardening → รวมกับ #1170 (lazy-gen schedule) ตอน merge #1170
- ตรวจ comment ค้างที่เอ่ยถึง 2B (prose เฉยๆ ไม่กระทบโค้ด)

---
> **2B template ลบหมดแล้ว** (5d) — ทั้ง 4 path ใช้ `PaymentReceiptTemplate` ตัวเดียว
