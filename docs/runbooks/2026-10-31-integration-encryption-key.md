# INTEGRATION_ENCRYPTION_KEY บน prod — ตรวจหลัง deploy (2026-10-31)

ใช้กับ deploy แรกที่ `bestchoice-api` ได้ secret `INTEGRATION_ENCRYPTION_KEY` (`.github/workflows/deploy-gcp.yml`
`--set-secrets` · worker `bestchoice-worker` คัดลอก secret ref จาก API เอง) และทุกครั้งที่สงสัยว่า key ไม่ตรงกับค่าที่เก็บไว้

## ระบบทำอะไร

- ค่า sensitive ใน Integration Hub (`system_config` key `integration.<integration>.<field>`) ถูกเข้ารหัสด้วย key นี้ตอนบันทึก
  (`IntegrationConfigService.saveConfig`) · ค่าที่บันทึกตอนยังไม่มี key เป็น plaintext และอ่านได้ตามเดิม
- ค่าที่เข้ารหัสแต่ถอดไม่ได้ (ไม่มี key / key ผิด / key รูปแบบผิด) = **"ยังไม่ตั้งค่า"** — `getValue` คืน `undefined`
  ไม่คืน ciphertext ไม่ throw และ **ไม่ใช้ env สำรองของช่องนั้น** (แถวใน DB คือค่าที่เจ้าของตั้งทับ env ไว้ —
  env อาจเป็นของ OA/บัญชีอื่น) · webhook ของ OA นั้นถูกปฏิเสธบน production · log/Sentry บอกแค่ชื่อช่อง ไม่มีค่า
- ตอนบูต API (และ worker) เขียน log หนึ่งบรรทัด — **มีเฉพาะเมื่อมีค่าที่เข้ารหัสอยู่**:

  ```
  integration encrypted fields: ok=N failed=M [ช่องที่ถอดไม่ได้…]
  ```

  `failed > 0` = ระดับ warning + Sentry warning "Integration credentials cannot be decrypted with the current key"

## หลัง deploy

1. หาบรรทัดบูตของ revision ใหม่ (อ่าน log อย่างเดียว ไม่ต้องอ่าน secret):

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="bestchoice-api" AND "integration encrypted fields"' \
     --project=bestchoice-prod --freshness=2h --limit=5 \
     --format='value(timestamp,resource.labels.revision_name,jsonPayload.message,textPayload)'
   ```

2. อ่านผล:
   - `ok=2 failed=0` → key ตรงกับค่าที่เก็บไว้ จบ
   - `failed > 0` → ช่องในวงเล็บถูกเข้ารหัสด้วย key อื่น (คาดว่า `line-shop.channelSecret`, `line-shop.channelToken`
     ของ LINE SHOP ที่ยังไม่ได้ต่อกับ prod) — **ก่อนเชื่อม LINE OA ของ SHOP** ให้ OWNER เปิด
     **ตั้งค่า › เชื่อมต่อ › การเชื่อมต่อ** (`/settings/integrations/hub`) → การ์ด "LINE SHOP (ลูกค้า)" →
     กรอก Channel Access Token **และ** Channel Secret ใหม่ทั้งสองช่องในการบันทึกครั้งเดียว → บันทึก →
     "ทดสอบการเชื่อมต่อ" ต้องขึ้นชื่อบอท · ช่องอื่นที่อยู่ในวงเล็บทำแบบเดียวกันที่การ์ดของมัน
   - ไม่มีบรรทัดเลย → ไม่มีค่าที่เข้ารหัสใน DB (ไม่ต้องทำอะไร) · ถ้าเจอ `integration encrypted fields: check failed`
     แทน = อ่าน DB ไม่ได้ตอนบูต ดู log บรรทัดนั้นแล้วรอ revision ถัดไป
3. หลังกรอกใหม่ บรรทัดบูตครั้งถัดไปต้องเป็น `failed=0`

## ห้าม

- ห้ามลบ/เปลี่ยนเวอร์ชัน secret `INTEGRATION_ENCRYPTION_KEY` — ค่าที่บันทึกหลัง deploy นี้ผูกกับ key ตัวนี้
  (ยังไม่มีสคริปต์เข้ารหัสใหม่ — หมุน key = ต้องกรอกทุกช่องที่ `failed` ใหม่)
- ห้าม log / echo ค่า secret หรือค่าใน `system_config` เพื่อ "ตรวจ" — ใช้บรรทัดบูตแทน
- CLI ที่อ่าน creds จาก Integration Hub บนเครื่องตัวเอง (`scripts/ops/train-ai-prod.sh` ดึง key ให้แล้ว ·
  `backfill-fb-profiles.cli.ts`) ต้องได้ key ตัวเดียวกัน ไม่งั้นค่าที่เข้ารหัสอ่านเป็น "ยังไม่ตั้งค่า" ·
  ด่าน PEAK ของ `import:legacy-backoffice` นับค่า PEAK ที่ถอดไม่ได้ว่า "ตั้งค่าอยู่" (ปฏิเสธการเขียน) ไม่ว่า CLI มี key หรือไม่
