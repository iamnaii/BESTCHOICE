# Frontend Rules (React + Vite + Tailwind)

## Data Fetching
- ใช้ `useQuery` / `useMutation` จาก `@tanstack/react-query` เท่านั้น
- **ห้ามใช้** raw `useEffect` + `fetch` สำหรับ data fetching
- Cache invalidation: เรียก `queryClient.invalidateQueries()` หลัง mutation เสมอ

## State Management
- **Server state**: React Query (useQuery/useMutation)
- **Complex client state**: Zustand stores
- **ห้ามใช้** Redux, MobX, หรือ state library อื่น

## API Calls
- ใช้ `api.get()` / `api.post()` จาก `@/lib/api` เท่านั้น
- **ห้ามใช้** raw `fetch()` หรือ raw `axios`
- API client จัดการ JWT refresh อัตโนมัติผ่าน interceptors

## UI Components
- ใช้ **shadcn/ui** components + **Radix UI** primitives + **Tailwind CSS** + **lucide-react** icons
- **ห้ามใช้** Material UI, Ant Design, หรือ component library อื่น
- Components ต้องเป็น functional components + hooks เท่านั้น — **ห้ามใช้** class components

## Design Tokens & Colors
- **ห้ามใช้** hardcoded hex colors (`#1e3a5f`, `#059669`) — ใช้ CSS variable tokens เท่านั้น
- **ห้ามใช้** `text-gray-*`, `bg-gray-*`, `bg-white` (ยกเว้น print/receipt context) — ใช้ semantic tokens:
  - `bg-background`, `bg-card`, `bg-muted` แทน `bg-white`, `bg-gray-50`
  - `text-foreground`, `text-muted-foreground` แทน `text-gray-*`
  - `border-border` แทน `border-gray-*`
  - `hover:bg-accent` แทน `hover:bg-gray-*`
- **Theme**: Minimal Zinc + Emerald Accent (primary = emerald, sidebar = white/light)
- **Font**: Inter (English) + IBM Plex Sans Thai (ไทย)
- **Thai text**: ใช้ `leading-snug` เสมอ (ห้าม `leading-none` — ตัด สระบน ไทย)

## Notifications
- ใช้ `toast.success()` / `toast.error()` จาก `sonner`
- **ห้ามใช้** `alert()`, `confirm()`, หรือ custom toast systems

## Routing
- ทุก page ต้อง lazy-load ด้วย `React.lazy()`
- ใช้ `ProtectedRoute` wrapper สำหรับ authenticated pages
- ใช้ `MainLayout` สำหรับ layout หลัก

## Search & Forms
- ใช้ `useDebounce` hook สำหรับ search inputs
- Forms ใช้ controlled components + validate ก่อน submit

## Reference Files
- Page reference: `apps/web/src/pages/CustomersPage.tsx`
- API client: `apps/web/src/lib/api.ts`
- Auth context: `apps/web/src/contexts/AuthContext.tsx`
