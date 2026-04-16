# ~~UI Metronic Full Overhaul — Implementation Plan~~

> **SUPERSEDED** — แผนนี้ถูกแทนที่ด้วย implementation plan ใหม่สำหรับ [shadcn-ui-redesign.md](../specs/2026-04-16-shadcn-ui-redesign.md)

---

~~**Goal:** Fully align BESTCHOICE UI with Metronic v9 design system — sync diverged components, migrate all 46 pages to centralized badge system, create reusable business partials, and restructure 10 heavy pages into composable sub-components.~~

**Architecture:** Four sequential phases. Phase 1 syncs the component foundation. Phase 2 is a mechanical batch migration of badge colors. Phase 3 creates reusable partials inspired by Metronic patterns. Phase 4 decomposes monolithic page files into the Metronic Page → Content → Components pattern.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Metronic v9, class-variance-authority, Radix UI, lucide-react

**Metronic Source:** `/Users/iamnaii/Desktop/App/UI COMPONENT/metronic-tailwind-react-demos/typescript/vite/src/`

---

## Phase 1: Component Sync (Foundation)

Sync BESTCHOICE's diverged UI components with Metronic v9 latest. This must be done first because all subsequent phases depend on having correct component variants.

### Task 1.1: Sync Badge Component

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx`

**Why:** BESTCHOICE badge uses simplified `bg-success text-success-foreground` whereas Metronic uses CSS variable fallbacks `bg-[var(--color-success-accent,var(--color-green-500))]` for better theme compatibility. Also import path diverged (`@radix-ui/react-slot` vs `radix-ui`).

**Decision: Keep BESTCHOICE version.** The simplified approach works correctly with our HSL color system defined in `index.css`. Metronic's CSS variable fallback pattern is for themes that may not define `--color-success` — ours always does. No changes needed.

- [x] **Step 1: No action — Badge component is intentionally simplified for our theme**

### Task 1.2: Sync Button Component

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`

**Differences to sync:**
1. `mono` variant: BESTCHOICE `bg-foreground text-background` vs Metronic `bg-zinc-950 text-white dark:bg-zinc-300 dark:text-black` — Metronic is more explicit for dark mode
2. Size `md`: BESTCHOICE `h-[34px]` vs Metronic `h-8.5` (same pixel value, Metronic uses Tailwind spacing)
3. Size `icon`: BESTCHOICE `h-[34px] w-[34px]` vs Metronic `size-8.5`
4. Shadow: BESTCHOICE `shadow-sm` vs Metronic `shadow-xs`
5. `has-data-[arrow=true]:justify-between` missing in BESTCHOICE
6. `mode: 'input'` — Metronic has `data-[state=open]` and `in-data-[invalid=true]` handling
7. `ButtonArrow`: BESTCHOICE `ml-auto -mr-1` vs Metronic `ms-auto -me-0.5` (RTL-friendly)

- [ ] **Step 1: Update button base classes**

Replace the base cva string in `apps/web/src/components/ui/button.tsx`:

```typescript
// Old:
'cursor-pointer group whitespace-nowrap focus-visible:outline-hidden inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0',

// New:
'cursor-pointer group whitespace-nowrap focus-visible:outline-hidden inline-flex items-center justify-center has-data-[arrow=true]:justify-between whitespace-nowrap text-sm font-medium ring-offset-background transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0',
```

- [ ] **Step 2: Update mono variant**

```typescript
// Old:
mono: 'bg-foreground text-background hover:bg-foreground/90 data-[state=open]:bg-foreground/90',

// New:
mono: 'bg-zinc-950 text-white dark:bg-zinc-300 dark:text-black hover:bg-zinc-950/90 dark:hover:bg-zinc-300/90 data-[state=open]:bg-zinc-950/90 dark:data-[state=open]:bg-zinc-300/90',
```

- [ ] **Step 3: Update sizes to use Tailwind spacing tokens**

```typescript
// Old:
md: 'h-[34px] rounded-md px-3 gap-1.5 text-[0.8125rem] leading-snug [&_svg:not([class*=size-])]:size-4',
icon: 'h-[34px] w-[34px] rounded-md [&_svg:not([class*=size-])]:size-4 shrink-0',

// New:
md: 'h-8.5 rounded-md px-3 gap-1.5 text-[0.8125rem] leading-(--text-sm--line-height) [&_svg:not([class*=size-])]:size-4',
icon: 'size-8.5 rounded-md [&_svg:not([class*=size-])]:size-4 shrink-0',
```

- [ ] **Step 4: Update shadow-sm to shadow-xs (6 compound variants for mode: 'default' + 6 for mode: 'icon')**

Search and replace all `'shadow-sm shadow-black/5'` → `'shadow-xs shadow-black/5'` in button.tsx.

- [ ] **Step 5: Update input mode with Metronic's enhanced selectors**

```typescript
// Old:
input: `
    justify-start font-normal hover:bg-background [&_svg]:transition-colors hover:[&_svg]:text-foreground data-[state=open]:bg-background
    focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30
    aria-invalid:border-destructive/60 aria-invalid:ring-destructive/10 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/20
  `,

// New:
input: `
    justify-start font-normal hover:bg-background [&_svg]:transition-colors [&_svg]:hover:text-foreground data-[state=open]:bg-background 
    focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30 
    [[data-state=open]>&]:border-ring [[data-state=open]>&]:outline-hidden [[data-state=open]>&]:ring-[3px] 
    [[data-state=open]>&]:ring-ring/30 
    aria-invalid:border-destructive/60 aria-invalid:ring-destructive/10 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/20
    in-data-[invalid=true]:border-destructive/60 in-data-[invalid=true]:ring-destructive/10  dark:in-data-[invalid=true]:border-destructive dark:in-data-[invalid=true]:ring-destructive/20
  `,
```

- [ ] **Step 6: Update autoHeight compound variants**

```typescript
// Old:
{ size: 'md', autoHeight: true, className: 'h-auto min-h-[34px]' },
{ size: 'sm', autoHeight: true, className: 'h-auto min-h-[28px]' },
{ size: 'lg', autoHeight: true, className: 'h-auto min-h-[40px]' },

// New:
{ size: 'md', autoHeight: true, className: 'h-auto min-h-8.5' },
{ size: 'sm', autoHeight: true, className: 'h-auto min-h-7' },
{ size: 'lg', autoHeight: true, className: 'h-auto min-h-10' },
```

- [ ] **Step 7: Update icon size compound variants**

```typescript
// Old:
{ size: 'md', mode: 'icon', className: 'w-[34px] h-[34px] p-0 [&_svg:not([class*=size-])]:size-4' },
{ size: 'icon', className: 'w-[34px] h-[34px] p-0 [&_svg:not([class*=size-])]:size-4' },

// New:
{ size: 'md', mode: 'icon', className: 'w-8.5 h-8.5 p-0 [&_svg:not([class*=size-])]:size-4' },
{ size: 'icon', className: 'w-8.5 h-8.5 p-0 [&_svg:not([class*=size-])]:size-4' },
```

- [ ] **Step 8: Update input mode sm gap**

```typescript
// Old:
{ mode: 'input', variant: 'outline', size: 'sm', className: 'gap-[5px]' },

// New:
{ mode: 'input', variant: 'outline', size: 'sm', className: 'gap-1.25' },
```

- [ ] **Step 9: Update ButtonArrow to RTL-friendly margins**

```typescript
// Old:
return <Icon data-slot="button-arrow" className={cn('ml-auto -mr-1', className)} {...props} />;

// New:
return <Icon data-slot="button-arrow" className={cn('ms-auto -me-1', className)} {...props} />;
```

- [ ] **Step 10: Run type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 11: Visual spot-check**

Run: `cd apps/web && npm run dev`
Check pages that use buttons heavily: `/pos`, `/customers`, `/contracts`
Verify buttons render correctly in both light and dark mode.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/ui/button.tsx
git commit -m "feat(web): sync Button component with Metronic v9 latest

- Use Tailwind spacing tokens (h-8.5) instead of pixel values (h-[34px])
- Update shadow-sm to shadow-xs for Metronic consistency
- Add has-data-[arrow=true]:justify-between for arrow buttons
- Enhance input mode with data-[state=open] and in-data-[invalid] handling
- Use logical properties (ms/me) for RTL-friendly margins
- Explicit dark mode colors for mono variant

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Sync Dialog Component

**Files:**
- Modify: `apps/web/src/components/ui/dialog.tsx`

**Differences:** Minor — backdrop filter `backdrop-blur-xs` vs `[backdrop-filter:blur(4px)]`, and `right-5` vs `end-5` (RTL). These are cosmetic and low risk.

- [ ] **Step 1: Update close button position from `right-5` to `end-5`**
- [ ] **Step 2: Update text alignment from `sm:text-left` to `sm:text-start`**
- [ ] **Step 3: Run type check**

Run: `./tools/check-types.sh web`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/dialog.tsx
git commit -m "feat(web): sync Dialog with Metronic v9 — RTL-friendly logical properties

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Add Missing Useful Components from Metronic

**Files:**
- Create: `apps/web/src/components/ui/file-upload.tsx`
- Create: `apps/web/src/components/ui/sortable.tsx`
- Create: `apps/web/src/components/ui/input-otp.tsx`

These components exist in Metronic but not in BESTCHOICE, and have real business use cases:
- `file-upload` — product photos, documents, trade-in photos
- `sortable` — kanban boards, priority lists
- `input-otp` — future 2FA, phone verification

- [ ] **Step 1: Copy file-upload.tsx from Metronic**

Source: `/Users/iamnaii/Desktop/App/UI COMPONENT/metronic-tailwind-react-demos/typescript/vite/src/components/ui/file-upload.tsx`
Target: `apps/web/src/components/ui/file-upload.tsx`
Fix imports: `from 'radix-ui'` → `from '@radix-ui/react-slot'`

- [ ] **Step 2: Copy sortable.tsx from Metronic**

Source: `/Users/iamnaii/Desktop/App/UI COMPONENT/metronic-tailwind-react-demos/typescript/vite/src/components/ui/sortable.tsx`
Target: `apps/web/src/components/ui/sortable.tsx`
Fix imports as needed.

- [ ] **Step 3: Copy input-otp.tsx from Metronic**

Source: `/Users/iamnaii/Desktop/App/UI COMPONENT/metronic-tailwind-react-demos/typescript/vite/src/components/ui/input-otp.tsx`
Target: `apps/web/src/components/ui/input-otp.tsx`
Fix imports as needed.

- [ ] **Step 4: Install any missing peer dependencies**

Check each file for imports not in `package.json`. Likely needed:
```bash
cd apps/web && npm install input-otp @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh web`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/file-upload.tsx apps/web/src/components/ui/sortable.tsx apps/web/src/components/ui/input-otp.tsx
git commit -m "feat(web): add file-upload, sortable, input-otp components from Metronic v9

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Status Badge Migration (46 Pages)

Migrate all pages with hardcoded badge colors to use `@/lib/status-badges.ts`. This is mechanical work — each page follows the same pattern:

1. Identify hardcoded color maps/inline colors
2. Add missing status maps to `status-badges.ts` if needed
3. Replace hardcoded colors with `getStatusBadgeProps()` + `Badge` component
4. Remove unused color constants

### Task 2.0: Add Missing Status Maps to status-badges.ts

**Files:**
- Modify: `apps/web/src/lib/status-badges.ts`

Several pages use statuses not yet in the centralized config. Add them first so all migration tasks can reference them.

- [ ] **Step 1: Add the following new status maps**

```typescript
// ─── Audit log action types ──────────────────────────────────────────────────

export const auditActionMap: Record<string, StatusConfig> = {
  CREATE: { variant: 'success', appearance: 'light', label: 'สร้าง' },
  UPDATE: { variant: 'primary', appearance: 'light', label: 'แก้ไข' },
  DELETE: { variant: 'destructive', appearance: 'light', label: 'ลบ' },
  LOGIN: { variant: 'info', appearance: 'light', label: 'เข้าสู่ระบบ' },
  LOGOUT: { variant: 'secondary', label: 'ออกจากระบบ' },
  EXPORT: { variant: 'warning', appearance: 'light', label: 'ส่งออก' },
};

// ─── User / branch active status ──────────────────────────────────────────────

export const enabledStatusMap: Record<string, StatusConfig> = {
  true: { variant: 'success', appearance: 'light', label: 'ใช้งาน' },
  false: { variant: 'secondary', label: 'ปิดใช้งาน' },
};

// ─── Commission statuses ──────────────────────────────────────────────────────

export const commissionStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอจ่าย' },
  PAID: { variant: 'success', appearance: 'light', label: 'จ่ายแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Expense statuses ──────────────────────────────────────────────────────────

export const expenseStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รออนุมัติ' },
  APPROVED: { variant: 'success', appearance: 'light', label: 'อนุมัติแล้ว' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่อนุมัติ' },
  PAID: { variant: 'primary', appearance: 'light', label: 'จ่ายแล้ว' },
};

// ─── Exchange statuses ────────────────────────────────────────────────────────

export const exchangeStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอดำเนินการ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จสิ้น' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Promotion statuses ───────────────────────────────────────────────────────

export const promotionStatusMap: Record<string, StatusConfig> = {
  ACTIVE: { variant: 'success', appearance: 'light', label: 'ใช้งาน' },
  SCHEDULED: { variant: 'info', appearance: 'light', label: 'รอเริ่ม' },
  EXPIRED: { variant: 'secondary', label: 'หมดอายุ' },
  DRAFT: { variant: 'warning', appearance: 'light', label: 'ร่าง' },
};

// ─── Trade-in statuses ────────────────────────────────────────────────────────

export const tradeInStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอประเมิน' },
  APPRAISED: { variant: 'info', appearance: 'light', label: 'ประเมินแล้ว' },
  ACCEPTED: { variant: 'success', appearance: 'light', label: 'รับซื้อ' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่รับซื้อ' },
  COMPLETED: { variant: 'primary', appearance: 'light', label: 'เสร็จสิ้น' },
};

// ─── Receipt statuses ─────────────────────────────────────────────────────────

export const receiptStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอตรวจสอบ' },
  VERIFIED: { variant: 'success', appearance: 'light', label: 'ตรวจแล้ว' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ไม่ผ่าน' },
};

// ─── Notification channel types ───────────────────────────────────────────────

export const notificationChannelMap: Record<string, StatusConfig> = {
  LINE: { variant: 'success', appearance: 'light', label: 'LINE' },
  SMS: { variant: 'info', appearance: 'light', label: 'SMS' },
  EMAIL: { variant: 'primary', appearance: 'light', label: 'Email' },
  PUSH: { variant: 'warning', appearance: 'light', label: 'Push' },
};

// ─── Webhook statuses ─────────────────────────────────────────────────────────

export const webhookStatusMap: Record<string, StatusConfig> = {
  SUCCESS: { variant: 'success', appearance: 'light', label: 'สำเร็จ' },
  FAILED: { variant: 'destructive', appearance: 'light', label: 'ล้มเหลว' },
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอ' },
  RETRYING: { variant: 'info', appearance: 'light', label: 'ลองใหม่' },
};

// ─── Todo priorities ──────────────────────────────────────────────────────────

export const todoPriorityMap: Record<string, StatusConfig> = {
  URGENT: { variant: 'destructive', label: 'เร่งด่วน' },
  HIGH: { variant: 'warning', label: 'สูง' },
  MEDIUM: { variant: 'primary', appearance: 'light', label: 'ปานกลาง' },
  LOW: { variant: 'secondary', label: 'ต่ำ' },
};

// ─── Todo statuses ────────────────────────────────────────────────────────────

export const todoStatusMap: Record<string, StatusConfig> = {
  TODO: { variant: 'secondary', label: 'รอทำ' },
  IN_PROGRESS: { variant: 'primary', appearance: 'light', label: 'กำลังทำ' },
  DONE: { variant: 'success', appearance: 'light', label: 'เสร็จแล้ว' },
  CANCELLED: { variant: 'destructive', appearance: 'light', label: 'ยกเลิก' },
};

// ─── Asset statuses ───────────────────────────────────────────────────────────

export const assetStatusMap: Record<string, StatusConfig> = {
  ACTIVE: { variant: 'success', appearance: 'light', label: 'ใช้งาน' },
  MAINTENANCE: { variant: 'warning', appearance: 'light', label: 'ซ่อมบำรุง' },
  RETIRED: { variant: 'secondary', label: 'เลิกใช้' },
  DISPOSED: { variant: 'destructive', appearance: 'light', label: 'จำหน่ายแล้ว' },
};

// ─── Migration statuses ───────────────────────────────────────────────────────

export const migrationStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'secondary', label: 'รอ' },
  RUNNING: { variant: 'warning', appearance: 'light', label: 'กำลังทำ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จ' },
  FAILED: { variant: 'destructive', appearance: 'light', label: 'ล้มเหลว' },
  SKIPPED: { variant: 'info', appearance: 'light', label: 'ข้าม' },
};

// ─── System health statuses ───────────────────────────────────────────────────

export const systemHealthMap: Record<string, StatusConfig> = {
  healthy: { variant: 'success', appearance: 'light', label: 'ปกติ' },
  degraded: { variant: 'warning', appearance: 'light', label: 'มีปัญหาบางส่วน' },
  down: { variant: 'destructive', label: 'ล่ม' },
};

// ─── Chart of accounts group types ────────────────────────────────────────────

export const accountGroupMap: Record<string, StatusConfig> = {
  ASSET: { variant: 'primary', appearance: 'light', label: 'สินทรัพย์' },
  LIABILITY: { variant: 'warning', appearance: 'light', label: 'หนี้สิน' },
  EQUITY: { variant: 'info', appearance: 'light', label: 'ส่วนของเจ้าของ' },
  REVENUE: { variant: 'success', appearance: 'light', label: 'รายได้' },
  EXPENSE: { variant: 'destructive', appearance: 'light', label: 'ค่าใช้จ่าย' },
};

// ─── Dunning channel types ────────────────────────────────────────────────────

export const dunningChannelMap: Record<string, StatusConfig> = {
  LINE: { variant: 'success', appearance: 'light', label: 'LINE' },
  SMS: { variant: 'info', appearance: 'light', label: 'SMS' },
  CALL: { variant: 'warning', appearance: 'light', label: 'โทร' },
  VISIT: { variant: 'primary', appearance: 'light', label: 'เยี่ยม' },
  LEGAL: { variant: 'destructive', label: 'กฎหมาย' },
};

// ─── Sale types ───────────────────────────────────────────────────────────────

export const saleTypeMap: Record<string, StatusConfig> = {
  CASH: { variant: 'success', appearance: 'light', label: 'เงินสด' },
  INSTALLMENT: { variant: 'primary', appearance: 'light', label: 'ผ่อนชำระ' },
  GFIN: { variant: 'info', appearance: 'light', label: 'GFIN' },
};

// ─── Document statuses ────────────────────────────────────────────────────────

export const documentStatusMap: Record<string, StatusConfig> = {
  DRAFT: { variant: 'secondary', label: 'ร่าง' },
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอ' },
  SIGNED: { variant: 'success', appearance: 'light', label: 'เซ็นแล้ว' },
  EXPIRED: { variant: 'destructive', appearance: 'light', label: 'หมดอายุ' },
};
```

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh web`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/status-badges.ts
git commit -m "feat(web): add 18 new status maps to status-badges.ts for full page migration

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.1: Badge Migration — Batch A (Admin & Settings, 12 pages)

**Files to modify:**
- `apps/web/src/pages/AuditLogsPage.tsx`
- `apps/web/src/pages/BranchesPage.tsx`
- `apps/web/src/pages/UsersPage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/DunningSettingsPage.tsx`
- `apps/web/src/pages/ChannelSettingsPage.tsx`
- `apps/web/src/pages/LineOaSettingsPage.tsx`
- `apps/web/src/pages/SmsSettingsPage.tsx`
- `apps/web/src/pages/InterestConfigPage.tsx`
- `apps/web/src/pages/PricingTemplatesPage.tsx`
- `apps/web/src/pages/SystemStatusPage.tsx`
- `apps/web/src/pages/MigrationPage.tsx`

**Migration pattern for every page:**

```typescript
// 1. Add import
import { getStatusBadgeProps, xxxStatusMap } from '@/lib/status-badges';
import { Badge } from '@/components/ui/badge';

// 2. Replace hardcoded color maps like:
const statusColors = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
};
// ...
<span className={statusColors[status]}>{status}</span>

// With:
const cfg = getStatusBadgeProps(status, xxxStatusMap);
<Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>

// 3. Delete the old statusColors/actionColors constants
```

- [ ] **Step 1: Migrate all 12 pages using the pattern above**

Status map assignments:
| Page | Status Map |
|------|-----------|
| AuditLogsPage | `auditActionMap` |
| BranchesPage | `enabledStatusMap` |
| UsersPage | `enabledStatusMap` |
| SettingsPage | `activeStatusMap` |
| DunningSettingsPage | `dunningChannelMap`, `enabledStatusMap` |
| ChannelSettingsPage | `activeStatusMap` |
| LineOaSettingsPage | `activeStatusMap` |
| SmsSettingsPage | `activeStatusMap` |
| InterestConfigPage | `activeStatusMap` |
| PricingTemplatesPage | `activeStatusMap` |
| SystemStatusPage | `systemHealthMap` |
| MigrationPage | `migrationStatusMap` |

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh web`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): migrate Batch A (12 admin/settings pages) to centralized Badge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Badge Migration — Batch B (Financial & Business, 12 pages)

**Files to modify:**
- `apps/web/src/pages/CommissionsPage.tsx`
- `apps/web/src/pages/ExpensesPage.tsx`
- `apps/web/src/pages/ExchangePage.tsx`
- `apps/web/src/pages/TradeInPage.tsx`
- `apps/web/src/pages/PromotionsPage.tsx`
- `apps/web/src/pages/ReceiptsPage.tsx`
- `apps/web/src/pages/SalesHistoryPage.tsx`
- `apps/web/src/pages/TaxReportsPage.tsx`
- `apps/web/src/pages/ProfitLossPage.tsx`
- `apps/web/src/pages/MonthlyClosePage.tsx`
- `apps/web/src/pages/ChartOfAccountsPage.tsx`
- `apps/web/src/pages/FinancialAuditPage.tsx`

- [ ] **Step 1: Migrate all 12 pages**

| Page | Status Map |
|------|-----------|
| CommissionsPage | `commissionStatusMap`, `contractStatusMap` |
| ExpensesPage | `expenseStatusMap` |
| ExchangePage | `exchangeStatusMap`, `contractStatusMap` |
| TradeInPage | `tradeInStatusMap`, `conditionGradeMap` |
| PromotionsPage | `promotionStatusMap` |
| ReceiptsPage | `receiptStatusMap`, `paymentStatusMap` |
| SalesHistoryPage | `saleTypeMap`, `contractStatusMap` |
| TaxReportsPage | `accountingPeriodStatusMap` |
| ProfitLossPage | `accountingPeriodStatusMap` |
| MonthlyClosePage | `accountingPeriodStatusMap` |
| ChartOfAccountsPage | `accountGroupMap` |
| FinancialAuditPage | `activeStatusMap` |

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh web`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): migrate Batch B (12 financial/business pages) to centralized Badge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Badge Migration — Batch C (Products & Inventory, 6 pages)

**Files to modify:**
- `apps/web/src/pages/ProductDetailPage.tsx`
- `apps/web/src/pages/ProductCreatePage.tsx`
- `apps/web/src/pages/AssetManagementPage.tsx`
- `apps/web/src/pages/SuppliersPage.tsx`
- `apps/web/src/pages/StickerPrintPage.tsx`
- `apps/web/src/pages/ContractVerifyPage.tsx`

- [ ] **Step 1: Migrate all 6 pages**

| Page | Status Map |
|------|-----------|
| ProductDetailPage | `productStatusMap`, `conditionGradeMap` |
| ProductCreatePage | `productStatusMap` |
| AssetManagementPage | `assetStatusMap` |
| SuppliersPage | `activeStatusMap`, `poStatusMap` |
| StickerPrintPage | `productStatusMap` |
| ContractVerifyPage | `contractStatusMap` |

- [ ] **Step 2: Run type check & commit**

```bash
git commit -m "feat(web): migrate Batch C (6 product/inventory pages) to centralized Badge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.4: Badge Migration — Batch D (Communication & Misc, 12 pages)

**Files to modify:**
- `apps/web/src/pages/NotificationsPage.tsx`
- `apps/web/src/pages/TodosPage.tsx`
- `apps/web/src/pages/POSPage.tsx`
- `apps/web/src/pages/CollectionDashboardPage.tsx`
- `apps/web/src/pages/CrmPipelinePage.tsx`
- `apps/web/src/pages/DocumentDashboardPage.tsx`
- `apps/web/src/pages/PDPAPage.tsx`
- `apps/web/src/pages/PaymentCsvImportPage.tsx`
- `apps/web/src/pages/ReportsPage.tsx`
- `apps/web/src/pages/ChatbotFinanceSessionsPage.tsx`
- `apps/web/src/pages/ChatbotFinanceAnalyticsPage.tsx`
- `apps/web/src/pages/WebhooksPage.tsx`

- [ ] **Step 1: Migrate all 12 pages**

| Page | Status Map |
|------|-----------|
| NotificationsPage | `notificationChannelMap`, `activeStatusMap` |
| TodosPage | `todoPriorityMap`, `todoStatusMap` |
| POSPage | `saleTypeMap`, `productStatusMap` |
| CollectionDashboardPage | `collectionStageMap`, `dunningStageMap` |
| CrmPipelinePage | `contractStatusMap` |
| DocumentDashboardPage | `documentStatusMap` |
| PDPAPage | `activeStatusMap` |
| PaymentCsvImportPage | `paymentStatusMap` |
| ReportsPage | `accountingPeriodStatusMap` |
| ChatbotFinanceSessionsPage | `sessionStatusMap` |
| ChatbotFinanceAnalyticsPage | `sessionStatusMap` |
| WebhooksPage | `webhookStatusMap` |

- [ ] **Step 2: Run type check & commit**

```bash
git commit -m "feat(web): migrate Batch D (12 communication/misc pages) to centralized Badge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.5: Badge Migration — Batch E (Remaining + Analytics, 6 pages)

**Files to modify:**
- `apps/web/src/pages/AdsTrackingPage.tsx`
- `apps/web/src/pages/AnalyticsPage.tsx`
- `apps/web/src/pages/ChatAnalyticsPage.tsx`
- `apps/web/src/pages/LandingPage.tsx`
- `apps/web/src/pages/RegisterInvitePage.tsx`
- `apps/web/src/pages/ReceiptVerifyPage.tsx`

- [ ] **Step 1: Migrate all 6 pages**

Note: Analytics/Landing pages may use colors for charts/visualization (not status badges). Only migrate status-related colors — leave chart/visualization colors as-is.

| Page | Status Map |
|------|-----------|
| AdsTrackingPage | `activeStatusMap` (campaign status only) |
| AnalyticsPage | Only status badges, keep chart colors |
| ChatAnalyticsPage | `sessionStatusMap` |
| LandingPage | Keep as-is if only decorative |
| RegisterInvitePage | `activeStatusMap` if applicable |
| ReceiptVerifyPage | `receiptStatusMap` |

- [ ] **Step 2: Run type check & commit**

```bash
git commit -m "feat(web): migrate Batch E (6 remaining pages) to centralized Badge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2.6: Card Wrapper Migration for Remaining Pages

**Files:** ~20 pages that don't yet wrap DataTable/content in Card components.

Check each page: if it has a DataTable or table-like content without Card wrapping, add the standard pattern:

```tsx
<Card>
  <CardHeader>
    <CardTitle>ชื่อ</CardTitle>
    <CardToolbar>
      {/* search/filter/action buttons */}
    </CardToolbar>
  </CardHeader>
  <CardContent className="p-0">
    <DataTable ... />
  </CardContent>
</Card>
```

- [ ] **Step 1: Identify and wrap remaining pages**
- [ ] **Step 2: Run type check & commit**

```bash
git commit -m "feat(web): wrap remaining pages in Card components for Metronic consistency

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: Reusable Business Partials

Create a `partials/` directory with reusable composed patterns, inspired by Metronic's partials library but tailored for BESTCHOICE's business domain.

### Task 3.1: Create StatusCard Partial

**Files:**
- Create: `apps/web/src/components/partials/status-card.tsx`

A card that shows a status KPI — used on dashboards and overview pages (currently duplicated across DashboardPage, CollectionDashboardPage, etc.).

- [ ] **Step 1: Create the component**

```typescript
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { LucideIcon } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-badges';
import { cn } from '@/lib/utils';

interface StatusCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  status?: StatusConfig;
  trend?: { value: number; label: string }; // e.g. +12% MoM
  className?: string;
}

export function StatusCard({ title, value, icon: Icon, status, trend, className }: StatusCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-semibold">{value}</p>
            {trend && (
              <p className={cn('text-xs', trend.value >= 0 ? 'text-success' : 'text-destructive')}>
                {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-lg bg-secondary p-2">
              <Icon className="size-5 text-muted-foreground" />
            </div>
            {status && (
              <Badge variant={status.variant} appearance={status.appearance} size="sm">
                {status.label}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/partials/status-card.tsx
git commit -m "feat(web): add StatusCard partial for KPI display

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.2: Create DetailSection Partial

**Files:**
- Create: `apps/web/src/components/partials/detail-section.tsx`

A labeled section used in detail pages — currently copy-pasted across CustomerDetailPage, ContractDetailPage, ProductDetailPage, etc.

- [ ] **Step 1: Create the component**

```typescript
import { Card, CardHeader, CardTitle, CardContent, CardToolbar } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DetailSectionProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function DetailSection({ title, actions, children, className, noPadding }: DetailSectionProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {actions && <CardToolbar>{actions}</CardToolbar>}
      </CardHeader>
      <CardContent className={cn(noPadding && 'p-0')}>
        {children}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/partials/detail-section.tsx
git commit -m "feat(web): add DetailSection partial for detail page layout

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.3: Create DataTableCard Partial

**Files:**
- Create: `apps/web/src/components/partials/data-table-card.tsx`

Wraps DataTable in a standard Card with search, filters, and toolbar. Currently this pattern is repeated in 40+ pages.

- [ ] **Step 1: Create the component**

```typescript
import { Card, CardHeader, CardTitle, CardDescription, CardToolbar, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataTableCardProps {
  title: string;
  description?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DataTableCard({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ค้นหา...',
  toolbar,
  children,
  className,
}: DataTableCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <CardToolbar>
          <div className="flex items-center gap-2">
            {onSearchChange && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-[200px] pl-8"
                />
              </div>
            )}
            {toolbar}
          </div>
        </CardToolbar>
      </CardHeader>
      <CardContent className="p-0">
        {children}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/partials/data-table-card.tsx
git commit -m "feat(web): add DataTableCard partial — standard Card + search + toolbar wrapper

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.4: Create TimelineActivity Partial

**Files:**
- Create: `apps/web/src/components/partials/timeline-activity.tsx`

Activity timeline for audit logs, contract history, payment history. Currently inlined in OverduePage, ContractDetailPage, CustomerDetailPage.

- [ ] **Step 1: Create the component**

```typescript
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineItemProps {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  description?: string;
  timestamp: string;
  isLast?: boolean;
  children?: React.ReactNode;
}

export function TimelineItem({
  icon: Icon,
  iconClassName,
  title,
  description,
  timestamp,
  isLast = false,
  children,
}: TimelineItemProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary', iconClassName)}>
          <Icon className="size-4" />
        </div>
        {!isLast && <div className="w-px grow bg-border" />}
      </div>
      <div className={cn('pb-6', isLast && 'pb-0')}>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <p className="text-xs text-muted-foreground">{timestamp}</p>
        {children}
      </div>
    </div>
  );
}

interface TimelineProps {
  children: React.ReactNode;
  className?: string;
}

export function Timeline({ children, className }: TimelineProps) {
  return <div className={cn('flex flex-col', className)}>{children}</div>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/partials/timeline-activity.tsx
git commit -m "feat(web): add Timeline + TimelineItem partials for activity feeds

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3.5: Create Partials Barrel Export

**Files:**
- Create: `apps/web/src/components/partials/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
export { StatusCard } from './status-card';
export { DetailSection } from './detail-section';
export { DataTableCard } from './data-table-card';
export { Timeline, TimelineItem } from './timeline-activity';
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/partials/index.ts
git commit -m "feat(web): add partials barrel export

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: Heavy Page Restructuring

Decompose the 10 heaviest pages (700+ lines) into the Metronic-style Page → Content → Components pattern. Each page becomes a folder with focused sub-components under 300 lines.

**Existing pattern to follow (already done in codebase):**
```
StockPage/
  index.tsx          (~300 lines — orchestration, state, tabs)
  components/
    StockDashboardTab.tsx
    StockListTab.tsx
    BulkTransferModal.tsx
```

### Task 4.1: Restructure TodosPage (1,161 lines)

**Files:**
- Create: `apps/web/src/pages/TodosPage/index.tsx`
- Create: `apps/web/src/pages/TodosPage/components/TodoKanbanView.tsx`
- Create: `apps/web/src/pages/TodosPage/components/TodoListView.tsx`
- Create: `apps/web/src/pages/TodosPage/components/TodoForm.tsx`
- Create: `apps/web/src/pages/TodosPage/components/TodoFilters.tsx`
- Delete: `apps/web/src/pages/TodosPage.tsx` (flat file)
- Modify: `apps/web/src/App.tsx` (update import path if needed)

- [ ] **Step 1: Read the current TodosPage.tsx and identify extraction boundaries**
- [ ] **Step 2: Create folder structure**
- [ ] **Step 3: Extract TodoKanbanView — kanban board with drag-drop columns**
- [ ] **Step 4: Extract TodoListView — table/list view of todos**
- [ ] **Step 5: Extract TodoForm — create/edit todo modal**
- [ ] **Step 6: Extract TodoFilters — filter bar (status, priority, assignee)**
- [ ] **Step 7: Create index.tsx — orchestration with view mode toggle + state**
- [ ] **Step 8: Update import in App.tsx if path changed**
- [ ] **Step 9: Run type check**

Run: `./tools/check-types.sh web`

- [ ] **Step 10: Visual test — navigate to /todos and verify both views work**
- [ ] **Step 11: Commit**

```bash
git commit -m "refactor(web): restructure TodosPage into sub-components (1161 → ~300 lines each)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Restructure POSPage (1,015 lines)

**Files:**
- Create: `apps/web/src/pages/POSPage/index.tsx`
- Create: `apps/web/src/pages/POSPage/components/ProductSearch.tsx`
- Create: `apps/web/src/pages/POSPage/components/CustomerSearch.tsx`
- Create: `apps/web/src/pages/POSPage/components/CartPanel.tsx`
- Create: `apps/web/src/pages/POSPage/components/PaymentSummary.tsx`
- Delete: `apps/web/src/pages/POSPage.tsx`

- [ ] **Step 1: Read the current POSPage.tsx and identify extraction boundaries**
- [ ] **Step 2: Create folder structure**
- [ ] **Step 3: Extract ProductSearch — product search/scan with results grid**
- [ ] **Step 4: Extract CustomerSearch — customer lookup/create**
- [ ] **Step 5: Extract CartPanel — current cart items with qty/price editing**
- [ ] **Step 6: Extract PaymentSummary — totals, sale type selector, submit**
- [ ] **Step 7: Create index.tsx — orchestration with shared cart state**
- [ ] **Step 8: Update import in App.tsx**
- [ ] **Step 9: Type check + visual test on /pos**
- [ ] **Step 10: Commit**

```bash
git commit -m "refactor(web): restructure POSPage into sub-components (1015 → ~250 lines each)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: Restructure NotificationsPage (992 lines)

**Files:**
- Create: `apps/web/src/pages/NotificationsPage/index.tsx`
- Create: `apps/web/src/pages/NotificationsPage/components/TemplateManager.tsx`
- Create: `apps/web/src/pages/NotificationsPage/components/NotificationLogTable.tsx`
- Create: `apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx`
- Delete: `apps/web/src/pages/NotificationsPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure NotificationsPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.4: Restructure AssetManagementPage (914 lines)

**Files:**
- Create: `apps/web/src/pages/AssetManagementPage/index.tsx`
- Create: `apps/web/src/pages/AssetManagementPage/components/AssetTable.tsx`
- Create: `apps/web/src/pages/AssetManagementPage/components/AssetForm.tsx`
- Create: `apps/web/src/pages/AssetManagementPage/components/DepreciationPanel.tsx`
- Delete: `apps/web/src/pages/AssetManagementPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure AssetManagementPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.5: Restructure UsersPage (791 lines)

**Files:**
- Create: `apps/web/src/pages/UsersPage/index.tsx`
- Create: `apps/web/src/pages/UsersPage/components/UserTable.tsx`
- Create: `apps/web/src/pages/UsersPage/components/UserForm.tsx`
- Create: `apps/web/src/pages/UsersPage/components/PermissionPanel.tsx`
- Delete: `apps/web/src/pages/UsersPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure UsersPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.6: Restructure SuppliersPage (786 lines)

**Files:**
- Create: `apps/web/src/pages/SuppliersPage/index.tsx`
- Create: `apps/web/src/pages/SuppliersPage/components/SupplierTable.tsx`
- Create: `apps/web/src/pages/SuppliersPage/components/SupplierForm.tsx`
- Delete: `apps/web/src/pages/SuppliersPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure SuppliersPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.7: Restructure ProductDetailPage (760 lines)

**Files:**
- Create: `apps/web/src/pages/ProductDetailPage/index.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/ProductInfo.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/ProductHistory.tsx`
- Create: `apps/web/src/pages/ProductDetailPage/components/ProductPhotos.tsx`
- Delete: `apps/web/src/pages/ProductDetailPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure ProductDetailPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.8: Restructure ProductCreatePage (759 lines)

**Files:**
- Create: `apps/web/src/pages/ProductCreatePage/index.tsx`
- Create: `apps/web/src/pages/ProductCreatePage/components/ProductForm.tsx`
- Create: `apps/web/src/pages/ProductCreatePage/components/SpecificationFields.tsx`
- Create: `apps/web/src/pages/ProductCreatePage/components/PhotoUpload.tsx`
- Delete: `apps/web/src/pages/ProductCreatePage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure ProductCreatePage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.9: Restructure TradeInPage (732 lines)

**Files:**
- Create: `apps/web/src/pages/TradeInPage/index.tsx`
- Create: `apps/web/src/pages/TradeInPage/components/TradeInTable.tsx`
- Create: `apps/web/src/pages/TradeInPage/components/AppraisalForm.tsx`
- Create: `apps/web/src/pages/TradeInPage/components/TradeInFilters.tsx`
- Delete: `apps/web/src/pages/TradeInPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure TradeInPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4.10: Restructure SettingsPage (671 lines)

**Files:**
- Create: `apps/web/src/pages/SettingsPage/index.tsx`
- Create: `apps/web/src/pages/SettingsPage/components/GeneralSettings.tsx`
- Create: `apps/web/src/pages/SettingsPage/components/CompanySettings.tsx`
- Create: `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx`
- Delete: `apps/web/src/pages/SettingsPage.tsx`

- [ ] **Step 1-8: Same pattern as above**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(web): restructure SettingsPage into sub-components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: Final Verification

### Task 5.1: Full Type Check + Visual Audit

- [ ] **Step 1: Run full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Start dev server and spot-check 10 key pages**

Pages to check:
1. `/` (Dashboard)
2. `/customers` (table + badges)
3. `/contracts` (complex badges)
4. `/pos` (restructured)
5. `/stock` (already migrated — regression check)
6. `/settings` (restructured)
7. `/audit-logs` (new badge migration)
8. `/overdue` (existing migration — regression)
9. `/todos` (restructured)
10. `/users` (restructured)

Check for: broken layouts, missing badges, wrong colors, dark mode issues

- [ ] **Step 3: Run E2E tests**

Run: `cd apps/web && npx playwright test`

- [ ] **Step 4: Final commit if any fixes needed**

### Task 5.2: Cleanup

- [ ] **Step 1: Search for remaining hardcoded badge colors**

Grep for patterns like `bg-green-`, `bg-red-`, `text-green-`, `text-red-` in page files.
Exclude: chart colors, decorative backgrounds, non-status usages.

- [ ] **Step 2: Fix any remaining hardcoded colors found**
- [ ] **Step 3: Final commit**

```bash
git commit -m "chore(web): cleanup remaining hardcoded badge colors

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Summary

| Phase | Tasks | Scope | Type |
|-------|-------|-------|------|
| 1: Component Sync | 4 tasks | Badge, Button, Dialog, +3 new components | Foundation |
| 2: Badge Migration | 6 batches | 46 pages + Card wrapping | Mechanical |
| 3: Partials Library | 5 tasks | 4 reusable partials + barrel export | New patterns |
| 4: Page Restructure | 10 tasks | 10 heavy pages → sub-components | Architecture |
| 5: Verification | 2 tasks | Type check + visual audit + E2E | Quality |

**Total: ~27 tasks, ~75 files modified, ~40 files created**

**Parallelization notes:**
- Phase 2 batches (2.1-2.5) can run in parallel after 2.0
- Phase 3 tasks (3.1-3.4) can run in parallel
- Phase 4 tasks (4.1-4.10) can run in parallel
- Phase 1 must complete before Phase 2
- Phase 5 must run last
