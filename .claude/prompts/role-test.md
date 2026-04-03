# E2E Role Access Test — ตรวจสิทธิ์แต่ละ role

รัน E2E test ตรวจว่าแต่ละ role เข้าถึงหน้าที่ควรเข้าได้ และถูกบล็อกจากหน้าที่ไม่มีสิทธิ์

## ขั้นตอน

1. รัน role access tests:
   ```bash
   cd apps/web && npx playwright test e2e/role-access.spec.ts --reporter=list 2>&1
   ```

2. รัน smoke test เฉพาะ role:
   ```bash
   cd apps/web && npx playwright test e2e/page-smoke.spec.ts -g "SALES|ACCOUNTANT|BRANCH_MANAGER" --reporter=list 2>&1
   ```

3. วิเคราะห์ผลลัพธ์:
   - **fail ที่หน้าที่ role ควรเข้าได้** = bug ใน page component หรือ API
   - **เข้าได้ทั้งที่ไม่ควร** = bug ใน ProtectedRoute หรือ RolesGuard

4. สำหรับ bug ที่พบ:
   - ตรวจ `ProtectedRoute` ใน `App.tsx` ว่า roles ถูกต้อง
   - ตรวจ `@Roles()` decorator ใน controller ฝั่ง API
   - แก้ไขแล้วรัน test ซ้ำ

## Roles ในระบบ
| Role | สิทธิ์หลัก |
|------|-----------|
| OWNER | เข้าได้ทุกหน้า รวม settings, users, branches |
| BRANCH_MANAGER | จัดการสาขา, สต็อก, สัญญา, procurement |
| SALES | POS, ลูกค้า, สัญญา, สต็อก (ดูอย่างเดียว) |
| ACCOUNTANT | การเงิน, ใบเสร็จ, ค่าใช้จ่าย, ตรวจสลิป |
