# Expense-Documents Transactional-Core Decompose — Design Proposal (PHASE 0)

> **STATUS: DESIGN-ONLY. รออนุมัติเจ้าของก่อนแตะโค้ดใด ๆ ที่ใช้ `$transaction` / โพสต์ JE / เปลี่ยน document status.**
> เอกสารนี้คือ Phase 0 ตามโจทย์ — recon + ออกแบบ seam + slice plan + risk register. ยังไม่มี implementation code.

**Goal:** แตก transactional core ของ `apps/api/src/modules/expense-documents/expense-documents.service.ts` (2,475 LOC) ออกเป็น collaborator services แบบ **behavior-preserving** (TFRS regulated — JE output + document state transitions ห้ามเปลี่ยน) โดยย้ายเมธอด **verbatim** (ยกทั้ง `$transaction` block) และคง public signature ทั้งหมดผ่าน facade.

**Baseline:** origin/main = local HEAD = `afc008e6` (#1170) — ยืนยันด้วย `git fetch origin main` แล้ว (ไม่ stale). E1–E6 util extractions landed แล้ว (utils + `services/` 7 ตัว). ที่เหลือ = transactional core นี้.

---

## 0. Preconditions & Gates

| # | Precondition | สถานะ |
|---|---|---|
| P1 | local == origin/main == `afc008e6` | ✅ ยืนยันแล้ว (fetch สด) — memory's `6fa34ee3`/#1211/#1212 **ไม่อยู่บน origin/main**; เป็นงาน accounting/expense E4–E6 ที่ไม่เกี่ยวไฟล์นี้ หรือยังไม่ landed. ก่อนเริ่มแต่ละ slice ให้ re-confirm `git rev-parse origin/main` ยังเป็น afc008e6 (หรือ rebase ถ้า main เคลื่อน) |
| P2 | service = 2,475 LOC, 13 `$transaction` sites, 412 jest tests / 34 suites | ✅ ยืนยันแล้ว (jest run) |
| Gates | ทุก slice ต้องเขียว | `./tools/check-types.sh api` (tsc 0) **และ** `npm --prefix apps/api run test -- expense-documents` (412 → ต้องไม่ลด, --runInBand baked in) |
| Evidence | ยืนยันด้วยการ trace runtime path ไม่ใช่ diff | byte-identity ของเมธอดที่ย้าย + JE-call-args/state-transition ที่ pin ไว้ |

---

## 1. Method Inventory (28 members)

Purity: **READ** = ไม่มี write/`$tx` · **WRITE-TX** = เปิด/รับ `$transaction` · **HELPER/INIT** = private/lifecycle

| # | Method | LOC (lines) | Purity | `$tx` boundary | Collaborators ที่เรียก | Guards | State transition |
|---|--------|-----|--------|-----------|------------------------|--------|------------------|
| 1 | `onModuleInit` | 66–85 (20) | INIT | none | `prisma.chartOfAccount`, `ADJUSTMENT_ALLOWLIST` | boot CoA-exists check (throw) | — |
| 2 | `constructor` | 87–107 | — | — | (15 req + `notifications?`) | — | — |
| 3 | `notifyApprovers` | 120–169 (50) | HELPER (async, **นอก** tx) | none | `readBoolFlag`, `getApproversList`, `prisma.user`, `notifications?.send` | opt-out flag, null-guard notifications | — |
| 4 | `readBoolFlag` | 177–183 (7) | HELPER | passthrough | util `readBoolFlag` | — | — |
| 5 | `readNumberFlag` | 196–215 (20) | HELPER | none | `tx.systemConfig` | clamp ≥0, Decimal (จงใจไม่ dedup) | — |
| 6 | `create` | 219–320 (102) | WRITE-TX | **opens** (230) | `aggregator.computeLine/aggregateLines`, `assertCategoriesAreExpense`, `validateAdjustments`, `docNumber.next` | CoA-type, V12/13/14 adjustments | → DRAFT (EXPENSE) |
| 7 | `createDraftForRepair` | 339–414 (76) | WRITE-TX | **รับ tx จากภายนอก** (RepairTickets) | `aggregator`, `docNumber.next` | (ข้าม CoA/adjustment โดยตั้งใจ) | → DRAFT (REPAIR_SERVICE) |
| 8 | `createCreditNote` | 423–576 (154) | WRITE-TX | **opens** (441) + `pg_advisory_xact_lock` | `aggregator`, `assertCategoriesAreExpense`, `docNumber.next`, `tx.expenseDocument` | mode LINKED/STANDALONE, orig lookup, branch, type, status, orig-WHT, cap | → DRAFT (CREDIT_NOTE) |
| 9 | `createPayroll` | 579–788 (210) | WRITE-TX | **opens** (721) | `ssoConfig.validateContribution`, `payrollCustom.loadWhitelist/validateLine`, `prisma.employeeProfile`, `docNumber.next`, `maskPayrollTaxIds` | cross-branch, SSO cap, PR-C employee link, netPaid≥0 | → DRAFT (PAYROLL) |
| 10 | `createSettlement` | 791–984 (194) | WRITE-TX | **opens** (842) + sorted advisory locks | `readBoolFlag`, `readIntFlag`, `validateAdjustments`, `docNumber.next`, `tx.settlementLine` | cross-branch, max-bills, partial-pay flag, dedup, ACCRUAL-only, cap, WHT≤sum | → DRAFT (VENDOR_SETTLEMENT) |
| 11 | `createPettyCash` | 987–1113 (127) | WRITE-TX | **opens** (1054) | `readBoolFlag`, `pettyCash.getConfig/validate`, `assertCategoriesAreExpense`, `docNumber.next` | feature-flag, cross-branch, V20 limit/supplier/account | → DRAFT (PETTY_CASH_REIMBURSEMENT) |
| 12 | `list` | 1116–1201 (86) | READ | none | `prisma.expenseDocument` | branch-scope, tab/status filters | — |
| 13 | `getSummary` | 1204–1250 (47) | READ | none | `prisma.expenseDocument.groupBy/aggregate` | — | — |
| 14 | `getTaxDisallowedSummary` | 1270–1324 (55) | READ | none | `prisma.expenseDocument/expenseLine.aggregate` | — | — |
| 15 | `getApAging` ⚠️**TRAP** | 1339–1447 (109) | READ | none | `prisma.expenseDocument` | — (labels `0-30/31-60/61-90/90+` = aging-bucket trap, **ห้ามแตะ**) | — |
| 16 | `getDailySummary` | 1450–1564 (115) | READ | none | `prisma.expenseDocument`, `hasCrossBranchAccess` | branch req | — |
| 17 | `getCreditNoteCap` | 1569–1595 (27) | READ | none | `prisma.expenseDocument` | EXPENSE-only | — |
| 18 | `previewJe` | 1598–1606 (9) | READ | none | `collectJePreviewCodes`, `prisma.chartOfAccount`, `jePreview.preview` | — | — (no write) |
| 19 | `getAuditTrail` | 1614–1642 (29) | READ | none | **`this.findOne`** (intra), `prisma.auditLog`, `hasCrossBranchAccess` | branch-scope | — |
| 20 | `findOne` | 1649–1696 (48) | READ | none | `prisma.expenseDocument`, `maskPayrollTaxIds` | deletedAt | — |
| 21 | `update` | 1699–1791 (93) | WRITE-TX | **opens** (1700) | `transition.assertCanEdit`, `aggregator`, `assertCategoriesAreExpense` | assertCanEdit (DRAFT/ACCRUAL) | edit (no status change) |
| 22 | `submitForApproval` | 1803–1861 (59) | WRITE-TX | **opens** (1804) + advisory lock; `notifyApprovers` **นอก tx** | `readBoolFlag`, `prisma.auditLog`, `notifyApprovers` | approval_enabled, DRAFT-only | DRAFT → PENDING_APPROVAL |
| 23 | `post` | 1871–1938 (68) | WRITE-TX | **opens** (1883) + advisory lock; **เรียก `executePostBody` ในtx** | `resolvePostPermissionRoles`, `readBoolFlag/readNumberFlag`, `getApprovalRequiredDocTypes`, `transition.assertCanPost`, **`executePostBody`** | post-permission, approval-gate, assertCanPost | DRAFT/APPROVED → (template) |
| 24 | `executePostBody` ⚠️**shared** | 1958–2127 (170) | WRITE-TX (private, **รับ tx**) | **ไม่เปิดเอง — รับจาก post/approve** | `validatePeriodOpen`, **6 JE templates `.execute(id, tx)`**, `transition.resolveTargetStatus`, `tx.expenseDetail` | period-open, attachment-threshold, WHT-routing (C12), type-allowlist, V15 ACCRUAL-no-WHT | dispatch JE → ACCRUAL/POSTED |
| 25 | `approve` | 2146–2208 (63) | WRITE-TX | **opens** (2147) + advisory lock; **เรียก `executePostBody` ในtx** | `assertUserCanApprove`, `transition.assertCanApprove`, `readBoolFlag`, `prisma.auditLog`, **`executePostBody`** | approver-membership, assertCanApprove, auto_post flag | PENDING_APPROVAL → APPROVED → (POSTED) |
| 26 | `voidDocument` | 2216–2459 (244) | WRITE-TX | **opens** (2233) + advisory lock | `resolveReversePermissionRoles`, `readBoolFlag`, `getReverseReasons`, `bkkBusinessDate`, `validatePeriodOpen`, **`journal.createAndPost`** (reversal JE), `transition.assertCanVoid`, `prisma.auditLog` | reverse-permission, cascade-block (CN/SE), reason-required/whitelist, future-date, assertCanVoid, period | (any) → VOIDED + SE→ACCRUAL revert |
| 27 | `softDelete` | 2462–2474 (13) | WRITE (no $tx) | none | `prisma.expenseDocument` | DRAFT-only, deletedAt | DRAFT → (soft-deleted) |

**Cross-method call graph (สำคัญต่อ seam):**
- `getAuditTrail` → `findOne` (READ → READ)
- `post` → `executePostBody` (ใน tx เดียวกัน)
- `approve` → `executePostBody` (ใน tx เดียวกัน) — **executePostBody ถูกแชร์**
- `submitForApproval` → `notifyApprovers` (นอก tx)
- ทุก create*/update → utils (`assertCategoriesAreExpense`/`validateAdjustments`/`aggregator`) — **ไม่มี create*↔lifecycle cross-call**

---

## 2. Target Collaborator Services + Seams

แตกเป็น **3 collaborator services + 1 facade** (validate ข้อเสนอตั้งต้นของโจทย์ — ปรับ `previewJe`→Query, ย้าย `update`/`createDraftForRepair` ตามรายละเอียดด้านล่าง):

### 2.1 `ExpenseDocumentQueryService` (READ-only — Phase 1, ปลอดภัยสุด)
ย้าย 9 เมธอด: `list`, `getSummary`, `getTaxDisallowedSummary`, `getApAging`⚠️, `getDailySummary`, `getCreditNoteCap`, `previewJe`, `getAuditTrail`, `findOne`.
- **Inject:** `prisma`, `jePreview` (สำหรับ previewJe). ใช้ free-fns `collectJePreviewCodes`, `hasCrossBranchAccess`, `maskPayrollTaxIds` ตรง ๆ (import).
- **Intra-call:** `getAuditTrail`→`findOne` อยู่ service เดียวกัน → ปลอดภัย.
- **ไม่มี `$tx`** → ไม่มีทางตัด tx คร่อม seam. นี่คือเหตุผลที่ทำ Phase 1 ก่อน.
- ~525 LOC.

### 2.2 `ExpenseDocumentLifecycleService` (state machine + posting — Phase 2, เสี่ยงสุด)
ย้าย: `submitForApproval`, `post`, `executePostBody`(private), `approve`, `voidDocument`, `softDelete`, `notifyApprovers`(private) + private wrappers `readBoolFlag`/`readNumberFlag` (copy verbatim).
- **Inject:** `prisma`, `transition`, **6 templates** (`sameDay/accrual/creditNote/payroll/settlement/pettyCash` — ทั้งหมด `execute(id, tx)`), `journal`, `notifications?`.
- ใช้ free-fns ตรง ๆ: `resolvePostPermissionRoles`, `resolveReversePermissionRoles`, `validatePeriodOpen`, `bkkBusinessDate`, `assertUserCanApprove`, `getApprovalRequiredDocTypes`, `getApproversList`, `getReverseReasons`, util `readBoolFlag`.
- **เหตุผลคลัสเตอร์เดียว:** `executePostBody` ถูกเรียก **ในtx** ของทั้ง `post()` และ `approve()` → ต้องอยู่ service เดียวกันทั้งสาม มิฉะนั้น `$tx` จะคร่อม seam (ผิดกฎเด็ดขาด). `submitForApproval`+`notifyApprovers` และ `voidDocument` ก็โพสต์/แก้ state จึงรวมที่นี่.
- ~694 LOC.

### 2.3 `ExpenseDocumentCreateService` (create family — Phase 3, เสี่ยง)
ย้าย: `create`, `update`, `createDraftForRepair`, `createCreditNote`, `createPayroll`, `createSettlement`, `createPettyCash` + private wrapper `readBoolFlag` (copy verbatim).
- **Inject:** `prisma`, `docNumber`, `aggregator`, `ssoConfig`, `payrollCustom`, `pettyCash`, `transition` (สำหรับ `update.assertCanEdit`).
- ใช้ free-fns ตรง ๆ: `assertCategoriesAreExpense`, `validateAdjustments`, `ADJUSTMENT_ALLOWLIST`, `maskPayrollTaxIds`, `hasCrossBranchAccess`, util `readBoolFlag`/`readIntFlag`.
- **ไม่มี create*↔lifecycle cross-call** → seam สะอาด.
- ⚠️ **~963 LOC — ใหญ่สุด.** ดู §3 hazard H7 (optional further split).

### 2.4 `ExpenseDocumentsService` (facade — คงเดิม)
- **คง public signature 21 เมธอด** (controller 20 + `createDraftForRepair` ที่ RepairTickets เรียก) → controller/RepairTickets/expense-templates wiring **ไม่เปลี่ยน**.
- **คง `onModuleInit`** (boot CoA check) — inject `prisma`.
- **Inject 3 sub-services** + `prisma`; ทุก public method = one-line delegation เช่น `create(dto, u) { return this.create_.create(dto, u); }`, `createDraftForRepair(dto, tx) { return this.create_.createDraftForRepair(dto, tx); }` (tx ไหลผ่าน facade → Create, owner คือ RepairTickets เหมือนเดิม → ไม่มี straddle).
- ~150–200 LOC.

**สรุป LOC:** 2,475 → facade ~180 + Query ~525 + Lifecycle ~694 + Create ~963 (รวม >2,475 เพราะ boilerplate ของ class/constructor/imports 4 ไฟล์ + delegation).

---

## 3. Hazards & การจัดการ

| ID | Hazard | การจัดการ |
|----|--------|-----------|
| **H1** | `executePostBody` ถูกเรียก**ในtx**ของ `post()` + `approve()` | เก็บ `post`+`approve`+`executePostBody` ใน **Lifecycle เดียวกัน** → intra-service call, tx ไม่คร่อม seam |
| **H2** | `getAuditTrail`→`findOne` | ทั้งคู่ READ → ย้ายเข้า **Query พร้อมกัน** ใน slice เดียว → intra-service |
| **H3** | `createDraftForRepair` **รับ tx จาก RepairTicketsService** | facade คง signature `createDraftForRepair(dto, tx)` → delegate ไป Create; tx ยัง owned โดย RepairTickets, Create แค่ enlist (เหมือนวันนี้). RepairTickets/its module **ไม่เปลี่ยน** (มัน import `ExpenseDocumentsModule` + เรียก facade) |
| **H4** | `readBoolFlag`/`readNumberFlag` private wrappers ถูกใช้ทั้ง Create + Lifecycle | copy wrapper **verbatim** เข้าแต่ละ service ที่ใช้ (3–7 บรรทัด, body = delegate ไป util → behavior-identical). `readNumberFlag` เฉพาะ Lifecycle (post ใช้). *Optional* dedup ภายหลัง |
| **H5** | `onModuleInit` boot-check | คงบน **facade** (NestJS เรียก onModuleInit ของ provider; facade ยังเป็น provider) — รันครั้งเดียวตอน boot เหมือนเดิม |
| **H6** | `expense-templates.service.ts` ใช้ `forwardRef(() => ExpenseDocumentsService)` เรียก `create/createPayroll/createSettlement` | facade ยัง expose เมธอดเหล่านี้ (delegate ไป Create) → forwardRef **ไม่เปลี่ยน** |
| **H7** | Create ~963 LOC ยังใหญ่ | *Optional Phase 3b* แยกต่อ (เช่น core `create`/`update`/`createDraftForRepair` vs specialized `createCreditNote`/`createPayroll`/`createSettlement`/`createPettyCash`) — **ไม่มี cross-call** จึงแยกได้. แนะนำ: ทำ 3-service ให้จบก่อน (seam น้อย = เสี่ยงน้อย) แล้วเจ้าของค่อยตัดสิน 3b |
| **H8** | **$tx-straddle audit** | ทุก WRITE-TX เปิด tx ของตัวเองและเรียก collaborator **ภายใน** tx นั้น (templates/journal/docNumber/utils ทั้งหมดรับ `tx`). หลังแตกแล้ว **ไม่มี tx คร่อม service** — facade delegation เป็น call ธรรมดา (ไม่มี tx ครอบ). ✅ ยืนยันแล้วทุกเมธอด |

### 3.1 กลไก test-construction (หัวใจที่ทำให้ refactor นี้ทำได้)
412 tests สร้าง **facade** ด้วย mock 15–16 ตัว แล้ว assert บน mock เหล่านั้น (เช่น `expect(docNumberMock.next).toHaveBeenCalled`). เมื่อเมธอดย้ายไป sub-service, mock ต้องไปถึง sub-service. **Slice 0 factory** แก้ปัญหานี้: factory สร้าง sub-services จาก mock เดียวกันแล้วส่งเข้า facade → test เรียก `service.create(...)` เหมือนเดิม, mock instance เดียวกันไหลถึง sub-service → assertion เดิมผ่าน. **factory = construction site เดียวที่เปลี่ยนทุก slice.**

---

## 4. Slice Plan (smallest-safe-first)

> **เลือก strictly-sequential-on-main** (ไม่ stack): แต่ละ slice base = main, merge แล้วค่อย branch ตัวถัดไป. ทุก slice แก้ไฟล์เดียวกัน (`expense-documents.service.ts` + `.module.ts` + ไฟล์ service ใหม่) → stack จะ conflict + เสี่ยง stacked-merge incident ซ้ำรอย. ดู §5 merge order.

### Slice 0 — Test-construction de-risk (no prod behavior change)
- **เป้า:** เพิ่ม factory `makeExpenseDocumentsService(overrides)` (เช่น `__tests__/support/make-expense-documents-service.ts`) แล้ว migrate **7 ไฟล์ / 16 `new` statements** มาใช้ factory:
  `expense-documents.service.spec.ts`(**10**), `tax-disallowed`(1), `settlement`(1), `credit-note`(1), `multi-line-create`(1), `payroll`(1), `payroll-user-link`(1).
  (`expense-documents.controller.spec.ts` ใช้ `useValue` mock — ไม่แตะ.)
- **เหตุผล:** ปัจจุบัน `as never` cast ซ่อน arg-count/type drift = อันตรายตอนเพิ่ม param. factory รวมเหลือ 1 จุด.
- factory ต้องรองรับ 2 arg-shape เดิม (15-arg omit notifications: service.spec+tax-disallowed · 16-arg incl `notifications.send`: อีก 5 ไฟล์) และ default `aggregator = new LineAggregatorService()` (REAL — หลาย test พึ่งการ aggregate จริง).
- **Char-test:** ไม่ย้าย logic → 412 ต้องเขียวเป๊ะ (เปลี่ยนแค่วิธีสร้าง).
- **Gate:** tsc 0 + 412 green. → PR. **STOP รอ merge.**

### Phase 1 — `ExpenseDocumentQueryService` (READ-only)
- **Char-test ก่อนย้าย (เติม gap):** read methods ที่ยังไม่ pin โดยตรง — โดยเฉพาะ `getApAging`⚠️ (pin bucket math + labels `0-30/31-60/61-90/90+` + net=total−wht), และเช็ค `getSummary`/`getCreditNoteCap`/`getAuditTrail` มี assertion ตรงหรือไม่ ถ้าไม่มีให้เพิ่ม. (`getDailySummary` 4, `getTaxDisallowedSummary` 7, `findOne` 2, `previewJe`→je-preview.service 8, `list` 5 มีแล้ว.)
- ย้าย 9 เมธอด **verbatim** เข้า Query (`getApAging` ไม่แตะ labels). facade delegate. factory wire Query จาก mock เดิม.
- **Gate:** tsc 0 + 412 green. → PR. **STOP รอ merge + เจ้าของ re-confirm ก่อน Phase 2/3.**

### Phase 2 — `ExpenseDocumentLifecycleService` (state machine + posting) — *หลัง Phase 1 + re-confirm*
แยกย่อย 3 sub-slices (diff เล็ก = review ปลอดภัย):

- **2a — submit/notify/softDelete:** ย้าย `submitForApproval`, `notifyApprovers`, `softDelete` + `readBoolFlag` wrapper → สร้าง Lifecycle service. (ไม่มี JE dispatch; submit = status flip + audit + notify-นอก-tx).
  - Char: มีแล้ว (submit 4: flag-gate/DRAFT→PENDING flip/non-DRAFT reject/soft-deleted; softDelete 3).
- **2b — posting core (HIGHEST RISK):** ย้าย `post` + `executePostBody` + `approve` + `readNumberFlag` wrapper (ต้องไปด้วยกัน — shared inner-tx body).
  - **Char-test ก่อนย้าย (เติม gap ที่ pin ไว้ 0 จุดวันนี้):**
    (1) `post()` CREDIT_NOTE → `creditNoteTemplate.execute(id, tx)` toHaveBeenCalled
    (2) `post()` PETTY_CASH_REIMBURSEMENT → `pettyCashTemplate.execute(id, tx)`
    (5) `executePostBody` type-allowlist `'type X not supported'` reject branch
    + approve auto-post routing CN/SE/petty (gap เดียวกัน)
    (ที่ pin แล้ว: sameDay/accrual/settlement/payroll routing, V15, C10 attachment, C12 WHT-formType, C9 period, D1.2.1.2 approval-gate, approver-list, APPROVED/AUTO_POSTED audit — คงเขียวทั้งหมด)
- **2c — void:** ย้าย `voidDocument` → Lifecycle.
  - Char: pin แล้วครบ (flipped-Dr/Cr reversal via `journal.createAndPost` + metadata, CAS VOIDED flip, advisory lock, SE→ACCRUAL revert, cascade-block CN/SE, reason/whitelist/future-date guards, C3 audit) — verbatim move.
- แต่ละ sub-slice: facade delegate + factory wire Lifecycle. **Gate:** tsc 0 + 412 green. → PR ต่อ slice.

### Phase 3 — `ExpenseDocumentCreateService` (create family) — *หลัง Phase 2 + re-confirm*
- **Char-test ก่อนย้าย (เติม gap):**
    (3) `createPettyCash` happy-path: pin `expenseDocument.create` args (`documentType=PETTY_CASH_REIMBURSEMENT`, `status=DRAFT`) + เรียก `pettyCash.validate`
    (4) `update()` happy-path body (DRAFT edit persist lines/totals via `expenseLine.deleteMany`+`expenseDetail.update`+`expenseDocument.update`) — วันนี้ pin แค่ rejection (assertCanEdit)
    + ยืนยัน `createDraftForRepair` ถูก pin (ผ่าน `repair-tickets.service.spec.ts` หรือเพิ่ม direct test — รับ external tx)
    (ที่ pin แล้ว: create, createCreditNote, createPayroll, createSettlement guards+DRAFT — verbatim move)
- ย้าย 7 เมธอด **verbatim** เข้า Create. facade delegate. factory wire Create.
- **Gate:** tsc 0 + 412 green. → PR.
- **Optional 3b:** แยก Create ต่อ (H7) — ถามเจ้าของ.

---

## 5. Risk Register + Merge Order

### 5.1 Risk register
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `$tx` คร่อม seam (JE/state เพี้ยน) | Low | **Critical** | §3 H8 audit ผ่านแล้ว — ทุก tx self-contained ใน service เดียว; executePostBody อยู่กับ post/approve |
| เพิ่ม ctor param พัง 16 `new` sites | High→**Low** | High | Slice 0 factory ทำก่อน → 1 construction site |
| JE-dispatch routing เพี้ยนตอนย้าย posting core | Med | **Critical** | 2b char-test เติม gap CN/petty/type-allowlist ก่อน + ย้าย verbatim + pin template.execute args |
| `getApAging` label/bucket เพี้ยน (TRAP) | Low | High | ย้าย **verbatim**, char-test pin bucket+labels ก่อน, ห้าม unify |
| main เคลื่อนระหว่างทาง (stacked-merge ซ้ำรอย) | Med | High | strictly-sequential-on-main; re-confirm `origin/main` ก่อนทุก slice; **เจ้าของ verify content landed บน main จริง** (อย่าเชื่อ gh "MERGED") |
| `createDraftForRepair` external-tx เพี้ยน | Low | High | facade คง signature; tx ไหลผ่าน; RepairTickets unchanged; char-test ก่อนย้าย |
| 412 → ลดจำนวน (test หาย) | Low | Med | gate นับ test ทุก slice; factory migrate = แก้วิธีสร้าง ไม่ลบ test |

### 5.2 Merge order (เจ้าของ merge — ผมไม่ push main)
**ลำดับ (1 slice = 1 branch = 1 PR, base=main, sequential):**
1. `chore/exp-decompose-s0-test-factory` → merge → main
2. `refactor/exp-decompose-p1-query` (base = main หลัง #1) → merge → **STOP, เจ้าของ re-confirm**
3. `refactor/exp-decompose-p2a-submit-notify` → merge
4. `refactor/exp-decompose-p2b-posting-core` → merge
5. `refactor/exp-decompose-p2c-void` → merge → **STOP, re-confirm**
6. `refactor/exp-decompose-p3-create` → merge
7. *(optional)* `refactor/exp-decompose-p3b-create-split`

**ถ้าจำเป็นต้อง stack** (เจ้าของขอ queue): แต่ละ child base = parent branch; **ก่อน merge ต้อง retarget base→main ทีละตัว** + **verify content landed บน main จริง** (git diff origin/main) ก่อนไปตัวถัดไป — กฎจาก stacked-merge incident (#1194/#1195/#1202–1205). **แนะนำ sequential-on-main มากกว่า** (หลีกเลี่ยงปัญหานี้ทั้งหมด).

---

## 6. ขออนุมัติ (STOP)

โปรดยืนยัน/แก้:
1. **3-service seam** (Query / Lifecycle / Create + facade) ตามนี้ หรือต้องการแยก Create ตั้งแต่แรก (H7 / Phase 3b)?
2. **Sub-slicing Phase 2** เป็น 2a/2b/2c (แนะนำ) หรือรวมเป็น Lifecycle slice เดียว?
3. **Sequential-on-main** (แนะนำ) หรือ stack-with-retarget?
4. ผ่านแล้วจะเริ่มที่ **Slice 0 (test factory)** — implement → spec-review → quality-review → PR → STOP รอ merge.

**ยังไม่เขียน implementation code จนกว่าจะอนุมัติ.**
