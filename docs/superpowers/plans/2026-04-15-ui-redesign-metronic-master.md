# ~~UI Redesign (Metronic) — Master Implementation Plan~~

> **SUPERSEDED** — แผนนี้ถูกแทนที่ด้วย implementation plan ใหม่สำหรับ [shadcn-ui-redesign.md](../specs/2026-04-16-shadcn-ui-redesign.md)

---

~~**Goal:** Redesign all 79 pages and 62 UI components to use Metronic v9 design system with dark mode, consistent design tokens, and mobile-responsive layouts.~~

**Architecture:** Progressive migration — build a Metronic-based component library first, then migrate pages group by group. Old pages remain functional during transition. Each group can be implemented independently after Group 0 (Foundation) is complete.

**Tech Stack:** React 19, Metronic v9 (design reference), Tailwind CSS v4, lucide-react icons, Radix UI primitives (keep for a11y), dark mode via CSS variables

**Scope:** 79 pages, 62 UI components, 7 groups. Estimated 3 months total.

---

## Current State

### Existing UI Components (62 files in `apps/web/src/components/ui/`)
Already have: button, input, select, badge, card, modal (dialog), DataTable, data-grid, breadcrumb, calendar, checkbox, dropdown-menu, form, tabs, tooltip, sheet, popover, separator, skeleton, switch, textarea, toast (sonner), avatar, accordion, alert, chart, command, context-menu, drawer, hover-card, label, navigation-menu, progress, radio-group, scroll-area, slider, table, toggle

**Custom shared components:** PageHeader, EmptyState, ConfirmDialog, KanbanBoard, SearchableSelect, ThaiDateInput, AddressForm, DataTable, Modal, RichTextEditor, animated-counter

**Layout:** MainLayout, TopBar, MobileBottomNav, AuthLayout, SkipLink

### What needs to change
1. **Design tokens** — colors, typography, spacing from Metronic v9 (currently ad-hoc Tailwind)
2. **MainLayout** — Sidebar style, TopBar, dark mode toggle
3. **Component restyling** — Button variants, Badge colors, Card shadows, DataTable style
4. **Page layouts** — Consistent spacing, page headers, content areas
5. **Dark mode** — CSS variable-based theming (not Tailwind `dark:` classes)

### Metronic Template
The repo at `/Users/iamnaii/Desktop/App/metronic-template` is empty. Need to source Metronic v9 design tokens from documentation or purchased theme files. If Metronic files are not available, create a custom design system inspired by Metronic's patterns.

---

## Execution Strategy

### Prerequisite: Metronic Source Files
Before starting Group 0, ensure one of:
1. **Metronic v9 React files** are placed in `/Users/iamnaii/Desktop/App/metronic-template/`
2. **OR** design tokens are manually extracted from Metronic docs/screenshots
3. **OR** decision to create a custom design system inspired by Metronic

### Group Dependencies
```
Group 0 (Foundation) ──→ All other groups (parallel)
                    ├──→ Group 1 (Operations)
                    ├──→ Group 2 (Collections & Inventory)
                    ├──→ Group 3 (Finance & Reports)
                    ├──→ Group 4 (Communication)
                    ├──→ Group 5 (Admin)
                    └──→ Group 6 (LIFF Mobile)
```

Groups 1-6 are independent — can be done in any order or in parallel.

---

## Group 0: Foundation — Design System + Layout

> **This group MUST be completed first.** All other groups depend on it.

### Task 0.1: Design Tokens

**Files:**
- Create: `apps/web/src/styles/tokens.css` — CSS custom properties
- Modify: `apps/web/tailwind.config.ts` — wire tokens to Tailwind
- Modify: `apps/web/src/index.css` — import tokens

- [ ] **Step 1: Create CSS custom properties for light + dark themes**

```css
/* tokens.css */
:root {
  /* Colors — Light theme */
  --color-primary: #1b84ff;
  --color-primary-hover: #056ee9;
  --color-primary-light: #e9f3ff;
  --color-success: #17c653;
  --color-success-light: #dfffea;
  --color-warning: #f6b100;
  --color-warning-light: #fff8dd;
  --color-danger: #f8285a;
  --color-danger-light: #ffeef3;
  --color-info: #7239ea;
  --color-info-light: #f8f5ff;

  /* Gray scale */
  --color-gray-100: #f9f9f9;
  --color-gray-200: #f1f1f4;
  --color-gray-300: #dbdfe9;
  --color-gray-400: #b5b5c3;
  --color-gray-500: #99a1b7;
  --color-gray-600: #78829d;
  --color-gray-700: #4b5675;
  --color-gray-800: #252f4a;
  --color-gray-900: #071437;

  /* Backgrounds */
  --bg-page: #f5f5f5;
  --bg-card: #ffffff;
  --bg-sidebar: #1e1e2d;
  --bg-topbar: #ffffff;

  /* Text */
  --text-primary: var(--color-gray-900);
  --text-secondary: var(--color-gray-600);
  --text-muted: var(--color-gray-500);

  /* Borders */
  --border-color: var(--color-gray-200);
  --border-radius-sm: 0.375rem;
  --border-radius-md: 0.625rem;
  --border-radius-lg: 0.75rem;
  --border-radius-xl: 1rem;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.04), 0 4px 6px rgba(0, 0, 0, 0.05);

  /* Typography */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.8125rem;
  --font-size-base: 0.875rem;
  --font-size-lg: 1rem;
  --font-size-xl: 1.125rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;

  /* Spacing */
  --spacing-page: 1.5rem;
  --spacing-card: 1.25rem;
  --spacing-section: 2rem;

  /* Sidebar */
  --sidebar-width: 265px;
  --sidebar-collapsed-width: 75px;
  --topbar-height: 64px;
}

/* Dark theme */
[data-theme="dark"] {
  --bg-page: #1c1c2e;
  --bg-card: #1e1e2d;
  --bg-sidebar: #151521;
  --bg-topbar: #1e1e2d;

  --text-primary: #ffffff;
  --text-secondary: #a1a5b7;
  --text-muted: #565674;

  --border-color: #2b2b40;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.15);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.2);

  --color-primary-light: #212e48;
  --color-success-light: #1c3238;
  --color-warning-light: #392f28;
  --color-danger-light: #3a2434;
  --color-info-light: #2f264f;

  --color-gray-100: #1b1b29;
  --color-gray-200: #2b2b40;
  --color-gray-300: #3f3f5f;
}
```

- [ ] **Step 2: Wire tokens to Tailwind config**

Update `tailwind.config.ts` to use CSS variables:

```typescript
// In theme.extend:
colors: {
  primary: { DEFAULT: 'var(--color-primary)', hover: 'var(--color-primary-hover)', light: 'var(--color-primary-light)' },
  success: { DEFAULT: 'var(--color-success)', light: 'var(--color-success-light)' },
  warning: { DEFAULT: 'var(--color-warning)', light: 'var(--color-warning-light)' },
  danger: { DEFAULT: 'var(--color-danger)', light: 'var(--color-danger-light)' },
  info: { DEFAULT: 'var(--color-info)', light: 'var(--color-info-light)' },
  gray: {
    100: 'var(--color-gray-100)', 200: 'var(--color-gray-200)', 300: 'var(--color-gray-300)',
    400: 'var(--color-gray-400)', 500: 'var(--color-gray-500)', 600: 'var(--color-gray-600)',
    700: 'var(--color-gray-700)', 800: 'var(--color-gray-800)', 900: 'var(--color-gray-900)',
  },
},
backgroundColor: {
  page: 'var(--bg-page)',
  card: 'var(--bg-card)',
  sidebar: 'var(--bg-sidebar)',
  topbar: 'var(--bg-topbar)',
},
textColor: {
  primary: 'var(--text-primary)',
  secondary: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
},
borderColor: {
  DEFAULT: 'var(--border-color)',
},
```

- [ ] **Step 3: Import tokens + add Inter font**

```css
/* index.css */
@import './styles/tokens.css';
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): Metronic design tokens — colors, typography, spacing, dark mode"
```

### Task 0.2: Theme Provider + Dark Mode Toggle

**Files:**
- Create: `apps/web/src/contexts/ThemeContext.tsx`
- Modify: `apps/web/src/components/layout/TopBar.tsx` — add toggle

- [ ] **Step 1: Create ThemeContext**

```typescript
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({ theme: 'light', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

- [ ] **Step 2: Add dark mode toggle to TopBar**

- [ ] **Step 3: Wrap App with ThemeProvider**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): ThemeProvider + dark mode toggle in TopBar"
```

### Task 0.3: Restyle Core Components

Restyle these existing components to use design tokens (NOT create new ones):

- [ ] **Step 1:** `components/ui/button.tsx` — update variants to use `--color-primary`, add `variant="light"` (soft background)
- [ ] **Step 2:** `components/ui/badge.tsx` — use semantic colors (success/warning/danger/info)
- [ ] **Step 3:** `components/ui/card.tsx` — use `bg-card`, `shadow-sm`, `border`, `rounded-[var(--border-radius-lg)]`
- [ ] **Step 4:** `components/ui/input.tsx` — consistent sizing, focus ring with primary color
- [ ] **Step 5:** `components/ui/data-grid.tsx` — table header bg, row hover, compact mode
- [ ] **Step 6:** `components/ui/dialog.tsx` (Modal) — card-style background, dark mode compatible
- [ ] **Step 7:** Run type check after each change
- [ ] **Step 8:** Commit

```bash
git commit -m "feat(ui): restyle 6 core components with Metronic design tokens"
```

### Task 0.4: MainLayout Redesign

- [ ] **Step 1:** Redesign Sidebar — dark background (`bg-sidebar`), logo, collapsed mode, hover-expand
- [ ] **Step 2:** Redesign TopBar — clean white/dark card, search, notifications, user menu, theme toggle
- [ ] **Step 3:** Content area — `bg-page` background, consistent padding
- [ ] **Step 4:** Breadcrumb — wire to page routes
- [ ] **Step 5:** MobileBottomNav — match sidebar colors
- [ ] **Step 6:** Test responsive (mobile/tablet/desktop)
- [ ] **Step 7:** Commit

```bash
git commit -m "feat(ui): MainLayout redesign — sidebar, topbar, breadcrumb, dark mode"
```

### Task 0.5: PageHeader + Status Badge standardization

- [ ] **Step 1:** Update `PageHeader` component — consistent title, subtitle, action buttons area, breadcrumb
- [ ] **Step 2:** Create status badge tokens (map every status enum to consistent colors):

```typescript
// Status colors (used across all pages)
const statusColors = {
  // Contract
  ACTIVE: 'success', OVERDUE: 'warning', DEFAULT: 'danger', COMPLETED: 'info',
  DRAFT: 'gray', EARLY_PAYOFF: 'info', EXCHANGED: 'gray', CLOSED_BAD_DEBT: 'danger',
  // Payment
  PENDING: 'warning', PAID: 'success', PARTIALLY_PAID: 'info',
  // General
  APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'gray',
};
```

- [ ] **Step 3:** Commit

```bash
git commit -m "feat(ui): PageHeader + standardized status badge colors"
```

**After Group 0 is complete:** All subsequent groups can begin. Each group follows the same pattern: update page imports to use new tokens, restyle with card-based layouts, add dark mode support, test responsive.

---

## Group 1: Operations (14 pages)

| Page | Key changes |
|------|------------|
| DashboardPage | Card-based KPI widgets, chart styling, role-specific layouts with design tokens |
| POSPage | Product grid cards, cart sidebar, payment modal — speed-optimized |
| CustomersPage | DataGrid with status badges, search, filters |
| CustomerDetailPage | Tab layout with cards, contact info, contract list |
| ContractsPage | DataGrid with status badges, branch filter |
| ContractCreatePage/* | Multi-step wizard with progress indicator, form cards |
| ContractDetailPage | Tab layout: info, payments, documents, timeline |
| ContractSignPage | Signing wizard with stepper |
| ContractVerifyPage | Verification card layout |
| PaymentsPage/* | DataGrid with payment status, bulk actions |
| PaymentCsvImportPage | Upload area, preview table, import progress |
| ReceiptsPage | Receipt list with print action |
| SalesHistoryPage | DataGrid with date range filter |
| ContractTemplatesPage | Template cards with preview |

Each page follows the pattern:
1. Replace hardcoded colors with design token classes
2. Use `bg-card` for content areas, `bg-page` for backgrounds
3. Ensure dark mode works
4. Test mobile responsive

---

## Group 2: Collections & Inventory (14 pages)

| Page | Key changes |
|------|------------|
| OverduePage | Kanban board styling, card colors per stage |
| CollectionDashboardPage | KPI cards with design tokens (new from Plan 1) |
| ExchangePage | Form + comparison cards |
| RepossessionsPage | DataGrid with status flow |
| SlipReviewPage (component) | Image viewer + approve/reject buttons |
| StockPage/* | DataGrid with stock levels, low-stock alerts |
| StockTransfersPage | Transfer cards with status |
| StockAlertsPage | Alert cards with severity colors |
| StockCountPage | Count entry form |
| StockAdjustmentsPage | Adjustment log table |
| ProductCreatePage | Form with image upload |
| ProductDetailPage | Product card with photos, specs |
| SuppliersPage + SupplierDetailPage | DataGrid + detail cards |
| PurchaseOrdersPage | PO list with status badges |

---

## Group 3: Finance & Reports (12 pages)

| Page | Key changes |
|------|------------|
| FinanceReceivablePage | DataGrid with status badges |
| FinancePortfolioPage | Portfolio cards |
| CommissionsPage | Commission table + summary cards |
| ExpensesPage | Expense list with category grouping |
| TaxReportsPage | PP30/PND3/PND53 tabs with report cards |
| ProfitLossPage | P&L table with subtotals |
| ChartOfAccountsPage | Tree/table view with account groups |
| FinancialAuditPage | Audit log table |
| MonthlyClosePage | Year grid (new from Plan 2) |
| PeakSyncPage | Sync status cards (new from Plan 2) |
| TradeInPage | Trade-in form + valuation |
| PromotionsPage | Promotion cards with date ranges |
| CreditChecksPage | Check form + result cards |

---

## Group 4: Communication (10 pages)

| Page | Key changes |
|------|------------|
| UnifiedInboxPage | Chat layout (sidebar + main), message bubbles, customer panel |
| ChannelSettingsPage | Channel config cards |
| LineOaSettingsPage | LINE settings form |
| SmsSettingsPage | SMS settings form |
| NotificationsPage | Notification list |
| CannedResponseAdminPage | Response template cards |
| ChatbotFinanceAnalyticsPage | Analytics charts |
| ChatbotFinanceSessionsPage | Session list |
| ChatbotFinanceKnowledgePage | KB article cards |
| ChatbotFinanceLearningPage | Learning log |
| ChatAnalyticsPage | Chat metrics dashboard |
| AdsTrackingPage | Tracking dashboard |

---

## Group 5: Admin (14 pages)

| Page | Key changes |
|------|------------|
| UsersPage | User table with role badges |
| BranchesPage | Branch cards |
| CompanySettingsPage | Company info form |
| SettingsPage | Settings sections |
| DunningSettingsPage | Rule timeline (new from Plan 1) |
| InterestConfigPage | Config form |
| PricingTemplatesPage | Template list |
| AuditLogsPage | Searchable log table |
| SystemStatusPage | System health cards |
| WebhooksPage | Webhook config |
| PDPAPage | Consent management |
| DocumentDashboardPage | Document overview |
| MigrationPage | Migration tools |
| TodosPage | Task list |

---

## Group 6: LIFF + Auth (12 pages)

| Page | Key changes |
|------|------------|
| LoginPage | Centered card, brand styling |
| ForgotPasswordPage | Simple form card |
| ResetPasswordPage | Password form card |
| RegisterInvitePage | Registration form |
| LandingPage | Marketing layout |
| CustomerPortalPage | Customer dashboard |
| ReceiptVerifyPage | Verification card |
| liff/ContractPage | Mobile contract view |
| liff/HistoryPage | Payment history list |
| liff/ProfilePage | Customer profile |
| liff/EarlyPayoffPage | Payoff calculator |
| liff/RegisterPage | LIFF registration |

LIFF pages use **mobile-first design** — full-width cards, large touch targets, bottom navigation.

---

## Execution Plan

Each group becomes its own sub-plan when ready to execute:

```
Group 0 (Foundation)     → 1-2 weeks → BLOCKS everything else
Group 1 (Operations)     → 1-2 weeks → highest daily usage
Group 2 (Collections)    → 1 week    → new pages from Plan 1
Group 3 (Finance)        → 1 week    → new pages from Plan 2
Group 4 (Communication)  → 1 week    → chat system
Group 5 (Admin)          → 1 week    → settings + new from Plan 1
Group 6 (LIFF + Auth)    → 1 week    → customer-facing
```

**Total: ~7-9 weeks** (Groups 1-6 can overlap)

When starting a group, create a detailed sub-plan with exact file paths and code for each page migration. Use the `superpowers:subagent-driven-development` skill to parallelize page migrations within a group.

---

## Testing Strategy

For each page migration:
1. **Type check** — `./tools/check-types.sh web`
2. **Visual check** — open in browser, verify light + dark mode
3. **Mobile check** — resize to 375px width
4. **Regression** — existing E2E tests still pass
5. **A11y** — keyboard navigation, screen reader basics

---

## Success Criteria

| Metric | Before | After |
|--------|--------|-------|
| Design system | None (ad-hoc) | Metronic tokens + shared components |
| Dark mode | Not supported | Full support across all pages |
| Status badge consistency | Inconsistent per page | Single `statusColors` map |
| Component reuse | ~62 components, many one-offs | Standardized variants |
| Mobile responsive | Good (9/10) | Consistent (10/10) |
| Page count | 79 | 79 + new pages from Plans 1-2 |
