# 🛠️ DEV ACTION ITEMS · Business Expense Module

> **Transcribed from `Dev_Action_Items_v1.0.pdf` (32 pages) on 2026-05-16.**
> Original PDF in 2026-05-16 conversation history.

**Post-Audit Action List** — สิ่งที่ Dev ต้องแก้ไขเพิ่มเติม
ตามผลการตรวจสอบ PDF Audit Report (deploy 2026-05-11)

**BESTCHOICE FINANCE × SHOP** · พฤษภาคม 2569

---

## 📊 สถานะการแก้ไขจาก Fix Report v1.0

- ✅ ทำครบแล้ว **10/12 ข้อ** (P0-1, P0-2, P0-3, P0-4, P1-1, P1-2, P1-3, P1-4, P2-1, P2-2, P2-3, P2-4)
- ⚠ ต้องตรวจ/แก้เพิ่ม **5 ข้อ** (ในเอกสารฉบับนี้)

### Compliance Score:
- **ก่อนแก้:** C+ (65/100)
- **หลังแก้:** A (88/100) — เกือบตรง Spec ที่ A (90/100)

### เอกสารฉบับนี้สำหรับ:
- **Backend Dev** — แก้ role mapping + ขยาย Adjustment scope
- **DBA** — รัน verification queries + cleanup migration
- **QA** — ยืนยัน Suite J + K + เพิ่ม test cases ใหม่

---

## 📑 สารบัญ

- **Action #1:** แก้ adj_underpay role mapping (CRITICAL) — P0 · แก้บัญชี + ตัวอย่างใน PDF
- **Action #2:** ขยาย Multi-line Adjustment → SETTLEMENT — P1 · feature ขาด
- **Action #3:** ตรวจสอบ Reclassify Migration ตกหล่น — P1 · data integrity
- **Action #4:** ยืนยัน Test Suite J + K ครบ — P2 · verification
- **Action #5:** ตามค่าเสื่อม มี.ค.-เม.ย. 2569 ที่หาย — P1 · historical data
- **ภาคผนวก A:** Code Patches พร้อม Apply
- **ภาคผนวก B:** SQL Verification Queries
- **ภาคผนวก C:** Test Cases ใหม่ (J-04, K-07, K-08)
- **ภาคผนวก D:** Sign-off Checklist สำหรับ Owner

---

## Action #1: แก้ adj_underpay Role Mapping

> **Priority:** P0 (Critical — ผิดบัญชีในตัวอย่าง JE)
> **Owner:** Backend Dev + DBA
> **Estimated effort:** 30 นาที (รัน SQL + verify)
> **Deadline:** ก่อนปิดงวด พ.ค. 2569

### 1.1 ปัญหาที่พบ

ใน PDF Audit Report หน้า 10 (Section 6.3) — ตัวอย่าง JE "จ่ายน้อยกว่า 0.50 บ":

```
// ตัวอย่างใน PDF (ผิด):
ใบกำกับ 100 บ + VAT 7 บ = 107 บ, จ่ายจริง 106.50 บ

Dr 53-1302 ค่าใช้จ่าย   100.00
Dr 11-4101 ภาษีซื้อ      7.00
   Cr 11-1101 เงินสด    106.50
   Cr 53-1503 ปัดเศษ      0.50  ← ❌ผิด direction
                                (เป็น underpay แต่ใช้บัญชี overpay)
```

### 1.2 สเปคที่ถูกต้องตาม Fix Report v1.0

| Role | Account | ใช้เมื่อ | Direction |
|---|---|---|---|
| adj_overpay | 53-1503 กำไร/ขาดทุน-สุทธิปัดเศษ | จ่ายเกินกว่ายอด (overpay) | Cr |
| adj_underpay | 52-1104 ส่วนลดไม่จ่ายเศษสตางค์ | จ่ายน้อยกว่ายอด (underpay) | Cr |

**เหตุผลทางบัญชี:**
- จ่ายน้อยกว่า = supplier ให้ส่วนลดเศษสตางค์ → ควรเข้า 52-1104 (Selling Expense — ลดค่าใช้จ่ายฝั่งเรา)
- จ่ายเกิน = ปัดเศษเพิ่ม (loss on rounding) → เข้า 53-1503 (Admin Expense)
- ทั้งสองบัญชีอยู่คนละหมวด แม้ยอดรวมเท่ากัน แต่ P&L breakdown ต่างกัน → auditor จะ flag

### 1.3 ขั้นตอนการแก้ไข

#### Step 1: ตรวจสอบ database ปัจจุบัน

```sql
-- ตรวจ role_map ปัจจุบัน
SELECT role, account_code, priority, is_active
FROM account_role_map
WHERE role IN ('adj_overpay', 'adj_underpay')
ORDER BY role, priority;

-- คาดหวัง:
-- adj_overpay  | 53-1503 | 1 | TRUE
-- adj_underpay | 52-1104 | 1 | TRUE  ← ถ้าเป็น 53-1503 ต้องแก้
```

#### Step 2: แก้ไขถ้าผิด

```sql
BEGIN;

-- ถ้า adj_underpay เป็น 53-1503 ให้เปลี่ยนเป็น 52-1104
UPDATE account_role_map
SET account_code = '52-1104',
    updated_at = NOW()
WHERE role = 'adj_underpay'
  AND account_code = '53-1503';

-- Audit log
INSERT INTO audit_log (event_type, actor, note, created_at)
VALUES (
  'ROLE_MAP_FIX',
  'system',
  'Fix adj_underpay: 53-1503 → 52-1104 per Fix Report v1.0',
  NOW()
);

COMMIT;
```

#### Step 3: ตรวจ JE ที่ใช้บัญชีผิดไปแล้ว

```sql
-- หา JE adjustment ที่ใช้ 53-1503 แต่จริงๆ ควรเป็น 52-1104
-- (เกิดจากกรณี underpay ที่ใช้บัญชีผิด)
SELECT
  je.id              AS journal_entry_id,
  je.posted_at,
  ed.doc_no,
  ea.side            AS adj_side,
  ea.amount          AS adj_amount,
  ea.account_code,
  ea.note
FROM expense_adjustments ea
JOIN expense_documents ed ON ed.id = ea.document_id
JOIN journal_entries je   ON je.metadata->>'documentId' = ed.id::text
WHERE ea.account_code = '53-1503'
  AND ea.side = 'CR'   -- Cr ของ adj แปลว่า underpay
  AND je.posted_at >= '2026-05-11'
ORDER BY je.posted_at DESC;

-- ถ้า > 0 rows → ต้องสร้าง adjusting JE
```

#### Step 4: สร้าง Adjusting JE (ถ้ามี data ผิด)

```
-- สำหรับแต่ละ row ที่พบใน Step 3 ให้สร้าง adjusting JE:
-- Dr 53-1503 (กลับรายการเดิม)
-- Cr 52-1104 (ลงบัญชีถูก)

-- ตัวอย่าง (manual entry ผ่าน /accounting/journal-entries/new):
  type:        ADJUSTING
  posted_at:   วันที่ทำ adjustment
  reference:   'Reclass adj_underpay per Action #1 — original JE-XXXXX'
  lines: [
    { account: '53-1503', dr: amount, note: 'Reverse misclassified' },
    { account: '52-1104', cr: amount, note: 'Reclass to ส่วนลดไม่จ่ายเศษสตางค์' }
  ]
```

### 1.4 Code Patch — Frontend Default

ใน Section 5 Multi-line Adjustment UI ของ ExpenseFormV4 — แก้ default account ตาม direction:

```javascript
// AdjustmentTable.tsx

function getDefaultAccount(direction, diff) {
  // diff > 0 = จ่ายเกิน (overpay) → 53-1503
  // diff < 0 = จ่ายน้อย (underpay) → 52-1104
  if (diff > 0) {
    return roles.code('adj_overpay');   // 53-1503
  } else {
    return roles.code('adj_underpay');  // 52-1104  ← แก้จาก 53-1503
  }
}

// แก้ที่ component:
const addAdjustment = (preFillAmount) => {
  const defaultAcc = getDefaultAccount(direction, diff);
  // ...
};
```

---

## Action #2: ขยาย Multi-line Adjustment → SETTLEMENT

> **Priority:** P1 (High — feature ขาดสำหรับ use case หลัก)
> **Owner:** Backend Dev + Frontend Dev
> **Estimated effort:** 4-6 ชั่วโมง
> **Deadline:** Sprint ถัดไป

### 2.1 ปัญหาที่พบ

PDF หน้า 10 ระบุข้อจำกัด:

> Adjustment รองรับเฉพาะ EXPENSE_SAMEDAY เท่านั้น — ACCRUAL/CN/PAYROLL ยังไม่ support
> (ACCRUAL ไม่มี cash leg, CN เป็น reversal, PAYROLL มีโครงสร้างต่าง)

แต่ Fix Report v1.0 ต้องการให้รองรับ SETTLEMENT ด้วย เพราะเป็น use case หลัก

### 2.2 Use Case ที่ขาด — Settlement Adjustment

**ตัวอย่าง 1: จ่ายเจ้าหนี้ + ส่วนลด**

```
Scenario:
  EX-2604300001 (ACCRUAL) — ตั้งหนี้ค่าซ่อม 10,000 + VAT 700 = 10,700
  วันจ่ายจริง 10/05 — supplier ให้ส่วนลด 200 บ จ่ายแค่ 10,500

JE ที่ต้องการ (SETTLEMENT + Adjustment):
  Dr 21-1104 เจ้าหนี้      10,700.00
     Cr 11-1201 ธ.KBank             10,500.00
     Cr 52-1104 ส่วนลดได้รับ           200.00  ← Adjustment
                            ─────────  ─────────
                  Dr รวม = 10,700  Cr รวม = 10,700  ✓ BALANCED
```

**ตัวอย่าง 2: จ่ายเจ้าหนี้ + WHT + ผลต่าง**

```
Scenario:
  EX (ACCRUAL) — ตั้งหนี้ค่าบริการ 30,000 (ไม่มี VAT)
  วันจ่ายจริง: หัก WHT 3% (900) จ่ายสุทธิ 29,000 บ (ปัดเศษ 100)

JE ที่ต้องการ:
  Dr 21-1104 เจ้าหนี้       30,000.00
     Cr 11-1201 ธ.KBank             29,000.00
     Cr 21-3103 ภงด.53                900.00  ← WHT (ม.50)
     Cr 52-1104 ส่วนลด                100.00  ← Adjustment
                            ─────────  ─────────
                  Dr รวม = 30,000  Cr รวม = 30,000  ✓ BALANCED
```

### 2.3 Code Changes ที่ต้องทำ

#### Backend — expense-settlement.template.ts

```javascript
// เดิม (ไม่รองรับ adjustment):
function generateSettlementJE(settlement, parents) {
  const lines = [];
  const apTotal = parents.reduce((s, p) => s + p.ap_balance, 0);

  lines.push({ account: role('payable_default').code, dr: apTotal });
  lines.push({ account: settlement.payment_account, cr: settlement.amount_paid });

  if (settlement.wht_amount > 0) {
    const whtRole = settlement.supplier_type === 'juristic'
      ? 'wht_juristic' : 'wht_individual';
    lines.push({ account: role(whtRole).code, cr: settlement.wht_amount });
  }
  return lines;
}

// ใหม่ (รองรับ adjustment):
function generateSettlementJE(settlement, parents) {
  const lines = [];
  const apTotal = parents.reduce((s, p) => s + p.ap_balance, 0);

  lines.push({ account: role('payable_default').code, dr: apTotal });
  lines.push({ account: settlement.payment_account, cr: settlement.amount_paid });

  if (settlement.wht_amount > 0) {
    const whtRole = settlement.supplier_type === 'juristic'
      ? 'wht_juristic' : 'wht_individual';
    lines.push({ account: role(whtRole).code, cr: settlement.wht_amount });
  }

  // ✅ NEW: รองรับ Multi-line Adjustment
  if (settlement.adjustments?.length > 0) {
    settlement.adjustments.forEach(adj => {
      if (adj.side === 'DR') {
        lines.push({ account: adj.account_code, dr: adj.amount, note: adj.note });
      } else {
        lines.push({ account: adj.account_code, cr: adj.amount, note: adj.note });
      }
    });
  }

  return lines;
}
```

#### Backend — expense-documents.service.ts (Validation)

```javascript
// V12 ต้องรองรับ SETTLEMENT ด้วย
function validateAdjustmentSum(doc) {
  // diff = amountPaid - netExpected
  // สำหรับ SAMEDAY: netExpected = total - wht
  // สำหรับ SETTLEMENT: netExpected = apTotal - wht
  let netExpected;
  if (doc.doc_type === 'EXPENSE_SAMEDAY') {
    netExpected = doc.total_amount - doc.wht_amount;
  } else if (doc.doc_type === 'VENDOR_SETTLEMENT') {
    const apTotal = doc.parent_docs.reduce((s, p) => s + p.ap_balance, 0);
    netExpected = apTotal - doc.wht_amount;
  } else {
    return; // CN/ACCRUAL/PAYROLL ไม่ support
  }

  const diff = doc.amount_paid - netExpected;
  const adjSum = doc.adjustments.reduce((s, a) =>
    s + (a.side === 'DR' ? a.amount : -a.amount), 0);

  if (Math.abs(diff - adjSum) > 0.001) {
    throw new BadRequestException(
      `V12: ผลรวม adjustments (${adjSum}) ≠ diff (${diff})`
    );
  }
}
```

#### Frontend — เพิ่ม Section 5 ใน Settlement Form

```jsx
// SettlementFormV4.tsx
// เพิ่ม Section 5 (Multi-line Adjustment) แบบเดียวกับ ExpenseFormV4

<SectionCard no="5" title="บัญชีปรับผลต่าง (Multi-line)" icon={TrendingDown}>
  {/* แสดงเฉพาะเมื่อ |diff| > 0.001 */}
  {Math.abs(diff) > 0.001 && (
    <AdjustmentTable
      adjustments={settlement.adjustments}
      onChange={(adjs) => updateSettlement('adjustments', adjs)}
      diff={diff}
      defaultAccount={getDefaultAccount(diff > 0 ? 'overpay' : 'underpay')}
    />
  )}
</SectionCard>
```

### 2.4 Database Migration

```sql
-- ตรวจดูตาราง expense_adjustments — ดูว่า document_id FK รองรับ SETTLEMENT ไหม
\d expense_adjustments

-- ถ้า FK ผูกกับ expense_documents (polymorphic) → OK ไม่ต้องแก้ schema
-- ถ้าจำกัด doc_type → ต้อง relax constraint:

ALTER TABLE expense_adjustments
  DROP CONSTRAINT IF EXISTS chk_adj_doc_type;

ALTER TABLE expense_adjustments
  ADD CONSTRAINT chk_adj_doc_type CHECK (
    EXISTS (
      SELECT 1 FROM expense_documents
      WHERE id = expense_adjustments.document_id
        AND document_type IN ('EXPENSE_SAMEDAY', 'VENDOR_SETTLEMENT')
    )
  );
```

---

## Action #3: ตรวจ Reclassify Migration ตกหล่น

> **Priority:** P1 (Data Integrity)
> **Owner:** DBA
> **Estimated effort:** 15 นาที (รัน SQL)
> **Deadline:** ภายในสัปดาห์นี้

### 3.1 ปัญหาที่พบ

PDF ใช้ filter:
```
WHERE flow = 'expense-payroll'
  AND accountCode = '21-1104'
  AND description ILIKE '%ประกันสังคม%'   ← Thai keyword
```

แต่ Fix Report v1.0 แนะนำให้ใช้ keyword "SSO" (อังกฤษ) ซึ่งอาจมีใน JE เก่าที่ใช้ภาษาอังกฤษ:
```
WHERE jl.line_note ILIKE '%SSO%'   ← English keyword
```

ถ้า JE เก่ามี line_note เป็นภาษาอังกฤษ ("SSO ลูกจ้าง — placeholder") → จะตกหล่นไม่ถูก migrate

### 3.2 Verification Query

```sql
-- หา rows ที่อาจตกหล่นจาก migration
SELECT
  je.id,
  je.posted_at,
  je.metadata->>'flow'  AS flow,
  jl.account_code,
  jl.cr_amount,
  jl.line_note,
  jl.description
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.metadata->>'flow' = 'expense-payroll'
  AND jl.account_code = '21-1104'
  AND jl.cr_amount > 0
  AND (
    jl.line_note    ILIKE '%SSO%'           -- English
    OR jl.description ILIKE '%SSO%'           -- English
    OR jl.line_note    ILIKE '%ประกันสังคม%'  -- Thai
    OR jl.description ILIKE '%ประกันสังคม%'  -- Thai
  )
  AND jl.line_note NOT ILIKE '%[migrated 2026-05-11%'
ORDER BY je.posted_at DESC;

-- หาก count > 0 → มี rows ตกหล่น ต้อง migrate เพิ่ม
```

### 3.3 Cleanup Migration (ถ้ามี rows ตกหล่น)

```sql
-- Migration: cleanup_remaining_sso_2026-05-XX.sql
-- ⚠ Backup DB ก่อนรัน

BEGIN;

WITH remaining_sso AS (
  SELECT jl.id, jl.cr_amount
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.metadata->>'flow' = 'expense-payroll'
    AND jl.account_code = '21-1104'
    AND jl.cr_amount > 0
    AND (
      jl.line_note    ILIKE '%SSO%'
      OR jl.description ILIKE '%SSO%'
      OR jl.line_note    ILIKE '%ประกันสังคม%'
      OR jl.description ILIKE '%ประกันสังคม%'
    )
    AND jl.line_note NOT ILIKE '%[migrated%'
)
UPDATE journal_lines jl
SET account_code = '21-3105',
    account_name = 'เงินสมทบประกันสังคม-พนักงานค้างนำส่ง',
    line_note    = COALESCE(jl.line_note, '') ||
                   ' [migrated 2026-05-XX cleanup pass]'
FROM remaining_sso
WHERE jl.id = remaining_sso.id;

-- Audit log
INSERT INTO audit_log (event_type, actor, note, created_at)
VALUES (
  'MIGRATION_CLEANUP',
  'system',
  'Cleanup remaining SSO rows missed in original migration',
  NOW()
);

COMMIT;
```

### 3.4 Final Verification

```sql
-- ตรวจหลัง cleanup — ต้องไม่มี SSO ค้างใน 21-1104 อีก
SELECT
  COUNT(*)            AS remaining_sso_count,
  SUM(jl.cr_amount)   AS remaining_sso_amount
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.metadata->>'flow' = 'expense-payroll'
  AND jl.account_code = '21-1104'
  AND jl.cr_amount > 0
  AND jl.line_note NOT ILIKE '%[migrated%';

-- Expected: 0 rows, 0 amount

-- เปรียบเทียบ Trial Balance ก่อน/หลัง
-- 21-1104 + 21-3105 + 21-3106 ต้องเท่ากันทั้งก่อนและหลัง migration
```

---

## Action #4: ยืนยัน Test Suite J + K

> **Priority:** P2 (Verification)
> **Owner:** QA Engineer + Backend Dev
> **Estimated effort:** 2-4 ชั่วโมง (ถ้ายังไม่มี)
> **Deadline:** ก่อน Sprint ถัดไป

### 4.1 Test Cases ที่ต้องมี

ตาม Fix Report v1.0 — Suite J (SSO) + Suite K (Critical Fixes) มี 12 test cases รวม:

#### Suite J: SSO Accounting

| ID | Test Case | Expected |
|---|---|---|
| J-01 | PAYROLL JV — ตรวจ Cr 21-3105 = sso_employee_amount | Pass |
| J-02 | PAYROLL JV — ตรวจ Cr 21-3106 = sso_employer_amount | Pass |
| J-03 | PAYROLL JV — ตรวจ Dr 53-1102 = sso_employer_amount | Pass |
| J-04 | calculateSSO(20,000) = 750 (เพดาน) | 750 |
| J-05 | calculateSSO(10,000) = 500 (5% ของฐาน) | 500 |
| J-06 | Trial Balance — 21-1104 ไม่มี SSO ปนแล้ว | Σ SSO in 21-1104 = 0 |

> Note: J-04 expectation is 750 from original PDF (pre-2569 ceiling). After SSO 875 change in v2.0, J-04 should expect 875.

#### Suite K: Critical Fixes Verification

| ID | Test Case | Expected |
|---|---|---|
| K-01 | ทุก JV ที่มี VAT > 0 → Dr 11-4101 (ไม่ใช่ 11-2104) | Pass |
| K-02 | ACCRUAL JV1 ห้ามมี WHT row (throw V15) | BadRequestException |
| K-03 | SETTLEMENT JV ของ ACCRUAL เดิม → WHT เกิดที่นี่ | Pass |
| K-04 | ภพ.30 — ใช้ยอด 11-4101 ขอคืน VAT ได้ | Match |
| K-05 | Multi-line Adjustment — diff = 0 → POST ได้ | Pass |
| K-06 | Multi-line Adjustment — Σ amount ≠ \|diff\| → V12 block | BadRequestException |

### 4.2 Test Code Templates

ถ้ายังไม่มี ให้สร้างใน `apps/api/test/expense/`

#### payroll-sso.spec.ts (Suite J)

```javascript
import { Test } from '@nestjs/testing';
import { ExpenseDocumentsService } from '../../src/modules/expense-documents/expense-documents.service';
import { calculateSSO } from '../../src/modules/payroll/sso.util';

describe('Suite J: SSO Accounting', () => {
  let service: ExpenseDocumentsService;

  beforeAll(async () => { /* setup */ });

  it('J-04: calculateSSO(20,000) = 750 (เพดาน)', () => {
    expect(calculateSSO(20000)).toBe(750);
  });

  it('J-05: calculateSSO(10,000) = 500 (5%)', () => {
    expect(calculateSSO(10000)).toBe(500);
  });

  it('J-01,J-02,J-03: PAYROLL JE มี Dr 53-1102 + Cr 21-3105 + Cr 21-3106', async () => {
    const payroll = await service.createPayroll({
      employees: [{ name: 'Test', gross_salary: 30000, wht: 800 }],
      payment_account: '11-1201',
    });
    const je = await service.post(payroll.id);
    const lines = await service.getJournalLines(je.id);

    expect(lines.find(l => l.account_code === '53-1102')?.dr_amount).toBe(750);
    expect(lines.find(l => l.account_code === '21-3105')?.cr_amount).toBe(750);
    expect(lines.find(l => l.account_code === '21-3106')?.cr_amount).toBe(750);
  });

  it('J-06: 21-1104 ไม่มี SSO ปนแล้ว', async () => {
    const ssoInAP = await service.queryLines({
      account_code: '21-1104',
      flow: 'expense-payroll',
      noteFilter: 'SSO|ประกันสังคม',
    });
    expect(ssoInAP.length).toBe(0);
  });
});
```

#### critical-fixes.spec.ts (Suite K)

```javascript
describe('Suite K: Critical Fixes Verification', () => {
  it('K-01: VAT JE ใช้ Dr 11-4101 (ไม่ใช่ 11-2104)', async () => {
    const ex = await service.createSameday({
      supplier_id: 'S-001',
      items: [{ account: '53-1302', amount: 1000, vat_pct: 7 }],
      payment_account: '11-1101',
      amount_paid: 1070,
    });
    const je = await service.post(ex.id);
    const lines = await service.getJournalLines(je.id);

    expect(lines.find(l => l.account_code === '11-4101')?.dr_amount).toBe(70);
    expect(lines.find(l => l.account_code === '11-2104')).toBeUndefined();
  });

  it('K-02: ACCRUAL + WHT → throw V15', async () => {
    const accrual = await service.createAccrual({
      supplier_id: 'S-001',
      items: [{ account: '53-1402', amount: 30000, wht_pct: 5 }],
    });
    await expect(service.post(accrual.id)).rejects.toThrow(/V15.*ACCRUAL.*WHT/);
  });

  it('K-06: Adjustment Σ ≠ |diff| → V12 block', async () => {
    const ex = await service.createSameday({
      items: [{ account: '53-1302', amount: 100, vat_pct: 7 }],
      amount_paid: 106.50,  // diff = -0.50
      adjustments: [{ account: '52-1104', side: 'CR', amount: 1.00 }],  // wrong
    });
    await expect(service.post(ex.id)).rejects.toThrow(/V12/);
  });
});
```

---

## Action #5: ตามค่าเสื่อม มี.ค.-เม.ย. 2569

> **Priority:** P1 (Historical Data Integrity)
> **Owner:** Backend Dev + Accountant
> **Estimated effort:** 1-2 ชั่วโมง
> **Deadline:** ก่อนปิดงวด พ.ค. 2569

### 5.1 ปัญหาที่พบ

PDF Section 2.1 ระบุ: cron ค่าเสื่อม UTC vs BKK timezone bug — ไม่เคยรันจริงในงวด มี.ค.-เม.ย. 2569

**ผลกระทบ:**
- งบกำไรขาดทุนเดือน มี.ค.-เม.ย. ขาดค่าเสื่อมราคา
- NBV บนงบดุลไม่ลดลงตามอายุการใช้งาน
- asset_register ไม่ update accumulatedDepr
- ภาษีนิติบุคคล: ค่าใช้จ่ายที่หักได้ขาดไป → กำไรสุทธิเพิ่ม → จ่ายภาษีเกิน

### 5.2 Verification Query

```sql
-- ตรวจว่ามี JE_DEPRECIATION ของงวด มี.ค.-เม.ย. 2569 หรือไม่
SELECT
  date_trunc('month', je.posted_at)  AS period,
  COUNT(*)                            AS depreciation_count,
  SUM(jl.dr_amount)                   AS total_depreciation
FROM journal_entries je
JOIN journal_lines jl ON jl.journal_entry_id = je.id
WHERE je.type = 'AUTO'
  AND je.metadata->>'flow' = 'asset-depreciation'
  AND jl.account_code LIKE '53-16%'   -- หมวดค่าเสื่อม
  AND jl.dr_amount > 0
  AND je.posted_at >= '2026-03-01'
  AND je.posted_at < '2026-05-01'
GROUP BY 1
ORDER BY 1;

-- Expected: ควรมี 2 rows (มี.ค. + เม.ย.) แต่ละ row มี depreciation_count > 0
-- ถ้า count = 0 → ค่าเสื่อมหายจริง
```

### 5.3 Recovery Steps

#### Option A: รัน manual ผ่าน endpoint (แนะนำ)

```bash
# Trigger depreciation cron manually for missing periods
# (Backend ต้องมี endpoint POST /depreciation/run?period=YYYY-MM)

# งวด มี.ค.
curl -X POST 'https://api.bestchoicephone.app/depreciation/run' \
  -H 'Authorization: Bearer $OWNER_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"period": "2026-03", "reason": "Catch up missed cron — CPA C-1"}'

# งวด เม.ย.
curl -X POST 'https://api.bestchoicephone.app/depreciation/run' \
  -H 'Authorization: Bearer $OWNER_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"period": "2026-04", "reason": "Catch up missed cron — CPA C-1"}'
```

#### Option B: สร้าง Adjusting JE Manual

```sql
-- สำหรับแต่ละ asset ที่ POSTED ก่อน มี.ค. 2569 + ยังไม่ disposed:
WITH active_assets AS (
  SELECT id, code, purchase_cost, depreciation_period_months,
         purchase_date, accumulated_depr
  FROM asset_register
  WHERE status = 'ACTIVE'
    AND purchase_date < '2026-03-01'
)
SELECT
  code,
  purchase_cost,
  depreciation_period_months,
  ROUND(purchase_cost / depreciation_period_months, 2)     AS monthly_amount,
  ROUND(purchase_cost / depreciation_period_months * 2, 2) AS missed_2_months
FROM active_assets;

-- ใช้ result นี้สร้าง Adjusting JE 1 ใบสำหรับ มี.ค. และ 1 ใบสำหรับ เม.ย.:
-- Dr 53-1601 ค่าเสื่อม [asset code]   monthly_amount
-- Cr 12-22XX ค่าเสื่อมสะสม             monthly_amount
```

### 5.4 Verification หลัง Recovery

```sql
-- รัน verification query (จาก 5.2) อีกครั้ง
-- คาดหวัง: มี JE depreciation ของ มี.ค.-เม.ย. ครบทุก asset

-- ตรวจ NBV ของ asset
SELECT
  ar.code,
  ar.purchase_cost,
  ar.accumulated_depr,
  (ar.purchase_cost - ar.accumulated_depr) AS nbv
FROM asset_register ar
WHERE ar.status = 'ACTIVE'
ORDER BY ar.code;

-- เปรียบเทียบกับ Trial Balance:
-- 12-2XXX (accumulated depreciation) ควรเท่ากับ Σ asset.accumulated_depr
```

---

## ภาคผนวก A: Code Patches พร้อม Apply

### A.1 frontend: getDefaultAccount() — แก้ adj direction

**File:** `web/src/features/expenses/components/AdjustmentTable.tsx`

```typescript
// ก่อน (ถ้าใช้ 53-1503 สำหรับทั้ง 2 case)
function getDefaultAccount(diff) {
  return roles.code('adj_overpay');  // ❌ ผิด
}

// หลัง (แยกตาม direction)
function getDefaultAccount(diff: number): string {
  if (diff > 0) {
    return roles.code('adj_overpay');   // 53-1503 (จ่ายเกิน)
  } else if (diff < 0) {
    return roles.code('adj_underpay');  // 52-1104 (จ่ายน้อย)
  }
  return '';
}
```

### A.2 backend: SettlementService — เพิ่ม Adjustment support

**File:** `apps/api/src/modules/expense-documents/templates/expense-settlement.template.ts`

```typescript
import { roles } from '../../account-role/account-role.service';

export function generateSettlementJE(settlement, parents) {
  const lines = [];
  const apTotal = parents.reduce((s, p) => s + p.ap_balance, 0);

  // 1. Dr ตัดเจ้าหนี้
  lines.push({
    account_code: roles.code('payable_default'),
    dr_amount:    apTotal,
    line_note:    `ตัดเจ้าหนี้ ${parents.length} ใบ`,
  });

  // 2. Cr จ่ายเงิน
  lines.push({
    account_code: settlement.payment_account,
    cr_amount:    settlement.amount_paid,
    line_note:    'จ่ายเงิน',
  });

  // 3. Cr WHT (ถ้ามี — ลงตอนจ่ายตามมาตรา 50)
  if (settlement.wht_amount > 0) {
    const whtRole = settlement.supplier_type === 'juristic'
      ? 'wht_juristic' : 'wht_individual';
    lines.push({
      account_code: roles.code(whtRole),
      cr_amount:    settlement.wht_amount,
      line_note:    'WHT (ม.50)',
    });
  }

  // 4. ✅ NEW: รองรับ Multi-line Adjustment
  if (settlement.adjustments?.length > 0) {
    settlement.adjustments.forEach(adj => {
      lines.push({
        account_code: adj.account_code,
        [adj.side === 'DR' ? 'dr_amount' : 'cr_amount']: adj.amount,
        line_note:    adj.note || 'Adjustment',
      });
    });
  }

  return lines;
}
```

### A.3 backend: V12 — รองรับ SETTLEMENT

**File:** `apps/api/src/modules/expense-documents/validators/v12.validator.ts`

```typescript
import { BadRequestException } from '@nestjs/common';

export function validateV12(doc): void {
  // V12: Σ signed(adjustments) = amount_paid - net_expected
  // รองรับ EXPENSE_SAMEDAY + VENDOR_SETTLEMENT
  let netExpected: number;

  switch (doc.document_type) {
    case 'EXPENSE_SAMEDAY':
      netExpected = doc.total_amount - doc.wht_amount;
      break;
    case 'VENDOR_SETTLEMENT':
      const apTotal = doc.parent_docs
        .reduce((s, p) => s + p.ap_balance, 0);
      netExpected = apTotal - doc.wht_amount;
      break;
    case 'EXPENSE_ACCRUAL':
    case 'CREDIT_NOTE':
    case 'EXPENSE_PAYROLL':
      // Adjustment ไม่รองรับ — skip validation
      return;
    default:
      return;
  }

  const diff = doc.amount_paid - netExpected;
  if (Math.abs(diff) < 0.001) return; // No adjustment needed

  // Sum signed adjustments (Dr = +, Cr = -)
  const adjSum = (doc.adjustments || []).reduce((s, a) =>
    s + (a.side === 'DR' ? a.amount : -a.amount), 0);

  if (Math.abs(diff - adjSum) > 0.001) {
    throw new BadRequestException(
      `V12: ผลรวม adjustments (${adjSum.toFixed(2)}) ` +
      `ไม่เท่ากับ diff (${diff.toFixed(2)})`
    );
  }
}
```

---

## ภาคผนวก B: SQL Verification Queries

### B.1 Pre-Action Checks (รันก่อนเริ่มแก้ — เพื่อรู้ scope ของปัญหา)

```sql
-- ============================================
-- B.1.1 ตรวจ role_map ปัจจุบัน
-- ============================================
SELECT role, account_code, priority, is_active, updated_at
FROM account_role_map
WHERE role IN ('adj_overpay', 'adj_underpay', 'sso_employee', 'sso_employer',
               'payroll_sso_expense', 'vat_input', 'wht_juristic', 'wht_individual')
ORDER BY role;

-- ============================================
-- B.1.2 ตรวจ JE ที่ใช้ 11-2104 ผิด (ก่อน 2026-05-11)
-- ============================================
SELECT
  date_trunc('month', je.posted_at) AS period,
  COUNT(*)                           AS line_count,
  SUM(jl.dr_amount)                  AS misclassified_vat
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE jl.account_code = '11-2104'
  AND jl.dr_amount > 0
  AND je.posted_at < '2026-05-11'
  AND je.metadata->>'flow' LIKE 'expense-%'
GROUP BY 1
ORDER BY 1;

-- ============================================
-- B.1.3 SSO ตกหล่นใน 21-1104
-- ============================================
SELECT
  COUNT(*)            AS remaining_count,
  SUM(jl.cr_amount)   AS remaining_amount
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.metadata->>'flow' = 'expense-payroll'
  AND jl.account_code = '21-1104'
  AND jl.cr_amount > 0
  AND jl.line_note NOT ILIKE '%[migrated%';
```

### B.2 Post-Action Checks (รันหลังแก้ — ยืนยันว่าแก้สำเร็จ)

```sql
-- ============================================
-- B.2.1 ยืนยัน role_map ถูกต้อง
-- ============================================
SELECT role, account_code,
  CASE
    WHEN role = 'adj_overpay'         AND account_code = '53-1503' THEN '✓'
    WHEN role = 'adj_underpay'        AND account_code = '52-1104' THEN '✓'
    WHEN role = 'vat_input'           AND account_code = '11-4101' THEN '✓'
    WHEN role = 'sso_employee'        AND account_code = '21-3105' THEN '✓'
    WHEN role = 'sso_employer'        AND account_code = '21-3106' THEN '✓'
    WHEN role = 'payroll_sso_expense' AND account_code = '53-1102' THEN '✓'
    ELSE '✗ MISMATCH'
  END AS status
FROM account_role_map
WHERE role IN ('adj_overpay','adj_underpay','vat_input',
               'sso_employee','sso_employer','payroll_sso_expense')
  AND is_active = TRUE
ORDER BY role;

-- ============================================
-- B.2.2 Trial Balance ก่อน/หลัง — Sum invariant
-- ============================================
-- 21-1104 + 21-3105 + 21-3106 รวมกันต้องเท่ากันก่อน/หลัง migration
SELECT
  jl.account_code,
  SUM(jl.dr_amount - jl.cr_amount) AS net_balance
FROM journal_lines jl
WHERE jl.account_code IN ('21-1104', '21-3105', '21-3106')
GROUP BY jl.account_code
ORDER BY jl.account_code;

-- ============================================
-- B.2.3 ค่าเสื่อมงวด มี.ค.-เม.ย. 2569
-- ============================================
SELECT
  date_trunc('month', je.posted_at) AS period,
  COUNT(DISTINCT je.id)              AS je_count,
  SUM(jl.dr_amount)                  AS total_depreciation
FROM journal_entries je
JOIN journal_lines jl ON jl.journal_entry_id = je.id
WHERE je.metadata->>'flow' = 'asset-depreciation'
  AND jl.account_code LIKE '53-16%'
  AND jl.dr_amount > 0
  AND je.posted_at >= '2026-03-01'
  AND je.posted_at <  '2026-06-01'
GROUP BY 1
ORDER BY 1;

-- Expected: 3 rows (มี.ค., เม.ย., พ.ค.) แต่ละ row มี je_count ตามจำนวน active assets
```

---

## ภาคผนวก C: Test Cases เพิ่มเติม

### C.1 Test J-04 + J-05: SSO Calculation

```typescript
// apps/api/src/modules/payroll/sso.util.spec.ts
import { calculateSSO } from './sso.util';

describe('SSO Calculation (Suite J)', () => {
  it('J-04: เพดาน 750 ที่ฐานเงินเดือน ≥ 15,000', () => {
    expect(calculateSSO(15000)).toBe(750);
    expect(calculateSSO(20000)).toBe(750);
    expect(calculateSSO(100000)).toBe(750);
  });

  it('J-05: 5% ของฐานเงินเดือน เมื่อ < 15,000', () => {
    expect(calculateSSO(10000)).toBe(500);
    expect(calculateSSO(8000)).toBe(400);
    expect(calculateSSO(1660)).toBe(83);
  });

  it('Edge case: ฐานเงินเดือน = 0', () => {
    expect(calculateSSO(0)).toBe(0);
  });

  it('Edge case: ฐานเงินเดือน = 15,000 พอดี', () => {
    expect(calculateSSO(15000)).toBe(750);
  });
});
```

### C.2 Test K-07 (ใหม่): Settlement Adjustment

```typescript
describe('Settlement Adjustment (K-07)', () => {
  it('K-07: SETTLEMENT รองรับ Multi-line Adjustment', async () => {
    // Setup: สร้าง ACCRUAL ก่อน
    const accrual = await service.createAccrual({
      supplier_id: 'S-002',
      items: [{ account: '53-1305', amount: 10000, vat_pct: 7 }],
    });
    await service.post(accrual.id);  // ap_balance = 10,700

    // Settlement: จ่ายแค่ 10,500 (ส่วนลด 200)
    const settlement = await service.createSettlement({
      parent_doc_ids:  [accrual.id],
      payment_account: '11-1201',
      amount_paid:     10500,
      adjustments: [
        { account_code: '52-1104', side: 'CR', amount: 200, note: 'ส่วนลด' },
      ],
    });

    const je = await service.post(settlement.id);
    const lines = await service.getJournalLines(je.id);

    // Verify:
    expect(lines.find(l => l.account_code === '21-1104')?.dr_amount).toBe(10700);
    expect(lines.find(l => l.account_code === '11-1201')?.cr_amount).toBe(10500);
    expect(lines.find(l => l.account_code === '52-1104')?.cr_amount).toBe(200);

    // Verify balanced
    const totalDr = lines.reduce((s, l) => s + (l.dr_amount || 0), 0);
    const totalCr = lines.reduce((s, l) => s + (l.cr_amount || 0), 0);
    expect(totalDr).toBe(totalCr);
  });
});
```

### C.3 Test K-08 (ใหม่): adj_underpay routing

```typescript
describe('Adjustment Direction Routing (K-08)', () => {
  it('K-08a: จ่ายน้อย → ใช้ 52-1104 (ไม่ใช่ 53-1503)', () => {
    const defaultAcc = getDefaultAccount(-0.50);  // underpay
    expect(defaultAcc).toBe('52-1104');
  });

  it('K-08b: จ่ายเกิน → ใช้ 53-1503', () => {
    const defaultAcc = getDefaultAccount(0.50);  // overpay
    expect(defaultAcc).toBe('53-1503');
  });

  it('K-08c: role_map ต้องตรงสเปค', async () => {
    const adj_underpay = await roleMapService.getCode('adj_underpay');
    const adj_overpay  = await roleMapService.getCode('adj_overpay');

    expect(adj_underpay).toBe('52-1104');
    expect(adj_overpay).toBe('53-1503');
  });
});
```

---

## ภาคผนวก D: Sign-off Checklist

### D.1 Backend Dev Checklist
- ☐ A.1: ตรวจ role_map (B.1.1) — adj_underpay ต้องเป็น 52-1104
- ☐ A.1: ถ้าผิด → รัน UPDATE SQL ใน Action #1.3
- ☐ A.2: ขยาย expense-settlement.template.ts เพิ่ม adjustments support
- ☐ A.2: แก้ V12 validator ให้รองรับ VENDOR_SETTLEMENT
- ☐ A.2: ทดสอบ Settlement + Adjustment ใน staging — ใช้ scenario ใน 2.2
- ☐ A.4: ยืนยัน Suite J + K มีครบ 12 test cases
- ☐ A.4: เพิ่ม K-07 (Settlement Adj) + K-08 (Direction Routing)

### D.2 Frontend Dev Checklist
- ☐ A.1: แก้ getDefaultAccount() ใน AdjustmentTable.tsx
- ☐ A.2: เพิ่ม Section 5 ใน SettlementFormV4.tsx
- ☐ A.2: ทดสอบ UI flow: ACCRUAL → SETTLEMENT พร้อม Adjustment

### D.3 DBA Checklist
- ☐ B.1: รัน Verification Queries ก่อนแก้ — บันทึก baseline
- ☐ A.3: รัน Cleanup Migration SSO (ถ้ามี rows ตกหล่น)
- ☐ A.5: ตรวจ JE depreciation มี.ค.-เม.ย. 2569
- ☐ A.5: รัน manual depreciation run (ถ้าหาย)
- ☐ B.2: รัน Post-Action Verification Queries
- ☐ B.2: Trial Balance ก่อน/หลังต้องเท่ากัน (21-1104 + 21-3105 + 21-3106)

### D.4 QA Checklist
- ☐ ยืนยัน Suite J + K มีครบ 12 test cases เดิม
- ☐ เพิ่ม K-07 (Settlement Adjustment)
- ☐ เพิ่ม K-08 (adj direction routing)
- ☐ ทดสอบ regression: ทุก doc_type post ได้ปกติหลังแก้
- ☐ Smoke test ใน staging — สร้าง EX + SE + PR + CN test ดู JE

### D.5 Accountant (Owner) Checklist
- ☐ ตรวจ JE adjusting ของ 11-2104 → 11-4101 (historical data)
- ☐ ตรวจ JE adjusting ของค่าเสื่อม มี.ค.-เม.ย. 2569
- ☐ ภพ.30 พ.ค. 2569 — ใช้ยอด 11-4101 ขอคืน VAT
- ☐ สปส.1-10 พ.ค. 2569 — ใช้ยอด 21-3105 + 21-3106
- ☐ ภงด.3/53 พ.ค. 2569 — ใช้ยอด 21-3102 + 21-3103
- ☐ ปิดงวด พ.ค. 2569 — Trial Balance balanced + งบกำไร-ขาดทุนครบ

---

## 📋 Definition of Done

Action นี้ถือว่าเสร็จเมื่อ:

- ✅ ทุก checklist ใน D.1 - D.4 ติ๊กครบ
- ✅ Verification queries ใน B.2 ผ่านทั้งหมด
- ✅ Suite J + K + K-07 + K-08 ผ่าน 100%
- ✅ Owner sign-off ใน D.5
- ✅ Compliance Score ≥ A (88/100)

---

**— END OF ACTION ITEMS —**

Business Expense Module · Dev Action List · พฤษภาคม 2569
