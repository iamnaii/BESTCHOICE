---
name: create-page
description: สร้าง React Page + Routing + Navigation — ใช้เมื่อมี API พร้อมแล้วและต้องการหน้า frontend
user_invocable: true
---

# Skill: สร้าง React Page

สร้าง frontend page component พร้อม routing และ navigation

## เมื่อไหร่ควรใช้ / ไม่ควรใช้

| สถานการณ์ | ใช้ skill นี้? | ใช้อะไรแทน |
|---|---|---|
| มี API พร้อมแล้ว ต้องการแค่หน้า frontend | ✅ ใช้เลย | — |
| ต้องการ feature ครบ DB+API+UI | ❌ | `/create-feature` |
| แก้ UI ของหน้าที่มีอยู่แล้ว | ❌ | แก้ไฟล์โดยตรง |

## ขั้นตอน

### 1. อ่าน Workflow
อ่าน `workflows/create-page.md` ก่อนเริ่มงาน

### 2. รับ Input
ถาม user:
- ชื่อ page (PascalCase เช่น `WarrantiesPage`)
- Route path (เช่น `/warranties`)
- ประเภท: protected (admin) / public / LIFF
- API endpoints ที่ต้องเรียก
- ลักษณะ page: list / detail / form / dashboard

### 3. ตรวจสอบก่อนสร้าง
- ค้นหา page ที่คล้ายกันใน `apps/web/src/pages/`
- ตรวจว่า API endpoints พร้อมใช้งาน
- เลือก reference page:
  - List page → `apps/web/src/pages/CustomersPage.tsx`
  - Detail page → `apps/web/src/pages/ContractDetailPage.tsx`
  - LIFF page → `apps/web/src/pages/liff/LiffPayment.tsx`

### 4. สร้าง Page Component
สร้างไฟล์ `apps/web/src/pages/<Name>Page.tsx` โดยใช้ patterns:
- `useQuery` / `useMutation` จาก @tanstack/react-query
- `useDebounce` จาก `@/hooks/useDebounce` สำหรับ search input
- `api.get()` / `api.post()` จาก `@/lib/api`
- `toast.success()` / `toast.error()` จาก sonner
- `queryClient.invalidateQueries()` หลัง mutation สำเร็จ
- `useNavigate()` จาก react-router-dom
- ครอบ data-fetching ด้วย `QueryBoundary` เพื่อ error+retry UI

Reuse components ที่มีอยู่:
- `PageHeader` — title + action buttons + breadcrumb
- `DataTable` — table with sort/filter/pagination
- `Modal` / `ConfirmDialog` — overlays + confirmation
- `AddressForm` — Thai address input
- `DocumentUpload` — file upload
- Icons จาก lucide-react

### 5. เพิ่ม Route
แก้ไข `apps/web/src/App.tsx`:

**5a. Lazy import** (ด้านบนของไฟล์):
```typescript
const XxxPage = lazy(() => import('@/pages/XxxPage'));
```

**5b. Route** (ใน Routes block):
- Protected → ภายใต้ `<ProtectedRoute>` + `<MainLayout>`
- Public → นอก MainLayout
- LIFF → ใน `/liff/` path, ไม่มี MainLayout (รันใน LINE iframe)

### 6. เพิ่ม Navigation (ถ้าจำเป็น)
เพิ่ม link ใน sidebar navigation component พร้อม icon จาก lucide-react

### 7. Verify
```bash
./tools/check-types.sh web
```

## Common Mistakes

| ผิดบ่อย | วิธีถูก |
|---|---|
| ใช้ `fetch()` หรือ raw `axios` | ใช้ `api.get()` / `api.post()` จาก `@/lib/api` (มี JWT refresh) |
| ใช้ `useEffect` + `fetch` | ใช้ `useQuery` จาก @tanstack/react-query |
| ใช้ `alert()` / `confirm()` | ใช้ `toast` จาก sonner + `ConfirmDialog` |
| ใช้ hardcoded colors `bg-gray-50` | ใช้ semantic tokens `bg-muted`, `text-foreground` |
| ใช้ `leading-none` กับข้อความไทย | ใช้ `leading-snug` (ป้องกันสระบนถูกตัด) |
| ลืม lazy import ใน App.tsx | page จะ bundle รวม → เพิ่ม initial load |
| LIFF page ใช้ MainLayout | LIFF pages ไม่ใช้ MainLayout — รันใน LINE iframe |

## Rollback
1. ลบไฟล์ page จาก `apps/web/src/pages/`
2. ลบ lazy import + route จาก `App.tsx`
3. ลบ sidebar link (ถ้ามี)
4. รัน `./tools/check-types.sh web`
