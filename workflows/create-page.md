# Workflow: สร้าง React Page ใหม่

## Objective
สร้าง page component + เพิ่ม route + navigation สำหรับ feature ใหม่

## Required Inputs
- ชื่อ page (เช่น `WarrantiesPage`)
- Route path (เช่น `/warranties`)
- ประเภท: protected (admin) หรือ public หรือ LIFF
- API endpoints ที่ต้องเรียก
- Roles ที่เข้าถึงได้

## Reference
- List page: `apps/web/src/pages/CustomersPage.tsx`
- Detail page: `apps/web/src/pages/ContractDetailPage.tsx`
- LIFF page: `apps/web/src/pages/liff/LiffPayment.tsx`

## Steps

### 1. ตรวจสอบก่อนสร้าง
- ค้นหาว่ามี page ที่ทำงานคล้ายกันอยู่แล้วหรือไม่
- ตรวจว่า API endpoints พร้อมใช้งาน
- เลือก reference page ที่ใกล้เคียงที่สุด

### 2. สร้าง Page Component (`pages/<Name>Page.tsx`)
```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function XxxPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  // Data fetching
  const { data, isLoading } = useQuery({
    queryKey: ['xxx', debouncedSearch, page],
    queryFn: async () => {
      const { data } = await api.get('/xxx', {
        params: { search: debouncedSearch, page },
      });
      return data;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/xxx', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['xxx'] });
      toast.success('สร้างสำเร็จ');
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  return (
    <>
      <PageHeader title="..." />
      {/* Content */}
    </>
  );
}
```

### 3. เพิ่ม Route ใน App.tsx (`apps/web/src/App.tsx`)

#### 3a. Lazy import (ด้านบนของไฟล์)
```typescript
const XxxPage = lazy(() => import('@/pages/XxxPage'));
```

#### 3b. เพิ่ม Route (ใน Routes block)
```typescript
// Protected route (ภายใต้ MainLayout)
<Route path="/xxx" element={<XxxPage />} />

// Public route (นอก MainLayout)
<Route path="/xxx" element={<XxxPage />} />
```

### 4. เพิ่ม Navigation Link (ถ้าจำเป็น)
- เพิ่มใน sidebar navigation component
- ใช้ icon ที่เหมาะสมจาก lucide-react

### 5. ทดสอบ
- `cd apps/web && npx tsc --noEmit` — ตรวจ TypeScript
- เปิด browser ไปที่ route ใหม่
- ตรวจว่า data loading, mutations ทำงานถูกต้อง

## Patterns ที่ใช้ในโปรเจค
- **Data fetching**: `useQuery` จาก @tanstack/react-query
- **Mutations**: `useMutation` + `queryClient.invalidateQueries`
- **Search**: `useDebounce` hook สำหรับ debounce search input
- **Notifications**: `toast.success()` / `toast.error()` จาก sonner
- **API calls**: `api.get()` / `api.post()` จาก `@/lib/api`
- **Navigation**: `useNavigate()` จาก react-router-dom
- **URL params**: `useParams()` สำหรับ detail pages
- **Auth**: `useAuth()` สำหรับ current user info
- **UI**: Radix UI components + Tailwind CSS
- **Icons**: lucide-react

## Existing Components ที่ reuse ได้
- `PageHeader` — title + action buttons
- `DataTable` — table with sort/filter/pagination
- `Modal` / Dialog — overlays
- `AddressForm` — address input (Thai provinces)
- `DocumentUpload` — file upload
- Loading spinners, empty states

## Edge Cases
- **Protected route**: ต้องอยู่ภายใต้ `<ProtectedRoute>` + `<MainLayout>`
- **LIFF page**: ใส่ไว้ใน `/liff/` path, ไม่มี MainLayout
- **Mobile responsive**: ใช้ `useIsMobile()` hook
- **Role-based UI**: ซ่อน/แสดง elements ตาม user role

## Output
- Page component ที่ `apps/web/src/pages/<Name>Page.tsx`
- Route registered ใน `App.tsx`
- Navigation link (ถ้าจำเป็น)
- TypeScript compile ผ่าน
