# Runbook — ซ่อมเบอร์โทรลูกค้า + รายงานเบอร์ซ้ำ (prod, manual)

_2026-09-17 · คำตัดสินเจ้าของข้อ 2 (ซ่อมข้อมูลเก่าทีละขั้น) + ข้อ 4 (คู่ซ้ำแก้ทีละคู่ด้วยมือ) ·
CLI `repair:customer-phones` (`apps/api/src/cli/repair-customer-phones.cli.ts` → dist) ·
workflow **Repair Customer Phones (prod)** (`.github/workflows/repair-customer-phones.yml`) ·
DRY-RUN เป็นค่าเริ่มต้น · รันซ้ำได้ (รอบสองไม่มีอะไรต้องเขียน)_

---

> ## ⚠️ อ่านก่อนแตะอะไรทั้งสิ้น
>
> **1. ต้อง deploy โค้ดชุดนี้ก่อน** — Job รัน `node apps/api/dist/src/cli/repair-customer-phones.cli.js`
> จาก image `api:latest` (`Dockerfile:90` copy แค่ `apps/api/dist`) ถ้ายังไม่ deploy ไฟล์นี้ไม่มีใน image
> และ Job จะล้มทันทีด้วย `Cannot find module`
>
> **2. ต้อง deploy ก่อนด้วยเหตุผลที่สอง** — ผู้เขียนเบอร์ทุกทางในโค้ดชุดนี้ (พนักงาน / บอทขาย /
> skip-tracing / นำเข้า / stub รับซื้อ) normalize เบอร์และเขียน `phone_hash` + `phone_encrypted` แล้ว
> ถ้าซ่อมก่อน deploy โค้ดเก่ายังสร้างแถวเสียเพิ่มได้ระหว่างนั้น (ไม่อันตราย แต่ต้องรันซ้ำ)
>
> **3. CLI ไม่รวมลูกค้า ไม่ลบลูกค้า ไม่บล็อกเบอร์ซ้ำ** — มันทำแค่ (ก) จัดรูปแบบเบอร์ (ข) เติม/แก้
> `phone_hash` / `phone_encrypted` / `phone_secondary_encrypted` ให้ตรงกับเบอร์ในแถว (ค) รายงานกลุ่ม
> ลูกค้าที่ถือเบอร์หลักเดียวกัน ส่วนการแก้คู่ซ้ำเป็นงานมือทีละคู่ (ขั้น ⑥)
>
> **4. plaintext ในคอลัมน์ `phone` คือความจริง** — แถวที่ hash/ciphertext ค้างของเบอร์เก่า (บั๊ก
> skip-tracing เดิมเปลี่ยน `phone` โดยไม่เขียน hash ใหม่) จะถูกเขียนทับตามเบอร์ใน `phone`

## CLI ทำอะไรกับแต่ละแถว

ขอบเขต: `customers` ที่ `deleted_at IS NULL` และมี `phone` หรือ `phone_secondary` ไม่ว่าง

| สถานการณ์ | สิ่งที่ APPLY เขียน | ตัวนับในรายงาน |
|---|---|---|
| `phone` ไม่อยู่ในรูปแบบ normalize (`081-234 5678`, `+66…`) | `phone` = รูปแบบใหม่ + hash/ciphertext ใหม่ | `primary format changed` |
| `phone_hash` ว่าง / ไม่ตรงกับเบอร์ | `phone_hash` ใหม่ (+ ciphertext ใหม่) | `hash fixed (filled/stale)` |
| `phone_encrypted` ว่าง / ถอดแล้วไม่ใช่เบอร์นี้ / เป็น plaintext | `phone_encrypted` ใหม่ | `encrypted filled` / `encrypted stale` |
| `phone_secondary` ไม่ normalize หรือ `phone_secondary_encrypted` ว่าง/ไม่ตรง | ทั้งสองคอลัมน์ | `secondary fixed` |
| เบอร์หลัง normalize ไม่ใช่ `0` + 9 หลัก | ซ่อมตามปกติ **ไม่ลบ** + ลงรายชื่อ id | `invalid primary` / `invalid secondary` |
| `phone_encrypted` ถอดรหัสไม่ได้ | **ไม่แตะแถวนั้นเลย** + ลงรายชื่อ id | `decrypt failed (skipped)` |
| มีคนแก้แถวระหว่างที่ CLI รอเขียน | ข้าม ไม่ทับค่าใหม่ | `changed meanwhile` |

- เขียน**ทีละแถว คนละทรานแซกชัน**: ล็อกเบอร์หลักก่อน (ล็อกตัวเดียวกับฝั่งพนักงาน/บอท) แล้ว update
  แบบมีเงื่อนไขว่าค่าทั้งห้าคอลัมน์ยังเหมือนตอนสแกน
- แถวที่ไม่มี `phone` เหลือแต่มี `phone_hash` ไม่ถูกซ่อม แต่ถูกนับเข้ากลุ่มเบอร์ซ้ำ (`hashOnly: true`)
- **ด่านกุญแจ**: ถ้า ciphertext ถอดไม่ได้ ≥ 10% (ขั้นต่ำ 5 แถว หรือทุกแถว) หรือ hash ไม่ตรงทั้งที่
  ciphertext ตรง ≥ 10% ⇒ กุญแจ/salt ของ Job ไม่ใช่ของฐานนี้ ⇒ APPLY **หยุดก่อนเขียนแถวแรก**
  (log `ABORTED: …`, exit 1) · DRY-RUN แสดงเป็น `WARNING (APPLY จะถูกหยุด): …`
- APPLY เขียน `audit_logs` หนึ่งแถว action `CUSTOMER_PHONE_REPAIR_RUN` (entity `customer`,
  ตัวเลขอย่างเดียว) ด้วยผู้ใช้ระบบ
- log ไม่มีชื่อ/เบอร์/เลขบัตร มีแต่ตัวนับกับ id (แถวที่เขียนพลาดแสดงแค่ 6 ตัวท้ายของ id)

## ตัวแปรที่ต้องเตรียม

```bash
export PROJECT_ID=<GCP_PROJECT_ID เช่น bestchoice-prod>
export REGION=asia-southeast1
export JOB=bestchoice-repair-customer-phones
export PROD_DB_NAME=bestchoice        # ชื่อฐาน prod จริงคือ "bestchoice"
```

> guard ทั้งหมดรับจาก ENV: `EXPECTED_DB_NAME` (บังคับ), `PII_ENCRYPTION_KEY` (hex 64 ตัว) +
> `PII_HASH_SALT` (≥ 32 ตัว) บังคับแม้ dry-run, `APPLY=YES_I_AM_SURE` (ไม่ใส่ = DRY-RUN),
> `ALLOW_PROD_REPAIR=YES_I_AM_SURE` (บังคับตอน APPLY เมื่อ `NODE_ENV=production` **หรือ** ฐานชื่อ
> `bestchoice`), `REPAIR_BATCH_SIZE` (ค่าเริ่มต้น 200) · หน่วง 5 วินาทีก่อนเขียนจริง
> workflow ดึงกุญแจจาก Secret Manager ชื่อเดียวกับ service `bestchoice-api`
> (`pii-encryption-key`, `pii-hash-salt`) — ถ้า Job ขึ้น `Permission denied on secret` ให้ให้สิทธิ์
> `roles/secretmanager.secretAccessor` กับ service account ของ Job ก่อน

---

## ① Backup ก่อนเสมอ (ก่อน APPLY — dry-run ไม่ต้อง)

PITR ไม่ใช่ข้อแทน — กฎบ้านคือสร้าง backup แบบ on-demand ก่อนแก้ข้อมูลทุกครั้ง

```bash
gcloud sql backups create --instance=bestchoice-db \
  --project=$PROJECT_ID \
  --description="before customer phone repair $(date +%F)"
gcloud sql backups list --instance=bestchoice-db --project=$PROJECT_ID --limit=3
```

**จดเลข backup id ลงใน PR / แชท** ก่อนไปขั้น ④

## ② ยืนยันว่า deploy ที่มี CLI ขึ้นแล้ว

```bash
gh run list --workflow deploy-gcp.yml --branch main --limit 3
```

ต้องเห็น run ที่ commit ของงานนี้เป็น `success` (image `:latest` ที่ Job หยิบไป = build ของ run นั้น)
ถ้ายังแดง/ยังไม่จบ **หยุด**

## ③ DRY-RUN — อ่านรายงานให้เจ้าของดูก่อน

GitHub Actions → workflow **Repair Customer Phones (prod)** → `Run workflow` →
`expected_db_name = bestchoice`, `mode = dry-run`

หรือด้วย gcloud (หลังจาก workflow สร้าง Job ไว้แล้วอย่างน้อยหนึ่งครั้ง):

```bash
gcloud run jobs update $JOB --project=$PROJECT_ID --region=$REGION \
  --set-env-vars=TZ=Asia/Bangkok,EXPECTED_DB_NAME=$PROD_DB_NAME
gcloud run jobs execute $JOB --project=$PROJECT_ID --region=$REGION --wait
```

> `--set-env-vars` แทนที่ env ทั้งชุด — ขั้นนี้จึงลบ `APPLY` ที่อาจค้างจากรอบก่อนไปด้วย

### อ่าน log

```bash
gcloud run jobs executions list --job=$JOB --project=$PROJECT_ID --region=$REGION --limit=1
gcloud beta run jobs executions logs read <execution-id> --project=$PROJECT_ID --region=$REGION
```

ทุกบรรทัดขึ้นต้นด้วย `[repair-customer-phones]` ต้องเห็นครบก่อนไปต่อ:

1. บรรทัดบนสุด `DB: "bestchoice" | mode: DRY-RUN` — ชื่อฐานอื่น = ต่อผิดฐาน **หยุด**
2. บล็อก `===== SUMMARY (DRY-RUN) =====` — ตัวนับตามตารางข้างบน
3. **ต้องไม่มี** บรรทัด `WARNING (APPLY จะถูกหยุด)` — ถ้ามี = กุญแจ/salt ใน Secret Manager ไม่ตรงกับ
   ข้อมูลในฐาน **หยุดแล้วถามเจ้าของ** (ห้ามไปหากุญแจอื่นมาลองเอง)
4. บรรทัด `REPORT_JSON {...}` — ตัวเลขชุดเดียวกัน + `invalidIds` / `invalidSecondaryIds` /
   `decryptFailedIds` (สูงสุด 500 id ต่อรายการ ยอดนับยังเต็ม)
5. บรรทัด `DUPLICATE_GROUP n/N {...}` บรรทัดละกลุ่ม (ดูขั้น ⑥)
6. บรรทัดล่างสุด `DRY-RUN — ยังไม่เขียนอะไร …`

**ส่งให้เจ้าของดูก่อน APPLY**: ตัวเลขใน SUMMARY + จำนวนกลุ่มเบอร์ซ้ำ + จำนวน invalid
ตัวเลขที่ควรสะดุด:
- `hash fixed` ส่วน `stale` สูงผิดปกติ (หลักพัน) ทั้งที่ `salt suspect` เป็น 0 → ถามก่อน
- `decrypt failed` มากกว่าหลักหน่วย → ถามก่อน (แถวพวกนี้จะไม่ถูกแตะอยู่แล้ว)

## ④ APPLY (หลังเจ้าของเห็นรายงาน ③ และมี backup ①)

GitHub Actions → workflow เดิม → `mode = apply` (workflow ใส่ `APPLY` / `ALLOW_PROD_REPAIR` /
`NODE_ENV=production` ให้เอง)

หรือด้วย gcloud:

```bash
gcloud run jobs update $JOB --project=$PROJECT_ID --region=$REGION \
  --set-env-vars=TZ=Asia/Bangkok,EXPECTED_DB_NAME=$PROD_DB_NAME,APPLY=YES_I_AM_SURE,ALLOW_PROD_REPAIR=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute $JOB --project=$PROJECT_ID --region=$REGION --wait
```

ใน log ต้องเห็น `mode: APPLY`, `APPLY starting in 5s`, บรรทัด `...written N/N`, บล็อก
`===== SUMMARY (APPLY) =====` ที่มี `written` / `changed meanwhile` / `failed` และ `Done.`

- `ABORTED: …` = ด่านกุญแจหยุด **ไม่มีอะไรถูกเขียน** (exit 1) — กลับไปขั้น ③ ข้อ 3
- `failed` > 0 = บางแถวเขียนไม่ผ่าน (log แสดง 6 ตัวท้ายของ id + รหัส error) Job จะ exit 1
  ทั้งที่แถวอื่นเขียนแล้ว — รัน APPLY ซ้ำได้ (แถวที่เสร็จแล้วไม่ถูกแตะอีก) ถ้ายังพลาดแถวเดิม ส่ง id ท้ายให้ dev
- `changed meanwhile` > 0 = มีคนแก้แถวนั้นระหว่างรัน ไม่ใช่ error — รันซ้ำเพื่อเก็บตก

## ⑤ ตรวจผล

รัน **DRY-RUN อีกรอบ** (ขั้น ③) — ต้องได้ `needs repair (would-write): 0` (ยกเว้นแถวใน
`decrypt failed` ซึ่งไม่ถูกแตะโดยตั้งใจ) และจำนวนกลุ่มเบอร์ซ้ำเท่าเดิม

ตรวจเพิ่มด้วย SQL อ่านอย่างเดียว (ผู้ปฏิบัติที่ได้รับอนุญาต ผ่าน cloud-sql-proxy — **ห้ามผ่าน MCP**):

```sql
-- ต้องได้ 0: แถวที่มีเบอร์แต่ไม่มี hash/ciphertext
SELECT count(*) FROM customers
WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''
  AND (phone_hash IS NULL OR phone_encrypted IS NULL);

-- ต้องได้ 0: รูปแบบที่ยังไม่ normalize (ช่องว่าง ขีด วงเล็บ +66)
SELECT count(*) FROM customers
WHERE deleted_at IS NULL AND phone ~ '[\s()+-]';

-- audit ของรอบ APPLY
SELECT created_at, new_value FROM audit_logs
WHERE action = 'CUSTOMER_PHONE_REPAIR_RUN' ORDER BY created_at DESC LIMIT 3;
```

## ⑥ แก้กลุ่มเบอร์ซ้ำทีละคู่ (ด้วยมือ — คำตัดสินข้อ 4)

แต่ละบรรทัด `DUPLICATE_GROUP` คือลูกค้าที่ยังไม่ถูกลบซึ่งถือเบอร์หลักเดียวกัน:

```json
{"customerIds":["…","…"],"hasBotOrChat":true,
 "members":[{"id":"…","origin":"BOT","acquisitionSource":"AI_CHAT","createdAt":"…","hashOnly":false,"contracts":0,"sales":0}, …]}
```

- `origin`: `BOT` = ที่มาขึ้นต้น `AI_CHAT` (บอทขายสร้าง/แตะ) · `CHAT` = ที่มาขึ้นต้น `CHAT_`
  (ผู้สนใจจากแชทที่เติมเบอร์แล้ว) · `OTHER` = พนักงาน/อื่น ๆ
- กลุ่มที่มีแถวบอท/แชทอยู่บนสุด และในกลุ่มเรียงบอท/แชทก่อน แล้วเก่าก่อน
- `contracts` = จำนวนสัญญาทุกสถานะที่ยังไม่ถูกลบ · `sales` = ใบขายที่ยังไม่ถูกยกเลิก

**ทีละกลุ่ม:**

1. เปิด `/customers/<id>` ของทุกคนในกลุ่ม ยืนยันด้วยตาว่าเป็นคนเดียวกันจริง (ชื่อ เลขบัตร ห้องแชท)
   ถ้า**ไม่ใช่**คนเดียวกัน (ใช้เบอร์ร่วมกันจริง เช่น ครอบครัว) → จดไว้ ปล่อยไว้ แจ้งเจ้าของ
2. เลือกคน**ที่เก็บไว้** = คนที่มีสัญญา/ใบขาย ถ้าไม่มีใครมีเลยให้เก็บคนที่ข้อมูลครบกว่า (มีเลขบัตร)
3. คนที่จะ**ลบ** ต้องมี `contracts = 0` **และ** `sales = 0` เท่านั้น
   ถ้าทั้งสองฝั่งมีสัญญาหรือใบขาย → **หยุด ส่งให้เจ้าของตัดสิน** (เอกสารทางกฎหมาย/บัญชี ห้ามย้ายเอง)
4. **ลบแบบ soft delete** ด้วย SQL ที่ผ่านการตรวจแล้ว (หน้าลูกค้า**ไม่มีปุ่มลบ** — API
   `DELETE /customers/:id` เป็น OWNER เท่านั้นและกันแค่สัญญาที่ยังเปิด จึงหลวมกว่ากติกาข้อ 3):

   ```sql
   BEGIN;
   UPDATE customers SET deleted_at = now(), updated_at = now()
   WHERE id = '<id-ที่จะลบ>' AND deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM contracts WHERE customer_id = '<id-ที่จะลบ>' AND deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = '<id-ที่จะลบ>' AND deleted_at IS NULL);
   -- ต้องได้ UPDATE 1 — ได้ 0 = มีสัญญา/ใบขาย หรือถูกลบไปแล้ว → ROLLBACK แล้วกลับไปข้อ 3
   COMMIT;
   ```

5. **ย้ายห้องแชทของคนที่ถูกลบไปหาคนที่เก็บไว้** ผ่านหน้าอินบ็อกซ์ (ไม่แก้ `chat_rooms` ด้วย SQL —
   การผูกห้องย้ายประวัติเช็คเครดิตของห้องไปด้วย):
   - ห้องที่เจ้าของถูก soft delete ถือว่า "ไม่มีเจ้าของ" — API ยอมให้ผูกทับได้ และเมื่อมีข้อความเข้าห้องนั้น
     ครั้งถัดไป ระบบจะผูกห้องกับผู้สนใจอัตโนมัติตัวใหม่ให้เอง
   - เปิดห้องนั้นในอินบ็อกซ์ **ดูการ์ดด้านขวาก่อน**:
     - การ์ด "ผู้สนใจจากแชท" → กด **"ผูกกับลูกค้าเดิม"** แล้วเลือกคนที่เก็บไว้ (รวมผู้สนใจเข้าคนนั้น)
     - การ์ด "ห้องนี้ยังไม่ได้ผูกกับลูกค้า" → กด **"ค้นหาลูกค้าเดิม"** แล้วเลือกคนที่เก็บไว้
     - การ์ดยังแสดงคนที่ลบไปแล้ว → รอข้อความถัดไปของลูกค้า (ห้องจะกลายเป็นผู้สนใจจากแชท) แล้วทำตามข้อแรก
       หรือแจ้ง dev
   - ห้องที่คนที่ถูกลบถืออยู่: `SELECT id, channel FROM chat_rooms WHERE customer_id = '<id-ที่ลบ>' AND deleted_at IS NULL;`
6. ถ้าคนที่ถูกลบมีเบอร์สำรอง/LINE ID ที่คนที่เก็บไว้ไม่มี → เติมให้คนที่เก็บไว้ทางหน้าแก้ไขลูกค้า
7. จดกลุ่มที่แก้แล้ว (id ที่เก็บ / id ที่ลบ / ห้องที่ย้าย) ลงแชทหรือ PR
8. จบทุกกลุ่มแล้ว รัน DRY-RUN อีกรอบ — กลุ่มที่แก้แล้วต้องหายไป

**แถว `hashOnly: true`** (ไม่มีเบอร์ใน `phone` เหลือ มีแต่ hash) ทำแบบเดียวกัน แต่ดูเบอร์ได้จาก
หน้าลูกค้าเท่านั้น (ระบบถอดจาก `phone_encrypted`)

## ⑦ เรื่องปุ่ม "เริ่ม Backfill" (ตั้งค่า → PDPA)

ปุ่มนั้นเป็น**เครื่องมือเข้ารหัสทั้งตาราง** (ทุกคอลัมน์ PII ของลูกค้าที่ยังเป็น plaintext) — **ไม่จำเป็น**
สำหรับงานเบอร์โทรนี้ เพราะ CLI นี้เติม `phone_hash` / `phone_encrypted` / `phone_secondary_encrypted`
ให้เองแล้ว และที่สำคัญคือ normalize เบอร์**ก่อน** hash (ปุ่ม PDPA hash เบอร์ตามรูปแบบที่เก็บไว้ ถ้ากดก่อน
แถว `081-234 5678` จะได้ hash ที่การตรวจเบอร์ซ้ำหาไม่เจอ) ถ้าจะกดปุ่มนั้นเพื่อคอลัมน์อื่น ให้ทำ**หลัง**
ขั้น ④ และเป็นงานแยกที่ต้องขอเจ้าของต่างหาก

---

## ทางเลือก: รันจาก laptop ผ่าน cloud-sql-proxy

ใช้เมื่อรัน Cloud Run Job ไม่ได้ ขั้น ①/② ยังบังคับเหมือนเดิม

หน้าต่างแรก — เปิด proxy ค้างไว้:

```bash
cloud-sql-proxy --gcloud-auth --port 15432 bestchoice-prod:asia-southeast1:bestchoice-db
```

หน้าต่างที่สอง — รันจาก **root ของ repo** (ไม่ใช่ `apps/api`):

```bash
npm --prefix apps/api run build     # CLI เป็น node dist/... ต้อง build ก่อน

# รหัสผ่าน/กุญแจอยู่ใน Secret Manager — ห้าม echo ลง log/แชท
export PGURL="postgresql://bestchoice:<password>@127.0.0.1:15432/bestchoice"
export DATABASE_URL="${PGURL}?schema=public"
export PII_ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=pii-encryption-key --project=$PROJECT_ID)"
export PII_HASH_SALT="$(gcloud secrets versions access latest --secret=pii-hash-salt --project=$PROJECT_ID)"

# DRY-RUN
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run repair:customer-phones

# APPLY (หลังอ่าน DRY-RUN + backup)
APPLY=YES_I_AM_SURE ALLOW_PROD_REPAIR=YES_I_AM_SURE NODE_ENV=production \
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run repair:customer-phones

unset PII_ENCRYPTION_KEY PII_HASH_SALT
```

ลืมพารามิเตอร์: `npm --prefix apps/api run repair:customer-phones:help`

## ถ้าผลผิด (rollback)

- CLI ไม่ลบข้อมูลใดเลย — ค่าที่เปลี่ยนคือรูปแบบเบอร์ + hash/ciphertext ที่คำนวณจากเบอร์นั้น
- ถ้า hash/ciphertext ผิดทั้งชุด (กุญแจผิดแต่หลุดด่าน) → แก้กุญแจแล้วรัน APPLY ซ้ำ: แถวที่ ciphertext
  ถอดไม่ออกจะถูกข้าม ⇒ ต้องกู้จาก backup ที่จดไว้ในขั้น ① (ทางสุดท้าย — กระทบทั้งฐาน)
- soft delete ในขั้น ⑥ ย้อนได้: `UPDATE customers SET deleted_at = NULL WHERE id = '<id>';`
  (ห้องแชทที่ย้ายไปแล้วต้องย้ายกลับผ่านอินบ็อกซ์)
