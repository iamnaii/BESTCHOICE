# E2E Smoke Test — ตรวจหน้าที่พัง

รัน E2E smoke test เพื่อตรวจจับหน้าที่กดแล้วขึ้น error boundary

## ขั้นตอน

1. รัน smoke test ทุกหน้า:
   ```bash
   cd apps/web && npx playwright test e2e/page-smoke.spec.ts --reporter=list 2>&1
   ```

2. วิเคราะห์ผลลัพธ์:
   - หน้าที่ **fail** = มี error boundary หรือ runtime error
   - หน้าที่ **pass** = โหลดได้ปกติ

3. สำหรับหน้าที่ fail:
   - เปิดไฟล์ page component ที่เกี่ยวข้อง
   - ตรวจสอบ root cause (missing data, bad import, API error)
   - แก้ไขและรัน test ซ้ำเฉพาะหน้านั้น:
     ```bash
     cd apps/web && npx playwright test e2e/page-smoke.spec.ts -g "ชื่อ test" --reporter=list 2>&1
     ```

4. เมื่อแก้ครบแล้ว รัน type check:
   ```bash
   ./tools/check-types.sh all
   ```

## หมายเหตุ
- Test ใช้ `gotoWithRetry` — retry 1 ครั้งเพื่อกรอง Vite chunk-load error
- ครอบคลุม OWNER (50+ หน้า), Public, LIFF, SALES, ACCOUNTANT, BRANCH_MANAGER
- ไม่ได้ตรวจ business logic — แค่ตรวจว่าหน้าโหลดได้โดยไม่ crash
