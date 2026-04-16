# ~~BESTCHOICE UI Redesign — Autonomous Prompt~~

> **SUPERSEDED** — Prompt นี้ใช้ Metronic direction เก่า
> ดู spec ใหม่ที่ [`docs/superpowers/specs/2026-04-16-shadcn-ui-redesign.md`](../superpowers/specs/2026-04-16-shadcn-ui-redesign.md)
> Direction ใหม่: **Minimal Zinc + Emerald Accent** (shadcn/ui style, ไม่ใช้ Metronic แล้ว)

---

~~คุณคือ Senior UI/UX Developer ที่ต้อง redesign ทุกหน้าของ BESTCHOICE web app ให้ดู professional, สวยงาม, และ consistent ตาม Metronic design system — ทำงาน autonomous จนเสร็จทุกหน้า~~
2. คง business logic, API calls, routing, state management เดิมทั้งหมด
3. ทำให้ทุกหน้า responsive (Desktop + Mobile)
4. รัน TypeScript check + E2E tests หลังทุก phase
5. Commit หลังทุก phase ที่ผ่าน tests

---

## 📁 UI Component Reference Sources (ใช้ทั้ง folder)

### Primary: Metronic v9.4.8 (Tailwind + React — ใช้เป็นหลัก)

#### React UI Components (77 ตัว) — copy/adapt ได้เลย
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-react-starter-kit/typescript/nextjs/components/ui/
```
Components สำคัญ: button, card, input, select, textarea, badge, avatar, tabs, dialog, sheet, drawer, popover, tooltip, dropdown-menu, breadcrumb, pagination, table, data-grid (full-featured), kanban, tree, accordion, stepper, carousel, command, calendar, progress, skeleton, separator, scroll-area, hover-card, alert, alert-dialog, toggle, switch, slider, form, file-upload, chart

#### React Layouts (39 แบบ) — ดู layout patterns
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-react-starter-kit/typescript/nextjs/components/layouts/
```
แต่ละ layout มี: header, sidebar, footer, toolbar, mega-menu, dialogs

#### React Concepts (Real-World Apps) — ⭐ REFERENCE หลักสำหรับ page design
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-react-concepts/typescript/nextjs/app/
```
- **store-inventory/** — dashboard, customer-list, customer-list-details, product-list, product-details, create-product, edit-product, order-list, order-details, order-tracking, current-stock, inbound-stock, outbound-stock, all-stock, per-product-stock, stock-planner, create-category, category-list, category-details, edit-category, manage-variants, create-shipping-label, track-shipping, settings-modal, dark-sidebar, tables
- **crm/** — dashboard, contacts, companies, company, tasks, notes, config
- **calendar/** — calendar views
- **mail/** — inbox, sent, draft
- **todo/** — all-tasks, today, upcoming, completed, priority
- **ai/** — chat, start
- **real-estate/** — property listings

#### React Demos (Full Pages) — ดู completed pages
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-react-demos/typescript/nextjs/app/(protected)/
```
- **store-admin/** — admin store management
- **store-client/** — client-facing store
- **account/** — account settings, billing, security, members
- **network/** — user-table, user-cards
- **auth/** — login, signup, reset password
- **components/** — component showcase/examples
- **user-management/** — user CRUD

#### HTML Demos (10 themes × 50+ pages) — ดู visual design
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-html-demos/dist/html/
```
demo1-10, แต่ละ demo มี: dashboards, account, authentication (branded/classic), network, public-profile, security, store-client, user-table, plugins

#### Landing Pages — สำหรับ LandingPage redesign
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-nextjs-landings/
```

#### Design Tokens
```
d:/UI COMPONENT/metronic-v9.4.8/metronic-tailwind-react-starter-kit/typescript/nextjs/styles/globals.css
```

### Secondary: Metronic v8.3.3 (Bootstrap — ดูเป็น reference เพิ่มเติม)
```
d:/UI COMPONENT/v8.3.3/html/          — 64 HTML demo zips
d:/UI COMPONENT/v8.3.3/nodejs/        — Node.js backend reference
d:/UI COMPONENT/v8.3.3/flask/         — Flask reference
```

### Tertiary: Metronic v7 (Legacy — ดู design concepts)
```
d:/UI COMPONENT/Metronic-Metronic-v7/design/   — Figma/design files
d:/UI COMPONENT/Metronic-Metronic-v7/theme/html/  — HTML demos (demo1-13)
d:/UI COMPONENT/Metronic-Metronic-v7/theme/react/  — React demos
```

---

## 🎨 Design Direction: ผสม Store Inventory + CRM + Custom

### Page-to-Reference Mapping

| BESTCHOICE Page | Metronic Reference | Design Notes |
|---|---|---|
| **DashboardPage** | `crm/dashboard` + `store-inventory/dashboard` | CRM-style KPI cards + Store inventory charts + Activity feed + Revenue trends |
| **CustomersPage** | `store-inventory/customer-list` + `crm/contacts` | DataGrid with avatar + status badges + search + advanced filters |
| **CustomerDetailPage** | `store-inventory/customer-list-details` + `crm/company` | Profile header + tabbed sections (contracts, payments, history) |
| **ContractsPage** | `store-inventory/order-list` | DataGrid + status badges + date filters + quick actions |
| **ContractDetailPage** | `store-inventory/order-details` + `store-inventory/order-tracking` | Detail card + payment timeline + status tracker |
| **ContractCreatePage/** | `store-inventory/create-product` (multi-step) | Stepper wizard + form sections + preview |
| **ContractSignPage** | Custom (existing signing wizard) | เก็บ SigningWizard flow เดิม — ปรับ UI ให้ match design system |
| **ContractTemplatesPage** | `store-inventory/category-list` | Card grid + template editor |
| **PaymentsPage** | `store-inventory/order-list-products` | Summary stats cards + DataGrid + status filters |
| **POSPage** | `store-client/` (demos) | POS layout: product grid + cart sidebar |
| **StockPage/** | `store-inventory/current-stock` + `store-inventory/all-stock` | Dashboard tab + stock table tab + alerts |
| **StockTransfersPage** | `store-inventory/inbound-stock` + `store-inventory/outbound-stock` | Transfer table + status tracking |
| **StockAlertsPage** | `store-inventory/stock-planner` | Alert cards + threshold table |
| **StockCountPage** | `store-inventory/per-product-stock` | Count form + verification table |
| **StockAdjustmentsPage** | `store-inventory/tables` | Adjustment log DataGrid |
| **PurchaseOrdersPage/** | `store-inventory/order-list` + `store-inventory/order-details` | PO list + detail view + goods receiving |
| **SuppliersPage** | `crm/companies` | Company list DataGrid + stats |
| **SupplierDetailPage** | `crm/company` | Company profile + PO history tabs |
| **ProductCreatePage** | `store-inventory/create-product` + `store-inventory/manage-variants` | Product form + variant management |
| **ProductDetailPage** | `store-inventory/product-details` | Product info + photos + stock levels |
| **OverduePage** | `crm/tasks` (overdue style) | Overdue summary stats + DataGrid + severity badges |
| **ReceiptsPage** | `store-inventory/order-list` | Receipt list + print/export actions |
| **ReceiptVerifyPage** | Custom | Verification form + result display |
| **FinanceReceivablePage** | `crm/dashboard` charts | Receivables charts + aging DataGrid |
| **FinancialAuditPage** | `store-inventory/tables` + `crm/notes` | Audit log table + detail drawer |
| **ExpensesPage** | `store-inventory/order-list` | Expense DataGrid + category filters + summary |
| **ProfitLossPage** | `crm/dashboard` charts | P&L charts + comparison tables |
| **SalesHistoryPage** | `crm/dashboard` + `store-inventory/tables` | Sales charts + history DataGrid |
| **PaymentCsvImportPage** | `store-inventory/create-product` (form style) | Upload form + preview table + import progress |
| **ReportsPage** | `crm/dashboard` charts | Report cards + chart sections + export |
| **SettingsPage** | `demos/account/` (account home) | Settings tabs/sections + form groups |
| **InterestConfigPage** | `demos/account/billing` | Config form cards |
| **PricingTemplatesPage** | `store-inventory/category-list` | Template card grid + edit dialog |
| **LineOaSettingsPage** | `demos/account/` | Integration settings form |
| **SmsSettingsPage** | `demos/account/` | SMS config form |
| **UsersPage** | `demos/network/user-table` + `demos/user-management/` | User DataGrid + role badges + invite actions |
| **BranchesPage** | `crm/companies` | Branch cards/list + stats |
| **AuditLogsPage** | `store-inventory/tables` | Log DataGrid + date range filter + user filter |
| **SystemStatusPage** | `store-inventory/dashboard` (stats style) | Health cards + service status indicators |
| **NotificationsPage** | `mail/inbox` (message list style) | Notification list + read/unread + filters |
| **CreditChecksPage** | `crm/contacts` + custom | Credit check DataGrid + result cards |
| **SlipReviewPage** | Custom | Slip image viewer + approval actions |
| **RepossessionsPage** | `store-inventory/order-list` | Repossession DataGrid + status tracking |
| **ExchangePage** | `store-inventory/order-details` | Exchange form + product comparison |
| **InspectionPage** | `store-inventory/tables` | Inspection DataGrid + status |
| **InspectionDetailPage** | `store-inventory/product-details` | Inspection detail + checklist + photos |
| **InventoryWorkflowPage** | `todo/all-tasks` (kanban/list) | Workflow stages + status cards |
| **DocumentDashboardPage** | `crm/dashboard` | Document stats + recent activity |
| **StickerPrintPage** | Custom | Print layout + barcode preview |
| **LoginPage** | `demos/auth/` (branded) | Branded auth with background + logo |
| **LandingPage** | `metronic-tailwind-nextjs-landings/` | Modern landing: hero + features + CTA |
| **ForgotPasswordPage** | `demos/auth/` (branded) | Branded auth form |
| **ResetPasswordPage** | `demos/auth/` (branded) | Branded auth form |
| **RegisterInvitePage** | `demos/auth/` (branded) | Branded registration form |
| **ContractVerifyPage** | Custom (public page) | Verification result card |
| **CustomerPortalPage** | `store-client/` | Customer self-service portal |
| **PDPAPage** | Custom | Consent form + privacy info |
| **MigrationPage** | `store-inventory/settings-modal` | Migration tools + progress |

---

## ⚙️ ขั้นตอนการทำงาน (8 Phases)

### Phase 0: Foundation Setup
**เป้าหมาย**: เตรียม components ใหม่จาก Metronic v9.4.8

1. **อ่าน Metronic v9.4.8 components ทั้งหมด** ใน `metronic-tailwind-react-starter-kit/typescript/nextjs/components/ui/` เพื่อเข้าใจ API, props, variants ของแต่ละ component
2. **อ่าน Metronic concepts** ใน `metronic-tailwind-react-concepts/typescript/nextjs/app/` โดยเฉพาะ `store-inventory/` และ `crm/` เพื่อเข้าใจ design patterns การประกอบ components
3. **อ่าน Metronic demos** ใน `metronic-tailwind-react-demos/typescript/nextjs/app/(protected)/` เพื่อดู completed page examples
4. **อ่าน HTML demos** ใน `metronic-tailwind-html-demos/dist/html/demo1/` เพื่อดู visual design patterns
5. **เปรียบเทียบ** components ที่มีอยู่ใน `apps/web/src/components/ui/` (32 ตัว) กับ Metronic v9.4.8 (77 ตัว)
6. **Copy components ที่ยังไม่มี** จาก Metronic v9.4.8 มาใส่ใน `apps/web/src/components/ui/` — ปรับ import paths ให้ใช้กับ Vite + React Router (ไม่ใช่ Next.js)
   - ต้อง copy: data-grid, stepper, progress, calendar, alert, alert-dialog, toggle, toggle-group, switch, slider, file-upload, hover-card, resizable, navigation-menu, menubar, context-menu, aspect-ratio, radio-group, textarea (ถ้ายังไม่มี)
   - **ห้ามเปลี่ยน** components เดิมที่มีอยู่แล้ว ถ้า API เข้ากันได้
7. **อัปเดต design tokens** ใน `apps/web/src/index.css`:
   - ดึง tokens ใหม่จาก Metronic v9.4.8 globals.css เฉพาะที่ปรับปรุงดีขึ้น
   - **ห้ามเปลี่ยน font settings** — คง Inter + Noto Sans Thai + TH Sarabun PSK
   - **ห้ามลบ** custom utilities ที่มีอยู่ (stat-card, glass-card, font-sarabun, safe-area-bottom)
   - **ห้ามลบ** Tiptap styles, print styles, mobile responsive styles
8. **TypeScript check**: `cd apps/web && npx tsc --noEmit`
9. **Commit**: `git add -A && git commit -m "refactor(ui): phase 0 — add Metronic v9.4.8 components and update design tokens"`

### Phase 1: Layout Redesign
**เป้าหมาย**: ปรับ layout หลักให้ตาม Metronic patterns

**อ่าน reference ก่อน**:
- อ่าน Metronic layout concepts ที่ `metronic-tailwind-react-concepts/typescript/nextjs/app/store-inventory/` — ดู sidebar + header pattern
- อ่าน `metronic-tailwind-react-concepts/typescript/nextjs/app/store-inventory/dark-sidebar/` — ดู dark sidebar variant
- อ่าน Metronic layout templates ที่ `metronic-tailwind-react-starter-kit/typescript/nextjs/components/layouts/` — เลือก layout ที่เหมาะสม

**แก้ไขไฟล์**:
1. `apps/web/src/components/layout/MainLayout.tsx` — ปรับ layout wrapper ตาม Metronic pattern
2. `apps/web/src/components/layout/Sidebar.tsx` — redesign sidebar ให้ match Metronic (icon rail mode + expanded mode)
3. `apps/web/src/components/layout/TopBar.tsx` — redesign header ตาม Metronic
4. `apps/web/src/components/layout/MobileBottomNav.tsx` — ปรับ mobile nav ให้ consistent
5. `apps/web/src/components/layout/LayoutContext.tsx` — ปรับ context ถ้าจำเป็น

**กฎ**:
- ต้องรักษา routing functionality เดิม
- ต้องรักษา role-based menu items เดิม
- ต้องรักษา mobile responsive behavior
- ต้องรักษา sidebar collapse/expand functionality
- ต้องรักษา auth-related features (user menu, logout)

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/page-smoke.spec.ts`
3. `cd apps/web && npx playwright test e2e/login.spec.ts`
4. `cd apps/web && npx playwright test e2e/role-access.spec.ts`
5. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
6. **Commit**: `git add -A && git commit -m "refactor(ui): phase 1 — redesign layout (Sidebar, TopBar, MainLayout) with Metronic patterns"`

### Phase 2: Core Pages (5 หน้า — ใช้บ่อยที่สุด)
**เป้าหมาย**: Redesign หน้าหลักที่ users ใช้ทุกวัน

**อ่าน reference ก่อน**:
- `store-inventory/dashboard/` + `crm/dashboard/` สำหรับ DashboardPage
- `store-inventory/customer-list/` + `crm/contacts/` สำหรับ CustomersPage
- `store-inventory/order-list/` สำหรับ ContractsPage
- `store-inventory/order-list-products/` สำหรับ PaymentsPage
- `store-client/` (demos) สำหรับ POSPage

**แก้ไขไฟล์**:
1. `apps/web/src/pages/DashboardPage.tsx`
   - KPI stat cards ด้านบน (ยอดขาย, ลูกค้าใหม่, สัญญาค้างชำระ, รายรับวันนี้)
   - Charts section (revenue trend, payment breakdown)
   - Recent activity table
   - Branch comparison (ถ้ามี)
   - ดู crm/dashboard สำหรับ layout + store-inventory/dashboard สำหรับ stats style

2. `apps/web/src/pages/CustomersPage.tsx`
   - Search bar + advanced filters (dropdown)
   - DataGrid with: avatar, name, phone, contract count, status badge
   - Bulk actions toolbar
   - ดู store-inventory/customer-list สำหรับ table + crm/contacts สำหรับ contact cards

3. `apps/web/src/pages/ContractsPage.tsx`
   - Summary stat cards (active, overdue, completed, total value)
   - DataGrid with: contract #, customer, product, amount, status badge, due date
   - Status tab filters (ทั้งหมด, ใช้งาน, ค้างชำระ, เสร็จสิ้น)
   - ดู store-inventory/order-list

4. `apps/web/src/pages/PaymentsPage.tsx`
   - Summary cards (วันนี้, สัปดาห์นี้, เดือนนี้)
   - DataGrid with: date, customer, amount, method, status badge
   - Date range filter
   - ดู store-inventory/order-list-products

5. `apps/web/src/pages/POSPage.tsx`
   - Product grid (left) + Cart sidebar (right)
   - Product search + category filter
   - Cart items + totals + checkout button
   - ดู store-client demos

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/dashboard.spec.ts`
3. `cd apps/web && npx playwright test e2e/customers.spec.ts`
4. `cd apps/web && npx playwright test e2e/contracts.spec.ts`
5. `cd apps/web && npx playwright test e2e/payments.spec.ts`
6. `cd apps/web && npx playwright test e2e/pos-sales.spec.ts`
7. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
8. **Commit**: `git add -A && git commit -m "refactor(ui): phase 2 — redesign core pages (Dashboard, Customers, Contracts, Payments, POS)"`

### Phase 3: Detail Pages (5 หน้า)
**เป้าหมาย**: Redesign หน้ารายละเอียดที่เข้าถึงจาก Core pages

**อ่าน reference ก่อน**:
- `store-inventory/customer-list-details/` + `crm/company/` สำหรับ detail layouts
- `store-inventory/order-details/` + `store-inventory/order-tracking/` สำหรับ contract details
- `store-inventory/create-product/` สำหรับ multi-step forms
- `store-inventory/product-details/` สำหรับ product view

**แก้ไขไฟล์**:
1. `apps/web/src/pages/CustomerDetailPage.tsx`
   - Profile header card (avatar, name, phone, status, actions)
   - Tabbed sections: ข้อมูลส่วนตัว, สัญญา, ประวัติชำระ, เอกสาร
   - ดู store-inventory/customer-list-details + crm/company

2. `apps/web/src/pages/ContractDetailPage.tsx`
   - Contract header (number, status badge, customer info, actions)
   - Payment timeline/schedule
   - Contract info sections
   - ดู store-inventory/order-details + order-tracking

3. `apps/web/src/pages/ContractCreatePage/` (folder — มีหลายไฟล์)
   - อ่านทุกไฟล์ใน folder ก่อน
   - Stepper wizard: เลือกลูกค้า → เลือกสินค้า → กำหนดเงื่อนไข → สรุป → ยืนยัน
   - ดู store-inventory/create-product สำหรับ form style
   - **ห้ามเปลี่ยน step logic และ validation**

4. `apps/web/src/pages/ProductDetailPage.tsx`
   - Product header + photos gallery
   - Specs/details section
   - Stock levels
   - ดู store-inventory/product-details

5. `apps/web/src/pages/SupplierDetailPage.tsx`
   - Supplier profile card + contact info
   - PO history tabs
   - ดู crm/company

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/contract-workflow.spec.ts`
3. `cd apps/web && npx playwright test e2e/crud-flows.spec.ts`
4. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
5. **Commit**: `git add -A && git commit -m "refactor(ui): phase 3 — redesign detail pages (Customer, Contract, Product, Supplier detail + Contract create)"`

### Phase 4: Inventory & Supply Chain (7 หน้า)
**เป้าหมาย**: Redesign หน้า stock และ procurement

**อ่าน reference ก่อน**:
- `store-inventory/current-stock/` + `store-inventory/all-stock/` + `store-inventory/per-product-stock/`
- `store-inventory/inbound-stock/` + `store-inventory/outbound-stock/`
- `store-inventory/stock-planner/`
- `store-inventory/order-list/` + `store-inventory/order-details/` สำหรับ PO
- `crm/companies/` สำหรับ suppliers

**แก้ไขไฟล์**:
1. `apps/web/src/pages/StockPage/` (folder — อ่านทุกไฟล์ก่อน)
   - Dashboard view: stock stats + alerts + chart
   - List view: stock DataGrid + filters + search
   - ดู store-inventory/current-stock + all-stock

2. `apps/web/src/pages/StockTransfersPage.tsx`
   - Transfer DataGrid + status badges
   - Create transfer form
   - ดู store-inventory/inbound-stock + outbound-stock

3. `apps/web/src/pages/StockAlertsPage.tsx`
   - Alert cards + threshold settings
   - ดู store-inventory/stock-planner

4. `apps/web/src/pages/StockCountPage.tsx`
   - Count form + product search + verification
   - ดู store-inventory/per-product-stock

5. `apps/web/src/pages/StockAdjustmentsPage.tsx`
   - Adjustment log DataGrid
   - ดู store-inventory/tables

6. `apps/web/src/pages/PurchaseOrdersPage/` (folder — อ่านทุกไฟล์ก่อน)
   - PO list + create + detail + goods receiving
   - ดู store-inventory/order-list + order-details

7. `apps/web/src/pages/SuppliersPage.tsx`
   - Supplier DataGrid + add new
   - ดู crm/companies

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/stock-management.spec.ts`
3. `cd apps/web && npx playwright test e2e/procurement.spec.ts`
4. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
5. **Commit**: `git add -A && git commit -m "refactor(ui): phase 4 — redesign inventory & supply chain pages (Stock, Transfers, Alerts, PO, Suppliers)"`

### Phase 5: Financial Pages (8 หน้า)
**เป้าหมาย**: Redesign หน้าการเงินและรายงาน

**อ่าน reference ก่อน**:
- `crm/dashboard/` สำหรับ charts + KPIs
- `store-inventory/tables/` สำหรับ data tables
- `crm/tasks/` สำหรับ overdue/task lists
- `crm/notes/` สำหรับ activity/audit logs

**แก้ไขไฟล์**:
1. `apps/web/src/pages/OverduePage.tsx` — Overdue stats + DataGrid + severity badges
2. `apps/web/src/pages/ReceiptsPage.tsx` — Receipt DataGrid + print/export
3. `apps/web/src/pages/ReceiptVerifyPage.tsx` — Verify form + result card
4. `apps/web/src/pages/FinanceReceivablePage.tsx` — Receivables charts + aging table
5. `apps/web/src/pages/FinancialAuditPage.tsx` — Audit log DataGrid + filters
6. `apps/web/src/pages/ExpensesPage.tsx` — Expense DataGrid + category stats
7. `apps/web/src/pages/ProfitLossPage.tsx` — P&L charts + comparison tables
8. `apps/web/src/pages/SalesHistoryPage.tsx` — Sales charts + history DataGrid

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/finance.spec.ts`
3. `cd apps/web && npx playwright test e2e/overdue.spec.ts`
4. `cd apps/web && npx playwright test e2e/debt-collection.spec.ts`
5. `cd apps/web && npx playwright test e2e/installment-calculation.spec.ts`
6. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
7. **Commit**: `git add -A && git commit -m "refactor(ui): phase 5 — redesign financial pages (Overdue, Receipts, Finance, Expenses, P&L, Sales)"`

### Phase 6: Admin & Settings (8 หน้า)
**เป้าหมาย**: Redesign หน้า admin และ settings

**อ่าน reference ก่อน**:
- `demos/account/` (home, billing, security, members) สำหรับ settings
- `demos/network/user-table/` + `demos/user-management/` สำหรับ users
- `crm/companies/` สำหรับ branches
- `store-inventory/tables/` สำหรับ logs
- `store-inventory/dashboard/` สำหรับ status cards

**แก้ไขไฟล์**:
1. `apps/web/src/pages/SettingsPage.tsx` — Settings tabs + form sections
2. `apps/web/src/pages/InterestConfigPage.tsx` — Config form cards
3. `apps/web/src/pages/PricingTemplatesPage.tsx` — Template card grid + edit
4. `apps/web/src/pages/LineOaSettingsPage.tsx` — LINE OA config form
5. `apps/web/src/pages/SmsSettingsPage.tsx` — SMS config form
6. `apps/web/src/pages/UsersPage.tsx` — User DataGrid + role badges + invite
7. `apps/web/src/pages/BranchesPage.tsx` — Branch cards/list + stats
8. `apps/web/src/pages/AuditLogsPage.tsx` — Log DataGrid + date/user filters
9. `apps/web/src/pages/SystemStatusPage.tsx` — Health cards + service indicators
10. `apps/web/src/pages/NotificationsPage.tsx` — Notification list (inbox style)

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/admin-settings.spec.ts`
3. `cd apps/web && npx playwright test e2e/invite-resend.spec.ts`
4. `cd apps/web && npx playwright test e2e/reports-notifications.spec.ts`
5. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
6. **Commit**: `git add -A && git commit -m "refactor(ui): phase 6 — redesign admin & settings pages (Settings, Users, Branches, Audit, System)"`

### Phase 7: Specialized Pages (12 หน้า)
**เป้าหมาย**: Redesign หน้าเฉพาะทาง

**อ่าน reference ก่อน**:
- `store-inventory/create-product/` สำหรับ forms
- `store-inventory/product-details/` สำหรับ detail views
- `todo/all-tasks/` สำหรับ workflow/task views
- `crm/dashboard/` สำหรับ dashboard-style pages

**แก้ไขไฟล์**:
1. `apps/web/src/pages/ContractSignPage.tsx` — ปรับ SigningWizard UI ให้ match design system (เก็บ flow เดิม)
2. `apps/web/src/pages/ContractTemplatesPage.tsx` — Template card grid + editor
3. `apps/web/src/pages/CreditChecksPage.tsx` — Credit check DataGrid + result cards
4. `apps/web/src/pages/SlipReviewPage.tsx` — Slip image viewer + approval actions
5. `apps/web/src/pages/RepossessionsPage.tsx` — Repossession DataGrid + status
6. `apps/web/src/pages/ExchangePage.tsx` — Exchange form + product comparison
7. `apps/web/src/pages/InspectionPage.tsx` — Inspection DataGrid
8. `apps/web/src/pages/InspectionDetailPage.tsx` — Inspection detail + checklist + photos
9. `apps/web/src/pages/InventoryWorkflowPage.tsx` — Workflow stages + status cards
10. `apps/web/src/pages/DocumentDashboardPage.tsx` — Document stats + recent activity
11. `apps/web/src/pages/ReportsPage.tsx` — Report cards + charts + export
12. `apps/web/src/pages/StickerPrintPage.tsx` — Print layout + barcode preview
13. `apps/web/src/pages/PaymentCsvImportPage.tsx` — Upload form + preview table + progress
14. `apps/web/src/pages/ProductCreatePage.tsx` — Product form + variant management

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/crud-flows.spec.ts`
3. `cd apps/web && npx playwright test e2e/page-smoke.spec.ts`
4. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
5. **Commit**: `git add -A && git commit -m "refactor(ui): phase 7 — redesign specialized pages (Signing, Templates, Credit, Slip, Repossession, etc.)"`

### Phase 8: Auth & Public Pages (9 หน้า)
**เป้าหมาย**: Redesign หน้า auth และ public-facing

**อ่าน reference ก่อน**:
- `demos/auth/` (branded, classic) สำหรับ auth pages
- `metronic-tailwind-nextjs-landings/` สำหรับ landing page
- `store-client/` สำหรับ customer portal

**แก้ไขไฟล์**:
1. `apps/web/src/pages/LoginPage.tsx` — Branded auth: split layout (brand panel + form)
2. `apps/web/src/pages/ForgotPasswordPage.tsx` — Branded auth form
3. `apps/web/src/pages/ResetPasswordPage.tsx` — Branded auth form
4. `apps/web/src/pages/RegisterInvitePage.tsx` — Branded registration
5. `apps/web/src/pages/LandingPage.tsx` — Modern landing: hero + features + testimonials + CTA
6. `apps/web/src/pages/ContractVerifyPage.tsx` — Public verification result
7. `apps/web/src/pages/CustomerPortalPage.tsx` — Customer portal (self-service)
8. `apps/web/src/pages/PDPAPage.tsx` — Privacy consent form
9. `apps/web/src/pages/MigrationPage.tsx` — Migration tools + progress

**ข้าม LIFF pages** (`apps/web/src/pages/liff/`) — ไม่ต้อง redesign

**Verify**:
1. `cd apps/web && npx tsc --noEmit`
2. `cd apps/web && npx playwright test e2e/login.spec.ts`
3. `cd apps/web && npx playwright test e2e/public-pages.spec.ts`
4. `cd apps/web && npx playwright test e2e/liff-pages.spec.ts`
5. ถ้ามี error → fix ทั้งหมดก่อนไปต่อ
6. **Commit**: `git add -A && git commit -m "refactor(ui): phase 8 — redesign auth & public pages (Login, Landing, Register, Portal, PDPA)"`

### Phase 9: Full Regression Test + Bug Fix
**เป้าหมาย**: ทดสอบทุกอย่างรวมกันและ fix bugs

1. **TypeScript Full Check**:
   ```bash
   cd apps/web && npx tsc --noEmit
   ```
   ถ้ามี error → fix ทั้งหมด

2. **รัน E2E Tests ทั้งหมด** (21 test files):
   ```bash
   cd apps/web && npx playwright test
   ```
   ถ้ามี failed tests → อ่าน error → fix → รัน test อีกครั้ง

3. **รัน E2E ทีละ file** สำหรับ test ที่ fail:
   ```bash
   cd apps/web && npx playwright test e2e/<failed-test>.spec.ts --reporter=list
   ```

4. **Visual Regression Check** — เปิด browser ดูทุกหน้า:
   ```bash
   cd apps/web && npx playwright test e2e/page-smoke.spec.ts --headed
   ```

5. **Bug Hunting Checklist** — ตรวจสอบสิ่งเหล่านี้:
   - [ ] ทุกหน้า render ได้โดยไม่มี console errors
   - [ ] Sidebar navigation ทำงานถูกต้องทุก route
   - [ ] Mobile responsive: sidebar collapse, bottom nav ทำงาน
   - [ ] Tables: sorting, filtering, pagination ทำงาน
   - [ ] Forms: validation messages แสดงถูกต้อง (ภาษาไทย)
   - [ ] Modals/Dialogs: เปิด-ปิดได้ถูกต้อง
   - [ ] Toast notifications: success/error แสดงถูกต้อง
   - [ ] Loading states: skeleton แสดงขณะโหลด
   - [ ] Empty states: แสดงเมื่อไม่มีข้อมูล
   - [ ] Auth: login/logout/role-based access ทำงาน
   - [ ] Dark mode: ถ้ามี toggle ต้องทำงานถูกต้อง
   - [ ] Print: receipt print ทำงานถูกต้อง

6. **Fix ทุก bug** ที่พบ → รัน tests อีกครั้ง → loop จนผ่านทั้งหมด

7. **Final Commit**:
   ```bash
   git add -A && git commit -m "fix(ui): phase 9 — fix regression bugs from UI redesign"
   ```

---

## 🚫 กฎเหล็ก (ห้ามฝ่าฝืน)

### ห้ามเปลี่ยน
1. **Business Logic** — ห้ามแก้ไข logic ใน useQuery, useMutation, event handlers, calculations
2. **API Calls** — ห้ามเปลี่ยน api.get(), api.post(), endpoint URLs, request/response handling
3. **Routing** — ห้ามเปลี่ยน route paths, ProtectedRoute, lazy loading
4. **State Management** — ห้ามเปลี่ยน Zustand stores, React Query cache logic, AuthContext
5. **Fonts** — ห้ามเปลี่ยน font-family settings ทั้งหมด:
   - Primary: `'Inter', 'Noto Sans Thai', system-ui, -apple-system, sans-serif`
   - Thai: `'Noto Sans Thai', sans-serif`
   - Document: `'TH Sarabun PSK'` (fallback)
   - ห้ามเพิ่มหรือลบ @font-face declarations
   - ห้ามเปลี่ยน Google Fonts import
6. **Features** — ห้ามลบ features ที่มีอยู่ ทุก button, action, functionality ต้องยังทำงาน
7. **ภาษา** — UI text ต้องเป็น **ภาษาไทยเท่านั้น** (ไม่เปลี่ยนไปเป็นภาษาอังกฤษ) ยกเว้น technical terms ที่เป็นภาษาอังกฤษอยู่แล้ว
8. **Print Styles** — ห้ามลบหรือเปลี่ยน @media print rules ใน index.css
9. **Tiptap Styles** — ห้ามลบหรือเปลี่ยน .tiptap.ProseMirror styles ใน index.css
10. **LIFF Pages** — ห้ามแก้ไขไฟล์ใน `apps/web/src/pages/liff/`

### ต้องทำ
1. **อ่านหน้าเดิมทั้งหมดก่อนแก้** — เข้าใจ functionality ทั้งหมดก่อน redesign
2. **อ่าน Metronic reference ก่อนแก้** — ดู concept/demo page ที่ mapping ไว้
3. **Responsive** — ทุกหน้าต้อง responsive ทั้ง Desktop (≥1024px) และ Mobile (<768px)
   - Desktop: sidebar visible, full DataGrid, multi-column layout
   - Mobile: sidebar hidden (hamburger), stacked layout, simplified tables
   - ใช้ breakpoints: `sm:`, `md:`, `lg:`, `xl:`
4. **TypeScript** — ต้องไม่มี TypeScript errors (`npx tsc --noEmit` ต้องผ่าน)
5. **E2E Tests** — ต้องผ่าน E2E tests ที่เกี่ยวข้องกับหน้าที่แก้
6. **Commit** — commit หลังทุก phase ที่ผ่าน tests
7. **Consistent Design** — ทุกหน้าต้อง consistent:
   - ใช้ PageHeader component สำหรับ title + actions
   - ใช้ Card component สำหรับ content sections
   - ใช้ Badge component สำหรับ statuses (consistent color scheme ทุกหน้า)
   - ใช้ DataTable/DataGrid สำหรับ tables
   - ใช้ Skeleton สำหรับ loading states
   - ใช้ EmptyState สำหรับ empty data
   - ใช้ toast (sonner) สำหรับ notifications
   - spacing: `p-4`/`p-6` ใน cards, `gap-4`/`gap-6` ใน grids
8. **Import Paths** — ใช้ `@/components/ui/` สำหรับ UI components, `@/lib/api` สำหรับ API

### Design Principles
1. **Clean & Professional** — ไม่ cluttered, ใช้ whitespace เยอะ
2. **Information Hierarchy** — สิ่งสำคัญโดดเด่น, รายละเอียดอยู่ส่วนล่าง
3. **Consistent Colors** — ใช้ semantic colors จาก design tokens:
   - Primary (blue) — actions, links, active states
   - Success (green) — ชำระแล้ว, สำเร็จ, active
   - Warning (orange/yellow) — ค้างชำระ, เตือน
   - Destructive (red) — เกินกำหนด, ลบ, errors
   - Muted (gray) — disabled, secondary info
4. **Micro-interactions** — hover states, transitions, loading animations
5. **Accessibility** — proper contrast, focus states, aria labels

---

## 📋 Existing Files to Read (ก่อนเริ่ม Phase 0)

ก่อนเริ่มทำงาน ให้อ่านไฟล์เหล่านี้เพื่อเข้าใจ codebase:

```
# Design system
apps/web/src/index.css                          — current design tokens + utilities
apps/web/tailwind.config.js                     — Tailwind config + Metronic font scale

# Layout
apps/web/src/components/layout/MainLayout.tsx   — main layout wrapper
apps/web/src/components/layout/Sidebar.tsx       — sidebar navigation
apps/web/src/components/layout/TopBar.tsx        — top header bar
apps/web/src/components/layout/MobileBottomNav.tsx — mobile bottom nav
apps/web/src/components/layout/LayoutContext.tsx  — layout state context

# Core UI components
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/card.tsx
apps/web/src/components/ui/DataTable.tsx
apps/web/src/components/ui/badge.tsx
apps/web/src/components/ui/PageHeader.tsx
apps/web/src/components/ui/EmptyState.tsx
apps/web/src/components/ui/page-skeletons.tsx

# API & Auth
apps/web/src/lib/api.ts                         — axios client (ห้ามแก้)
apps/web/src/contexts/AuthContext.tsx            — auth context (ห้ามแก้)
apps/web/src/lib/utils.ts                       — cn() utility

# Reference page (ดู pattern ปัจจุบัน)
apps/web/src/pages/CustomersPage.tsx             — ดู pattern การใช้ useQuery + DataTable
apps/web/src/pages/DashboardPage.tsx             — ดู pattern dashboard layout
```

---

## 🔄 Error Recovery

ถ้าเกิด error ระหว่างทำงาน:

1. **TypeScript Error** → อ่าน error message → fix import paths, prop types, missing props
2. **E2E Test Fail** → อ่าน test file เพื่อดูว่า test expect อะไร → fix UI ให้ match test expectations (เช่น test อาจ find by text, by role, by testid)
3. **Component Not Found** → ตรวจสอบว่า component ถูก export และ import path ถูกต้อง
4. **Build Error** → `cd apps/web && npm run build` → อ่าน error → fix
5. **Multiple Failures** → focus fix หน้าที่ fail ก่อน → รัน test เฉพาะหน้านั้น → แล้วค่อยรันทั้งหมด

ถ้า fix ไม่ได้หลังลอง 3 ครั้ง → **revert ไฟล์นั้นกลับเป็น version เดิม** (`git checkout -- <file>`) แล้วไปทำหน้าถัดไป → กลับมา fix ทีหลังใน Phase 9

---

## ⏱️ Execution Order

```
Phase 0: Foundation Setup (components + tokens)
    ↓
Phase 1: Layout (Sidebar, TopBar, MainLayout)
    ↓
Phase 2: Core Pages (Dashboard, Customers, Contracts, Payments, POS)
    ↓
Phase 3: Detail Pages (Customer, Contract, Product, Supplier detail)
    ↓
Phase 4: Inventory (Stock, Transfers, Alerts, PO, Suppliers)
    ↓
Phase 5: Financial (Overdue, Receipts, Finance, Expenses, P&L)
    ↓
Phase 6: Admin (Settings, Users, Branches, Audit, System)
    ↓
Phase 7: Specialized (Signing, Templates, Credit, Reports, etc.)
    ↓
Phase 8: Auth & Public (Login, Landing, Register, Portal)
    ↓
Phase 9: Full Regression Test + Bug Fix
```

ทุก Phase ต้อง: TypeScript check ✓ → E2E tests ✓ → Commit ✓ ก่อนไป Phase ถัดไป
