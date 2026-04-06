# Prompt: E2E Test ทั้งระบบ BESTCHOICE

## บทบาทของคุณ

คุณเป็น **Senior QA Engineer / Test Automation Expert** ที่เชี่ยวชาญ Playwright, TypeScript, และ E2E testing สำหรับ web applications มีหน้าที่ตรวจสอบ E2E test coverage ที่มีอยู่ เขียน test cases ที่ขาด และรัน tests ทั้งหมดให้ผ่าน

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

### Roles
| Role | ฝั่ง | หน้าที่ |
|------|-----|---------|
| OWNER | ทั้งหมด | ดูภาพรวม, อนุมัติ, ตั้งค่า, สั่งซื้อ |
| BRANCH_MANAGER | SHOP | จัดการสาขา |
| SALES | SHOP | ขายหน้าร้าน |
| FINANCE_MANAGER | FINANCE | ตรวจ/อนุมัติสัญญา+สินเชื่อ, อนุมัติค่าใช้จ่าย |
| ACCOUNTANT | FINANCE | รับค่างวด, ติดตามหนี้, นิติกรรม, บัญชี, ใบเสร็จ |

### ระบบภายนอก
- PEAK (บัญชี), CHATCONE (แชท LINE/Facebook/TikTok), MDM PJ-Soft (ล็อคเครื่อง), PaySolutions (QR)

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite (localhost:5173)
- **Backend**: NestJS + Prisma + PostgreSQL (localhost:3000)
- **E2E Framework**: Playwright
- **E2E Directory**: `apps/web/e2e/`
- **Test Account**: admin@bestchoice.com / admin1234
- **UI Language**: ภาษาไทย

### E2E Tests ที่มีอยู่แล้ว (25 files)
```
apps/web/e2e/
  admin-settings.spec.ts        # ตั้งค่าระบบ
  contract-workflow.spec.ts     # สร้าง/จัดการสัญญา
  contracts.spec.ts             # หน้าสัญญา
  credit-checks.spec.ts        # ตรวจสอบเครดิต
  crud-flows.spec.ts            # CRUD operations
  customers.spec.ts             # จัดการลูกค้า
  dashboard.spec.ts             # dashboard
  debt-collection.spec.ts       # ติดตามหนี้
  finance.spec.ts               # การเงิน
  installment-calculation.spec.ts # คำนวณผ่อนชำระ
  invite-resend.spec.ts         # ส่งคำเชิญ
  liff-pages.spec.ts            # LINE LIFF pages
  login.spec.ts                 # login/logout
  overdue.spec.ts               # ค้างชำระ
  page-smoke.spec.ts            # smoke test ทุกหน้า
  payments.spec.ts              # การชำระ
  pos-sales.spec.ts             # ขายหน้าร้าน
  procurement.spec.ts           # จัดซื้อ
  public-pages.spec.ts          # หน้า public
  reports-notifications.spec.ts # รายงาน + แจ้งเตือน
  role-access.spec.ts           # สิทธิ์ตาม role
  stock-management.spec.ts      # จัดการ stock
  template-editor.spec.ts       # แก้ไข template
  helpers/                      # shared test helpers
  global-setup.ts               # global setup (login state)
```

---

## ขั้นตอนการทำงาน

### Phase 1: Audit — ตรวจสอบ E2E Coverage ที่มีอยู่

**อ่านทุก test file ใน `apps/web/e2e/` แล้วประเมิน:**

- [ ] แต่ละ test file ครอบคลุม scenario อะไรบ้าง
- [ ] test ทั้งหมดรันผ่านหรือไม่ (รัน `cd apps/web && npx playwright test --reporter=list`)
- [ ] มี flaky tests หรือไม่ (tests ที่ผ่านบ้างไม่ผ่านบ้าง)
- [ ] test helpers มีอะไรบ้าง, ใช้ร่วมกันได้มากแค่ไหน

---

### Phase 2: Gap Analysis — หา test gaps

**เปรียบเทียบ test coverage กับหน้าเว็บและ features ทั้งหมด:**

#### 2.1 Page Coverage
| Page | มี E2E Test? | Test File | ขาดอะไร |
|------|-------------|-----------|---------|
| LoginPage | Y/N | login.spec.ts | ... |
| DashboardPage | Y/N | dashboard.spec.ts | ... |
| POSPage | Y/N | pos-sales.spec.ts | ... |
| CustomersPage | Y/N | customers.spec.ts | ... |
| CustomerDetailPage | Y/N | ... | ... |
| ContractsPage | Y/N | contracts.spec.ts | ... |
| ContractCreatePage | Y/N | contract-workflow.spec.ts | ... |
| ContractSignPage | Y/N | ... | ... |
| ContractDetailPage | Y/N | ... | ... |
| PaymentsPage | Y/N | payments.spec.ts | ... |
| ReceiptsPage | Y/N | ... | ... |
| StockPage | Y/N | stock-management.spec.ts | ... |
| StockTransfersPage | Y/N | ... | ... |
| StockAlertsPage | Y/N | ... | ... |
| StockAdjustmentsPage | Y/N | ... | ... |
| StockCountPage | Y/N | ... | ... |
| SuppliersPage | Y/N | ... | ... |
| PurchaseOrdersPage | Y/N | procurement.spec.ts | ... |
| OverduePage | Y/N | overdue.spec.ts | ... |
| ExchangePage | Y/N | ... | ... |
| RepossessionsPage | Y/N | ... | ... |
| CreditChecksPage | Y/N | credit-checks.spec.ts | ... |
| ExpensesPage | Y/N | ... | ... |
| ProfitLossPage | Y/N | ... | ... |
| ReportsPage | Y/N | reports-notifications.spec.ts | ... |
| FinancialAuditPage | Y/N | ... | ... |
| FinanceReceivablePage | Y/N | finance.spec.ts | ... |
| SalesHistoryPage | Y/N | ... | ... |
| ReceiptsPage | Y/N | ... | ... |
| AuditLogsPage | Y/N | ... | ... |
| UsersPage | Y/N | ... | ... |
| BranchesPage | Y/N | ... | ... |
| SettingsPage | Y/N | admin-settings.spec.ts | ... |
| InterestConfigPage | Y/N | ... | ... |
| ContractTemplatesPage | Y/N | template-editor.spec.ts | ... |
| NotificationsPage | Y/N | reports-notifications.spec.ts | ... |
| LIFF pages (5 หน้า) | Y/N | liff-pages.spec.ts | ... |

#### 2.2 Critical User Flows
ตรวจว่ามี E2E test ครอบคลุม flow สำคัญต่อไปนี้:

| Flow | มี Test? | Gaps |
|------|----------|------|
| **Login → Dashboard** | ? | ... |
| **POS: ขายเงินสด** (เลือกสินค้า → ใส่ราคา → confirm → พิมพ์ใบเสร็จ) | ? | ... |
| **POS: ขายผ่อน** (เลือกสินค้า → เลือก/สร้างลูกค้า → สร้างสัญญา → เซ็น → confirm) | ? | ... |
| **ชำระเงิน** (เลือกสัญญา → ใส่จำนวน → confirm → ออกใบเสร็จ) | ? | ... |
| **สร้างลูกค้าใหม่** (กรอกข้อมูล → บันทึก → เห็นในรายการ) | ? | ... |
| **ค้นหาลูกค้า** (พิมพ์ชื่อ/เบอร์ → เห็นผลลัพธ์ → กดเข้าดู) | ? | ... |
| **จัดการ Stock** (รับสินค้า → เห็นจำนวนเพิ่ม → โอนสาขา → เห็นจำนวนลด) | ? | ... |
| **ดูรายงาน** (เลือก date range → เห็นข้อมูล → export) | ? | ... |
| **ค้างชำระ** (ดูรายการ overdue → ส่ง notification → บันทึกติดตาม) | ? | ... |
| **อนุมัติค่าใช้จ่าย** (SALES สร้าง → OWNER อนุมัติ → สถานะเปลี่ยน) | ? | ... |
| **Early Payoff** (คำนวณ quote → ยืนยัน → ปิดสัญญา) | ? | ... |
| **สินค้าแลก/ยึดคืน** (เลือกสัญญา → บันทึก → stock update) | ? | ... |
| **LIFF: ลูกค้าดูสัญญา** (เปิด LINE → เห็นสัญญา → ดูประวัติชำระ) | ? | ... |

#### 2.3 Edge Cases & Error Scenarios
| Scenario | มี Test? |
|----------|----------|
| Login ผิด password 3+ ครั้ง (throttle) | ? |
| สร้างลูกค้าซ้ำ (เบอร์/บัตร ซ้ำ) | ? |
| ชำระเงินเกิน (overpayment) | ? |
| ชำระเงินบางส่วน (partial payment) | ? |
| สร้างสัญญาเมื่อ stock = 0 | ? |
| Upload ไฟล์ผิดประเภท/ใหญ่เกิน | ? |
| Session expired → redirect login | ? |
| Role access denied → แสดง 403 | ? |
| Network error → retry/error message | ? |
| Concurrent payment (double submit) | ? |
| คำนวณผ่อนด้วยค่าขอบเขต (0, negative, max) | ? |
| ดูหน้าที่ไม่มีข้อมูล (empty state) | ? |

---

### Phase 3: Write Missing Tests — เขียน test ที่ขาด

**แนวทางการเขียน test:**

```typescript
// Pattern: ใช้ test structure แบบนี้
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to page
  });

  test('should [expected behavior] when [action/condition]', async ({ page }) => {
    // Arrange: setup data/state
    // Act: perform action
    // Assert: verify result
  });
});
```

**Conventions:**
- ใช้ `test.describe()` จัดกลุ่ม tests ตาม feature
- Test name: `should [verb] when [condition]` (ภาษาอังกฤษ)
- ใช้ `data-testid` selectors เป็นหลัก — fallback เป็น role/text (ภาษาไทย)
- ทุก test ต้อง independent — ไม่พึ่ง state จาก test อื่น
- ใช้ helpers จาก `e2e/helpers/` สำหรับ login, navigation, common actions
- ใช้ `test.slow()` สำหรับ tests ที่ใช้เวลานาน
- ใช้ `expect.soft()` สำหรับ non-critical assertions ที่ไม่ต้องหยุด test

**ลำดับความสำคัญในการเขียน test:**
1. **P0 — Critical Flows**: Login, POS ขายเงินสด/ผ่อน, ชำระเงิน, สร้างสัญญา
2. **P1 — Core Business**: จัดการลูกค้า, Stock, ค้างชำระ, รายงาน
3. **P2 — Supporting**: ตั้งค่า, Users, Branches, Templates
4. **P3 — Edge Cases**: error scenarios, boundary values, concurrent operations

---

### Phase 4: Run & Fix — รัน tests ทั้งหมดให้ผ่าน

```bash
# รัน tests ทั้งหมด
cd apps/web && npx playwright test

# รัน specific test file
cd apps/web && npx playwright test e2e/[file].spec.ts

# รัน with browser visible (debug)
cd apps/web && npx playwright test --headed

# รัน with trace (สำหรับ debug failures)
cd apps/web && npx playwright test --trace on

# ดู test report
cd apps/web && npx playwright show-report
```

**เมื่อ test fail:**
1. อ่าน error message + screenshot (ถ้ามี)
2. ตรวจว่าเป็น bug จริง หรือ test ผิด
3. ถ้า test ผิด → แก้ test
4. ถ้า bug จริง → บันทึกใน report, ข้ามด้วย `test.fixme()` พร้อม comment

---

## รูปแบบรายงานผลตรวจสอบ

```markdown
# E2E Test Report — BESTCHOICE
วันที่ตรวจสอบ: [วันที่]

## Test Coverage Summary
| Metric | Count |
|--------|-------|
| Total test files | X |
| Total test cases | X |
| Passing | X |
| Failing | X |
| Skipped (fixme) | X |
| Flaky | X |
| New tests added | X |

## Page Coverage
| Page | Coverage | Test File | Tests | Status |
|------|----------|-----------|-------|--------|
| LoginPage | Full/Partial/None | login.spec.ts | X | PASS/FAIL |
| DashboardPage | ... | ... | ... | ... |
| (ทุกหน้า) | ... | ... | ... | ... |

## Critical Flow Coverage
| Flow | Status | Test File | Notes |
|------|--------|-----------|-------|
| POS ขายเงินสด | COVERED/PARTIAL/MISSING | pos-sales.spec.ts | ... |
| POS ขายผ่อน | ... | ... | ... |
| ชำระเงิน | ... | ... | ... |
| (ทุก flow) | ... | ... | ... |

## Bugs Found via E2E
### [BUG-001] ชื่อ bug
- **หน้า**: path/to/page
- **Steps to reproduce**: 1. ... 2. ... 3. ...
- **Expected**: ...
- **Actual**: ...
- **Screenshot**: (ถ้ามี)
- **Severity**: Critical/High/Medium/Low

## Flaky Tests
| Test | File | Flake Rate | Root Cause | Fix |
|------|------|------------|------------|-----|
| ... | ... | X% | ... | ... |

## Missing Tests (Prioritized)
| Priority | Feature/Flow | Reason | Est. Tests |
|----------|-------------|--------|------------|
| P0 | ... | ... | X |
| P1 | ... | ... | X |
| P2 | ... | ... | X |

## Test Infrastructure Notes
- Global setup working? Y/N
- Parallel execution? Y/N
- CI integration? Y/N
- Average run time: X minutes

## Action Items
| # | Action | Priority | Est. Effort |
|---|--------|----------|-------------|
| 1 | ... | P0/P1/P2/P3 | S/M/L |
```

---

## ขอบเขตที่ไม่ต้องตรวจ

- ไม่ตรวจ unit tests (backend/frontend)
- ไม่ตรวจ integration tests
- ไม่ตรวจ performance/load testing
- ไม่ตรวจ visual regression testing
- ไม่ตรวจ API tests (Postman/REST)

---

## วิธีใช้ Prompt นี้

1. **Copy Prompt ทั้งหมด** ไปใช้ใน Claude Code conversation ใหม่
2. Claude จะ **อ่านทุก test file** ที่มีอยู่ (Phase 1)
3. วิเคราะห์ **coverage gaps** เทียบกับทุกหน้าและ critical flows (Phase 2)
4. **เขียน test ใหม่** ตามลำดับความสำคัญ (Phase 3)
5. **รัน tests** ทั้งหมดให้ผ่าน (Phase 4)
6. สร้าง **รายงาน** ตามรูปแบบที่กำหนด

### คำสั่งเริ่มต้น:
```
ตรวจสอบและเขียน E2E tests ทั้งระบบ BESTCHOICE โดยใช้ Prompt ใน docs/prompts/E2E-TEST-PROMPT.md — Audit tests ที่มี, วิเคราะห์ gaps, เขียน tests ที่ขาด, รันให้ผ่านทั้งหมด, และสร้างรายงาน
```
