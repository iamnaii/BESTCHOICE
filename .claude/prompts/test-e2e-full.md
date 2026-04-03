# E2E Full Test Suite — รัน E2E ทั้งหมด

รัน E2E test ครบทุก spec เพื่อตรวจสอบระบบก่อน deploy หรือหลังแก้ไข

## ขั้นตอน

1. รัน test ทั้งหมด:
   ```bash
   cd apps/web && npx playwright test --reporter=list 2>&1
   ```

2. ถ้ามี test fail — แยกวิเคราะห์ตามกลุ่ม:

   | กลุ่ม | ไฟล์ | ลักษณะปัญหา |
   |-------|------|------------|
   | Smoke | `page-smoke.spec.ts` | หน้าโหลดแล้วพัง |
   | Auth | `login.spec.ts` | Login/logout ไม่ทำงาน |
   | CRUD | `crud-flows.spec.ts`, `customers.spec.ts` | สร้าง/แก้ไข/ลบข้อมูลพัง |
   | Workflow | `contract-workflow.spec.ts` | Flow หลายขั้นตอนพัง |
   | Role | `role-access.spec.ts` | สิทธิ์ไม่ถูกต้อง |
   | Finance | `finance.spec.ts`, `payments.spec.ts` | การเงินคำนวณผิด |

3. รัน test เฉพาะไฟล์ที่ fail:
   ```bash
   cd apps/web && npx playwright test e2e/<filename>.spec.ts --reporter=list 2>&1
   ```

4. แก้ไข แล้วรัน test ซ้ำจนผ่านทั้งหมด

5. จบด้วย type check:
   ```bash
   ./tools/check-types.sh all
   ```

## ตัวเลือกเพิ่มเติม

```bash
# รันพร้อมเปิด browser
cd apps/web && npx playwright test --headed

# รันเฉพาะ Chromium (เร็วกว่า)
cd apps/web && npx playwright test --project=chromium

# รันพร้อม trace (สำหรับ debug)
cd apps/web && npx playwright test --trace on

# รัน test เฉพาะที่มีคำว่า "Dashboard"
cd apps/web && npx playwright test -g "Dashboard"
```
