# ~~BESTCHOICE UI Overhaul — Metronic Style + Navy/Emerald Theme~~

> **SUPERSEDED** — เอกสารนี้ถูกแทนที่ด้วย [shadcn-ui-redesign.md](2026-04-16-shadcn-ui-redesign.md) (Minimal Zinc + Emerald Accent)
> Direction เปลี่ยนจาก Navy+Emerald gradient → Minimal zinc base + Emerald accent only

---

> ~~ปรับ visual ทั้งระบบเป็น Metronic v9 style พร้อม brand colors ที่เสริมธาตุไม้ (ฮวงจุ้ย)~~

## Decisions

| หัวข้อ | ตัดสินใจ |
|--------|---------|
| Layout Style | Dark Sidebar + Brand Header (Premium) |
| Primary Color | Navy `#1e3a5f` (ธาตุน้ำ — เสริมไม้) |
| Accent Color | Emerald `#059669` (ธาตุไม้ — ธาตุตัวเอง) |
| Sidebar | คงโครงสร้างเมนูเดิม, ปรับ visual เป็น Metronic |
| Approach | Top-Down: Layout shell + tokens พร้อมกัน → core components → polish pages |
| Icons | Lucide React (stroke-width 1.75) — ห้ามใช้ emoji |
| Scope | ทุกหน้า (~73 pages) ผ่าน shared components |

## Feng Shui Rationale

เจ้าของธุรกิจทั้ง 3 คนเป็นธาตุไม้ (ปีเกิด 1994, 1995, 1964):
- Navy Blue = ธาตุน้ำ → เลี้ยงไม้ (เสริมมาก)
- Emerald Green = ธาตุไม้ → ธาตุตัวเอง (เสริม)
- หลีกเลี่ยง: ขาว, เงิน, ทอง (ธาตุโลหะ ข่มไม้)

## 1. Design Tokens

### 1.1 Color Palette

**Primary (Navy)**
| Shade | Hex | Usage |
|-------|-----|-------|
| 50 | `#f0f5ff` | Hover background, info badge bg |
| 100 | `#d6e4ff` | Light background, selected row |
| 200 | `#a3bffa` | Border, focus ring |
| 400 | `#5b8def` | Icon, link text |
| 700 | `#1e3a5f` | PRIMARY — buttons, sidebar, header |
| 800 | `#162d4a` | Sidebar background |
| 900 | `#0f2035` | Darkest — sidebar bottom |

**Accent (Emerald)**
| Shade | Hex | Usage |
|-------|-----|-------|
| 50 | `#ecfdf5` | Success badge bg |
| 100 | `#d1fae5` | Light success bg |
| 300 | `#6ee7b7` | Sidebar active text |
| 400 | `#34d399` | Icon, active indicator |
| 600 | `#059669` | ACCENT — CTA buttons, active states |
| 700 | `#047857` | Hover state |
| 800 | `#065f46` | Pressed state |

**Neutral (Slate)**
| Shade | Hex | Usage |
|-------|-----|-------|
| 50 | `#f8fafc` | Page background |
| 100 | `#f1f5f9` | Card hover bg, table header |
| 200 | `#e2e8f0` | Border, divider |
| 400 | `#94a3b8` | Placeholder text |
| 500 | `#64748b` | Muted text |
| 700 | `#334155` | Body text |
| 800 | `#1e293b` | Heading text |

**Status Colors (คงเดิม)**
| Status | Background | Text |
|--------|-----------|------|
| Active / Success | `#ecfdf5` | `#059669` |
| Warning / Overdue | `#fef3c7` | `#d97706` |
| Danger / Default | `#fef2f2` | `#dc2626` |
| Info / Draft | `#f0f5ff` | `#1e3a5f` |
| Neutral / Closed | `#f1f5f9` | `#64748b` |
| Purple / Early Payoff | `#f5f3ff` | `#7c3aed` |

### 1.2 Typography

Font: **Inter** (Latin) + **Noto Sans Thai** (ภาษาไทย) — ไม่เปลี่ยน

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| Display | 28px | Bold (700) | KPI numbers |
| H1 | 22px | Bold (700) | Page title |
| H2 | 17px | Semibold (600) | Section title |
| H3 | 14px | Semibold (600) | Card title |
| Body | 13.5px | Regular (400) | Body text |
| Small | 12px | Regular (400) | Label, caption |
| Tiny | 11px | Regular (400) | ID, code, meta |

### 1.3 Spacing

Standard Tailwind scale: 4 / 8 / 12 / 16 / 20 / 24 / 32px

| Token | Value | Usage |
|-------|-------|-------|
| gap-1 | 4px | Tight spacing (icon + text) |
| gap-2 | 8px | Default gap in flex/grid |
| gap-3 | 12px | Form field gap |
| p-4 | 16px | Card padding |
| p-5 | 20px | Section padding |
| gap-6 | 24px | Card gap in grid |
| p-8 | 32px | Page content padding |

### 1.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Badge, tag |
| md | 6px | Button, input |
| lg | 10px | Card, modal |
| full | 20px | Pill badge, avatar |

### 1.5 Shadows

Navy-tinted shadows แทน neutral gray:

| Token | Value | Usage |
|-------|-------|-------|
| sm | `0 1px 2px rgba(30,58,95,0.05)` | Table row |
| md | `0 1px 3px rgba(30,58,95,0.08), 0 1px 2px rgba(30,58,95,0.04)` | Card default |
| lg | `0 4px 12px rgba(30,58,95,0.1), 0 1px 3px rgba(30,58,95,0.06)` | Card hover, dropdown |
| xl | `0 10px 25px rgba(30,58,95,0.12), 0 4px 10px rgba(30,58,95,0.06)` | Modal, popover |

### 1.6 Icons

- Library: **Lucide React** (ไม่ต้อง install เพิ่ม)
- stroke-width: **1.75** (default 2 ดูหนาเกิน)
- stroke-linecap: round
- Sizes: sidebar 18px, button 16px, KPI card 20px, page header 14px
- สีตาม context: Emerald = success/action, Navy = info/nav, Red = danger, Gray = muted
- **ห้ามใช้ emoji ใน UI ทั้งหมด**

## 2. Layout Shell

### 2.1 Sidebar (Desktop — Expanded 260px)

```
┌─────────────────────┐
│ [B] BESTCHOICE      │  Logo area — gradient bg icon + brand name
│     Finance Mgmt    │  Subtitle: "Finance Management"
├─────────────────────┤
│ [Avatar] นาย สมชาย  │  User info — avatar + name + role badge + branch
│ OWNER สาขาลาดพร้าว  │
├─────────────────────┤
│ ── ภาพรวม ──        │  Section label — uppercase, 10px, 30% opacity
│ ▌ Dashboard ✓       │  Active: emerald bg 20% + border-left 3px + emerald text
│   POS               │  Inactive: white 50% opacity
│   ...               │
│ ── ขาย ──           │
│   ลูกค้า            │
│   สัญญา             │
│ ── การเงิน ──       │
│   ชำระเงิน          │
│   ค้างชำระ [12]     │  Badge count — red bg 25% + red text
├─────────────────────┤
│ ◀ ย่อเมนู          │  Collapse trigger
└─────────────────────┘
```

- Background: `linear-gradient(180deg, #1e3a5f, #162d4a 60%, #0f2035)`
- Active item: `bg-emerald-500/20 text-emerald-300 border-l-3 border-emerald-500`
- Inactive: `text-white/50`
- Section labels: `text-white/30 text-[10px] font-semibold uppercase tracking-wider`

### 2.2 Sidebar (Collapsed — 70px icon rail)

- Logo icon only (36px square, emerald gradient)
- Icons 40x40px with active state (emerald border-left)
- Tooltip on hover showing full label
- Badge counts visible on icons

### 2.3 TopBar (60px height)

```
┌───────────────────────────────────────────────────┐
│ หน้าหลัก / Dashboard    🔍 ค้นหา (⌘K)  🏢 SHOP  🔔3  🌙  [N] │
└───────────────────────────────────────────────────┘
```

- Background: `#fff` + `border-bottom: 1px solid #e2e8f0`
- Left: Breadcrumb (gray / current)
- Right: Search bar (f1f5f9 bg) + Company filter (f0f5ff bg) + Notification bell + Dark mode + Avatar

### 2.4 Page Header (Gradient Banner)

```
┌───────────────────────────────────────────────────┐
│ background: linear-gradient(135deg, #1e3a5f, #234b73, #059669) │
│                                                   │
│  Dashboard                        [Export] [+ CTA] │
│  ภาพรวมธุรกิจ — อัปเดตล่าสุด...                    │
└───────────────────────────────────────────────────┘
```

- Gradient: `linear-gradient(135deg, #1e3a5f 0%, #234b73 50%, #059669 100%)`
- Title: 20-22px bold white
- Subtitle: 11px white/60%
- Action buttons: ghost (white/12% bg) + primary (emerald)
- Detail pages: Back button + Status badge inline

### 2.5 Mobile Layout

- TopBar: Hamburger + Logo icon + Search + Notification
- Page Header: Gradient (ย่อลง padding)
- Content: 12px padding
- Bottom Nav: 5 tabs (หน้าหลัก, POS, สัญญา, ชำระ, เพิ่มเติม)
- Sidebar: Sheet overlay (280px) slide from left

## 3. Core Components

### 3.1 Button

| Variant | Background | Text | Shadow | Usage |
|---------|-----------|------|--------|-------|
| Primary | `#059669` | white | `0 2px 8px rgba(5,150,105,0.25)` | CTA หลัก |
| Primary hover | `#047857` | white | — | |
| Secondary | `#1e3a5f` | white | — | Action รอง |
| Secondary light | `#f0f5ff` | `#1e3a5f` | — | Export, filter |
| Outline | transparent | `#059669` | — | Secondary action |
| Ghost | transparent | `#64748b` | — | Cancel, minor action |
| Destructive | `#fef2f2` | `#dc2626` | — | Delete (soft) |
| Destructive solid | `#dc2626` | white | — | Confirm delete |

Sizes: lg (py-10px), md (py-8px), sm (py-6px)
Icons: Lucide 14-16px, left-aligned, gap-5px

### 3.2 Card

| Type | Border | Shadow | Usage |
|------|--------|--------|-------|
| KPI Card | `border-left: 4px solid [color]` | md | Dashboard KPIs |
| Info Card | none | md | Detail sections |
| Action Card | none (gradient bg) | none | CTA panels |
| Table Card | none | md | Wraps DataTable |

Card structure:
- Header: icon + title + optional action button, `border-bottom: 1px solid #f1f5f9`
- Body: content with consistent padding (16px)

### 3.3 DataTable

Structure:
```
┌─ Table Header Bar ──────────────────────────────┐
│  Title             🔍 Search  [Status tabs] [Filter] [Export] │
├─ Column Headers (f8fafc bg, uppercase 10px) ────┤
│  □  เลขสัญญา  ลูกค้า  สินค้า  ยอด  สถานะ  ⋯ │
├─ Rows ──────────────────────────────────────────┤
│  □  BC-0451  [Avatar] สมชาย  iPhone  ฿42,500  [Active]  ⋯ │
│  □  BC-0450  [Avatar] สมหญิง  Samsung  ฿38,900  [Overdue]  ⋯ │
├─ Pagination ────────────────────────────────────┤
│  แสดง 1-10 จาก 245                     ← 1 2 3 → │
└─────────────────────────────────────────────────┘
```

- Header bar: search + status tabs (pill toggle) + filter/export buttons
- Column headers: f8fafc bg, 10px uppercase, letter-spacing 0.5px
- Rows: hover bg f8fafc, avatar + name + phone stacked
- Status: pill badges (rounded-full)
- Actions: vertical dots icon (MoreVertical)
- Pagination: Navy active page, gray inactive

### 3.4 Form Elements

**Input:**
- Border: `1px solid #e2e8f0`
- Focus: `border-color: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,0.1)`
- Error: `border-color: #fca5a5; background: #fef2f2; box-shadow: 0 0 0 3px rgba(220,38,38,0.1)`
- Error message: 11px `#dc2626`
- Label: 11-12px font-weight-500 `#334155`
- Required: red asterisk

**Select:** Same border/focus as input, native or SearchableSelect

**Toggle:** Emerald when on (`#059669`), gray when off

**Checkbox:** Emerald check with rounded-sm corners

### 3.5 Badges

**Status badges:** Pill shape (rounded-full), bg-[color]-50/100, text-[color]-600/700

| Status | Background | Text |
|--------|-----------|------|
| Active | `#ecfdf5` | `#059669` |
| Overdue | `#fef3c7` | `#d97706` |
| Default | `#fef2f2` | `#dc2626` |
| Draft | `#f0f5ff` | `#1e3a5f` |
| Completed | `#f1f5f9` | `#64748b` |
| Early Payoff | `#f5f3ff` | `#7c3aed` |
| Bad Debt | `#fef2f2` + dashed border | `#dc2626` |

**Payment badges:** Same + dot indicator (6px circle before text)

**Role badges:** Solid/gradient, rounded-sm (4px)
- OWNER: gradient Navy→Emerald
- Branch Manager: Navy solid
- Finance Manager: Emerald solid
- Accountant: Purple (`#7c3aed`)
- Sales: Sky Blue (`#0ea5e9`)

### 3.6 Modal

- Overlay: `rgba(15,32,53,0.6)` (Navy-tinted)
- Container: white, rounded-xl (12px), shadow-xl
- Header: title + subtitle + close button (28px gray square)
- Body: 24px padding, form fields
- Footer: f8fafc bg, border-top, right-aligned buttons (Cancel + Primary)

### 3.7 Supporting Components

| Component | Style |
|-----------|-------|
| Tabs | Pill toggle in f1f5f9 container, Navy active bg |
| Breadcrumb | Gray / current, slash separator |
| Dropdown Menu | White bg, shadow-lg, rounded-lg, hover f8fafc |
| Tooltip | Dark bg (#1e293b), white text, rounded-md |
| Skeleton | f1f5f9 bg, pulse animation |
| EmptyState | Lucide icon (48px, gray) + title + subtitle + CTA |
| ConfirmDialog | Modal variant with icon (warning/danger) |

## 4. Page Patterns

### 4.1 Dashboard Pattern

```
[Page Header — gradient, date filter, export button]
[KPI Cards — 4 columns, border-left color-coded]
[Charts Row — Bar chart (3fr) + Quick Actions panel (2fr)]
[Recent Table — สัญญาล่าสุด / ชำระล่าสุด]
```
Used by: DashboardPage (1 page)

### 4.2 List Pattern

```
[Page Header — gradient, title + count, + Create button]
[Filter Bar — search + status tabs + filter/export]
[DataTable — checkbox + avatar rows + status pills]
[Pagination — count + page numbers]
```
Used by: ~30 pages (Customers, Contracts, Payments, Stock, Overdue, Receipts, Users, Suppliers, AuditLogs, etc.)

### 4.3 Detail Pattern

```
[Page Header — gradient, back button, title + status badge, action buttons]
[Content Grid — Info cards (2fr) + Summary sidebar (1fr)]
  Left: Contract info card, Payment history card
  Right: Progress card (% + progress bar), Customer card
```
Used by: ~15 pages (ContractDetail, CustomerDetail, ProductDetail, SupplierDetail, etc.)

### 4.4 Form Pattern

```
[Page Header — gradient, back button, title]
[Form Sections — max-width 640px, grouped in cards]
  Section 1: [Icon] Title → grid fields
  Section 2: [Icon] Title → grid fields
[Action Bar — right-aligned Cancel + Save buttons]
```
Used by: ~20 pages (ContractCreate, CustomerCreate, ProductCreate, Settings, etc.)

## 5. Implementation Strategy

### Approach: Top-Down

**Step 1 — Layout Shell + Design Tokens (ทุกหน้าเปลี่ยนทันที)**
- Update `apps/web/src/index.css` — color tokens, shadows, radius
- Rewrite `MainLayout.tsx`, `Sidebar.tsx`, `TopBar.tsx`
- Add `PageHeader.tsx` gradient component

**Step 2 — Core Components (ทุกหน้าที่ใช้ component สวยขึ้น)**
- Update: Button, Card, DataTable, Form elements (input/select/toggle/checkbox)
- Update: Badge (status-badges.ts mapping), Modal, Dialog
- Add: PageHeader with gradient support

**Step 3 — Supporting Components**
- Update: Tabs, Breadcrumb, Dropdown, Tooltip, Skeleton, EmptyState, ConfirmDialog
- Update: Pagination component

**Step 4 — Page Polish (ทีละหน้า)**
- Apply page patterns to all 73+ pages
- Priority: Dashboard → POS → Contracts → Payments → Customers → Stock → Overdue → Settings → rest

### Files to Modify (Core)

| File | Change |
|------|--------|
| `apps/web/src/index.css` | Design tokens (colors, shadows, radius) |
| `apps/web/src/components/layout/MainLayout.tsx` | Responsive layout with new sidebar |
| `apps/web/src/components/layout/Sidebar.tsx` | Navy gradient + section labels + user badge |
| `apps/web/src/components/layout/TopBar.tsx` | Breadcrumb + search + company filter |
| `apps/web/src/components/ui/button.tsx` | Navy/Emerald variants |
| `apps/web/src/components/ui/card.tsx` | KPI/Info/Action variants |
| `apps/web/src/components/ui/DataTable.tsx` | Header bar + filter tabs + new pagination |
| `apps/web/src/components/ui/badge.tsx` | Pill style + dot indicators |
| `apps/web/src/components/ui/Modal.tsx` | Navy overlay + new header/footer |
| `apps/web/src/components/ui/input.tsx` | Emerald focus ring |
| `apps/web/src/components/ui/PageHeader.tsx` | NEW — gradient banner component |
| `apps/web/src/lib/status-badges.ts` | Update color mappings |

### What Stays the Same

- All page business logic — no changes to data fetching, mutations, routing
- React Query setup, Zustand stores
- API client (`lib/api.ts`), Auth context
- Backend — zero changes
- Prisma schema — zero changes
- LIFF pages — separate styling (customer-facing)

## 6. Visual Mockups

Browser mockups created during brainstorming are available at:
`.superpowers/brainstorm/17875-1776278395/content/`

| File | Content |
|------|---------|
| `layout-direction.html` | 3 layout options (A/B/C) |
| `color-palette.html` | 3 color palettes with Feng Shui analysis |
| `design-tokens.html` | Colors, typography, spacing, shadows |
| `layout-shell.html` | Full desktop + collapsed + mobile mockups |
| `core-components.html` | Buttons, cards, tables, forms, badges, modals |
| `icon-comparison.html` | Emoji vs Lucide comparison |
| `page-patterns.html` | Dashboard, List, Detail, Form patterns |
