# Runbook: ขึ้น prod — การเดินทางของลูกค้า เฟส 3 (scope v2: ระบบบันทึกเอง + บันทึกมือแบบไม่บังคับ)

- spec: `docs/superpowers/specs/2026-09-15-customer-journey-design.md` · คำตัดสินเจ้าของ scope v2 ข้อ 1–13 (2026-09-15)
- runbook เฟส 1: `docs/superpowers/runbooks/2026-09-15-customer-journey-deploy.md` — หัวข้อ 0 (pipeline · เว็บขึ้นก่อน API ได้ · ทางสำรอง deploy จากเครื่อง) ใช้กับ PR นี้ทุกข้อ ไม่เขียนซ้ำที่นี่
- **ไม่มี migration** · ไม่มีคอลัมน์ใหม่ ⇒ ไม่ต้อง apply สิทธิ์ MCP
- ไฟล์นี้คือแหล่งจริงของ runbook — PR body ลิงก์มาที่นี่ ห้ามแก้ใน PR body แยก

> 🚨 ทุกคำสั่งในไฟล์นี้เป็นงานของเจ้าของ — dev/agent ไม่ได้รันอะไรกับ prod ในงานนี้

## 0. อ่านก่อน: ค่า `stage` ในแคชเปลี่ยนความหมายทันทีที่ API ใหม่ขึ้น

**ลำดับขั้นใหม่ (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด"):** 1 ทักเข้ามา → 2 ได้เบอร์ / ยืนยันตัวตน → **3 ตรวจเครดิต → 4 นัด / จอง** → 5 ซื้อแล้ว
- ชื่อ enum เดิม (`CREDIT` / `INTERESTED`) — ป้ายของ `INTERESTED` เปลี่ยนเป็น "นัด / จอง"
- กติกาเดิมให้ลูกค้าที่มีทั้งใบตรวจเครดิตและหลักฐานนัด/จองอยู่ขั้น `CREDIT` · กติกาใหม่ให้อยู่ขั้น `INTERESTED`
- แถวแคช `customer_journey_states` ที่คำนวณก่อน deploy **ไม่ถูกแก้เอง**
  - summary คำนวณใหม่เฉพาะตอนไม่มีแคช · ขั้นซื้อแล้วไม่ตรง · หรือแคชเก่ากว่า 15 นาทีและลูกค้าขยับ (`journey-summary.service.ts`)
  - cron `journey:recompute` 03:30 น. แตะเฉพาะคนที่ขยับใน 48 ชม. · sweep ทุกคนเฉพาะคืนเสาร์→อาทิตย์
- ระหว่างนั้น ลูกค้าที่แคชยังเป็น `CREDIT` แต่มีเวลานัด/จอง จะเห็นแถบ "3 ตรวจเครดิต" เป็นขั้นปัจจุบัน และ "4 นัด / จอง" เป็น "ยังไม่ถึง" ไม่มีวันที่ ทั้งที่มีนัดแล้ว
- ⇒ **รัน `backfill:customer-journey` ให้จบในวันเดียวกับที่ API ใหม่ขึ้น** (ขั้น 3–5)
- ไม่มีค่าที่ถูกแช่แข็งด้วย `LEAST` ในเรื่องนี้ (`stage` / `stage_entered_at` / `path` ใช้ค่าที่คำนวณล่าสุดเสมอ) ⇒ คำนวณใหม่ครั้งเดียวแก้ครบ ไม่ต้อง reset คอลัมน์

**เว็บขึ้นก่อน API ได้** (runbook เฟส 1 หัวข้อ 0):
- เว็บใหม่ + API เก่า: แถบยังเรียงตาม API เก่า (นัด / จอง ก่อน ตรวจเครดิต) แต่ใช้ป้ายใหม่ — ยอมรับได้เฉพาะช่วงสั้น ๆ ระหว่างสองสาย
- `deploy-web` เขียว แต่ `build-and-push-api` / `migrate-db` / `deploy-api` ตัวใดไม่เขียว (แดง · ถูกยกเลิก · หรือ skipped) = **ถอยเว็บทันที** (หัวข้อ "ถอย" → ข้อ 2)

## ลำดับห้ามสลับ

| ขั้น | งาน |
|---|---|
| 1 | ด่านก่อน merge — PR "ร้านตอบครั้งแรก" ขึ้นและจบแล้ว · จดของเดิมไว้ถอย · นับก่อน · ช่วงเวลา · นับห้องที่ลูกค้าส่งไฟล์ในแชท (1.6) |
| 2 | merge PR นี้ + ด่านหลัง merge |
| 3 | `backfill:customer-journey` dry-run |
| 4 | รันจริง |
| 5 | ตรวจหลัง backfill |

## 1. 🚨 ด่านก่อน merge

### 1.1 PR "ร้านตอบครั้งแรก" (`first_staff_reply_at`) อยู่บน main และจบหัวข้อ 9 ของ runbook เฟส 1 แล้ว

สถานะตอนเขียนแผน (2026-09-15): ข้อ 1 ผ่านแล้ว — PR #1595 merge และ deploy แล้ว (อยู่ใน `origin/main` `10d6e6d3a` ที่แผนนี้ต่อยอด) · ข้อ 2–3 ยังต้องตรวจตอนจะ merge

เหตุผล: PR นั้นแก้ `journey-state.sql` ไฟล์เดียวกัน และหัวข้อ 9.1 ของมันต้องดูผลหนึ่งคืน **ก่อน** backfill · ถ้าขึ้นพร้อม PR นี้ backfill ขั้น 3–4 จะเขียนกติกา "ร้านตอบครั้งแรก" ให้ทุกคนก่อนผ่านด่านนั้น และค่านั้นถูกแช่แข็งด้วย `LEAST`

1. โค้ดของ PR นั้นอยู่บน main — จากเครื่อง dev:
   ```bash
   git fetch origin
   git show origin/main:apps/api/src/modules/customer-journey/sql/journey-state.sql | grep -c 'channel_first_customer_at'
   git show origin/main:apps/api/src/modules/customer-journey/sql/journey-state.sql | grep -c 'is_system_user'
   ```
   - ทั้งสองบรรทัดต้องได้ **มากกว่า 0** · ได้ 0 = PR นั้นยังไม่ merge → ห้าม merge PR นี้ ทำตาม runbook เฟส 1 หัวข้อ 9 ก่อน
2. branch ของ PR นี้ต่อจาก main นั้น: `git merge-base --is-ancestor origin/main <branch ของ PR นี้> && echo ok` ต้องพิมพ์ `ok` · ไม่พิมพ์ = rebase ก่อน
3. หัวข้อ 9.2 ของ runbook เฟส 1 จบแล้ว (รัน backfill แล้ว หรือเลือกรอ sweep และผ่านคืนเสาร์→อาทิตย์ไปแล้ว) และ job ไม่ถือ env เขียนจริงค้าง:
   ```bash
   gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --format='value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
   ```
   - env ต้องมีแค่ `EXPECTED_DB_NAME` · เห็น `CONFIRM_BACKFILL` / `ALLOW_PROD_BACKFILL` = ถอดก่อนด้วยคำสั่งท้ายหัวข้อ 9.2 ของ runbook เฟส 1

### 1.2 จดของเดิมไว้ถอย

1. image ของ `bestchoice-api` ที่รับ traffic 100%:
   ```bash
   gcloud run services describe bestchoice-api --project=bestchoice-prod --region=asia-southeast1 --format='value(status.traffic)'
   gcloud run revisions describe <REVISION ที่ได้ 100%> --project=bestchoice-prod --region=asia-southeast1 --format='value(spec.containers[0].image)'
   ```
   - จด tag หลัง `api:` ที่เห็นจริงบน revision — เรียกค่านี้ว่า `<SHA40 ก่อนเฟส 3>`
2. release ปัจจุบันของ Firebase Hosting site admin (`bestchoicephone.app`) — Firebase console → Hosting → ประวัติ release

### 1.3 นับก่อน (MCP นับอย่างเดียว)

```sql
SELECT stage, count(*) FROM customer_journey_states GROUP BY 1 ORDER BY 1;
SELECT count(*) AS will_move FROM customer_journey_states WHERE stage = 'CREDIT' AND interested_at IS NOT NULL;
```
- จดทั้งสองผล — `will_move` = จำนวนแคชที่กติกาใหม่ย้ายจาก `CREDIT` ไป `INTERESTED`
- `mcp_ro` อ่าน `stage` / `interested_at` / `credit_at` ได้ (`.claude/mcp/sql/grants.sql`) — ไม่ต้องใช้ role เจ้าของ

### 1.4 ช่วงเวลาที่ merge ได้

- **จันทร์–พฤหัส ช่วงเช้า** — ขั้น 3–5 ต้องจบวันเดียวกัน
- **ห้าม 03:00–04:30 น.** (cron `journey:recompute` แข่งเขียนแคช) · **ห้ามวันเสาร์**
- ห้าม merge PR อื่นซ้อนจนกว่าขั้น 5 ผ่าน — run เข้าคิวและขึ้น HEAD ใหม่ทับ (runbook เฟส 1 หัวข้อ 0)

### 1.6 นับห้องที่ลูกค้าส่งไฟล์ในแชท (MCP นับอย่างเดียว · Task 3)

หลัง deploy และ `backfill:customer-journey` ผู้สนใจทุกคนที่เคยส่งไฟล์เอกสารในแชทจะขึ้นขั้น 3 ตรวจเครดิต ⇒ นับก่อนกด merge

- "ไฟล์เอกสาร" = `chat_messages` role `CUSTOMER` + type `FILE` + `media_url` ลงท้ายด้วย .pdf / .doc / .docx / .xls / .xlsx (ไม่สนตัวพิมพ์ · ตามด้วย `?` ได้) — เงื่อนไขเดียวกับโค้ด (`CUSTOMER_DOCUMENT_FILE_SQL` ใน `apps/api/src/modules/customer-journey/chat-document-file.ts` · คำตัดสินผู้ควบคุม R-P1)
- ใช้ MCP `bestchoice-db` (อ่านอย่างเดียว — `mcp_ro` มีสิทธิ์คอลัมน์ `media_url` อยู่แล้ว) หรือ psql ผ่าน cloud-sql-proxy
- **นับอย่างเดียว** — `media_url` อยู่ใน WHERE เท่านั้น · ห้ามเลือกคอลัมน์เนื้อหา (`text` / `media_url` / `media_type`) ออกมา และห้ามดึง `room_id` ออกมาเป็นรายการ

```sql
SELECT count(DISTINCT m.room_id) AS rooms_with_customer_document,
       count(*) AS customer_documents
FROM chat_messages m
WHERE m.role = 'CUSTOMER' AND m.type = 'FILE' AND m.media_url ~* '\.(pdf|docx?|xlsx?)(\?|$)';
```

- ตัวเทียบ (นับรวมอย่างเดียว 2026-09-15): ประมาณ 416 ห้อง (818 ไฟล์ .pdf + เอกสาร office 1 ไฟล์) · จดตัวเลขที่ได้ลง PR
- ตัวเลขสูงกว่าตัวเทียบมาก = แจ้งเจ้าของก่อน merge (ห้องเหล่านั้นทั้งหมดจะขึ้นขั้น 3 ทันทีหลัง backfill)
- ⚠️ สิ่งที่เจ้าของต้องรู้: webhook Facebook (`facebook-webhook.controller.ts` `parseMessage`) เก็บไฟล์แนบชนิดที่ไม่รู้จัก (`fallback` / `template` เช่นลูกค้าแชร์ลิงก์หรือโพสต์) เป็น `FILE` (`attachmentTypeMap[attachment.type] ?? MessageType.FILE`)
  - เงื่อนไขนามสกุลเอกสารกันไว้แล้ว: `media_url` ว่าง (ประมาณ 48 ห้อง) และลิงก์ facebook.com (ประมาณ 25 ห้อง) ไม่นับ ไม่ขึ้นขั้น 3
  - เลิกแปลงลิงก์แชร์เป็น `FILE` ที่ตัวแปลงของ webhook = งานต่อยอดนอกเฟส 3 (เจ้าของตัดสิน)
  - สัญญาณมาจาก Facebook อย่างเดียว (LINE ขาเข้าไม่เคยเขียน FILE)
- สัญญาณนี้ไม่มีคอลัมน์ใหม่และไม่ตั้ง path ⇒ ถอย API image = คำนวณแคชใหม่ด้วย backfill ตัวเดียวกัน (ไม่มีข้อมูลต้องล้าง)

## 2. merge PR นี้ + ด่านหลัง merge

1. merge แล้วจด `<SHA40 ของเฟส 3>` = commit ของ run จากหน้า Actions (image ที่ pipeline push ใช้ tag นี้)
2. **ผ่านเมื่อครบทุกข้อ:**
   - run เขียวครบ: `lint-and-test` · `build-and-push-api` · `migrate-db` · `deploy-api` · `deploy-web` (skipped นับเป็นไม่เขียว)
   - `curl https://api.bestchoicephone.app/api/health` ok
   - บันเดิลของ `https://bestchoicephone.app/` เป็นเลข `version` ใน `apps/web/package.json` ของ merge commit
   - image ของ revision ที่รับ traffic 100% = `api:<SHA40 ของเฟส 3>` — คำสั่งเดียวกับข้อ 1.2
3. ไม่ผ่านข้อใด = ยังไม่นับว่าขึ้น ห้ามเริ่มขั้น 3 · เว็บขึ้นแต่สาย API ไม่เขียว = ถอยเว็บ (หัวข้อ "ถอย" → ข้อ 2) แล้วหาสาเหตุก่อน merge/รัน pipeline ซ้ำ

## 3. `backfill:customer-journey` dry-run

🚨 ห้ามรันช่วง 03:00–04:30 น. เวลาไทย

job `bestchoice-backfill-customer-journey` มีอยู่แล้วจากเฟส 1 — ห้าม `jobs create` ซ้ำ · เปลี่ยน image + ถอด env เขียนจริง แล้วตรวจก่อนรัน:
```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ของเฟส 3> \
  --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV
gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --format='value(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="bestchoice-backfill-customer-journey"' --project=bestchoice-prod --freshness=2h --limit=200 --format='value(textPayload,jsonPayload.message)'
```
- `describe` ต้องเห็น image = `<SHA40 ของเฟส 3>` และ env มีแค่ `EXPECTED_DB_NAME` — ไม่ตรงห้าม execute
- **exit 0** → ขั้น 4
- **exit 1** = ห้องไม่มีเจ้าของเกิน 1% → หยุด ส่ง log ให้ dev
- **exit 2** = จำนวน PURCHASED ≠ BOUGHT_WHERE หรือบางชุดล้ม (`[run] FAILED batch …`) → หยุด ส่ง log ให้ dev
  - ลำดับขั้นใหม่ไม่แตะขั้น `PURCHASED` ⇒ parity ของ dry-run ต้องเหมือนก่อน merge
  - log มีแค่ id และตัวเลข

## 4. รันจริง

ช่วงเงียบ — ไม่ใช่ช่วง 03:00–04:30 น. · รันซ้ำได้ (`INSERT … ON CONFLICT`)
```bash
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait
gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
  --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV
```
- คำสั่งสุดท้ายถอด env ทันทีหลังรัน — job ที่ค้าง env เขียนจริงคือกับดักของ dry-run ครั้งหน้า
- อ่านผลแบบขั้น 3 (exit 0 ไปขั้น 5 · exit 1/2 หยุด ส่ง log ให้ dev)

## 5. ตรวจหลัง backfill (MCP นับอย่างเดียว)

```sql
SELECT stage, count(*) FROM customer_journey_states GROUP BY 1 ORDER BY 1;
SELECT count(*) AS stale_credit FROM customer_journey_states WHERE stage = 'CREDIT' AND interested_at IS NOT NULL;
SELECT count(*) AS moved FROM customer_journey_states WHERE stage = 'INTERESTED' AND credit_at IS NOT NULL;
```
**ผ่านเมื่อ:**
- `stale_credit` = **0** — มากกว่า 0 = มีแถวที่ยังคำนวณด้วยกติกาเดิม (image ของ job ผิด หรือบางชุดล้ม) → ห้ามไปต่อ ส่งตัวเลขให้ dev
- `moved` ไม่น้อยกว่า `will_move` ของข้อ 1.3 ลบด้วยจำนวน `PURCHASED` ที่เพิ่มขึ้นระหว่างข้อ 1.3 กับข้อนี้ (คนที่ซื้อระหว่างรอออกจากกลุ่มนี้ได้) · น้อยกว่านั้น → ส่งทั้งสองตัวเลขให้ dev
- ผลรวมทุกขั้นใกล้ผลรวมของข้อ 1.3 (ต่างได้เท่าลูกค้าใหม่ระหว่างรอ)
- เปิดหน้า `/customers/<customer_id>` ของคนหนึ่งจาก:
  ```sql
  SELECT customer_id FROM customer_journey_states WHERE stage = 'INTERESTED' AND credit_at IS NOT NULL ORDER BY computed_at DESC LIMIT 1;
  ```
  แถบขั้นต้องเป็น "3 ตรวจเครดิต" มีวันที่ (หรือแดง "เครดิตไม่ผ่าน") และ "4 นัด / จอง" เป็นขั้นปัจจุบัน

## ถอย (rollback)

### ถอยเพราะลำดับขั้น

ถอย image **อย่างเดียวไม่พอ**: แคชที่ image เฟส 3 เขียน (`INTERESTED` ที่มีใบตรวจเครดิต) จะถูก builder เก่าวาดขั้น "ตรวจเครดิต" เป็น "ยังไม่ถึง" ไม่มีวันที่ — ทำครบตามลำดับ:

1. **ถอย `bestchoice-api`** ไป image ที่จดในข้อ 1.2:
   ```bash
   gcloud run services update bestchoice-api --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ก่อนเฟส 3>
   ```
   - 🚨 ห้ามใช้ `gcloud run deploy` ชุดเต็มจากเครื่อง (env/secret ของ service จะเพี้ยน)
2. **ถอยเว็บ** — Firebase console → Hosting → site admin (`bestchoicephone.app`) → ประวัติ release → Rollback ไป release ที่จดในข้อ 1.2
   - ป้ายและลำดับเดิมต้องมาคู่กับ API เก่า · site shop ไม่ต้องถอย
3. **รอให้ instance ของ revision เฟส 3 หมดก่อนคำนวณใหม่** — ไม่งั้นหน้าลูกค้า/cron บน instance เก่าเขียนลำดับใหม่กลับเข้ามา
   ```bash
   gcloud run services describe bestchoice-api --project=bestchoice-prod --region=asia-southeast1 --format='value(status.traffic)'
   ```
   - revision ของ `<SHA40 ก่อนเฟส 3>` ได้ 100%
   - revision ของเฟส 3 ไม่มี instance เหลือ: Cloud Run console → `bestchoice-api` → Metrics → Container instance count แยกตาม revision = 0 · ดูไม่ได้ให้รอ ≥ 60 นาทีหลังสลับ traffic
   - นอกช่วง 03:00–04:30 น.
4. **คำนวณใหม่ทั้งหมดด้วย job ที่ image ตรงกับข้อ 1** — ขั้น 3 เปลี่ยน image ของ job เป็นเฟส 3 ไปแล้ว:
   ```bash
   gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --image=asia-southeast1-docker.pkg.dev/bestchoice-prod/bestchoice/api:<SHA40 ก่อนเฟส 3> \
     --update-env-vars=CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
   gcloud run jobs describe bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 \
     --format='value(spec.template.spec.template.spec.containers[0].image)'
   gcloud run revisions describe <REVISION ที่ได้ 100% จากข้อ 3> --project=bestchoice-prod --region=asia-southeast1 --format='value(spec.containers[0].image)'
   ```
   - สองบรรทัดหลังต้องได้ image **เดียวกัน** — ไม่ตรงห้าม execute
   - แล้ว `gcloud run jobs execute bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --wait`
   - จบแล้วถอด env: `gcloud run jobs update bestchoice-backfill-customer-journey --project=bestchoice-prod --region=asia-southeast1 --remove-env-vars=CONFIRM_BACKFILL,ALLOW_PROD_BACKFILL,NODE_ENV`
   - ตรวจ: `SELECT count(*) FROM customer_journey_states WHERE stage = 'INTERESTED' AND credit_at IS NOT NULL;` ต้องได้ **0** (กติกาเดิมให้คนกลุ่มนี้อยู่ `CREDIT`)
5. **ทำให้ถอยถาวรก่อน merge อะไรเข้า main อีก** — การถอย image เป็นของชั่วคราว (push ถัดไปขึ้น HEAD ทั้งชุด) ⇒ PR ที่ revert PR นี้ merge เป็นอันดับแรก
   - ขึ้นกลับภายหลัง (roll forward) = ทำขั้น 2–5 ของไฟล์นี้ซ้ำทั้งหมด

- ไม่ต้อง reset คอลัมน์ใด (ไม่มีค่าที่ `LEAST` แช่แข็งในเรื่องนี้)
- ถอย image ข้ามเส้นเฟส 3 **ด้วยเหตุผลอื่น** ก็ต้องทำข้อ 3–4 เหมือนกัน — ค่า `stage` ในแคชมีความหมายตาม image ที่เขียนล่าสุดเสมอ
