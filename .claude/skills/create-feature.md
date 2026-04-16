---
name: create-feature
description: สร้าง Full-Stack Feature ครบวงจร (Prisma → API → Page) — ใช้เมื่อต้องการ feature ใหม่ทั้ง backend + frontend ครบ
user_invocable: true
---

# Skill: สร้าง Full-Stack Feature

สร้าง feature ใหม่ครบวงจร ตั้งแต่ Prisma model → NestJS API module → React page

## เมื่อไหร่ควรใช้ / ไม่ควรใช้

| สถานการณ์ | ใช้ skill นี้? | ใช้อะไรแทน |
|---|---|---|
| ต้องการ feature ใหม่ครบ (DB + API + UI) | ✅ ใช้เลย | — |
| มี model + API แล้ว ขาดแค่หน้า | ❌ | `/create-page` |
| มี model แล้ว ขาดแค่ API | ❌ | `/create-module` |
| เพิ่ม endpoint ใน module ที่มี | ❌ | `/add-endpoint` |
| แก้ schema อย่างเดียว | ❌ | `/db-change` |

## ขั้นตอน

### 1. รับ Input จาก User
ถาม user เพื่อรวบรวมข้อมูล:
- ชื่อ feature (เช่น `warranties`, `promotions`)
- Fields หลักของ model
- Roles ที่เข้าถึงได้
- ประเภท page (list, detail, form, หรือผสม)

### 2. อ่าน Workflows ที่เกี่ยวข้อง
อ่านไฟล์เหล่านี้ก่อนเริ่มงาน:
- `workflows/prisma-changes.md` — SOP สำหรับแก้ schema
- `workflows/create-api-module.md` — SOP สำหรับสร้าง API module
- `workflows/create-page.md` — SOP สำหรับสร้าง React page

### 3. ตรวจสอบก่อนสร้าง
- ค้นหาว่ามี module/page ที่ทำงานคล้ายกันอยู่แล้วหรือไม่
- ตรวจ `apps/api/prisma/schema.prisma` ว่ามี model อยู่หรือยัง
- ถ้ามี model แล้ว ข้ามไป step 5

### 4. สร้าง Prisma Model
- เพิ่ม model ใน `apps/api/prisma/schema.prisma`
- ต้องมี: `id` (UUID), `createdAt`, `updatedAt`, `deletedAt` (soft delete)
- Money fields ใช้ `Decimal` → `@db.Decimal(12, 2)` ไม่ใช่ Float
- เพิ่ม enum ถ้าจำเป็น (ประกาศด้านบนของ schema)
- รัน: `cd apps/api && npx prisma generate`
- รัน: `cd apps/api && npx prisma migrate dev --name add_<feature>_model`
- ตรวจ migration SQL ที่สร้าง

### 5. สร้าง API Module
- รัน: `./tools/generate-module.sh <feature-name>`
- แก้ไข placeholder ใน generated files:
  - `dto/<name>.dto.ts` — เพิ่ม fields จริง + class-validator + Thai messages
  - `<name>.service.ts` — เปลี่ยน `/* MODEL */` เป็น Prisma model จริง, เพิ่ม relations
  - `<name>.controller.ts` — ปรับ @Roles() ตามที่ user ต้องการ
- เพิ่ม module import ใน `apps/api/src/app.module.ts`
- Reference: `apps/api/src/modules/customers/` เป็น template

### 6. สร้าง React Page
- สร้าง `apps/web/src/pages/<Name>Page.tsx`
- ใช้ patterns:
  - `useQuery` + `useMutation` จาก @tanstack/react-query
  - `useDebounce` สำหรับ search
  - `api.get()` / `api.post()` จาก `@/lib/api`
  - `toast.success()` / `toast.error()` จาก sonner
  - `queryClient.invalidateQueries()` หลัง mutation
- Reuse components: PageHeader, DataTable, Modal
- ครอบ data-fetching ด้วย `QueryBoundary` เพื่อ error+retry UI

### 6.5 เพิ่ม Route + Navigation
- เพิ่ม lazy import ใน `apps/web/src/App.tsx`: `const XxxPage = lazy(() => import('@/pages/XxxPage'))`
- เพิ่ม route ภายใต้ `<ProtectedRoute>` + `<MainLayout>`
- เพิ่ม navigation link ใน Sidebar พร้อม icon จาก lucide-react
- Reference: `apps/web/src/pages/CustomersPage.tsx`

### 7. Verify
```bash
# TypeScript ทั้ง API + Web
./tools/check-types.sh all

# ถ้ามี E2E test ที่เกี่ยวข้อง
cd apps/web && npx playwright test --grep "<feature>" --project=chromium
```

ถ้า type check ผ่าน → feature พร้อมใช้งาน

## Common Mistakes

| ผิดบ่อย | วิธีถูก |
|---|---|
| ลืม `deletedAt` ใน model | ทุก model ต้องมี `deletedAt DateTime?` |
| ใช้ `Float` สำหรับเงิน | ใช้ `Decimal @db.Decimal(12, 2)` เท่านั้น |
| ลืม register module ใน `app.module.ts` | Step 5 — เพิ่ม import ใน app.module |
| ลืม `where: { deletedAt: null }` ใน queries | ทุก findMany/findFirst ต้อง filter soft delete |
| ลืมเพิ่ม route ใน App.tsx | Step 6.5 — lazy import + ProtectedRoute |
| ใช้ `fetch()` แทน `api.get()` | ใช้ `@/lib/api` เท่านั้น (มี JWT refresh) |
| ลืม `@UseGuards(JwtAuthGuard, RolesGuard)` | ทุก controller ต้องมี guards |

## Rollback / Recovery

ถ้าสร้างไปแล้วแต่ต้องย้อนกลับ:
1. **Migration ผิด**: `cd apps/api && npx prisma migrate resolve --rolled-back <migration_name>` แล้วลบไฟล์ migration
2. **Module ผิด**: ลบ folder `apps/api/src/modules/<name>/` + ลบ import จาก `app.module.ts`
3. **Page ผิด**: ลบไฟล์ page + ลบ route จาก `App.tsx` + ลบ sidebar link
4. **ทุกกรณี**: รัน `./tools/check-types.sh all` หลัง rollback เพื่อยืนยันไม่มี broken references
