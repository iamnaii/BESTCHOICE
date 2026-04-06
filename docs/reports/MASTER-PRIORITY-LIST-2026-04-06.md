# Master Priority List — BESTCHOICE
วันที่: 2026-04-06
รวม findings จาก: Code Review, Accounting Audit, E2E Tests, UX/UI Review, Feature Recommendation

---

## Executive Summary

ตรวจสอบระบบ BESTCHOICE ครบ 6 ด้าน พบ:
- **Code Review**: 5 Critical, 13 Warning (security ผ่านหมด)
- **Accounting Audit**: 14 Critical, 20 Warning (โครงสร้างบัญชียังไม่แยก principal/interest)
- **E2E Tests**: 55% page coverage, 30% critical flow coverage, FINANCE_MANAGER 0%
- **UX/UI Review**: 4 Critical, 18 Warning (responsive/accessibility ดีเยี่ยม 9-10/10)
- **Feature Recommendation**: 35 features แนะนำ (P0: 2, P1: 12, P2: 12, P3: 9)

**ปัญหาใหญ่ที่สุด 3 อย่างที่ต้องแก้ก่อน:**
1. FINANCE_MANAGER role ไม่มีในระบบ (block ทุกอย่างฝั่ง FINANCE)
2. Multi-Entity Readiness (foundation สำหรับแยก 2 นิติบุคคล)
3. Payment ไม่แยก principal/interest (กระทบบัญชี, ภาษี, รายงานทุกตัว)

---

## Phase 0: Quick Fixes (ทำได้เลย ไม่กระทบ architecture)

### Code Fixes
| # | Source | Issue | Effort | Risk |
|---|--------|-------|--------|------|
| 1 | CR-DB-001 | Missing null/deletedAt check หลัง findUnique (4 จุด) | S | Low |
| 2 | CR-DB-002 | Soft delete ไม่ filter ใน reorder-points.service.ts | S | Low |
| 3 | CR-ERR-001 | Generic Error ใน utility functions → ใช้ NestJS exceptions | S | Low |
| 4 | CR-API-001~004 | Missing DTO validators (array items, password maxLength) | S | Low |
| 5 | AC-804 | Void expense ไม่ check OWNER role เมื่อ status=PAID | S | Low |
| 6 | PAY-002 | Late fee cap ตรวจสอบว่าไม่เกิน 5%/เดือนตามกฎหมาย | S | Medium |
| 7 | AC-504 | Bad debt provision ไม่รวม unpaid late fees | S | Low |
| 8 | AC-1204 | เพิ่ม nationalId/vendorTaxId ใน audit log sanitization | S | Low |

### UX Quick Fixes
| # | Source | Issue | Effort |
|---|--------|-------|--------|
| 9 | UX-W003 | สร้าง useStatusBadge() hook — badge colors consistent ทุกหน้า | S |
| 10 | UX-W005 | ใช้ EmptyState component แทน inline empty state ใน DataTable | S |
| 11 | UX-W008 | เพิ่ม loading spinner ตอน search ใน POS | S |
| 12 | UX-W013 | เพิ่ม tooltip อธิบาย dunning stages | S |

---

## Phase 1: FINANCE_MANAGER Role (Blocker — ต้องทำก่อนทุกอย่าง)

**ทำไมสำคัญ**: ทุก feature ฝั่ง FINANCE ต้องการ role นี้ ถ้าไม่มี → ไม่มีคนอนุมัติสัญญา, อนุมัติค่าใช้จ่าย, ดูรายงาน FINANCE

| # | Task | Effort |
|---|------|--------|
| 1 | เพิ่ม FINANCE_MANAGER ใน Prisma UserRole enum | S |
| 2 | สร้าง migration | S |
| 3 | อัปเดต Sidebar.tsx — เพิ่ม FINANCE_MANAGER ใน role checks | S |
| 4 | อัปเดต TopBar.tsx — เพิ่ม roleLabel + roleBadgeColor | S |
| 5 | อัปเดต MobileBottomNav.tsx — role-based tabs | M |
| 6 | อัปเดต role-access E2E tests | S |
| 7 | อัปเดต API controllers — เพิ่ม @Roles('FINANCE_MANAGER') ที่เกี่ยวข้อง | M |
| 8 | สร้าง seed data — FINANCE_MANAGER test user | S |

**Effort รวม**: M (1-2 สัปดาห์)
**Unlocks**: ทุก feature ฝั่ง FINANCE, role-specific dashboard, multi-entity

---

## Phase 2: Multi-Entity Foundation (Q2 2026)

**ทำไมสำคัญ**: เป็น foundation ของ tax reporting, PEAK sync, แยก P&L, และแยกนิติบุคคลในอนาคต

| # | Task | Source | Effort |
|---|------|--------|--------|
| 1 | สร้าง Company model (name, taxId, vatRegistered, bankAccounts) | F-C002 | M |
| 2 | เพิ่ม companyId ใน Branch, User, Contract, Sale, Expense | F-C002 | M |
| 3 | สร้าง CompanySettings page (OWNER only) | F-C002 | M |
| 4 | เพิ่ม Revenue accounts (4xxx) ในผังบัญชี | AC-001 | S |
| 5 | เพิ่ม Asset/VAT accounts ที่ขาด | AC-002 | S |
| 6 | สร้าง JournalEntry + JournalLine models | F-D002 | M |
| 7 | แยก P&L / Balance Sheet per company | F-012, AC-704 | L |
| 8 | อัปเดต inter-company ให้ใช้ Company model | F-C002 | M |
| 9 | Finance Receivable เพิ่ม tab BESTCHOICE FINANCE (ยอดที่ FINANCE จ่ายให้ SHOP) | UX | M |

**Effort รวม**: L (2-4 สัปดาห์)
**Unlocks**: Tax reporting, PEAK sync, แยกนิติบุคคล, SHOP เห็นยอดรอรับครบทั้ง GFIN + FINANCE

---

## Phase 3: Payment & Accounting Structure (Q2 2026)

**ทำไมสำคัญ**: แก้ปัญหาโครงสร้างบัญชีที่ "ไม่แยก" — กระทบ VAT, P&L, tax reporting ทั้งหมด

| # | Task | Source | Effort |
|---|------|--------|--------|
| 1 | เพิ่ม monthlyPrincipal, monthlyInterest, monthlyCommission ใน Payment model | PAY-001 | M |
| 2 | populate ค่าเหล่านี้ใน generatePaymentSchedule() | PAY-001 | M |
| 3 | แยก interest income เป็น account 4110 (ไม่ใช่ memo) | RC-002, RC-003 | M |
| 4 | แยก late fee income เป็น account 4120 | FIN-007, RC-006 | S |
| 5 | สร้าง VAT input/output tracking (accounts 2200, 2210, 2220) | VAT-003 | M |
| 6 | แยก VAT per entity (SHOP=0%, FINANCE=7%) | VAT-004 | M |
| 7 | แก้ early payoff ให้ใช้ actual Payment records แทน runtime calc | PAY-003, FIN-009 | M |
| 8 | อัปเดต costPrice เมื่อ repossess + refurbish | AC-702 | S |
| 9 | เพิ่ม Allowance for Doubtful Accounts ใน Balance Sheet | AC-506 | S |
| 10 | เพิ่ม Credit Balance เป็น liability ใน Balance Sheet | AC-505 | S |

**Effort รวม**: L (2-4 สัปดาห์)
**Unlocks**: ถูกต้องตาม TAS/TFRS, VAT filing, accurate P&L

---

## Phase 4: Tax & Compliance (Q2-Q3 2026)

| # | Task | Source | Effort |
|---|------|--------|--------|
| 1 | สร้าง TaxReport model + monthly VAT aggregation | F-C001 | L |
| 2 | สร้าง ภ.พ.30 report (VAT monthly) | F-C001 | M |
| 3 | สร้าง ภ.ง.ด.3/53 report (WHT monthly) | WHT-001 | M |
| 4 | เพิ่ม WhtIncomeType enum (แทน free-form string) | WHT-002 | S |
| 5 | PDPA: DSAR auto-response workflow | F-C004 | M |
| 6 | PDPA: data retention enforcement (auto-archive) | F-C004 | M |
| 7 | PDPA: consent revocation → stop notifications | F-C004 | S |

**Effort รวม**: L (2-4 สัปดาห์)
**Unlocks**: ปิดบัญชีได้เอง, ลด manual work 10+ ชม./เดือน

---

## Phase 5: Revenue & Operations (Q3 2026)

| # | Task | Source | Effort |
|---|------|--------|--------|
| 1 | **Sales Commission System** (rules, tracking, payout) | F-001, F-D003 | M |
| 2 | **Smart Dunning** (auto SMS/LINE before due, escalation rules) | F-004 | M |
| 3 | **Collections Workflow** (lane tracking, auto-escalation) | F-C003 | M |
| 4 | **PEAK Accounting Sync** (auto-export journal entries) | F-D002 | M |
| 5 | **MDM Integration** (auto-lock overdue phones via PJ-Soft) | F-C005 | L |
| 6 | **Dashboard แยกตาม role** (OWNER/SALES/FINANCE) | UX-C003 | M |
| 7 | **Payment slip OCR ให้เด่นชัด** (prominent upload button) | UX-C004 | S |

**Effort รวม**: XL (1+ เดือน)

---

## Phase 6: Integrations & CX (Q3-Q4 2026)

| # | Task | Source | Effort |
|---|------|--------|--------|
| 1 | **CHATCONE Integration** (unified chat LINE/FB/TikTok) | F-D001 | L |
| 2 | **Loyalty Points & Referral Program** | F-003 | M |
| 3 | **Trade-In Valuation** | F-002 | M |
| 4 | **Promotional Campaigns** | F-005 | M |
| 5 | **Webhook API** for external partners | F-D004 | L |
| 6 | **Advanced BI Dashboard** (cohort, forecast, heatmap) | F-013 | M |
| 7 | **PWA** (offline, install prompt, push notifications) | F-D005 | L |

**Effort รวม**: XL (1+ เดือน)

---

## Phase 7: E2E Test Coverage (ทำควบคู่กับทุก Phase)

| Priority | Tests ที่ต้องเขียน | เมื่อไหร่ |
|----------|-------------------|----------|
| P0 | POS Checkout, Contract Signing, Expense Approval (FINANCE_MANAGER) | หลัง Phase 1 |
| P0 | Customer Portal, Contract Verify | หลัง Phase 2 |
| P1 | Stock Count, CSV Import, Full Contract Wizard, Slip Review | หลัง Phase 3 |
| P1 | Branch Transfers, Supplier CRUD, PO Receiving | หลัง Phase 5 |
| P2 | Inspection, Exchange, Repossession, Reports Export | หลัง Phase 6 |

---

## Phase 8: UI Redesign (Q4 2026 — ทำหลังสุด)

ใช้ Metronic design system — ทำ 9 phases ตาม ui-redesign-prompt.md
**ทำหลัง features + fixes เสร็จ** เพื่อไม่ต้อง redesign ซ้ำ

---

## Timeline Summary

```
2026 เม.ย.  ┃ Phase 0: Quick Fixes (1 สัปดาห์)
            ┃ Phase 1: FINANCE_MANAGER Role (1-2 สัปดาห์)
            ┃
2026 พ.ค.   ┃ Phase 2: Multi-Entity Foundation (2-4 สัปดาห์)
            ┃ Phase 3: Payment & Accounting Structure (2-4 สัปดาห์)
            ┃
2026 มิ.ย.  ┃ Phase 4: Tax & Compliance (2-4 สัปดาห์)
            ┃
2026 ก.ค.   ┃ Phase 5: Revenue & Operations (1+ เดือน)
2026 ส.ค.   ┃
            ┃
2026 ก.ย.   ┃ Phase 6: Integrations & CX (1+ เดือน)
2026 ต.ค.   ┃
            ┃
2026 พ.ย.   ┃ Phase 8: UI Redesign (1-2 เดือน)
2026 ธ.ค.   ┃
```

Phase 7 (E2E Tests) ทำควบคู่กับทุก Phase

---

## VAT Deferred Issues (ข้ามไว้ — ตัดสินใจภายหลัง)

| # | Issue | เหตุผลที่ข้าม |
|---|-------|-------------|
| FIN-001 | VAT ไม่ถูกหักออกจาก Finance profit | ต้องตัดสินใจ policy ก่อน |
| FIN-006 | P&L ไม่แยก VAT จาก revenue | ขึ้นกับ Phase 3 |
| VAT-001 | VAT คำนวณบนดอกเบี้ย (ม.81(1)(ช)) | ต้องปรึกษานักบัญชีก่อน |
| FIN-005 | Down payment VAT treatment | ต้องตัดสินใจ policy |

---

## Refactoring (ทำเมื่อมีเวลา — ไม่เร่งด่วน)

| # | Issue | Source |
|---|-------|--------|
| 1 | LineOaController 1,806 บรรทัด → แยก 3 controllers | CR-CQ-001 |
| 2 | ContractDetailPage 1,048 บรรทัด → แยก sub-components | CR-CQ-003 |
| 3 | Business logic ใน controller → ย้ายไป service | CR-CQ-001 |
| 4 | เพิ่ม data-testid ใน components (ลด Thai text dependency ใน E2E) | E2E |
| 5 | Inventory costing method declaration (FIFO/Weighted Avg) | AC-705 |
| 6 | เพิ่ม md: breakpoint สำหรับ tablet | UX-W017 |

---

## Decision Log (ต้องตัดสินใจ)

| # | คำถาม | ต้องตัดสินใจเมื่อไหร่ | ใครตัดสินใจ |
|---|-------|---------------------|-----------|
| 1 | VAT คิดบนดอกเบี้ยหรือไม่ (ม.81(1)(ช)) | ก่อน Phase 3 | เจ้าของ + นักบัญชี |
| 2 | Inventory costing method (FIFO/Weighted Avg/Specific ID) | ก่อน Phase 3 | เจ้าของ + นักบัญชี |
| 3 | COGS timing — deferred หรือ immediate | ก่อน Phase 3 | เจ้าของ + นักบัญชี |
| 4 | Commission rate structure สำหรับ SALES | ก่อน Phase 5 | เจ้าของ |
| 5 | PEAK API spec + credentials | ก่อน Phase 5 | เจ้าของ |
| 6 | MDM PJ-Soft API spec + credentials | ก่อน Phase 5 | เจ้าของ |
| 7 | CHATCONE API spec + credentials | ก่อน Phase 6 | เจ้าของ |
| 8 | Native app vs PWA | Q4 2026 | เจ้าของ |
