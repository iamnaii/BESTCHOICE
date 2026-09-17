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
> **3. CLI ไม่รวมลูกค้า/ผู้ติดต่อ ไม่ย้าย ไม่ลบ ไม่บล็อกเบอร์ซ้ำ** — มันทำแค่ (ก) จัดรูปแบบเบอร์ (ข) เติม/แก้
> `phone_hash` / `phone_encrypted` / `phone_secondary_encrypted` ให้ตรงกับเบอร์ในแถว (ค) รายงานกลุ่ม
> ลูกค้าที่ถือเบอร์หลักเดียวกัน (ง) **เติม `contacts.national_id_hash`** ให้ผู้ติดต่อผู้ขายรับซื้อที่ไม่มีเลขบัตรแต่มี
> stub ลูกค้า จากเลขบัตรในรายการรับซื้อที่ตรวจแล้ว (เลขเดียว + ไม่มีผู้ติดต่ออื่นถือเลขนั้น) — ที่ผูกไม่ได้รายงานไว้
> ส่วนการแก้คู่ซ้ำ/คู่ชนเป็นงานมือทีละคู่ (ขั้น ⑥ / ⑥ข)
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
| `phone_encrypted` ถอดได้เป็น**อีกเบอร์** (ไม่ใช่แค่รูปแบบต่าง) — หน้าจอแสดงเบอร์นั้นอยู่ | ciphertext ใหม่ตาม `phone` ⇒ **เบอร์บนหน้าจอเปลี่ยน** | `display number changes` + `displayChangedIds` |
| `phone_hash` เก็บ**เบอร์ตัวจริง** (ผู้เขียนรุ่นเก่าตอนไม่มี salt) | hash จริงทับ (ปิด PII รั่ว) — ไม่นับเป็นสัญญาณ salt ผิด | `hash held plaintext (leak)` |
| `phone_secondary` ไม่ normalize หรือ `phone_secondary_encrypted` ว่าง/ไม่ตรง | ทั้งสองคอลัมน์ | `secondary fixed` |
| เบอร์หลัง normalize ไม่ใช่ `0` + 9 หลัก | ซ่อมตามปกติ **ไม่ลบ** + ลงรายชื่อ id | `invalid primary` / `invalid secondary` |
| `phone_encrypted` ถอดรหัสไม่ได้ | **ไม่แตะแถวนั้นเลย** + ลงรายชื่อ id | `decrypt failed (skipped)` |
| มีคนแก้แถวระหว่างที่ CLI รอเขียน | ข้าม ไม่ทับค่าใหม่ | `changed meanwhile` |

- เขียน**ทีละแถว คนละทรานแซกชัน**: ล็อกเบอร์หลักก่อน (ล็อกตัวเดียวกับฝั่งพนักงาน/บอท) แล้ว update
  แบบมีเงื่อนไขว่าค่าทั้งห้าคอลัมน์ยังเหมือนตอนสแกน
- แถวที่ไม่มี `phone` เหลือแต่มี `phone_hash` ไม่ถูกซ่อม แต่ถูกนับเข้ากลุ่มเบอร์ซ้ำ (`hashOnly: true`)
- **ด่านกุญแจ**: ถ้า ciphertext ถอดไม่ได้ ≥ 10% ของค่าที่เข้ารหัสทั้งหมด (นับเป็น**ค่า** เบอร์หลัก+สำรอง
  ขั้นต่ำ 5 ค่า หรือทุกค่า) หรือ hash ไม่ตรงทั้งที่
  ciphertext ตรง ≥ 10% ⇒ กุญแจ/salt ของ Job ไม่ใช่ของฐานนี้ ⇒ APPLY **หยุดก่อนเขียนแถวแรก**
  (log `ABORTED: …`, exit 1) · DRY-RUN แสดงเป็น `WARNING (APPLY จะถูกหยุด): …`
- APPLY เขียน `audit_logs` หนึ่งแถว action `CUSTOMER_PHONE_REPAIR_RUN` (entity `customer`,
  ตัวเลขอย่างเดียว) ด้วยผู้ใช้ระบบ
- log ไม่มีชื่อ/เบอร์/เลขบัตร มีแต่ตัวนับกับ id (แถวที่เขียนพลาดแสดงแค่ 6 ตัวท้ายของ id)

### ขั้นผูก contact ผู้ขายรับซื้อที่ไม่มีเลขบัตร (เพิ่ม 2026-09-17 Part E)

ปัญหาที่ปิด: รายการรับซื้อ/เทิร์นที่เปิดโดยไม่มีเลขบัตรได้ contact ที่ `national_id_hash` ว่าง ตอนรับเครื่อง
ระบบตรวจบัตรแล้วสร้าง stub ลูกค้า (ถือเบอร์ + hash) บน contact นั้น ⇒ พนักงานสร้างลูกค้าคนเดียวกันด้วยเลขบัตร
ได้ contact ใหม่แล้วชน 409 เบอร์ของ stub **โดยไม่มีเมนูไหนไปต่อได้** · ตั้งแต่โค้ดชุดนี้ การรับเครื่องผูก contact
ด้วยเลขบัตรที่ตรวจแล้วให้เอง (ยกเว้น contact เก่าที่มี stub อยู่แล้วและผู้ติดต่อที่ถือเลขยังไม่มีลูกค้า — คงไว้ที่เดิม
ให้แก้มือตามขั้น ⑥ข) ส่วนแถวเก่า CLI ทำให้:

ขอบเขต: `contacts` ที่ยังไม่ถูกลบ, `national_id_hash` ว่าง และมี stub ลูกค้า (ยังไม่ถูกลบ ไม่มีเลขบัตร)
เลขบัตรที่ใช้ = `trade_ins.seller_id_card_number` ของรายการ**ที่ตรวจบัตรแล้ว** (`id_card_verified_at` ไม่ว่าง)
ของ contact นั้น (normalize ขีด/ช่องว่างก่อน hash)

| สถานการณ์ | สิ่งที่ APPLY เขียน | ตัวนับ / รายการใน REPORT_JSON |
|---|---|---|
| contact ในขอบเขตทั้งหมด | — | `contactsKeyless` |
| เลขบัตรที่ตรวจแล้วมีเลขเดียว และไม่มี contact อื่นถือเลขนี้ | `contacts.national_id_hash` = hash ของเลขนั้น (**ไม่แตะ stub / รายการรับซื้อ**) | `contactsLinkable` / `contactsLinked` · `linkableContactIds` |
| รายการที่ตรวจแล้วมี**หลายเลข** | ไม่แตะ | `contactsAmbiguous` · `ambiguousContactIds` |
| contact อื่นถือเลขนี้อยู่แล้ว (หรือ contact ไม่มีเลขบัตรสองตัวของคนเดียวกันในรอบเดียว — ตัวที่สร้างก่อนได้เลข) | ไม่แตะ — **ไม่รวมอัตโนมัติ** | `contactIdConflicts` (ตัวเลข + รายการคู่ `{ keylessContactId, existingContactId, stubCustomerId, existingCustomerId, existingCustomerKeyed }` — `existingCustomerKeyed` = ลูกค้าฝั่งที่ถือเลขมีเลขบัตรจริงไหม ใช้แยกวิธีแก้ในขั้น ⑥ข) |
| ไม่มีรายการที่ตรวจบัตรแล้ว | ไม่แตะ (นับอยู่ใน `contactsKeyless` เท่านั้น) | — |
| มีคนเติมเลข/ได้เลขนี้ไประหว่างรัน | ข้าม | `contactsChangedMeanwhile` |

- เขียนทีละ contact คนละทรานแซกชัน ไม่ล็อกเบอร์ · ติดด่านกุญแจชุดเดียวกัน (salt ผิด = hash เลขบัตรผิดด้วย)
- หลัง APPLY รอบถัดไป contact ที่ผูกแล้วหลุดจากขอบเขต ⇒ `contactsKeyless` ลดลง · คู่ชนยังอยู่จนกว่าจะแก้มือ (ขั้น ⑥ข)

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
   `decryptFailedIds` / `displayChangedIds` + ขั้นผูก contact: `linkableContactIds` / `ambiguousContactIds` /
   `contactIdConflicts` (สูงสุด 500 รายการต่อชุด ยอดนับยังเต็ม)
5. บรรทัด `DUPLICATE_GROUP n/N {...}` บรรทัดละกลุ่ม (ดูขั้น ⑥) — กลุ่มที่ใหญ่เกิน 200 คน (มักเป็นเบอร์หลอก
   เช่น `0000000000`) แตกเป็น `DUPLICATE_GROUP n/N part k/K {...}` และมี `"oversized":true` +
   `memberCount` — กลุ่มแบบนี้เกือบแน่นอนว่าเป็นเบอร์หลอกที่หลายคนใช้ ไม่ใช่คนเดียวกัน → ส่งให้เจ้าของตัดสิน
   ไม่ต้องไล่แก้ทีละคนในขั้น ⑥
6. บรรทัดล่างสุด `DRY-RUN — ยังไม่เขียนอะไร …`

**ส่งให้เจ้าของดูก่อน APPLY**: ตัวเลขใน SUMMARY + จำนวนกลุ่มเบอร์ซ้ำ + จำนวน invalid +
**รายการ `displayChangedIds`** (ต้องได้คำอนุมัติเป็นรายการนี้โดยเฉพาะ) +
**ขั้นผูกผู้ติดต่อ**: ตัวเลข `contacts keyless / linkable / ambiguous / contact ID conflicts` +
**รายการ `linkableContactIds`** (ต้องได้คำอนุมัติเป็นรายการนี้โดยเฉพาะ — APPLY ผูกผู้ติดต่อเหล่านี้กับเลขบัตรถาวร)
+ `ambiguousContactIds` / `contactIdConflicts` (ไม่ถูกแตะ แต่เจ้าของต้องรู้ว่ามีงานมือรออยู่ — ขั้น ⑥ข)
- `linkableContactIds` = ผู้ติดต่อที่ APPLY จะเติมเลขบัตร (hash) ให้ — หลังจากนั้นพนักงานสร้างลูกค้าด้วยเลขบัตรนั้น
  จะได้ผู้ติดต่อตัวนี้และ stub ของมัน ถ้าเจ้าของสงสัยรายใด (เช่น เลขบัตรในรายการรับซื้ออาจพิมพ์ผิด) **หยุด** แจ้ง dev
  (CLI ไม่มีตัวเลือกข้ามรายคน)
- `display number changes` = ลูกค้าที่**เบอร์บนหน้าจอจะเปลี่ยนเป็นอีกเบอร์**หลัง APPLY: ciphertext ค้างของเบอร์เก่า
  (บั๊ก skip-tracing เดิม) ทำให้หน้าจอยังแสดงเบอร์เก่าอยู่ ส่วนคอลัมน์ `phone` เป็นเบอร์ที่พนักงานแก้ล่าสุด
  — APPLY ยึด `phone` ⇒ ให้เจ้าของ/ฝ่ายติดตามหนี้เปิดดูรายชื่อพวกนี้ก่อน (ส่วนใหญ่คือลูกหนี้ที่เคยถูกเปลี่ยนเบอร์)
  ถ้าเจ้าของไม่อนุมัติบางคน **หยุด** แจ้ง dev (CLI ไม่มีตัวเลือกข้ามรายคน)

ตัวเลขที่ควรสะดุด:
- `hash fixed` ส่วน `stale` สูงผิดปกติ (หลักพัน) ทั้งที่ `salt suspect` เป็น 0 → ถามก่อน
- `decrypt failed` มากกว่าหลักหน่วย → ถามก่อน (แถวพวกนี้จะไม่ถูกแตะอยู่แล้ว)
- `hash held plaintext (leak)` มากกว่า 0 → แจ้งเจ้าของว่าเป็น PII รั่วในคอลัมน์ hash (APPLY ปิดให้) ไม่ต้องหยุด

## ④ APPLY (หลังเจ้าของเห็นรายงาน ③ และมี backup ①)

GitHub Actions → workflow เดิม → `mode = apply` (workflow ใส่ `APPLY` / `ALLOW_PROD_REPAIR` /
`NODE_ENV=production` ให้เอง)

หรือด้วย gcloud:

```bash
gcloud run jobs update $JOB --project=$PROJECT_ID --region=$REGION \
  --set-env-vars=TZ=Asia/Bangkok,EXPECTED_DB_NAME=$PROD_DB_NAME,APPLY=YES_I_AM_SURE,ALLOW_PROD_REPAIR=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute $JOB --project=$PROJECT_ID --region=$REGION --wait
```

> **หลังรัน APPLY ด้วย gcloud ต้องสั่ง `update` แบบขั้น ③ (ไม่มี `APPLY`) ทันที** — Job เก็บ env ของ `update`
> ครั้งล่าสุดไว้ ถ้าไม่รีเซ็ต การกด Execute จาก Cloud Console ครั้งหน้าจะเขียนอีกรอบโดยไม่มี backup/dry-run
> (workflow รีเซ็ตให้เองในขั้นสุดท้ายเสมอ แม้ขั้น execute ล้ม)

ใน log ต้องเห็น `mode: APPLY`, `APPLY starting in 5s`, บรรทัด `...written N/N`, บล็อก
`===== SUMMARY (APPLY) =====` ที่มี `written` / `changed meanwhile` / `failed` และ `Done.`

- `ABORTED: …` = ด่านกุญแจหยุด **ไม่มีอะไรถูกเขียน** (exit 1) — กลับไปขั้น ③ ข้อ 3
- `failed` > 0 = บางแถวเขียนไม่ผ่าน (log แสดง 6 ตัวท้ายของ id + รหัส error) Job จะ exit 1
  ทั้งที่แถวอื่นเขียนแล้ว — รัน APPLY ซ้ำได้ (แถวที่เสร็จแล้วไม่ถูกแตะอีก) ถ้ายังพลาดแถวเดิม ส่ง id ท้ายให้ dev
- `changed meanwhile` > 0 = มีคนแก้แถวนั้นระหว่างรัน ไม่ใช่ error — รันซ้ำเพื่อเก็บตก
- ขั้นผูก contact: `contacts linked` ต้องเท่ากับ `contacts linkable` ของรอบ DRY-RUN (หรือน้อยกว่าด้วย
  `contacts changed meanwhile`) · `contacts link failed` > 0 = Job exit 1 — รัน APPLY ซ้ำได้ ถ้ายังพลาดส่ง id ท้ายให้ dev

## ⑤ ตรวจผล

รัน **DRY-RUN อีกรอบ** (ขั้น ③) — ต้องได้ `needs repair (would-write): 0` (ยกเว้นแถวใน
`decrypt failed` ซึ่งไม่ถูกแตะโดยตั้งใจ และแถวที่มีคนแก้ระหว่างรันซึ่งรัน APPLY ซ้ำได้)

จำนวนกลุ่มเบอร์ซ้ำ**อาจเพิ่มขึ้น**ได้ ไม่ใช่ความผิดพลาด: กลุ่มในรายงาน APPLY คำนวณจากการสแกนก่อนเขียน
ถ้ามีพนักงานสร้างลูกค้าเบอร์เดียวกับแถวที่ยังไม่มี hash ในช่วงนั้น (การตรวจเบอร์ซ้ำมองแถวนั้นไม่เห็นจนกว่าจะซ่อม)
คู่ใหม่จะโผล่ในรอบตรวจนี้ ⇒ **ใช้รายการ `DUPLICATE_GROUP` จากรอบตรวจนี้**เป็นรายการทำงานของขั้น ⑥

ตรวจเพิ่มด้วย SQL อ่านอย่างเดียว (ผู้ปฏิบัติที่ได้รับอนุญาต ผ่าน cloud-sql-proxy — **ห้ามผ่าน MCP**):

```sql
-- ต้องได้ 0: แถวที่มีเบอร์แต่ไม่มี hash/ciphertext
SELECT count(*) FROM customers
WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''
  AND (phone_hash IS NULL OR phone_encrypted IS NULL);

-- เบอร์หลักที่ไม่ใช่ 0 + 9 หลัก — ต้องเท่ากับ `invalid primary` ในรายงาน DRY-RUN รอบตรวจ (ไม่ใช่ 0:
-- เบอร์ต่างประเทศเช่น +855… คงเครื่องหมาย + ไว้ และเบอร์ผิดรูปแบบไม่ถูกลบ)
SELECT count(*) FROM customers
WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> '' AND phone !~ '^0[0-9]{9}$';

-- audit ของรอบ APPLY
SELECT created_at, new_value FROM audit_logs
WHERE action = 'CUSTOMER_PHONE_REPAIR_RUN' ORDER BY created_at DESC LIMIT 3;
```

## ⑥ แก้กลุ่มเบอร์ซ้ำทีละคู่ (ด้วยมือ — คำตัดสินข้อ 4)

แต่ละบรรทัด `DUPLICATE_GROUP` คือลูกค้าที่ยังไม่ถูกลบซึ่งถือเบอร์หลักเดียวกัน:

```json
{"customerIds":["…","…"],"hasBotOrChat":true,
 "members":[{"id":"…","origin":"BOT","acquisitionSource":"AI_CHAT","createdAt":"…","hashOnly":false,
             "contracts":0,"sales":0,"blocking":{},"blockingTotal":0,"chatRooms":1}, …]}
```

- `origin`: `BOT` = ที่มาขึ้นต้น `AI_CHAT` (บอทขายสร้าง/แตะ) · `CHAT` = ที่มาขึ้นต้น `CHAT_`
  (ผู้สนใจจากแชทที่เติมเบอร์แล้ว) · `OTHER` = พนักงาน/อื่น ๆ
- กลุ่มที่มีแถวบอท/แชทอยู่บนสุด และในกลุ่มเรียงบอท/แชทก่อน แล้วเก่าก่อน
- `contracts` = สัญญาทุกสถานะที่ยังไม่ถูกลบ · `sales` = ใบขายที่ยังไม่ถูกยกเลิก (ไว้อ่านประกอบ)
- **`blocking` = ตัวตัดสินว่าลบได้ไหม** — สิ่งที่ผูกกับคนนี้อยู่ (แสดงเฉพาะที่มี) ชุดเดียวกับที่ระบบใช้ตอนรวม
  ผู้สนใจจากแชท: สัญญา ใบขาย ใบจอง/มัดจำ การจองสินค้า รายการรับซื้อ (รวมเครดิตเทิร์น) คำสั่งซื้อออนไลน์
  แผนออม ใบสมัครผ่อนออนไลน์ แต้ม/การแลกแต้ม โปรโมชัน ใบซ่อม รายได้อื่น ลิงก์ชำระบางส่วน การยืนยันตัวตน
  ความยินยอม/คำขอ PDPA การผูก LINE คนที่แนะนำมา รีวิว ผลอนุมัติเครดิต การเข้าเว็บ + ผลเช็คเครดิต
  (`creditChecks`) — **นับทุกแถวรวมที่ถูกยกเลิก/ลบแล้ว** (ระวังไว้ก่อน) ⇒ ใบขายที่ยกเลิกไปแล้วก็ยังบล็อก
- `blockingTotal` = ผลรวมของ `blocking` · `chatRooms` = ห้องแชทที่ยังไม่ถูกลบของคนนี้ (ต้องย้าย — ข้อ 6)

**ทีละกลุ่ม:**

1. เปิด `/customers/<id>` ของทุกคนในกลุ่ม ยืนยันด้วยตาว่าเป็นคนเดียวกันจริง (ชื่อ เลขบัตร ห้องแชท)
   ถ้า**ไม่ใช่**คนเดียวกัน (ใช้เบอร์ร่วมกันจริง เช่น ครอบครัว) → จดไว้ ปล่อยไว้ แจ้งเจ้าของ
2. เลือกคน**ที่เก็บไว้** = คนที่มีสัญญา/ใบขาย/`blocking` ถ้าไม่มีใครมีเลยให้เก็บคนที่ข้อมูลครบกว่า (มีเลขบัตร)
3. คนที่จะ**ลบ** ต้องมี **`blockingTotal = 0`** เท่านั้น (ไม่ใช่แค่ `contracts`/`sales` = 0 — แถวที่ไม่มีสัญญา
   อาจถือมัดจำ เครดิตเทิร์น การผูก LINE หรือความยินยอม PDPA อยู่) ถ้า**ทั้งสองฝั่ง**มี `blockingTotal > 0`
   → **หยุด ส่งให้เจ้าของตัดสิน** (เอกสารการเงิน/กฎหมาย ห้ามย้ายเอง ระบบไม่มีเครื่องมือรวมลูกค้า)
4. **ก่อนลบ — เก็บสิ่งที่ต้องใช้ทีหลัง** (หลังลบ หน้า `/customers/<id>` ของคนที่ลบจะขึ้น "ไม่พบ" ดูอะไรไม่ได้แล้ว):
   - ถ้าคนที่จะลบมีเบอร์สำรอง/LINE ID ที่คนที่เก็บไว้ไม่มี → เติมให้คนที่เก็บไว้ทางหน้าแก้ไขลูกค้า**ตอนนี้**
   - จดรายการห้องแชทของคนที่จะลบ (ใช้ในข้อ 6):
     `SELECT id, channel FROM chat_rooms WHERE customer_id = '<id-ที่จะลบ>' AND deleted_at IS NULL;`
     ลิงก์ห้อง = `/inbox/<room id>`
5. **ลบแบบ soft delete + ผูกไปหาคนที่เก็บไว้** ด้วย SQL ด้านล่าง (ผู้ปฏิบัติที่ได้รับอนุญาต ผ่าน
   cloud-sql-proxy + `psql` — **ห้ามผ่าน MCP**)

   > **ทำไมไม่ใช้เมนู "ลบลูกค้า"/"ลบรายชื่อ" ในหน้า `/customers`** (มีจริง เฉพาะ OWNER และบันทึก audit):
   > `DELETE /customers/:id` ตั้งแค่ `deleted_at` และกันแค่สัญญาที่ยังเปิด — **ไม่ตั้ง `merged_into_id`
   > และไม่ย้ายบันทึกการเดินทางของลูกค้า** ⇒ คำขอ PDPA (ขอดู/ขอลบ) ของคนที่เก็บไว้ ลิงก์เก่าของหน้า
   > การเดินทาง และบอทขายที่ตามหาลูกค้าตัวจริง จะมองไม่เห็นแถวที่ลบไปแล้วเลย. SQL นี้ทำเหมือนที่ระบบทำตอน
   > รวมผู้สนใจจากแชท (`CustomerMergeService`) ในทรานแซกชันเดียว พร้อมด่านครบชุดเดียวกับ `blocking`
   >
   > **SQL ไม่เขียน `audit_logs`** ⇒ ต้องจดทุกครั้งในข้อ 7 (ใครรัน เมื่อไร id ไหน) ไม่มีข้อยกเว้น

   ```sql
   \set del  '<id-ที่จะลบ>'
   \set keep '<id-ที่เก็บไว้>'
   BEGIN;

   -- (ก) ลบ + ผูก merged_into_id — ด่าน: สองแถวต่างกัน คนที่เก็บยังอยู่ และไม่มีอะไรผูกกับคนที่ลบเลย
   UPDATE customers SET deleted_at = now(), updated_at = now(), merged_into_id = :'keep'
   WHERE id = :'del' AND deleted_at IS NULL AND merged_into_id IS NULL
     AND :'del' <> :'keep'
     AND EXISTS (SELECT 1 FROM customers k WHERE k.id = :'keep' AND k.deleted_at IS NULL AND k.merged_into_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM contracts                       WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM sales                           WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM bookings                        WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM product_reservations            WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM trade_ins                       WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM online_orders                   WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM saving_plans                    WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM online_installment_applications WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM loyalty_points                  WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM loyalty_redemptions             WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM promotion_usages                WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM repair_tickets                  WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM other_incomes                   WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM partial_payment_links           WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM kyc_verifications               WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM pdpa_consents                   WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM dsar_requests                   WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM customer_line_links             WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM customers                       WHERE referred_by_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM reviews                         WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM credit_approvals                WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM website_visits                  WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM website_sessions                WHERE customer_id = :'del')
     AND NOT EXISTS (SELECT 1 FROM credit_checks                   WHERE customer_id = :'del');
   -- ต้องได้ UPDATE 1 — ได้ 0 = มีอะไรผูกอยู่ / ถูกลบไปแล้ว / id ผิด → ROLLBACK; แล้วกลับไปข้อ 3

   -- (ข) คนที่เคยถูกรวมเข้าคนที่ลบ ชี้ไปคนที่เก็บไว้ (ให้สายมีชั้นเดียวเสมอ)
   UPDATE customers SET merged_into_id = :'keep', updated_at = now()
   WHERE merged_into_id = :'del'
     AND EXISTS (SELECT 1 FROM customers d WHERE d.id = :'del' AND d.merged_into_id = :'keep' AND d.deleted_at IS NOT NULL);

   -- (ค) บันทึกการเดินทางย้ายตามเจ้าของ (origin_customer_id คงเดิม — ใช้ย้อนกลับได้)
   UPDATE customer_journey_entries SET customer_id = :'keep'
   WHERE customer_id = :'del'
     AND EXISTS (SELECT 1 FROM customers d WHERE d.id = :'del' AND d.merged_into_id = :'keep' AND d.deleted_at IS NOT NULL);

   COMMIT;
   ```

   (ข) และ (ค) ไม่ทำอะไรเลยถ้า (ก) ไม่เกิด — แต่ถ้า (ก) ได้ 0 ให้ `ROLLBACK` อยู่ดี
   แคชสรุปการเดินทางคำนวณใหม่เองใน cron `journey:recompute` 03:30 น. (รอบกวาดทั้งหมดคือคืนวันอาทิตย์)
6. **ย้ายห้องแชทของคนที่ลบไปหาคนที่เก็บไว้** (รายการจากข้อ 4 — ไม่แก้ `chat_rooms` ด้วย SQL เพราะการผูกห้อง
   ย้ายประวัติเช็คเครดิตของห้องไปด้วย):
   - **ห้องของคนที่มีเบอร์ (`hashOnly: false`) — ทำจากหน้าอินบ็อกซ์ไม่ได้วันนี้**: การ์ดขวายังแสดงคนที่ลบไปแล้ว
     เป็นลูกค้าที่ผูกอยู่ (ปุ่มโปรไฟล์ขึ้น "ไม่พบ") และไม่มีปุ่ม "ผูกกับลูกค้าเดิม"/"ค้นหาลูกค้าเดิม" ให้กด
     ⇒ **ส่งรายการห้อง + id ที่เก็บไว้ให้ dev/OWNER ทันทีหลังข้อ 5** ให้เรียก
     `PATCH /staff-chat/rooms/<room id>/customer` ด้วย body `{"customerId":"<id-ที่เก็บไว้>"}` ทีละห้อง
     (API ยอมผูกทับห้องที่เจ้าของถูกลบแล้ว และย้ายประวัติเช็คเครดิตของห้องให้)
   - ห้องของแถว `hashOnly: true` ที่ `origin: CHAT` และไม่มีเลขบัตร: เปิดห้องในอินบ็อกซ์ ถ้าการ์ดเป็น
     "ผู้สนใจจากแชท" → กด **"ผูกกับลูกค้าเดิม"** แล้วเลือกคนที่เก็บไว้ (ผูกทับได้เพราะเจ้าของถูกลบแล้ว)
     · ถ้าการ์ดเป็น "ห้องนี้ยังไม่ได้ผูกกับลูกค้า" → กด **"ค้นหาลูกค้าเดิม"** · ถ้าการ์ดแสดงชื่อคนที่ลบ
     (ไม่มีปุ่มผูก) → ส่ง dev แบบข้อบน
   - **อย่ารอให้ลูกค้าทักมาเอง**: ห้อง LINE/Facebook ผูกผู้สนใจอัตโนมัติตัวใหม่ให้เมื่อมีข้อความเข้าเท่านั้น
     (อาจไม่มีวันทัก) และ**ห้องเว็บไม่เคยผูกเองเลย** — ระหว่างรอ การ์ดห้องแสดงชื่อคนที่ลบไปแล้ว
   - ถ้าย้ายห้องไม่ได้ในวันเดียวกัน → **ยังไม่ต้องลบ** (ข้าม ข้อ 5) เก็บคู่นั้นไว้ก่อนแล้วแจ้ง dev
7. จดกลุ่มที่แก้แล้วลงแชทหรือ PR: **ผู้รัน · วันเวลา · id ที่เก็บ · id ที่ลบ · ห้องที่ย้าย (และใครย้าย)**
   — บันทึกนี้แทน audit ที่ SQL ไม่ได้เขียน
8. จบทุกกลุ่มแล้ว รัน DRY-RUN อีกรอบ — กลุ่มที่แก้แล้วต้องหายไป

**แถว `hashOnly: true`** (ไม่มีเบอร์ใน `phone` เหลือ มีแต่ hash) ทำแบบเดียวกัน แต่ดูเบอร์ได้จาก
หน้าลูกค้าเท่านั้น (ระบบถอดจาก `phone_encrypted`)

## ⑥ข แก้คู่ `contactIdConflicts` ทีละคู่ (ด้วยมือ)

แต่ละคู่ = คนเดียวกันมีสอง contact: `keylessContactId` (ไม่มีเลขบัตร มี stub `stubCustomerId` จากการรับซื้อ)
กับ `existingContactId` (ถือเลขบัตรนี้อยู่แล้ว) · CLI ไม่รวมให้ เพราะต้องมีคนยืนยันว่าเป็นคนเดียวกันจริง
ใช้คู่จาก **DRY-RUN รอบตรวจ (ขั้น ⑤)** — คู่ที่ contact อีกตัวเพิ่งได้เลขในรอบ APPLY จะเปลี่ยน
`existingCustomerId` เป็น stub ของ contact นั้น (และ `existingCustomerKeyed` = `false`)

แยกคู่เป็น 3 แบบตามสองช่องในรายงาน:

| `existingCustomerId` | `existingCustomerKeyed` | ความหมาย | ทำอะไร |
|---|---|---|---|
| `null` | `false` | contact ที่มีเลขบัตรยังไม่มีลูกค้า — **ทางตัน** (พนักงานสร้างลูกค้าด้วยเลขบัตรจะได้ contact นั้น แล้วชน 409 เบอร์ของ stub) | ข้อ 2 — รวม contact |
| มีค่า | `true` | มีลูกค้าตัวจริง (มีเลขบัตร) อยู่แล้ว — **ไม่ใช่ทางตัน** (สร้างซ้ำได้ 409 เลขบัตรชี้ลูกค้าตัวจริง ซึ่งถูกต้อง) | ข้อ 3 — ส่งเจ้าของ |
| มีค่า | `false` | ลูกค้าฝั่งที่มีเลขบัตรก็เป็น **stub ไม่มีเลขบัตร** (คู่ชนที่เกิดในรอบเดียวกันเป็นแบบนี้เสมอ) — **ยังเป็นทางตัน** (สร้างด้วยเลขบัตรจะ upgrade stub ฝั่งมีเลข แต่ชน 409 เบอร์ของ stub ฝั่ง keyless) | ข้อ 4 — ส่งเจ้าของ |

1. เปิด `/customers/<stubCustomerId>` และ `/customers/<existingCustomerId>` (ถ้ามี) ยืนยันด้วยตาว่าเป็นคนเดียวกัน
   (ชื่อ เบอร์ รายการรับซื้อ) — ไม่ใช่คนเดียวกัน = **หยุด** ส่งเจ้าของ (เลขบัตรในรายการรับซื้อน่าจะพิมพ์ผิด)
2. **`existingCustomerId` = `null`** → **ใช้เมนู "รวมผู้ติดต่อ" ในระบบ (ทางหลัก — OWNER เท่านั้น)**:
   เปิด `/contacts/<existingContactId>` → ปุ่ม **รวมผู้ติดต่อซ้ำ** → ค้นแล้วเลือก contact `<keylessContactId>` → ยืนยัน
   - เมนูนี้ทำในทรานแซกชันเดียว: ย้ายลูกค้า (stub) + รายการรับซื้อ ไปอยู่ใต้ contact ที่มีเลขบัตร · รวมบทบาท ·
     เลขบัตรของ contact หลักไม่ถูกทับ · **soft-delete contact ไม่มีเลขบัตร** (หายจากช่องค้นหาผู้ติดต่อด้วย) ·
     บันทึก AuditLog `CONTACTS_MERGED` (เขียนหลังทรานแซกชัน commit)
   - ⛔ **ห้ามใช้เมนูนี้กับคู่ที่ `existingCustomerId` มีค่า** — เมนูไม่ตรวจว่า contact หลักมีลูกค้าอยู่แล้ว
     รวมแล้วจะได้ลูกค้าสองแถวบน contact เดียว
   - ก่อนกด เปิด `/contacts/<existingContactId>` ดูว่า **ยังไม่มีลูกค้า** จริง (ข้อมูลอาจเปลี่ยนหลัง DRY-RUN)
     ถ้ามีแล้ว = คู่นี้กลายเป็นแบบข้อ 3/4 → หยุด
   - หลังรวม พนักงานสร้างลูกค้าด้วยเลขบัตร + เบอร์เดิม ระบบจะ **upgrade stub** ให้เอง (ไม่ใช่ 409)
     — ยกเว้นลูกค้าคนนี้เคยถูก**ลบ**ไปแล้ว (ดูหมายเหตุท้ายขั้นนี้)

   **ทางสำรอง (เมื่อเมนูใช้ไม่ได้เท่านั้น) — SQL ผ่าน cloud-sql-proxy, ห้ามผ่าน MCP:**
   ทางนี้**ไม่มี AuditLog** และไม่ลบ contact ไม่มีเลขบัตร (มันยังโผล่ในช่องค้นหาผู้ติดต่อ) — จดลงบันทึกแก้มือเสมอ
   บล็อกนี้**ไม่มี `COMMIT`** โดยตั้งใจ: วางทั้งบล็อก แล้ว**อ่านผลก่อน**จึงพิมพ์ `COMMIT;` เอง

   ```sql
   \set keyless  '<keylessContactId>'
   \set existing '<existingContactId>'
   \set stub     '<stubCustomerId>'
   BEGIN;
   -- (1) ย้าย stub — ต้องได้ UPDATE 1
   UPDATE customers SET contact_id = :'existing', updated_at = now()
   WHERE id = :'stub' AND contact_id = :'keyless' AND deleted_at IS NULL
     AND national_id_hash IS NULL
     AND NOT EXISTS (SELECT 1 FROM customers c2
                     WHERE c2.contact_id = :'existing' AND c2.deleted_at IS NULL AND c2.id <> :'stub');
   -- (2) เติมบทบาท — ต้องได้ UPDATE 1 · ทำเฉพาะเมื่อ (1) ย้ายสำเร็จจริง
   UPDATE contacts
   SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['CUSTOMER','TRADE_IN_SELLER']::"ContactRole"[])),
       updated_at = now()
   WHERE id = :'existing' AND deleted_at IS NULL AND national_id_hash IS NOT NULL
     AND EXISTS (SELECT 1 FROM customers s
                 WHERE s.id = :'stub' AND s.contact_id = :'existing' AND s.deleted_at IS NULL);
   -- (3) ย้ายรายการรับซื้อ — ได้ UPDATE n (n ≥ 1) · ทำเฉพาะเมื่อ (1) ย้ายสำเร็จจริง
   UPDATE trade_ins SET seller_contact_id = :'existing', updated_at = now()
   WHERE seller_contact_id = :'keyless'
     AND EXISTS (SELECT 1 FROM customers s
                 WHERE s.id = :'stub' AND s.contact_id = :'existing' AND s.deleted_at IS NULL);
   -- ⛔ อ่านผลสามบรรทัดก่อน: ได้ UPDATE 1 / UPDATE 1 / UPDATE n (n ≥ 1) เท่านั้น → พิมพ์ COMMIT;
   --    อย่างอื่นทั้งหมด (โดยเฉพาะ UPDATE 0 ที่คำสั่งใดก็ตาม) → พิมพ์ ROLLBACK; แล้วรัน DRY-RUN ใหม่
   ```

   เงื่อนไข `EXISTS` ใน (2)/(3) ทำให้ถ้า (1) ได้ 0 แถว (contact ที่มีเลขบัตรเพิ่งได้ลูกค้าหลัง DRY-RUN /
   พิมพ์ id ผิด) สองคำสั่งหลังก็ได้ 0 แถวด้วย — ไม่มีทางเหลือข้อมูลครึ่งเดียว (รายการรับซื้อชี้ contact ใหม่
   แต่ stub ที่ถือเครดิตยังอยู่ contact เดิม) แม้เผลอ COMMIT
3. **`existingCustomerId` มีค่า + `existingCustomerKeyed` = `true`** = คนเดียวกันมีลูกค้าสองแถว (stub จากการรับซื้อ
   + ลูกค้าตัวจริง) — ไม่ใช่ทางตัน แต่ stub มักถือ**เครดิตเทิร์น** (`trade_ins.customer_id` = stub) ⇒
   **ห้ามย้ายเครดิตหรือลบ stub ด้วย SQL และห้ามใช้เมนูรวมผู้ติดต่อ** — ส่งคู่นี้ให้เจ้าของตัดสิน
   ถ้าสองแถวอยู่ในกลุ่มเบอร์ซ้ำเดียวกันด้วย ให้ถือเป็นกลุ่มที่ `blockingTotal` > 0 (ขั้น ⑥)
4. **`existingCustomerId` มีค่า + `existingCustomerKeyed` = `false`** = สอง stub ไม่มีเลขบัตรของคนเดียวกัน —
   **ยังเป็นทางตัน** และแก้ด้วยข้อ 2 ไม่ได้ (SQL ติดเงื่อนไข `NOT EXISTS`, เมนูรวมจะได้ลูกค้าสองแถว) ⇒ ส่งเจ้าของ
   พร้อมคำถามชัด ๆ: stub ตัวไหนเก็บไว้ (ดูว่าตัวไหนถือเครดิตเทิร์น/สัญญา) และ soft-delete ตัวที่ว่างตามขั้น ⑥
   — **ห้ามทำเองด้วย SQL**
5. จดคู่ที่แก้แล้วแบบขั้น ⑥ ข้อ 7 (ผู้รัน · วันเวลา · id ทั้งสี่ · ใช้เมนูหรือ SQL) แล้วรัน DRY-RUN อีกรอบ
   — คู่ที่แก้แล้วต้องหายไป · ถ้าใช้ SQL ให้ตรวจเพิ่มว่า stub อยู่ใต้ contact ที่มีเลขบัตรจริง
   (`SELECT contact_id FROM customers WHERE id = '<stubCustomerId>'` ต้องได้ `<existingContactId>`)
   เพราะคู่ที่ย้ายรายการรับซื้อไปแล้วแต่ stub ไม่ได้ย้าย ก็**หายจากรายงาน**ได้เหมือนกัน
   (contact ไม่มีเลขบัตรไม่เหลือรายการที่ตรวจบัตรแล้ว)

> **หมายเหตุ — ลูกค้าที่เคยถูกลบ:** ถ้ามีลูกค้าที่ถูกลบ (เมนูลบลูกค้าของ OWNER) ถือเลขบัตรนี้อยู่ พนักงานสร้างลูกค้า
> ด้วยเลขบัตรจะเข้าทาง **ชุบลูกค้าที่ถูกลบกลับมา** ซึ่งไม่ยกเว้น stub ⇒ ยังชน 409 เบอร์ของ stub ได้แม้แก้คู่แล้ว
> **ยังไม่มีเมนูไหนแก้เคสนี้ได้** (ฟอร์มแก้ลูกค้าล้างเบอร์ไม่ได้ — ต้องเป็นเลข 10 หลักเสมอ และแก้เลขบัตรไม่ได้)
> ⇒ ส่งเจ้าของตัดสินว่าจะเก็บแถวไหน (ลูกค้าที่ถูกลบ หรือ stub) — **ห้ามแก้เองด้วย SQL**

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
- soft delete ในขั้น ⑥ ย้อนได้ (ทรานแซกชันเดียว — บันทึกการเดินทางกลับหาเจ้าของเดิมด้วย `origin_customer_id`):

  ```sql
  \set del  '<id-ที่ลบไป>'
  \set keep '<id-ที่เก็บไว้>'
  BEGIN;
  UPDATE customers SET deleted_at = NULL, merged_into_id = NULL, updated_at = now()
  WHERE id = :'del' AND merged_into_id = :'keep';
  UPDATE customer_journey_entries SET customer_id = :'del'
  WHERE customer_id = :'keep' AND origin_customer_id = :'del';
  COMMIT;
  ```

  แถวที่ขั้น (ข) ย้ายสายมาไว้ที่คนที่เก็บ ไม่ย้อนอัตโนมัติ (ไม่รู้ว่าเดิมชี้คนไหน) — ถ้ามี ให้ส่ง dev ·
  ห้องแชทที่ย้ายไปแล้ว**ย้ายกลับผ่าน API/อินบ็อกซ์ไม่ได้** (ห้องผูกกับคนที่เก็บไว้ซึ่งยังไม่ถูกลบ API ปฏิเสธการผูกทับ)
  ⇒ ส่งรายการห้องจากบันทึกขั้น ⑥ ข้อ 7 ให้ dev
