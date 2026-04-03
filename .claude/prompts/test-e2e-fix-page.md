# E2E Fix Broken Page — แก้หน้าที่พัง

ใช้เมื่อ smoke test พบหน้าที่ขึ้น error boundary แล้วต้องการแก้ไข

## ขั้นตอน

1. รัน smoke test เพื่อระบุหน้าที่พัง:
   ```bash
   cd apps/web && npx playwright test e2e/page-smoke.spec.ts --reporter=list 2>&1
   ```

2. สำหรับแต่ละหน้าที่ fail:

   a. **รัน test เดี่ยวพร้อม trace** เพื่อดู error:
      ```bash
      cd apps/web && npx playwright test e2e/page-smoke.spec.ts -g "<ชื่อ test>" --trace on 2>&1
      ```

   b. **หา page component** — ดู route ใน `apps/web/src/App.tsx` แล้วเปิดไฟล์ page

   c. **ตรวจสาเหตุที่พบบ่อย**:
      - `Cannot read properties of undefined` → API response shape เปลี่ยน หรือ optional chaining หาย
      - `useQuery` error ไม่ถูก handle → เพิ่ม `isLoading` / `isError` check
      - Import error → component ถูกลบหรือ rename แล้วไม่อัปเดต
      - Missing env var → ตรวจ `.env` ว่ามีค่าครบ

   d. **แก้ไข** page component

   e. **รัน test ซ้ำ** เฉพาะหน้านั้น:
      ```bash
      cd apps/web && npx playwright test e2e/page-smoke.spec.ts -g "<ชื่อ test>" --reporter=list 2>&1
      ```

3. เมื่อแก้ครบ รันรวมอีกครั้ง:
   ```bash
   cd apps/web && npx playwright test e2e/page-smoke.spec.ts --reporter=list 2>&1
   ```

4. Type check:
   ```bash
   ./tools/check-types.sh all
   ```

## สาเหตุที่พบบ่อย (เรียงตามความถี่)
1. **API response undefined** — ใช้ optional chaining `data?.field` หรือเพิ่ม loading state
2. **Missing import** — component ถูกย้ายหรือ rename
3. **Prisma schema เปลี่ยน** — field ใหม่ยังไม่มีใน API response type
4. **Guard/Role mismatch** — route กำหนด role ไม่ตรงกับ API
5. **Lazy load fail** — Vite chunk error (retry แก้ได้ ไม่ใช่ bug จริง)
