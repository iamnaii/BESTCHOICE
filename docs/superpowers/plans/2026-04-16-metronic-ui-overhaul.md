# Metronic UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the BESTCHOICE frontend from its current blue-primary custom design to a Navy+Emerald Metronic-style theme with gradient headers, refined sidebar, and consistent page patterns.

**Architecture:** Top-down approach — change design tokens + layout shell first (instant visual impact on all pages), then swap core components, then polish individual pages. All changes are frontend-only; backend, Prisma, routing, and business logic remain untouched.

**Tech Stack:** React 18, Tailwind CSS v4 (CSS-in-CSS @theme), Radix UI, Lucide React, CVA (class-variance-authority)

**Spec:** `docs/superpowers/specs/2026-04-16-metronic-ui-overhaul-design.md`

---

## Phase 1: Design Tokens + Layout Shell

### Task 1: Update Design Tokens (index.css)

**Files:**
- Modify: `apps/web/src/index.css`

This single file change updates colors, shadows, and radius across the entire app.

- [ ] **Step 1: Update primary color scale in @theme block**

Replace the current blue primary scale (lines 45-55) with Navy:

```css
  --color-primary-50: #f0f5ff;
  --color-primary-100: #d6e4ff;
  --color-primary-200: #a3bffa;
  --color-primary-300: #7da2ef;
  --color-primary-400: #5b8def;
  --color-primary-500: #3a6fd8;
  --color-primary-600: #2d5a8a;
  --color-primary-700: #1e3a5f;
  --color-primary-800: #162d4a;
  --color-primary-900: #0f2035;
  --color-primary-950: #091626;
```

- [ ] **Step 2: Add accent (Emerald) color scale after primary**

Add these lines after the primary scale:

```css
  --color-accent-50: #ecfdf5;
  --color-accent-100: #d1fae5;
  --color-accent-200: #a7f3d0;
  --color-accent-300: #6ee7b7;
  --color-accent-400: #34d399;
  --color-accent-500: #10b981;
  --color-accent-600: #059669;
  --color-accent-700: #047857;
  --color-accent-800: #065f46;
  --color-accent-900: #064e3b;
```

- [ ] **Step 3: Update HSL CSS variables in :root block**

In the `:root` block (lines 263-325), update:

```css
    /* Primary: Navy */
    --primary: 210 52% 24%;
    --primary-foreground: 0 0% 100%;
    /* Accent: Emerald */
    --accent: 160 84% 39%;
    --accent-foreground: 0 0% 100%;
    /* Info: use Navy instead of purple */
    --info: 210 52% 24%;
    --info-foreground: 0 0% 100%;
    /* Sidebar */
    --sidebar-bg: 210 52% 24%;
    --sidebar-fg: 0 0% 100%;
    --sidebar-active: 160 84% 39%;
    --sidebar-hover: 210 52% 20%;
    --sidebar-border: 210 52% 18%;
    /* Hero gradient: Navy to Emerald */
    --color-hero-1: #0f2035;
    --color-hero-2: #162d4a;
    --color-hero-3: #1e3a5f;
    --color-hero-4: #234b73;
    --color-hero-5: #059669;
```

- [ ] **Step 4: Update dark mode HSL variables**

In the `.dark` block (lines 327-368), update:

```css
    --primary: 210 52% 30%;
    --primary-foreground: 0 0% 100%;
    --accent: 160 84% 39%;
    --accent-foreground: 0 0% 100%;
    --info: 210 52% 30%;
    --info-foreground: 0 0% 100%;
    --sidebar-bg: 210 52% 12%;
    --sidebar-fg: 0 0% 95%;
    --sidebar-active: 160 84% 39%;
    --sidebar-hover: 210 52% 16%;
    --sidebar-border: 210 52% 16%;
```

- [ ] **Step 5: Update shadow tokens**

Replace shadow tokens (lines 126-131) with Navy-tinted shadows:

```css
  --shadow-xs: 0 1px 2px rgba(30, 58, 95, 0.05);
  --shadow-card: 0 1px 3px rgba(30, 58, 95, 0.08), 0 1px 2px rgba(30, 58, 95, 0.04);
  --shadow-card-hover: 0 4px 12px rgba(30, 58, 95, 0.1), 0 1px 3px rgba(30, 58, 95, 0.06);
  --shadow-sidebar: 4px 0 20px rgba(15, 32, 53, 0.2);
  --shadow-topbar: 0 1px 0 rgba(30, 58, 95, 0.05);
  --shadow-modal: 0 10px 25px rgba(30, 58, 95, 0.12), 0 4px 10px rgba(30, 58, 95, 0.06);
```

- [ ] **Step 6: Update sidebar-dark color**

Change the `--color-sidebar-dark` (line 112):

```css
  --color-sidebar-dark: #162d4a;
```

- [ ] **Step 7: Verify dev server runs and app loads**

Run: `cd apps/web && npm run dev`

Open http://localhost:5173 — all pages should now show Navy primary color instead of blue. Sidebar should appear darker Navy. Shadows should have a subtle Navy tint.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/index.css
git commit -m "style: update design tokens — Navy+Emerald palette, Navy-tinted shadows"
```

---

### Task 2: Rewrite Sidebar Component

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

The sidebar keeps its existing structure (AccordionMenu, role-based menus, collapse/expand) but gets new styling: Navy gradient background, Emerald active states, user info below logo.

- [ ] **Step 1: Update roleBadgeMap colors**

Replace the `roleBadgeMap` (lines 38-44) with:

```typescript
const roleBadgeMap: Record<string, { label: string; cls: string }> = {
  OWNER:          { label: 'OWNER',        cls: 'bg-gradient-to-r from-[#1e3a5f] to-[#059669] text-white' },
  BRANCH_MANAGER: { label: 'ผจก.สาขา',    cls: 'bg-[#1e3a5f] text-white' },
  FINANCE_MANAGER:{ label: 'การเงิน',      cls: 'bg-[#059669] text-white' },
  ACCOUNTANT:     { label: 'บัญชี',        cls: 'bg-[#7c3aed] text-white' },
  SALES:          { label: 'พนง.ขาย',      cls: 'bg-[#0ea5e9] text-white' },
};
```

- [ ] **Step 2: Update expandedMenuClassNames for Emerald active state**

Replace `expandedMenuClassNames` (lines 47-67) with:

```typescript
const expandedMenuClassNames: AccordionMenuClassNames = {
  root: 'space-y-0.5',
  item: [
    'h-[34px] rounded-md text-[12px] font-medium',
    'text-white/45 hover:text-white/80 hover:bg-white/[0.06]',
    'transition-colors duration-150',
    'data-[selected=true]:bg-emerald-500/20 data-[selected=true]:text-emerald-300',
    'relative data-[selected=true]:before:absolute data-[selected=true]:before:left-0',
    'data-[selected=true]:before:top-[5px] data-[selected=true]:before:bottom-[5px]',
    'data-[selected=true]:before:w-[3px] data-[selected=true]:before:bg-emerald-500',
    'data-[selected=true]:before:rounded-r-full',
  ].join(' '),
  sub: '',
  subTrigger: [
    'h-[32px] rounded-md text-[10px] font-semibold uppercase tracking-[0.1em]',
    'text-white/25 hover:text-white/50 hover:bg-transparent',
    'data-[state=open]:text-white/40 data-[state=open]:bg-transparent',
    'transition-colors duration-150 px-2',
  ].join(' '),
  subContent: 'py-0.5 pl-0 border-l-0 ml-0',
};
```

- [ ] **Step 3: Update ExpandedSidebar background and logo**

In the `ExpandedSidebar` component, change the root div className (line 276):

```typescript
className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[264px] flex flex-col bg-gradient-to-b from-[#1e3a5f] via-[#162d4a] to-[#0f2035] border-r border-white/[0.06] shadow-[4px_0_24px_rgba(15,32,53,0.3)] transition-all duration-300"
```

Update the logo icon (line 282) — change from blue gradient to Emerald:

```typescript
<div className="size-[36px] rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
  <span className="text-white text-[16px] font-bold leading-none">B</span>
</div>
```

Update the brand text — add subtitle:

```typescript
<div className="flex flex-col leading-tight">
  <span className="text-[15px] font-bold text-white tracking-tight">
    BESTCHOICE
  </span>
  <span className="text-[9px] text-white/30 font-medium tracking-widest uppercase">
    Finance Management
  </span>
</div>
```

- [ ] **Step 4: Move user info from footer to below logo**

Move the user section from the bottom of ExpandedSidebar to right after the header div. Insert this block after the header closing `</div>` and before the ScrollArea:

```tsx
{/* User info */}
{user && (
  <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.06]">
    <div className="size-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
      <span className="text-emerald-300 text-xs font-bold">{user.name?.charAt(0)}</span>
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[12px] font-medium text-white/70 truncate">{user.name}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        {roleInfo && (
          <span className={cn('inline-flex text-[9px] font-bold px-1.5 py-px rounded', roleInfo.cls)}>
            {roleInfo.label}
          </span>
        )}
        {user.branchName && (
          <span className="text-[9px] text-white/25 truncate">{user.branchName}</span>
        )}
      </div>
    </div>
  </div>
)}
```

Then simplify the footer to just have the logout button and collapse toggle.

- [ ] **Step 5: Update CollapsedSidebar with Navy gradient**

In `CollapsedSidebar`, update the root div className (line 105):

```typescript
className="sidebar fixed top-0 bottom-0 left-0 z-20 w-[70px] flex flex-col items-center bg-gradient-to-b from-[#1e3a5f] to-[#0f2035] py-3 border-r border-white/[0.06] shadow-[4px_0_24px_rgba(15,32,53,0.3)]"
```

Update logo icon to Emerald gradient (line 111):

```typescript
<div className="size-[36px] rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
  <span className="text-white text-[16px] font-bold leading-none">B</span>
</div>
```

Update active state in collapsed icon buttons — change `bg-white/10` and `before:bg-primary` to Emerald:

```typescript
isSectionActive(section)
  ? 'bg-emerald-500/15 text-emerald-300 before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:bg-emerald-500 before:rounded-r-full'
  : 'text-white/35 hover:text-white/70 hover:bg-white/[0.06]',
```

- [ ] **Step 6: Update MobileSidebarContent with same Navy gradient**

In `MobileSidebarContent`, update root className (line 390):

```typescript
className="w-full h-full flex flex-col bg-gradient-to-b from-[#1e3a5f] via-[#162d4a] to-[#0f2035]"
```

Apply the same logo and user info changes as ExpandedSidebar.

- [ ] **Step 7: Update popover styling in CollapsedSidebar**

Change PopoverContent active item colors (line 193) from `bg-primary/10 text-primary` to:

```typescript
isItemActive(item.path)
  ? 'bg-emerald-50 text-emerald-700'
  : 'text-foreground/75 hover:text-emerald-700 hover:bg-emerald-50/50',
```

- [ ] **Step 8: Verify sidebar visually**

Run dev server, check:
- Expanded sidebar: Navy gradient, Emerald active state, user info below logo
- Collapsed sidebar: same gradient, Emerald active icons
- Mobile: sheet sidebar with same styling
- Toggle collapse/expand still works

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx
git commit -m "style: rewrite sidebar — Navy gradient, Emerald active states, user info top"
```

---

### Task 3: Update TopBar

**Files:**
- Modify: `apps/web/src/components/layout/TopBar.tsx`

Add breadcrumb, update search styling, add company filter badge.

- [ ] **Step 1: Update TopBar header styling**

Change the header className from the current `sticky top-0 z-10 h-[60px] bg-background/95 backdrop-blur-md border-border/50` to:

```typescript
className="sticky top-0 z-10 h-[60px] bg-white dark:bg-card border-b border-[#e2e8f0] dark:border-border"
```

- [ ] **Step 2: Add breadcrumb to left side**

Import `useLocation` and add breadcrumb rendering. Replace the left section content with:

```tsx
<div className="flex items-center gap-2">
  {/* Hamburger (mobile only) */}
  {isMobile && (
    <Button variant="ghost" size="icon" className="size-9 rounded-lg" onClick={() => setMobileSidebarOpen(true)}>
      <Menu className="size-5" />
    </Button>
  )}
  {/* Breadcrumb */}
  <nav className="flex items-center gap-1.5 text-xs">
    <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">หน้าหลัก</Link>
    <span className="text-muted-foreground/40">/</span>
    <span className="text-foreground font-medium">{pageTitle}</span>
  </nav>
</div>
```

Add a `pageTitle` derived from `pathname`:

```typescript
const { pathname } = useLocation();
const pageTitle = useMemo(() => {
  const map: Record<string, string> = {
    '/': 'Dashboard', '/pos': 'POS', '/customers': 'ลูกค้า',
    '/contracts': 'สัญญา', '/payments': 'ชำระเงิน', '/stock': 'สต็อก',
    '/overdue': 'ค้างชำระ', '/settings': 'ตั้งค่า', '/users': 'ผู้ใช้',
  };
  return map[pathname] || pathname.split('/').pop()?.replace(/-/g, ' ') || 'Dashboard';
}, [pathname]);
```

- [ ] **Step 3: Update search button styling**

Change search button to a styled bar:

```tsx
<button
  onClick={() => openCommandPalette()}
  className="hidden md:flex items-center gap-2 h-9 px-3 rounded-md bg-[#f1f5f9] dark:bg-muted text-muted-foreground text-xs hover:bg-[#e2e8f0] transition-colors min-w-[180px]"
>
  <Search className="size-3.5 text-[#94a3b8]" strokeWidth={1.75} />
  <span className="text-[#94a3b8]">ค้นหา... (⌘K)</span>
</button>
```

- [ ] **Step 4: Update avatar gradient**

Change avatar from `from-primary/40 to-primary/20` to:

```typescript
className="size-8 rounded-full bg-gradient-to-br from-[#1e3a5f] to-[#059669] flex items-center justify-center shrink-0"
```

- [ ] **Step 5: Update icon strokeWidth**

For all Lucide icons in TopBar, add `strokeWidth={1.75}` prop.

- [ ] **Step 6: Verify TopBar**

Check: breadcrumb appears, search bar is styled, avatar uses Navy→Emerald gradient, notification count badge visible.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/TopBar.tsx
git commit -m "style: update TopBar — breadcrumb, styled search, Navy+Emerald avatar"
```

---

### Task 4: Create PageHeader Gradient Component

**Files:**
- Modify: `apps/web/src/components/ui/PageHeader.tsx`

Transform from simple text header to gradient banner.

- [ ] **Step 1: Rewrite PageHeader component**

Replace the entire file with:

```tsx
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
  /** Show gradient banner (default true). Set false for plain style. */
  gradient?: boolean;
  /** Back button handler — shows ← button when provided */
  onBack?: () => void;
  /** Status badge next to title */
  badge?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  icon,
  action,
  breadcrumb,
  gradient = true,
  onBack,
  badge,
  className,
}: PageHeaderProps) {
  if (!gradient) {
    // Plain header (legacy compatibility)
    return (
      <div className={cn('flex flex-col gap-2 pb-6 lg:pb-7.5', className)}>
        {breadcrumb}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            {icon}
            <div>
              <h1 className="text-xl font-bold text-foreground">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="flex items-center gap-2.5">{action}</div>}
        </div>
      </div>
    );
  }

  // Gradient banner
  return (
    <div
      className={cn(
        'bg-gradient-to-r from-[#1e3a5f] via-[#234b73] to-[#059669]',
        'px-6 lg:px-8 py-5 lg:py-6 -mx-5 lg:-mx-7 -mt-5 mb-6',
        'text-white',
        className,
      )}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center justify-center size-8 rounded-md bg-white/10 border border-white/15 hover:bg-white/20 transition-colors"
              aria-label="กลับ"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          {icon}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl lg:text-[22px] font-bold">{title}</h1>
              {badge}
            </div>
            {subtitle && (
              <p className="text-xs text-white/60 mt-1">{subtitle}</p>
            )}
          </div>
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify PageHeader renders**

Import and use `<PageHeader title="Dashboard" subtitle="ภาพรวมธุรกิจ" />` in DashboardPage temporarily to verify gradient renders.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/PageHeader.tsx
git commit -m "feat: rewrite PageHeader — gradient banner with back button + badge support"
```

---

### Task 5: Update MainLayout

**Files:**
- Modify: `apps/web/src/components/layout/MainLayout.tsx`

Update main content area background and padding to match Metronic style.

- [ ] **Step 1: Update main content area**

Change the `<main>` tag className (line 76-78) to use `#f8fafc` background:

```tsx
<main
  id="main"
  tabIndex={-1}
  className="flex-1 grow bg-[#f8fafc] dark:bg-background focus-visible:outline-hidden"
  key={pathname}
>
  <div className="px-5 lg:px-7 pt-0 pb-20 lg:pb-8 animate-fadeIn">
    <Outlet />
  </div>
</main>
```

Note: removed `pt-5` from main since PageHeader gradient now extends to the top.

- [ ] **Step 2: Verify layout**

Check: content area has light gray background, sidebar + topbar + content compose correctly, mobile still works.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/MainLayout.tsx
git commit -m "style: update MainLayout — light gray content bg, adjust padding for gradient header"
```

---

## Phase 2: Core Components

### Task 6: Update Button Variants

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`

- [ ] **Step 1: Update primary variant colors**

In the CVA variants, change `primary` variant from blue to Emerald:

```typescript
primary: 'bg-[#059669] text-white hover:bg-[#047857] active:bg-[#065f46] shadow-[0_2px_8px_rgba(5,150,105,0.25)]',
```

- [ ] **Step 2: Add secondary-navy variant**

Add a new variant for Navy buttons:

```typescript
'secondary-navy': 'bg-[#1e3a5f] text-white hover:bg-[#162d4a] active:bg-[#0f2035]',
```

- [ ] **Step 3: Update mono variant to use Navy tint**

```typescript
mono: 'bg-[#f0f5ff] text-[#1e3a5f] border border-[#d6e4ff] hover:bg-[#d6e4ff]',
```

- [ ] **Step 4: Update focus ring color**

Change the base focus styles to use Emerald ring:

```typescript
'focus-visible:ring-2 focus-visible:ring-[#059669]/30 focus-visible:ring-offset-2',
```

- [ ] **Step 5: Verify buttons across the app**

Check: primary buttons are green, login page, POS, contract creation all show Emerald CTA.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/button.tsx
git commit -m "style: update button variants — Emerald primary, Navy secondary"
```

---

### Task 7: Update Badge Component + Status Badges

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx`
- Modify: `apps/web/src/lib/status-badges.ts`

- [ ] **Step 1: Update badge primary variant**

In `badge.tsx`, update the `primary` variant default appearance to use Navy:

```typescript
primary: 'bg-[#1e3a5f] text-white border-transparent',
```

And primary light:

```typescript
{ variant: 'primary', appearance: 'light' }: 'bg-[#f0f5ff] text-[#1e3a5f] border-transparent',
```

- [ ] **Step 2: Update badge info variant to Navy**

```typescript
info: 'bg-[#1e3a5f] text-white border-transparent',
{ variant: 'info', appearance: 'light' }: 'bg-[#f0f5ff] text-[#1e3a5f] border-transparent',
```

- [ ] **Step 3: Update badge to use rounded-full by default**

Change the base badge class from `rounded-md` to `rounded-full` for pill shape:

```typescript
'rounded-full',
```

- [ ] **Step 4: Update status-badges.ts info/primary mappings**

In `status-badges.ts`, the existing maps use `variant: 'primary'` and `variant: 'info'` which will automatically pick up the new Navy colors. No code changes needed here — the color change cascades from badge.tsx.

Verify that Draft status shows Navy (was using `info` variant).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/badge.tsx apps/web/src/lib/status-badges.ts
git commit -m "style: update badges — Navy primary/info, pill shape (rounded-full)"
```

---

### Task 8: Update Card Component

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx`

- [ ] **Step 1: Update default card shadow**

Change the default Card variant shadow from `shadow-card` to the new Navy-tinted shadow:

```typescript
default: 'bg-card shadow-[0_1px_3px_rgba(30,58,95,0.08),0_1px_2px_rgba(30,58,95,0.04)] rounded-[10px] dark:border dark:border-border',
```

- [ ] **Step 2: Update CardHeader border**

Change `border-b border-border` to:

```typescript
'border-b border-[#f1f5f9] dark:border-border'
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/card.tsx
git commit -m "style: update card — Navy-tinted shadow, subtle border"
```

---

### Task 9: Update Input Focus Ring

**Files:**
- Modify: `apps/web/src/components/ui/input.tsx`

- [ ] **Step 1: Update input focus styles**

In the input base styles, change focus ring from primary to Emerald:

```typescript
'focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/10',
```

Add error state:

```typescript
'aria-[invalid=true]:border-red-300 aria-[invalid=true]:bg-red-50 aria-[invalid=true]:ring-red-500/10',
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/input.tsx
git commit -m "style: update input — Emerald focus ring"
```

---

### Task 10: Update Modal Overlay

**Files:**
- Modify: `apps/web/src/components/ui/Modal.tsx`

- [ ] **Step 1: Update overlay color**

If the Dialog component has an overlay, change its background to Navy-tinted:

Find the overlay/backdrop className and change to:

```typescript
className="bg-[#0f2035]/60 backdrop-blur-sm"
```

Also update the dialog container shadow:

```typescript
className="shadow-[0_10px_25px_rgba(30,58,95,0.12),0_4px_10px_rgba(30,58,95,0.06)]"
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/Modal.tsx
git commit -m "style: update modal — Navy-tinted overlay"
```

---

### Task 11: Update MobileBottomNav

**Files:**
- Modify: `apps/web/src/components/layout/MobileBottomNav.tsx`

- [ ] **Step 1: Update active state indicator**

Change the active indicator from `bg-primary` to Emerald:

```typescript
// Active indicator bar
<div className="w-8 h-[2.5px] bg-[#059669] rounded-full" />
```

Change active text color:

```typescript
isActive ? 'text-[#059669]' : 'text-muted-foreground'
```

- [ ] **Step 2: Update icon strokeWidth**

Add `strokeWidth={1.75}` to all Lucide icons in the nav.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/MobileBottomNav.tsx
git commit -m "style: update MobileBottomNav — Emerald active state, thinner icons"
```

---

## Phase 3: Apply PageHeader to Key Pages

### Task 12: Add Gradient PageHeader to Dashboard

**Files:**
- Modify: `apps/web/src/pages/DashboardPage/index.tsx`

- [ ] **Step 1: Import and add PageHeader**

```tsx
import PageHeader from '@/components/ui/PageHeader';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
```

Add at the top of the return:

```tsx
<PageHeader
  title="Dashboard"
  subtitle={`ภาพรวมธุรกิจ BESTCHOICE — ${new Date().toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}`}
  action={
    <Button variant="ghost" size="sm" className="bg-white/10 border border-white/15 text-white hover:bg-white/20">
      <Download className="size-4 mr-1.5" strokeWidth={1.75} />
      Export
    </Button>
  }
/>
```

Remove any existing page title section.

- [ ] **Step 2: Verify Dashboard**

Check: gradient header appears, KPI cards display correctly below, no layout breaks.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/DashboardPage/index.tsx
git commit -m "feat: add gradient PageHeader to Dashboard"
```

---

### Task 13: Add PageHeader to List Pages (batch)

**Files:**
- Modify: Key list pages — one by one

- [ ] **Step 1: ContractsPage**

Add gradient PageHeader with title "สัญญาทั้งหมด", subtitle with count, + Create button.

- [ ] **Step 2: CustomersPage**

Add gradient PageHeader with title "ลูกค้า".

- [ ] **Step 3: PaymentsPage**

Add gradient PageHeader with title "การชำระเงิน".

- [ ] **Step 4: StockPage**

Add gradient PageHeader with title "สต็อกสินค้า".

- [ ] **Step 5: OverduePage**

Add gradient PageHeader with title "ค้างชำระ".

- [ ] **Step 6: Verify all list pages**

Open each page, verify gradient header renders, actions work.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ContractsPage.tsx apps/web/src/pages/CustomersPage.tsx apps/web/src/pages/PaymentsPage/ apps/web/src/pages/StockPage/ apps/web/src/pages/OverduePage.tsx
git commit -m "feat: add gradient PageHeader to key list pages"
```

---

### Task 14: Add PageHeader to Detail Pages

**Files:**
- Modify: Key detail pages

- [ ] **Step 1: ContractDetailPage**

Add gradient PageHeader with back button, contract number as title, status badge, and action buttons (Edit, Record Payment).

```tsx
<PageHeader
  title={contract.contractNumber}
  subtitle={`${contract.customer.name} — ${contract.product.name}`}
  onBack={() => navigate('/contracts')}
  badge={<ContractStatusBadge status={contract.status} />}
  action={...}
/>
```

- [ ] **Step 2: CustomerDetailPage**

Similar pattern with customer name and back button.

- [ ] **Step 3: Verify detail pages**

Check back button works, badge displays, gradient looks good.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ContractDetailPage.tsx apps/web/src/pages/CustomersPage.tsx
git commit -m "feat: add gradient PageHeader to detail pages — back button + status badge"
```

---

### Task 15: Run TypeScript Check + Visual Verification

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: Fix any TypeScript errors**

If errors found, fix them.

- [ ] **Step 3: Visual walkthrough**

Open the app, navigate through:
1. Login page
2. Dashboard — gradient header, KPI cards
3. Contracts list — gradient header, table, badges
4. Contract detail — back button, status badge
5. POS page — buttons are Emerald
6. Mobile view — bottom nav Emerald, sidebar Navy gradient
7. Dark mode — verify colors work
8. Sidebar collapse/expand — Navy gradient maintained

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors from UI overhaul"
```

---

## Phase 4: Remaining Pages (batch by pattern)

### Task 16: Apply PageHeader to All Remaining List Pages

Apply the gradient PageHeader pattern to every remaining list page that doesn't have it yet. This includes:

- SalesHistoryPage, ReceiptsPage, SuppliersPage, BranchesPage, UsersPage, AuditLogsPage, CommissionsPage, TaxReportsPage, ExpensesPage, RepossessionsPage, TradeInPage, PromotionsPage, NotificationsPage, StockTransfersPage, StockAlertsPage, StockAdjustmentsPage, StockCountPage, PurchaseOrdersPage, CreditChecksPage, ExchangePage, BroadcastPage, RichMenuPage, and all remaining pages.

For each page:
1. Import PageHeader
2. Add gradient header with appropriate title/subtitle/actions
3. Remove old title section

- [ ] **Step 1: Batch update all remaining list pages**
- [ ] **Step 2: Run type check**
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/
git commit -m "feat: add gradient PageHeader to all remaining pages"
```

---

### Task 17: Final Verification + Cleanup

- [ ] **Step 1: Run full type check**

```bash
./tools/check-types.sh all
```

- [ ] **Step 2: Run linter**

```bash
cd apps/web && npx eslint src/ --max-warnings=0
```

- [ ] **Step 3: Start dev server and full visual walkthrough**

Navigate every major page, verify:
- Gradient headers render correctly
- Sidebar Navy gradient with Emerald active
- TopBar breadcrumb working
- Buttons are Emerald (primary) and Navy (secondary)
- Badges are pill-shaped
- Cards have Navy-tinted shadows
- Input focus rings are Emerald
- Modal overlay is Navy-tinted
- Mobile bottom nav has Emerald active
- Dark mode works across all changes

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "style: final polish and cleanup for Metronic UI overhaul"
```
