---
name: pre-deploy
description: ตรวจสอบ Checklist ก่อน Deploy/Merge
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

### 4. Migration Status
```bash
cd apps/api && npx prisma migrate status
```
ตรวจว่าไม่มี pending migrations ที่ยังไม่ได้ apply

### 5. Environment Variables
- เปรียบเทียบ `.env.example` กับ environment variables ที่ใช้จริง
- ตรวจว่า production มี variables ใหม่ครบ (ถ้ามีการเพิ่ม)

### 6. สรุปผล
แสดงผลเป็น checklist:

```
Pre-Deploy Checklist:
[✓/✗] TypeScript (API) — ไม่มี type errors
[✓/✗] TypeScript (Web) — ไม่มี type errors
[✓/✗] ESLint — ไม่มี lint errors
[✓/✗] E2E Tests — ทุก test ผ่าน
[✓/✗] Migrations — ไม่มี pending migrations
[✓/✗] Env Variables — variables ครบ
```

ถ้ามี item ไม่ผ่าน → แจ้ง user พร้อมรายละเอียดและแนะนำวิธีแก้ไข
