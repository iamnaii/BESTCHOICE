---
name: fix-bug
description: Debug & Fix Bug อย่างเป็นระบบ
user_invocable: true
---

# Skill: Debug & Fix Bug

หา root cause และ fix bug อย่างเป็นระบบ โดยไม่สร้าง regression

## ขั้นตอน

### 1. อ่าน Workflow
อ่าน `workflows/fix-bug.md` ก่อนเริ่มงาน

### 2. รวบรวมข้อมูล Bug
ถาม user:
- อาการที่เกิดขึ้น + ผลที่คาดหวัง
- ขั้นตอน reproduce
- Environment (dev/production)
- Error message (ถ้ามี)

### 3. Trace Code Path
ตามประเภท bug ดูไฟล์ที่เกี่ยวข้อง:

| ประเภท Bug | ไฟล์ที่ตรวจ |
|---|---|
| UI rendering | `apps/web/src/pages/`, `apps/web/src/components/` |
| API error | `apps/api/src/modules/[feature]/` (controller + service) |
| Auth issue | `apps/api/src/modules/auth/`, `apps/web/src/lib/api.ts`, `apps/web/src/contexts/AuthContext.tsx` |
| Data wrong | `apps/api/prisma/schema.prisma`, service queries |
| Payment | `apps/api/src/modules/payments/`, `apps/web/src/pages/PaymentsPage.tsx` |

- **Frontend bug**: page → hooks → API call → response handling
- **Backend bug**: controller → service → Prisma query → response
- **Full-stack**: trace ทั้ง request path

### 4. หา Root Cause
- อ่าน code ที่เกี่ยวข้องทั้งหมด
- ดู git log เพื่อเข้าใจ changes ล่าสุด
- ตรวจว่าเป็น logic error, missing validation, race condition, หรือ data issue

### 5. Fix
- แก้ที่ root cause ไม่ใช่แค่อาการ
- ใช้ pattern เดียวกับ code รอบข้าง
- อย่า over-engineer — fix เฉพาะ bug ที่รายงาน

### 6. Verify
```bash
# TypeScript check
./tools/check-types.sh all

# E2E test ที่เกี่ยวข้อง (ถ้ามี)
cd apps/web && npx playwright test e2e/<related-test>.spec.ts
```

- ตรวจว่า bug หายไป
- ตรวจว่า feature อื่นที่เกี่ยวข้องยังทำงานปกติ

### 7. Lessons Learned
พิจารณา:
- อัปเดต workflow ถ้าเจอ pattern ใหม่
- แจ้ง user ถ้า root cause อาจเกิดซ้ำที่อื่น
