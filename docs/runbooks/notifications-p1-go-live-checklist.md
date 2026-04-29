# Notifications P1 — Go-Live Checklist

**สถานะโค้ด:** Phase 1-7 เสร็จแล้ว (commit `f9ef7ef9` + earlier commits) — รอ user action

ก่อน merge + go-live ต้องทำ checklist นี้ให้ครบทุกข้อ

## ☐ Step 1 — Submit SMS Sender ID `BESTCHOICE` ที่ ThaiBulkSMS (3-7 วันทำการ)

**ทำก่อน Step อื่นๆ** — รอนานสุด

1. Login https://account.thaibulksms.com
2. Settings → Sender Names → **Add new**
3. กรอก:
   - Sender Name: `BESTCHOICE`
   - Sample message: `[BESTCHOICE] แจ้งเตือนชำระค่างวด งวดที่ 3 ครบกำหนด 5 พ.ค. 2569 ยอด 1,500 บาท`
   - Use case: `Installment payment reminders + collection notices for finance customers`
4. Submit
5. **บันทึกวันที่ submit** — ติดตามภายใน 7 วัน

ถ้า rejected: อ่านเหตุผล แก้ resubmit

ระหว่างรอ approve: ใช้ default sender ใน Integrations UI

## ☐ Step 2 — Setup credentials ทั้ง 4 integrations ใน Settings UI

Login admin → Settings → **Integrations**

### line-shop
- [ ] **channelToken** (long-lived) — จาก LINE Developers Console → channel → Messaging API → Issue
- [ ] **channelSecret** — จาก LINE Console → Basic settings
- [ ] **liffId** — จาก LIFF app
- [ ] กด **ทดสอบเชื่อมต่อ** → ต้อง pass

### line-finance (น้องเบส)
- [ ] **channelToken** — จาก LINE Console (channel ของน้องเบส)
- [ ] **channelSecret**
- [ ] **liffId** (VITE_LIFF_ID_FINANCE)
- [ ] กด **ทดสอบเชื่อมต่อ** → ต้อง pass

### line-staff
- [ ] **channelToken** — จาก LINE Console (channel ของพนักงาน)
- [ ] **channelSecret**
- [ ] **notifyTargets** — comma-separated user IDs ของ:
  - OWNER (ตัวเอง)
  - manager แต่ละสาขา (ถ้าต้องการ)
  - finance manager (สำหรับ default alert + SMS credit alert)
- [ ] กด **ทดสอบเชื่อมต่อ** → ต้อง pass

### sms (ThaiBulkSMS)
- [ ] **apiKey** — จาก ThaiBulkSMS Settings → API Setting
- [ ] **apiSecret** — เดียวกัน
- [ ] **sender** = `BESTCHOICE` (หลัง Step 1 approved) หรือ `default` ระหว่างรอ
- [ ] กด **ทดสอบ** → ต้อง pass

## ☐ Step 3 — ตั้ง Webhook URLs ที่ providers

### LINE Developers Console
สำหรับแต่ละ channel (line-shop, line-finance, line-staff):

- line-shop webhook URL: `https://<prod-domain>/api/line-oa/webhook`
- line-finance webhook URL: `https://<prod-domain>/api/chatbot/finance/webhook`
- line-staff webhook URL: `https://<prod-domain>/api/line-oa/webhook` (or staff-specific if exists)

ในแต่ละ channel:
- [ ] Webhook URL ตั้งแล้ว
- [ ] **Use webhook** = ON
- [ ] **Auto-reply messages** = OFF (เราจัดการเอง)
- [ ] Click **Verify** → return success

### ThaiBulkSMS dashboard
- [ ] DLR Webhook URL: `https://<prod-domain>/api/sms-webhook`
- [ ] กด save

## ☐ Step 4 — End-to-end test

### ทดสอบส่ง LINE จาก 3 OAs
1. Settings → LINE OA → **ส่งทดสอบ**
2. เลือก message type = `payment_reminder`
3. Recipient = LINE user ID ของตัวเอง (ที่ link เข้ากับ OA นั้นๆ)
4. ทดสอบทั้ง line-shop, line-finance, line-staff
5. ตรวจสอบ:
   - [ ] line-shop test → ได้รับใน SHOP OA
   - [ ] line-finance test → ได้รับใน น้องเบส OA
   - [ ] line-staff test → ได้รับใน STAFF OA

### ทดสอบ SMS
1. Settings → Integrations → SMS card → **ทดสอบ**
2. Recipient = เบอร์ตัวเอง
3. ตรวจสอบ:
   - [ ] ได้รับ SMS
   - [ ] DLR กลับมา → query: `SELECT delivery_status, delivered_at FROM notification_logs WHERE channel='SMS' ORDER BY created_at DESC LIMIT 1;`

### ตรวจสอบ stats UI
- [ ] เปิด `/notifications` → เห็น 3 cards (LINE / SMS / IN_APP)
- [ ] SMS card แสดง credit balance
- [ ] Test messages ที่ส่งไปเมื่อกี้ปรากฏใน stats

### ตรวจสอบ Integration Hub
- [ ] เปิด `/settings/integrations` → SMS card แสดง "เครดิตเหลือ X"
- [ ] ถ้า credit < 100 → แสดง "(ใกล้หมด)" สีแดง

## ☐ Step 5 — Soak test 24 ชม.

หลัง merge + deploy:

1. รอ cron payment-reminder รัน (08:00 ICT) — สังเกต:
   - [ ] Sentry ไม่มี error spike
   - [ ] `notification_logs.status = 'SENT'` count > 0
   - [ ] Failure rate < 5%

2. รอ overdue notice cron (09:00 ICT):
   - [ ] เหมือนกัน

3. รอ SMS credit alert cron (09:00 ICT):
   - [ ] ถ้า credit < 100 → ได้รับ alert ใน line-staff group

4. รอ retry queue cron (every 5 min):
   - [ ] `notification_logs WHERE status='RETRY_PENDING' AND next_retry_at < now()` ลดลงเรื่อยๆ

## ☐ Step 6 — Sign-off

- [ ] All checkboxes above ✓
- [ ] No P0/P1 alerts in Sentry for 24h
- [ ] Customer feedback: ไม่มี complaint "ไม่ได้รับแจ้งเตือน"

→ **Notifications P1 GO-LIVE complete**

## ถ้ามีปัญหา

ดู `docs/runbooks/notifications-incident.md`

## Related

- Spec: `docs/superpowers/specs/2026-04-30-notifications-p1-operational-readiness-design.md`
- Plan: `docs/superpowers/plans/2026-04-30-notifications-p1-operational-readiness.md`
- Credential rotation: `docs/runbooks/notifications-credential-rotation.md`
- Incident response: `docs/runbooks/notifications-incident.md`
