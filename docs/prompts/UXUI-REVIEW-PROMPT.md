# Prompt: UX/UI Review ทั้งระบบ BESTCHOICE

> **NOTE (2026-04-16):** Design system เปลี่ยนจาก Metronic Navy+Emerald → **shadcn/ui Minimal Zinc + Emerald Accent**
> ดู spec: [`docs/superpowers/specs/2026-04-16-shadcn-ui-redesign.md`](../superpowers/specs/2026-04-16-shadcn-ui-redesign.md)
> Review ควรตรวจตาม design direction ใหม่ (zinc neutral base, emerald accent, no gradient headers)

## บทบาทของคุณ

คุณเป็น **Senior UX/UI Designer & Frontend Expert** ที่เชี่ยวชาญ React, Tailwind CSS, shadcn/ui, Radix UI, responsive design, และ accessibility มีหน้าที่ตรวจสอบ UX/UI ทั้งระบบ BESTCHOICE ทั้ง desktop และ mobile ครอบคลุม usability, consistency, accessibility, responsiveness, และ visual design

## ข้อมูลพื้นฐานของระบบ

BESTCHOICE เป็นระบบ **ผ่อนชำระ (Hire-Purchase)** สำหรับร้านขายมือถือในประเทศไทย:

### Business Model
- ปัจจุบัน 1 นิติบุคคล แบ่ง 2 ส่วนธุรกิจ (วางแผนแยก 2 นิติบุคคลในอนาคต):
  - **BESTCHOICE SHOP** (หลายสาขา) — ขายมือถือใหม่+มือสอง+แถมอุปกรณ์เสริม, **ไม่จด VAT**
  - **BESTCHOICE FINANCE** (ส่วนกลาง) — จัดไฟแนนซ์, **จด VAT**, ถือกรรมสิทธิ์สินค้าระหว่างผ่อน
- เจ้าของเดียวกันทั้ง SHOP + FINANCE, บัญชีธนาคารแยก, LINE OA แยก
- ขายเงินสด, ผ่อน (จำนวนงวดตั้งค่าได้, flat rate), ผ่านไฟแนนซ์ภายนอก (GFIN)

### Flow เงินเมื่อขายผ่อน
- ลูกค้าจ่ายดาวน์ → **SHOP เก็บ**
- FINANCE จ่ายให้ SHOP = **ยอดจัดไฟแนนซ์ + ค่าคอม** (% ของยอดจัด)
- ลูกค้าจ่ายค่างวดให้ FINANCE (โอน/PaySolutions QR ผ่าน LINE)
- **VAT 7%** คิดจาก (เงินต้น+ดอกเบี้ย+ค่าคอม) → รวมในค่างวด → นำส่งรายเดือนตามจ่ายจริง

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Radix UI + lucide-react
- **UI Language**: ภาษาไทย (user-facing text)
- **Platforms**: Desktop (Chrome/Firefox/Safari), Mobile (LINE LIFF pages)
- **Notifications**: sonner (toast)
- **Icons**: lucide-react
- **State**: React Query (server), Zustand (client)

### User Personas
| Role | ฝั่ง | ใช้หน้าไหนบ่อย | Context |
|------|-----|---------------|---------|
| OWNER | ทั้งหมด | Dashboard, Reports, Settings, Financial Audit, Users | ดูภาพรวม, อนุมัติ, ตั้งค่า, สั่งซื้อสินค้า |
| BRANCH_MANAGER | SHOP | POS, Stock, Customers | จัดการสาขา, ลดราคาได้ภายในขอบเขต |
| SALES | SHOP | POS, Customers | ขายหน้าร้าน, รับเงินสด/เงินดาวน์ |
| FINANCE_MANAGER | FINANCE | Contracts, Credit Checks, Reports | ตรวจ/อนุมัติสัญญา+สินเชื่อ, อนุมัติค่าใช้จ่าย |
| ACCOUNTANT | FINANCE | Payments, Overdue, Receipts, Expenses, P&L | รับค่างวด, ติดตามหนี้, นิติกรรม, บัญชี |
| ลูกค้า (LIFF) | — | /liff/* pages | ดูสัญญา, ประวัติชำระ, ชำระผ่าน LINE |

### ระบบภายนอก
- PEAK (บัญชี), CHATCONE (แชท LINE/Facebook/TikTok), MDM PJ-Soft (ล็อคเครื่อง), PaySolutions (QR)

---

## หมวดการตรวจสอบ

### หมวดที่ 1: Information Architecture & Navigation

**ไฟล์ที่ต้องตรวจ:**
- `apps/web/src/App.tsx` — routing structure
- `apps/web/src/components/MainLayout.tsx` — sidebar/navigation
- `apps/web/src/components/ProtectedRoute.tsx` — role-based access

**Checklist:**
- [ ] **Navigation Structure**: sidebar menu จัดกลุ่มเป็นหมวดหมู่ที่สมเหตุสมผล (Core, Inventory, Finance, Admin)
- [ ] **Menu Hierarchy**: ไม่เกิน 2 level — ไม่มี sub-menu ซ้อนลึกเกินไป
- [ ] **Active State**: menu item ที่เลือกอยู่มี visual indicator ชัดเจน
- [ ] **Breadcrumbs**: หน้า detail มี breadcrumb กลับไปหน้า list ได้
- [ ] **Role-based Menu**: แต่ละ role เห็นเฉพาะ menu ที่เกี่ยวข้อง — SALES ไม่เห็น Settings
- [ ] **Quick Access**: ฟังก์ชันที่ใช้บ่อย (POS, สร้างสัญญา) เข้าถึงได้ภายใน 1-2 clicks
- [ ] **Search/Command**: มีวิธี search หรือ navigate เร็ว (keyboard shortcut, command palette)
- [ ] **Page Titles**: ทุกหน้ามี title ที่ชัดเจน — browser tab แสดงชื่อหน้าถูกต้อง

---

### หมวดที่ 2: Consistency & Design System

**ไฟล์ที่ต้องตรวจ:**
- `apps/web/src/components/` — ทุก shared component
- `apps/web/src/pages/` — ทุก page (ตรวจ visual consistency)
- `apps/web/tailwind.config.ts` — design tokens

**Checklist:**
- [ ] **Color Palette**: ใช้ color tokens จาก Tailwind config สม่ำเสมอ — ไม่มี hardcoded hex
- [ ] **Typography**: heading sizes (h1-h4) ใช้ consistent ทุกหน้า — ไม่มี arbitrary font sizes
- [ ] **Spacing**: ใช้ Tailwind spacing scale (p-4, gap-6, etc.) สม่ำเสมอ — ไม่มี arbitrary px values
- [ ] **Buttons**: primary/secondary/destructive buttons ใช้ style เดียวกันทั้งระบบ
- [ ] **Forms**: input fields, labels, error messages มี style/layout consistent
- [ ] **Tables**: ทุก data table มี style เดียวกัน — header, row hover, sorting indicators
- [ ] **Cards**: card components มี padding, shadow, border-radius สม่ำเสมอ
- [ ] **Badges/Status**: status badges (ACTIVE, OVERDUE, PAID, etc.) ใช้ color scheme เดียวกันทั้งระบบ
- [ ] **Icons**: ใช้ lucide-react เท่านั้น — ไม่มี mixed icon libraries
- [ ] **Loading States**: skeleton/spinner ใช้ pattern เดียวกันทุกหน้า
- [ ] **Empty States**: ทุก list/table ที่ว่างมี meaningful empty state — ไม่ใช่ blank space
- [ ] **Error States**: error messages มี format/style เดียวกัน (toast หรือ inline)

---

### หมวดที่ 3: Usability & User Flows

**ไฟล์ที่ต้องตรวจ (ตรวจ flow ทั้ง page):**
- `apps/web/src/pages/POSPage.tsx` — ขายหน้าร้าน
- `apps/web/src/pages/ContractCreatePage/` — สร้างสัญญาผ่อน
- `apps/web/src/pages/ContractSignPage.tsx` — เซ็นสัญญา
- `apps/web/src/pages/PaymentsPage.tsx` — บันทึกการชำระ
- `apps/web/src/pages/CustomersPage.tsx` — จัดการลูกค้า
- `apps/web/src/pages/CustomerDetailPage.tsx` — รายละเอียดลูกค้า
- `apps/web/src/pages/StockPage/` — จัดการ stock
- `apps/web/src/pages/ExpensesPage.tsx` — บันทึกค่าใช้จ่าย

**Checklist:**
- [ ] **POS Flow**: ขายเงินสดทำได้ภายใน 3-4 steps — ไม่มีขั้นตอนที่ซ้ำซ้อน
- [ ] **Contract Flow**: สร้างสัญญาผ่อน → เลือกลูกค้า → เลือกสินค้า → กำหนดเงื่อนไข → preview → confirm — flow ชัดเจน
- [ ] **Payment Flow**: บันทึกชำระ → เลือกสัญญา → ใส่จำนวน → confirm — มี feedback ชัดเจน
- [ ] **Confirmation**: ทุก destructive action (ลบ, void, cancel) มี confirmation dialog
- [ ] **Success Feedback**: ทุก action สำเร็จมี toast notification + visual update
- [ ] **Form Validation**: validation errors แสดง inline ใต้ field ที่ผิด — ไม่ใช่แค่ alert/toast
- [ ] **Auto-save / Draft**: form ที่ซับซ้อน (สร้างสัญญา) มี draft/auto-save — ไม่สูญเสียข้อมูลเมื่อ navigate away
- [ ] **Undo/Back**: ทุก flow มี back button/cancel — ไม่มี dead-end
- [ ] **Progressive Disclosure**: ข้อมูลที่ซับซ้อนใช้ tabs/accordion — ไม่แสดงทุกอย่างพร้อมกัน
- [ ] **Shortcuts**: keyboard shortcuts สำหรับ power users (POS, search, navigation)

---

### หมวดที่ 4: Responsive Design & Mobile

**ไฟล์ที่ต้องตรวจ:**
- `apps/web/src/pages/` — ทุก page (ตรวจ responsive)
- `apps/web/src/pages/liff/` — LINE LIFF pages (mobile-first)
- `apps/web/src/hooks/useIsMobile.ts` — mobile detection
- `apps/web/src/components/MainLayout.tsx` — responsive layout

**Checklist:**
- [ ] **Breakpoints**: ใช้ Tailwind breakpoints (sm/md/lg/xl) สม่ำเสมอ
- [ ] **Desktop Layout**: sidebar + main content ใช้พื้นที่จอเต็ม — ไม่มี horizontal scroll
- [ ] **Tablet Layout**: sidebar collapsible — main content ปรับ width
- [ ] **Mobile Layout**: sidebar เป็น hamburger menu — content full-width
- [ ] **Tables on Mobile**: data tables มี horizontal scroll หรือ card layout สำหรับ mobile
- [ ] **Touch Targets**: buttons/links บน mobile ≥ 44x44px — ไม่มี target เล็กเกินไป
- [ ] **Forms on Mobile**: input fields full-width, keyboard type ถูกต้อง (numeric สำหรับเงิน)
- [ ] **LIFF Pages**: ทุก /liff/* page ออกแบบ mobile-first — ไม่มี layout แตก
- [ ] **Modal/Dialog on Mobile**: dialog ขนาดเหมาะสมบน mobile — ไม่ overflow
- [ ] **Print Layout**: หน้าที่ต้อง print (receipts, contracts) มี `@media print` styles

---

### หมวดที่ 5: Accessibility (a11y)

**ไฟล์ที่ต้องตรวจ:**
- `apps/web/src/components/` — ทุก shared component
- `apps/web/src/pages/` — ทุก page (ตรวจ semantic HTML)

**Checklist:**
- [ ] **Semantic HTML**: ใช้ `<main>`, `<nav>`, `<section>`, `<article>`, `<header>`, `<footer>` ถูกต้อง
- [ ] **Heading Hierarchy**: h1 → h2 → h3 ตาม hierarchy — ไม่ข้าม level
- [ ] **Alt Text**: ทุก `<img>` มี alt text — decorative images ใช้ `alt=""`
- [ ] **ARIA Labels**: interactive elements (buttons, links, icons) มี `aria-label` เมื่อไม่มี visible text
- [ ] **Color Contrast**: text/background contrast ratio ≥ 4.5:1 (AA standard)
- [ ] **Focus Management**: tab order ถูกต้อง — focus trap ใน modals — visible focus ring
- [ ] **Keyboard Navigation**: ทุก interactive element ใช้งานได้ด้วย keyboard เท่านั้น
- [ ] **Form Labels**: ทุก input มี `<label>` ที่ associated — ไม่ใช่แค่ placeholder
- [ ] **Error Announcements**: form errors ถูก announce สำหรับ screen readers (`role="alert"`)
- [ ] **Thai Language**: `lang="th"` ที่ `<html>` tag — screen readers อ่านภาษาไทยถูกต้อง
- [ ] **Radix UI**: ตรวจว่าใช้ Radix UI components ถูกต้อง — ไม่ override accessibility features

---

### หมวดที่ 6: Data Visualization & Dashboards

**ไฟล์ที่ต้องตรวจ:**
- `apps/web/src/pages/DashboardPage.tsx` — main dashboard
- `apps/web/src/pages/ReportsPage.tsx` — reports
- `apps/web/src/pages/ProfitLossPage.tsx` — P&L
- `apps/web/src/pages/FinancialAuditPage.tsx` — financial audit
- `apps/web/src/pages/FinanceReceivablePage.tsx` — receivables

**Checklist:**
- [ ] **KPI Cards**: ตัวเลขสำคัญ (ยอดขาย, ลูกหนี้, กำไร) แสดงเด่นชัด — มี trend indicator (↑↓)
- [ ] **Charts**: กราฟเข้าใจง่าย — มี labels, legends, tooltips
- [ ] **Date Range**: ทุก report มี date range picker — default ที่สมเหตุสมผล (เดือนปัจจุบัน)
- [ ] **Number Formatting**: ตัวเลขเงินมี comma separator + สกุลเงิน (฿) — ใช้ format เดียวกันทุกที่
- [ ] **Comparison**: มีข้อมูลเปรียบเทียบ (เดือนก่อน, ปีก่อน) — ช่วยตัดสินใจ
- [ ] **Drill-down**: กดที่ KPI/chart แล้วไปหน้ารายละเอียดได้
- [ ] **Export**: รายงานสำคัญ export เป็น PDF/Excel ได้
- [ ] **Real-time**: dashboard refresh อัตโนมัติ หรือมีปุ่ม refresh

---

### หมวดที่ 7: Micro-interactions & Polish

**ไฟล์ที่ต้องตรวจ:**
- ทุก page ที่ตรวจในหมวดก่อนหน้า

**Checklist:**
- [ ] **Loading**: API calls แสดง loading indicator — ไม่มี "flash of empty content"
- [ ] **Transitions**: page/component transitions smooth — ไม่กระตุก
- [ ] **Hover States**: interactive elements มี hover effect — cursor pointer
- [ ] **Disabled States**: buttons/inputs ที่ disabled มี visual indicator ชัดเจน + tooltip อธิบาย
- [ ] **Optimistic Updates**: actions ที่ simple (toggle, delete) update UI ทันทีก่อนรอ API
- [ ] **Skeleton Loading**: ใช้ skeleton screens แทน spinner สำหรับ initial page load
- [ ] **Toast Positioning**: toast notifications ไม่บัง content สำคัญ — position consistent
- [ ] **Copy to Clipboard**: ข้อมูลที่ user อาจต้อง copy (เลขสัญญา, เบอร์โทร) มี copy button
- [ ] **Date/Time Display**: แสดงเป็น Thai locale (พ.ศ. หรือ ค.ศ. ตามที่ตั้งค่า) — relative time สำหรับ recent items

---

## รูปแบบรายงานผลตรวจสอบ

```markdown
# UX/UI Review Report — BESTCHOICE
วันที่ตรวจสอบ: [วันที่]

## สรุปผลรวม
| หมวด | สถานะ | Critical | Warning | Suggestion |
|------|--------|----------|---------|------------|
| 1. Navigation & IA | PASS/FAIL | 0 | 0 | 0 |
| 2. Consistency | ... | ... | ... | ... |
| 3. Usability | ... | ... | ... | ... |
| 4. Responsive | ... | ... | ... | ... |
| 5. Accessibility | ... | ... | ... | ... |
| 6. Data Visualization | ... | ... | ... | ... |
| 7. Micro-interactions | ... | ... | ... | ... |

## UX Score Card
| Dimension | Score (1-5) | Notes |
|-----------|-------------|-------|
| Learnability | X | ผู้ใช้ใหม่เรียนรู้ระบบได้เร็วแค่ไหน |
| Efficiency | X | ผู้ใช้เดิมทำงานได้เร็วแค่ไหน |
| Consistency | X | ทุกหน้าดูเป็นระบบเดียวกัน |
| Error Prevention | X | ระบบป้องกันผู้ใช้ทำผิดพลาด |
| Accessibility | X | ผู้ใช้ทุกกลุ่มเข้าถึงได้ |
| Visual Design | X | ดูเป็นมืออาชีพ, สวยงาม |
| Mobile Experience | X | ใช้งานบน mobile ได้ดี |

## Critical Issues — ต้องแก้ทันที (ผู้ใช้ติดขัด, ใช้งานไม่ได้)
### [UX-C001] ชื่อประเด็น
- **หมวด**: X
- **หน้า**: path/to/page.tsx
- **ปัญหา**: อธิบาย + screenshot/description
- **ผลกระทบ**: user ทำ X ไม่ได้ / สับสน / ข้อมูลสูญหาย
- **แนวทางแก้ไข**: wireframe/description ของ solution

## Warning Issues — ควรแก้ไข (ใช้ได้แต่ไม่ดี)
### [UX-W001] ชื่อประเด็น
- (รูปแบบเดียวกัน)

## Suggestions — ข้อเสนอแนะ (ทำให้ดีขึ้น)
### [UX-S001] ชื่อประเด็น
- (รูปแบบเดียวกัน)

## Page-by-Page Summary
| Page | Status | Issues | Notes |
|------|--------|--------|-------|
| DashboardPage | OK/WARN/FAIL | UX-C001, UX-W003 | ... |
| POSPage | ... | ... | ... |
| (ทุกหน้า) | ... | ... | ... |

## Action Items
| # | Issue | Priority | Page | Est. Effort |
|---|-------|----------|------|-------------|
| 1 | ... | High/Med/Low | ... | S/M/L |
```

---

## ขอบเขตที่ไม่ต้องตรวจ

- ไม่ตรวจ business logic / API correctness
- ไม่ตรวจ code quality / TypeScript
- ไม่ตรวจ performance (backend)
- ไม่ต้อง implement fix — รายงานปัญหาพร้อม solution direction เท่านั้น

---

## วิธีใช้ Prompt นี้

1. **Copy Prompt ทั้งหมด** ไปใช้ใน Claude Code conversation ใหม่
2. Claude จะ **อ่านทุกหน้า** ที่ระบุในแต่ละหมวด
3. ตรวจสอบตาม **Checklist** ทีละข้อ
4. สร้าง **รายงาน** ตามรูปแบบที่กำหนดพร้อม UX Score Card
5. Review ผลและดำเนินการตาม Action Items

### คำสั่งเริ่มต้น:
```
ตรวจสอบ UX/UI ทั้งระบบ BESTCHOICE โดยใช้ Prompt ใน docs/prompts/UXUI-REVIEW-PROMPT.md — อ่านทุก page ที่ระบุ, ตรวจตาม Checklist ทุกข้อ, และสร้างรายงาน UX/UI Review Report พร้อม UX Score Card
```
