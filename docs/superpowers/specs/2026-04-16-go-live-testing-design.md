# Go-Live Testing Plan — BESTCHOICE

**วันที่**: 2026-04-16
**สถานะ**: Production deployed (Cloud Run + Firebase), ยังไม่เปิดให้ลูกค้าใช้
**Production DB**: มี seed/test data — ลบได้หมด

---

## สรุปแผน

เทสทั้งระบบ 4 Phases ตามลำดับ dependency:

| Phase | เป้าหมาย | ใครทำ |
|-------|---------|-------|
| 1. Infrastructure & Security | ยืนยัน production environment พร้อม | Claude + เจ้าของ |
| 2. Integrations | ต่อระบบภายนอกทุกตัว ยืนยันทำงานจริง | Claude + เจ้าของ |
| 3. Core Business Flows | เทสทุก business flow ด้วยข้อมูลจริง | แนน |
| 4. Role-based UAT | พนักงานแต่ละ role เทสส่วนที่ใช้จริง | แนน + กวาง + ตุ๊กตา |

---

## Task Assignment

### ทีมเทส

| คน | Role | หน้าที่เทส |
|----|------|-----------|
| **เจ้าของ** | - | ตั้งค่าระบบ + ต่อ integrations + GCP + สร้าง accounts + เพิ่มสินค้า |
| **แนน** (หัวหน้า) | OWNER | เทส core flows + ตรวจรวมหลังกวาง/ตุ๊กตาเทส |
| **กวาง** | OWNER | เทส flow (ขายเงินสด, ผ่อน, ชำระ manual, trade-in, รายงาน) |
| **ตุ๊กตา** | OWNER | เทส flow (ขายเงินสด, ผ่อน, ชำระ QR, ขายมือสอง, เอกสาร) |

**หมายเหตุ**: ปัจจุบันมีสาขาเดียว — เจ้าของตั้งค่าสาขา/บริษัทเอง

### Accounts ที่ต้องสร้าง

| คน | Role | Email |
|----|------|-------|
| แนน | OWNER | (email จริง) |
| กวาง | OWNER | (email จริง) |
| ตุ๊กตา | OWNER | (email จริง) |

---

## Phase 1 — Infrastructure & Security (Claude + เจ้าของ)

### 1.1 Database

#### 1.1.1 ตรวจ Migrations
- ตรวจ Cloud Run Job `bestchoice-migrate` logs → migration ล่าสุดที่ apply
- เทียบกับ `apps/api/prisma/migrations/` → นับ pending
- ถ้ามี pending → trigger CI deploy หรือรัน `prisma migrate deploy` ผ่าน Cloud Run Job
- **Pass criteria**: `prisma migrate status` แสดง 0 pending

#### 1.1.2 Reset ข้อมูล Production DB
- ลบ demo data ทั้งหมด (customers, contracts, payments, products, suppliers, sales, test users)
- Seed ใหม่เฉพาะ master data:
  - CompanyInfo 2 รายการ (SHOP + FINANCE)
  - Branches 4 สาขา
  - Chart of Accounts (PEAK format)
  - SystemConfig 22 รายการ
  - Bad debt provision rates
- สร้าง production seed script แยกจาก dev seed
- **Pass criteria**: login ได้ → dashboard ว่าง → chart of accounts ครบ

#### 1.1.3 ตรวจ Cloud SQL Backup
- เปิด GCP Console → Cloud SQL → instance → Backups
- ตรวจ:
  - Automated backups: Enabled
  - Point-in-time recovery: Enabled
  - Backup retention: >= 7 วัน
  - Backup location: asia-southeast1
- **Pass criteria**: เห็น backup ล่าสุดไม่เกิน 24 ชม.

#### 1.1.4 ใส่ Production Guard บน seed.ts
- เพิ่มที่บรรทัดแรกของ `main()`:
  ```ts
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot run seed in production');
  }
  ```
- Deploy ใหม่
- **Pass criteria**: `NODE_ENV=production npx prisma db seed` → error

### 1.2 Security

#### 1.2.1 ตรวจ Secrets ใน GCP Secret Manager
ตรวจทั้ง 17 secrets:

| Secret | ตรวจอะไร |
|--------|---------|
| `JWT_SECRET` | random >= 32 chars, ไม่ใช่ dev default |
| `JWT_REFRESH_SECRET` | คนละค่ากับ JWT_SECRET |
| `ENCRYPTION_KEY` | 32-byte AES key |
| `DATABASE_URL` | ชี้ production Cloud SQL |
| `PAYSOLUTIONS_SECRET_KEY` | production key (ไม่ใช่ sandbox) |
| `PAYSOLUTIONS_API_KEY` | production key |
| `LINE_CHANNEL_ACCESS_TOKEN` | Shop OA production token |
| `LINE_CHANNEL_SECRET` | ตรงกับ Shop OA |
| `LINE_FINANCE_CHANNEL_ACCESS_TOKEN` | Finance OA production token |
| `LINE_FINANCE_CHANNEL_SECRET` | ตรงกับ Finance OA |
| `LINE_LOGIN_CHANNEL_SECRET` | ตรงกับ LIFF channel |
| `SMS_API_KEY` | ThaiBulkSMS production key |
| `SMS_API_SECRET` | production key |
| `SMTP_PASS` | Resend API key จริง |
| `S3_ACCESS_KEY` | production key (ถ้าใช้ S3, ไม่ต้องถ้าใช้ GCS) |
| `S3_SECRET_KEY` | production key |
| `ANTHROPIC_API_KEY` | Claude AI key |

- **Pass criteria**: ทุก secret มีค่า, ไม่มี dev default

#### 1.2.2 สร้าง User Accounts จริง
- ลบ test accounts ทั้ง 9 คน
- สร้าง accounts ตามตาราง Task Assignment ด้านบน
- ทุก account ใช้ email จริง + รหัสผ่าน strong
- **Pass criteria**: ทุกคน login ได้ + เข้าถึงเฉพาะหน้าที่ role อนุญาต

#### 1.2.3 ตรวจ CORS
```bash
# ต้อง reject
curl -H "Origin: https://evil.com" -I https://api.bestchoicephone.app/api/health
# → ไม่มี Access-Control-Allow-Origin header

# ต้อง allow
curl -H "Origin: https://bestchoicephone.app" -I https://api.bestchoicephone.app/api/health
# → Access-Control-Allow-Origin: https://bestchoicephone.app
```
- **Pass criteria**: เฉพาะ domain ที่อนุญาตได้ CORS header

#### 1.2.4 ตรวจ Health Endpoint
```bash
curl https://api.bestchoicephone.app/api/health
```
- **Pass criteria**: `{ "status": "ok", "checks": { "database": "ok" } }`

#### 1.2.5 ตรวจ Account Lockout
- ใส่ email ถูก + รหัสผิด 5 ครั้งติด
- ครั้งที่ 6 → "บัญชีถูกล็อค"
- รอ 15 นาที → login รหัสถูก → เข้าได้
- **Pass criteria**: lockout ทำงาน + unlock หลัง 15 นาที

#### 1.2.6 ตรวจ Rate Limiting
- ยิง login endpoint 11 ครั้งใน 1 นาที
- ครั้งที่ 11 → 429 Too Many Requests
- **Pass criteria**: rate limit ทำงาน

### 1.3 Monitoring

#### 1.3.1 ตรวจ Sentry
- ตรวจ `SENTRY_DSN` + `VITE_SENTRY_DSN` ตั้งค่าแล้ว
- ทำให้เกิด error จริง → เปิด Sentry dashboard → เห็น event
- ตรวจ user tagging (event มี user email)
- **Pass criteria**: Sentry จับ error ได้ทั้ง frontend + backend

#### 1.3.2 ตรวจ System Status
- Login OWNER → `/system-status`
- ตรวจทุก service: Database, Storage, LINE, PaySolutions, SMS, SMTP, Sentry
- **Pass criteria**: เห็นสถานะทุก service

### 1.4 Code Fixes

#### 1.4.1 seed.ts — ใส่ production guard
- เพิ่ม `NODE_ENV` check ที่ต้น `main()`
- Deploy

#### 1.4.2 LiffTokenGuard — ลบ hardcoded fallback
- ลบ fallback `'2009442540'` ที่ line 35
- ถ้าไม่มี `LIFF_CHANNEL_ID` → throw error
- Deploy

#### 1.4.3 CSRF double-submit (optional)
- ปัจจุบัน log-only → เปิด production ด้วย log-only ก่อน
- ดู logs 1 สัปดาห์ → ถ้าไม่มี false positive → เปิด enforce

---

## Phase 2 — Integrations Testing (Claude + เจ้าของ)

### 2.1 Storage (GCS)

#### 2.1.1 ตรวจ GCS Bucket
- GCP Console → Cloud Storage → `bestchoice-documents`
- Region: asia-southeast1, Cloud Run SA มี `Storage Object Admin`
- **Pass criteria**: bucket มี + IAM ถูก

#### 2.1.2 เทสอัพโหลด
- สร้างลูกค้าใหม่ → อัพโหลดรูปบัตร ปชช. (รูปทดสอบ)
- ตรวจรูปแสดงได้ + file อยู่ใน GCS bucket
- **Pass criteria**: upload + download + แสดงผลได้

#### 2.1.3 เทส File Types
- อัพโหลด JPG, PNG, PDF + file ใหญ่ 5MB+
- **Pass criteria**: ทุก type ทำงาน, ไม่ timeout

### 2.2 LINE OA — Shop Channel

#### 2.2.1 ตั้งค่า
- `/settings/integrations` หรือ `/settings/line-oa`
- ใส่ Channel Access Token + Secret → Test Connection
- **Pass criteria**: "เชื่อมต่อสำเร็จ" + แสดง Bot name

#### 2.2.2 ตั้ง Webhook
- LINE Developers → Shop OA → Webhook URL: `https://api.bestchoicephone.app/api/line-oa/webhook`
- Use webhook = ON → Verify → Success
- **Pass criteria**: LINE verify สำเร็จ

#### 2.2.3 เทสส่ง Message
- ส่งข้อความทดสอบจากระบบ → ได้รับบน LINE app
- **Pass criteria**: ลูกค้าได้รับ LINE message

#### 2.2.4 เทสรับ Message (Webhook)
- ส่งข้อความจาก LINE app ไปหา Shop OA
- ดู Cloud Run logs → เห็น webhook event
- **Pass criteria**: inbound webhook ทำงาน

### 2.3 LINE OA — Finance Channel

#### 2.3.1 ตั้งค่า
- ใช้ Finance OA credentials
- Webhook URL: `https://api.bestchoicephone.app/api/chatbot-finance/webhook`
- **Pass criteria**: connection test + webhook verify สำเร็จ

#### 2.3.2 เทส Finance Chatbot
- ส่ง "ตรวจสอบยอด" จาก LINE → chatbot ตอบกลับ
- **Pass criteria**: chatbot ตอบได้ ไม่ error

### 2.4 LINE LIFF

#### 2.4.1 ตรวจ Config
- LINE Developers → LIFF channel:
  - Endpoint URL ถูก
  - Scope: profile, openid
  - Bot link: ON
- `VITE_LIFF_ID` ตรงกับ LIFF App ID
- `LIFF_CHANNEL_ID` ตรงกับ LINE Login Channel ID

#### 2.4.2 เทส LIFF บนมือถือ
- เปิด `https://liff.line.me/{LIFF_ID}` จาก LINE app
- เทสทุกหน้า: `/liff/contract`, `/liff/history`, `/liff/profile`, `/liff/receipts`
- **Pass criteria**: ทุกหน้าเปิดได้ + auto-login ด้วย LINE profile

### 2.5 PaySolutions

#### 2.5.1 ตั้งค่า
- `/settings/integrations` → PaySolutions → ใส่ credentials → Test Connection
- **Pass criteria**: "เชื่อมต่อสำเร็จ"

#### 2.5.2 ตั้ง Webhook URL
- PaySolutions dashboard → Postback URL: `https://api.bestchoicephone.app/api/paysolutions/webhook`
- **Pass criteria**: บันทึกสำเร็จ

#### 2.5.3 เทส Payment Flow (ทำใน Phase 3)
- สร้างสัญญา → payment link → QR → สแกนจ่ายจริง
- ตรวจ: payment link = USED, payment record สร้าง, journal ถูก, LINE แจ้งเตือน
- **Pass criteria**: end-to-end payment ทำงาน

#### 2.5.4 เทส Webhook Idempotency
- ยิง webhook ซ้ำหลังชำระ → ไม่ double-credit
- **Pass criteria**: payment ไม่ซ้ำ

### 2.6 SMS (ThaiBulkSMS)

#### 2.6.1 ตั้งค่า
- `/settings/integrations` → SMS → ใส่ credentials → Test Connection
- **Pass criteria**: test ผ่าน

#### 2.6.2 เทสส่ง SMS
- สร้างลูกค้ามีเบอร์จริง → trigger notification
- **Pass criteria**: SMS ส่งถึงมือถือ

### 2.7 Email (SMTP/Resend)

#### 2.7.1 ตรวจ Config
- `SMTP_PASS` ตั้งใน Secret Manager
- Domain `bestchoicephone.app` verify บน Resend

#### 2.7.2 เทสส่ง Email
- Forgot password → ใส่ email จริง → email มาถึง inbox
- **Pass criteria**: email ส่งถึง + link ใช้ได้

### 2.8 MDM (PJ-Soft)

#### 2.8.1 ตั้งค่า
- `/settings/integrations` → MDM → ใส่ credentials → Test Connection
- **Pass criteria**: test ผ่าน

#### 2.8.2 เทส Lock/Unlock
- สร้างสัญญากับ IMEI จริง → ล็อค → ตรวจเครื่องถูกล็อค → ปลดล็อค
- **Pass criteria**: lock/unlock ทำงานจริง

### 2.9 PEAK (Accounting)

#### 2.9.1 ตั้งค่า
- `/settings/integrations` → PEAK → ใส่ credentials → Test Connection
- **Pass criteria**: test ผ่าน

#### 2.9.2 เทส Sync
- ตรวจ journal sync ไป PEAK
- **Pass criteria**: PEAK เห็น transaction

---

## Phase 3 — Core Business Flows (แนน)

### 3.1 Master Data Setup

#### 3.1.1 ตั้งค่าบริษัท
- `/settings` → Company Settings
- ใส่: ชื่อบริษัท, เลขผู้เสียภาษี, ที่อยู่, กรรมการ, ธนาคาร
- **Pass criteria**: ข้อมูลครบ ใช้ออกเอกสารได้

#### 3.1.2 สร้าง/ตรวจ Branch
- `/branches` → สร้างสาขาจริง (ปัจจุบันมี 1 สาขา) ข้อมูลตรงจริง
- **Pass criteria**: สาขาถูกต้อง

#### 3.1.3 ตรวจ Chart of Accounts
- `/financial-audit` → ตรวจ 11-xxxx ถึง 51-xxxx ครบ
- **Pass criteria**: ตรงกับ PEAK

#### 3.1.4 ตั้งค่าระบบ
- `/settings` → General: ค่าปรับ, ดอกเบี้ย, ดาวน์ขั้นต่ำ, งวดสูงสุด, overdue days, prefixes
- **Pass criteria**: ตรงกับนโยบายจริง

#### 3.1.5 เพิ่ม Suppliers
- `/suppliers` → สร้างอย่างน้อย 1 ราย (ชื่อ, VAT, วิธีชำระ)
- **Pass criteria**: supplier ปรากฏ

#### 3.1.6 เพิ่มสินค้าเข้าสต็อก
- `/purchase-orders` → สร้าง PO อย่างน้อย 3 items:
  - 1 เครื่องใหม่ (IMEI)
  - 1 มือสอง
  - 1 อุปกรณ์เสริม
- รับเข้าสต็อก → `/stock` แสดงครบ
- **Pass criteria**: สต็อกตรง

### 3.2 ขายเงินสด

#### 3.2.1 สร้างลูกค้า
- `/customers` → สร้างใหม่ + อัพโหลดรูปบัตร
- **Pass criteria**: ลูกค้าปรากฏ + รูปแสดงได้

#### 3.2.2 ขายผ่าน POS
- `/pos` → เลือกลูกค้า → เลือกสินค้า → ชำระเงินสด
- **Pass criteria**: sale record สร้างสำเร็จ

#### 3.2.3 ตรวจผลหลังขาย
| ตรวจ | ที่ไหน | คาดหวัง |
|------|--------|---------|
| สต็อกลด | `/stock` | สินค้าหายจากสต็อก |
| รายการขาย | `/sales` | เห็น sale record |
| Journal | `/financial-audit` | Dr. Cash, Cr. Revenue + COGS entries |
| ใบเสร็จ | `/receipts` | สร้างอัตโนมัติ + พิมพ์ได้ |
| Dashboard | `/` | ยอดขายเพิ่ม |

### 3.3 ขายผ่อน

#### 3.3.1 สร้างสัญญา
- `/pos` → ผ่อน → ดาวน์ 20% → 6 งวด → ตรวจคำนวณ → ยืนยัน
- **Pass criteria**: สัญญาสร้างสำเร็จ

#### 3.3.2 ตรวจการคำนวณ (เทียบเครื่องคิดเลข)
| รายการ | สูตร |
|--------|------|
| ยอดจัดไฟแนนซ์ | ราคาขาย - เงินดาวน์ |
| ดอกเบี้ย (flat) | ยอดจัด x อัตรา% x เดือน |
| ค่าคอม | ยอดจัด x %คอม |
| VAT 7% | (เงินต้น + ดอกเบี้ย + คอม) x 7% |
| ค่างวด/เดือน | รวมทั้งหมด / จำนวนงวด |

#### 3.3.3 ตรวจผลหลังสร้างสัญญา
| ตรวจ | คาดหวัง |
|------|---------|
| `/contracts` | สถานะ ACTIVE |
| `/stock` | สินค้าผูกสัญญา |
| กรรมสิทธิ์ | `ownedByCompanyId` = FINANCE |
| Journal | Dr. HP Receivable / Cr. Revenue + VAT + Inventory |
| ดาวน์ | payment record |
| ตารางผ่อน | schedule ทุกงวด |
| Inter-company | FINANCE จ่าย SHOP |

#### 3.3.4 เซ็นสัญญา
- `/contracts/{id}/sign` → ลงนาม → PDF สร้างได้
- **Pass criteria**: สัญญามีลายเซ็น + PDF ถูก

### 3.4 รับชำระค่างวด

#### 3.4.1 รับชำระ Manual
- เปิดสัญญา → รับชำระงวด 1 → บันทึก
- ตรวจ: payment PAID, งวด 1 mark ชำระแล้ว, journal Dr. Cash / Cr. HP Receivable + Commission + VAT
- **Pass criteria**: payment + journal ถูก

#### 3.4.2 รับชำระผ่าน PaySolutions QR
- สร้าง payment link งวด 2 → สแกน QR จ่ายจริง
- ตรวจ: webhook → USED → payment auto → journal auto → LINE แจ้งเตือน
- **Pass criteria**: end-to-end อัตโนมัติ

#### 3.4.3 รับชำระผ่าน LIFF
- เปิด LIFF URL → ดูสัญญา → กดชำระ → redirect PaySolutions
- **Pass criteria**: ลูกค้าชำระผ่าน LIFF ได้

#### 3.4.4 นำเข้า CSV
- `/payments/import-csv` → อัพโหลด CSV
- **Pass criteria**: import สำเร็จ

### 3.5 ค้างชำระ & Dunning

#### 3.5.1 จำลองค้างชำระ
- ปรับวันครบกำหนดใน DB ให้เลยกำหนด (หรือรอ cron)
- ตรวจ: `/overdue` แสดง, ค่าปรับถูก, สถานะ OVERDUE
- **Pass criteria**: overdue detection ทำงาน

#### 3.5.2 ตรวจ Dunning Automation
- Cron รัน → LINE แจ้งเตือนวัน 1, 3, 7 → SMS → แจ้ง manager
- ดู Cloud Run logs
- **Pass criteria**: dunning escalation ทำงาน

#### 3.5.3 ตรวจ MDM Auto-lock
- Overdue ถึง threshold → cron ล็อคเครื่อง
- **Pass criteria**: เครื่องถูกล็อคจริง

### 3.6 Trade-in

#### 3.6.1 สร้าง Trade-in
- `/trade-in` → รับซื้อ → ตรวจสภาพ → ตีราคา → จ่ายเงินสด
- ตรวจ: สต็อกมือสองเพิ่ม, Journal Dr. Inventory Used / Cr. Cash
- **Pass criteria**: สต็อก + บัญชีถูก

#### 3.6.2 ขายมือสองต่อ
- POS → ขายมือสอง → Revenue account = 41-1102
- **Pass criteria**: journal ลง account ถูก

### 3.7 Commission
- `/commissions` → ตรวจ commission พนักงานถูก + %ตรง
- **Pass criteria**: คำนวณถูก แสดงถูกคน

### 3.8 Reports & Tax

#### 3.8.1 Dashboard
- KPI: ยอดขาย, สัญญาใหม่, ยอดค้าง → ตรงกับข้อมูลที่ทำ
- **Pass criteria**: Dashboard สะท้อนข้อมูลจริง

#### 3.8.2 Tax Report
- `/tax-reports` → VAT Output จาก FINANCE เท่านั้น, SHOP ไม่มี VAT
- **Pass criteria**: VAT ถูก entity

#### 3.8.3 Financial Audit
- `/financial-audit` → Trial Balance Dr. = Cr. → ทุก journal balanced
- **Pass criteria**: สมดุล ไม่มี unbalanced

### 3.9 เอกสาร

#### 3.9.1 พิมพ์สัญญา PDF
- ข้อมูลบริษัท ลูกค้า สินค้า ค่างวด ลายเซ็น ถูก
#### 3.9.2 พิมพ์ใบเสร็จ
- เลขใบเสร็จ จำนวนเงิน VAT ข้อมูลบริษัท ถูก
#### 3.9.3 สติ๊กเกอร์ราคา
- `/stickers` → สร้าง + พิมพ์ ข้อมูลถูก

---

## Phase 4 — UAT ทีม (แนน + กวาง + ตุ๊กตา — ทุกคน OWNER)

ทั้ง 3 คนเทส flow เดียวกัน แต่แบ่งงานไม่ให้ซ้ำ — เพื่อเทสทั่วถึงและเจอ bug จากมุมต่างกัน

### 4.1 งานของ แนน (ตั้งค่า + ตรวจรวม)

**ก่อนให้กวาง+ตุ๊กตาเริ่ม แนนต้องทำก่อน:**
- [ ] ตั้งค่าบริษัท `/settings` → ข้อมูลจริงครบ
- [ ] สร้าง/ตรวจสาขา `/branches`
- [ ] ตั้งค่า integrations ทั้งหมด (LINE, PaySolutions, SMS, MDM, PEAK)
- [ ] สร้าง account ให้กวาง + ตุ๊กตา (OWNER)
- [ ] เพิ่ม supplier อย่างน้อย 1 ราย
- [ ] สร้าง PO + รับสินค้าเข้าสต็อก อย่างน้อย 5 ชิ้น (ให้มีพอเทส)

**หลังกวาง+ตุ๊กตาเทสเสร็จ:**
- [ ] ตรวจ audit logs → เห็น action ของกวาง+ตุ๊กตา ถูกคน ถูกเวลา
- [ ] ตรวจ Dashboard KPI → ยอดขายรวมตรงกับที่กวาง+ตุ๊กตาทำ
- [ ] ตรวจ Trial Balance → Dr. = Cr. (สมดุลหลังทุกคนทำรายการ)
- [ ] ตรวจ Tax Report → VAT ถูก entity (FINANCE only)
- [ ] ตรวจ Commission → คำนวณถูกต้อง
- [ ] ตรวจ `/system-status` → ทุก service OK
- [ ] ตรวจ Sentry → ไม่มี unexpected errors
- [ ] ตรวจ `/notifications` → แสดงถูก

---

### 4.2 งานของ กวาง

**ขายเงินสด (ทำ 1 รายการ)**
- [ ] Login ได้
- [ ] `/customers` → สร้างลูกค้าใหม่ + อัพโหลดรูปบัตร ปชช.
- [ ] `/pos` → เลือกลูกค้า → เลือกสินค้า → ขายเงินสด
- [ ] ตรวจ `/sales` → เห็น sale record
- [ ] ตรวจ `/stock` → สินค้าหายจากสต็อก
- [ ] ตรวจ `/receipts` → ใบเสร็จสร้างอัตโนมัติ → พิมพ์ได้ → ข้อมูลถูก
- [ ] ตรวจ `/financial-audit` → journal Dr. Cash / Cr. Revenue ถูก

**ขายผ่อน (ทำ 1 รายการ)**
- [ ] `/pos` → สร้างลูกค้าใหม่ → เลือกสินค้า → เลือกผ่อน
- [ ] กรอกดาวน์ + จำนวนงวด → ตรวจตัวเลขคำนวณถูก (เทียบเครื่องคิดเลข)
- [ ] ยืนยัน → สัญญาสร้างสำเร็จ
- [ ] ตรวจ `/contracts` → สถานะ ACTIVE + ตารางผ่อนครบ
- [ ] ตรวจ journal → Dr. HP Receivable / Cr. Revenue + VAT
- [ ] เซ็นสัญญา `/contracts/{id}/sign` → PDF สร้างได้ → ข้อมูลถูก

**รับชำระค่างวด (Manual)**
- [ ] เปิดสัญญาที่สร้าง → กดรับชำระงวด 1
- [ ] ใส่จำนวนเงิน → บันทึก
- [ ] ตรวจ payment = PAID + งวด 1 mark ชำระแล้ว
- [ ] ตรวจ journal → Dr. Cash / Cr. HP Receivable + Commission + VAT

**Trade-in (ทำ 1 รายการ)**
- [ ] `/trade-in` → สร้างรายการรับซื้อ
- [ ] ตรวจสภาพ → ตีราคา → ยืนยัน
- [ ] ตรวจ สต็อกมือสองเพิ่ม
- [ ] ตรวจ journal → Dr. Inventory Used / Cr. Cash

**รายงาน**
- [ ] Dashboard → KPI แสดงถูก
- [ ] `/tax-reports` → VAT ถูก
- [ ] `/financial-audit` → trial balance สมดุล

---

### 4.3 งานของ ตุ๊กตา

**ขายเงินสด (ทำ 1 รายการ — คนละสินค้ากับกวาง)**
- [ ] Login ได้
- [ ] `/customers` → สร้างลูกค้าใหม่ (คนละคนกับกวาง) + อัพโหลดรูป
- [ ] `/pos` → ขายเงินสด → สำเร็จ
- [ ] ตรวจ sales + stock + receipt + journal ถูก

**ขายผ่อน (ทำ 1 รายการ — คนละสินค้ากับกวาง)**
- [ ] `/pos` → สร้างลูกค้าใหม่ → ผ่อน → ดาวน์ + งวด
- [ ] ตรวจคำนวณถูก (เทียบเครื่องคิดเลข)
- [ ] สัญญา ACTIVE + ตารางผ่อนครบ
- [ ] journal ถูก
- [ ] เซ็นสัญญา + PDF ถูก

**รับชำระผ่าน PaySolutions QR (ถ้าต่อแล้ว)**
- [ ] สร้าง payment link สำหรับงวดแรก
- [ ] สแกน QR จ่ายจริงด้วย mobile banking
- [ ] ตรวจ: payment link = USED + payment auto + journal auto
- [ ] ตรวจ: ลูกค้าได้ LINE แจ้งเตือน (ถ้าต่อ LINE แล้ว)

**ขายมือสองต่อ (ถ้ากวางทำ trade-in แล้ว)**
- [ ] `/pos` → ขายสินค้ามือสองที่กวางรับซื้อ
- [ ] ตรวจ Revenue account = 41-1102 (ขายมือสอง)

**เอกสาร**
- [ ] พิมพ์สัญญา PDF → ข้อมูลบริษัท ลูกค้า สินค้า ถูก
- [ ] พิมพ์ใบเสร็จ → เลข + จำนวนเงิน + VAT ถูก
- [ ] `/stickers` → สร้างสติ๊กเกอร์ราคา → พิมพ์ได้

---

### 4.4 เทสร่วม (ทำหลังกวาง+ตุ๊กตาเสร็จ)

**ตรวจข้อมูลข้ามกัน**
- [ ] กวาง เห็นลูกค้า/สัญญา/sales ที่ตุ๊กตาสร้าง (ทั้งคู่เป็น OWNER เห็นหมด)
- [ ] ตุ๊กตา เห็นลูกค้า/สัญญา/sales ที่กวางสร้าง

**ตรวจความถูกต้องของข้อมูลรวม**
- [ ] แนน ตรวจยอดขายรวม = sales กวาง + sales ตุ๊กตา
- [ ] แนน ตรวจ trial balance สมดุลหลังทุกคนทำรายการเสร็จ

---

## Timeline

| วัน | ทำอะไร | ใคร |
|-----|--------|-----|
| 1 | Phase 1: Infra & Security + Code fixes | Claude + เจ้าของ |
| 2 | Phase 2: Integrations (แนนต่อเอง) | แนน |
| 3 | Phase 3: Core Business Flows (แนนเทสเอง) | แนน |
| 3 | Phase 4.1: แนนตั้งค่า + สร้าง account + เพิ่มสินค้า | แนน |
| 4 | Phase 4.2: กวางเทส | กวาง |
| 4 | Phase 4.3: ตุ๊กตาเทส | ตุ๊กตา |
| 4 | Phase 4.4: เทสร่วม + แนนตรวจรวม | แนน + กวาง + ตุ๊กตา |
| 5 | รวบรวม bugs → แก้ไข → เทสซ้ำ | Claude + เจ้าของ |
| 6 | Go-live: เปิดใช้งานจริง | ทุกคน |

---

## Bug Tracking

เมื่อเจอ bug ให้บันทึก:

| # | พบโดย | หน้า/Flow | อาการ | Severity | สถานะ |
|---|-------|----------|-------|----------|-------|
| 1 | | | | Critical/High/Medium/Low | Open/Fixed/Retest |

**Severity**:
- **Critical**: ใช้งานไม่ได้เลย, ข้อมูลผิด, เงินผิด
- **High**: feature หลักใช้ไม่ได้ แต่มี workaround
- **Medium**: UI ไม่สวย, UX ไม่ดี แต่ใช้งานได้
- **Low**: cosmetic, nice-to-have

**Rule**: Critical + High ต้องแก้ก่อน go-live, Medium/Low แก้ทีหลังได้
