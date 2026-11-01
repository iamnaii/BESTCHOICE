# INTEGRATION_ENCRYPTION_KEY บน prod — ตรวจหลัง deploy (2026-10-31)

ใช้กับ deploy แรกที่ `bestchoice-api` ได้ secret `INTEGRATION_ENCRYPTION_KEY` (`.github/workflows/deploy-gcp.yml`
`--set-secrets` **pin เวอร์ชัน `:1`** ไม่ใช่ `:latest` · worker `bestchoice-worker` คัดลอก secret ref จาก API เอง) และทุกครั้ง
ที่สงสัยว่า key ไม่ตรงกับค่าที่เก็บไว้

## ระบบทำอะไร

- ค่า sensitive ใน Integration Hub (`system_config` key `integration.<integration>.<field>`) ถูกเข้ารหัสด้วย key นี้ตอนบันทึก
  (`IntegrationConfigService.saveConfig`) · ค่าที่บันทึกตอนยังไม่มี key เป็น plaintext และอ่านได้ตามเดิม
- key ต้องเป็น hex 64 ตัว (ตัดช่องว่าง/ขึ้นบรรทัดหัวท้ายให้) — กติกาเดียวกับ `PII_ENCRYPTION_KEY` · key รูปแบบผิด
  (เช่น base64 จาก `openssl rand -base64 32` หรือ hex 32 ตัว) = **ถือว่าไม่มี key**: บูตไม่ล้ม แต่ log error +
  Sentry "INTEGRATION_ENCRYPTION_KEY malformed (need 64 hex chars)" · ค่าที่บันทึกระหว่างนั้นเก็บแบบไม่เข้ารหัส
- ค่าที่เข้ารหัสแต่ถอดไม่ได้ (ไม่มี key / key ผิด / key รูปแบบผิด) = **"ยังไม่ตั้งค่า"** — `getValue` คืน `undefined`
  ไม่คืน ciphertext ไม่ throw และ **ไม่ใช้ env สำรองของช่องนั้น** (แถวใน DB คือค่าที่เจ้าของตั้งทับ env ไว้ —
  env อาจเป็นของ OA/บัญชีอื่น) · webhook ของ OA นั้นถูกปฏิเสธบน production · log/Sentry บอกแค่ชื่อช่อง ไม่มีค่า
- ตอนบูต API (และ worker) เขียน log หนึ่งบรรทัด — **ทุกครั้งที่ตั้ง key ไว้ (รูปแบบถูกหรือผิด) หรือมีค่าที่เข้ารหัสอยู่**
  (ไม่มีบรรทัด = ไม่มี key และไม่มีค่าที่เข้ารหัส):

  ```
  integration encrypted fields: key=ok|missing|malformed ok=N [ช่องที่ถอดได้…] failed=M [ช่องที่ถอดไม่ได้…]
  ```

  `failed > 0` หรือ `key=malformed` = ระดับ warning · `failed > 0` ส่ง Sentry warning
  "Integration credentials cannot be decrypted with the current key"

## หลัง deploy

1. หาบรรทัดบูตของ revision ใหม่ ทั้ง API และ worker (อ่าน log อย่างเดียว ไม่ต้องอ่าน secret):

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name=("bestchoice-api" OR "bestchoice-worker") AND "integration encrypted fields"' \
     --project=bestchoice-prod --freshness=2h --limit=10 \
     --format='value(timestamp,resource.labels.service_name,resource.labels.revision_name,jsonPayload.message,textPayload)'
   ```

   ทุก instance เขียนบรรทัดของตัวเอง — ผลต้องเหมือนกันทุกบรรทัดของ revision เดียวกัน · worker มีเฉพาะเมื่อเปิด
   `CRON_WORKER_ENABLED`

   **ปุ่ม "ทดสอบการเชื่อมต่อ" — อ่านข้อความเป็นหลัก:** เว็บก่อน 26.10.74 แสดงผลทุกแบบเป็นกล่องสีเขียวมีเครื่องหมายถูก แม้ API ตอบ
   ล้มเหลว (บั๊กเดิมของ `IntegrationHubPage` — แก้ใน 26.10.74: API ตอบ `success: false` = กล่องแดงไอคอนกากบาท) ·
   ผ่าน = ข้อความขึ้นต้น "เชื่อมต่อ" และมีคำว่า "สำเร็จ"
   (LINE SHOP: "เชื่อมต่อ ไลน์ร้าน (SHOP) สำเร็จ: ‹ชื่อบอท›") · ข้อความอื่น เช่น "ยังไม่ได้ตั้งค่า Channel Access Token ของ ไลน์ร้าน (SHOP)"
   หรือ "LINE API ตอบกลับ HTTP 401" = **ล้มเหลว**

2. อ่านผล (ทำข้อแรกที่ตรงก่อน):
   - `key=malformed` → **อย่ากรอกค่าใหม่ในหน้าเชื่อมต่อ** (ค่าที่บันทึกตอนนี้จะไม่ถูกเข้ารหัส) · ให้ผู้ดูแล GCP เพิ่ม version
     ใหม่ของ secret ด้วย `openssl rand -hex 32` แล้ว pin เลข version นั้นใน `deploy-gcp.yml` และ deploy — ช่องที่เคยถอดได้ด้วย
     key เดิม (ถ้ามี) จะกลายเป็น `failed` ต้องกรอกใหม่หลัง deploy
   - `failed=0` และ `ok` มีชื่อช่อง → key ตรงกับค่าที่เก็บไว้ **แต่ยังไม่จบ**: ค่าเหล่านี้ไม่มีใครรู้ว่ากรอกเมื่อไร/ของบัญชีไหน
     และเริ่มใช้งานทันทีใน revision นี้ ⇒ OWNER เปิด **ตั้งค่า › เชื่อมต่อ › การเชื่อมต่อ** แล้วกด "ทดสอบการเชื่อมต่อ"
     ที่การ์ดของทุก integration ที่มีชื่อในวงเล็บ `ok` (เช่น `line-shop.*` → การ์ด "LINE SHOP (ลูกค้า)" ต้องขึ้นชื่อบอท/OA ของ
     SHOP ที่ตั้งใจ) ก่อนพึ่งพามัน · ถ้ามี `peak.*` อยู่ใน `ok` = รอบส่ง PEAK อัตโนมัติ (23:30 ทุกคืน) จะเริ่มส่งรายการ
     ด้วยข้อมูลนั้นตั้งแต่ deploy นี้ — ตรวจการ์ด PEAK ทันที · integration ที่ไม่มีปุ่มทดสอบ (เช่น Yeastar, e-Tax)
     ตรวจจากหน้าใช้งานของมัน
   - `key=ok ok=0 [] failed=0 []` → ยังไม่มีค่าที่เข้ารหัส key พร้อมใช้ จบ
   - `failed > 0` → ช่องในวงเล็บถูกเข้ารหัสด้วย key อื่น (คาดว่า `line-shop.channelSecret`, `line-shop.channelToken`
     ของ LINE SHOP ที่ยังไม่ได้ต่อกับ prod) — **ก่อนเชื่อม LINE OA ของ SHOP** ให้ OWNER เปิด
     **ตั้งค่า › เชื่อมต่อ › การเชื่อมต่อ** (`/settings/integrations/hub`) → การ์ด "LINE SHOP (ลูกค้า)" →
     กรอก Channel Access Token **และ** Channel Secret ใหม่ทั้งสองช่องในการบันทึกครั้งเดียว → บันทึก →
     "ทดสอบการเชื่อมต่อ" ต้องขึ้นชื่อบอท · ช่องใน `failed` **ไม่มีปุ่ม "ล้างค่า"** (ถอดไม่ได้ = หน้าเว็บแสดงเป็น "ยังไม่ตั้งค่า")
     ⇒ ทางเดียวที่ทำให้ชื่อหายจาก `failed` คือกรอกค่าใหม่แล้วบันทึก (ทับ ciphertext เดิม) · ช่องอื่นที่อยู่ในวงเล็บ `failed`
     ทำแบบเดียวกันที่การ์ดของมัน ·
     ช่องที่อยู่ในวงเล็บ `ok` ทำตามข้อก่อนหน้า
   - ไม่มีบรรทัดเลย → revision นี้ไม่ได้รับ key (ตรวจ `--set-secrets` ของ deploy) · ถ้าเจอ
     `integration encrypted fields: check failed` แทน = อ่าน DB ไม่ได้ตอนบูต ดู log บรรทัดนั้นแล้วรอ revision ถัดไป
3. หลังกรอกใหม่: กด "บันทึก" แล้วหน้าต่างการ์ด**ปิดเอง** — เปิดการ์ดเดิมอีกครั้งแล้วกด "ทดสอบการเชื่อมต่อ" ·
   ถ้าขึ้น "ยังไม่ได้ตั้งค่า…" ทั้งที่เพิ่งบันทึก = คำขอไปตก instance อื่นที่ยังจำค่าเก่าไว้ (`getConfig` cache 5 นาที ล้างเฉพาะ
   instance ที่รับการบันทึก) — รอ 5 นาทีแล้วกดใหม่ · บรรทัดบูตครั้งถัดไปต้องเป็น `failed=0` · **Facebook Page Access Token:**
   ระหว่าง 5 นาทีนั้น คอมเมนต์เพจที่ตกไป instance ที่ยังจำค่าเดิม (ถอดไม่ได้ = ว่าง) ถูกข้ามถาวร ไม่ส่งซ้ำ (ดูหัวข้อถัดไป)

## ล้างค่าช่องลับ (web 26.10.75)

- ปุ่ม **"ล้างค่า"** ข้างช่องลับที่**ตั้งค่าแล้วและอ่านค่าได้** (มาจากหน้านี้หรือ env · หน้าต่างแก้ไขของการ์ด · OWNER เท่านั้น)
  → ยืนยัน → ล้าง**ทันที** ไม่ต้องกดบันทึก · ย้อนกลับไม่ได้ — ต้องกรอกค่าใหม่เอง · จะเปลี่ยนเป็นค่าใหม่ไม่ต้องล้างก่อน กรอกทับแล้วบันทึกได้
- ช่องที่**ถอดรหัสไม่ได้** (อยู่ในวงเล็บ `failed` ของบรรทัดบูต) **ไม่มีปุ่มนี้** — หน้าเว็บแสดงเป็น "ยังไม่ตั้งค่า" ⇒ แก้ด้วยการกรอกค่าใหม่
  แล้วบันทึกเท่านั้น (ทับ ciphertext เดิม)
- เก็บสถานะ "ล้างแล้ว" ไว้ในแถว (`CLEARED_CREDENTIAL` — ไม่ใช่ค่าลับ ไม่เข้ารหัส) ⇒ ช่องนั้นอ่านเป็น
  **"ยังไม่ตั้งค่า" และไม่ถอยไปใช้ env/Secret Manager** (ต่างจากแถวว่าง) · การ์ดขึ้น "ยังไม่ตั้งค่า" เมื่อเป็นช่องจำเป็น ·
  ปุ่มทดสอบตอบ "ยังไม่ได้ตั้งค่า…" · webhook ของ OA นั้นถูกปฏิเสธบน production (ล้าง Channel Secret)
- บรรทัดบูต **ไม่นับ** ช่องที่ล้างแล้วทั้งใน `ok` และ `failed` — ช่องที่เคยอยู่ในวงเล็บ `ok` จะหายจากบรรทัดบูตครั้งถัดไป
- บันทึกค่าใหม่ที่ไม่ว่าง = ใช้งานได้อีกทันที · `DELETE /integrations/:key/config` (ลบทั้ง integration "กลับไปใช้ env")
  ลบสถานะล้างแล้วด้วย = env กลับมาใช้
- มีผล**ทันที**เฉพาะผู้อ่านที่ใช้ `getValue` (LINE ทั้ง 3 OA · Claude · อีเมล · PEAK · SMS · PaySolutions · MDM · e-Tax) ·
  ผู้อ่านผ่าน `getConfig` cache — **ผู้อ่าน Facebook ทุกตัว** · **Yeastar** (webhook · token · ดึงประวัติการโทร) ·
  การ์ดและปุ่มทดสอบ — บน instance อื่นของ API/worker อาจยังใช้ค่าเดิมได้ถึง **5 นาที** (แบบเดียวกับการบันทึก) ⇒ ถ้าล้างเพราะค่ารั่ว
  ให้นับว่า Facebook/Yeastar ยังรับ/ส่งด้วยค่าเดิมได้อีก 5 นาที · Facebook Verify Token ใช้เฉพาะตอน Meta ยืนยัน webhook (คำขอ GET
  เมื่อตั้งหรือแก้ Callback URL ในหน้าแอปของ Meta — `FacebookWebhookController.verifyWebhook`) — ล้างแล้วการยืนยันนั้นไม่ผ่านจนกว่าจะบันทึกค่าใหม่ ·
  การรับ Messenger (ตรวจลายเซ็นด้วย App Secret) และฟีเจอร์คอมเมนต์เพจไม่ใช้ค่านี้ (`FacebookCommentGraphTransport.credentials()` เลิกบังคับ
  ตั้งแต่ Task 35) · **Facebook Page Access Token**: ล้างแล้วส่งข้อความ Messenger ออกไม่ได้ (บอทและพนักงานที่ตอบจากอินบ็อกซ์) ·
  ข้อความที่ลูกค้าส่งเข้ามายังเข้าอินบ็อกซ์ แต่ห้องใหม่ไม่มีชื่อ/รูปโปรไฟล์ · ตอบคอมเมนต์ไม่ได้ และถ้าเปิดรับคอมเมนต์ไว้ คอมเมนต์ใหม่ถูกข้าม
  (webhook ตอบ 200 — Meta ไม่ส่งซ้ำ จึงไม่มีทางได้คืน · Sentry warning `action: comment-ingest-skipped` reason `COMMENT_CONFIG_INCOMPLETE`) ·
  ปุ่ม "ตั้งค่าปุ่ม Get Started" / "Backfill รูปโปรไฟล์" / การทดสอบ App Review ที่ใช้ token ของเพจ และการดึงคลังคำตอบจากแชท Facebook
  (`chat-history` extract · `train-ai-knowledge` CLI) ใช้ไม่ได้ · Page Access Token ที่**ถอดรหัสไม่ได้** (อยู่ในวงเล็บ `failed`) ให้ผล
  **เท่าล้างค่าทุกข้อ** รวมคอมเมนต์ถูกข้ามถาวร (`getValue` คืนว่าง) · หลังกรอกค่าใหม่ instance อื่นอาจยังใช้ config เดิมได้ถึง 5 นาที —
  คอมเมนต์ที่ตกไปที่นั่นถูกข้ามถาวรเช่นกัน · ต่างจาก **App Secret** ที่ล้าง/ถอดไม่ได้: ทุกคำขอ webhook ตกการตรวจลายเซ็น (400) ก่อนถึงคอมเมนต์
  ⇒ ทั้ง Messenger และคอมเมนต์ค้างรอ Meta ส่งซ้ำตามรอบของ Meta จนกว่าจะบันทึกค่าใหม่ · **คอมเมนต์ล้มกับ Messenger ในคำขอเดียวกัน (Task 35 ทาง 4):**
  ล้มแบบส่งซ้ำแล้วไม่หาย (ตั้งค่าไม่ครบ · Meta ตอบแล้วว่า token/สิทธิ์/การสมัคร feed ไม่พร้อม · เหตุการณ์ผิดรูป/ไม่ตรงโพสต์เดิม) = ข้ามคอมเมนต์
  แจ้ง Sentry (id + รหัสเหตุผลเท่านั้น) แล้วประมวลผล Messenger ต่อ ตอบ 200 · การซ่อน/เลิกซ่อนคอมเมนต์ (`hide`/`unhide` —
  `COMMENT_VERB_UNSUPPORTED`) ข้ามแบบเดียวกันแต่ log ระดับ info ไม่แจ้ง Sentry · ล้มชั่วคราว (ฐานข้อมูล · Graph ล่ม/5xx/ติด rate limit/timeout · ไม่แน่ใจ)
  = ตอบ 5xx ให้ Meta ส่งซ้ำ และ Messenger ในคำขอนั้นรอจนส่งซ้ำแล้วสำเร็จ (ตามเดิม — ตั้งแต่ Task 37 event ของ Messenger ที่ส่งซ้ำถูกกันซ้ำราย event ใน `processed_webhook_events` จึงไม่ทำงานสองรอบ ยกเว้น event ที่ไม่มีทั้ง `mid` และ `timestamp` (ทำงานแบบเดิม) และรอบที่ claim ล้มเพราะฐานข้อมูล (ประมวลผลต่อ + Sentry `messenger-dedupe-unavailable`)) · ตัวตัดสินอยู่ที่
  `facebook-comment-ingest-failure.ts` ที่เดียว · ทดสอบหลังล้างแล้วยังผ่าน ให้รอ 5 นาทีแล้วกดใหม่
- การ์ด Claude: ล้างแล้วหยุดเฉพาะฟีเจอร์ที่อ่านคีย์ผ่าน Hub (บอทน้องเบส · อ่านสลิป · OCR · วิเคราะห์เครดิต · บอท LINE SHOP แบบเดิม) —
  **บอทขายในอินบ็อกซ์ (`sales-bot/providers/claude.provider.ts`) · `chat-history-extractor/knowledge-extractor.service.ts` ·
  `staff-chat/services/sales-state.service.ts` · `ai-usage/ai-text.service.ts` · `chat-engine/services/after-hours.service.ts`**
  อ่าน `ANTHROPIC_API_KEY` จาก env ของ API (ถ้าตั้งไว้) จึงไม่หยุดตาม ⇒ ถ้าต้องตัดคีย์ทั้งระบบ (เช่นคีย์รั่ว) ต้องเอา/หมุน env นั้นด้วย ·
  การ์ดอีเมล: อีเมลทุกฉบับวันนี้ส่งผ่าน `EmailService` (Hub) จึงหยุดทั้งหมด · `notifications/email-provider.service.ts` อ่าน `SMTP_*`
  ตรงแต่ยังไม่มีผู้เรียก
- audit `INTEGRATION_SECRET_CLEARED` (entity `integrations`, entityId `<integration>.<field>`) บอกผู้กด + ที่มาของค่าก่อนล้าง
  (`database` / `env` / `default` / `cleared` / `none`) — ไม่มีค่า

## ห้าม

- ห้ามปิด/ลบเวอร์ชันที่ `deploy-gcp.yml` pin ไว้ และ**ห้ามแค่แก้เลข pin** — ค่าที่บันทึกหลัง deploy นี้ผูกกับ key ตัวนี้
  (ยังไม่มีสคริปต์เข้ารหัสใหม่) · หมุน key = แผนครบชุด: (1) `gcloud secrets versions add` ด้วย `openssl rand -hex 32`
  (2) จดรายการช่องในวงเล็บ `ok` ของบรรทัดบูตปัจจุบัน (3) แก้เลข pin + deploy (4) ช่องเหล่านั้นจะเป็น `failed` —
  OWNER กรอกใหม่ทุกช่องแล้วทดสอบตามข้อ 3 (5) ปิดเวอร์ชันเก่าเมื่อบรรทัดบูตเป็น `failed=0` แล้วเท่านั้น
- ดูเลข/สถานะเวอร์ชันได้โดยไม่อ่านค่า: `gcloud secrets versions list INTEGRATION_ENCRYPTION_KEY --project bestchoice-prod
  --format='value(name,state)'` — **ห้าม** `versions access` เพื่อดู/พิมพ์ค่า (ใช้ได้เฉพาะส่งเข้า env ของ CLI ด้านล่าง)
- ห้าม log / echo ค่า secret หรือค่าใน `system_config` เพื่อ "ตรวจ" — ใช้บรรทัดบูตแทน
- CLI ที่อ่าน creds จาก Integration Hub บนเครื่องตัวเอง (`scripts/ops/train-ai-prod.sh` ดึงเวอร์ชันที่ `deploy-gcp.yml` pin ไว้ให้แล้ว ·
  `backfill-fb-profiles.cli.ts` · `import:legacy-backoffice`) ต้องได้ key ตัวเดียวกัน ไม่งั้นค่าที่เข้ารหัสอ่านเป็น "ยังไม่ตั้งค่า" —
  ส่งเข้า env แบบไม่พิมพ์ค่า: `export INTEGRATION_ENCRYPTION_KEY="$(gcloud secrets versions access <เลข pin> --secret=INTEGRATION_ENCRYPTION_KEY --project bestchoice-prod)"`
  (ห้ามใส่เป็น prefix หน้าคำสั่ง npm — ค่าโผล่ใน process title) · ด่าน PEAK ของ `import:legacy-backoffice` นับค่า PEAK ที่ถอดไม่ได้
  ว่า "ตั้งค่าอยู่" (ปฏิเสธการเขียน) ไม่ว่า CLI มี key หรือไม่ — ข้อความบอกชื่อช่องที่ถอดไม่ได้ ให้ส่ง key ตามข้างบนแล้วรันใหม่
