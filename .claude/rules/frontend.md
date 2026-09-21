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
- **ตัวอักษรบนพื้น `bg-primary` ต้องใช้ `text-primary-foreground` — ห้าม `text-white`** (คำตัดสินเจ้าของ 2026-09-21,
  mockup CnXmYLkT กระดาน 18–19): จอสว่าง `--primary` = `160 84% 26%` (ตัวอักษรขาว 5.34:1 · ตัวอักษรเขียวบนป้าย
  `bg-primary/10` 4.58:1 — เกณฑ์ตัวอักษรขนาดปกติ 4.5:1) · จอมืดคงเขียวเดิม `160 84% 39%` แต่ `--primary-foreground`
  เป็นสีเข้ม `160 40% 8%` (6.73:1; ตัวอักษรขาวได้แค่ 2.59:1) ⇒ `text-white` ที่เขียนตายตัวจะอ่านไม่ออกในจอมืด.
  ยังค้าง: การ์ดหัวของหน้า LIFF 7 จุดยังเป็น `text-white` (LIFF เปิดจอสว่างเสมอ — ลูกในการ์ดใช้ `text-white/80` ต้องไล่ทั้งการ์ด) ·
  สีเหลืองเตือน (ขาวบนเหลือง 2.13:1) และสีแดง (3.76:1) ยังไม่ได้ปรับ — บนพื้นอ่อนให้ใช้ `text-foreground` แทน `text-warning`
- **สถานะห้ามบอกด้วยสีอย่างเดียว** — ต้องมีไอคอนหรือข้อความกำกับ (ตัวอย่าง: `DAY_STATE_ICON` ใน `pages/shop-daily-cash/cash-hero.ts`)
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
- Page reference: `apps/web/src/pages/CustomersPage/` (โฟลเดอร์: `index.tsx` + `components/` + `hooks/`)
  — ไฟล์เดี่ยว `pages/CustomersPage.tsx` **ถูกลบแล้ว**; หน้ารายการที่ซับซ้อนดูพี่น้องที่
  `apps/web/src/pages/StockPage/` ด้วย
- API client: `apps/web/src/lib/api.ts`
- Auth context: `apps/web/src/contexts/AuthContext.tsx`
