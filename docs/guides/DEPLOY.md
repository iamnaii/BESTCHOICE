# Deploy BESTCHOICE (GCP)

ระบบ deploy บน **Google Cloud Platform** — Cloud Run (API) + Firebase Hosting (Frontend) + Cloud SQL (PostgreSQL)

## Architecture

```
GitHub (push to main)
  → GitHub Actions (.github/workflows/deploy-gcp.yml)
    → Lint & Test
    → Build Docker image → Artifact Registry
    → Run Prisma migrations via Cloud Run Job
    → Deploy API → Cloud Run
    → Deploy Frontend → Firebase Hosting
```

## Auto Deploy

ไม่ต้องทำอะไร! แค่ `git push` ไปที่ `main` branch → GitHub Actions จะ deploy ให้อัตโนมัติ

## การจัดการหลัง Deploy

### ดู Logs

```bash
# Cloud Run Logs (ผ่าน gcloud CLI)
gcloud run services logs read bestchoice-api --region=asia-southeast1 --limit=100

# หรือดูผ่าน GCP Console → Cloud Run → bestchoice-api → Logs
```

### Force Redeploy

```bash
# Trigger GitHub Actions ใหม่
git commit --allow-empty -m "chore: trigger redeploy"
git push origin main
```

---

## เชื่อมต่อ LINE OA (ทำหลัง Deploy เสร็จ)

หลังจาก Deploy ระบบเรียบร้อยแล้ว ทำตามขั้นตอนนี้เพื่อเปิดให้ลูกค้าใช้ผ่าน LINE

### ขั้นตอนที่ 1: สร้าง LINE Official Account

1. เปิด https://manager.line.biz/ → ล็อกอินด้วย LINE ID
2. กด **สร้างบัญชี** (หรือใช้ LINE OA เดิมก็ได้)
3. ตั้งชื่อร้าน เช่น "BESTCHOICE ผ่อนมือถือ"
4. เลือกหมวด **ร้านค้า/Shopping**

### ขั้นตอนที่ 2: เปิด Messaging API

1. เปิด https://developers.line.biz/ → ล็อกอิน
2. กด **Create a new provider** → ตั้งชื่อบริษัท
3. กด **Create a Messaging API channel**
4. เลือก LINE OA ที่สร้างในขั้นตอนที่ 1
5. จดค่าที่ต้องใช้:

| ค่า | หาจากที่ไหน |
|-----|-----------|
| **Channel Secret** | Tab "Basic settings" → Channel secret |
| **Channel Access Token** | Tab "Messaging API" → กด **Issue** |

### ขั้นตอนที่ 3: ตั้งค่าในระบบ BESTCHOICE

1. เปิดระบบ BESTCHOICE → ล็อกอิน
2. ไปที่เมนู **"เชื่อมต่อ LINE OA"** ในหน้า Settings
3. วาง **Channel Access Token** และ **Channel Secret**
4. กด **"บันทึกการตั้งค่า"**
5. กด **"ทดสอบการเชื่อมต่อ"** → จะแสดงชื่อ Bot ถ้าสำเร็จ

หรือตั้งค่าผ่าน GCP Secret Manager:

```bash
# ตั้งค่าใน GCP Secrets
gcloud secrets versions add LINE_CHANNEL_ACCESS_TOKEN --data-file=- <<< "your-token"
gcloud secrets versions add LINE_CHANNEL_SECRET --data-file=- <<< "your-secret"
```

### ขั้นตอนที่ 4: ตั้งค่า Webhook

1. กลับไปที่ LINE Developers Console → เลือก Channel
2. ไปที่ tab **"Messaging API"**
3. หา **"Webhook URL"** → กด Edit → ใส่:

```
https://YOUR_CLOUD_RUN_URL/api/line-oa/webhook
```

4. เปิด **"Use webhook"** ให้เป็นสีเขียว
5. กด **Verify** → ต้องแสดง "Success"
6. ปิด **"Auto-reply messages"** (ระบบ BESTCHOICE ตอบอัตโนมัติเอง)
7. ปิด **"Greeting messages"** (ไม่จำเป็น)

### ขั้นตอนที่ 5: สร้าง LIFF App (หน้าชำระเงินใน LINE)

1. ยังอยู่ใน LINE Developers Console → เลือก Channel เดิม
2. ไปที่ tab **"LIFF"** → กด **"Add"**
3. ตั้งค่า:
   - **LIFF app name**: BESTCHOICE Payment
   - **Size**: Full
   - **Endpoint URL**: `https://YOUR_DOMAIN/liff/contract`
   - **Scope**: เลือก `profile` และ `openid`
   - **Bot link feature**: Aggressive
4. กด **Add** → จดค่า **LIFF ID** (ตัวเลข 10 หลัก-xxxx)
5. กลับไปที่หน้า Settings ของ BESTCHOICE → ใส่ **LIFF ID** → บันทึก

### ขั้นตอนที่ 6: ตั้งค่า PromptPay (ถ้าต้องการรับชำระผ่าน QR)

1. ในหน้า Settings → ใส่เลข PromptPay (เบอร์โทรหรือเลขบัตร 13 หลัก)
2. ใส่ชื่อบัญชี → บันทึก
3. ลูกค้าจะเห็น QR พร้อมเพย์เมื่อกดชำระเงิน

### ขั้นตอนที่ 7: ลงทะเบียนเจ้าของร้าน

1. เพิ่ม Bot LINE OA เป็นเพื่อนในไลน์ของคุณ
2. พิมพ์ **`#owner`** ส่งไปในแชท Bot
3. ระบบจะบันทึก LINE ID ของคุณเป็น Owner
4. กลับมาที่หน้า Settings → กด **"ดึง User ID"** เพื่อยืนยัน
5. ทดสอบส่งข้อความ → เลือกประเภท → กด **"ส่งทดสอบ"**

### ขั้นตอนที่ 8: ให้ลูกค้าเริ่มใช้

ลูกค้าเพิ่มเพื่อน LINE OA แล้วสามารถ:

| พิมพ์ | ผลลัพธ์ |
|------|---------|
| `ลงทะเบียน` | เปิดหน้า LIFF ลงทะเบียนผูกเบอร์โทร |
| `0812345678` | ผูก LINE กับบัญชีลูกค้าอัตโนมัติ |
| `เช็คยอด` / `ยอด` | แสดงยอดค้างชำระทุกสัญญา |
| `งวด` | ดูตารางผ่อนชำระ |
| `ชำระ` | ได้ QR พร้อมเพย์ + ลิงก์ชำระเงิน |
| `สัญญา` / `contract` | เปิดหน้า LIFF ดูรายละเอียดสัญญา |
| `ใบเสร็จ` | ดูประวัติใบเสร็จ |
| `ติดต่อ` | ข้อมูลติดต่อร้าน |
| ส่งรูปสลิป | ระบบรับสลิปและแจ้งเจ้าของร้าน |

### สร้าง QR Code / ลิงก์เพิ่มเพื่อน

แชร์ให้ลูกค้าเพิ่มเพื่อน Bot ได้ 3 วิธี:

1. **ลิงก์**: `https://line.me/R/ti/p/@YOUR_LINE_ID`
2. **QR Code**: ดาวน์โหลดจาก LINE OA Manager → หน้า "เพิ่มเพื่อน"
3. **ปริ้น QR** ติดหน้าร้าน → ลูกค้าสแกนเพิ่มเพื่อนทันที

---

## เครื่องอ่านบัตรประชาชน (Card Reader)

ตัวอ่านบัตร **ติดตั้งบนเครื่อง Windows ของร้าน** (ไม่ได้อยู่บน server) เพราะต้องต่อ USB โดยตรง

### ติดตั้ง (สำหรับคนไม่เก่ง IT — ง่ายมาก)

1. เปิดหน้า **GitHub Releases** ของโปรเจกต์
2. โหลดไฟล์ `BestchoiceCardReader-vX.X.X-win-x64.zip`
3. คลิกขวา → **Extract All** (แตกไฟล์)
4. เปิดโฟลเดอร์ที่แตกไฟล์ → ดับเบิลคลิก **`setup.bat`**
5. ทำตามที่โปรแกรมถาม → เสร็จ!

**ไม่ต้องลง Node.js** ไม่ต้องลงอะไรเพิ่ม — แค่โหลด แตกไฟล์ แล้ว setup จบ

### ใช้งาน

1. เสียบเครื่องอ่านบัตร USB เข้าคอม
2. ดับเบิลคลิก **"BESTCHOICE Card Reader"** บน Desktop
3. เสียบบัตรประชาชน → ระบบอ่านข้อมูลให้อัตโนมัติ

### สร้าง Release ใหม่ (สำหรับ Developer)

```bash
# Tag แล้ว push — GitHub Actions จะ build + สร้าง Release ให้อัตโนมัติ
git tag card-reader-v1.0.0
git push origin card-reader-v1.0.0
```

หรือกด **Actions → Build Card Reader → Run workflow** บน GitHub ก็ได้
