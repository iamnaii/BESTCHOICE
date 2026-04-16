---
name: fix-bug
description: Debug & Fix Bug อย่างเป็นระบบ — ใช้เมื่อมี bug ต้อง debug หา root cause ก่อน fix
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

### 3. ตรวจ Sentry / Logs (ถ้ามี)
- ถ้าเป็น production bug → ตรวจ Sentry dashboard สำหรับ error traces
- ถ้าเป็น API error → ดู structured logs (x-request-id tracing)
- ถ้า bug เกิดซ้ำบ่อย → อาจเป็น systematic issue ไม่ใช่ one-off

### 4. Trace Code Path
ตามประเภท bug ดูไฟล์ที่เกี่ยวข้อง:

| ประเภท Bug | ไฟล์ที่ตรวจ |
|---|---|
| UI rendering | `apps/web/src/pages/`, `apps/web/src/components/` |
| API error | `apps/api/src/modules/[feature]/` (controller + service) |
| Auth issue | `apps/api/src/modules/auth/`, `apps/web/src/lib/api.ts`, `apps/web/src/contexts/AuthContext.tsx` |
| Data wrong | `apps/api/prisma/schema.prisma`, service queries |
| Payment | `apps/api/src/modules/payments/`, `apps/api/src/modules/paysolutions/` |
| Journal/Accounting | `apps/api/src/modules/journal-auto/`, `apps/api/src/modules/accounting/` |

- **Frontend bug**: page → hooks → API call → response handling
- **Backend bug**: controller → service → Prisma query → response
- **Full-stack**: trace ทั้ง request path

### 5. หา Root Cause
- อ่าน code ที่เกี่ยวข้องทั้งหมด
- ดู git log เพื่อเข้าใจ changes ล่าสุด
- ตรวจว่าเป็น logic error, missing validation, race condition, หรือ data issue

### 6. Fix
- แก้ที่ root cause ไม่ใช่แค่อาการ
- ใช้ pattern เดียวกับ code รอบข้าง
- อย่า over-engineer — fix เฉพาะ bug ที่รายงาน

### 7. ตรวจหา Bug เดียวกันที่อื่น
- ถ้าพบ missing validation → grep หา field เดียวกันใน DTOs อื่น
- ถ้าพบ N+1 query → ตรวจ service ที่ใช้ pattern เดียวกัน
- ถ้าพบ `Number()` กับ Decimal → grep หา pattern เดียวกันทั้ง codebase

### 8. Verify
```bash
# TypeScript check
./tools/check-types.sh all

# E2E test ที่เกี่ยวข้อง (ถ้ามี)
cd apps/web && npx playwright test e2e/<related-test>.spec.ts
```

- ตรวจว่า bug หายไป
- ตรวจว่า feature อื่นที่เกี่ยวข้องยังทำงานปกติ

### 9. Lessons Learned
พิจารณา:
- อัปเดต workflow ถ้าเจอ pattern ใหม่
- แจ้ง user ถ้า root cause อาจเกิดซ้ำที่อื่น

## Common Mistakes

| ผิดบ่อย | วิธีถูก |
|---|---|
| แก้แค่อาการ (symptom fix) | ต้องหา root cause — ถามว่า "ทำไม" 3 ครั้ง |
| Over-engineer fix | Fix เฉพาะ bug ที่รายงาน ไม่ refactor code รอบข้าง |
| ไม่ตรวจ regression | รัน type check + E2E ที่เกี่ยวข้องทุกครั้ง |
| ลืม revert ถ้า fix สร้าง bug ใหม่ | `git stash` / `git checkout -- <file>` แล้วเริ่มใหม่ |
