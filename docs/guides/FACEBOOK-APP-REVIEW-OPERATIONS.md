# Facebook App Review — Operations Checklist

ใช้ checklist นี้คู่กับ [`FACEBOOK-APP-REVIEW-SUBMISSION.md`](./FACEBOOK-APP-REVIEW-SUBMISSION.md) เพื่อ track งาน operational ที่ต้องทำเอง — ไม่ใช่ code

---

## A. Test Reviewer Account

Meta บังคับให้มี test login ที่ reviewer ใช้ดูแอปได้ — ใช้ ACCOUNTANT role (เห็น admin panel แต่ไม่ทำลายข้อมูล)

### A.1 Create reviewer account

```bash
# ใน admin → Users → Create User
Email:       reviewer@bestchoice.com
Password:    <generate strong password — เก็บใน password manager>
Role:        ACCOUNTANT
Branch:      ทุกสาขา (ถ้าเลือกได้)
First name:  Meta
Last name:   Reviewer
```

### A.2 Test ด้วย account นี้ก่อน submit

| ✓ | ทดสอบ | Expected |
|---|---|---|
| □ | Login ที่ `https://bestchoicephone.app/login` | Dashboard โหลด |
| □ | เข้า `Settings → Integrations` | เห็น Facebook App Review Panel |
| □ | กดปุ่ม "ยิง API" บนการ์ด `pages_show_list` | Response แสดงรายการ Page |

### A.3 ใส่ใน Meta App Settings

`developers.facebook.com/apps/{ID}/settings/basic` →
- Test User Account → Add → กรอก reviewer credentials

---

## B. Test Page + Test Comments

Reviewer ต้องทดสอบ comment APIs ได้ — ต้องมี comments ของจริงบนโพสต์ของเรา

### B.1 Pre-prep ก่อนอัด screencast

| ✓ | Action |
|---|---|
| □ | สร้าง 1 โพสต์ใหม่บน BESTCHOICE Phone Shop (เช่นโปรโมชัน iPhone 15) |
| □ | ใช้บัญชี FB ส่วนตัว (ไม่ใช่ admin) → comment "ผ่อน 0% กี่งวดคะ" |
| □ | คัดลอก Comment ID ของ comment นั้น (กดที่ timestamp → ดู URL) |
| □ | บันทึก Comment ID ลงใน Notion / sticky note สำหรับใส่ใน screencast |

### B.2 Spam comment สำหรับ hide demo

| ✓ | Action |
|---|---|
| □ | ใช้บัญชีอื่นอีก 1 อัน → comment ข้อความ spam (เช่น "ขายของ 100฿ ส่งไลน์ XXX") |
| □ | คัดลอก Comment ID |
| □ | เก็บไว้ — จะ hide ตอนอัด screencast `pages_manage_engagement` |

---

## C. Test PSID (สำหรับ Messenger demo)

`pages_messaging` + `pages_utility_messaging` ต้องส่งให้ PSID ที่ทักเข้ามาภายใน 24 ชม.

### C.1 ก่อนอัด screencast (ภายใน 1 ชม.)

| ✓ | Action |
|---|---|
| □ | ใช้บัญชี FB อื่น → เปิด Messenger mobile → ส่งข้อความหา BESTCHOICE Phone Shop เช่น "งวดผ่อนเดือนหน้าจ่ายเท่าไหร่" |
| □ | กลับไปที่ admin → `/chat` inbox → ดูข้อความเข้า |
| □ | ดูใน webhook log → คัดลอก `sender.id` (= PSID) |
| □ | บันทึก PSID — จะใช้ใน 2 screencasts (`pages_messaging` + `pages_utility_messaging`) |

### C.2 PSID expires!

PSID ใช้ได้ภายใน 24 ชม. หลังลูกค้า message ถ้าเกินแล้วต้องส่งใหม่ → recommended อัด 2 คลิปติดกันเลย

---

## D. Business Manager + Ad Account IDs

`business_management` + `ads_read` ต้องใส่ ID จริง

### D.1 หา IDs

```
Business Manager:
  business.facebook.com → Business Settings
  คัดลอก Business ID จาก URL (เช่น 1234567890123)

Ad Account:
  Ads Manager → Account dropdown → คลิกชื่อ account
  คัดลอก Ad Account ID (เช่น act_9876543210)
```

### D.2 ใส่ใน Integration Hub

Admin → Settings → Integrations → Facebook Messenger → กรอก:
- **Page Access Token** — never-expire จาก Page
- **Page ID** — Page ID
- **User Access Token (App Review)** — long-lived 60d, จาก `/me/accounts`
- **System User Token (Marketing API)** — optional, สำหรับ Ads insights
- **Ad Account ID** — `act_NUMBER` หรือแค่ `NUMBER`

บันทึก → Cache TTL 5 นาที

---

## E. Pre-Submit Verification

ใช้ script อัตโนมัติ:

```bash
./tools/fb-app-review-preflight.sh
```

Checks:
- ✓ Privacy URL static + no noindex + has FB section
- ✓ Terms URL static + proper title
- ✓ robots.txt allows .html files
- ✓ Data Deletion + Deauthorize callbacks live
- ✓ Admin panel reachable

ถ้าผ่าน 100% → submit ได้

---

## F. Smoke Test (สำคัญสำหรับ Activity threshold)

ก่อน submit ต้องให้ FB Dashboard เห็น "Activity detected within 30 days" บนทุก permission

```bash
# Set test data ก่อนรัน
export API=https://api.bestchoicephone.app
export EMAIL=admin@bestchoice.com
export PASSWORD=<your-admin-password>
export FB_TEST_PSID=<PSID who messaged within 24hr>
export FB_TEST_POST_ID=<post ID with comments>
export FB_TEST_COMMENT_ID=<comment ID under our post>
export FB_TEST_BM_ID=<Business Manager ID>

./tools/fb-app-review-smoke.sh
```

→ รัน 1 ครั้งแล้ว Dashboard activity ขึ้นภายใน 24 ชม. และมีอายุ 30 วัน

→ สำหรับ `Marketing API Access Tier`: รัน `ads_read` อย่างน้อย 5 ครั้ง/วัน × 15 วัน

---

## G. Recording Day Checklist

อัด 8 คลิปติดกันใน 1 วัน — ป้องกัน PSID expire

### G.1 อุปกรณ์

| ✓ | Item |
|---|---|
| □ | Mac + Chrome (ใช้ DevTools เห็น API calls) |
| □ | iPhone หรือ Android สำหรับเปิด Messenger native |
| □ | Screen recording: Cmd+Shift+5 (มี option "Show Mouse Cursor") |
| □ | Voice memo / external mic (narrate ภาษาอังกฤษ) |
| □ | ffmpeg ติดตั้งแล้ว (สำหรับ compress) |

### G.2 ก่อนเริ่มอัด

| ✓ | Action |
|---|---|
| □ | Login as `reviewer@bestchoice.com` (ใช้ test account, ไม่ใช่ owner) |
| □ | DevTools เปิด → filter "graph.facebook.com" → "Preserve log" ON |
| □ | Browser zoom 110% (อ่านง่าย) |
| □ | ปิด notification / tab อื่นๆ |
| □ | PSID พร้อม (ทักภายใน 1 ชม.) |
| □ | Comment ID พร้อม |
| □ | Spam comment ID พร้อม |
| □ | Business Manager ID พร้อม |

### G.3 ลำดับอัด (8 คลิป)

| # | Permission | Length | Pre-req |
|---|---|---|---|
| 1 | pages_show_list | 45s | — |
| 2 | pages_messaging | 90s | PSID active |
| 3 | pages_manage_metadata | 45s | — |
| 4 | pages_utility_messaging | 90s | PSID active + 4 placeholder values |
| 5 | pages_read_engagement | 75s | Comment ID |
| 6 | pages_manage_engagement | 120s | Comment + spam Comment ID |
| 7 | ads_read | 60s | Ad Account ID |
| 8 | business_management | 75s | Business Manager ID |

ดู script เต็มใน [`FACEBOOK-APP-REVIEW-SUBMISSION.md`](./FACEBOOK-APP-REVIEW-SUBMISSION.md)

### G.4 หลังอัด

```bash
# Compress แต่ละไฟล์
for f in *.mov; do
  ffmpeg -i "$f" -crf 28 -preset slow -c:v libx264 -c:a aac -b:a 96k "${f%.mov}.mp4"
done

# Verify ขนาดไม่เกิน 100MB
ls -lh *.mp4
```

---

## H. Submission Day

### H.1 เปิด App Review Dashboard

```
https://developers.facebook.com/apps/{YOUR_APP_ID}/app-review/permissions/
```

### H.2 ก่อน "Add to Submission"

ทำ pre-flight อีกรอบ — ป้องกันการ submit ขณะ deploy ค้าง:

```bash
./tools/fb-app-review-preflight.sh
```

### H.3 Add 8 permissions to submission

ทีละตัว → "Request Advanced Access" → กรอก:
1. **Use case description** — paste จาก submission doc (verbatim, ภาษาอังกฤษ)
2. **Step-by-step instructions** — paste "Detailed Testing Instructions for Reviewer"
3. **Screencast** — upload คลิปที่ตรงกับ permission

### H.4 Final Review

ก่อนกด Submit:

| ✓ | Check |
|---|---|
| □ | Privacy Policy URL = `.html` |
| □ | Terms of Service URL = `.html` |
| □ | App Mode = Live |
| □ | Business Verification = Approved |
| □ | 8 permissions ทั้งหมดมี: use case + instructions + screencast |
| □ | Test account credentials ใส่ใน "Test Users" section |
| □ | Notes to Reviewer ใส่ pre-requisites (PSID, Comment ID prep) |

### H.5 Submit

กด "Submit for Review" → จดเลข Submission ID

---

## I. Post-Submit Tracking

### I.1 รอ Meta review

- ส่งผลทาง email `akenarin.ak@gmail.com` ภายใน 3-7 วัน
- เช็ค Dashboard ทุกวัน → "Pending Submission" or "Approved/Rejected"

### I.2 ถ้า Rejected

- คลิก permission → "View Comments" → อ่านเหตุผล
- แก้ตามที่บอก → "Edit Submission"
- Resubmit (ฟรี ไม่จำกัดครั้ง)

### I.3 ถ้า Approved

- App Mode ยัง Live อยู่ (ไม่ต้องเปลี่ยน)
- เริ่มยิง production traffic ได้
- บันทึก approval date ใน memory

### I.4 Marketing API Access Tier (round 2)

หลัง `ads_read` approved:
- ตั้ง cron ยิง `/insights` ทุกวัน × 15 วัน
- หลัง 15 วันมี activity เพียงพอ → submit Marketing API Access Tier (Standard) แยก

---

## References

- [FACEBOOK-APP-REVIEW-SUBMISSION.md](./FACEBOOK-APP-REVIEW-SUBMISSION.md) — submission package, use cases, screencast scripts
- [FACEBOOK-APP-REVIEW.md](./FACEBOOK-APP-REVIEW.md) — runbook for endpoint mapping
- [Pre-flight script](../../tools/fb-app-review-preflight.sh) — automated URL/callback checks
- [Smoke test script](../../tools/fb-app-review-smoke.sh) — automated activity generation
