# UI Redesign: Minimal Zinc + Emerald Accent

**Date:** 2026-04-16
**Status:** Draft
**Approach:** Minimal base (zinc neutral) + Emerald accent (feng shui Wood element) + Dark sidebar

---

## 1. Design Philosophy

- **Minimal & Clean** — shadcn/ui default aesthetic, zinc neutral base
- **Emerald accent only on interactive elements** — buttons, badges, active states, links
- **White/Light sidebar** — ขาว + border-right + emerald active highlight (K PLUS, Notion style)
- **Startup finance look** — เหมือน K PLUS, Wise: พื้น clean + สี brand 1 จุด
- **ธาตุไม้ (Wood element)** — Emerald green = growth, prosperity

## 2. Scope

ทำครบ 3 ระดับ แบ่ง 3 phases:

| Phase | ขอบเขต | ไฟล์ (ประมาณ) |
|-------|--------|--------------|
| **Phase 1: Foundation** | Theme + Components + Layout + Login + Dashboard | ~25 files |
| **Phase 2: Core Pages** | หน้าที่ใช้บ่อย (ลูกค้า, สัญญา, สต็อก, POS, ชำระเงิน, ค้างชำระ) | ~30 files |
| **Phase 3: Remaining** | Settings, Reports, LIFF, Todos, หน้าอื่นๆ | ~25 files |

---

## 3. Theme & Color System

### 3.1 CSS Variables (Light Mode — `:root`)

```css
--background: 0 0% 100%;           /* ขาวสะอาด (was: 240 5% 96% เทาอมฟ้า) */
--foreground: 240 10% 3.9%;        /* เกือบดำ */
--card: 0 0% 100%;                 /* ขาว (เท่าเดิม) */
--card-foreground: 240 10% 3.9%;
--popover: 0 0% 100%;
--popover-foreground: 240 10% 3.9%;

--primary: 160 84% 39%;            /* Emerald (was: 210 52% 24% Navy) */
--primary-foreground: 0 0% 100%;   /* ขาว */

--secondary: 240 4.8% 95.9%;      /* zinc-100 */
--secondary-foreground: 240 5.9% 10%;
--muted: 240 4.8% 95.9%;          /* zinc-100 */
--muted-foreground: 240 3.8% 46.1%;
--accent: 240 4.8% 95.9%;         /* zinc-100 (hover state) */
--accent-foreground: 240 5.9% 10%;

--destructive: 0 84.2% 60.2%;
--destructive-foreground: 0 0% 98%;
--success: 142 71% 45%;
--success-foreground: 0 0% 100%;
--warning: 38 92% 50%;
--warning-foreground: 0 0% 100%;
--info: 199 89% 48%;              /* sky-500 (was: Navy) */
--info-foreground: 0 0% 100%;

--border: 240 5.9% 90%;           /* เทาอ่อน */
--input: 240 5.9% 90%;            /* เท่ากับ border */
--ring: 160 84% 39%;              /* Emerald focus ring (was: zinc) */
--radius: 0.5rem;

/* Sidebar — White/Light */
--sidebar-bg: 0 0% 100%;          /* white */
--sidebar-fg: 240 10% 3.9%;       /* foreground */
--sidebar-active: 160 84% 39%;    /* Emerald */
--sidebar-hover: 240 4.8% 95.9%;  /* zinc-100 */
--sidebar-border: 240 5.9% 90%;   /* border */

/* Charts — emerald-led palette */
--chart-1: 160 84% 39%;           /* Emerald (was: Navy) */
--chart-2: 240 5% 64.9%;          /* zinc-400 */
--chart-3: 48 96% 53%;            /* yellow (คงเดิม) */
--chart-4: 0 84% 60%;             /* red (คงเดิม) */
--chart-5: 271 91% 65%;           /* purple (คงเดิม) */
```

### 3.2 CSS Variables (Dark Mode — `.dark`)

```css
--background: 240 10% 3.9%;       /* เกือบดำ */
--foreground: 0 0% 98%;
--card: 240 10% 3.9%;
--card-foreground: 0 0% 98%;
--popover: 240 10% 3.9%;
--popover-foreground: 0 0% 98%;

--primary: 160 84% 39%;           /* Emerald (เท่ากันทั้ง light/dark) */
--primary-foreground: 0 0% 100%;

--secondary: 240 3.7% 15.9%;      /* zinc-800 */
--secondary-foreground: 0 0% 98%;
--muted: 240 3.7% 15.9%;
--muted-foreground: 240 5% 64.9%;
--accent: 240 3.7% 15.9%;
--accent-foreground: 0 0% 98%;

--destructive: 0 62.8% 30.6%;
--destructive-foreground: 0 0% 98%;
--success: 142 71% 40%;
--success-foreground: 0 0% 100%;
--warning: 38 92% 45%;
--warning-foreground: 0 0% 100%;
--info: 199 89% 48%;
--info-foreground: 0 0% 100%;

--border: 240 3.7% 15.9%;         /* zinc-800 */
--input: 240 3.7% 15.9%;
--ring: 160 84% 39%;

--sidebar-bg: 240 3.7% 15.9%;     /* zinc-800 in dark */
--sidebar-fg: 0 0% 95%;
--sidebar-active: 160 84% 39%;
--sidebar-hover: 240 3.7% 20%;
--sidebar-border: 240 3.7% 15.9%;

--chart-1: 160 84% 45%;
--chart-2: 240 5% 50%;
--chart-3: 48 96% 53%;
--chart-4: 0 84% 60%;
--chart-5: 271 91% 65%;
```

### 3.3 Hardcoded Colors to Remove

ทุก hardcoded hex ต้องเปลี่ยนเป็น CSS variable tokens:

| Hardcoded | แทนด้วย | จำนวนไฟล์ |
|-----------|---------|----------|
| `#059669` | `bg-primary`, `text-primary` | ~20 files, 54 occurrences |
| `#1e3a5f` | `bg-primary` (sidebar context), `text-foreground` | ~15 files, 46 occurrences |
| `#047857` | `hover:bg-primary/90` | ~8 files, 11 occurrences |
| `#f0f5ff` | `bg-primary/5` or `bg-muted` | ~8 files, 13 occurrences |
| `#065f46` | `active:bg-primary/80` | ~2 files |
| `#234b73` | ลบ (was gradient mid) | ~2 files |
| `#162d4a`, `#0f2035`, `#091626` | ลบ (was Navy variants) | ~3 files |
| `#d6e4ff`, `#a3bffa` | `bg-primary/10`, `bg-primary/20` | ~2 files |
| `#94a3b8` | `text-muted-foreground` | ~3 files |
| `#f1f5f9` | `bg-muted` | ~3 files |
| `#e2e8f0` | `border-border` | ~2 files |
| `#f8fafc` | `bg-background` | ~2 files |
| `#cbd5e1` | `text-muted-foreground/60` | ~2 files |

### 3.4 Hero/Gradient Colors — Remove

ลบ hero gradient variables ออกจาก `@theme`:
```css
/* ลบทั้งหมด */
--color-hero-1 through --color-hero-5
```

PageHeader gradient banner → เปลี่ยนเป็น plain header (ดู Section 5.4)

### 3.5 Color Scale Tokens — Keep but Rename

```css
/* คง primary scale ไว้ แต่เปลี่ยนจาก Navy → Emerald */
--color-primary-50:  #ecfdf5;  /* emerald-50 */
--color-primary-100: #d1fae5;  /* emerald-100 */
--color-primary-200: #a7f3d0;  /* emerald-200 */
--color-primary-300: #6ee7b7;  /* emerald-300 */
--color-primary-400: #34d399;  /* emerald-400 */
--color-primary-500: #10b981;  /* emerald-500 */
--color-primary-600: #059669;  /* emerald-600 */
--color-primary-700: #047857;  /* emerald-700 */
--color-primary-800: #065f46;  /* emerald-800 */
--color-primary-900: #064e3b;  /* emerald-900 */
--color-primary-950: #022c22;  /* emerald-950 */

/* accent scale → ลบออก (ไม่ต้องมี scale แยก เพราะ accent = zinc แล้ว) */
```

---

## 4. Component Updates

### 4.1 Button (`components/ui/button.tsx`)

```
Before:
  primary: bg-[#059669] text-white hover:bg-[#047857] active:bg-[#065f46]
           shadow-[0_2px_8px_rgba(5,150,105,0.25)]
  mono:    bg-[#f0f5ff] text-[#1e3a5f] border-[#d6e4ff] hover:bg-[#d6e4ff]

After:
  primary: bg-primary text-primary-foreground hover:bg-primary/90
           shadow-sm
  mono:    bg-muted text-foreground border-border hover:bg-accent
```

Focus ring: `focus-visible:ring-[#059669]/30` → `focus-visible:ring-ring/30`

### 4.2 Badge (`components/ui/badge.tsx`)

```
Before:
  primary: bg-[#1e3a5f] text-white
  info:    bg-[#1e3a5f] text-white
  light:   bg-[#f0f5ff] text-[#1e3a5f]

After:
  primary: bg-primary text-primary-foreground
  info:    bg-info text-info-foreground
  light:   bg-primary/10 text-primary
```

### 4.3 Tabs (`components/ui/tabs.tsx`)

ลบ hardcoded emerald/navy colors → ใช้ `bg-primary`, `text-primary`

### 4.4 Input (`components/ui/input.tsx`)

ลบ hardcoded focus colors → ใช้ `focus-visible:ring-ring/30`

### 4.5 Other UI Components

| Component | Change |
|-----------|--------|
| `dropdown-menu.tsx` | ลบ hardcoded colors → tokens |
| `dialog.tsx` | ลบ hardcoded colors → tokens |
| `card.tsx` | ลบ hardcoded colors → tokens |
| `tooltip.tsx` | ลบ hardcoded colors → tokens |
| `skeleton.tsx` | ลบ hardcoded colors → tokens |
| `EmptyState.tsx` | ลบ hardcoded colors → tokens |
| `PageHeader.tsx` | ดู Section 5.4 |

### 4.6 New/Updated Utility Classes (index.css)

```css
/* ลบ */
.bg-hero-gradient { ... }    /* ไม่ใช้ gradient แล้ว */

/* ปรับ */
.glass-card → คง pattern แต่ลบ Navy colors
.stat-card → ใช้ border-l-4 border-primary แทน gradient
```

---

## 5. Layout Updates

### 5.1 Sidebar (`components/layout/Sidebar.tsx`)

**Background:** `bg-[navy gradient]` → `bg-white` (light) / `bg-zinc-800` (dark) + `border-right border-border`

**Role badge map:**
```
Before:
  OWNER: bg-gradient-to-r from-[#1e3a5f] to-[#059669]
  BRANCH_MANAGER: bg-[#1e3a5f]
  FINANCE_MANAGER: bg-[#059669]

After:
  OWNER: bg-primary text-primary-foreground
  BRANCH_MANAGER: bg-sky-600 text-white
  FINANCE_MANAGER: bg-primary text-primary-foreground
```

**Expanded menu classNames (White/Light sidebar):**
```
Before:
  item: text-white/45 hover:bg-white/[0.06]
  item active: bg-emerald-500/20 text-emerald-300 + before:bg-emerald-500
  subTrigger: text-emerald-400/50 hover:text-emerald-400/70

After:
  item: text-muted-foreground hover:bg-accent hover:text-foreground
  item active: bg-primary/10 text-primary font-semibold + before:bg-primary
  subTrigger: text-muted-foreground/60 hover:text-muted-foreground (neutral section headers)
```

**Collapsed sidebar:** เปลี่ยน Navy bg → white + border-right, active icon → emerald

### 5.2 TopBar (`components/layout/TopBar.tsx`)

```
Before:
  header: border-[#e2e8f0]
  avatar: bg-gradient-to-br from-[#1e3a5f] to-[#059669]
  search: bg-[#f1f5f9] hover:bg-[#e2e8f0]
  breadcrumb: text-[#94a3b8], separator text-[#cbd5e1]

After:
  header: border-border
  avatar: bg-primary (solid emerald)
  search: bg-muted hover:bg-accent
  breadcrumb: text-muted-foreground, separator text-border
```

### 5.3 AuthLayout (`components/layout/AuthLayout.tsx`)

```
Before:
  wrapper: bg-gradient-to-br from-[#f8fafc] to-[#f0f5ff]
  right panel: from-slate-900 via-slate-800 to-slate-900
  decorative orbs: bg-primary/10

After:
  wrapper: bg-background (ขาวเรียบ)
  right panel: bg-zinc-950 (solid dark)
  decorative orbs: bg-emerald-500/10 (emerald glow — ธาตุไม้)
  logo: BEST text-foreground + CHOICE text-primary (emerald)
```

### 5.4 PageHeader (`components/ui/PageHeader.tsx`)

```
Before (gradient=true):
  bg-gradient-to-r from-[#1e3a5f] via-[#234b73] to-[#059669]
  full-width banner, white text, negative margins

After:
  ลบ gradient mode ทั้งหมด
  ทุกหน้าใช้ plain header: title text-foreground + subtitle text-muted-foreground
  เพิ่ม subtle bottom border (border-b border-border)
  gradient prop → deprecated, always plain
```

### 5.5 MainLayout (`components/layout/MainLayout.tsx`)

```
Before:
  main: bg-[#f8fafc]

After:
  main: bg-background (ใช้ token)
```

### 5.6 MobileBottomNav

ลบ hardcoded colors → ใช้ `text-primary` สำหรับ active tab

---

## 6. Page Updates

### Phase 1 Pages

#### 6.1 LoginPage

- Submit button: `bg-[#059669]` → `bg-primary`
- Dev quick-login panel: `bg-[#f0f5ff]` → `bg-muted`, `text-[#1e3a5f]` → `text-foreground`
- Quick-login buttons: `border-[#1e3a5f]/20` → `border-border`
- Logo: emerald gradient → `bg-primary`
- ใช้ shadcn/ui `<Input>` component แทน raw `<input>`
- ใช้ shadcn/ui `<Button>` component แทน raw `<button>`

#### 6.2 DashboardPage

- PageHeader: gradient → plain
- KPI cards: ปรับ layout ตาม shadcn dashboard-01 block
  - 4 cards in row, border-l-4 border-primary/border-success/border-warning/border-destructive
  - Clean typography, no gradient backgrounds
- Charts: chart colors จาก CSS variables (emerald-led palette)
- Tables: ใช้ DataGrid component ที่มี, ปรับ colors ให้ใช้ tokens

### Phase 2 Pages

#### 6.3 CustomersPage
- PageHeader: gradient → plain
- ลบ hardcoded colors (ถ้ามีใน sub-components)
- Form styling: ใช้ shadcn Input/Select/Button tokens

#### 6.4 ContractsPage
- PageHeader: gradient → plain
- Tab styling: ใช้ updated Tabs component (tokens)
- Status badges: ใช้ updated Badge component

#### 6.5 StockPage
- PageHeader: gradient → plain
- Summary cards: border-l-4 pattern
- Tab styling: tokens

#### 6.6 POSPage
- Card headers: tokens
- Form elements: tokens
- Submit button: `bg-primary`

#### 6.7 PaymentsPage
- PageHeader: gradient → plain
- Tab/filter styling: tokens
- Modal overlays: tokens

#### 6.8 OverduePage
- PageHeader: gradient → plain
- Kanban/table: tokens
- Status badges: semantic colors (คงเดิม — success/warning/destructive ดีอยู่แล้ว)

### Phase 3 Pages

#### 6.9 LIFF Pages (8 files)
ทุกไฟล์มี pattern เดียวกัน:
- Header gradient → plain emerald header or no header
- `bg-[#059669]` → `bg-primary`
- `text-[#1e3a5f]` → `text-foreground`

#### 6.10 TodosPage
- TodoForm.tsx มี 33 hardcoded colors — เยอะสุด
- ปรับทั้งหมดเป็น tokens
- Kanban view: ปรับ colors

#### 6.11 Settings, Reports, Audit, etc.
- ส่วนใหญ่ใช้ tokens อยู่แล้ว (67 pages ไม่มี hardcoded colors)
- ปรับเฉพาะ PageHeader gradient → plain

#### 6.12 LandingPage
- Hero section: ลบ Navy gradient → zinc-950 bg + emerald accents
- Stats cards: ปรับ colors

#### 6.13 ForgotPasswordPage, ResetPasswordPage
- เหมือน LoginPage — ปรับ AuthLayout + button colors

---

## 7. shadcn/ui Blocks Reference

ใช้เป็น reference pattern ไม่ copy ทั้งก้อน:

| Block | ใช้ปรับ | วิธี |
|-------|--------|------|
| **sidebar-07** | Sidebar.tsx | ดู collapsed/expanded transition, icon rail pattern, tooltip behavior |
| **dashboard-01** | DashboardPage | ดู KPI card grid, chart+table layout, spacing |
| **login-04** | AuthLayout + LoginPage | ดู form+branded-panel split, typography hierarchy |

ติดตั้ง blocks เพื่อดู source code:
```bash
npx shadcn@latest add sidebar-07
npx shadcn@latest add dashboard-01
npx shadcn@latest add login-04
```

แล้วดูไฟล์ที่ generate ใน `src/components/` เป็น reference แล้วลบทิ้ง

---

## 8. Typography & Spacing

### Font — เปลี่ยน Thai font
- **Inter** — English text (คงเดิม)
- **IBM Plex Sans Thai** — Thai text (เปลี่ยนจาก Noto Sans Thai)
  - เหตุผล: metrics ใกล้เคียง Inter, professional สำหรับ finance app (SCB Easy, Robinhood ใช้)
  - Weights: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
  - Google Fonts: `IBM+Plex+Sans+Thai:wght@300;400;500;600;700`

### Spacing adjustments
- PageHeader: `py-5 lg:py-6` (banner) → `pb-6` (plain, less vertical space)
- Card padding: คงเดิม
- Container: `px-5 lg:px-7` → คงเดิม

### Typography hierarchy
- Page title: `text-2xl font-bold text-foreground`
- Page subtitle: `text-sm text-muted-foreground`
- Card title: `text-base font-semibold text-foreground`
- Section header: `text-sm font-medium text-muted-foreground uppercase tracking-wider`

---

## 9. What NOT to Change

- **Radix UI primitives** — คงเดิม
- **React Query / Zustand** — ไม่เกี่ยว
- **Business logic / API calls** — ไม่แตะ
- **Routing / lazy loading** — คงเดิม
- **Semantic status colors** — success (green), warning (yellow), destructive (red) ดีอยู่แล้ว
- **Data table behavior** — filter, sort, pagination คงเดิม
- **Form validation** — คงเดิม
- **Mobile bottom nav structure** — คงเดิม (แค่ปรับ colors)
- **Command palette** — คงเดิม
- **Dark mode toggle** — คงเดิม
- **Keyboard shortcuts** — คงเดิม

---

## 10. Verification Checklist

After each phase:

- [ ] `./tools/check-types.sh all` — 0 TypeScript errors
- [ ] No remaining hardcoded hex colors (grep for `#[0-9a-fA-F]{6}` excluding index.css token definitions)
- [ ] Light mode looks clean
- [ ] Dark mode looks clean
- [ ] Sidebar expanded/collapsed works
- [ ] Mobile responsive — sidebar sheet, bottom nav
- [ ] Login page works (dev quick-login buttons functional)
- [ ] All semantic colors preserved (success/warning/destructive badges)
- [ ] PageHeader plain style on all pages
- [ ] Focus rings are emerald (not zinc)

---

## 11. File Impact Summary

### Phase 1: Foundation (~25 files)
```
index.css                          — theme variables overhaul
components/ui/button.tsx           — remove hardcoded colors
components/ui/badge.tsx            — remove hardcoded colors
components/ui/tabs.tsx             — remove hardcoded colors
components/ui/input.tsx            — remove hardcoded colors
components/ui/dropdown-menu.tsx    — remove hardcoded colors
components/ui/dialog.tsx           — remove hardcoded colors
components/ui/card.tsx             — remove hardcoded colors
components/ui/tooltip.tsx          — remove hardcoded colors
components/ui/skeleton.tsx         — remove hardcoded colors
components/ui/EmptyState.tsx       — remove hardcoded colors
components/ui/PageHeader.tsx       — remove gradient, always plain
components/layout/Sidebar.tsx      — zinc-900 bg, token colors
components/layout/TopBar.tsx       — token colors
components/layout/AuthLayout.tsx   — zinc-950 panel, clean bg
components/layout/MainLayout.tsx   — bg-background token
components/layout/MobileBottomNav.tsx — token colors
pages/LoginPage.tsx                — shadcn components, tokens
pages/ForgotPasswordPage.tsx       — tokens
pages/ResetPasswordPage.tsx        — tokens
pages/DashboardPage/index.tsx      — plain header
pages/DashboardPage/components/*   — KPI card styling, chart colors
pages/LandingPage.tsx              — zinc-950 + emerald accents
```

### Phase 2: Core Pages (~30 files)
```
pages/CustomersPage.tsx
pages/CustomerDetailPage.tsx
pages/ContractsPage.tsx
pages/ContractDetailPage.tsx
pages/ContractCreatePage/*
pages/ContractSignPage.tsx
pages/StockPage/*
pages/POSPage/*
pages/PaymentsPage/*
pages/OverduePage.tsx
pages/CommissionsPage.tsx
pages/ReceiptsPage.tsx
pages/SalesHistoryPage.tsx
pages/SuppliersPage/*
pages/SupplierDetailPage.tsx
components/signing/*               — contract signing flow
```

### Phase 3: Remaining (~25 files)
```
pages/liff/* (10 files)
pages/TodosPage/* (5 files)
pages/SettingsPage/*
pages/UsersPage/*
pages/BranchesPage.tsx
pages/AuditLogsPage.tsx
pages/FinancialAuditPage.tsx
pages/TaxReportsPage.tsx
pages/ExchangePage.tsx
pages/RepossessionsPage.tsx
pages/SystemStatusPage.tsx
pages/AnalyticsPage.tsx
pages/ChatbotFinanceAnalyticsPage.tsx
components/template-editor/*
```
