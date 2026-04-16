# shadcn/ui Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BESTCHOICE frontend from Navy+Emerald Metronic-style to Minimal Zinc + Emerald Accent (shadcn/ui aesthetic) — zinc neutral base, emerald accent on interactive elements, dark zinc sidebar.

**Architecture:** Top-down — change CSS variables first (instant impact on all pages via tokens), then fix components with hardcoded colors, then fix layouts, then fix pages. Each phase produces a working app. All changes are frontend-only; backend, Prisma, routing, and business logic remain untouched.

**Tech Stack:** React 19, Tailwind CSS v4 (CSS-in-CSS `@theme`), Radix UI, shadcn/ui components, CVA, lucide-react

**Spec:** `docs/superpowers/specs/2026-04-16-shadcn-ui-redesign.md`

---

## Phase 1: Foundation (Theme + Components + Layout)

### Task 1: CSS Variables — Light Mode

**Files:**
- Modify: `apps/web/src/index.css:272-335` (`:root` block)

- [ ] **Step 1: Replace `:root` CSS variables**

Replace the entire `:root` block (lines 274-335) with:

```css
  :root {
    /* Minimal Zinc + Emerald Accent */
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    /* Primary: Emerald (Wood element) */
    --primary: 160 84% 39%;
    --primary-foreground: 0 0% 100%;
    /* Secondary/Muted/Accent: zinc neutral */
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    /* Destructive */
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    /* Semantic */
    --success: 142 71% 45%;
    --success-foreground: 0 0% 100%;
    --warning: 38 92% 50%;
    --warning-foreground: 0 0% 100%;
    --info: 199 89% 48%;
    --info-foreground: 0 0% 100%;
    /* Border */
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 160 84% 39%;
    --radius: 0.5rem;
    /* Sidebar — White/Light */
    --sidebar-bg: 0 0% 100%;
    --sidebar-fg: 240 10% 3.9%;
    --sidebar-active: 160 84% 39%;
    --sidebar-hover: 240 4.8% 95.9%;
    --sidebar-border: 240 5.9% 90%;
    /* Charts — emerald-led */
    --chart-1: 160 84% 39%;
    --chart-2: 240 5% 64.9%;
    --chart-3: 48 96% 53%;
    --chart-4: 0 84% 60%;
    --chart-5: 271 91% 65%;
    /* Tiptap editor colors (keep as-is) */
    --color-editor-text: #1a1a1a;
    --color-editor-heading: #111;
    --color-editor-subheading: #222;
    --color-editor-blockquote-border: #d1d5db;
    --color-editor-blockquote-text: #4b5563;
    --color-editor-variable-bg: #d1fae5;
    --color-editor-variable-text: #047857;
    --color-editor-placeholder: #9ca3af;
  }
```

- [ ] **Step 2: Verify light mode in browser**

Run: `cd apps/web && npm run dev`
Open: `http://localhost:5173`
Expected: Background is white (not gray-blue), primary buttons are emerald, sidebar is dark zinc

---

### Task 2: CSS Variables — Dark Mode

**Files:**
- Modify: `apps/web/src/index.css:337-378` (`.dark` block)

- [ ] **Step 1: Replace `.dark` CSS variables**

Replace the entire `.dark` block (lines 337-378) with:

```css
  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 240 10% 3.9%;
    --popover-foreground: 0 0% 98%;
    /* Primary: Emerald (same in dark) */
    --primary: 160 84% 39%;
    --primary-foreground: 0 0% 100%;
    /* Secondary/Muted/Accent: zinc-800 */
    --secondary: 240 3.7% 15.9%;
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
    /* Border: zinc-800 */
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 160 84% 39%;
    /* Sidebar — dark mode */
    --sidebar-bg: 240 3.7% 15.9%;
    --sidebar-fg: 0 0% 95%;
    --sidebar-active: 160 84% 39%;
    --sidebar-hover: 240 3.7% 20%;
    --sidebar-border: 240 3.7% 15.9%;
    --chart-1: 160 84% 45%;
    --chart-2: 240 5% 50%;
    --chart-3: 48 96% 53%;
    --chart-4: 0 84% 60%;
    --chart-5: 271 91% 65%;
  }
```

- [ ] **Step 2: Toggle dark mode in browser and verify**

Expected: Dark background, emerald primary, sidebar blends naturally

---

### Task 3: CSS Theme Block + Utilities Cleanup

**Files:**
- Modify: `apps/web/src/index.css:11-270` (`@theme` block + utilities)

- [ ] **Step 1: Update primary color scale from Navy to Emerald**

Replace lines 45-65 (color scales in `@theme`):

```css
  --color-primary-50: #ecfdf5;
  --color-primary-100: #d1fae5;
  --color-primary-200: #a7f3d0;
  --color-primary-300: #6ee7b7;
  --color-primary-400: #34d399;
  --color-primary-500: #10b981;
  --color-primary-600: #059669;
  --color-primary-700: #047857;
  --color-primary-800: #065f46;
  --color-primary-900: #064e3b;
  --color-primary-950: #022c22;
```

Remove old accent scale (lines 56-65 `--color-accent-*`) — no longer needed since accent = zinc.

- [ ] **Step 2: Remove hero gradient variables and sidebar-dark**

Remove from `@theme`:
```css
  --color-sidebar-dark: #162d4a;  /* line 122 — remove */
```

Remove from `:root`:
```css
  /* Remove hero gradient colors (lines 320-325) */
  --color-hero-1 through --color-hero-5
```

- [ ] **Step 3: Update shadow tokens — remove Navy rgba**

Replace shadow tokens (lines 136-141):
```css
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06);
  --shadow-sidebar: 4px 0 20px rgba(0, 0, 0, 0.15);
  --shadow-topbar: 0 1px 0 rgba(0, 0, 0, 0.05);
  --shadow-modal: 0 10px 25px rgba(0, 0, 0, 0.12), 0 4px 10px rgba(0, 0, 0, 0.06);
```

- [ ] **Step 4: Update utility classes**

Replace `bg-hero-gradient` utility (lines 237-246):
```css
@utility bg-hero-gradient {
  /* Deprecated — no longer used. Kept for backwards compat. */
  background: hsl(var(--primary));
}
```

Update `stat-card` and `kt-separator` comments (lines 262-269):
```css
@utility stat-card {
  @apply bg-card rounded-xl border border-border p-5 transition-shadow hover:shadow-md;
}

@utility kt-separator {
  @apply border-t border-border my-5;
}
```

Update Metronic comment (line 272):
```css
/* ── shadcn/ui Theme Variables — Minimal Zinc + Emerald Accent ─ */
```

Update base styles comment (line 427):
```css
  /* ── Base Styles ───────────────── */
```

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(ui): migrate theme to Minimal Zinc + Emerald Accent"
```

---

### Task 4: Thai Font — Noto Sans Thai → IBM Plex Sans Thai

**Files:**
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Replace Google Fonts import (line 2)**

```
Before: @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+Thai:wght@300;400;500;600;700&display=swap')
After:  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap')
```

- [ ] **Step 2: Update font-family declarations in `@theme` (line 12-13)**

```
Before:
  --font-sans: 'Inter', 'Noto Sans Thai', system-ui, -apple-system, sans-serif;
  --font-sarabun: 'Noto Sans Thai', sans-serif;

After:
  --font-sans: 'Inter', 'IBM Plex Sans Thai', system-ui, -apple-system, sans-serif;
  --font-sarabun: 'IBM Plex Sans Thai', sans-serif;
```

- [ ] **Step 3: Update body font-family (line 430-431)**

```
Before: 'Inter', 'Noto Sans Thai', system-ui, ...
After:  'Inter', 'IBM Plex Sans Thai', system-ui, ...
```

- [ ] **Step 4: Update all other `Noto Sans Thai` references in index.css**

Replace all remaining `'Noto Sans Thai'` with `'IBM Plex Sans Thai'` (lines 254, 456, 562)

- [ ] **Step 5: Update Google Fonts comment (line 1)**

```
Before: /* ── Google Fonts: Inter + Noto Sans Thai ── */
After:  /* ── Google Fonts: Inter + IBM Plex Sans Thai ── */
```

- [ ] **Step 6: Verify in browser — Thai text renders with IBM Plex Sans Thai**

Open any page with Thai text (e.g., login page) and verify:
- Thai characters look clean and professional
- Thai and English text have similar x-height and weight
- No font loading flash (FOUT)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(ui): switch Thai font from Noto Sans Thai to IBM Plex Sans Thai"
```

---

### Task 5: Button Component (was Task 4)

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`

- [ ] **Step 1: Replace hardcoded colors in button variants**

Replace `primary` variant (line 12):
```
Before: 'bg-[#059669] text-white hover:bg-[#047857] active:bg-[#065f46] shadow-[0_2px_8px_rgba(5,150,105,0.25)]'
After:  'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 shadow-sm'
```

Replace `mono` variant (line 13):
```
Before: 'bg-[#f0f5ff] text-[#1e3a5f] border border-[#d6e4ff] hover:bg-[#d6e4ff]'
After:  'bg-muted text-foreground border border-border hover:bg-accent'
```

Replace focus rings (lines 53-54):
```
Before: 'focus-visible:ring-2 focus-visible:ring-[#059669]/30 focus-visible:ring-offset-2'
After:  'focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2'
```

- [ ] **Step 2: Verify buttons in browser**

Open login page → emerald submit button, muted mono buttons

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/button.tsx
git commit -m "feat(ui): button — replace hardcoded colors with tokens"
```

---

### Task 5: Badge Component

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx`

- [ ] **Step 1: Replace hardcoded colors in badge variants**

```
primary:       bg-[#1e3a5f] → bg-primary
info:          bg-[#1e3a5f] → bg-info
primary+light: bg-[#f0f5ff] text-[#1e3a5f] → bg-primary/10 text-primary
info+light:    (same pattern as primary+light)
```

- [ ] **Step 2: Verify badges in browser (dashboard, contracts page)**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "feat(ui): badge — replace hardcoded colors with tokens"
```

---

### Task 6: Remaining UI Components (Tabs, Input, Dialog, Dropdown, Tooltip, Card, Skeleton, EmptyState, PageHeader)

**Files:**
- Modify: `apps/web/src/components/ui/tabs.tsx`
- Modify: `apps/web/src/components/ui/input.tsx`
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/dropdown-menu.tsx`
- Modify: `apps/web/src/components/ui/tooltip.tsx`
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/components/ui/skeleton.tsx`
- Modify: `apps/web/src/components/ui/EmptyState.tsx`

- [ ] **Step 1: Fix each file — replace hardcoded hex colors**

For each file, search and replace:
```
#1e3a5f  → use primary token (bg-primary, text-primary, etc.)
#059669  → use primary token
#047857  → hover:bg-primary/90
#f0f5ff  → bg-primary/5 or bg-muted
#d6e4ff  → bg-primary/10 or border-border
#94a3b8  → text-muted-foreground
#f1f5f9  → bg-muted
#e2e8f0  → border-border
#f8fafc  → bg-background
#cbd5e1  → text-muted-foreground/60
```

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat(ui): UI components — replace all hardcoded colors with tokens"
```

---

### Task 7: PageHeader — Remove Gradient

**Files:**
- Modify: `apps/web/src/components/ui/PageHeader.tsx`

- [ ] **Step 1: Remove gradient banner mode**

Replace the gradient banner section with plain header. The component should always render the plain header:

```tsx
export default function PageHeader({
  title,
  subtitle,
  icon,
  action,
  breadcrumb,
  onBack,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-2 pb-6 lg:pb-7.5', className)}>
      {breadcrumb}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          {onBack && (
            <button
              onClick={onBack}
              className="size-8 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
              aria-label="กลับ"
            >
              <ChevronLeft className="size-5 text-muted-foreground" />
            </button>
          )}
          {icon}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{title}</h1>
              {badge}
            </div>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex items-center gap-2.5">{action}</div>}
      </div>
    </div>
  );
}
```

Remove the `gradient` prop from the interface (keep for backwards compat but ignore it).

- [ ] **Step 2: Verify in browser — all pages should show plain headers**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/PageHeader.tsx
git commit -m "feat(ui): PageHeader — remove gradient, always plain"
```

---

### Task 8: Sidebar

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update role badge map**

```
OWNER:          bg-gradient-to-r from-[#1e3a5f] to-[#059669] → bg-primary text-primary-foreground
BRANCH_MANAGER: bg-[#1e3a5f] → bg-sky-600 text-white
FINANCE_MANAGER:bg-[#059669] → bg-primary text-primary-foreground
ACCOUNTANT:     bg-[#7c3aed] → bg-violet-600 text-white (keep)
SALES:          bg-[#0ea5e9] → bg-sky-500 text-white (keep)
```

- [ ] **Step 2: Change sidebar to White/Light style**

Sidebar background: dark navy → `bg-white border-r border-border` (light mode)
```
item:           text-white/45 → text-muted-foreground
item hover:     bg-white/[0.06] → bg-accent text-foreground
item active:    bg-emerald-500/20 text-emerald-300 → bg-primary/10 text-primary font-semibold
before bar:     before:bg-emerald-500 → before:bg-primary
subTrigger:     text-emerald-400/50 → text-muted-foreground/60
section border: border-white/[0.06] → border-border
```

- [ ] **Step 3: Update sidebar background references**

Replace any remaining `#1e3a5f`, `#059669`, `#162d4a`, `#0f2035` with:
- Light mode: `bg-background` (white) + `border-r border-border`
- Text: `text-foreground` / `text-muted-foreground`
- Logo: `bg-primary` (emerald)

- [ ] **Step 4: Verify sidebar in browser — white bg, emerald active bar + left border accent**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): Sidebar — zinc-900 bg, emerald active, token colors"
```

---

### Task 9: TopBar

**Files:**
- Modify: `apps/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Replace all hardcoded colors**

```
border-[#e2e8f0]  → border-border
from-[#1e3a5f] to-[#059669] (avatar) → bg-primary
bg-[#f1f5f9] hover:bg-[#e2e8f0] (search) → bg-muted hover:bg-accent
text-[#94a3b8] (breadcrumb) → text-muted-foreground
text-[#cbd5e1] (separator) → text-border
```

- [ ] **Step 2: Verify TopBar in browser**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/TopBar.tsx
git commit -m "feat(ui): TopBar — replace hardcoded colors with tokens"
```

---

### Task 10: AuthLayout + MainLayout + MobileBottomNav

**Files:**
- Modify: `apps/web/src/components/layout/AuthLayout.tsx`
- Modify: `apps/web/src/components/layout/MainLayout.tsx`
- Modify: `apps/web/src/components/layout/MobileBottomNav.tsx`

- [ ] **Step 1: AuthLayout — update colors**

```
wrapper: bg-gradient-to-br from-[#f8fafc] to-[#f0f5ff] → bg-background
right panel: from-slate-900 via-slate-800 to-slate-900 → bg-zinc-950
decorative orbs: bg-primary/10 (keep — works with new emerald primary)
```

- [ ] **Step 2: MainLayout — replace hardcoded bg**

```
main: bg-[#f8fafc] → bg-background
```

- [ ] **Step 3: MobileBottomNav — replace hardcoded colors with tokens**

- [ ] **Step 4: Verify login page + mobile layout in browser**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/AuthLayout.tsx apps/web/src/components/layout/MainLayout.tsx apps/web/src/components/layout/MobileBottomNav.tsx
git commit -m "feat(ui): AuthLayout, MainLayout, MobileBottomNav — token colors"
```

---

### Task 11: LoginPage + ForgotPasswordPage + ResetPasswordPage

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/pages/ForgotPasswordPage.tsx`
- Modify: `apps/web/src/pages/ResetPasswordPage.tsx`

- [ ] **Step 1: LoginPage — replace all hardcoded colors**

```
submit button: bg-[#059669] hover:bg-[#047857] → bg-primary hover:bg-primary/90
dev panel: bg-[#f0f5ff] → bg-muted
dev text: text-[#1e3a5f] → text-foreground
dev buttons: border-[#1e3a5f]/20 hover:bg-[#f0f5ff] → border-border hover:bg-accent
logo icon: from-emerald-500 to-emerald-400 → bg-primary (solid)
```

- [ ] **Step 2: ForgotPasswordPage + ResetPasswordPage — same pattern**

- [ ] **Step 3: Verify login flow in browser**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx apps/web/src/pages/ForgotPasswordPage.tsx apps/web/src/pages/ResetPasswordPage.tsx
git commit -m "feat(ui): auth pages — replace hardcoded colors with tokens"
```

---

### Task 12: LandingPage

**Files:**
- Modify: `apps/web/src/pages/LandingPage.tsx`

- [ ] **Step 1: Replace Navy gradients with zinc-950 + emerald accents**

```
Hero section: Navy gradient bg → bg-zinc-950 + emerald glow decorative
CTA buttons: #059669 → bg-primary
Stats cards: Navy bg → bg-zinc-900/50
```

- [ ] **Step 2: Verify in browser**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/LandingPage.tsx
git commit -m "feat(ui): LandingPage — zinc-950 hero + emerald accents"
```

---

### Task 13: Phase 1 Verification

- [ ] **Step 1: Run type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Check for remaining hardcoded colors in Phase 1 files**

Run: `grep -rn '#1e3a5f\|#059669\|#047857\|#065f46\|#f0f5ff\|#234b73\|#162d4a\|#0f2035\|#d6e4ff' apps/web/src/components/ apps/web/src/pages/LoginPage.tsx apps/web/src/pages/LandingPage.tsx apps/web/src/pages/ForgotPasswordPage.tsx apps/web/src/pages/ResetPasswordPage.tsx apps/web/src/index.css`
Expected: Only matches in index.css `@theme` block (primary scale definitions) — no hardcoded colors in components or layout

- [ ] **Step 3: Visual verification in browser**

Check:
- [ ] Login page: emerald button, clean white bg, dark branded panel
- [ ] Dashboard: plain header (no gradient), KPI cards visible
- [ ] Sidebar: dark zinc bg, emerald active bar
- [ ] TopBar: clean, no hardcoded colors
- [ ] Dark mode: works correctly
- [ ] Mobile: bottom nav + sidebar sheet work

---

## Phase 2: Core Pages

### Task 14: Dashboard Page Components

**Files:**
- Modify: `apps/web/src/pages/DashboardPage/index.tsx`
- Modify: `apps/web/src/pages/DashboardPage/components/DashboardKPIs.tsx`
- Modify: `apps/web/src/pages/DashboardPage/components/DashboardCharts.tsx`
- Modify: `apps/web/src/pages/DashboardPage/components/DashboardTables.tsx`

- [ ] **Step 1: DashboardPage — ensure PageHeader uses plain mode**

If PageHeader is called with `gradient={true}`, remove the prop (plain is now default).

- [ ] **Step 2: DashboardKPIs — update KPI card styling**

Replace any hardcoded Navy/Emerald colors with tokens. Use `border-l-4 border-primary` for primary KPI, `border-l-4 border-success` for growth, etc.

- [ ] **Step 3: DashboardCharts — verify chart colors use CSS variables**

Charts should use `--chart-1` through `--chart-5` tokens (already emerald-led after Task 1-2).

- [ ] **Step 4: Verify dashboard in browser**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/DashboardPage/
git commit -m "feat(ui): Dashboard — plain header, token colors"
```

---

### Task 15: Customer + Contract + Payment + Stock + POS + Overdue + Commission Pages

**Files:**
- Modify: All core business pages that use `PageHeader` with `gradient={true}`

These pages mostly use tokens already (67 pages have no hardcoded colors). The main changes:
1. Remove `gradient={true}` prop from PageHeader calls
2. Fix any remaining hardcoded colors in sub-components

- [ ] **Step 1: Search all pages for `gradient={true}` or `gradient=` props**

Run: `grep -rn 'gradient' apps/web/src/pages/`

For each match, remove the `gradient` prop (PageHeader now always renders plain).

- [ ] **Step 2: Search for remaining hardcoded colors in pages/**

Run: `grep -rn '#1e3a5f\|#059669\|#047857\|#f0f5ff' apps/web/src/pages/ --include='*.tsx' --include='*.ts'`

Fix any found in core business pages.

- [ ] **Step 3: Verify key pages in browser**

Check: Customers, Contracts, Payments, Stock, POS, Overdue, Commissions — all should have plain headers and token colors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/
git commit -m "feat(ui): core pages — remove gradient headers, fix hardcoded colors"
```

---

### Task 16: Template Editor + Signing Components

**Files:**
- Modify: `apps/web/src/components/template-editor/preview/DocumentPreview.tsx`
- Modify: `apps/web/src/components/template-editor/preview/BlockRenderer.tsx`
- Modify: `apps/web/src/components/signing/StepContractReview.tsx`

- [ ] **Step 1: Replace hardcoded colors in template editor**

- [ ] **Step 2: Replace hardcoded colors in signing flow**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/template-editor/ apps/web/src/components/signing/
git commit -m "feat(ui): template editor + signing — token colors"
```

---

### Task 17: Phase 2 Verification

- [ ] **Step 1: Run type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Full hardcoded color scan on pages/**

Run: `grep -rn '#1e3a5f\|#059669\|#047857\|#065f46\|#f0f5ff\|#234b73' apps/web/src/pages/ --include='*.tsx' | grep -v 'liff/' | grep -v 'TodosPage'`
Expected: 0 matches (LIFF + Todos are Phase 3)

---

## Phase 3: Remaining Pages

### Task 18: LIFF Pages (9 files)

**Files:**
- Modify: `apps/web/src/pages/liff/LiffContract.tsx`
- Modify: `apps/web/src/pages/liff/LiffEarlyPayoff.tsx`
- Modify: `apps/web/src/pages/liff/LiffFinanceVerify.tsx`
- Modify: `apps/web/src/pages/liff/LiffHistory.tsx`
- Modify: `apps/web/src/pages/liff/LiffNotificationSettings.tsx`
- Modify: `apps/web/src/pages/liff/LiffPayment.tsx`
- Modify: `apps/web/src/pages/liff/LiffProfile.tsx`
- Modify: `apps/web/src/pages/liff/LiffReceipts.tsx`
- Modify: `apps/web/src/pages/liff/LiffRegister.tsx`
- Modify: `apps/web/src/pages/liff/LiffBranches.tsx`

All LIFF pages follow the same pattern — header gradient + hardcoded emerald/navy colors.

- [ ] **Step 1: Replace in all LIFF files**

```
#059669 → bg-primary / text-primary
#1e3a5f → text-foreground / bg-foreground
#047857 → hover:bg-primary/90
#f0f5ff → bg-primary/5
Header gradient → solid bg-primary with white text (or plain)
```

- [ ] **Step 2: Verify LIFF pages in browser (use /liff/ routes)**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/liff/
git commit -m "feat(ui): LIFF pages — replace hardcoded colors with tokens"
```

---

### Task 19: TodosPage (3 files — heaviest: 33 hardcoded colors in TodoForm)

**Files:**
- Modify: `apps/web/src/pages/TodosPage/index.tsx`
- Modify: `apps/web/src/pages/TodosPage/components/TodoForm.tsx`
- Modify: `apps/web/src/pages/TodosPage/components/TodoKanbanView.tsx`

- [ ] **Step 1: TodoForm.tsx — systematic replacement (33 occurrences)**

This is the largest single file. Replace all hardcoded colors with tokens:
```
#059669 → bg-primary
#1e3a5f → text-foreground or bg-primary (context-dependent)
#047857 → hover:bg-primary/90
#f0f5ff → bg-primary/5
```

- [ ] **Step 2: TodoKanbanView.tsx + index.tsx — replace remaining**

- [ ] **Step 3: Verify Todos page in browser — form + kanban view**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/TodosPage/
git commit -m "feat(ui): TodosPage — replace 33+ hardcoded colors with tokens"
```

---

### Task 20: Remaining Pages (Analytics, ChatbotFinance)

**Files:**
- Modify: `apps/web/src/pages/AnalyticsPage.tsx`
- Modify: `apps/web/src/pages/ChatbotFinanceAnalyticsPage.tsx`

- [ ] **Step 1: Replace hardcoded colors**

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/AnalyticsPage.tsx apps/web/src/pages/ChatbotFinanceAnalyticsPage.tsx
git commit -m "feat(ui): Analytics pages — token colors"
```

---

### Task 21: Final Verification

- [ ] **Step 1: Run full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Full codebase hardcoded color scan**

Run: `grep -rn '#1e3a5f\|#059669\|#047857\|#065f46\|#f0f5ff\|#234b73\|#162d4a\|#0f2035\|#d6e4ff' apps/web/src/ --include='*.tsx' --include='*.ts'`
Expected: 0 matches outside of index.css `@theme` primary scale definitions

- [ ] **Step 3: Scan for hardcoded slate colors**

Run: `grep -rn '#94a3b8\|#f1f5f9\|#e2e8f0\|#f8fafc\|#cbd5e1' apps/web/src/ --include='*.tsx' --include='*.ts'`
Expected: 0 matches

- [ ] **Step 4: Visual verification — full app walkthrough**

Run through test plan (`docs/test-plan-ui-overhaul.md`):
- [ ] Login → emerald button, clean white bg
- [ ] Sidebar → dark zinc, emerald active
- [ ] Dashboard → plain header, KPI cards, charts
- [ ] Customers → plain header, table, search
- [ ] Contracts → plain header, tabs, badges
- [ ] POS → emerald CTA buttons
- [ ] Payments → plain header, modals
- [ ] Stock → plain header, tabs
- [ ] LIFF → emerald headers
- [ ] Dark mode → all pages
- [ ] Mobile → bottom nav, sidebar sheet

- [ ] **Step 5: Commit final state**

```bash
git add .
git commit -m "feat(ui): complete shadcn/ui redesign — Minimal Zinc + Emerald Accent"
```
