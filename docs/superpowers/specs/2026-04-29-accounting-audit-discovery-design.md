# Accounting & Chart of Accounts — Audit Discovery (Spec)

**Date:** 2026-04-29
**Type:** Research / Audit Discovery (no code changes)
**Author:** Claude (with owner direction)
**Status:** Draft for review

---

## 1. Goal

ตรวจสอบความถูกต้องของระบบบัญชี end-to-end ตั้งแต่ business event → journal → trial balance → financial reports → period close — โดยเทียบกับ:

1. **TFRS for NPAEs** (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
2. **ผังบัญชีของเจ้าของ** (`docs/references/owner-chart-of-accounts.csv` — 109 บัญชี)
3. **Internal consistency** (Dr=Cr, account nature, multi-entity allowedCompanies)

**Deliverable:** Markdown report ใน `docs/reports/2026-04-29-accounting-audit.md` พร้อม finding list (Critical/Warning/Info) + action plan แบ่ง phase

**Out of scope:**
- Code fix ใดๆ
- Schema migration / CoA restructure
- Build missing reports (P&L, Balance Sheet, Cash Flow) → spec อนาคต
- Mutate prod data
- Decision on CR-001 (VAT on interest) — รอ CPA

---

## 2. Background & Context

### 2.1 Existing accounting infrastructure
- **ChartOfAccount** model — 76 บัญชี seeded (PEAK format `XX-XXXX`), 5 หมวด, รองรับ multi-company (`allowedCompanies`), PEAK mapping fields
- **JournalEntry / JournalLine / JournalPostAuditLog** — DRAFT/POSTED/VOIDED + audit log
- **JournalAutoService** (`apps/api/src/modules/journal/journal-auto.service.ts`, 532 บรรทัด) — auto-post จาก payment / contract / expense / repossession / trade-in / bad-debt
- **AccountingService** (1255 บรรทัด) — expense workflow ครบ
- **MonthlyClose / AccountingPeriod** — OPEN→REVIEW→CLOSED→SYNCED
- **BadDebt** (provision/write-off) + **BankRec** + **TaxService** (PP.30/PND.3/PND.53 preview)
- หน้า Web: ChartOfAccountsPage / MonthlyClosePage / TaxReportsPage / FinancialAuditPage / ReportsPage

### 2.2 Owner-supplied chart of accounts
ผังเจ้าของ (`docs/references/owner-chart-of-accounts.csv`) มี 109 บัญชี — divergence สำคัญที่พบใน preview:

- ✗ ไม่มี HP Receivable (11-2102) — มีแค่ลูกหนี้การค้าทั่วไป
- ✗ ไม่มี HP Interest Income — มีแค่ดอกเบี้ยเงินฝาก
- ✗ ไม่มี Commission Income, Allowance for Doubtful, Repossession Income, External Finance Receivable
- ✓ มี Tax Payable section (21-32XX), WHT Receivable (11-4103), ภ.พ.36 — ที่ระบบยังไม่มี
- 🔴 **Top-level code conflict**: 11-1000 (เจ้าของ) vs 11-0000 (seed)
- 🔴 **53-1101 conflict**: เจ้าของ = "เงินเดือน ค่าจ้าง" / seed = "Bad Debt Expense" (จาก audit code reading)

→ ผังเจ้าของดูเหมือนออกแบบสำหรับ **single-entity SHOP business** ไม่ใช่ SHOP↔FINANCE split → audit ต้อง flag เพื่อให้เจ้าของ + นักบัญชีตัดสิน

### 2.3 Known deferred items (จาก memory)
- W-003/N-005: ดอกเบี้ยรับรู้ upfront → policy ตัดสินเป็น A2 cash basis แต่ยังไม่ implement `unearnedInterest`
- CR-001: VAT on interest under sec.81(1)(ช) — รอ CPA
- PEAK / GFIN / MDM / CHATCONE — Phase 4 deferred ทั้งหมด

---

## 3. Audit Methodology — 6 Layers

### Layer 1 — Event Coverage Matrix
**Goal:** ตรวจว่า business event ทุกตัวที่แตะเงินมี journal coverage ครบไหม

**Input:** Schema + ทุก service ใน `apps/api/src/modules/` ที่เรียก PrismaService write methods
**Output:** ตารางใหญ่: event × service × `JournalAutoService` method × status (✓/✗/partial)

**Events ที่ enumerate (ขั้นต่ำ):**
- POS sales: เงินสด / โอน / QR / external finance / ผ่อนใน
- Contract lifecycle: ACTIVATE, EARLY_PAYOFF, RESTRUCTURE, REPOSSESSION_PREVIEW, REPOSSESSION_COMPLETE, VOID
- Payment: full / partial / overpay (→ credit) / underpay / refund / reverse
- Trade-in (รับซื้อ) → Stock IN + Cash OUT
- Stock: PURCHASE, TRANSFER (SHOP↔FINANCE ownership shift), ADJUSTMENT, WRITE_OFF
- Expense workflow: SUBMIT/APPROVE/PAY/VOID
- Commission accrue + pay
- Bad debt: provision / write-off / recovery
- Late fee assessment, ค่ามัดจำริบ
- Inter-company SHOP↔FINANCE settlement
- VAT submission (PP.30 → liability ↓)
- Period close / opening balance / year-end

### Layer 2 — Journal Correctness
**Goal:** ทุก JE ที่ Layer 1 = ✓ ถูกตามหลักบัญชีไหม

**Checks:**
- [ ] **Math:** Σ debit = Σ credit per entry
- [ ] **Account nature:** Dr/Cr ถูกฝั่งของหมวด (Dr.Asset↑/Cr.Liability↑/etc.)
- [ ] **TFRS NPAEs compliance:**
  - Cash basis revenue → recognize เมื่อ payment, ไม่ใช่ตอน contract activate
  - Accrual expense → เข้า GL ตอนเกิด ไม่ใช่ตอนจ่าย
  - Hire-purchase interest: confirm A2 cash-basis policy + `unearnedInterest` gap
  - VAT timing: invoice หรือ payment?
- [ ] **Multi-entity:** account ใช้ตรงกับ `allowedCompanies`
- [ ] **Decimal precision:** ใช้ `Prisma.Decimal` ไม่ใช่ `Number()` (verify v4 fix ครบ)
- [ ] **Special cases:** late fee no-VAT, trade-in no-VAT, ส่วนลด CR หรือ negative DR

### Layer 3 — Chart of Accounts Reconciliation (vs Owner CoA)
**Goal:** เทียบผังในระบบ ↔ ผังเจ้าของ ↔ การใช้งานจริงใน journal

**Input sources:**
1. `apps/api/prisma/seeds/chart-of-accounts.ts` (76 accounts in DB)
2. `docs/references/owner-chart-of-accounts.csv` (109 accounts owner-supplied)
3. ทุก `accountCode` ที่อ้างอิงใน `JournalAutoService` + manual journal entries

**Diff matrix outputs:**
- **F-3-A MISSING**: account ในผังเจ้าของ ไม่มีในระบบ (Critical ถ้า business-essential)
- **F-3-B EXTRA**: account ในระบบ ไม่มีในผังเจ้าของ (Warning — อาจ deprecate หรือเจ้าของลืม)
- **F-3-C MISMATCH**: code ตรง แต่ name/group/parent ต่าง (Warning)
- **F-3-D STRUCTURE-DIVERGE**: hierarchy/code-numbering ต่าง (เช่น 11-0000 vs 11-1000)
- **F-3-E ORPHAN**: account ในระบบ ไม่ถูก journal line ใช้เลย (Warning)
- **F-3-F UNDEFINED-USAGE**: journal line อ้าง code ที่ไม่มีในผังใดเลย (Critical)
- **F-3-G ALLOWED-COMPANY-VIOLATION**: SHOP transaction ใช้ FINANCE-only account (Critical)

### Layer 4 — Trial Balance Integrity (Historical, Prod)
**Goal:** Verify บัญชีไม่เพี้ยนตั้งแต่ go-live

**Method:** Cloud Run Job (readonly query) — ใช้ pattern จาก `reference_prod_db_oneshot_jobs.md`
**Script location:** `apps/api/scripts/audit-trial-balance.ts` (commit เก็บไว้ใช้ซ้ำ)

**Queries:**
- ทุก (companyId, year, month) ตั้งแต่ go-live: Σ debit = Σ credit?
- DRAFT entries ค้าง > 7 วัน
- VOIDED entries ที่ไม่มี reverse entry คู่
- **Orphan transactions (P0):** Payment ที่ไม่มี JournalEntry, Expense.PAID ที่ไม่มี JE
- Asset ≠ Liability + Equity in any month?
- Period status CLOSED/SYNCED แต่มี JE post หลัง close?

**Safety:**
- SELECT only — verify ทุก query อ่านอย่างเดียว
- Timeout 30s/query
- Batch by month เพื่อไม่ load DB หนัก
- ขออนุมัติเจ้าของก่อน run (Gate G1)

### Layer 5 — Financial Reports Completeness
**Goal:** เทียบ report ที่มี ↔ TFRS NPAEs requires

**ระบบมี:**
- Trial Balance endpoint ✓
- Bad debt summary ✓
- Tax preview (PP.30/PND.3/PND.53) ✓
- Bank reconciliation ✓

**ขาด (Critical/Warning):**
- Income Statement (P&L) — งบกำไรขาดทุน
- Balance Sheet — งบฐานะการเงิน
- Statement of Cash Flow
- Notes to Financial Statements
- General Ledger detail (รายการบัญชีแยกประเภท)
- Subsidiary ledger (HP Receivable detail per customer)
- Tax reports ที่ regulator require: PND.50, PND.51, ภ.ง.ด.51

→ Output: list missing report + recommended endpoint format

### Layer 6 — Period Close Hardening
**Goal:** ตรวจ MonthlyCloseService ว่า lock period หลัง close ได้จริงไหม

**Checks:**
- Period CLOSED แล้ว ห้าม insert/update/delete JournalEntry — มี guard ไหม?
- Pre-close checklist: orphan tx / DRAFT entries / unbalanced TB → block close
- Reopen audit trail (ใครเปิด, เมื่อไหร่, เหตุผล)
- Late posting policy (post ย้อนหลังเข้าได้ไหม + ไป period ไหน)
- Year-end closing entries (revenue/expense → retained earnings) มีไหม?

---

## 4. Subagent Plan (Parallel Execution)

5 subagents (Sonnet) ขนานกัน — return finding list ของ layer ตัวเอง → parent รวบ

| # | Subagent | Type | Layer | Input | Output |
|---|---|---|---|---|---|
| **S1** | code-reviewer | Sonnet | Layer 1 | Schema + service files (payments/contracts/expense/repo/trade-in/stock) | Event × journal coverage matrix + GAP findings |
| **S2** | code-reviewer | Sonnet | Layer 2 | `JournalAutoService` + ทุก call site | Dr/Cr ผิด, TFRS violation, decimal precision findings |
| **S3** | code-reviewer | Sonnet | Layer 3 | Seed CoA + owner CoA CSV + JournalAutoService account refs | Diff matrix (MISSING/EXTRA/MISMATCH/STRUCTURE-DIVERGE/ORPHAN/UNDEFINED/ALLOWED-VIOLATION) |
| **S4** | general-purpose | Sonnet | Layer 4 | Cloud Run Job script (readonly prod query) | Trial balance per month + orphan tx + DRAFT/VOID issues |
| **S5** | code-reviewer | Sonnet | Layers 5+6 | `journal.controller.ts`, `MonthlyCloseService`, `accounting.controller.ts` | Missing reports + period close guards findings |

**Coordination rules:**
- ทุก subagent ส่ง finding ใน format ตามมาตรฐาน Section 5
- ห้าม subagent เขียน code / mutate data / spawn subagent ต่อ
- Timeout 20 นาที/ตัว
- Parent รอครบทั้ง 5 ก่อนรวบ (S4 อาจล่าช้าเพราะรอ approval)

**Why parallel:**
- 5 layer อิสระจากกัน
- Memory `feedback_parallel_subagent_audit.md` — pattern verified ใน PR #705 ได้ ~80 finding/30min
- Time saving: serial 100 min → parallel 25 min

---

## 5. Finding Format

```yaml
- id: F-{LAYER}-{NNN}           # F-1-001, F-2-014, F-4-003
  severity: CRITICAL | WARNING | INFO
  layer: 1-6
  title: หัวข้อสั้น (≤80 chars)
  location:
    - apps/api/src/modules/payments/payments.service.ts:142
    - apps/api/src/modules/journal/journal-auto.service.ts:223
  evidence: |
    หลักฐาน 2-5 บรรทัด — code excerpt / query result / observation
  impact: |
    ผลกระทบเชิงธุรกิจ (เงินผิด, audit fail, ปิดงวดไม่ได้, regulator risk)
  recommendation: |
    ทำยังไง — approach ระดับสูง ไม่ต้อง code ละเอียด
  references:
    - TFRS for NPAEs section X
    - memory: project_xxx.md
    - prior PR #NNN
```

### Severity criteria

| Severity | เกณฑ์ | ตัวอย่าง |
|---|---|---|
| **CRITICAL** | เงินบัญชีผิด / ปิดงวดไม่ได้ / ละเมิดกฎหมาย / ต้องการ business decision ก่อนไปต่อ | Trial Balance unbalanced, missing JE, orphan tx, undefined account, top-level code conflict |
| **WARNING** | ระบบเปราะ / regression risk / data quality | DRAFT >7d, orphan account ใช้บ่อย, no reverse for VOID, decimal Number() เหลือ |
| **INFO** | เสนอแนะ ไม่ urgent | Naming inconsistency, missing optional report, English label gap |

---

## 6. Report Structure

`docs/reports/2026-04-29-accounting-audit.md`

```markdown
# Accounting & Chart of Accounts Audit
**Date:** 2026-04-29
**Scope:** ทั้ง SHOP + FINANCE
**Methodology:** 6-layer audit (static + prod data)
**Owner CoA reference:** docs/references/owner-chart-of-accounts.csv

## Executive Summary
- Total findings: NN (Critical: X, Warning: Y, Info: Z)
- Top 3 risks: ...
- Top 3 quick wins: ...
- Status: [READY-TO-CLOSE | NEEDS-FIX-BEFORE-CLOSE | BROKEN]
- Critical business decisions needed: ...

## Layer 1 — Event Coverage Matrix
[ตารางใหญ่]
### Findings (Layer 1)

## Layer 2 — Journal Correctness
### Findings (Layer 2)

## Layer 3 — Chart of Accounts Reconciliation
### 3.1 Diff matrix (system 76 vs owner 109)
### 3.2 MISSING accounts (เจ้าของมี — ระบบไม่มี)
### 3.3 EXTRA accounts (ระบบมี — เจ้าของไม่มี)
### 3.4 MISMATCH (code ตรง แต่ name/group ต่าง)
### 3.5 STRUCTURE-DIVERGE (top-level code, hierarchy)
### 3.6 ORPHAN / UNDEFINED-USAGE
### 3.7 ALLOWED-COMPANY violations
### Findings (Layer 3)

## Layer 4 — Trial Balance (Historical, Prod)
### 4.1 Monthly TB ตั้งแต่ go-live
[ตาราง: companyId × YYYY-MM × Σ Dr × Σ Cr × diff × balanced?]
### 4.2 Orphan transactions
### 4.3 DRAFT/VOID issues
### Findings (Layer 4)

## Layer 5 — Financial Reports
### 5.1 Existing vs TFRS-required
### Findings (Layer 5)

## Layer 6 — Period Close
### Findings (Layer 6)

## Recommended Action Plan
### Phase A — Critical Fix (next spec)
- F-X-NNN, ...
### Phase B — Build Missing Reports
- F-5-NNN, ...
### Phase C — Backlog (Warnings + Info)
- ...

## Critical Business Decisions Needed
1. ผังเจ้าของ vs ระบบ — ใช้แบบไหนเป็น ground truth?
2. CR-001 VAT on interest — ปรึกษา CPA
3. ...

## Appendix
A. SQL queries used (Layer 4)
B. Files inspected
C. References (TFRS sections, prior memory, PRs)
```

---

## 7. Execution Sequence

```
[T+0]    Spawn S1, S2, S3, S5 (parallel) + เขียน Cloud Run Job script (S4)
[T+5]    S4 script ready → รอเจ้าของอนุมัติ (Gate G1)
[T+10]   เจ้าของอนุมัติ → run job → รอผล 15-20 นาที
[T+25]   S1, S2, S3, S5 ทยอยกลับ
[T+30]   S4 ผลกลับ → รวม Layer 4 finding
[T+30-50] รวบ + dedupe + cross-reference + เขียน report
[T+50]   Self-review (placeholder/contradiction/clarity)
[T+55]   Commit `docs/reports/2026-04-29-accounting-audit.md`
[T+55]   Summary แจ้งเจ้าของ — Critical count, top risks, recommendation
```

**Total: ~1 ชั่วโมง** (auto mode → ไม่หยุดยกเว้น Gate G1)

---

## 8. Approval Gates

| Gate | When | Action if blocked |
|---|---|---|
| **G1** Prod query approval | ก่อน run Cloud Run Job (Layer 4) | Skip Layer 4 → ทำเฉพาะ static (1, 2, 3, 5, 6) |
| **G2** Final report review | ก่อน commit | Revise + recommit |

---

## 9. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Subagent timeout | Fallback: parent รัน layer นั้นเอง (slower แต่ครบ) |
| Prod query slow / lock | Timeout 30s/query, batch by month, sample if >10s |
| Subagent finding ซ้ำ | Parent dedupe: group by (location, evidence pattern) |
| Report ใหญ่เกิน 200 finding | Split: `audit-critical.md` + `audit-warnings.md` + `audit-info.md` |
| Owner CoA ground truth ambiguous | Flag เป็น F-3-001 [CRITICAL — needs business decision] ไม่พยายามตัดสินเอง |
| S4 prod query แตะ data ผิดตาราง | Code review script ก่อน run, allowlist เฉพาะตาราง: journal_entries, journal_lines, payments, expenses, accounting_periods, chart_of_accounts |

---

## 10. Success Criteria

- [ ] Report ครบทุก 6 layer (no missing section)
- [ ] ทุก finding มี severity + location + evidence + impact + recommendation
- [ ] Diff matrix system CoA ↔ owner CoA ครบ 109+76 = ~150 บัญชี
- [ ] Trial balance ทุกเดือนใน prod ถูก verify (หรือ flag G1 ถ้าโดน skip)
- [ ] Action plan แบ่ง Phase A/B/C ชัด เจ้าของอ่านแล้วเลือก fix อะไรได้
- [ ] Critical business decisions list ออกมาให้เจ้าของ + นักบัญชีตัดสิน

---

## 11. Deliverables Summary

1. `docs/reports/2026-04-29-accounting-audit.md` — main audit report
2. `apps/api/scripts/audit-trial-balance.ts` — Cloud Run Job script (reusable)
3. `docs/references/owner-chart-of-accounts.csv` — owner ground truth (already saved)
4. Git commit: `chore(accounting): add 2026-04-29 audit report + owner CoA reference`

## 12. Out of Scope (ย้ำ)

- ❌ Code fix ใดๆ
- ❌ Schema migration
- ❌ ผังบัญชี restructure / เพิ่มลด account
- ❌ Build missing report (P&L, BS, CF) — ไป spec อนาคต
- ❌ Mutate prod data
- ❌ Decision on CR-001 — รอ CPA
- ❌ ตัดสินว่าผังเจ้าของหรือระบบถูก — แค่ flag finding ให้เจ้าของ + นักบัญชีตัดสิน

---

## 13. Follow-up Specs (Anticipated)

หลัง audit เสร็จ คาดว่าจะมี spec ตามมา:

- **2026-04-30 Accounting Critical Fix** — fix Critical findings + reconcile CoA divergence (depend on owner decision)
- **2026-05-XX Financial Reports Build** — P&L + Balance Sheet + Cash Flow per TFRS NPAEs
- **2026-05-XX Unearned Interest Implementation** — W-003/N-005 deferred work (separate, complex)
