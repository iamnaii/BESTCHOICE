# Runbook: ขึ้น prod — การเดินทางของลูกค้า เฟส 1 (web 26.9.28)

- **PR เดียว** จาก branch `worktree-feat+customer-journey-p2` = แผน 1 (หน้ารายละเอียดลูกค้า) + แผน 2 (การเดินทางของลูกค้า) — Ruling FR-MERGE-ORDER-2
- แผน: `docs/superpowers/plans/2026-09-15-customer-detail-redesign.md` (แผน 1) · `docs/superpowers/plans/2026-09-15-customer-journey.md` (แผน 2)
- spec: `docs/superpowers/specs/2026-09-15-customer-journey-design.md`
- migration ที่ run นี้ลง (ทั้งคู่ยังไม่เคยขึ้น prod):
  1. `apps/api/prisma/migrations/20261001100000_chat_prospects_phone_nullable/` — เฟส 0 (#1592) อยู่บน main แล้ว แต่ run ของ #1592/#1593 แดงจึงยังไม่เคย deploy
     - `customers.phone` เลิกบังคับไม่ว่าง (DROP NOT NULL)
     - เพิ่มคอลัมน์ `chat_rooms.dismissed_same_person_ids`
  2. `apps/api/prisma/migrations/20261002100000_customer_journey/`
     - เพิ่มคอลัมน์ `customers.merged_into_id`
     - สร้าง 2 ตาราง: `customer_journey_entries` และ `customer_journey_states`
     - เติม `merged_into_id` ย้อนหลังจาก audit `CUSTOMER_PLACEHOLDER_MERGED`
- ไฟล์นี้คือแหล่งจริงของ runbook — PR body ลิงก์มาที่นี่ ห้ามแก้ใน PR body แยก

> 🚨 ทุกคำสั่งในไฟล์นี้เป็นงานของเจ้าของ — dev/agent ไม่ได้รันอะไรกับ prod ในงานนี้

## 0. อ่านก่อน: merge เข้า main = deploy prod ทันที

**PR เดียว merge ครั้งเดียว = pipeline run เดียว** (Ruling FR-MERGE-ORDER-2)
- ไม่มีขั้น "ระหว่างสอง merge" อีกแล้ว — ด่านทุกข้อทำก่อนกดครั้งเดียว และ backfill ทั้งสองตัวรันหลัง run นี้เขียว

**pipeline:** push เข้า `main` เรียก `.github/workflows/deploy-gcp.yml`
1. ด่านเทส: lint · test-web · test-api · test-integration · test-chat-credit · build-web → สรุปที่ job `lint-and-test`
   - **พร้อมกันกับด่านเทส** `build-and-push-api` build และ push image `api:<github.sha>` (ไม่รอเทส — job นี้ไม่มี `needs`)
2. หลังด่านเทสผ่าน pipeline แยกเป็น **สองสายที่วิ่งพร้อมกัน**:
   - **สาย API:** **`migrate-db`** (รัน**เฉพาะ**เมื่อ `lint-and-test` **และ** `build-and-push-api` เขียวทั้งคู่ · Cloud Run job `bestchoice-migrate` รัน `prisma migrate deploy` กับ **ฐาน prod** — ลงทั้ง 2 migration ข้างบนใน job เดียว) → `deploy-api` (รัน**เฉพาะ**เมื่อ `migrate-db` เขียว)
   - **สายเว็บ:** `deploy-web` — Firebase hosting admin + shop · `needs` แค่ `lint-and-test` + `build-web` ⇒ **ไม่รอ image API ไม่รอ migration และไม่รอ API**

⇒ **กด merge = ลง migration + ขึ้น API และเว็บใหม่ทันทีที่ด่านเทสผ่าน**
- ไม่มีช่วง "merge แล้วค่อยตรวจ" — ด่านทุกข้อในหัวข้อ 1 ต้องผ่านก่อนกดปุ่ม
- 🚨 **เว็บอาจขึ้นก่อน API — หรือขึ้นทั้งที่สาย API ไม่เขียว**
  - เว็บ 26.9.28 เรียก `GET /customers/:id/detail` (แผน 1) และ `GET /customers/:id/journey*` (แผน 2) ซึ่ง API เก่าไม่มี ⇒ หน้ารายละเอียดลูกค้าพังจนกว่า API ใหม่ขึ้น
  - run เขียวครบ = พังช่วงสั้น ๆ ระหว่างเว็บขึ้นกับ API ขึ้น ⇒ merge ช่วงคนใช้น้อย (ข้อ 1.3)
  - `deploy-web` เขียว แต่ `build-and-push-api` / `migrate-db` / `deploy-api` ตัวใดไม่เขียว (แดง · ถูกยกเลิก · **หรือ skipped**) = **ถอยเว็บทันที** (หัวข้อ "ถอย" → "ถอยเว็บ") แล้วค่อยหาสาเหตุ
    - skipped ก็นับ: `build-and-push-api` พัง ⇒ `migrate-db` และ `deploy-api` ขึ้นเป็น **skipped** (ไม่ใช่แดง) แต่ `deploy-web` ยังขึ้น 26.9.28 กับ API เก่า

**run นี้ขึ้นอะไรบ้าง:** ทุกอย่างบน main ที่ยังไม่เคย deploy + PR นี้
- เฟส 0 (#1592/#1593) — run บน main ของสอง PR นั้นแดงที่ด่านเทส จึงยังไม่มีอะไรขึ้น prod
- แผน 1 + แผน 2 — อยู่ใน PR นี้

**run เข้าคิว ไม่ยกเลิกกัน** (`concurrency … cancel-in-progress: false`)
- ห้าม merge PR อื่นซ้อนจนกว่า run นี้เขียวและตรวจขั้น 2 เสร็จ — run ถัดไปจะขึ้น HEAD ใหม่ทับระหว่างที่ยังตรวจอยู่

**commit ที่แตะแต่ `docs/**` หรือ `**.md` ไม่เรียก pipeline** (paths-ignore)
- แก้ไฟล์นี้ทีหลังได้โดยไม่ deploy

**ทางสำรองถ้า GitHub Actions ใช้ไม่ได้** (เช่น บิลตัน) — สูตร deploy จากเครื่อง:
1. `gcloud builds submit --project=bestchoice-prod --tag=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40> --timeout=30m .`
2. `gcloud run jobs update bestchoice-migrate --image=…` แล้ว `gcloud run jobs execute bestchoice-migrate --wait`
3. `gcloud run services update bestchoice-api --image=…`
   - 🚨 ห้ามใช้ `gcloud run deploy` ชุดเต็มจากเครื่อง เพราะ env/secret ของ service จะเพี้ยน
4. build เว็บ แล้ว `firebase deploy --only hosting:admin,hosting:shop --project bestchoice-prod`
   - **ทำข้อนี้หลัง API ใหม่ health ok เท่านั้น** — ทางนี้คุมลำดับได้ ต่างจาก pipeline (ดูข้างบน)

ด่านทุกข้อในไฟล์นี้ใช้เหมือนกัน — อ่านคำว่า "merge" เป็น "รัน migrate job"

**ตรวจทุกรอบ:**
- `curl https://api.bestchoicephone.app/api/health`
- เวอร์ชันในบันเดิลของ `https://bestchoicephone.app/`

**cron ที่ PR นี้เพิ่มไม่มีสวิตช์ปิด:**
- `journey:recompute` เวลา 03:30 น. (เวลาไทย)
- `journey:entry-guard` เวลา 04:00 น. (เวลาไทย)
- `ScheduleModule` ทำงานใน **ทุก instance** ของ `bestchoice-api` (min 1 / max 10)
  - คืนที่มีหลาย instance cron รันซ้อนกันได้
  - แถวแคชเขียนเรียงตาม id จึงไม่ deadlock กันเอง
  - แต่ log และ Sentry อาจซ้ำหลายชุด

## ลำดับห้ามสลับ

| ขั้น | งาน |
|---|---|
| 1 | **ด่านก่อน merge** — ขั้นก่อน deploy ของเฟส 0 · EXPLAIN บนสำเนา prod ที่ถ่ายก่อน merge · ช่วงเวลา · lock ของทั้ง 2 migration · จดของเดิมไว้ถอย |
| 2 | merge PR นี้ (ครั้งเดียว) — เฝ้า run · `build-and-push-api` / `migrate-db` / `deploy-api` ไม่เขียว (รวม skipped) = ถอยเว็บทันที |
| 3 | apply สิทธิ์ MCP |
| 4 | `backfill:chat-prospects` |
| 5 | ตรวจก่อน backfill — ผู้สนใจที่ถูกรวมแต่ยังไม่มี `merged_into_id` |
| 6 | `backfill:customer-journey` dry-run |
| 7 | รันจริง |
| 8 | เช้าวันถัดไป |

**ทำไม backfill ต้องเรียงแบบนี้:** `journey-state.sql` นับ "ทักครั้งแรก" จากแถว customers ของห้องแชท
- ถ้ายังไม่ backfill ผู้สนใจ ห้องราว 8,991 ห้องยังไม่มีเจ้าของ
- CLI `backfill:customer-journey` จะหยุดเอง (exit 1)
- ทั้งสองตัวรันหลัง run ของ merge เขียว — `backfill:chat-prospects` ก่อน แล้วค่อย `backfill:customer-journey`

## 1. 🚨 ด่านก่อน merge

### 1.1 ขั้นก่อน deploy ของเฟส 0 (#1592)

- ทำขั้น "ก่อน deploy" ตาม runbook ใน PR #1592 ก่อนกด merge — migration ของ #1592 ลงใน run เดียวกับ PR นี้

### 1.2 EXPLAIN ของ cron `journey:recompute`

**ทำไมต้องทำก่อน merge:**
- cron นี้**ไม่มีสวิตช์ปิด** — `customer-journey.cron.ts` เป็น `@Cron('30 3 * * *')` เปล่า ๆ ไม่อ่าน SystemConfig
- merge แล้ว pipeline ขึ้นให้เอง ⇒ คืนนั้น 03:30 น. cron รันเลย
- ⇒ ต้องรู้ว่าคิวรีเร็วพอ**ก่อน**กด merge ไม่ใช่หลัง

**ทำที่ไหน:** บน **สำเนาข้อมูลขนาด prod ที่ถ่ายก่อน merge**
- เช่น clone instance ชั่วคราวจาก backup แล้วลบทิ้งหลังดูผล
- **ห้ามรันบน prod ตรง**
- PR เดียว ⇒ สำเนาที่ถ่ายก่อน merge คือ **ก่อน migration และก่อน backfill ผู้สนใจ** ⇒ ใช้ **ฉบับรันได้** ข้างล่าง (ไฟล์จริงรันบนสำเนานี้ไม่ได้)
  - `chat_rooms` / `chat_messages` ในสำเนามีขนาดเท่า prod อยู่แล้ว
  - `customers` ยังไม่มีแถวผู้สนใจราว 9 พันแถว (สร้างตอนขั้น 4) — ถ้าผลก้ำกึ่ง ให้ EXPLAIN ไฟล์จริงซ้ำบนสำเนาที่ถ่ายหลังขั้น 7
- ทำเมื่อไรก็ได้ก่อนขั้น 2

**ทำไมใช้ไฟล์จริงตรง ๆ ไม่ได้:** ไฟล์ `apps/api/src/modules/customer-journey/sql/journey-active-since.sql`
- ใช้พารามิเตอร์ `$1` ทุกสาขา ⇒ รันตรง ๆ จะ error `there is no parameter $1`
- สำเนาก่อน migration ยังไม่มีตาราง `customer_journey_entries` และคอลัมน์ `customers.merged_into_id`

**ฉบับรันได้** ต่างจากไฟล์จริง 3 จุด:
1. แทน `$1` ด้วยเวลา UTC ย้อน 48 ชม. — เท่ากับที่ cron ใช้
2. ตัดสาขา `customer_journey_entries`
3. `COALESCE(c.merged_into_id, c.id)` → `c.id`

```sql
EXPLAIN (ANALYZE, BUFFERS)
WITH hits AS (
  SELECT c.id AS member_id FROM customers c WHERE c.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT r.customer_id FROM chat_rooms r WHERE r.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT r.customer_id FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id WHERE m.created_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT r.customer_id FROM todos td JOIN chat_rooms r ON r.id = td.room_id WHERE td.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT r.customer_id FROM room_credit_analyses rca JOIN chat_rooms r ON r.id = rca.room_id WHERE rca.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT k.customer_id FROM contracts k WHERE k.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT s.customer_id FROM sales s WHERE s.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT cc.customer_id FROM credit_checks cc WHERE cc.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT b.customer_id FROM bookings b WHERE b.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT l.customer_id FROM customer_line_links l WHERE l.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT a.customer_id FROM online_installment_applications a WHERE a.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT pr.customer_id FROM product_reservations pr WHERE pr.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT ti.customer_id FROM trade_ins ti WHERE ti.updated_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
  UNION SELECT al.entity_id FROM audit_logs al WHERE al.action = 'AI_LEAD_CAPTURED' AND al.entity = 'customer' AND al.created_at >= (now() AT TIME ZONE 'UTC') - interval '48 hours'
)
SELECT DISTINCT c.id AS customer_id FROM hits h JOIN customers c ON c.id = h.member_id;
```

**หมายเหตุของคิวรีนี้:**
- `(now() AT TIME ZONE 'UTC')` = เวลา UTC แบบไม่มีโซน — ตรงกับที่แอปส่ง `since.toISOString()` แล้ว cast `::timestamp`
- จะเทียบกับไฟล์จริงแบบเป๊ะ: แทน `$1` ด้วยสตริงเวลา เช่น `'2026-09-13T20:30:00.000Z'::timestamp`
  - ไฟล์จริงรันได้**เฉพาะบนสำเนาที่ลง migration แล้ว**
- ⚠️ **สาขา `customer_journey_entries` ยังไม่ได้วัด** ในด่านนี้ (ตารางยังว่าง)
  - ตารางนี้ไม่มี index บน `created_at` / `deleted_at` ⇒ สาขานี้ช้าลงตามจำนวน entry ที่สะสม
  - ให้ EXPLAIN ไฟล์จริงซ้ำบนสำเนาที่ลง migration แล้ว หลังเปิดใช้สักพัก (เช่น 2–4 สัปดาห์)

**index ที่ "อาจ" ไม่มี** (ตามไฟล์ migration ในรีโป):
- ไม่มี index ที่ขึ้นต้นด้วย `updated_at` บน `customers`, `chat_rooms`, `todos`, `room_credit_analyses`, `contracts`, `sales`, `credit_checks`, `bookings`, `customer_line_links`, `online_installment_applications`, `product_reservations`, `trade_ins`
- `chat_messages.created_at` อยู่แค่ใน index คู่ `(session_id, created_at)`
- `audit_logs.created_at` มี index แล้ว
- prod อาจมี index ที่สร้างมือเพิ่ม — ให้เชื่อแผนจาก EXPLAIN ไม่ใช่รายการนี้

**ผลการตัดสิน:**
- **ผ่าน** = Execution Time หลักวินาที → ไปข้อ 1.3
- **ไม่ผ่าน** = หลักนาทีขึ้นไป → dev เพิ่ม index ใน migration **ของ PR นี้** แล้ว EXPLAIN ซ้ำ
  - index ต้องขึ้นใน merge เดียวกัน — ไม่มีรอบ "merge แล้วค่อยเติมทีหลัง" เพราะ cron ไม่รอ

**ถ้า PR นี้ถูก merge ไปแล้ว (= ขึ้น prod แล้ว) ตอนรู้ว่า EXPLAIN ช้า:**
- 🚨 **ห้ามรันขั้น 4 (`backfill:chat-prospects`) จนกว่า EXPLAIN หลัง merge จะผ่านหรือ index ขึ้นแล้ว** — ทางถอย image ข้อ 2 ข้างล่างปลอดภัยเฉพาะก่อนขั้น 4 (หัวข้อ "ถอย" → "ถอย API")
1. dev ส่ง index เป็น **migration ใหม่ใน PR ต่อท้าย** — merge PR นั้น = deploy index
   - `<SHA40 ของ PR นี้>` ในขั้น 6–7 ให้ใช้ commit ของ run ที่ขึ้น PR ต่อท้ายนั้นแทน
2. ถ้า PR ต่อท้ายขึ้นไม่ทันก่อน 03:00 น. → ทำหัวข้อ "ถอย" ข้างล่าง **ก่อน 03:00 น.**
   - ถอย `bestchoice-api` กลับ image ก่อนหน้า **และถอยเว็บพร้อมกัน** (image ก่อน PR นี้ไม่มี `GET /customers/:id/detail`) แล้วค่อยขึ้นใหม่พร้อม index

### 1.3 ช่วงเวลาที่ merge ได้

- **merge ช่วงเช้า ให้ run จบก่อนเที่ยง** — เหลือเวลาแก้ index ก่อน 03:30 น. ถ้าต้องแก้
- **ช่วงคนใช้น้อย** — เว็บขึ้นก่อน API ได้ (ข้อ 0) หน้ารายละเอียดลูกค้าพังช่วงสั้น ๆ ระหว่างนั้น
- **ห้าม merge วันเสาร์**
  - คืนวันเสาร์→อาทิตย์ cron ไม่ใช้คิวรีข้างบน แต่รันโหมด sweep (`recomputeAll` ทุกลูกค้า — หนักพอ ๆ กับ backfill)
  - ให้คืนแรกเป็นโหมด 48 ชม.
- **ห้าม merge ช่วง 03:00–04:30 น.**
- **ถ้าทำ EXPLAIN ก่อน merge ไม่ได้จริง ๆ:**
  1. merge ช่วงเช้าเท่านั้น
  2. EXPLAIN ไฟล์จริงบนสำเนาที่ลง migration แล้ว — 🚨 **ห้ามรันขั้น 4 (`backfill:chat-prospects`) จนกว่า EXPLAIN นี้ผ่าน**
  3. ช้าและแก้ index ไม่ทันก่อน 03:00 น. → ถอย image **และเว็บ** (หัวข้อ "ถอย") — ทำได้เพราะยังไม่ได้รันขั้น 4
  4. ถ้าไม่ทันเช้า → **เลื่อน merge ไปวันถัดไป**

### 1.4 lock ของ migration (ทั้ง 2 ตัวใน job เดียว)

**ปัญหา:** `migrate-db` ลง 2 migration ต่อกัน — ALTER ของทั้งคู่ต้องได้ **ACCESS EXCLUSIVE lock** ⇒ หน้าต่าง lock ครอบทั้งสองตัว
1. `20261001100000_chat_prospects_phone_nullable` — ALTER `customers` (DROP NOT NULL) และ `chat_rooms` (ADD COLUMN ค่าตั้งต้นคงที่) · สั้น
2. `20261002100000_customer_journey` — ถือ lock บน `customers` **ตลอดทั้งสคริปต์**
   - ช่วงที่ถือ lock: ADD COLUMN → สร้าง index / FK → เติม `merged_into_id` จาก `audit_logs` → ยุบ chain
- ถ้ามีทรานแซกชันค้างนานที่แตะ `customers` หรือ `chat_rooms` (รายงาน · เซสชัน MCP · psql ที่เปิดทิ้ง):
  - ALTER ต้องรอ
  - ทุกคำขอที่อ่าน/เขียนลูกค้าหรือห้องแชทต่อคิวหลังมัน ขณะที่ revision เก่ายังรับ traffic อยู่ (webhook แชทเขียน `chat_rooms` ตลอด)

**ก่อนกด merge:**
1. ตรวจทรานแซกชันที่ค้างด้วย role เจ้าของ แล้วปิดเซสชันของตัวเองที่ค้างนาน:
   ```sql
   SELECT pid, usename, application_name, state, wait_event_type, now() - xact_start AS xact_age
   FROM pg_stat_activity
   WHERE datname = current_database() AND xact_start IS NOT NULL
   ORDER BY xact_start;
   ```
2. merge ช่วงคนใช้น้อย — เช้าก่อนร้านเปิด ซึ่งตรงกับข้อ 1.3 อยู่แล้ว

**เรื่อง `lock_timeout`:** job `bestchoice-migrate` ใน pipeline ไม่มีช่องตั้งค่านี้
- workflow ไม่ได้ตั้ง และ `prisma migrate deploy` ไม่มีตัวเลือกนี้
- ⇒ ใช้การตรวจ `pg_stat_activity` + ช่วงคนน้อยแทน

### 1.5 จดของเดิมไว้ถอย

- image ที่ `bestchoice-api` ใช้อยู่ก่อน merge = `<SHA40 ก่อน PR นี้>` — Cloud Run console → `bestchoice-api` → Revisions (ทางมือ)
  - ตรวจ 2026-09-15: run ของ #1592/#1593 แดง ⇒ image บน prod ยังไม่มีโค้ดเฟส 0 (ไม่มีการสร้าง/รวมผู้สนใจ) — ยืนยันจาก tag ของ revision ตอนจด
- release ปัจจุบันของ Firebase Hosting site admin (`bestchoicephone.app`) — Firebase console → Hosting → ประวัติ release (ทางมือ)

## 2. merge PR นี้ (ครั้งเดียว)

1. merge แล้วจด `<SHA40 ของ PR นี้>` = commit ของ run จากหน้า Actions
   - image ที่ pipeline push ใช้ tag นี้ — ใช้ในขั้น 4 และ 6–7
2. เฝ้า run — สองสายวิ่งพร้อมกัน (ข้อ 0):
   - `deploy-web` เขียวก่อน `migrate-db` จบได้ — **อย่าอ่านว่า run จบแล้ว**
   - `build-and-push-api` ต้องเขียว
   - `migrate-db` ต้องลงครบทั้ง `20261001100000_chat_prospects_phone_nullable` และ `20261002100000_customer_journey`
   - `deploy-api` ต้องเขียว
3. 🚨 **`deploy-web` เขียว แต่ `build-and-push-api` / `migrate-db` / `deploy-api` ตัวใดไม่เขียว (แดง · ถูกยกเลิก · **หรือ skipped**):** เว็บขึ้นไปแล้วกับ API เก่า
   - skipped ก็นับ — `build-and-push-api` พังทำให้ `migrate-db` / `deploy-api` ขึ้นเป็น skipped ไม่ใช่แดง
   - หน้ารายละเอียดลูกค้า (แผน 1 เรียก `GET /customers/:id/detail`) และแท็บการเดินทาง / แถบขั้น / การ์ดกิจกรรมล่าสุด (`GET /customers/:id/journey*`) พัง
   - ⇒ **ถอยเว็บทันที** (หัวข้อ "ถอย" → "ถอยเว็บ") แล้วค่อยหาสาเหตุ — เหตุที่น่าจะเจอที่สุดคือ `migrate-db` รอ lock (ข้อ 1.4)
   - ห้าม merge/รัน pipeline ซ้ำจนกว่า dev ดู log ของ `bestchoice-migrate` แล้ว

**ผ่านเมื่อ:** run เขียวครบทุก job · health ok · บันเดิลเป็น `26.9.28` (ตรวจครั้งเดียว — ไม่มีรุ่นกลาง)

⚠️ **ตั้งแต่คืนแรกหลัง merge จนกว่าขั้น 7 จะผ่าน:** Sentry error `journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE` **ขึ้นทุกคืนเป็นเรื่องปกติ**
- โหมด 48 ชม. คำนวณแค่คนที่ขยับ ⇒ แคชยังไม่ครบทุกคน
- เมินได้เฉพาะช่วงนี้เท่านั้น

## 3. apply สิทธิ์ MCP

รัน `bash .claude/mcp/setup.sh`

**รันซ้ำได้:**
- เช็ค IAM user ก่อนสร้าง
- `CREATE ROLE` แบบ `WHERE NOT EXISTS`
- REVOKE/GRANT รายตาราง

🚨 **ต้องทำหลังขั้น 2 เท่านั้น**
- ถ้าตารางยังไม่มี `REVOKE` จะ error และ `ON_ERROR_STOP` ยกเลิกทั้งไฟล์ (ไม่มีอะไรเปลี่ยน)

**ผ่านเมื่อ** (เปิด session Claude Code ใหม่แล้ว):
- MCP ไม่เตือน ACL drift
- `SELECT count(*) FROM customer_journey_states` อ่านได้
- `SELECT note FROM customer_journey_entries LIMIT 1` ถูกปฏิเสธ (ถูกต้อง)
- `SELECT count(*) FROM customers WHERE merged_into_id IS NOT NULL` เทียบกับ `SELECT count(*) FROM audit_logs WHERE action = 'CUSTOMER_PLACEHOLDER_MERGED'`
  - **เท่ากัน หรือต่างได้ทั้งสองทิศจาก 2 เหตุนี้:**
    1. **merged_into_id มากกว่า** — การรวมหลัง deploy ที่หา system user ไม่เจอ: ระบบตั้ง `merged_into_id` แต่ข้าม audit (R12)
    2. **merged_into_id น้อยกว่า** — audit ที่แถวลูกค้าปลายทางไม่มีแล้ว: migration ข้ามไม่เติมให้
  - ต่างด้วยเหตุอื่นหรือไม่แน่ใจ → รันคิวรีในขั้น 5 ("ผู้สนใจที่ถูกรวมแต่ยังไม่มี merged_into_id") ต้องได้ 0
    - คิวรีนั้น**ตัดได้เฉพาะเหตุ 2** — แถวของเหตุ 1 มี `merged_into_id` แล้ว คิวรีจึงมองไม่เห็น

## 4. `backfill:chat-prospects`

ทำตาม runbook ใน PR #1592 (นับ PSID ซ้ำก่อน) โดยใช้ image ของขั้น 2 (`<SHA40 ของ PR นี้>`)
- รันหลัง run ของ merge เขียวเท่านั้น (ไม่มีขั้นระหว่างสอง merge อีกแล้ว)

**dry-run:**
```bash
gcloud run jobs create bestchoice-backfill-chat-prospects --project=bestchoice-prod --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ของ PR นี้> \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-cloudsql-instances=bestchoice-prod:asia-southeast1:bestchoice-db \
  --command=npm --args=--prefix,apps/api,run,backfill:chat-prospects \
  --set-env-vars=EXPECTED_DB_NAME=bestchoice --max-retries=0 --task-timeout=3600s
gcloud run jobs execute bestchoice-backfill-chat-prospects --project=bestchoice-prod --region=asia-southeast1 --wait
```

**รันจริง** — เลือกช่วงเงียบ:
```bash
gcloud run jobs update bestchoice-backfill-chat-prospects --project=bestchoice-prod --region=asia-southeast1 \
  --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
```
แล้ว `execute --wait` อีกครั้ง

- exit 2 = เปิดดู log ก่อน ไม่ได้แปลว่าล้มเสมอ

**ผ่านเมื่อ:**
- MCP `SELECT count(*) FROM chat_rooms WHERE deleted_at IS NULL AND customer_id IS NULL` ≈ 0
- คิวรีตรวจ 2 ตัวใน PR #1592 = 0 ทั้งคู่
  - คิวรีนั้นใช้ `acquisition_source` และ `phone` ซึ่ง `mcp_ro` อ่านไม่ได้ ⇒ ต้องรันด้วย role เจ้าของ

## 5. ตรวจก่อน backfill (ใช้ role เจ้าของ ไม่ใช่ MCP)

**ผู้สนใจที่ถูกรวมแต่ยังไม่มี merged_into_id:**
```sql
SELECT count(*) FROM customers WHERE acquisition_source LIKE 'CHAT_%' AND deleted_at IS NOT NULL AND merged_into_id IS NULL;
```
- `mcp_ro` อ่าน `acquisition_source` ไม่ได้ ⇒ ต้องรันด้วยสิทธิ์เจ้าของ
- คิวรีนี้ตัดได้เฉพาะเหตุ 2 ของขั้น 3 (`merged_into_id` น้อยกว่า audit) — การรวมที่ audit ถูกข้าม (เหตุ 1, R12) มี `merged_into_id` แล้วจึงไม่ขึ้นที่นี่
- **ได้ 0** = ไปต่อ
- **มากกว่า 0** = placeholder ที่ถูกรวมก่อนมี audit / `merged_into_id`
  - ประวัติแชทของคนกลุ่มนี้จะไม่ตามไปหน้าลูกค้าจริง
  - ตัดสินก่อนว่ายอมรับ หรือให้ dev เติมมือ

## 6. `backfill:customer-journey` dry-run

🚨 **ห้ามรันช่วง cron (03:00–04:30 น. เวลาไทย)**
- recompute ซ้อนกันแข่งเขียนแถวแคชชุดเดียวกัน
- คอมเมนต์หัว `apps/api/src/cli/backfill-customer-journey.cli.ts` บอกกติกาเดียวกัน

```bash
gcloud run jobs create bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ของ PR นี้> \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest \
  --set-cloudsql-instances=bestchoice-prod:asia-southeast1:bestchoice-db \
  --command=npm --args=--prefix,apps/api,run,backfill:customer-journey \
  --set-env-vars=EXPECTED_DB_NAME=bestchoice --max-retries=0 --task-timeout=3600s
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="bestchoice-backfill-customer-journey"' --project=bestchoice-prod --freshness=2h --limit=200 --format='value(textPayload,jsonPayload.message)'
```

**อ่านผล:**
- ดูบรรทัด `[plan]` ก่อน — ถ้า `unmergedDeletedChatPlaceholders` มากกว่า 0 ให้กลับไปดูคิวรีในขั้น 5 ก่อนรันต่อ (CLI ไม่เตือนแยกให้)
- **exit 0** → ไปขั้น 7
- **exit 1** = ห้องไม่มีเจ้าของเกิน 1% → กลับไปขั้น 4 ห้ามฝืน
- **exit 2** = จำนวน PURCHASED ≠ BOUGHT_WHERE หรือ recompute ล้มบางชุด (`[run] FAILED batch …`) → หยุด ส่ง log ให้ dev
  - log มีแค่ id และตัวเลข

## 7. รันจริง

ช่วงเงียบ — ไม่ใช่ช่วง 03:00–04:30 น. · รันซ้ำได้ (`INSERT … ON CONFLICT`)

```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
```

**ผ่านเมื่อ:**
- MCP `SELECT stage, count(*) FROM customer_journey_states GROUP BY stage ORDER BY 1` มีครบทั้ง 5 ขั้น
- ผลรวมใกล้ `SELECT count(*) FROM customers WHERE deleted_at IS NULL`
- เปิดหน้า `/customers/:id` ของผู้สนใจจริงหนึ่งคน แล้วดูแท็บ "การเดินทาง" และแถบขั้น

## 8. เช้าวันถัดไป

**Sentry error `journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE`:**
- นับเฉพาะคืนหลังขั้น 7 ผ่าน — คืนก่อนหน้านั้นคาดไว้แล้ว (ขั้น 2)
- คืนหลังขั้น 7 ต้องไม่มี
- log ของ cron มี `failedBatches=` — มากกว่า 0 = บางชุดล้ม ให้ดู Sentry ของชุดนั้น
  - ด่าน parity ยังรันทุกคืนแม้บางชุดล้ม

**`journey:entry-guard` (04:00 น.) อาจเตือนผิดได้ 2 กรณี:**
1. **คืนแรกหลัง deploy** — hook เขียน `CONTRACT_ACTIVATED` เฉพาะสัญญาที่เปิดหลัง deploy
   - เปิด `contractIds` ใน extra ของ Sentry แล้วเทียบเวลาเปิดสัญญากับเวลา deploy ก่อนสรุปว่า hook พัง
2. **หลังปิดคำร้อง DSAR ลบข้อมูล** — ถ้าลูกค้าคนนั้นเปิดสัญญาเมื่อวาน (เวลาไทย) guard จะเตือน "hook CONTRACT_ACTIVATED หลุด" หนึ่งครั้ง
   - สาเหตุ: entry ถูกลบตามคำร้อง
   - เทียบ `contractIds` กับคำร้อง DSAR ที่ปิดวันนั้นก่อนสรุปว่าพัง

**MCP `SELECT kind, count(*) FROM customer_journey_entries GROUP BY kind ORDER BY 1`:**
- เริ่มมี `CONTRACT_ACTIVATED` / `CREDIT_CHECK_OPENED_BY` / `LINE_LINKED` ตามงานจริงของวันนั้น
- `CONTACT_ADDED` มาจากหน้าลูกค้าและการเติมเบอร์ของพนักงานเท่านั้น — บอทขายไม่ได้ต่อในเฟสนี้

## 9. PR ต่อท้าย: "ร้านตอบครั้งแรก" นับ echo จากเพจ (`first_staff_reply_at`)

ใช้กับ PR ต่อท้าย #1594 (branch `worktree-feat+customer-journey-p3`) — **web `26.9.29`** · ไม่มี migration
- `journey-state.sql` (`staff_reply` / `auto_anchor`): นับ echo จาก Meta Business Suite/แอป Page · ข้ามข้อความอัตโนมัติของเพจทุกครั้งที่ลูกค้าทัก · ไม่นับคำตอบก่อนข้อความลูกค้าแรกของช่องทางนั้น · ยึดข้ามห้องซ้ำของครอบครัว · ไม่นับข้อความสำเร็จรูปที่ผู้ใช้ระบบส่ง (Quick Reply)
- subscribe `message_echoes` เสมอ — API + แผง Facebook App Review ในเว็บ (`FacebookAppReviewPanel.tsx`) ⇒ เว็บเปลี่ยน จึงขึ้นเลขเวอร์ชัน
- ก่อน PR นี้ขึ้น แคช prod มีค่า `first_staff_reply_at` แค่ 1 จาก 9,067 แถว (ตรวจ 2026-09-15) — กติกาเดิมนับเฉพาะการส่งจาก inbox · ค่านั้นกติกาใหม่ยังให้ค่าเดิม (ตรวจซ้ำใน 9.0 ข้อ 3)
- ขั้น 1–8 ข้างบนทำไปแล้วตอน #1594 — หัวข้อนี้ไม่ต้องทำซ้ำขั้นเหล่านั้น
- ผลจำลองบน prod 2026-09-15 เทียบกติกาคอมมิตก่อนหน้า (`a2a84c8c0`): มีค่า 7,630 → 7,566 ราย · ว่างลง 64 · ช้าลง 113 · เร็วขึ้น 0 · ค่าที่มาก่อนข้อความลูกค้าแรก 117 → 0 · ห่างข้อความลูกค้า ≤3 วิ 17 → 11 (รายละเอียดในข้อความคอมมิต `7f5eeb0cc`)

🚨 **ค่าเริ่มถูกแช่แข็งทันทีที่ image ใหม่รับ traffic — ไม่ต้องรอใครรัน backfill**
- recompute ใช้ `LEAST` (การรวมผู้สนใจใช้ `earliest()`) ⇒ ค่าที่เขียนแล้วเลื่อนไปข้างหน้าไม่ได้อีก
- ผู้เขียนค่ามี 4 ทาง ไม่ใช่แค่ CLI:
  1. เปิดหน้า `/customers/:id` — `journey-summary.service.ts` recompute เมื่อ `needsRecompute`
  2. cron `journey:recompute` 03:30 น. ทุกคืน — คนที่ขยับใน 48 ชม.
  3. 03:30 น. วันอาทิตย์ (คืนเสาร์→อาทิตย์) = sweep ทุกคน (เท่ากับ backfill)
  4. รวมผู้สนใจ `CustomerMergeService.absorbPlaceholder` — ผูกห้องกับลูกค้าจากอินบ็อกซ์ · `POST /customers/:id/absorb-into/:targetId` · LINE ดูดห้องของ placeholder (`chatbot-finance/services/chat-room.service.ts`) · `mergeRooms`
     - ย้ายค่าแคชของ placeholder เข้าคนจริงด้วย `earliest()` แล้ว recompute ทั้งคู่ ⇒ ค่าที่ instance อื่นเขียนไว้ในแถวของ placeholder ไหลต่อไปได้
- deploy จากเครื่อง (ทางสำรองในหัวข้อ 0): build จาก **HEAD ของ PR เท่านั้น** — ห้าม build จาก commit กลางที่นับ echo แต่ยังข้ามข้อความทักทายแค่ใบแรกของห้อง (greeting หลาย bubble / away message รอบหลัง จะกลายเป็นคำตอบแรกปลอมถาวร)

**9.0 ก่อนกด merge**
1. **จด image ของ `bestchoice-api` ที่รับ traffic อยู่** — ใช้ถอย (หัวข้อถอย) และใช้เทียบ image ของ job
   ```bash
   gcloud run services describe bestchoice-api --project=bestchoice-prod --region=asia-southeast1 --format='value(status.traffic)'
   gcloud run revisions describe <REVISION ที่ได้ 100%> --project=bestchoice-prod --region=asia-southeast1 --format='value(spec.containers[0].image)'
   ```
   - คาดว่าได้ `asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:0e38e6d26dd390f1ae4bd53170cea9d0c709922a` (merge commit ของ #1594)
   - **จดค่าที่เห็นจริงบน revision** ไม่ใช่ค่าคาด — ไม่ตรงค่าคาด = ถาม dev ก่อน merge · เรียกค่านี้ว่า `<SHA40 จาก 9.0>`
   - จด release ปัจจุบันของ Firebase site admin (`26.9.28`) ไว้ด้วย — ใช้ถ้าต้องถอยเว็บ
2. **ช่วงเวลา: จันทร์–พฤหัส ช่วงเช้า** · ห้ามวันเสาร์ · ห้าม 03:00–04:30 น.
   - เหตุผล: 9.1 ตรวจเช้าวันถัดไป และถ้าไม่ผ่านต้องมีเวลาตัดสินก่อน sweep 03:30 น. วันอาทิตย์ (ดู 9.1 ทางไม่ผ่าน)
   - ห้าม merge PR อื่นซ้อนจนกว่าจะผ่านด่านหลัง merge ข้างล่าง (หัวข้อ 0)
3. **แคชเดิมยังถูกตามกติกาใหม่** — MCP:
   ```sql
   SELECT count(*) AS states_with_reply,
     count(*) FILTER (WHERE EXISTS (
       SELECT 1 FROM customers f JOIN chat_rooms r ON r.customer_id = f.id
       JOIN chat_messages m ON m.room_id = r.id AND m.role = 'STAFF' AND m.outbound_sent_at IS NOT NULL
       JOIN users u ON u.id = m.staff_id AND u.is_active
       WHERE (f.id = s.customer_id OR f.merged_into_id = s.customer_id) AND m.created_at = s.first_staff_reply_at
         AND m.created_at >= (SELECT MIN(c.created_at) FROM customers f2 JOIN chat_rooms r2 ON r2.customer_id = f2.id
                              JOIN chat_messages c ON c.room_id = r2.id AND c.role = 'CUSTOMER'
                              WHERE (f2.id = s.customer_id OR f2.merged_into_id = s.customer_id) AND r2.channel = r.channel)
     )) AS still_counted
   FROM customer_journey_states s WHERE s.first_staff_reply_at IS NOT NULL;
   ```
   - กติกา #1594 นับการส่งจาก inbox ที่กติกาใหม่ไม่นับ (ก่อนข้อความลูกค้าแรกของช่องทาง · ผู้ใช้ระบบ) — ค่าแบบนั้นที่ค้างในแคชจะถูก `LEAST` เก็บต่อ
   - `mcp_ro` อ่าน `users.is_system_user` ไม่ได้ ⇒ ใช้ `is_active` แทน (ผู้ใช้ระบบ `is_active = false`) — พนักงานที่ปิดบัญชีแล้วจะนับเป็นไม่ตรงด้วย
   - **เท่ากัน** → merge ได้ (ตรวจ 2026-09-15: 1 = 1) · **ไม่เท่า** → ห้าม merge ส่งตัวเลขให้ dev

**ด่านหลัง merge — ต้องผ่านครบก่อนเริ่มนับ 9.1**
- run ของ merge เขียวครบทุก job: `lint-and-test` · `build-and-push-api` · `migrate-db` · `deploy-api` · `deploy-web` (skipped นับเป็นไม่เขียว)
- `curl https://api.bestchoicephone.app/api/health` ok
- บันเดิลของ `https://bestchoicephone.app/` เป็น `26.9.29`
- image ของ revision ที่รับ traffic 100% = `api:<SHA40 ของ merge PR นี้>` — คำสั่งเดียวกับ 9.0 ข้อ 1
- ไม่ผ่านข้อใด = ยังไม่นับว่าขึ้น ห้ามเริ่ม 9.1/9.2 · เว็บขึ้นแต่ API ไม่ขึ้น ไม่ต้องถอยเว็บ (26.9.29 ใช้กับ API ของ #1594 ได้ — เปลี่ยนแค่ค่าตั้งต้นช่อง Subscribe) · หาสาเหตุก่อน merge/รัน pipeline ซ้ำ

**9.1 เช้าหลังคืนแรกของ image ใหม่ (ก่อน backfill)** — cron 03:30 น. เขียนค่าให้คนที่ขยับใน 48 ชม. ไปแล้ว ใช้เป็นตัวอย่างตรวจ

MCP (นับอย่างเดียว):
```sql
SELECT count(*) AS states_with_reply,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM customers f JOIN chat_rooms r ON r.customer_id = f.id JOIN chat_messages c ON c.room_id = r.id AND c.role = 'CUSTOMER'
    WHERE (f.id = s.customer_id OR f.merged_into_id = s.customer_id)
      AND c.created_at BETWEEN s.first_staff_reply_at - interval '3 seconds' AND s.first_staff_reply_at + interval '3 seconds'
  )) AS within_3s_of_customer
FROM customer_journey_states s WHERE s.first_staff_reply_at IS NOT NULL;
```
- `within_3s_of_customer` = คำตอบแรกที่ห่างข้อความลูกค้าไม่เกิน 3 วิ ⇒ หน้าตาเหมือนข้อความอัตโนมัติของเพจ
- จำลองกติกาบน prod ก่อน merge: 11 จาก 7,566 ราย (≈0.15%) — ลูกค้าส่งตามหลัง echo ทั้งที่มีข้อความลูกค้าใน 30 นาทีก่อนหน้า
- **คืนแรกเป็นตัวอย่างเล็ก (หลักร้อย) ⇒ ใช้จำนวน ไม่ใช้ %:**
  - **`within_3s_of_customer` ไม่เกิน 3 แถว** → ไป 9.2
  - **มากกว่า 3** → ห้ามรัน backfill · ส่ง `customer_id` ให้ dev (id ไม่ใช่ PII):
    ```sql
    SELECT s.customer_id FROM customer_journey_states s
    WHERE s.first_staff_reply_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM customers f JOIN chat_rooms r ON r.customer_id = f.id JOIN chat_messages c ON c.room_id = r.id AND c.role = 'CUSTOMER'
      WHERE (f.id = s.customer_id OR f.merged_into_id = s.customer_id)
        AND c.created_at BETWEEN s.first_staff_reply_at - interval '3 seconds' AND s.first_staff_reply_at + interval '3 seconds')
    ORDER BY 1 LIMIT 50;
    ```
- **ทางไม่ผ่าน — ตัดสินก่อน 03:30 น. วันอาทิตย์ถัดไป** (sweep เขียนทุกคนด้วยกติกานี้) เลือกหนึ่งทาง:
  - (ก) ถอย image ตามหัวข้อ "ถอยเพราะกติกา" ทั้งชุด ก่อนคืนวันเสาร์
  - (ข) ยอมให้ sweep เขียน แล้ว PR แก้กติกาต้องมาพร้อม reset คอลัมน์ + คำนวณใหม่ (หัวข้อถอย ข้อ 3–5 แต่ใช้ image ของ PR แก้)
  - ระหว่างรอ cron 48 ชม. และการเปิดหน้าลูกค้ายังเขียนค่าทุกวันอยู่แล้ว — ยิ่งรอ ยิ่งมีแถวให้ล้าง แต่ reset ล้างทั้งคอลัมน์ทีเดียวได้เสมอ

**9.2 backfill** — job `bestchoice-backfill-customer-journey` มีอยู่แล้วจาก #1594 (ขั้น 6) และ**ยังถือ env เขียนจริงจากขั้น 7** ⇒ ห้ามทำตามขั้น 6–7 ตรง ๆ (`jobs create` ซ้ำไม่ได้ · "dry-run" บน job ที่ถือ env ขั้น 7 = เขียนจริง)
- 🚨 ห้ามรันช่วง 03:00–04:30 น. เหมือนเดิม
- หรือไม่รัน แล้วรอ sweep 03:30 น. วันอาทิตย์ (ค่าเข้าแคชครบในคืนนั้นเอง)

dry-run — เปลี่ยน image + ถอด env เขียนจริง แล้วตรวจก่อนรัน:
```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ของ merge PR นี้> \
  --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV
gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --format='value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="bestchoice-backfill-customer-journey"' --project=bestchoice-prod --freshness=2h --limit=200 --format='value(textPayload,jsonPayload.message)'
```
- `describe` ต้องเห็น image = `<SHA40 ของ merge PR นี้>` และ env มีแค่ `EXPECTED_DB_NAME` — ไม่ตรงห้าม execute
- อ่านผลแบบขั้น 6 (exit 0 ไปต่อ · exit 1/2 หยุด)

รันจริง:
```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV
```
- คำสั่งสุดท้ายถอด env ทันทีหลังรัน — job ที่ค้าง env เขียนจริงคือกับดักของ dry-run ครั้งหน้า
- หลังรัน: คิวรี 9.1 ซ้ำกับทั้งประชากร — `states_with_reply` ควรใกล้ 7,566 และ **`within_3s_of_customer` ไม่เกิน 1% ของ `states_with_reply`** (จำลอง ≈0.15%) · เกิน → ทางไม่ผ่านของ 9.1

## ถอย (rollback)

### ถอย API
```bash
gcloud run services update bestchoice-api --project=bestchoice-prod --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ก่อน PR นี้>
```
- `<SHA40 ก่อน PR นี้>` = image ที่จดไว้ในข้อ 1.5 — PR เดียว ⇒ เป็น image **ก่อนทั้งเฟส 0 และแผน 1** (ไม่ใช่ image ของแผน 1 อีกแล้ว)
- 🚨 **ถอย API = ถอยเว็บพร้อมกันเสมอ** — image ก่อน PR นี้ไม่มี `GET /customers/:id/detail` ที่เว็บ 26.9.28 ใช้
- schema เป็นแบบเพิ่มอย่างเดียว — image เก่ารันบนฐานที่ลง migration แล้วได้ **เฉพาะก่อนขั้น 4**
- 🚨 **ถอย API ไป image ก่อน merge ปลอดภัยเฉพาะก่อน `backfill:chat-prospects` (ขั้น 4) รัน**
  - image นั้นเกิดก่อนเฟส 0 — Prisma client ของมันยังถือว่า `customers.phone` ไม่ว่าง และ**ไม่เคยรันกับลูกค้าราว 9 พันแถวที่ `phone` ว่าง** ซึ่งขั้น 4 สร้างขึ้น
  - **หลังขั้น 4 รันแล้ว:** ทางหลักคือ **แก้ไปข้างหน้า** (PR แก้บั๊กแล้วให้ pipeline ขึ้น)
  - ถ้าจำเป็นต้องถอยจริง: ถอย **เว็บและ API พร้อมกัน** และต้องตรวจก่อนบนสำเนาฐานที่ผ่านขั้น 4 แล้ว ว่าหน้ารายชื่อลูกค้าและหน้ารายละเอียดลูกค้าของผู้สนใจที่ `phone` ว่างเปิดได้กับ image เก่า — ยังไม่เคยมีใครทดสอบ
  - อ่านเรื่องถอยใน runbook ของ PR #1592 ประกอบ
- ไม่มี down-migration · **ห้ามลบตาราง/คอลัมน์เอง**

### ถอยเพราะกติกา "ร้านตอบครั้งแรก" (หัวข้อ 9)
ถอย image **อย่างเดียวไม่พอ** (`LEAST` เก็บค่าที่ image ใหม่เขียนไว้ต่อ) และ**เป็นของชั่วคราว** (push ถัดไปเข้า main ขึ้นกติกา echo ทับคอลัมน์ที่เพิ่งล้าง) — ทำครบตามลำดับ:

1. **ถอย `bestchoice-api`** ไป image ที่จดใน 9.0 ข้อ 1:
   ```bash
   gcloud run services update bestchoice-api --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 จาก 9.0>
   ```
   - 🚨 ไม่ใช่ `<SHA40 ก่อน PR นี้>` ของหัวข้อ "ถอย API" — ตัวนั้นเป็น image ก่อนเฟส 0 ใช้ได้เฉพาะก่อนขั้น 4 ซึ่งผ่านไปแล้ว
   - เว็บไม่ต้องถอย — 26.9.29 ต่างจาก 26.9.28 แค่ค่าตั้งต้นช่อง Subscribe ในแผง Facebook App Review (endpoint เดิม)
2. **ทำให้ถอยถาวร ก่อน merge อะไรเข้า main อีก** — PR ที่ `git revert` คอมมิตกติกาใน `journey-state.sql` (คอมมิตพวกนี้พา DB spec + สเปคคู่กันมาด้วย จึง revert ทั้งคอมมิต):
   - `aecaff4a3` นับ echo · `b2e446a13` ข้ามช่วงอัตโนมัติ · `a2a84c8c0` ยึดทุกครั้งที่ลูกค้าทัก · `7f5eeb0cc` ด่านข้อความลูกค้าแรก/ห้องซ้ำ/ผู้ใช้ระบบ
   - ตรวจบน main ว่าครบด้วย `git log --oneline -- apps/api/src/modules/customer-journey/sql/journey-state.sql`
   - merge PR revert เป็นอันดับแรก — จนกว่าจะ merge ห้าม merge PR อื่นใด (ทุก push ขึ้น HEAD ทั้งชุด)
   - ขึ้นกติกา echo กลับภายหลัง (roll forward) **ต้องมาพร้อมขั้น reset ข้อ 3–5 ของตัวเอง** — ค่าที่ #1594 เขียนระหว่างถอย (ส่งจาก inbox ก่อนข้อความลูกค้าแรก / ข้อความสำเร็จรูปของผู้ใช้ระบบ) กติกา echo ไม่นับ ⇒ ไม่ reset = แช่แข็งค่าที่เร็วไป
3. **รอให้ instance ของกติกาใหม่หมดก่อน reset** — ไม่งั้นหน้าลูกค้า/cron/การรวมผู้สนใจบน instance เก่าเขียนค่าที่เร็วไปกลับเข้ามาหลัง `UPDATE`
   ```bash
   gcloud run services describe bestchoice-api --project=bestchoice-prod --region=asia-southeast1 --format='value(status.traffic)'
   ```
   - revision ของ `<SHA40 จาก 9.0>` ได้ 100%
   - revision ของ PR นี้ไม่มี instance เหลือ: Cloud Run console → `bestchoice-api` → Metrics → Container instance count แยกตาม revision = 0 · ดูไม่ได้ให้รอ ≥ 60 นาทีหลังสลับ traffic (timeout ของ service 3600 วิ)
   - นอกช่วง 03:00–04:30 น.
4. **reset** ด้วย role เจ้าของ (MCP เขียนไม่ได้):
   ```sql
   UPDATE customer_journey_states SET first_staff_reply_at = NULL;
   ```
   - ครอบแถวแคชของ placeholder ที่ยังไม่ถูกรวมด้วย ⇒ การรวมผู้สนใจหลังจากนี้ (`earliest()`) ไม่พาค่าเก่ากลับมา
5. **คำนวณใหม่ทันที** ด้วย job ที่ image ตรงกับข้อ 1 — 9.2 เปลี่ยน image ของ job เป็น SHA ของ PR นี้ไปแล้ว:
   ```bash
   gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 จาก 9.0> \
     --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
   gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --format='value(spec.template.spec.template.spec.containers[0].image)'
   gcloud run revisions describe <REVISION ที่ได้ 100% จากข้อ 3> --project=bestchoice-prod --region=asia-southeast1 --format='value(spec.containers[0].image)'
   ```
   - สองบรรทัดหลังต้องได้ image **เดียวกัน** — ไม่ตรงห้าม execute (คำนวณใหม่ด้วยกติกาที่เพิ่งถอยออก = แช่แข็งซ้ำ)
   - แล้ว `gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait`
   - จบแล้วถอด env: `gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV`
- ถอยไป `<SHA40 จาก 9.0>` ด้วยเหตุผลอื่นที่ไม่เกี่ยวกับกติกานี้ = ไม่ต้องล้างตอนถอย · แต่ตอนขึ้นกลับให้รันคิวรี 9.0 ข้อ 3 ก่อน (ค่าที่ #1594 เขียนระหว่างถอยต้องยังนับได้ตามกติกาใหม่ · ไม่เท่า = reset ข้อ 3–5 ด้วย image ใหม่)

### ถอยเว็บ
- **ทางมือ:** Firebase console → Hosting → site admin (`bestchoicephone.app`) → ประวัติ release → Rollback ไป release ที่จดไว้ในข้อ 1.5
  - ไม่พบคำสั่งถอย Firebase Hosting ในรีโป (`docs/guides/DEPLOY.md` · `workflows/deploy.md` · job `deploy-web`) — ทางคอนโซลคือทางที่มี
  - site shop (`www.bestchoicephone.com`) ไม่ต้องถอย — branch นี้ไม่แตะ `apps/web-shop`
- เว็บที่ถอยแล้วใช้กับ API เก่าได้ · ถ้าถอยเฉพาะเว็บเพราะ `build-and-push-api` / `migrate-db` / `deploy-api` ไม่เขียว (รวม skipped): หลังแก้สาเหตุ push ถัดไปเข้า main จะขึ้นเว็บใหม่อีกครั้ง
- ถอยถาวร = revert PR นี้ (ดูหัวข้อถัดไป) — `workflows/deploy.md` เขียนไว้ว่า "revert commit + redeploy"

### 🚨 การถอย image เป็นของชั่วคราว
- push ถัดไปเข้า main จะขึ้น HEAD ใหม่ทั้งชุด
- ถ้าจะถอยถาวร: revert PR นี้ แล้วให้ pipeline ขึ้นโค้ดเก่า
  - migration ยังอยู่ ไม่เป็นไรเพราะเป็นแบบเพิ่มอย่างเดียว

### ระหว่างช่วงที่ถอยอยู่
- image ก่อน PR นี้ยังไม่มีโค้ดเฟส 0 ⇒ ไม่สร้าง/ไม่รวมผู้สนใจ · bot/hook ไม่เขียน entry ใหม่
- ถ้าถอยไปใช้ image อื่นที่มีเฟส 0 แต่ไม่มีแผน 2 (เช่น build มือจาก commit กลาง): โค้ดนั้นรวมผู้สนใจ **โดยไม่ตั้ง `merged_into_id`** แต่ยังเขียน audit `CUSTOMER_PLACEHOLDER_MERGED` และไม่ย้ายบันทึกการเดินทางของ placeholder

### หลังกลับมาใช้ image ใหม่ (roll forward)
1. รันคิวรีขั้น 5 — มากกว่า 0 = มีการรวมระหว่างช่วงถอย
2. ถ้ามากกว่า 0: รันบล็อก `-- journey-backfill:start` … `-- journey-backfill:end` ใน `migration.sql` ซ้ำด้วย role เจ้าของ
   - รันซ้ำได้ แตะเฉพาะ placeholder ที่ถูกลบแล้วและยังไม่มี `merged_into_id`
   - บล็อกนี้สร้างลิงก์จาก audit ที่โค้ดเก่ายังเขียน
3. คำนวณแคชใหม่: รัน `backfill:customer-journey` (ขั้น 6–7) หรือรอ sweep คืนวันอาทิตย์
   - บันทึกที่ค้างใต้ id ของ placeholder ถูกนับผ่าน `merged_into_id` — แท็บและแคชอ่านผ่าน family ทั้งคู่ ไม่ต้องย้ายแถว
- ข้อจำกัด: การรวมช่วงถอยที่ audit ถูกข้าม (หา system user ไม่เจอ) บล็อกนี้ซ่อมไม่ได้
  - คิวรีขั้น 5 จะยังเหลือมากกว่า 0 ให้ตัดสินแบบเดียวกับขั้น 5

### ถอยกรณี index ไม่ทัน (ด่าน 1.2)
- ใช้คำสั่งถอย API ข้างบน **ก่อน 03:00 น.** และถอยเว็บพร้อมกัน
- ใช้ได้เฉพาะ **ก่อนขั้น 4** (`backfill:chat-prospects`) — กรณี EXPLAIN ช้าหลัง merge จึงห้ามรันขั้น 4 จนกว่า EXPLAIN จะผ่าน · ถ้าขั้น 4 รันไปแล้ว ให้แก้ไปข้างหน้า (ดู "ถอย API")
- แล้วค่อยขึ้นใหม่พร้อม index ใน PR ต่อท้าย

## Factory reset (Ruling FR-RESET)

- `factory:reset` ล้าง `customer_journey_entries` และ `customer_journey_states` **ทั้งตาราง** (`apps/api/src/cli/factory-reset-tables.ts`)
  - แม้ reset จะเก็บตาราง customers, ห้องแชท และการผูก LINE ไว้
- **หลัง factory reset ทุกครั้ง:** รัน `backfill:customer-journey` (ขั้น 6–7)
  - แคชขั้นกลับมาจากข้อมูลธุรกิจที่เหลือ
- **ประวัติเหตุการณ์หายถาวรโดยตั้งใจ** เช่น `PLACEHOLDER_MERGED` · `LINE_LINKED` · `BOT_HANDOFF` · `CONTACT_ADDED`
  - ไม่มีทางสร้างกลับ
  - ไทม์ไลน์เริ่มนับใหม่จากวันที่ reset

## เรื่องที่รู้แล้วและยอมรับ

**`first_staff_reply_at` แช่แข็ง — เลื่อนไปข้างหน้าไม่ได้**
- recompute ใช้ `LEAST` และการรวมผู้สนใจใช้ `earliest()` ⇒ ค่าที่เขียนลงแคชแล้วถูกแทนได้เฉพาะค่าที่เก่ากว่า
- เริ่มแช่แข็งตั้งแต่ image รับ traffic (เปิดหน้าลูกค้า + cron 03:30 น.) ไม่ใช่ตอน backfill — ขั้นตอนหลัง deploy อยู่ในหัวข้อ 9
- วันหน้าถ้าทำกติกา `staff_reply` / `auto_anchor` ใน `journey-state.sql` ให้แคบลง (ตัดแถวที่เคยนับ): ต้องมี `UPDATE customer_journey_states SET first_staff_reply_at = NULL` ใน PR เดียวกัน แล้วค่อยคำนวณใหม่ · การถอย image ที่กติกาแคบกว่าก็เข้าข้อนี้ (หัวข้อถอย)
  - "แคบกว่า" ดูทีละข้อ ไม่ใช่ทั้งชุด: กติกาของ #1594 แคบกว่าเรื่อง echo แต่**กว้างกว่า**เรื่องส่งจาก inbox (นับแถวก่อนข้อความลูกค้าแรกและข้อความสำเร็จรูปของผู้ใช้ระบบ) ⇒ ทั้งถอยไป #1594 และขึ้นกลับจาก #1594 ต้องคิดเรื่อง reset (หัวข้อถอย + 9.0 ข้อ 3)
- ทิศกลับ (ผ่อนกติกาให้นับเพิ่ม) ไม่ต้อง reset — LEAST รับค่าที่เก่ากว่าเอง
- ค่าที่ยังเร็วไปโดยรู้ตัว (แช่แข็งถาวร):
  - 11 จาก 7,566 ราย (จำลองบน prod 2026-09-15) ที่ลูกค้าส่งตามหลัง echo ≤3 วิ ขณะมีข้อความลูกค้าใน 30 นาทีก่อนหน้า
  - ห้องที่ `mergeRooms` รวมข้ามช่องทาง: ข้อความลูกค้าช่องทางอื่นที่ย้ายมาทำให้ greeting ที่มาภายใน 30 นาทีหลังข้อความนั้นถูกนับ — แยกช่องทางเดิมของข้อความไม่ได้ · prod ยังไม่เคยมีห้องที่ถูกรวม (ไม่มี `chat_rooms` ที่ soft-delete เลย)
- ครอบครัวที่ไม่มีข้อความลูกค้าเลย (เพจทักก่อน — 56 ราย) = ว่าง ไม่ได้ค่าจาก echo ใบแรกอีกแล้ว
- **งานต่อ (ยังไม่ทำ):** เก็บ `message.app_id` ของ echo Facebook ลงคอลัมน์ใหม่แบบ additive nullable บน `chat_messages` + grant ให้ `mcp_ro`
  - วันนี้ webhook log `app_id` ไว้ในบรรทัด `[FB Webhook] Echo …` แต่ไม่เก็บ ⇒ กติกา anchor ต้องเดาจากเวลา
  - ก่อนเพิ่มคอลัมน์: วัดการกระจายของ `app_id` จาก Cloud Logging ก่อน (นับอย่างเดียว — บรรทัดนั้นมี PSID) ว่าแยกข้อความอัตโนมัติของเพจออกจากคนตอบได้จริงไหม

**callLog / payment ที่ถูก soft-delete**
- ไทม์ไลน์ติดตามหนี้เดิมและแท็บการเดินทางยังแสดงแถวเหล่านี้ (golden ของ Task 7 ล็อกพฤติกรรมเดิม)
- deploy นี้คือการเปิดใช้วงกว้างเลย — แท็บเปิดให้ 5 role ทันทีที่ขึ้น ไม่มีสวิตช์
- **แต่วันนี้ไม่มีตัวเขียนไหนสร้างแถวแบบนั้น:** แหล่งยอดชำระอ่านเฉพาะงวดที่จ่ายแล้ว และยกเลิกสัญญาทำได้เฉพาะเมื่อไม่มีงวดที่จ่าย
- ถ้าวันหน้าเพิ่มการลบแบบ soft: แก้ `apps/api/src/modules/overdue/contract-event-sources.ts` + golden ใน PR เดียวกัน

**สิทธิ์ขอเข้าถึงข้อมูล (DSAR ACCESS)**
- ไฟล์ส่งออกรวม `journey.entries` / `journey.states` ของลูกค้าและ placeholder ที่ถูกรวมเข้ามา — ids ชุดเดียวกับการลบ
- ไฟล์จึงใหญ่ขึ้นเล็กน้อย

**ผูกกันสองที่**
- `credit-check/services/room-credit-access.ts` (`creditHistoryAccess`) มี whitelist บทบาทแชทของตัวเอง
- ถ้าเปลี่ยน `JOURNEY_HIDDEN_GROUPS` ของกลุ่มแชท ต้องแก้ไฟล์นั้นคู่กัน
- summary ใช้ `creditHistoryAccess` กับธง `creditRejected` ด้วย
