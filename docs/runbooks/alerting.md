# การแจ้งเตือน (Cloud Monitoring)

> สร้าง 2026-09-04 · ก่อนหน้านั้นโปรเจกต์ **ไม่มี alert policy และไม่มี notification channel เลยสักอัน**
>
> ⚠️ ทั้งหมดอยู่ใน GCP ไม่ได้อยู่ในเรโป — แก้ผ่าน `gcloud monitoring policies` หรือ Cloud Console
> ไฟล์นี้คือสำเนาไว้ให้อ่านโดยไม่ต้องเปิดคอนโซล **ถ้าแก้ใน GCP ต้องมาแก้ที่นี่ด้วย**

## ปลายทาง

ช่องทางเดียว: อีเมล `akenarin.ak@gmail.com`
(`projects/bestchoice-prod/notificationChannels/10055322276131833099`)

> 🔴 **ยังไม่เคยยืนยันว่าอีเมลส่งถึงจริง** — Cloud Monitoring บันทึกว่า policy เด้ง (`ViolationOpenEvent`)
> แต่ **ไม่เขียน log ว่าส่งเมลสำเร็จหรือไม่** ⇒ ตรวจจากฝั่ง API ไม่ได้ ต้องเปิดกล่องจดหมายดูเท่านั้น
> ถ้าเมลไม่ถึง **ทุก policy ด้านล่างไม่แจ้งใครเลย**

## Policy

| | จับอะไร | เกณฑ์ | ระดับ |
|---|---|---|---|
| **P1** | API เข้าไม่ได้ | uptime check `api.bestchoicephone.app/api/health` ล้ม ≥3 ภูมิภาค 5 นาที | CRITICAL |
| **P2** | Cloud SQL ล่ม | `database/up < 1` **แม้แต่ sample เดียว** | CRITICAL |
| **P3** | ทรัพยากร DB ตึง | แรม >90%/15น. · CPU >80%/10น. · ดิสก์ >85%/30น. | WARNING |
| **P4** | 5xx ถึงลูกค้า | >0.05/วิ (≈3/นาที) ต่อเนื่อง 5 นาที | CRITICAL |
| **P5** | API ต่อ DB ไม่ได้ | log metric `api_db_unreachable` >5 ครั้ง/10 นาที | CRITICAL |
| **P6** | connection ใกล้เต็ม | `num_backends` >30 ต่อเนื่อง 5 นาที | WARNING |
| **P7** | คอนเทนเนอร์รีสตาร์ทรัว | log metric `api_container_starts` >8 ครั้ง/30 นาที | WARNING |
| **P8** | cron ล้ม | **ERROR จาก context `Cron\|Scheduler\|Queue\|Outbox\|Dispatch` แม้แต่ครั้งเดียว** (จำกัด 6 ชม.) | WARNING |
| **P9** | หน้าร้าน/หลังบ้านเข้าไม่ได้ | uptime check ล้ม ≥2 ภูมิภาค 10 นาที | CRITICAL |

runbook รายตัวอยู่ในฟิลด์ `documentation` ของแต่ละ policy (โผล่ในอีเมลตอนเด้ง):
`gcloud monitoring policies describe <name> --format='value(documentation.content)'`

## Uptime check

| ชื่อ | ปลายทาง | ความถี่ |
|---|---|---|
| `bestchoice-api health` | `api.bestchoicephone.app/api/health` (match `"status":"ok"`) | 60 วิ · 6 ภูมิภาค |
| `bestchoice-shop หน้าร้าน` | `www.bestchoicephone.com` | 5 นาที · 3 ภูมิภาค |
| `bestchoice-admin หลังบ้าน` | `bestchoicephone.app` | 5 นาที · 3 ภูมิภาค |

## Log-based metric

- `api_db_unreachable` — Prisma "reach database server" (หนุน P5)
- `api_container_starts` — "STARTUP TCP probe" (หนุน P7)

## เหตุผลของการออกแบบที่ไม่ชัดในตัวมันเอง

**ทำไม P8 ถึงเป็น log-based ไม่ใช่ threshold**
cron ที่พังวันละครั้งสร้าง error แค่ 1-2 ครั้ง/วัน — ด่านแบบนับอัตราต่อ 10 นาที **มองไม่เห็นโดยหลักการ**
ไม่ว่าจะตั้ง threshold ต่ำแค่ไหน. บทเรียนมาจากของจริง: cron จ่ายงานติดตามหนี้พังทุกคืนติดกัน 9 คืน
(26 ส.ค. – 3 ก.ย. 2026) โดยไม่มีด่านไหนเห็นเลย — P5 จับ "ต่อ DB ไม่ได้" แต่เคสนั้นต่อ DB ติด แค่ query ผิด

**ทำไม P8 จำกัดความถี่ 6 ชม. ไม่ใช่ 1 ชม.**
ช่วงที่ DB มีปัญหาเคยมี error 40-90 ครั้ง/วัน — ถ้าตั้ง 1 ชม. จะได้ 24 เมล/วันแล้วคนจะเลิกอ่าน
ตั้งใจแลกความไวกับการไม่ถูกเมิน (`notificationRateLimit` ใช้ได้เฉพาะ log-based policy เท่านั้น
metric-threshold policy จะถูกเซิร์ฟเวอร์ปฏิเสธ)

**ทำไม P2 ตั้ง duration 0 วินาที**
`database/up` **ไม่ได้ค้างที่ 0 ตลอดช่วงรีสตาร์ท** — มันตกแค่ sample เดียว
เกณฑ์เดิม 180 วินาทีต้องการ ≥3 sample ติดกัน ⇒ **สร้างได้แต่ไม่มีวันเด้ง**

**ทำไม P5 เกณฑ์ 5 ไม่ใช่ 15**
นับจากของจริง 12 วัน (23 ส.ค. – 3 ก.ย.) มี 667 ครั้ง เกิดทุกวัน 24-94 ครั้ง/วัน
แต่แบ่งเป็นถัง 10 นาที **ถังที่แย่ที่สุดมีแค่ 13** ⇒ เกณฑ์เดิม >15 ไม่เคยเด้งเลยแม้แต่ครั้งเดียว

**ทำไม P6 เกณฑ์ 30**
`max_connections = 50` สำรองให้ superuser 3 ⇒ ใช้ได้จริง **47** · 30 = 60% เหลือเวลาตอบสนอง
⚠️ Cloud Run ตั้ง `DATABASE_CONNECTION_LIMIT=10 × maxScale=10` = **ขอได้ถึง 100**
⇒ สเกลเกิน ~4 instance เมื่อไหร่ connection เต็มทันที (ยังไม่แก้ — เป็นคำตัดสินของเจ้าของ)

## ยังไม่มีด่านสำหรับ

- **ธุรกิจผิดปกติ** — ยอดขายเป็นศูนย์ทั้งวัน, ไม่มีใครจ่ายค่างวดเลย, บอทไม่ตอบลูกค้า
  ด่านทั้งหมดตอนนี้เฝ้า *โครงสร้างพื้นฐาน* ไม่ได้เฝ้า *ผลลัพธ์ทางธุรกิจ*
- **คิว/งานที่ค้างสะสม** เช่นสลิปรอตรวจกองพะเนิน
- **ค่าใช้จ่าย GCP พุ่ง** (ไม่มี budget alert)

## แก้ policy

⚠️ `gcloud monitoring policies update --policy-from-file` **แทนที่ทั้งใบ** และ
**ทำให้ notification channel หลุด** ถ้าไม่ส่ง `--set-notification-channels` มาด้วย

```bash
POL=$(gcloud monitoring policies list --filter='displayName:"P6"' --format='value(name)')
gcloud monitoring policies describe "$POL" --format=json > p.json
# แก้ p.json แล้วลบ field: name, creationRecord, mutationRecord, conditions[].name
CH=projects/bestchoice-prod/notificationChannels/10055322276131833099
gcloud monitoring policies update "$POL" --policy-from-file=p.json --set-notification-channels="$CH"
gcloud monitoring policies describe "$POL" --format='value(enabled,notificationChannels)'   # ตรวจเสมอ
```

ปิดชั่วคราวโดยไม่ลบ: `gcloud monitoring policies update <POL> --no-enabled`
(คำสั่งนี้แตะเฉพาะฟิลด์ `enabled` ปลอดภัย)
