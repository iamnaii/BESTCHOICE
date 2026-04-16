---
name: pre-deploy
description: ตรวจสอบ Checklist ก่อน Deploy/Merge — รัน type check, tests, migration status, env vars ครบ
user_invocable: true
---

# Skill: Pre-Deploy Checklist

รัน checklist ตรวจสอบก่อน merge หรือ deploy เพื่อลด production issues

## ขั้นตอน

### 1. อ่าน Workflow
อ่าน `workflows/deploy.md` ก่อนเริ่มงาน

### 2. TypeScript Check
```bash
./tools/check-types.sh all
```
ตรวจทั้ง API และ Web — ต้องไม่มี type errors

### 3. Full Test Suite
```bash
./tools/run-tests.sh
```
รัน lint + TypeScript + E2E tests ทั้งหมด

> **Quick mode**: ถ้าต้องการ check เร็วโดยไม่รัน E2E → `./tools/run-tests.sh --skip-e2e`

### 4. Migration Status
```bash
cd apps/api && npx prisma migrate status
```
ตรวจว่าไม่มี pending migrations ที่ยังไม่ได้ apply

### 5. Environment Variables
```bash
# ตรวจ env vars ที่เพิ่มใหม่
diff <(grep -oP '^[A-Z_]+' apps/api/.env.example | sort) <(grep -oP '^[A-Z_]+' apps/api/.env | sort) || echo "มี env vars ไม่ตรงกัน"
```
ตรวจว่า production มี variables ใหม่ครบ (ถ้ามีการเพิ่ม)

### 6. ตรวจ Git Status
```bash
git status
git log --oneline -5
```
ตรวจว่าไม่มีไฟล์ที่ลืม commit หรือ sensitive files (.env, credentials)

### 7. สรุปผล
แสดงผลเป็น checklist:

```
Pre-Deploy Checklist:
[✓/✗] TypeScript (API) — ไม่มี type errors
[✓/✗] TypeScript (Web) — ไม่มี type errors
[✓/✗] ESLint — ไม่มี lint errors
[✓/✗] E2E Tests — ทุก test ผ่าน
[✓/✗] Migrations — ไม่มี pending migrations
[✓/✗] Env Variables — variables ครบ
[✓/✗] Git Clean — ไม่มีไฟล์ sensitive ค้าง
```

ถ้า **ทุก item ผ่าน** → พร้อม merge/deploy
ถ้า **มี item ไม่ผ่าน** → แจ้ง user พร้อมรายละเอียดและแนะนำวิธีแก้ไข
