# Runbook — backfill `users.accessible_companies` / `users.primary_company` (prod, manual)

_2026-09-10 · เลเยอร์ 1 ของ hotfix `fix/user-company-access-lockout` · CLI `backfill:user-companies` (`apps/api/src/cli/backfill-user-companies.cli.ts` → dist) · DRY-RUN เป็นค่าเริ่มต้น + idempotent รันซ้ำได้_

---

> ## ⚠️ อ่านก่อนแตะอะไรทั้งสิ้น
>
> **1. ห้ามรัน backfill ก่อน deploy โค้ดชุดนี้** — outage ถูกดับด้วย *ตรรกะ* ไม่ใช่ข้อมูล
> (`resolveCompanyAccess()` แปล array ว่างเป็น "ยังไม่ตั้งค่า" → คืนค่า default ของ role)
> backfill ตัวนี้แค่ทำให้ข้อมูลในฐานตรงกับสิ่งที่ระบบ resolve ให้อยู่แล้ว ถ้ายังไม่ deploy
> ก็ยังไม่ต้องรีบรัน และ CLI ตัวใหม่รันเป็น Cloud Run Job ไม่ได้ด้วยซ้ำ เพราะมันเป็น
> `node dist/...` ซึ่งต้องมีอยู่ใน image ที่ deploy แล้ว (`Dockerfile:90` copy แค่ `apps/api/dist`)
>
> **2. ห้ามรัน CLI เวอร์ชันเก่าเด็ดขาด** — map เดิม (`ROLE_ACCESS_MAP` ที่ถูกลบไปแล้ว) เขียน
> `FINANCE_MANAGER = ['FINANCE']` และ `VIEWER = ['SHOP']` ซึ่ง **ผิดทั้งคู่** และเมื่อคอลัมน์
> กลายเป็น non-empty แล้ว fallback จะไม่ทำงานกับแถวนั้นอีก = **ค่าผิดกลายเป็นค่าถาวร**
> ต้องแก้ด้วยมือทีละแถวเท่านั้น เช็คก่อนรันทุกครั้งว่า image/โค้ดที่ใช้มาจาก commit ที่มี
> `packages/shared/src/company-access.ts` แล้ว
>
> **3. source of truth มีชุดเดียว** = `packages/shared/src/company-access.ts`
> CLI ไม่มี map ของตัวเอง มันเรียก `roleCompanyAccess()` ตัวเดียวกับที่ `JwtStrategy`,
> `EntityScopeInterceptor` และเมนูฝั่ง web ใช้ ถ้าจะแก้ค่าให้แก้ที่ไฟล์นั้นที่เดียว

## ค่าที่ CLI จะเขียน (map ปัจจุบัน)

| role | accessible_companies | primary_company |
|---|---|---|
| OWNER | `SHOP, FINANCE` | `SHOP` |
| FINANCE_MANAGER | `SHOP, FINANCE` | `FINANCE` |
| ACCOUNTANT | `SHOP, FINANCE` | `FINANCE` |
| VIEWER | `SHOP, FINANCE` | `FINANCE` |
| BRANCH_MANAGER | `SHOP` | `SHOP` |
| SALES | `SHOP` | `SHOP` |

ขอบเขตของแถวที่ถูกแตะ: `accessible_companies = '{}'` **และ** `deleted_at IS NULL` **และ**
`is_system_user = false`
system user (`system@bestchoice.internal`, `legacy-import@bestchoice.com`) ถูกข้ามโดยตั้งใจ —
แถว system ถูกสองที่แย่งกัน upsert ด้วย role ต่างกัน (canned-response-sender = `SALES`,
`collections-foundation.seed.ts` = `OWNER`) การ derive จาก role จึงให้ผลไม่แน่นอน ทั้งสองที่
เขียนค่าคงที่ `['SHOP','FINANCE'] / 'SHOP'` ให้ตอนสร้างแทน

## ตัวแปรที่ต้องเตรียม

```bash
export PROJECT_ID=<GCP_PROJECT_ID เช่น bestchoice-prod>
export REGION=asia-southeast1
export JOB=bestchoice-backfill-user-companies
export PROD_DB_NAME=bestchoice        # ชื่อฐาน prod จริงคือ "bestchoice" ไม่ใช่ "bestchoice_prod"
```

> guard ทุกตัวรับค่าจาก ENV ไม่ต้องส่ง argv: `EXPECTED_DB_NAME` (บังคับ),
> `CONFIRM_BACKFILL` (ไม่ใส่ = DRY-RUN), `ALLOW_PROD_BACKFILL` (บังคับเมื่อ
> `NODE_ENV=production` **หรือ** ฐานชื่อ `bestchoice`), และหน่วง 5 วินาทีก่อนเขียนจริง

---

## ① Backup ก่อนเสมอ

PITR ของ Cloud SQL เพิ่งเปิด แต่กฎบ้านคือสร้าง backup ก่อนแตะข้อมูล prod ทุกครั้ง
(`docs/guides/FULL-SYSTEM-TEST-CHECKLIST/README.md:14`)

```bash
gcloud sql backups create --instance=bestchoice-db \
  --project=$PROJECT_ID \
  --description="before user-companies backfill $(date +%F)"
gcloud sql backups list --instance=bestchoice-db --project=$PROJECT_ID --limit=3
```

**จดเลข backup id ลงใน PR / แชท** ก่อนไปขั้นถัดไป

## ② ยืนยันว่า deploy ที่มี CLI ตัวใหม่ขึ้นแล้ว

```bash
gh run list --branch main --limit 3
```

ต้องเห็น run ของ `deploy-gcp.yml` ที่ commit ของ hotfix นี้เป็น `success`
(image `:latest` ที่ Job จะหยิบไปใช้ = build ของ run นั้น) ถ้ายังแดง/ยังไม่จบ **หยุด**

ตรวจซ้ำว่า outage หายแล้วจริงก่อนแตะข้อมูล:
- login OWNER แล้วเห็นเมนู ไม่ใช่ข้อความ "บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงบริษัท"
- `GET /api/trade-ins/quick-buy/catalog` ได้ 200 (ไม่ใช่ 403)
- `audit_logs` มี activity กลับมา

## ③ DRY-RUN ผ่าน Cloud Run Job

ทางที่ง่ายที่สุด: GitHub Actions → workflow **Backfill User Companies (prod)** →
`Run workflow` → `expected_db_name = bestchoice`, **ไม่ต้องติ๊ก** `live`

หรือสั่งเองด้วย gcloud:

```bash
gcloud run jobs update $JOB --project=$PROJECT_ID --region=$REGION \
  --set-env-vars=EXPECTED_DB_NAME=$PROD_DB_NAME
gcloud run jobs execute $JOB --project=$PROJECT_ID --region=$REGION --wait
```

### อ่าน log

```bash
gcloud run jobs executions list --job=$JOB --project=$PROJECT_ID --region=$REGION --limit=1
gcloud beta run jobs executions logs read <execution-id> --project=$PROJECT_ID --region=$REGION
```

**ต้องเห็นครบสามอย่างก่อนไปต่อ** (ทุกบรรทัดขึ้นต้นด้วย `[backfill-user-companies]`):

1. บรรทัดบนสุด `DB: "bestchoice" | mode: DRY-RUN` — ถ้าเป็นชื่อฐานอื่น = ต่อผิดฐาน **หยุด**
2. บล็อก `===== SUMMARY =====` — จำนวนต่อ role + บรรทัด `total ... (would-update)`
   เทียบยอดรวมกับจำนวนพนักงานที่มีบัญชี ถ้าตัวเลขดูเยอะ/น้อยผิดปกติ **หยุดแล้วถาม**
3. ตัวอย่างสูงสุด 5 แถว (`email (role) → accessible=[...] primary=...`) — เช็คด้วยตาว่าค่า
   ตรงกับตารางข้างบน โดยเฉพาะ FINANCE_MANAGER ต้องได้ `[SHOP,FINANCE]` ไม่ใช่ `[FINANCE]`
4. บรรทัดล่างสุด `DRY-RUN — ยังไม่เขียนอะไร ...`

## ④ LIVE run

GitHub Actions → workflow เดิม → ติ๊ก `live` (workflow จะประกอบ env ครบชุดให้เอง)
หรือด้วย gcloud:

```bash
gcloud run jobs update $JOB --project=$PROJECT_ID --region=$REGION \
  --set-env-vars=EXPECTED_DB_NAME=$PROD_DB_NAME,CONFIRM_BACKFILL=YES_I_AM_SURE,ALLOW_PROD_BACKFILL=YES_I_AM_SURE,NODE_ENV=production
gcloud run jobs execute $JOB --project=$PROJECT_ID --region=$REGION --wait
```

ใน log ต้องเห็น `mode: LIVE`, บรรทัดเตือน `LIVE prod run starting in 5s`, บรรทัด
`...processed N/N` แล้วจบด้วยบล็อก `===== RESULT =====` ที่มี label ตรงกับ SUMMARY
บรรทัดต่อบรรทัด และ `Done.`

> ถ้ามีบรรทัด `skipped (filled meanwhile)` แปลว่าระหว่างสแกนกับเขียน มีแถวที่ถูกเติมค่า
> ไปแล้วจากทางอื่น (เช่นเจ้าตัวถูกเปลี่ยน role) — CLI ไม่ทับของใหม่โดยตั้งใจ ไม่ใช่ error

## ⑤ ตรวจผล

```bash
# ต้องได้ 0 (ยกเว้น system user ที่ถูกข้ามโดยตั้งใจ)
psql "$PGURL" -c "SELECT count(*) FROM users WHERE accessible_companies = '{}' AND deleted_at IS NULL AND is_system_user = false;"

# เช็คการกระจายตัวว่าตรงกับตารางข้างบน
psql "$PGURL" -c "SELECT role, accessible_companies, primary_company, count(*) FROM users WHERE deleted_at IS NULL GROUP BY 1,2,3 ORDER BY 1;"
```

- **ไม่ต้องบังคับ logout** `JwtStrategy` cache แถว user ไว้ 10 วินาที (`USER_CACHE_TTL_MS`)
  ต่อ instance ค่าที่เพิ่ง backfill จึงเห็นผลช้าสุด 10 วินาที
- ผู้ใช้ที่เปิดแท็บค้างไว้ตั้งแต่ก่อน deploy ต้องกด refresh หนึ่งครั้ง (web อ่านค่าจาก
  response body ของ `login`/`me` ที่เก็บไว้ใน `AuthContext`) — อย่าตัดสินว่าแก้ไม่สำเร็จ
  จากแท็บเก่า
- (เลือกได้) ลบ Job ทิ้งเมื่อจบงาน: `gcloud run jobs delete $JOB --project=$PROJECT_ID --region=$REGION`

---

## ทางเลือก: รันจาก laptop ผ่าน cloud-sql-proxy

ใช้เมื่อรัน Cloud Run Job ไม่ได้ ขั้น ①/② ยังบังคับเหมือนเดิม

หน้าต่างแรก — เปิด proxy ค้างไว้:

```bash
cloud-sql-proxy --gcloud-auth --port 15432 bestchoice-prod:asia-southeast1:bestchoice-db
```

หน้าต่างที่สอง — รันจาก **root ของ repo** (โฟลเดอร์ที่มี `apps/`) ไม่ใช่ `apps/api`
เพราะ `npm --prefix apps/api` แปลง path จาก cwd ถ้า `cd apps/api` ไปก่อนมันจะไปหา
`apps/api/apps/api` แล้วล้ม

```bash
# CLI เป็น node dist/... แล้ว → ต้อง build ก่อน (ต่างจาก backfill รุ่น tsx)
npm --prefix apps/api run build

# รหัสผ่านอยู่ใน secret DATABASE_URL — ห้าม echo ลง log/แชท
# PGURL (สำหรับ psql) ห้ามมี ?schema=public / DATABASE_URL (สำหรับ Prisma) ต้องมี
export PGURL="postgresql://bestchoice:<password>@127.0.0.1:15432/bestchoice"
export DATABASE_URL="${PGURL}?schema=public"

# DRY-RUN
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run backfill:user-companies

# LIVE (อ่าน DRY-RUN ให้ครบก่อน)
CONFIRM_BACKFILL=YES_I_AM_SURE ALLOW_PROD_BACKFILL=YES_I_AM_SURE \
EXPECTED_DB_NAME=bestchoice NODE_ENV=production \
  npm --prefix apps/api run backfill:user-companies
```

ลืมพารามิเตอร์ไหน: `npm --prefix apps/api run backfill:user-companies:help`

## ถ้าเขียนค่าผิดไปแล้ว (rollback)

fallback ฝั่งโค้ดจะ **ไม่** ช่วยแถวที่ค่าไม่ว่างแล้ว ทางกลับมีสองทาง:

1. ล้างเฉพาะแถวที่ผิดกลับเป็นว่าง แล้วปล่อยให้ fallback ทำงาน จากนั้นรัน backfill ใหม่ด้วย
   CLI ที่ถูกต้อง:
   `UPDATE users SET accessible_companies = '{}', primary_company = NULL WHERE <เงื่อนไขที่ผิด>;`
2. กู้จาก backup ที่จดไว้ในขั้น ① (ทางสุดท้าย — กระทบทั้งฐาน)
