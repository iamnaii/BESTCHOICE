# BESTCHOICE — DESIGN.md

A plain-text design system spec that AI agents read to generate consistent UI for the BESTCHOICE installment management system. Drop any new page/component request into an agent with this file in context and get output that matches the rest of the product.

**Paired with**: [`apps/web/src/index.css`](./apps/web/src/index.css) (canonical tokens), [`.claude/rules/frontend.md`](./.claude/rules/frontend.md) (enforceable rules).

---

## 1. Brand Essence

**BESTCHOICE** — ระบบผ่อนชำระสำหรับร้านมือถือในประเทศไทย (installment management for mobile phone shops in Thailand).

Two entities, one product:
- **BESTCHOICE SHOP** — retail, ไม่จด VAT, หลายสาขา
- **BESTCHOICE FINANCE** — ไฟแนนซ์, จด VAT 7%, ถือกรรมสิทธิ์ระหว่างผ่อน

**Voice**: Calm, trustworthy, operator-first. Data-dense but never anxious. Thai-first UX with English code terminology. Every screen should feel like a tool a shop manager can trust with ฿100,000+ transactions.

**Aesthetic vector**: *Warm Cream canvas · Emerald accent · Soft neutrals · Editorial density · Zero decoration that doesn't carry data.*

**Inspiration keywords**: Claude Desktop warmth, Linear precision, Notion editorial calm, shadcn/ui discipline. Not Stripe-glossy, not Vercel-monochrome, not enterprise-gray.

---

## 2. Color System

All colors are HSL CSS variables. **Never hard-code hex in components** — use semantic tokens only.

### 2.1 Semantic tokens (light mode)

| Token | HSL | Purpose |
|---|---|---|
| `--background` | `40 23% 97%` | Page canvas (warm cream, not white) |
| `--foreground` | `25 14% 12%` | Body text |
| `--card` | `40 20% 99%` | Card surface (lifts off canvas subtly) |
| `--card-foreground` | `25 14% 12%` | Text on card |
| `--popover` | `40 20% 99%` | Dropdown/tooltip surface |
| `--muted` | `36 14% 93%` | Quiet surface (table header stripes, disabled) |
| `--muted-foreground` | `25 8% 42%` | Secondary text, captions |
| `--accent` | `36 14% 93%` | Hover surface for list items |
| `--accent-foreground` | `25 12% 14%` | Text on accent |
| `--secondary` | `36 14% 93%` | Secondary button bg |
| `--border` | `34 12% 88%` | Warm-toned hairline |
| `--input` | `34 12% 88%` | Input border |
| `--ring` | `160 84% 39%` | Focus ring (emerald) |

### 2.2 Primary (Emerald — ธาตุไม้ / Wood element)

`--primary: 160 84% 32%` (darker for contrast on cream)
`--primary-foreground: 0 0% 100%` (white text)

Scale for charts / badges / accents:
```
50:  #ecfdf5   500: #10b981
100: #d1fae5   600: #059669  ← hover
200: #a7f3d0   700: #047857  ← primary text
300: #6ee7b7   800: #065f46
400: #34d399   900: #064e3b
                950: #022c22
```

### 2.3 Status colors

| State | Token | Use |
|---|---|---|
| `success` | `142 71% 45%` | Paid, completed, active |
| `warning` | `38 92% 50%` | Due soon, pending review |
| `destructive` | `0 84.2% 60.2%` | Overdue, failed, delete |
| `info` | `199 89% 48%` | Neutral informational |

Always pair with `-foreground` for text on these surfaces.

### 2.4 Sidebar (dedicated token set)

Sidebar is **off-white cream**, not dark. Active item uses emerald.
```
--sidebar-bg:     40 20% 99%
--sidebar-fg:     25 14% 12%
--sidebar-active: 160 84% 39%  ← emerald
--sidebar-hover:  36 16% 94%
--sidebar-border: 34 12% 90%
```

### 2.5 Charts

5-color series, emerald-led. Chart 1 is always the primary metric.
```
chart-1: 160 84% 39%  (emerald — primary series)
chart-2: 25 8% 55%    (warm gray — comparison)
chart-3: 48 96% 53%   (amber — highlights)
chart-4: 0 84% 60%    (red — warnings)
chart-5: 271 91% 65%  (purple — tertiary)
```

### 2.6 Dark mode

Deep warm zinc base (`230 6% 10%`), same emerald primary. Sidebar darkens to `230 5% 14%`. All semantic tokens auto-swap via `.dark` class.

### 2.7 Forbidden

- ❌ `bg-white`, `bg-gray-*`, `text-gray-*`, `bg-gray-50` — use `bg-background` / `bg-card` / `text-muted-foreground` instead
- ❌ Hex literals in JSX/TSX (`#10b981`, `#059669`, etc.)
- ❌ `text-blue-500`, `text-green-600`, raw Tailwind color scales in app code
- ✅ Exceptions: `print` media queries, `/receipts/*` routes (intentionally white paper)

---

## 3. Typography

### 3.1 Font stack

- **Body**: `Inter` (EN) + `IBM Plex Sans Thai` (TH) — loaded via Google Fonts
- **Contracts/receipts**: `IBM Plex Sans Thai` only (utility: `font-sarabun`)
- **Mono**: `SF Mono, Fira Code, monospace` — numeric amounts, code, IMEI

### 3.2 Scale (Tailwind tokens — use these, don't invent)

| Token | Size | Line-height | Typical use |
|---|---|---|---|
| `text-2xs` | 11px | 1.2 | Table micro-labels, timestamps |
| `text-xs` | 12px | 1.33 | Captions, meta |
| `text-2sm` | 13px | 1.32 | Dense table rows |
| `text-sm` | 14px | 1.43 | **Default body** |
| `text-base` | 16px | 1.5 | Form inputs, dialog body |
| `text-lg` | 18px | 1.56 | Card titles |
| `text-xl` | 20px | 1.4 | Section headings |
| `text-2xl` | 24px | 1.33 | Page headings |
| `text-3xl` | 30px | 1.27 | Dashboard KPIs |
| `text-4xl` | 36px | 1.11 | Hero numbers (rare) |

**Default body is 14px, not 16px** — dense operator UI.

### 3.3 Thai-specific rules

- **Always `leading-snug` or looser** for Thai text. Never `leading-none` — ตัดสระบน (vowels above consonants get clipped).
- Mixing EN/TH: font stack handles it automatically (Inter falls back to IBM Plex Sans Thai for Thai glyphs).
- Number formatting: use `toLocaleString('th-TH')` + currency `฿` prefix for money displays.

### 3.4 Weight usage

- `font-normal` (400) — body
- `font-medium` (500) — labels, table headers, emphasis
- `font-semibold` (600) — section headings, card titles, primary buttons
- `font-bold` (700) — KPI numbers, H1/H2 only
- `font-light` (300) — reserved for display-scale (`text-4xl`+)

---

## 4. Spacing & Layout

### 4.1 Radius

`--radius: 0.5rem` (8px) base. Derived scale:
- `rounded-sm` — 4px (badges, checkboxes)
- `rounded-md` — 6px (inputs, small buttons)
- `rounded-lg` — 8px (cards, buttons — **default**)
- `rounded-xl` — 12px (stat cards, dialogs)
- `rounded-2xl` — 16px (hero cards)
- `rounded-full` — avatars, pill badges

### 4.2 Shadows

| Token | Use |
|---|---|
| `shadow-xs` | Subtle separation (input focus, small lift) |
| `shadow-card` | **Default card elevation** |
| `shadow-card-hover` | Card hover state |
| `shadow-sidebar` | Sidebar right-edge glow |
| `shadow-topbar` | Top nav 1px line |
| `shadow-modal` | Dialogs, popovers |

Avoid `shadow-2xl`, `shadow-inner` — not in our language.

### 4.3 Spacing rhythm

Base unit: 4px. Use `space-y-*` / `gap-*` in multiples of 2.
- Tight (list rows, form fields): `gap-2` (8px)
- Default (section internals): `gap-4` (16px)
- Loose (between sections): `gap-6` / `gap-8` (24/32px)
- Page-level separators: `my-5` via `.kt-separator`

### 4.4 Layout primitives

- `MainLayout` — app chrome: sidebar + topbar + outlet
- `ProtectedRoute` — auth wrapper for all `/` routes (not `/liff/*`)
- Page max-width: NOT constrained — pages fill available viewport. KPI grids use `grid-cols-2 md:grid-cols-4`.
- Mobile breakpoint: Tailwind default (`md:` = 768px). LIFF pages (`/liff/*`) are mobile-first.

---

## 5. Components

All components are **shadcn/ui + Radix UI** (copied into [`apps/web/src/components/ui/`](./apps/web/src/components/ui/)). Never install Material UI, Ant Design, Chakra, etc.

### 5.1 Buttons

- **Primary**: `bg-primary text-primary-foreground hover:bg-primary/90` — emerald
- **Secondary**: `bg-secondary` — neutral warm sand
- **Destructive**: only for delete/cancel actions
- **Ghost**: navigation, toolbar buttons
- **Outline**: secondary actions in dialogs
- Icon + label ordering: icon left (`<Icon className="mr-2 h-4 w-4" />`)
- Primary button per screen: **1 only** (the main CTA)

### 5.2 Cards

```tsx
<Card className="shadow-card hover:shadow-card-hover transition-shadow">
  <CardHeader><CardTitle>...</CardTitle></CardHeader>
  <CardContent>...</CardContent>
</Card>
```
Utility shortcut: `className="stat-card"` → padding + border + hover-shadow in one class.

### 5.3 Tables

- Use TanStack Table (`@tanstack/react-table`) when sorting/filtering needed
- Simple tables: plain `<table>` with shadcn primitives
- Row height: `h-12` (48px) default, `h-10` (40px) dense
- Header: `bg-muted/50`, `font-medium`, `text-xs uppercase tracking-wide text-muted-foreground`
- Zebra striping: **don't** — use borders only
- Money columns: `text-right font-mono tabular-nums`

### 5.4 Forms

- **react-hook-form** + **zod** schema — all new forms. Legacy controlled forms still exist, don't refactor unless touching them.
- Inline validation messages (`<FormMessage />`) — **ภาษาไทย** text
- Required field indicator: red asterisk `<span className="text-destructive">*</span>`
- Submit button: full-width on mobile, auto-width on desktop
- Error summary at top of long forms (not just inline)

### 5.5 Dialogs & Sheets

- `Dialog` for confirmations, short forms (under 5 fields)
- `Sheet` (side drawer) for detail editing, long forms
- **Never** use `window.confirm()` / `alert()` — use `ConfirmDialog` component
- Destructive actions: double-confirm with typed name for delete

### 5.6 Toasts (Sonner)

```tsx
toast.success('บันทึกสำเร็จ');
toast.error('เกิดข้อผิดพลาด', { description: err.message });
```
- Always Thai for user-facing messages
- `.success` / `.error` / `.warning` / `.info` — pick the right variant
- No custom toast system, no `react-toastify`

### 5.7 Status badges

- Contract status: emerald (active), amber (pending), red (overdue/cancelled), gray (closed)
- Always pair icon + text label — don't rely on color alone (a11y)
- Pill shape: `rounded-full px-2.5 py-0.5 text-xs`

### 5.8 KPI / Stat cards

- Big number: `text-3xl font-bold tabular-nums`
- Label: `text-sm text-muted-foreground`
- Trend indicator: `ArrowUp` / `ArrowDown` + MoM/YoY % in success/destructive color
- Icon in top-right, `text-primary` emerald, `h-5 w-5`

### 5.9 Empty states

- Centered, `py-12`
- Icon (lucide) at `h-12 w-12 text-muted-foreground`
- Title `text-lg font-semibold`, description `text-sm text-muted-foreground`
- CTA button below if applicable

### 5.10 Loading states

- **Page level**: `QueryBoundary` wrapper handles loading + error + retry
- **Inline**: skeleton components (`<Skeleton className="h-4 w-32" />`)
- **Button**: `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` + disabled
- No raw spinner-in-middle-of-page patterns

---

## 6. Data Layer (affects UI shape)

- **Server state**: `@tanstack/react-query` — `useQuery` / `useMutation` only. No `useEffect + fetch`.
- **Client state**: Zustand stores for complex (cart, draft contract). Local `useState` for everything else.
- **API client**: `api.get()` / `api.post()` from [`@/lib/api`](./apps/web/src/lib/api.ts) — never raw `fetch` or `axios`.
- **Cache invalidation**: always `queryClient.invalidateQueries()` after mutations.
- **Auto-save drafts**: localStorage, 30s interval, 24hr expiry, recovery prompt (pattern from ContractCreate).

---

## 7. Motion

Restrained. Animations serve function, not delight.

| Animation | Duration | Easing | Use |
|---|---|---|---|
| `animate-fadeIn` | 300ms | ease-out | Page/section enter |
| `animate-slideUp` | 500ms | ease-out | Card grid reveal (stagger optional) |
| `animate-pulse-subtle` | 2s | ease-in-out | Live data indicator |
| `animate-accordion-*` | 200ms | ease-out | Collapsibles |
| Hover transitions | 150-200ms | default | Buttons, cards |

**Always respect `prefers-reduced-motion`** — CSS at bottom of [`index.css`](./apps/web/src/index.css) already handles this globally.

No parallax, no scroll-jacking, no cursor trails, no confetti.

---

## 8. Iconography

- **Library**: `lucide-react` only
- Sizes: `h-4 w-4` (inline), `h-5 w-5` (buttons/cards), `h-6 w-6` (page headers), `h-12 w-12` (empty states)
- Color: inherit from text (`currentColor`) — no hard-coded colors
- `stroke-width`: default (2) — don't override

---

## 9. Accessibility

- All interactive elements have `aria-label` when icon-only
- Focus ring: `ring-2 ring-ring/30 ring-offset-[3px]` — already global via `:focus-visible`
- `SkipLink` rendered at top of MainLayout
- `alt=""` only on purely decorative images (ESLint enforces)
- Color contrast: text on `bg-primary` meets 4.5:1 (hence darkening to `32%` lightness)
- Never use `<div onClick>` — use `<button>` or `<Link>`

---

## 10. Responsive Philosophy

- **Desktop-first for operator app** (sales terminal, manager dashboard) — assume 1280px+ primary
- **Mobile-first for customer-facing** (`/liff/*` LINE LIFF, `/landing`, `/verify/:id`, `/pay/:token`)
- Tables → cards on mobile (Stack component pattern)
- Sidebar → sheet on `md:` and below

---

## 11. Thai Context

- All user-facing copy, validation messages, error toasts: **ภาษาไทย**
- Variable/function/component names: **English**
- Dates: `dayjs` with `th` locale, format `DD MMM YYYY` or `DD/MM/YYYY` for tables
- Money: `฿` prefix, `toLocaleString('th-TH')`, 2 decimal places always (even `฿10,000.00`)
- Phone: display as `081-234-5678` (hyphenated), store as `0812345678`
- National ID: mask by default (`1-2345-XXXXX-12-3`), reveal on authorized click

---

## 12. Anti-patterns (reject in review)

- Hex colors anywhere in `.tsx` / `.ts` (outside tokens file)
- `bg-white`, `bg-gray-*`, `text-gray-*` (non-print)
- `confirm()`, `alert()`, `window.prompt()`
- `axios` or `fetch` imported directly in a component
- Class components
- New UI library beyond shadcn/Radix/Tailwind/lucide
- Inline `style={{ color: '#...' }}`
- Thai text with `leading-none`
- More than one primary CTA per screen
- Loading spinners in middle of card (use skeleton)
- Custom toast / modal implementations

---

## 13. Quick reference — "I need to build X"

| Task | Start from |
|---|---|
| New list page | [`apps/web/src/pages/CustomersPage.tsx`](./apps/web/src/pages/CustomersPage.tsx) |
| New detail page | `CustomerDetailPage.tsx` + PageHeader with breadcrumb |
| New form | react-hook-form + zod + shadcn Form primitives |
| New dashboard widget | `stat-card` utility + lucide icon + tabular-nums |
| New modal flow | `Dialog` (short) or `Sheet` (long) |
| New table | TanStack Table + shadcn Table primitives |
| New chart | Recharts + `chart-1…5` tokens |
| New LIFF page | `apps/web/src/pages/liff/*` — mobile-first, `safe-area-bottom` utility |

---

*This document is the source of truth for visual direction. When in conflict with a random old component, trust this file. When in conflict with [`.claude/rules/frontend.md`](./.claude/rules/frontend.md), rules win (they're enforceable).*
