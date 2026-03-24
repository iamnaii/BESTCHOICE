---
name: create-page
description: สร้าง React Page + Routing + Navigation
user_invocable: true
---

# Skill: สร้าง React Page

สร้าง frontend page component พร้อม routing และ navigation

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

Reuse components ที่มีอยู่:
- `PageHeader` — title + action buttons
- `DataTable` — table with sort/filter/pagination
- `Modal` / Dialog — overlays
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
- LIFF → ใน `/liff/` path, ไม่มี MainLayout

### 6. เพิ่ม Navigation (ถ้าจำเป็น)
เพิ่ม link ใน sidebar navigation component พร้อม icon จาก lucide-react

### 7. Verify
```bash
./tools/check-types.sh web
```
