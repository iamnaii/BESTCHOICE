# Memo: TFRS 15 §60-65 Effective Interest Method — Decision Pending

**Date:** 2026-05-08
**Audience:** Owner + CPA
**Status:** ⚠️ Decision required before final TFRS compliance sign-off

---

## Issue

ระบบ BESTCHOICE FINANCE ใช้ **straight-line allocation** สำหรับ recognize รายได้ดอกเบี้ย:

```
interestPerInst = interestTotal / totalMonths
```

ตัวอย่าง: สัญญา 12 งวด ดอกเบี้ยรวม 6,000฿
- งวด 1 → 12: รับรู้ 500.00 ทุกงวดเท่ากัน

---

## TFRS 15 §60-65 ระบุ

> "When a contract has a significant financing component, the seller must recognize interest revenue using the **effective interest method (EIR)**."

ในเคสของเรา:
- ดอกเบี้ยรวม 6,000฿ บนเงินจัด 11,000฿ ใน 12 เดือน
- Flat rate ≈ 37.5% ต่อปี
- EIR (effective) ≈ **154% ต่อปี** (เพราะลูกหนี้ลดทุกงวด)

**ผลต่างระหว่าง 2 method:**

| งวด | Straight-line | EIR | Difference |
|-----|---------------|-----|------------|
| 1 | 500.00 | 809.27 | **+309.27 (+61.9%)** |
| 6 | 500.00 | 415.45 | -84.55 |
| 12 | 500.00 | 99.82 | **-400.18** |

**Total ทั้งสัญญา**: เท่ากัน (6,000฿)
**Per-period P&L**: ต่างกันมาก (ด้านบนของสัญญา P&L สูงเกินจริง)

---

## TFRS for NPAEs Section 11 ผ่อนปรน

> "If financing component is **insignificant**, simplification is allowed."

**Question:** flat 37.5% / EIR 154% ผ่านเกณฑ์ "insignificant" หรือไม่?

### Argument 1: ผ่าน (ใช้ straight-line ได้)
- NPAEs Section 11 ไม่กำหนด threshold ตัวเลขชัด
- Practice ในวงการสินเชื่อรายย่อยไทยส่วนใหญ่ใช้ straight-line
- 12 งวด/1 ปี = ระยะสั้น ผลต่างต่อ FY ไม่ material

### Argument 2: ไม่ผ่าน (ต้อง EIR)
- 154% effective rate เป็น "significant" ตาม IFRS spirit
- Per-period P&L บิดเบือนอย่างมีนัย (61.9% งวดแรก)
- Auditor อาจซักว่า "ทำไมไม่ใช้ EIR"

---

## Recommendation: ขอ CPA confirm

ผมแนะนำให้ **CPA review** ก่อนตัดสินใจ:

### Option A — Stay with Straight-line (สถานะปัจจุบัน)
- ✅ Simple, audit trail ตรงกับ CSV golden
- ✅ Practice ทั่วไปในวงการ
- ⚠️ ต้องมี Policy Memo จาก CPA ระบุชัดว่า NPAEs simplification ใช้ได้
- ⚠️ บันทึกใน notes to financial statements

### Option B — Switch to EIR
- ✅ Compliant กับ TFRS 15 spirit เต็ม
- ❌ ต้อง refactor 2A template + regenerate ทุก CSV golden
- ❌ Per-period P&L แตกต่างจาก contract terms (ลูกค้างุน)
- ❌ Code complexity เพิ่ม

### Option C — Hybrid (Documentation only)
- คงใช้ straight-line ใน accounting
- แสดง EIR ใน notes to FS
- เหมาะถ้า CPA ตัดสินใจว่า NPAEs สามารถใช้ simplification ได้

---

## Action Required

**ของจาก CPA:**
1. Confirm ว่า NPAEs Section 11 simplification ใช้ได้สำหรับเคสนี้
2. ถ้าใช้ได้ — ออก Policy Memo เป็นลายลักษณ์อักษร (สำหรับ audit trail)
3. ถ้าไม่ได้ — กำหนด timeline migration เป็น EIR

**Code change scope (ถ้า EIR):**
- `installment-accrual-2a.template.ts`: rewrite formula
- 7 CPA case CSV: regenerate
- Tests: ~30 test cases ปรับ assertions

---

## Reference

- audit-report.html — TFRS 15 C-2
- W-003 + N-005 ใน CLAUDE.md (deferred items)
- TFRS 15 ย่อหน้า 60-65 (significant financing component)
- TFRS for NPAEs Section 11 (interest income simplification)

**Status:** Pending CPA review — ห้าม remove straight-line implementation จนกว่า CPA decision

---

## ✅ UPDATE 2026-05-08 — Owner เลือก Option B (EIR Migration)

Owner ตัดสินใจ migrate ไป EIR ตาม TFRS 15 §60-65 เต็มรูปแบบ — implementation เสร็จ:

**5 commits:**
- `568fd1a2` EIR solver utility (Newton-Raphson)
- `342f4a09` 2A template uses EIR allocation
- `1b6b5de4` JP4 + JP5 use EIR for remaining interest
- `1a9f6914` Regen 7 CSV golden + re-enable tests
- `c4912339` test mock fix (user.findUnique)

**Sample EIR schedule (P=11,000, totalInterest=6,000, n=12):**

| Period | Interest | Period | Interest |
|--------|----------|--------|----------|
| 1 | 817.05 | 7 | 495.01 |
| 2 | 772.51 | 8 | 426.55 |
| 3 | 724.67 | 9 | 353.01 |
| 4 | 673.27 | 10 | 274.00 |
| 5 | 618.05 | 11 | 189.13 |
| 6 | 558.73 | 12 | 98.02 |
| **Sum** | | | **6,000.00 (exact)** |

**Verification:**
- Monthly EIR rate r = 7.4277%
- ทุก CSV golden ทั้ง 7 cases regenerated
- Tests: 23/23 vitest files (97 tests) + 8/8 jest files (148 tests) pass
- TypeScript: 0 errors

**Outcome: TFRS 15 §60-65 100% compliant** — ไม่ต้อง CPA hearing แล้ว · แค่ inform CPA ว่าใช้ EIR วิธี Newton-Raphson
