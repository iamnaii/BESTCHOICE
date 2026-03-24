# Workflow: Debug & Fix Bug

## Objective
หา root cause ของ bug และ fix อย่างเป็นระบบ โดยไม่สร้าง regression

## Required Inputs
- รายละเอียด bug (อาการ, ขั้นตอน reproduce)
- Environment (dev/production)
- Error message (ถ้ามี)

## Steps

### 1. Reproduce
- ทำตามขั้นตอนที่ user รายงาน
- บันทึกอาการที่เกิดขึ้นจริง vs ที่คาดหวัง
- ตรวจ browser console / API logs

### 2. Trace Code Path
- **Frontend bug**: เริ่มจาก page component → hooks → API call → response handling
- **Backend bug**: เริ่มจาก controller → service → Prisma query → response
- **Full-stack**: trace ทั้ง request path (frontend → API → DB → response → frontend)

#### ไฟล์ที่ควรตรวจ
| ประเภท Bug | ไฟล์ที่ดู |
|---|---|
| UI rendering | `apps/web/src/pages/`, `apps/web/src/components/` |
| API error | `apps/api/src/modules/[feature]/` (controller + service) |
| Auth issue | `apps/api/src/modules/auth/`, `apps/web/src/lib/api.ts`, `apps/web/src/contexts/AuthContext.tsx` |
| Data wrong | `apps/api/prisma/schema.prisma`, service queries |
| Payment | `apps/api/src/modules/payments/`, `apps/web/src/pages/PaymentsPage.tsx` |

### 3. Identify Root Cause
- อ่าน code ที่เกี่ยวข้องทั้งหมดก่อน propose fix
- ตรวจว่า bug มาจาก logic error, missing validation, race condition, หรือ data issue
- ดู git log เพื่อเข้าใจ changes ล่าสุดที่อาจเป็นสาเหตุ

### 4. Fix
- แก้ที่ root cause ไม่ใช่แค่อาการ
- ใช้ pattern เดียวกับ code รอบข้าง
- อย่า over-engineer — fix เฉพาะ bug ที่รายงาน

### 5. Test
```bash
# TypeScript check
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit

# E2E test (ถ้ามี test ที่เกี่ยวข้อง)
cd apps/web && npx playwright test e2e/<related-test>.spec.ts

# Manual test
# ทำตามขั้นตอน reproduce อีกครั้ง — ต้องไม่เกิด bug
```

### 6. Verify — ไม่เกิด Regression
- ตรวจว่า feature อื่นที่เกี่ยวข้องยังทำงานปกติ
- ถ้า fix กระทบหลาย module → รัน full E2E

## Edge Cases
- **Bug ใน production แต่ dev ปกติ**: ตรวจ env variables, database state, caching
- **Intermittent bug**: อาจเป็น race condition, timing issue, หรือ data-dependent
- **Bug จาก 3rd party**: LINE LIFF, S3, SMS API → ตรวจ API response/status

## Lessons Learned
เมื่อ fix bug สำเร็จ ให้พิจารณา:
- อัปเดต workflow นี้ถ้าเจอ pattern ใหม่
- เพิ่ม E2E test สำหรับ scenario ที่ bug เกิด
- ถ้า root cause เป็น pattern ที่อาจเกิดซ้ำ → แจ้ง user

## Output
- Bug fixed + tested
- ไม่เกิด regression
- (Optional) E2E test ใหม่สำหรับ scenario
