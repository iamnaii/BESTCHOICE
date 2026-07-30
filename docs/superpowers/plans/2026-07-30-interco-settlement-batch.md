# เมนูจ่ายให้หน้าร้าน (INTER-CO) — รอบจ่าย Batch 2 ฝั่ง Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เอกสาร "รอบจ่าย" (batch) ที่ FINANCE จ่ายยอดจัด+ค่าคอมให้ SHOP → ลงบัญชี 2 ฝั่ง atomic (Dr 21-1101/21-1102 / Cr 11-1201 คู่กับ Dr S11-1201 / Cr S11-3001/S11-3002) พร้อม maker-checker + โหมดย้อนหลัง — spec: `docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md` (BINDING ทุก §)

**Architecture:** โมดูลใหม่ `interco-settlement/` (pending engine อ่าน GL ต่อสัญญา + batch lifecycle + paired JE) — JE ผ่าน `PairedJournalService` เดิม; เลขเอกสาร `IC-YYYYMMDD-NNNN` ด้วย advisory-lock sequencer pattern `RepairTicketDocNumberService` (ห้ามแตะ enum `DocumentType`); retire เส้นจ่ายเก่า 2 ชุด

**Tech Stack:** ตามชุดเดิม — NestJS/Prisma/Decimal, jest unit, vitest integration (`*.integration.spec.ts` + **ต้องเพิ่ม glob ใน deploy-gcp.yml** — jest มองไม่เห็นตาม `testPathIgnorePatterns`), React/shadcn/react-query

## Global Constraints

- Branch `feat/interco-settlement-batch` แตกจาก main **หลัง PR #1383 (device-swap) merge แล้วเท่านั้น** (แตะ journal.module ใกล้กัน)
- ยอดทุกตัวมาจาก **GL เท่านั้น** — ห้ามอ่าน `contract.financedAmount/storeCommission` เป็นแหล่งยอด (spec F4: 1A fallback ค่าคอม 10% เมื่อ field null)
- เลนส์ต่อสัญญา: `payableOrigin_i` = Σ(Cr−Dr) ของ 21-1101/21-1102 จาก JE POSTED ที่ `metadata.contractId = i`; **JE ของรอบจ่ายไม่เข้าเลนส์นี้** — สถานะจ่ายแล้วดูจาก `InterCoSettlementItem` ใน batch `PENDING_APPROVAL/POSTED` เท่านั้น (spec §4)
- ฝั่ง SHOP: post เฉพาะสัญญาที่ GL S11-3001/S11-3002 มียอดจริง, cap ต่อสัญญา; `legacyNoShop` → รอบนั้นฝั่ง SHOP ไม่รวมสัญญานี้ (spec F1/F2) — **ห้ามเดาลงบัญชีแทน**
- Drift guard 4 บัญชี ±0.01 ใน approve tx + period guard **ทั้ง 2 บริษัท** (`validatePeriodOpen` — `src/utils/period-lock.util.ts:71`)
- Maker ≠ approver (server-side), roles: สร้าง/submit = ACCOUNTANT, FINANCE_MANAGER; approve/reverse = OWNER, FINANCE_MANAGER
- JE idempotency: `metadata.flow='interco-settlement-batch'` + `idempotencyKey` = `interco:{batchId}:FINANCE` / `interco:{batchId}:SHOP` (ครอบด้วย partial unique index เดิม `journal_entries_idempotency_idx`)
- Money = `Prisma.Decimal` เท่านั้น; error message ภาษาไทย; soft delete; UUID; timestamps ครบ; commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Reference บัญชี: FINANCE จ่ายจาก `11-1201` (default), SHOP รับเข้า `ShopAccountResolver.SHOP_RECEIVING_BANK` (= `'S11-1201'`, `shop-account-resolver.service.ts:18`)

---

### Task 1: Prisma schema — batch + item + enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration `add_interco_settlement_batch`

**Produces (Tasks 2-6 พึ่ง):** models `InterCoSettlementBatch`, `InterCoSettlementItem`, enum `InterCoBatchStatus { DRAFT PENDING_APPROVAL POSTED REVERSED CANCELLED }`

- [ ] **Step 1:** เพิ่ม models ตาม spec §3 เป๊ะ (ฟิลด์/ชนิด/`@map` snake_case ตาม convention):
  - Batch: `batchNumber @unique`, `status`, `transferDate`, `postedAt?`, `financeBankCode`, `shopBankCode`, เงิน 4 ช่อง `@db.Decimal(12,2)` (`totalFinanced/totalCommission/totalAmount/shopPostedAmount`), `transferRef?`, `slipFileKey?`, `note?`, `makerId` + `approverId?` (FK → User, `@relation` ตั้งชื่อ `InterCoBatchMaker`/`InterCoBatchApprover`), `financeJournalEntryId? @unique`, `shopJournalEntryId? @unique`, `reverseReason?`, timestamps 3 ตัว + `@@index([status])`, `@@index([transferDate])`
  - Item: `batchId` FK (`onDelete: Restrict`), `contractId` FK (`Restrict`), เงิน 4 ช่อง GL snapshot, `legacyNoShop`, `@@unique([batchId, contractId])`, `@@index([contractId])`, timestamps
- [ ] **Step 2:** `npx prisma migrate dev --name add_interco_settlement_batch` → migration สร้าง + `npx prisma generate` ผ่าน; `./tools/check-types.sh api` = 0
- [ ] **Step 3:** Commit `feat(interco): schema รอบจ่าย InterCoSettlementBatch/Item`

### Task 2: Pending engine + เลขเอกสาร + patch metadata ฝั่ง SHOP

**Files:**
- Create: `apps/api/src/modules/interco-settlement/interco-pending.service.ts`
- Create: `apps/api/src/modules/interco-settlement/interco-batch-number.service.ts`
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-inventory-transfer.template.ts` (revenue-leg metadata)
- Test: `apps/api/src/modules/interco-settlement/interco-pending.service.spec.ts` (jest, mock prisma)

**Interfaces (Produces):**
```ts
interface PendingContract {
  contractId: string; contractNumber: string; customerName: string; activatedAt: Date | null;
  financedGl: Prisma.Decimal; commissionGl: Prisma.Decimal;        // เลนส์ 21-1101 / 21-1102
  shopFinancedGl: Prisma.Decimal; shopCommissionGl: Prisma.Decimal; // เลนส์ S11-3001 / S11-3002
  legacyNoShop: boolean;                                            // shop ทั้งคู่ = 0
}
IntercoPendingService.getPendingContracts(tx?): Promise<PendingContract[]>
IntercoPendingService.getReconcileTotals(): Promise<{ pendingTotal, glFinanceTotal, glShopTotal, drift }>
IntercoBatchNumberService.next(tx): Promise<string> // 'IC-YYYYMMDD-NNNN' BKK-day advisory lock
```

- [ ] **Step 1:** ตรวจ `shop-inventory-transfer.template.ts` revenue-leg (`flow:'shop-inventory-transfer-revenue'`, ~line 303): ถ้า metadata **ไม่มี** `contractId` → เพิ่ม `contractId: input.contractId` (additive — idempotency ใช้ cogs-leg + batchId ไม่กระทบ) + note ใน Task 7 pre-flight: SQL backfill metadata ให้ JE เก่า (จับคู่ผ่าน cogs-leg `batchId`)
- [ ] **Step 2:** เขียน failing tests: (ก) เลนส์ payableOrigin รวมเฉพาะ JE ที่มี `metadata.contractId` — JE รอบจ่าย (ไม่มี key นี้) ไม่ถูกนับ; (ข) contract ที่มี item ใน batch PENDING_APPROVAL/POSTED หลุดจากคิว, REVERSED/CANCELLED ไม่หลุด; (ค) `legacyNoShop=true` เมื่อ shop GL = 0 ทั้งคู่; (ง) ห้ามอ่าน contract.financedAmount (mock ให้ค่า field ต่างจาก GL → ผลต้องตาม GL)
- [ ] **Step 3:** Implement — เลนส์ใช้ `$queryRaw` (Prisma group by JSON path ไม่ได้):
  ```sql
  SELECT je.metadata->>'contractId' AS contract_id,
         SUM(CASE WHEN jl.account_code = '21-1101' THEN jl.credit - jl.debit ELSE 0 END) AS financed,
         SUM(CASE WHEN jl.account_code = '21-1102' THEN jl.credit - jl.debit ELSE 0 END) AS commission
  FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_code IN ('21-1101','21-1102') AND jl.deleted_at IS NULL
    AND je.status = 'POSTED' AND je.deleted_at IS NULL AND je.metadata->>'contractId' IS NOT NULL
  GROUP BY 1 HAVING SUM(jl.credit - jl.debit) > 0
  ```
  (เลนส์ SHOP เหมือนกันบน `S11-3001/S11-3002` sign กลับ: `debit - credit`) → join contracts (เลขสัญญา/ลูกค้า/activatedAt, `deletedAt IS NULL`) → กรอง `settled` ด้วย `interCoSettlementItem.findMany({ where: { batch: { status: { in: ['PENDING_APPROVAL','POSTED'] } } } })`; sequencer ยก pattern `RepairTicketDocNumberService` (advisory lock + `getBkkDayBounds`) prefix `IC`
- [ ] **Step 4:** Tests เขียว + types 0 → Commit `feat(interco): pending engine (เลนส์ GL ต่อสัญญา) + IC doc number`

### Task 3: Batch lifecycle service (DRAFT → PENDING_APPROVAL, withdraw, cancel)

**Files:**
- Create: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts`
- Create: `apps/api/src/modules/interco-settlement/dto/create-batch.dto.ts` (+`update-batch.dto.ts`, `reverse-batch.dto.ts`)
- Test: `apps/api/src/modules/interco-settlement/interco-settlement.service.spec.ts`

**Interfaces (Produces):**
```ts
createBatch(dto: CreateBatchDto, userId): Promise<Batch>   // dto: { contractIds: string[]; transferDate: string; financeBankCode?; shopBankCode?; transferRef?; slipFileKey?; note? }
submitBatch(id, userId) / withdrawBatch(id, userId) / cancelBatch(id, userId)
listBatches(query) / getBatch(id)  // getBatch รวม items + JE entryNumbers
```

- [ ] **Step 1:** Failing tests: create → snapshot 4 ยอดจาก `IntercoPendingService` (ไม่ใช่ contract fields), `totalAmount = Σ(financedGl+commissionGl)`, `shopPostedAmount = Σ ที่ legacyNoShop=false`; create มีสัญญาที่ settled แล้ว → `BadRequestException('สัญญา ... อยู่ในรอบจ่ายอื่นแล้ว')`; submit โดย role อื่น/แก้ PENDING → reject; withdraw กลับ DRAFT ได้เฉพาะ maker; cancel = soft (status CANCELLED) เฉพาะ DRAFT/PENDING
- [ ] **Step 2:** Implement + AuditLog strings `INTERCO_BATCH_CREATED/SUBMITTED/WITHDRAWN/CANCELLED` (`entity='interco_settlement_batch'`) — เขียว → Commit `feat(interco): batch lifecycle + snapshots`

### Task 4: approve() + reverse() — paired JE + guards (หัวใจของงาน)

**Files:**
- Modify: `interco-settlement.service.ts`
- Test: `apps/api/src/modules/interco-settlement/__tests__/interco-settlement.integration.spec.ts` (vitest, DB จริง)
- Modify: `.github/workflows/deploy-gcp.yml` — เพิ่ม glob `src/modules/interco-settlement/__tests__/*.integration.spec.ts` ใน vitest step (fail-loud แบบ `JP5_FILES`)

**Consumes:** `PairedJournalService.postPaired({ shop: PairedJeHalf, finance: PairedJeHalf, batchRef })` (`paired-journal.service.ts:99` — แต่ละ half `{ companyCode, description, lines: JeLineInput[] }` ตรวจบาลานซ์ก่อน post ทั้งคู่); `validatePeriodOpen(prisma, postedAt, companyId)`

- [ ] **Step 1 (integration tests ก่อน — DB จริง, ยก setup pattern จาก `bad-debt.streak-provision.integration.spec.ts` + cleanup ล้าง `journalPostAuditLog` ก่อน `journalEntry` ตาม convention):** goldens spec §12 ครบ 6 ข้อ:
  1. activate 2 สัญญาผ่าน template จริง (1A + shop-inventory-transfer): A = financed 10,000 / commission 1,000; B = financed 10,000 / **storeCommission null** (1A book 1,000 จาก fallback 10%) → รอบเดียว 2 สัญญา → approve → GL 21-1101/21-1102/S11-3001/S11-3002 ของทั้งคู่ = 0.00 เป๊ะ, FINANCE JE Dr 20,000+2,000 / Cr 11-1201 22,000, SHOP JE Dr S11-1201 22,000, TB `scope='ALL'` `isAllBalanced=true`, batch POSTED + `financeJournalEntryId/shopJournalEntryId` set
  2. สัญญา legacy (1A อย่างเดียว ไม่ post shop-transfer) → `legacyNoShop=true`, approve → FINANCE JE ใบเดียว, `shopJournalEntryId=null`, `shopPostedAmount=0`
  3. drift: หลัง snapshot post JV มือ Dr 21-1101 (metadata.contractId ตรง) → approve → `BadRequestException` มีเลขสัญญาในข้อความ
  4. กันซ้ำ: create รอบสองด้วยสัญญาเดิม → reject ตอน create; หลัง reverse รอบแรก → create ใหม่ผ่าน
  5. maker กด approve เอง → `ForbiddenException`; งวด SHOP ปิด (สร้าง `AccountingPeriod` CLOSED เฉพาะ SHOP) → reject ข้อความระบุบริษัท
  6. reverse: JE REVERSAL 2 ใบ (`reversesEntryId` ชี้กลับ), GL กลับมามียอดครบ, batch REVERSED + `reverseReason`, pending เห็นสัญญาอีกครั้ง
- [ ] **Step 2:** Implement `approveBatch(id, userId)` ใน `$transaction` เดียว: re-check SoD + status → drift guard (เรียกเลนส์ Task 2 ด้วย tx เทียบ snapshot ±0.01) → `validatePeriodOpen` FINANCE + SHOP → สร้าง lines:
  ```ts
  // FINANCE half — Dr แยกบรรทัดต่อสัญญา (description = เลขสัญญา), Cr เดียว
  finance.lines = [...items.map(i => ({ accountCode:'21-1101', dr:i.financedGl, cr:D0, description:`ล้างเจ้าหนี้ยอดจัด ${i.contractNumber}` })),
                   ...items.filter(i=>i.commissionGl.gt(0)).map(i => ({ accountCode:'21-1102', dr:i.commissionGl, cr:D0, description:`ล้างเจ้าหนี้ค่าคอม ${i.contractNumber}` })),
                   { accountCode: batch.financeBankCode, dr:D0, cr:totalAmount, description:`จ่ายให้หน้าร้าน รอบ ${batch.batchNumber} (โอนจริง ${fmtBkk(transferDate)})` }]
  // SHOP half — เฉพาะ items legacyNoShop=false; ไม่มีเลย → ข้าม postPaired ใช้ createAndPost ฝั่ง FINANCE เดี่ยว
  ```
  metadata ทั้งสองใบ: `{ flow:'interco-settlement-batch', idempotencyKey:'interco:{id}:FINANCE|SHOP', batchId, batchNumber, transferDate, items:[{contractId, financed, commission}] }` → mark ICT `RECONCILED` (best-effort where contractId in items) → batch POSTED + audit `INTERCO_BATCH_APPROVED`; `reverseBatch` = mirror-reverse ทั้ง 2 ใบ (pattern `reversesEntryId` เดิม) + audit `INTERCO_BATCH_REVERSED`
- [ ] **Step 3:** vitest integration เขียวครบ (`npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/*.integration.spec.ts`) + เพิ่ม glob ใน deploy-gcp.yml + รัน orphan-spec check ด้วยมือ (spec ใหม่ต้องเข้า CI จริง) → Commit `feat(interco): approve/reverse — paired JE + drift/period/SoD guards`

### Task 5: Controller + retire ของเก่า + ซ่อมสูตรยอดค้าง

**Files:**
- Create: `apps/api/src/modules/interco-settlement/interco-settlement.controller.ts` + `interco-settlement.module.ts` (ลง `app.module.ts`)
- Modify: `apps/api/src/modules/intercompany/intercompany.service.ts` (`getOutstandingBalance` สูตรใหม่) + controller (POST settle → 410)
- Delete: `apps/api/src/modules/shop-finance-settlement/` ทั้ง module (+ ถอนจาก app.module), `apps/api/src/modules/journal/cpa-templates/vendor-clearance.template.ts` (+ journal.module + spec ของมัน)
- Test: controller spec (roles/410) + แก้ intercompany.service.spec ตามสูตรใหม่

- [ ] **Step 1:** Endpoints (class guard `JwtAuthGuard, RolesGuard`):
  | Method | Path | Roles |
  |---|---|---|
  | GET `/interco-settlement/pending` | คิว + reconcileTotals | OWNER, FM, ACCOUNTANT |
  | GET `/interco-settlement/batches` (+`/:id`) | list/detail | OWNER, FM, ACCOUNTANT |
  | POST `/interco-settlement/batches` | create | ACCOUNTANT, FM |
  | POST `/interco-settlement/batches/:id/submit` \| `/withdraw` \| `/cancel` | lifecycle | ACCOUNTANT, FM |
  | POST `/interco-settlement/batches/:id/approve` | approve | OWNER, FM |
  | POST `/interco-settlement/batches/:id/reverse` | body `{reason: string}` (min 10) | OWNER, FM |
  | POST `/interco-settlement/batches/:id/slip` | แนบสลิป (optional) — `@UseInterceptors(FileInterceptor('file'))` + S3 pattern เดิม (backend rules) → เก็บ `slipFileKey`; เฉพาะ DRAFT/PENDING โดย maker | ACCOUNTANT, FM |
- [ ] **Step 2:** `getOutstandingBalance` ใหม่: FINANCE = Σ(Cr−Dr) GL `21-1101`+`21-1102` (companyId FINANCE), SHOP = Σ(Dr−Cr) `S11-3001`+`S11-3002` (companyId SHOP), `drift` + field ใหม่ `driftNote: 'ส่วนต่าง = สัญญาก่อน 2026-06-23/เปลี่ยนเครื่อง (สมุด SHOP ยังไม่ตั้งลูกหนี้)'`; POST `/accounting/intercompany/settle` → `HttpStatus.GONE` ข้อความชี้เมนูใหม่
- [ ] **Step 3:** jest ทั้ง suite ที่แตะ (intercompany + interco-settlement + ตรวจไม่มี import ค้างถึงไฟล์ที่ลบ) เขียว + types 0 → Commit `feat(interco): endpoints + retire เส้นจ่ายเก่า + ซ่อมสูตรยอดค้าง`

### Task 6: Web UI — rebuild หน้าเดิม 2 แท็บ

**Files:**
- Rewrite: `apps/web/src/pages/IntercompanySettlementPage.tsx` (route เดิม `/accounting/intercompany`)
- Create: `apps/web/src/pages/interco/CreateBatchDialog.tsx`, `BatchDetailSheet.tsx` (ตามขนาดไฟล์ — แยกไฟล์ถ้า >300 บรรทัด)
- Modify: `apps/web/src/config/menu.ts` — label เดียว "จ่ายให้หน้าร้าน (Inter-co)" (ตัด "ชำระเงินระหว่างบริษัท" line 422 ให้ชื่อตรงกัน)
- Test: `apps/web/src/pages/__tests__/IntercompanySettlementPage.test.tsx` (vitest — render 2 แท็บ + ปุ่มตาม role + LEGACY badge)

- [ ] **Step 1:** แท็บ "รอจ่าย": ตาราง `GET /interco-settlement/pending` (คอลัมน์: เลขสัญญา/ลูกค้า/activate/ยอดจัด/ค่าคอม/badge "LEGACY — SHOP ไม่มียอดตั้งต้น"), checkbox multi-select + แถบรวมยอด → `CreateBatchDialog` (วันที่โอน + บัญชี default 11-1201/S11-1201 + transferRef + note + แนบสลิปไฟล์ optional ผ่าน endpoint `/slip`; **วันที่ย้อนหลัง**: ถ้า API ตอบงวดปิด → dialog เสนอ 2 ทางตาม D4) — react-hook-form + zod, `useMutation` + `invalidateQueries`, toast sonner, design tokens เท่านั้น
- [ ] **Step 2:** แท็บ "รอบจ่าย": list + `BatchDetailSheet` (items, ยอด, JE เลขที่ 2 ใบลิงก์, maker/approver, ปุ่ม submit/withdraw/approve/reverse ตาม role+status — approve โชว์ preview JE 2 ฝั่งก่อนยืนยัน ConfirmDialog, reverse ต้องกรอกเหตุผล ≥10)
- [ ] **Step 3:** web tests + `npm run build --workspace=apps/web` ผ่าน → Commit `feat(interco-web): หน้าเมนูจ่ายให้หน้าร้าน — 2 แท็บ + สร้างรอบ + อนุมัติ`

### Task 7: Docs + pre-flight + gates

**Files:**
- Modify: `.claude/rules/accounting.md` — section ใหม่ "Inter-Co Settlement Batch (C2)" (โครง: trigger/JE 2 ฝั่ง/เลนส์ pending/legacy policy/D4)
- Create: `docs/accounting/interco-preflight-2026-07.sql` (คำสั่ง §10 ทั้ง 3 ข้อ + backfill metadata revenue-leg ถ้า Task 2 Step 1 พบว่าต้องเพิ่ม)
- Modify: spec §13 device-swap — ติ๊ก C2 ว่า plan/build แล้ว

- [ ] **Step 1:** เขียน docs ทั้งสอง (ตัวเลข/บัญชี/ชื่อ flow ตรงโค้ดจริง — ห้ามเขียนตาม plan ถ้าโค้ดเปลี่ยนระหว่างทาง)
- [ ] **Step 2:** Gates เต็ม: `./tools/check-types.sh all` = 0, jest full (triage depreciation debris ตาม baseline เดิม), vitest CI-glob เต็มรวม glob ใหม่, web build — แล้ว code-review ระดับ branch + fix wave ตาม pattern
- [ ] **Step 3:** Commit + เปิด PR — body มี: สรุป, ผล gates, **Rollout checklist**: (1) pre-flight SQL ทั้ง 3 ข้อบน prod (นับ JE flow เก่า — คาด 0), (2) backfill metadata revenue-leg (ถ้ามี), (3) สร้างรอบ backfill ตาม statement จริงโดยพี่นาย (โหมดย้อนหลัง), (4) คำถาม CPA 2 ข้อจาก spec §11 แนบให้ owner ส่ง

## Out of scope (ตาม spec §13)
- จ่ายบางส่วน / LATE_FEE_SHARE / statement auto-match / SHOP opening backfill (รอ CPA) / wire SHOP-leg ให้ exchange path / retire โมเดล InterCompanyTransaction
