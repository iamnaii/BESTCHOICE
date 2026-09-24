# หลังการขาย PR 2 — ทางออกเปลี่ยนเครื่อง · แท็บรออนุมัติ · ซ่อมที่ร้าน · ถอดหน้าเก่า (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ต่อทางออก "เปลี่ยนรุ่นเดิม (ผ่อน)" และ "เปลี่ยนแบบมีราคา" เข้าเคสหลังการขาย ให้แท็บ "รออนุมัติ" ทำงานจริง เปิดทาง "ซ่อมที่ร้าน" ถอดหน้าเก่า `/insurance/*` + `/defect-exchange` ทั้งชุด และปิดข้อย่อย R25 — โดย **ไม่แตะเครื่องยนต์บัญชี** ของ `defect-exchange` / `contract-exchange`

**Architecture:** เคส (`AfterSalesCase`) เป็นศูนย์กลาง; ทางออกเปลี่ยนเครื่องเรียก **engine เดิมทั้งสองตัวผ่าน service ใหม่ `AfterSalesExchangeService`** (proxy + compensation) และ **stage คำนวณจากสถานะของ engine** ผ่าน `deriveStage` รุ่นสอง (อ่าน `ContractExchangeRequest`/สัญญาใหม่/`closedAt`) — คอลัมน์ `stage` ยังเป็นแค่ index ที่ `reconcileStage` ซ่อมให้เอง (สถาปัตยกรรม PR 1) · ฝั่งเว็บต่อยอด 3 หน้าเดิม (ไม่มีหน้าใหม่) · หน้าเก่าเปลี่ยนเป็น redirect แล้วลบไฟล์

**Tech Stack:** NestJS + Prisma (jest unit · vitest integration บน DB จริง) · React + Vite + Tailwind + shadcn + react-query (vitest + testing-library) · Playwright E2E 1 เส้น

**Spec:** `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` (ข้อ 4.3–4.5 · 5 ตาราง stage · 6 API · 7 สิทธิ์ · 11–14) · mockup V4 กระดาน "หน้าเคสรอ ผจก. ยืนยัน" + "สถานการณ์ C แท็บรออนุมัติ" (artifact SoThf1rbZEaxas5KJgudxp) · แผน PR 1 `docs/superpowers/plans/2026-09-24-after-sales-hub-pr1.md` (interface ที่มีอยู่แล้ว) · ledger PR 1 rulings R19/R21/R25 (ยอมรับโดยเจ้าของ 2026-09-24)

## Global Constraints

- Prisma: ทุก model มี `createdAt`, `updatedAt`, `deletedAt`; id เป็น UUID; **ห้าม hard delete**; ทุก query กรอง `deletedAt: null` (`.claude/rules/database.md`) · `AfterSalesEvent` เป็น append-only (ข้อยกเว้นที่มี `///` แล้ว)
- **ห้ามเรียก `audit.log(...)` ภายใน `$transaction`** — เก็บ payload ไว้แล้วเรียกหลัง commit (`.claude/rules/database.md`) · engine เดิม (`DefectExchangeService.execute`, `ContractExchangeService.approve/submit`) เขียน audit ของตัวเองอยู่แล้ว — after-sales เขียนเฉพาะ audit ของเคส
- **ห้ามแก้เครื่องยนต์บัญชี**: ไม่แตะ `defectExchangeReversalTemplate`, `finalizeAfterActivation`, JE ใด ๆ, `approveMemo/approvePriced` (ข้อยกเว้นที่อนุญาต 2 จุด: (ก) `ExecuteDefectExchangeDto` เพิ่ม `originAfterSalesCaseId` เป็นต้นทาง bypass อีกแบบ — Task 5 (ข) `ContractExchangeModule` export `ExchangeCancelService` เพิ่ม — Task 8)
- Migration: `YYYYMMDDHHMMSS_snake_name` SQL มือแบบ additive · `prisma migrate deploy` เท่านั้น · **ห้ามรับ diff ที่ drop index `product_prices_one_default`**
- ทุก route ใหม่ใน `after-sales.controller.ts`: class มี `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` อยู่แล้ว ทุก method ต้องมี `@Roles(...)` · สาขา: route `:id` ต้องผ่าน `query.getCase(id, user)` ก่อนเสมอ (ตรวจสาขาใน service — `.claude/rules/security.md`)
- สิทธิ์ (spec ข้อ 7): ยืนยันเปลี่ยนรุ่นเดิม / ข้ามกรอบ 7 วัน / อนุมัติ REVIEW / ยกเลิก swap / ยกเลิกเคส = OWNER + BRANCH_MANAGER · อนุมัติ ESCALATE + ปฏิเสธคำขอมีราคา = OWNER (service ของ engine บังคับซ้ำอยู่แล้ว) · ส่งมอบ/เปลี่ยนเป็นซ่อม/ยื่นคำขอ = OWNER + BM + SALES
- ห้ามรัน `npm run lint` ใน apps/api (มี `--fix`) · integration spec ใหม่ต้องล้างข้อมูลตัวเองใน `afterAll` (ลูกก่อนแม่) และไฟล์ต้องอยู่ใต้ `src/modules/after-sales/__tests__/` เพื่อให้ glob `AFTERSALES_FILES` ใน `.github/workflows/deploy-gcp.yml` เห็น (glob ไม่ recurse — ห้ามสร้าง subdirectory ใหม่)
- เว็บ: ห้าม hex/`text-gray-*`/`bg-white`; ตัวอักษรบน `bg-primary` ใช้ `text-primary-foreground`; เหลืองตัวอักษร = `text-warning-strong`; ไทยใช้ `leading-snug`; สถานะต้องมีไอคอน/ข้อความ; ตัวอักษร ≥ 12px; **ปุ่มหลักสีเขียวหน้าละปุ่มเดียว**; ปุ่มมือถือซ้ำใน `sticky bottom-0 md:hidden` (แบบ PR 1)
- คำที่ใช้ (spec 4.0): "แจ้งปัญหาเครื่อง" · "เช็คประกัน" · "รับเรื่องแล้ว" · "ใบรับฝากเครื่อง" · **ห้ามใช้คำ "รับเครื่อง"** ในหน้าจอ (ยกเว้น "ลูกค้ารับเครื่องไปเมื่อ") · คำใหม่ของ PR นี้: "ยืนยันเปลี่ยนเครื่อง" · "ส่งมอบเครื่องใหม่" · "เปลี่ยนเป็น 'ซ่อม' แทน" · "รอ ผจก.สาขา ยืนยัน" · ป้ายผู้อนุมัติ "ผจก.สาขา (REVIEW)" / "เจ้าของเท่านั้น (ESCALATE)"
- ทุก deploy bump `version` ใน `apps/web/package.json` (YY.M.ลำดับ — ดูค่าปัจจุบันก่อน; ณ วันเขียน 26.9.49) · route ใหม่/ที่ถอดต้องผ่าน `apps/web/src/config/__tests__/route-reachability.test.ts` (เมนู ↔ ProtectedRoute ต้องตรงกันทุก role)
- ทางออก `CASH_SAME_MODEL_EXCHANGE` ยังปิด (รอผู้สอบ สเปกข้อ 10 → PR 5) — PR นี้ห้ามเปิด
- LINE ทั้ง 3 จังหวะ + `warranty.cron.ts` (บั๊กข้อ 12.7) = PR 3 — PR นี้ยัง log event `LINE_SKIPPED_NO_LINK`/ไม่ส่งจริง

## Review Focus

1. **ยืนยันเปลี่ยนรุ่นเดิมโดย SALES** → ต้อง 403 ทั้ง API และปุ่ม (พนักงานเห็นข้อความ "รอ ผจก.สาขา ยืนยัน" แทนปุ่ม) — เทสต์ Task 5 (e) + Task 8 เคส 3 + Task 11 (d)
2. **เครื่องทดแทนถูกขายไปก่อนที่ ผจก. จะยืนยัน** (สถานะไม่ใช่ `IN_STOCK` แล้ว) → ยืนยันต้อง 400 พร้อมบอกให้เลือกเครื่องใหม่ ไม่ใช่ 500 และเคสยังอยู่ AWAITING_APPROVAL — เทสต์ Task 5 (c)
3. **ยื่นคำขอมีราคาแล้ว engine ปฏิเสธ** (เช่น สัญญาค้างชำระ) → ต้องไม่เหลือเคสลอยไม่มีคำขอ: เคสถูกยกเลิกพร้อมเหตุผลของ engine และ IMEI เปิดเคสใหม่ได้ — เทสต์ Task 4 (d) + Task 8 เคส 6
4. **สัญญาใหม่จากเปลี่ยนรุ่นเดิมยังเป็น DRAFT (ยังไม่เซ็น/เปิดใช้)** แล้วพนักงานกด "ส่งมอบเครื่องใหม่" → ต้อง 400 ชี้ไปหน้าสัญญาใหม่ (ไม่ปิดเคสก่อนสัญญาเปิดใช้) — เทสต์ Task 5 (f)
5. **คำขอมีราคาถูกยกเลิก/ปฏิเสธจาก endpoint เก่า `/insurance/exchange-requests/:id/*`** (ยังเปิดอยู่ตามสเปก) → เคสต้องกลายเป็น CANCELLED เองเมื่อถูกอ่าน (reconcile จาก request.status) ไม่ค้าง AWAITING_APPROVAL — เทสต์ Task 2 (stage) + Task 8 เคส 7

## File Structure

API (`apps/api`):
- `prisma/schema.prisma` — relation `AfterSalesCase.exchangeRequest` ↔ `ContractExchangeRequest.afterSalesCase` · enum `AfterSalesEventKind` + `APPROVED`, `REJECTED` (Task 1)
- `prisma/migrations/20261009000000_after_sales_exchange_link/migration.sql` — enum values · FK · backfill เคสให้ `contract_exchange_requests` เดิม (Task 1)
- `src/modules/after-sales/utils/after-sales-stage.util.ts` — `deriveStage` รุ่นสอง (Task 2) · `services/after-sales-stage-reconcile.ts` — include `exchangeRequest` (Task 2)
- `src/modules/repair-tickets/services/repair-ticket-lifecycle.service.ts` — `markRepaired` จาก OPEN เมื่อไม่มีศูนย์ (Task 3)
- `src/modules/after-sales/utils/after-sales-outcomes.util.ts` · `services/after-sales-lookup.service.ts` · `dto/create-case.dto.ts` · `services/after-sales-case.service.ts` — เปิด 2 ทางออก + สร้างเคสแบบเปลี่ยนเครื่อง (Task 4)
- `src/modules/defect-exchange/dto/defect-exchange.dto.ts` + `defect-exchange.service.ts` — ต้นทาง bypass แบบเคส (Task 5)
- `src/modules/after-sales/services/after-sales-exchange.service.ts` — confirm / deliver / reject / switch-to-repair / approve / reject-swap / cancel-swap / preview / replacement-products (Task 5–6)
- `src/modules/after-sales/dto/exchange-*.dto.ts` (Task 5–6)
- `src/modules/after-sales/services/after-sales-query.service.ts` — `exchange` sub-object · summary · R25 (Task 7)
- `src/modules/after-sales/after-sales.controller.ts` · `after-sales.service.ts` · `after-sales.module.ts` · `contract-exchange.module.ts` (export) (Task 8)
- `src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts` (Task 8)

Web (`apps/web/src`):
- `pages/after-sales/after-sales.ts` — types/labels ใหม่ · `Pager.tsx` clamp · (Task 9)
- `pages/after-sales/ReplacementProductPicker.tsx` · `PricedExchangeFields.tsx` · `AfterSalesNewPage.tsx` (Task 10)
- `pages/after-sales/ExchangeActionDialogs.tsx` · `ExchangeCard.tsx` · `AfterSalesCasePage.tsx` (Task 11)
- `pages/after-sales/ApprovalTable.tsx` · `AfterSalesPage.tsx` (Task 12)
- `App.tsx` · `config/menu.ts` · ลบ `pages/InsurancePage.tsx`, `pages/DefectExchangePage.tsx`, `pages/insurance/{CreateInsuranceWizardPage,ExchangeRequestForm,ExchangeRequestsPage,WarrantyCheckTab(+test)}.tsx`, `pages/insurance/WizardSteps/*` (ทั้งโฟลเดอร์ + `__tests__/ImeiLookupStep.test.tsx`), `pages/insurance/components/WarrantyWindowCard(+test).tsx` · `e2e/*` (Task 13)

---

### Task 1: Schema + migration — ผูกเคสกับคำขอเปลี่ยนเครื่อง + backfill คำขอเดิม

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `AfterSalesCase`, model `ContractExchangeRequest`, enum `AfterSalesEventKind`)
- Create: `apps/api/prisma/migrations/20261009000000_after_sales_exchange_link/migration.sql`
- Test: `apps/api/src/modules/after-sales/__tests__/exchange-link-migration.spec.ts` (jest — ตรวจไฟล์ migration เป็นข้อความ + prisma validate)

**Interfaces:**
- Consumes: enum/model ของ PR 1 (`AfterSalesCase.exchangeRequestId String? @unique` มีอยู่แล้ว ยังไม่มี relation)
- Produces: `AfterSalesCase.exchangeRequest?: ContractExchangeRequest` (relation `AfterSalesCaseExchangeRequest`) · `ContractExchangeRequest.afterSalesCase?: AfterSalesCase` · `AfterSalesEventKind.APPROVED | REJECTED`

- [ ] **Step 1: เทสต์ (jest, อ่านไฟล์)** — `exchange-link-migration.spec.ts`: (a) migration.sql มีบรรทัด `ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'APPROVED'` และ `'REJECTED'` (b) มี `ADD CONSTRAINT "after_sales_cases_exchange_request_id_fkey"` (c) `npx prisma validate` ผ่าน (spawnSync) (d) schema มี `exchangeRequest` relation ทั้งสองฝั่ง (regex บนไฟล์ schema)

- [ ] **Step 2: รันให้แดง** — `cd apps/api && npx jest src/modules/after-sales/__tests__/exchange-link-migration.spec.ts`

- [ ] **Step 3: schema** — ใน `model AfterSalesCase` แทนบรรทัด `exchangeRequestId String? @unique @map("exchange_request_id")` ด้วย

```prisma
  exchangeRequestId String?                 @unique @map("exchange_request_id")
  exchangeRequest   ContractExchangeRequest? @relation("AfterSalesCaseExchangeRequest", fields: [exchangeRequestId], references: [id])
```
ใน `model ContractExchangeRequest` เพิ่มบรรทัด (ใต้ `newContract`):
```prisma
  afterSalesCase AfterSalesCase? @relation("AfterSalesCaseExchangeRequest")
```
ใน `enum AfterSalesEventKind` เพิ่ม `APPROVED` และ `REJECTED` ต่อท้าย `NOTE`

- [ ] **Step 4: migration.sql** (additive · idempotent · backfill เฉพาะคำขอที่ยังไม่มีเคส)

```sql
-- 20261009000000_after_sales_exchange_link
ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "AfterSalesEventKind" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "after_sales_cases"
  ADD CONSTRAINT "after_sales_cases_exchange_request_id_fkey"
  FOREIGN KEY ("exchange_request_id") REFERENCES "contract_exchange_requests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: คำขอเปลี่ยนเครื่องเดิมทุกใบ (prod = ข้อมูลทดสอบ 1 แถว) ได้เคส 1 ใบ เลข AS-<วันยื่น BKK>-<ลำดับต่อจากเลขที่มีอยู่ของวันนั้น>
WITH req AS (
  SELECT r.id, r.old_contract_id, r.old_product_id, r.new_contract_id, r.status, r.mode, r.memo_applied_at,
         r.requested_by_id, r.created_at, r.condition_note, r.rejection_reason, r.cancel_reason, r.canceled_at, r.approved_at,
         c.branch_id, c.customer_id, p.brand, p.model, p.imei_serial, p.serial_number,
         nc.status AS new_contract_status,
         to_char((r.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') AS bkk_day
  FROM "contract_exchange_requests" r
  JOIN "contracts" c ON c.id = r.old_contract_id
  JOIN "products" p ON p.id = r.old_product_id
  LEFT JOIN "contracts" nc ON nc.id = r.new_contract_id
  WHERE r.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM "after_sales_cases" a WHERE a.exchange_request_id = r.id)
), numbered AS (
  SELECT req.*,
         ROW_NUMBER() OVER (PARTITION BY bkk_day ORDER BY created_at, id) +
         COALESCE((SELECT MAX(SUBSTRING(a.case_number FROM 13 FOR 4)::int) FROM "after_sales_cases" a WHERE a.case_number LIKE 'AS-' || req.bkk_day || '-%'), 0) AS seq
  FROM req
)
INSERT INTO "after_sales_cases" ("id","case_number","branch_id","customer_id","source","contract_id","product_id","device_brand","device_model","device_imei","device_serial","symptom","warranty_snapshot","outcome","exchange_request_id","replacement_contract_id","stage","received_by_id","received_at","approved_at","closed_at","cancelled_at","cancel_reason","created_at","updated_at")
SELECT gen_random_uuid(), 'AS-' || bkk_day || '-' || LPAD(seq::text, 4, '0'), branch_id, customer_id, 'INSTALLMENT_CONTRACT', old_contract_id, old_product_id,
       brand, model, imei_serial, serial_number,
       COALESCE(condition_note, 'คำขอเปลี่ยนเครื่อง (backfill จากคิวเดิม)'),
       jsonb_build_object('status', 'UNKNOWN', 'daysRemainingIn7Day', 0, 'checkedAt', created_at, 'backfilled', true),
       CASE WHEN mode = 'MEMO' THEN 'PRICED_EXCHANGE' ELSE 'PRICED_EXCHANGE' END,
       id, new_contract_id,
       CASE
         WHEN status = 'PENDING' THEN 'AWAITING_APPROVAL'
         WHEN status = 'APPROVED' AND (memo_applied_at IS NOT NULL OR new_contract_status = 'ACTIVE') THEN 'CLOSED'
         WHEN status = 'APPROVED' THEN 'READY_FOR_PICKUP'
         ELSE 'CANCELLED'
       END::"AfterSalesStage",
       requested_by_id, created_at, approved_at,
       CASE WHEN status = 'APPROVED' AND (memo_applied_at IS NOT NULL OR new_contract_status = 'ACTIVE') THEN COALESCE(memo_applied_at, approved_at) END,
       CASE WHEN status IN ('REJECTED','CANCELED') THEN COALESCE(canceled_at, approved_at, created_at) END,
       CASE WHEN status = 'REJECTED' THEN rejection_reason WHEN status = 'CANCELED' THEN cancel_reason END,
       created_at, now()
FROM numbered;
```
(หมายเหตุ: `mode` MEMO/PRICED ทั้งคู่เป็น outcome `PRICED_EXCHANGE` ตามสเปกข้อ 5 — MEMO คือ "เปลี่ยนแบบมีราคา" ที่ราคาเท่าเดิม · `gen_random_uuid()` ใช้ได้บน prod ตาม PR 1 (R5))

- [ ] **Step 5: apply บนฐานทดสอบทิ้ง + generate** — `DATABASE_URL=postgresql://iamnaii@localhost:5432/after_sales_pr1_test?schema=public npx prisma migrate deploy && npx prisma generate` (ห้ามชี้ฐาน `bestchoice` ของเจ้าของ) · `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` ต้องว่าง (ยกเว้น index `product_prices_one_default` ที่รู้กันแล้ว) · seed 1 คำขอ PENDING ทดสอบแล้วรัน migrate ซ้ำ = ไม่สร้างเคสซ้ำ (NOT EXISTS)

- [ ] **Step 6: รันให้เขียว + Commit** — `git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261009000000_after_sales_exchange_link apps/api/src/modules/after-sales/__tests__/exchange-link-migration.spec.ts && git commit -m "feat(after-sales): ผูกเคสกับคำขอเปลี่ยนเครื่อง + backfill คำขอเดิม + event APPROVED/REJECTED"`

---

### Task 2: `deriveStage` รุ่นสอง — stage จากสถานะ engine ทั้ง 3 ทางออก + reconcile อ่านคำขอ

**Files:**
- Modify: `apps/api/src/modules/after-sales/utils/after-sales-stage.util.ts`
- Modify: `apps/api/src/modules/after-sales/services/after-sales-stage-reconcile.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/stage.spec.ts` (ต่อจากของเดิม) · `stage-reconcile.spec.ts`

**Interfaces:**
- Consumes: `StageInput` เดิม `{ outcome, cancelledAt, repairStatus, repairDeleted?, replacementContractId? }`
- Produces:

```ts
export interface StageInput {
  outcome: AfterSalesOutcome | null;
  cancelledAt: Date | null;
  closedAt: Date | null;                       // ใหม่ — ทางออกเปลี่ยนเครื่องปิดด้วยการส่งมอบ (เคสเป็นความจริง)
  repairStatus: RepairStatus | null;
  repairDeleted?: boolean;
  replacementContractId?: string | null;
  exchange?: {                                  // ใหม่ — จาก ContractExchangeRequest ที่ผูกอยู่ (PRICED_EXCHANGE)
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
    mode: 'MEMO' | 'PRICED';
    memoAppliedAt: Date | null;
    newContractStatus: string | null;         // สถานะสัญญาใหม่ (null = ยังไม่มี)
  } | null;
}
export function deriveStage(i: StageInput): AfterSalesStage
export function stageSince(stage, t, receivedAt, approvedAt?: Date | null): Date  // AWAITING_APPROVAL → receivedAt · READY_FOR_PICKUP ของทางออกเปลี่ยน → approvedAt ?? receivedAt
```
- `ReconcilableCase` เพิ่ม `closedAt: Date | null` และ `exchangeRequest: { status; mode; memoAppliedAt; newContract: { status } | null } | null`

- [ ] **Step 1: เทสต์** ใน `stage.spec.ts` (ตารางสเปกข้อ 5 ทุกแถว):
  - REPAIR: เหมือนเดิม (OPEN→RECEIVED … CANCELLED) และ **REPAIR + `repairStatus='REPLACED'` + `replacementContractId` → `closedAt ? 'CLOSED' : 'READY_FOR_PICKUP'`** (ซ่อมไม่ได้→เปลี่ยนรุ่นเดิมแล้วรอส่งมอบ)
  - SAME_MODEL_EXCHANGE: `cancelledAt` → CANCELLED · `closedAt` → CLOSED · `replacementContractId` → READY_FOR_PICKUP · ไม่มี → AWAITING_APPROVAL
  - PRICED_EXCHANGE: `exchange=null` → AWAITING_APPROVAL (ยื่นไม่สำเร็จ/รอผูก) · PENDING → AWAITING_APPROVAL · APPROVED+MEMO+memoAppliedAt → CLOSED · APPROVED+PRICED+newContractStatus 'DRAFT' → READY_FOR_PICKUP · APPROVED+PRICED+'ACTIVE' → CLOSED · REJECTED/CANCELED → CANCELLED · `cancelledAt` ของเคสชนะทุกอย่าง
  - CASH_SAME_MODEL_EXCHANGE → AWAITING_APPROVAL (ยังไม่เปิด — คงค่าเดิม)
  - `stageSince('AWAITING_APPROVAL', null, receivedAt)` = receivedAt · `stageSince('READY_FOR_PICKUP', null, receivedAt, approvedAt)` = approvedAt
  ใน `stage-reconcile.spec.ts`: (a) เคส PRICED stored AWAITING_APPROVAL แต่ request REJECTED → CAS เขียน CANCELLED + `cancelledAt` (b) เคส PRICED stored READY แต่ newContract ACTIVE → CLOSED + `closedAt` (c) เคส SAME_MODEL stored READY, `closedAt` มีแล้ว → CLOSED (d) REPAIR ที่ ticket CLOSED ใช้ `returnedToCustomerAt` เป็น `closedAt` (R25 d) ไม่ใช่ `new Date()`

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/stage.spec.ts src/modules/after-sales/__tests__/stage-reconcile.spec.ts`

- [ ] **Step 3: `deriveStage`**

```ts
const OPEN_EXCHANGE_STAGE = (i: StageInput): AfterSalesStage => {
  if (i.closedAt) return 'CLOSED';
  if (i.replacementContractId) return 'READY_FOR_PICKUP';
  return 'AWAITING_APPROVAL';
};
export function deriveStage(i: StageInput): AfterSalesStage {
  if (i.cancelledAt) return 'CANCELLED';
  if (i.outcome === 'REPAIR') {
    if (i.repairDeleted || !i.repairStatus) return 'CANCELLED';
    if (i.repairStatus === 'REPLACED') return OPEN_EXCHANGE_STAGE(i); // ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม (engine ตั้ง REPLACED + สัญญาใหม่)
    return REPAIR_STAGE[i.repairStatus];
  }
  if (i.outcome === 'SAME_MODEL_EXCHANGE' || i.outcome === 'CASH_SAME_MODEL_EXCHANGE') return OPEN_EXCHANGE_STAGE(i);
  if (i.outcome === 'PRICED_EXCHANGE') {
    const x = i.exchange;
    if (!x || x.status === 'PENDING') return 'AWAITING_APPROVAL';
    if (x.status === 'REJECTED' || x.status === 'CANCELED') return 'CANCELLED';
    // APPROVED
    if (x.mode === 'MEMO') return x.memoAppliedAt ? 'CLOSED' : 'READY_FOR_PICKUP';
    return x.newContractStatus && x.newContractStatus !== 'DRAFT' ? 'CLOSED' : 'READY_FOR_PICKUP';
  }
  return 'RECEIVED';
}
```
`stageSince(stage, t, receivedAt, approvedAt = null)`: เพิ่มกิ่ง `if (stage === 'READY_FOR_PICKUP' && !t?.repairedAt && approvedAt) return approvedAt;` ก่อน fallback

- [ ] **Step 4: `reconcileStage`** — `ReconcilableCase` เพิ่ม `closedAt`, `exchangeRequest` (select `{ status, mode, memoAppliedAt, newContract: { select: { status } } }`), และ `repairTicket` select เพิ่ม `returnedToCustomerAt`. เรียก `deriveStage({ ..., closedAt: row.closedAt, exchange: row.exchangeRequest ? { status, mode, memoAppliedAt, newContractStatus: row.exchangeRequest.newContract?.status ?? null } : null })`. ตอน derived = CLOSED ตั้ง `closedAt = row.repairTicket?.returnedToCustomerAt ?? row.exchangeRequest?.memoAppliedAt ?? new Date()` (R25 d); derived = CANCELLED และ `!row.cancelledAt` → `cancelledAt = new Date()` + ถ้ามาจาก request ให้ `cancelReason = row.exchangeRequest?.rejectionReason ?? row.exchangeRequest?.cancelReason ?? 'คำขอเปลี่ยนเครื่องถูกยกเลิก'` (select เพิ่ม 2 ฟิลด์) · แก้คอมเมนต์ residual ใน `list()` ของ query service ให้ครบทั้ง "open→open drift" (R25 (d) ของ re-review)

- [ ] **Step 5: ทุกผู้เรียก `reconcileStage`/`deriveStage` ส่ง field ใหม่** — `after-sales-query.service.ts` (list/summary/getCase select), `after-sales-lookup.service.ts` (openCase select), `after-sales-case.service.ts` (candidates select), `after-sales-repair.service.ts` (`sync()` ส่ง `closedAt: null` และ `exchange: null` — proxy ซ่อมยังเดิม) — `npx tsc --noEmit -p tsconfig.json` ต้องผ่าน

- [ ] **Step 6: รันให้เขียว + Commit** — `npx jest src/modules/after-sales` PASS → `git commit -m "feat(after-sales): deriveStage รุ่นสอง — stage ของทางออกเปลี่ยนเครื่องจากสถานะ engine + reconcile อ่านคำขอ"`

---

### Task 3: ทางซ่อมที่ร้าน — `markRepaired` จาก OPEN เมื่อไม่มีศูนย์ (R21)

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/services/repair-ticket-lifecycle.service.ts` (`markRepaired`, `returnToCustomer`)
- Modify: `apps/api/src/modules/after-sales/services/after-sales-repair.service.ts` (`markRepaired` note) · `after-sales-case.service.ts` (event note "ซ่อมที่ร้าน")
- Test: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts` (เพิ่ม describe) · `apps/api/src/modules/after-sales/__tests__/repair-proxy.spec.ts`

**Interfaces:**
- Consumes: `markRepaired(id, MarkRepairedDto{actualCost!, payer!, repairedAt?}, user)` CAS `status:'IN_PROGRESS'` เดิม · `returnToCustomer` สร้าง ExpenseDocument เฉพาะ `payer==='SHOP' && actualCost>0 && repairSupplierId`
- Produces: `markRepaired` รับ ticket `OPEN` ได้เมื่อ `repairSupplierId === null` (ซ่อมที่ร้าน) → `READY_FOR_PICKUP`, `repairedAt`, `sentToRepairAt` คง null, `RepairStatusLog` note `'ซ่อมที่ร้าน — ซ่อมเสร็จ'` · `returnToCustomer` เมื่อไม่มีศูนย์และ payer SHOP: ไม่สร้างเอกสารรายจ่าย แต่ต่อท้าย `notes` ว่า `'ซ่อมที่ร้าน — ไม่มีเอกสารรายจ่ายอัตโนมัติ (ต้นทุนอะไหล่บันทึกทางอื่น)'`

- [ ] **Step 1: เทสต์** (`repair-tickets.service.spec.ts` describe `'markRepaired — ซ่อมที่ร้าน (R21)'`): (a) ticket OPEN + `repairSupplierId=null` → update สำเร็จ status READY_FOR_PICKUP, log note มีคำ 'ซ่อมที่ร้าน' (b) ticket OPEN + มี `repairSupplierId` → `ConflictException` ข้อความ `'ต้องบันทึกส่งซ่อมก่อน (เครื่องมีศูนย์ซ่อม)'` (c) IN_PROGRESS ยังทำงานเหมือนเดิม (d) `returnToCustomer` payer SHOP cost 800 ไม่มีศูนย์ → ไม่เรียก `expenseDocs.createDraftForRepair` และ `notes` ต่อท้ายข้อความข้างต้น (e) payer CUSTOMER ไม่มีศูนย์ → ยังสร้าง OtherIncome เหมือนเดิม. ใน `repair-proxy.spec.ts`: `markRepaired` บนเคส stage RECEIVED (ticket OPEN ไม่มีศูนย์) → sync เป็น READY_FOR_PICKUP + event `REPAIR_DONE` note `'ซ่อมที่ร้านเสร็จ · ค่าซ่อมจริง …'`

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/repair-tickets src/modules/after-sales/__tests__/repair-proxy.spec.ts`

- [ ] **Step 3: lifecycle** — ใน `markRepaired` ก่อน CAS: `const cur = await this.prisma.repairTicket.findFirst({ where: { id, deletedAt: null }, select: { status: true, repairSupplierId: true } }); if (!cur) throw new NotFoundException('ไม่พบใบซ่อม'); const inShop = cur.status === 'OPEN' && !cur.repairSupplierId; if (cur.status === 'OPEN' && cur.repairSupplierId) throw new ConflictException('ต้องบันทึกส่งซ่อมก่อน (เครื่องมีศูนย์ซ่อม)');` แล้วเปลี่ยน CAS เป็น `where: { id, status: inShop ? 'OPEN' : 'IN_PROGRESS' }` · status log `note: inShop ? 'ซ่อมที่ร้าน — ซ่อมเสร็จ' : <เดิม>` · `fromStatus` ตามจริง. ใน `returnToCustomer`: กิ่ง SHOP คงเงื่อนไข `repairSupplierId` เดิม แต่เพิ่ม `else if (ticket.payer === 'SHOP' && actualCost.gt(0) && !ticket.repairSupplierId) { data.notes = [ticket.notes, 'ซ่อมที่ร้าน — ไม่มีเอกสารรายจ่ายอัตโนมัติ (ต้นทุนอะไหล่บันทึกทางอื่น)'].filter(Boolean).join('\n'); }`

- [ ] **Step 4: after-sales** — `after-sales-repair.service.ts markRepaired`: อ่าน `c.repairTicket.repairSupplier` — note = `${c.repairTicket.repairSupplier ? 'ซ่อมเสร็จ' : 'ซ่อมที่ร้านเสร็จ'} · ค่าซ่อมจริง ${dto.actualCost} · ผู้จ่าย ${dto.payer}` · `after-sales-case.service.ts` event OUTCOME_SET note: `' · ส่งศูนย์'` / `' · ซ่อมที่ร้าน'` (แทน 'ยังไม่เลือกศูนย์ซ่อม' — ตอนนี้ไม่เลือก = ซ่อมที่ร้านจริงตามสเปก 4.3)

- [ ] **Step 5: รันให้เขียว + Commit** — `git commit -m "feat(repair-tickets): ซ่อมที่ร้าน — markRepaired จาก OPEN เมื่อไม่มีศูนย์ (R21)"`

---

### Task 4: เปิดทางออกเปลี่ยนเครื่องตอนแจ้งปัญหา — `computeOutcomes` implemented · DTO · `createCase` 2 กิ่งใหม่

**Files:**
- Modify: `apps/api/src/modules/after-sales/utils/after-sales-outcomes.util.ts` (`implemented: true` สำหรับ SAME_MODEL_EXCHANGE / PRICED_EXCHANGE)
- Modify: `apps/api/src/modules/after-sales/dto/create-case.dto.ts`
- Modify: `apps/api/src/modules/after-sales/services/after-sales-case.service.ts`
- Modify: `apps/api/src/modules/after-sales/after-sales.module.ts` (import `ContractExchangeModule`)
- Test: `apps/api/src/modules/after-sales/__tests__/outcomes.spec.ts` · `case-create.spec.ts` (เพิ่ม describe)

**Interfaces:**
- Consumes: `ContractExchangeService.submit(dto: SubmitExchangeRequestDto, user)` → คืน request (`{ id, mode, approvalTier, ... }`) · `ExchangeCancelService` (ไม่ใช้ใน task นี้) · `DefectExchangeService.checkEligibility(oldContractId, newProductId?)` → `{ eligible, reasons, newProduct }`
- Produces: `CreateCaseDto.outcome: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE'` · ฟิลด์ใหม่ (optional ทั้งหมด, บังคับตามทางออกใน service): `replacementProductId?: string (@IsUUID)` (SAME_MODEL) · `buybackPrice?: string (@IsNumberString)`, `deviceCondition?: 'A'|'B'|'C'|'D'`, `newTotalMonths?: number (@Type Number @IsInt @Min(1) @Max(48))`, `newInterestRate?: string (@IsNumberString)`, `conditionNote?: string` (PRICED) · `CreateCaseResult` เพิ่ม `outcome`, `exchangeRequestId: string | null`, `stage`

- [ ] **Step 1: เทสต์** — `outcomes.spec.ts`: แทนเทสต์ `'ทุกทางออกที่ไม่ใช่ REPAIR ยัง implemented=false ใน PR 1'` ด้วย `'SAME_MODEL_EXCHANGE และ PRICED_EXCHANGE implemented=true · CASH_SAME_MODEL_EXCHANGE ยัง false'` (กติกา enabled/reason ทุกข้อคงเดิม). `case-create.spec.ts` describe `'ทางออกเปลี่ยนเครื่อง (PR 2)'`:
  (a) SAME_MODEL_EXCHANGE + `replacementProductId` ของเครื่อง IN_STOCK รุ่น/ความจุตรง → tx สร้างเคส `outcome:'SAME_MODEL_EXCHANGE'`, `stage:'AWAITING_APPROVAL'`, `replacementProductId`, **ไม่เรียก** `repair.createInTx`, events RECEIVED + OUTCOME_SET note `'เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน <brand model storage> IMEI <imei>'`
  (b) SAME_MODEL_EXCHANGE ไม่ส่ง `replacementProductId` → 400 `'ต้องเลือกเครื่องทดแทนจากสต๊อก'` ก่อนอัปโหลดรูป (`storage.upload` ไม่ถูกเรียก)
  (c) SAME_MODEL_EXCHANGE เครื่องทดแทนไม่ IN_STOCK หรือรุ่นไม่ตรง (`defect.checkEligibility(contractId, productId)` คืน `eligible:false` เพราะ newProduct) และผู้ยื่นเป็น SALES → 400 พร้อม `reasons[0]`; BM/OWNER ที่ข้ามกรอบ 7 วัน (reason มีคำว่า 'หมดกรอบ'/`daysRemaining<=0`) → สร้างได้ (bypass ตัดสินตอนยืนยัน ไม่ใช่ตอนยื่น)
  (d) PRICED_EXCHANGE: tx สร้างเคส `stage:'AWAITING_APPROVAL'` แล้วเรียก `contractExchange.submit({ oldContractId, oldProductId, newProductId: dto.replacementProductId, conditionNote, buybackPrice, deviceCondition, newTotalMonths, newInterestRate }, user)` → update `exchangeRequestId` + event OUTCOME_SET note `'เปลี่ยนแบบมีราคา · <MEMO|PRICED> · tier <AUTO|REVIEW|ESCALATE>'`; **เมื่อ submit throw** → เคสถูก update `cancelledAt`, `cancelReason: 'ยื่นคำขอไม่สำเร็จ: <err.message>'`, stage CANCELLED, event CANCELLED และ rethrow (Review Focus 3) · รูปที่อัปโหลดไม่ถูกลบ (เคสยังอยู่เป็นประวัติ)
  (e) `outcome` นอก enum → 400 จาก DTO

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/outcomes.spec.ts src/modules/after-sales/__tests__/case-create.spec.ts`

- [ ] **Step 3: outcomes.util** — เปลี่ยน `implemented: false` → `true` ในกิ่ง SAME_MODEL_EXCHANGE (ข้อ 3, 4) และ PRICED_EXCHANGE (ข้อ 3) เท่านั้น; CASH คงเดิม

- [ ] **Step 4: DTO** — `@IsIn(['REPAIR','SAME_MODEL_EXCHANGE','PRICED_EXCHANGE'], { message: 'ทางออกไม่ถูกต้อง' }) outcome!: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE';` + ฟิลด์ใหม่ตาม Interfaces (ทุกตัว `@IsOptional()` นำหน้า; `newTotalMonths` ใช้ `@Type(() => Number)` เพราะมาจาก multipart)

- [ ] **Step 5: service** — ใน `createCase` หลังตรวจ `outcome?.enabled`:

```ts
const isSameModel = dto.outcome === 'SAME_MODEL_EXCHANGE';
const isPriced = dto.outcome === 'PRICED_EXCHANGE';
if ((isSameModel || isPriced) && !dto.replacementProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
if ((isSameModel || isPriced) && !look.contract) throw new BadRequestException('ทางออกนี้ใช้ได้กับสัญญาผ่อนเท่านั้น');
if (isSameModel) {
  // ตรวจเครื่องทดแทนกับ engine (รุ่น+ความจุตรง · IN_STOCK) — กรอบ 7 วันไม่ตัดสินตรงนี้ (ผจก. ตัดสินตอนยืนยัน)
  const elig = await this.defect.checkEligibility(look.contract.id, dto.replacementProductId);
  const productReasons = elig.reasons.filter((r) => /เครื่องใหม่|ทดแทน|ไม่ตรง|IN_STOCK|สต๊อก/.test(r));
  if (!elig.newProduct || productReasons.length) throw new BadRequestException(productReasons[0] ?? 'เครื่องทดแทนไม่ตรงรุ่น/ความจุ หรือไม่พร้อมขาย');
}
```
(อ่านข้อความ reasons จริงใน `defect-exchange.service.ts checkEligibility` ก่อนเขียน regex — ต้องจับเฉพาะเหตุผลเกี่ยวกับ **เครื่องใหม่** ไม่ใช่กรอบ 7 วัน/สถานะสัญญา; ถ้าข้อความไม่แยกกันชัด ให้ตรวจเองแทน: `tx.product.findFirst({ where: { id, deletedAt: null, status: 'IN_STOCK', brand: look.product.brand, model: look.product.model, storage: look.product.storage } })` ไม่พบ → 400)

ใน tx: กิ่ง REPAIR เหมือนเดิม · กิ่งเปลี่ยนเครื่อง: ไม่เรียก `createInTx`; `tx.afterSalesCase.create({ ... outcome: dto.outcome, repairTicketId: null, replacementProductId: dto.replacementProductId, stage: 'AWAITING_APPROVAL', events: [RECEIVED, OUTCOME_SET(note ตาม (a)/(d))] })`. **หลัง tx commit** (นอก try/catch ของรูป) สำหรับ PRICED:

```ts
if (isPriced) {
  try {
    const req = await this.contractExchange.submit({
      oldContractId: look.contract!.id, oldProductId: look.product!.id, newProductId: dto.replacementProductId!,
      conditionNote: dto.conditionNote ?? dto.symptom, buybackPrice: dto.buybackPrice, deviceCondition: dto.deviceCondition,
      newTotalMonths: dto.newTotalMonths, newInterestRate: dto.newInterestRate,
    }, user);
    await this.prisma.afterSalesCase.update({ where: { id: result.id }, data: { exchangeRequestId: req.id, events: { create: { kind: 'OUTCOME_SET', actorId: user.id, note: `เปลี่ยนแบบมีราคา · ${req.mode} · tier ${req.approvalTier ?? '-'}` } } } });
    result = { ...result, exchangeRequestId: req.id };
  } catch (err) {
    const reason = `ยื่นคำขอไม่สำเร็จ: ${err instanceof HttpException ? (err.getResponse() as any)?.message ?? err.message : 'ระบบขัดข้อง'}`;
    await this.prisma.afterSalesCase.update({ where: { id: result.id }, data: { stage: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, events: { create: { kind: 'CANCELLED', actorId: user.id, note: reason } } } });
    throw err;
  }
}
```
(ทำไม compensation ไม่ใช่ tx เดียว: `submit()` เปิด `$transaction` ของตัวเองและมี preview/ราคากลางภายใน — ไม่แตะ engine ตามข้อจำกัด · เคสที่ถูกยกเลิกยังอยู่เป็นประวัติ IMEI เปิดใหม่ได้เพราะ stage CANCELLED)

`after-sales.module.ts` imports เพิ่ม `ContractExchangeModule`; constructor เพิ่ม `private readonly contractExchange: ContractExchangeService, private readonly defect: DefectExchangeService`. audit หลัง commit `newValue.outcome = dto.outcome`

- [ ] **Step 6: รันให้เขียว + Commit** — `npx jest src/modules/after-sales` PASS · tsc → `git commit -m "feat(after-sales): แจ้งปัญหาเครื่องเลือกทางออกเปลี่ยนรุ่นเดิม/เปลี่ยนแบบมีราคาได้ (สร้างเคส + ยื่นคำขอ + compensation)"`

---

### Task 5: `AfterSalesExchangeService` — ยืนยันเปลี่ยนรุ่นเดิม · ส่งมอบ · ปฏิเสธ · เปลี่ยนเป็นซ่อม (+ ต้นทาง bypass แบบเคส)

**Files:**
- Modify: `apps/api/src/modules/defect-exchange/dto/defect-exchange.dto.ts` (`originAfterSalesCaseId?`)
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (bypass guard รับต้นทางแบบเคส — **ไม่แตะบัญชี**)
- Create: `apps/api/src/modules/after-sales/services/after-sales-exchange.service.ts`
- Create: `apps/api/src/modules/after-sales/dto/exchange-confirm.dto.ts` · `exchange-reject.dto.ts` · `switch-to-repair.dto.ts`
- Test: `apps/api/src/modules/defect-exchange/defect-exchange.service.spec.ts` (เพิ่ม 2 เทสต์) · `apps/api/src/modules/after-sales/__tests__/exchange-service.spec.ts`

**Interfaces:**
- Consumes: `DefectExchangeService.execute(dto, user)` → `{ ..., newContract: { id, contractNumber } }` (ดูบรรทัด ~390-400 ของ service: อ่านรูป return จริงก่อนใช้) · `RepairTicketLifecycleService.createInTx(dto, user, tx)` · `AfterSalesQueryService.getCase`
- Produces (ทุกเมธอดตรวจสาขาผ่าน `query.getCase` ก่อน):
  - `confirmSameModel(caseId, dto: ExchangeConfirmDto{ note?: string }, user)` — MGR เท่านั้น (controller) · เคสต้อง `outcome ∈ {SAME_MODEL_EXCHANGE, REPAIR}` และ stage ∈ {AWAITING_APPROVAL, RECEIVED, IN_REPAIR, READY_FOR_PICKUP} (REPAIR = "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" ต้องส่ง `dto.replacementProductId` ด้วย) · เรียก `defect.execute({ oldContractId: case.contractId, newProductId, defectReason: case.symptom, notes: dto.note, bypassWindowCheck: !elig.eligible, originRepairTicketId: case.repairTicketId ?? undefined, originAfterSalesCaseId: case.id }, user)` → update เคส `{ outcome: 'SAME_MODEL_EXCHANGE', replacementProductId, replacementContractId: newContract.id, approvedById: user.id, approvedAt: now, stage: 'READY_FOR_PICKUP', events: [APPROVED note 'ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ <no>' (+ ' · ข้ามกรอบ 7 วัน' เมื่อ bypass)] }` · audit หลัง commit `AFTER_SALES_EXCHANGE_CONFIRMED`
  - `deliver(caseId, user)` — STAFF · เคส READY_FOR_PICKUP ของทางออกเปลี่ยนรุ่นเดิม · สัญญาใหม่ `status !== 'DRAFT'` ไม่งั้น 400 `'ต้องเปิดใช้สัญญาใหม่ <no> ที่หน้าสัญญาก่อนส่งมอบ'` → `closedAt`, stage CLOSED, events DELIVERED + CLOSED
  - `rejectSameModel(caseId, dto: ExchangeRejectDto{ reason: @MinLength(10) }, user)` — MGR · เคส AWAITING_APPROVAL SAME_MODEL → `cancelledAt`, `cancelReason`, stage CANCELLED, event REJECTED
  - `switchToRepair(caseId, dto: SwitchToRepairDto{ payer?, estimatedCost?, repairSupplierId? }, user)` — STAFF · เคส AWAITING_APPROVAL SAME_MODEL (ยังไม่มี ticket) → ใน tx: `repair.createInTx({...จากเคส, defectDescription: case.symptom, payer: dto.payer ?? warrantySnapshot→PAYER default, ...}, user, tx)` + update `{ outcome: 'REPAIR', repairTicketId, replacementProductId: null, stage: 'RECEIVED', events: OUTCOME_SET note 'เปลี่ยนเป็น "ซ่อม" แทน · ผู้จ่าย …' }`

- [ ] **Step 1: เทสต์ defect-exchange** (`defect-exchange.service.spec.ts`): (a) `bypassWindowCheck` + `originAfterSalesCaseId` (ไม่มี ticket) โดย BM → ผ่าน guard (เคสมีจริง outcome SAME_MODEL customer ตรง) และ **ไม่เรียก** `markReplaced` (b) `bypassWindowCheck` ไม่มีทั้งสองต้นทาง → 400 `'bypassWindowCheck ต้องระบุ originRepairTicketId หรือ originAfterSalesCaseId'`

- [ ] **Step 2: เทสต์ exchange-service** (mock prisma/defect/repair/query): (a) confirm ในกรอบ (elig.eligible) → `execute` ถูกเรียกโดยไม่มี bypass, เคสอัปเดตครบ, audit หลัง tx (b) confirm นอกกรอบโดย BM → bypass true + `originAfterSalesCaseId` (c) เครื่องทดแทนไม่ IN_STOCK แล้ว (`execute` throw BadRequest 'ไม่เข้าเกณฑ์: …') → error ส่งต่อเป็น 400 เดิม, เคสไม่เปลี่ยน (Review Focus 2) (d) confirm บนเคส REPAIR + `replacementProductId` → `originRepairTicketId` ถูกส่ง (e) SALES เรียก confirm → controller 403 (เทสต์ที่ Task 8) และ service ตรวจซ้ำ `if (!['OWNER','BRANCH_MANAGER'].includes(user.role)) throw ForbiddenException` (Review Focus 1) (f) deliver เมื่อสัญญาใหม่ DRAFT → 400 ข้อความชี้หน้าสัญญา (Review Focus 4); ACTIVE → CLOSED + 2 events (g) rejectSameModel → CANCELLED + reason (h) switchToRepair → createInTx ถูกเรียกใน tx, outcome REPAIR, stage RECEIVED

- [ ] **Step 3: รันให้แดง** — `npx jest src/modules/defect-exchange src/modules/after-sales/__tests__/exchange-service.spec.ts`

- [ ] **Step 4: defect-exchange (2 จุด ไม่แตะบัญชี)** — DTO เพิ่ม `@IsOptional() @IsUUID('4') originAfterSalesCaseId?: string;` · ใน `execute` guard เดิมแทนที่ด้วย:

```ts
if (dto.bypassWindowCheck) {
  if (!dto.originRepairTicketId && !dto.originAfterSalesCaseId)
    throw new BadRequestException('bypassWindowCheck ต้องระบุ originRepairTicketId หรือ originAfterSalesCaseId');
  if (!['OWNER', 'BRANCH_MANAGER'].includes(reqUser.role)) throw new ForbiddenException('สิทธิ์ไม่พอ — bypass ทำได้เฉพาะ OWNER/BRANCH_MANAGER');
  if (dto.originRepairTicketId) { /* บล็อกตรวจ ticket เดิมทั้งก้อน — ไม่แก้ */ }
  else {
    const asCase = await tx.afterSalesCase.findFirst({ where: { id: dto.originAfterSalesCaseId, deletedAt: null }, select: { contractId: true, outcome: true, cancelledAt: true } });
    if (!asCase) throw new NotFoundException('ไม่พบเคสหลังการขาย');
    if (asCase.contractId !== dto.oldContractId || asCase.cancelledAt || !['SAME_MODEL_EXCHANGE', 'REPAIR'].includes(asCase.outcome ?? ''))
      throw new BadRequestException('เคสหลังการขายไม่ตรงกับสัญญา หรือไม่ใช่เคสเปลี่ยนรุ่นเดิม');
  }
} else { /* eligibility check เดิม */ }
```
และในบล็อก handoff `if (dto.bypassWindowCheck && dto.originRepairTicketId)` คงเดิม (เคสที่ไม่มี ticket ไม่เข้า) · audit `DEFECT_EXCHANGE_WINDOW_BYPASSED` เขียนเพิ่มในกิ่งเคส: `newValue: { originAfterSalesCaseId }`

- [ ] **Step 5: `AfterSalesExchangeService`** (โครง — เมธอด confirm ให้ครบตาม Interfaces; อีก 3 เมธอดรูปเดียวกัน)

```ts
@Injectable()
export class AfterSalesExchangeService {
  constructor(private readonly prisma: PrismaService, private readonly query: AfterSalesQueryService, private readonly defect: DefectExchangeService, private readonly repair: RepairTicketsService, private readonly audit: AuditService) {}
  private assertMgr(user: ReqUser) { if (!['OWNER', 'BRANCH_MANAGER'].includes(user.role)) throw new ForbiddenException('เฉพาะ ผจก.สาขา หรือเจ้าของ'); }
  async confirmSameModel(caseId: string, dto: ExchangeConfirmDto, user: ReqUser) {
    this.assertMgr(user);
    const c = await this.query.getCase(caseId, user);
    if (!c.contractId) throw new BadRequestException('เปลี่ยนรุ่นเดิมใช้ได้กับสัญญาผ่อนเท่านั้น');
    const fromRepair = c.outcome === 'REPAIR';
    if (!fromRepair && c.outcome !== 'SAME_MODEL_EXCHANGE') throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    if (['CLOSED', 'CANCELLED'].includes(c.stage)) throw new BadRequestException('เคสนี้จบแล้ว');
    if (c.replacementContractId) throw new ConflictException('ยืนยันไปแล้ว');
    const newProductId = fromRepair ? dto.replacementProductId : (c as any).replacementProductId;
    if (!newProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    const elig = await this.defect.checkEligibility(c.contractId, newProductId);
    const bypass = !elig.eligible;
    const res = await this.defect.execute({ oldContractId: c.contractId, newProductId, defectReason: c.symptom, notes: dto.note, bypassWindowCheck: bypass || undefined, originRepairTicketId: c.repairTicket?.id, originAfterSalesCaseId: c.id }, user);
    const newContract = res.newContract; // { id, contractNumber } — ตรวจรูปจริงจาก execute()
    await this.prisma.afterSalesCase.update({ where: { id: caseId }, data: { outcome: 'SAME_MODEL_EXCHANGE', replacementProductId: newProductId, replacementContractId: newContract.id, approvedById: user.id, approvedAt: new Date(), stage: 'READY_FOR_PICKUP', events: { create: { kind: 'APPROVED', actorId: user.id, note: `ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ ${newContract.contractNumber}${bypass ? ' · ข้ามกรอบ 7 วัน' : ''}${fromRepair ? ' · จากใบซ่อม (ซ่อมไม่ได้)' : ''}` } } } });
    await this.audit.log({ userId: user.id, action: 'AFTER_SALES_EXCHANGE_CONFIRMED', entity: 'after_sales_case', entityId: caseId, newValue: { newContractId: newContract.id, bypass } });
    return { id: caseId, stage: 'READY_FOR_PICKUP', replacementContractId: newContract.id, contractNumber: newContract.contractNumber };
  }
  // deliver / rejectSameModel / switchToRepair ตาม Interfaces — switchToRepair ใช้ this.prisma.$transaction + repair.createInTx (audit AFTER_SALES_OUTCOME_SWITCHED หลัง commit)
}
```
`ExchangeConfirmDto`: `@IsOptional() @IsString() note?: string; @IsOptional() @IsUUID() replacementProductId?: string;` · `ExchangeRejectDto`: `reason` `@MinLength(10)` · `SwitchToRepairDto`: `payer? @IsIn(['SHOP','CUSTOMER','SUPPLIER_CLAIM'])`, `estimatedCost? @Type(Number) @Min(0)`, `repairSupplierId? @IsUUID`

- [ ] **Step 6: รันให้เขียว + Commit** — `git commit -m "feat(after-sales): ยืนยันเปลี่ยนรุ่นเดิม/ส่งมอบ/ปฏิเสธ/เปลี่ยนเป็นซ่อม ผ่านเคส (+ bypass ต้นทางแบบเคส)"`

---

### Task 6: proxy คำขอมีราคา (อนุมัติ/ปฏิเสธ/ยกเลิก) + preview + รายการเครื่องทดแทน

**Files:**
- Modify: `apps/api/src/modules/after-sales/services/after-sales-exchange.service.ts` (เพิ่ม 5 เมธอด)
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.module.ts` (`exports: [ContractExchangeService, ExchangeCancelService]`)
- Create: `apps/api/src/modules/after-sales/dto/exchange-approve.dto.ts` (= `ApproveExchangeRequestDto` เดิม re-export) · `dto/replacement-products.dto.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/exchange-service.spec.ts` (describe ที่สอง)

**Interfaces:**
- Consumes: `ContractExchangeService.approve(id, user, dto)` · `.reject(id, reason, userId)` · `.buildPreview(params, user)` · `ExchangeCancelService.cancel(id, reason, user)`
- Produces:
  - `approvePriced(caseId, dto: ApproveExchangeRequestDto, user)` — MGR (engine บังคับ ESCALATE=OWNER เอง) → หลัง approve: reconcile เคส (`reconcileStage` จะได้ READY_FOR_PICKUP หรือ CLOSED (MEMO)) + event APPROVED note `'อนุมัติ · <MEMO ลงผลแล้ว | PRICED สัญญาใหม่ <no> รอเปิดใช้>'` + `approvedById/approvedAt`
  - `rejectPriced(caseId, dto: ExchangeRejectDto, user)` — OWNER → `reject(requestId, reason, user.id)` + reconcile (CANCELLED) + event REJECTED
  - `cancelSwap(caseId, dto: ExchangeRejectDto, user)` — MGR → `cancel(requestId, reason, user)` + reconcile + event CANCELLED note `'ยกเลิกคำขอเปลี่ยนเครื่อง: …'`
  - `preview(q: { imei; replacementProductId?; buybackPrice?; deviceCondition?; newTotalMonths?; newInterestRate? }, user)` — STAFF → หา contract จาก IMEI (`lookup`) แล้ว `buildPreview({ oldContractId, newProductId, ... }, user)` คืนผลเดิมของ engine (`mode, tier, ncv, marketMin, expectedPl, blockers, hasUnpaidLateFee, …`)
  - `replacementProducts(q: { imei; sameModel: boolean; branchId? }, user)` — ALL → รายการ `{ id, brand, model, storage, color, imeiSerial, cashPrice, branchId }` ของ `Product` `deletedAt:null, status:'IN_STOCK'` กรอง `sameModel ? { brand, model, storage ของเครื่องเดิม, category: 'PHONE_USED' }` (defect-exchange ต้องการ PHONE_USED — ดู `checkEligibility`) · `branchId` ตามสิทธิ์ (BM/SALES = สาขาตัวเอง) · `take 200 orderBy createdAt asc`

- [ ] **Step 1: เทสต์** (mock): (a) approvePriced MEMO → `approve` ถูกเรียกด้วย dto checkbox, reconcile → CLOSED, event note มี 'MEMO' (b) approvePriced ESCALATE โดย BM → engine throw Forbidden → ส่งต่อ 403, เคสไม่เปลี่ยน (c) rejectPriced โดย BM → 403 ที่ service (`assertOwner`) (d) cancelSwap → `ExchangeCancelService.cancel` ถูกเรียก + CANCELLED (e) preview ส่งพารามิเตอร์ครบ (f) replacementProducts sameModel กรอง brand/model/storage/PHONE_USED/IN_STOCK และสาขาของ SALES

- [ ] **Step 2: รันให้แดง** → **Step 3: implement** ตาม Interfaces (reconcile = โหลดเคสด้วย select ของ `ReconcilableCase` แล้ว `reconcileStage(this.prisma, row)`) · module export · `after-sales.module.ts` providers เพิ่ม `AfterSalesExchangeService`

- [ ] **Step 4: รันให้เขียว + Commit** — `git commit -m "feat(after-sales): proxy อนุมัติ/ปฏิเสธ/ยกเลิกคำขอมีราคา + preview + รายการเครื่องทดแทน"`

---

### Task 7: query — คอลัมน์แท็บรออนุมัติ · summary เปลี่ยนเครื่อง · timeline ของคำขอ · R25 (a)(d)

**Files:**
- Modify: `apps/api/src/modules/after-sales/services/after-sales-query.service.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/query.spec.ts` (describe ใหม่ (h)–(k))

**Interfaces:**
- Produces บน `CaseRow` (list + getCase):

```ts
exchange: null | {
  kind: 'SAME_MODEL' | 'PRICED';
  mode: 'MEMO' | 'PRICED' | null;            // PRICED_EXCHANGE เท่านั้น
  approvalTier: 'AUTO' | 'REVIEW' | 'ESCALATE' | null;
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED' | null;
  buybackPrice: string | null; ncvSnapshot: string | null;
  approverRole: 'BRANCH_MANAGER' | 'OWNER';  // SAME_MODEL → BRANCH_MANAGER · PRICED: ESCALATE → OWNER, อื่น → BRANCH_MANAGER
  oldProduct: { brand; model; storage; imeiSerial } | null;
  newProduct: { id; brand; model; storage; imeiSerial } | null;   // จาก replacementProductId
  replacementContract: { id; contractNumber; status } | null;
  requestedBy: { id; name } | null;           // เคส = receivedBy
};
```
- `summary` เปลี่ยน `openExchange` = เคสเปิดที่ outcome ∈ {SAME_MODEL_EXCHANGE, PRICED_EXCHANGE} · `exchanges` = เคส outcome เปลี่ยนที่ `closedAt` ในเดือนนี้ (BKK) · `awaitingApproval` คงเดิม (นับจาก derived stage)
- `getCase().timeline` รวมเหตุการณ์ของคำขอ: `{ at: request.createdAt, kind: 'EXCHANGE_REQUESTED', note: 'ยื่นคำขอ <mode>' }`, `approvedAt → 'EXCHANGE_APPROVED'`, `canceledAt → 'EXCHANGE_CANCELED' note cancelReason`, `status==='REJECTED' → 'EXCHANGE_REJECTED' note rejectionReason` (at = updatedAt)
- `list()` R25 (a): เมื่อ `dto.stale` → `total = decorated.length` (จำนวนหลังกรองจริง) และ `truncated` คงตามเดิม · เอกสารในคอมเมนต์ว่า total เป็นยอดหลังกรองเฉพาะโหมด stale

- [ ] **Step 1: เทสต์** (h) list แถว SAME_MODEL AWAITING_APPROVAL มี `exchange.kind='SAME_MODEL'`, `approverRole='BRANCH_MANAGER'`, `newProduct` จาก replacementProductId (i) แถว PRICED ESCALATE → `approverRole='OWNER'`, `mode`, `buybackPrice` string 2dp (j) summary: openExchange นับเฉพาะเคสเปิด outcome เปลี่ยน; exchanges นับที่ closedAt เดือนนี้ (k) `stale=true` → `total` = จำนวนที่ผ่านตัวกรอง ไม่ใช่ count ของ DB (R25 a) (l) getCase ของเคส PRICED มี timeline item `EXCHANGE_REQUESTED` และเรียงตามเวลา

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/query.spec.ts`

- [ ] **Step 3: implement** — include เพิ่มใน `findMany`/`findFirst`: `exchangeRequest: { select: { status, mode, approvalTier, buybackPrice, ncvSnapshot, memoAppliedAt, rejectionReason, cancelReason, canceledAt, approvedAt, createdAt, updatedAt, newContract: { select: { id, contractNumber, status } } } }`, `product: { select: { brand, model, storage, imeiSerial } }` (เครื่องเดิม), และ **เครื่องทดแทน**: หลัง fetch รวบ `replacementProductId` ทั้งหมด → `product.findMany({ where: { id: { in } }, select: {...} })` แมพกลับ (1 query ไม่ N+1) · `replacementContract` = `exchangeRequest.newContract` หรือ (SAME_MODEL) `contract.findMany({ where: { id: { in: replacementContractIds } } })` 1 query · `approverRole` คำนวณใน `decorate` · Decimal → `toFixed(2)` string

- [ ] **Step 4: รันให้เขียว + Commit** — `git commit -m "feat(after-sales): ข้อมูลเปลี่ยนเครื่องในรายการ/สรุป/เคส + timeline คำขอ + total ตามตัวกรองค้างนาน (R25)"`

---

### Task 8: Controller + module + integration spec บน DB จริง

**Files:**
- Modify: `apps/api/src/modules/after-sales/after-sales.controller.ts` · `after-sales.service.ts` (facade) · `after-sales.module.ts`
- Create: `apps/api/src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts` (vitest บน DB จริง — ไฟล์ต้องอยู่ในโฟลเดอร์นี้เพื่อให้ glob `AFTERSALES_FILES` เห็น)

**Interfaces (routes ใหม่ — ทุกตัวใต้ `@Controller('after-sales')`, roles ตาม Global Constraints):**

| Method | Path | Roles | → service |
|---|---|---|---|
| GET | `/after-sales/exchange/preview?imei&replacementProductId&buybackPrice&deviceCondition&newTotalMonths&newInterestRate` | STAFF | `exchange.preview` |
| GET | `/after-sales/replacement-products?imei&sameModel=1&branchId?` | ALL | `exchange.replacementProducts` |
| POST | `/after-sales/:id/exchange/confirm` | MGR | `exchange.confirmSameModel` |
| POST | `/after-sales/:id/exchange/deliver` | STAFF | `exchange.deliver` |
| POST | `/after-sales/:id/exchange/reject` | MGR | `exchange.rejectSameModel` (SAME_MODEL) |
| POST | `/after-sales/:id/switch-to-repair` | STAFF | `exchange.switchToRepair` |
| POST | `/after-sales/:id/approve` | MGR | `exchange.approvePriced` |
| POST | `/after-sales/:id/reject` | OWNER | `exchange.rejectPriced` |
| POST | `/after-sales/:id/cancel-swap` | MGR | `exchange.cancelSwap` |

(route ที่ 3 กับ 7 คนละทางออก: `/exchange/reject` = ปฏิเสธเปลี่ยนรุ่นเดิม (เคสยกเลิก) · `/reject` = ปฏิเสธคำขอมีราคา (engine) — controller เลือกตาม `outcome` ของเคสไม่ได้ เพราะ roles ต่างกัน จึงแยก path)

- [ ] **Step 1: controller/facade/module** — เพิ่ม route ตามตาราง (`@Param('id', ParseUUIDPipe)`, `@CurrentUser() user`, DTO ตาม Task 5–6; query DTO `ExchangePreviewDto`/`ReplacementProductsDto` ใช้ class-validator + `@Transform` boolean เหมือน `ListCasesDto`) · facade delegate · `after-sales.module.ts` imports `ContractExchangeModule` (ถ้ายังไม่เพิ่มใน Task 4) providers `AfterSalesExchangeService`

- [ ] **Step 2: integration spec** (รูปแบบเดียวกับ `after-sales-flow.integration.spec.ts` — seed ผ่าน Prisma, `afterAll` ลบลูกก่อนแม่ ทุก id ที่สร้าง รวมสัญญาใหม่/JE ที่ engine สร้าง (`journal_entries` where `metadata.contractId` in [old,new]) — อ่าน `exchange-priced-flow.integration.spec.ts` ของ contract-exchange เพื่อดูว่า cleanup สัญญา+JE ทำอย่างไร แล้วทำแบบเดียวกัน):
  1. seed: ลูกค้า · สาขา · เครื่องเดิม PHONE_USED SOLD_INSTALLMENT · สัญญา ACTIVE `deviceReceivedAt = now-2d` (ในกรอบ 7 วัน) ไม่มี Payment PAID · เครื่องทดแทน IN_STOCK รุ่น/ความจุเดิม
  2. `createCase(outcome SAME_MODEL_EXCHANGE, replacementProductId)` โดย SALES → เคส AWAITING_APPROVAL ไม่มี ticket · list tab AWAITING_APPROVAL เห็นแถว `exchange.kind='SAME_MODEL'`
  3. SALES `confirmSameModel` → ForbiddenException (Review Focus 1)
  4. BM confirm → เคส READY_FOR_PICKUP · `replacementContractId` ชี้สัญญาใหม่ DRAFT ที่ engine สร้าง · สัญญาเดิม `DEFECT_EXCHANGED` · เครื่องเดิม `DEFECT_RETURN` · เครื่องใหม่ `RESERVED` (assert engine ทำงานจริง)
  5. deliver ขณะสัญญาใหม่ DRAFT → BadRequest (Review Focus 4) · set สัญญาใหม่ `status:'ACTIVE'` ตรง ๆ ใน DB (จำลองการเปิดใช้) → deliver สำเร็จ → CLOSED + closedAt · summary `exchanges` +1
  6. PRICED: seed สัญญาที่ engine จะปฏิเสธ (เช่น มี `advanceBalance > 0` หรือค้างชำระ — อ่าน guard ใน `submit()` แล้วเลือกตัวที่ seed ง่ายสุด) → `createCase(outcome PRICED_EXCHANGE)` throw และเคสถูก CANCELLED พร้อม `cancelReason` ขึ้นต้น 'ยื่นคำขอไม่สำเร็จ' · IMEI เดิมเปิดเคสใหม่ได้ (Review Focus 3)
  7. PRICED สำเร็จ (MEMO: เครื่องทดแทนราคาเท่าเดิม) → เคส AWAITING_APPROVAL + `exchangeRequestId` · เรียก `ContractExchangeService.reject(requestId, reason, ownerId)` **ตรง ๆ** (endpoint เก่า) → `getCase` คืน CANCELLED + `cancelReason` = reason (Review Focus 5 — reconcile จาก request)
  8. drifted in-tx guard (R25 g): สร้างเคส REPAIR → ปิด ticket ผ่าน `RepairTicketsService.returnToCustomer` ตรง (stored stage ยังไม่ CLOSED) → `createCase` IMEI เดิมอีกครั้ง **โดยไม่เรียก lookup/getCase ก่อน** (mock `lookupSvc.lookup` ให้คืน `openCase:null` ไม่ได้ในไฟล์นี้ — ให้ตรวจแทนว่า DB row เก่าถูก CAS เป็น CLOSED โดย `createCase` เอง: อ่าน stage ก่อน = READY_FOR_PICKUP, หลัง = CLOSED)
  รันด้วย `DATABASE_URL=postgresql://iamnaii@localhost:5432/after_sales_pr1_test?schema=public npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-exchange.integration.spec.ts` (สูตรจาก `task-7-report` ของ PR 1 / memory `bestchoice-local-dev-gotchas` ข้อ 11) · ฐานทดสอบทิ้งต้อง `prisma migrate deploy` ถึง Task 1 แล้ว

- [ ] **Step 3: รันให้เขียว + Commit** — jest unit ทั้งโมดูล + integration 8 เคส + `npx tsc --noEmit` + `npx nest build` → `git commit -m "feat(after-sales): route เปลี่ยนเครื่อง 9 เส้น + integration spec บน DB จริง"`

---

### Task 9: เว็บ — types/labels · Pager clamp (R25 b) · stale label (R25 e) · query keys

**Files:**
- Modify: `apps/web/src/pages/after-sales/after-sales.ts` · `Pager.tsx` · `AfterSalesPage.tsx` (page clamp + reset ใน state เดียว R25 c)
- Test: `apps/web/src/pages/after-sales/after-sales.test.ts` · `AfterSalesPage.test.tsx`

**Interfaces (Produces):**
- `CaseRow.exchange` (รูปเดียวกับ Task 7) · `CaseDetail.replacementProductId: string | null` · `Summary` เดิม
- `EXCHANGE_KIND_LABEL = { SAME_MODEL: 'รุ่นเดิม · 7 วัน', PRICED: 'มีราคา' }` · `APPROVER_LABEL = { BRANCH_MANAGER: 'ผจก.สาขา', OWNER: 'เจ้าของเท่านั้น' }` · `TIER_LABEL = { AUTO: 'อัตโนมัติ', REVIEW: 'REVIEW', ESCALATE: 'ESCALATE' }` · `STEP_TITLES_BY_OUTCOME: Record<AfterSalesOutcome, [string, string, string, string]>` = REPAIR `['รับเรื่องแล้ว','กำลังซ่อม','รอลูกค้ารับ','ปิดเคส']` · SAME_MODEL/CASH `['รับเรื่องแล้ว','รอ ผจก. ยืนยัน','ส่งมอบเครื่องใหม่','ปิดเคส']` · PRICED `['รับเรื่องแล้ว','รออนุมัติ','สัญญาใหม่','ปิดเคส']` · `stageIndex(stage): 0..3` (RECEIVED 0 · IN_REPAIR/AWAITING_APPROVAL 1 · READY_FOR_PICKUP 2 · CLOSED 3 · CANCELLED = ทั้งหมด idle)
- `staleLabel` → ข้อความ `${s[1]} ${days} วัน (เกณฑ์ ${s[0]} วัน)` (R25 e — เลิกคำว่า "เกิน" ที่ขอบ)
- `afterSalesKeys.preview(p)`, `.replacementProducts(p)`
- `Pager`: prop `page` ถูก clamp โดยผู้เรียก: `AfterSalesPage` ใช้ `const safePage = Math.min(page, totalPages)` ส่งเข้า Pager และใช้ในการ query; และแทน `useEffect` reset ด้วย `setFilters` ตัวเดียว `{ tab, q, staleOnly, branchId, page }` ที่ทุก setter ของตัวกรองตั้ง `page: 1` พร้อมกัน (ไม่มี request ซ้ำ)

- [ ] **Step 1: เทสต์** — `after-sales.test.ts`: STEP_TITLES ครบทุก outcome ไม่มีเลขนำหน้าและไม่มีคำ "รับเครื่อง" · `staleLabel('IN_REPAIR', 14)` = 'ส่งศูนย์ 14 วัน (เกณฑ์ 14 วัน)' · `AfterSalesPage.test.tsx`: (m) total 120 limit 50 หน้า 3 แล้ว refetch เหลือ total 60 → แสดง "หน้า 2 / 2" ไม่ใช่ 3/2 (n) เปลี่ยนแท็บ → มี request เดียวที่ page=1 (mock `api.get` นับครั้งหลังเปลี่ยนแท็บ = 1)

- [ ] **Step 2: รันให้แดง → Step 3: implement → Step 4: เขียว + Commit** — `git commit -m "feat(web/after-sales): types เปลี่ยนเครื่อง + ป้ายผู้อนุมัติ + pager clamp + reset ครั้งเดียว (R25)"`

---

### Task 10: เว็บ — แจ้งปัญหาเครื่อง: เลือกเครื่องทดแทน + ฟอร์มเปลี่ยนแบบมีราคาฝังในขั้น 3 + สรุปก่อนบันทึก

**Files:**
- Create: `apps/web/src/pages/after-sales/ReplacementProductPicker.tsx` · `PricedExchangeFields.tsx`
- Modify: `apps/web/src/pages/AfterSalesNewPage.tsx` · `pages/after-sales/OutcomePicker.tsx` (ปุ่ม implemented=true คลิกได้)
- Test: `apps/web/src/pages/AfterSalesNewPage.test.tsx` (เพิ่ม) · `after-sales/PricedExchangeFields.test.tsx`

**Interfaces:**
- Consumes: `GET /after-sales/replacement-products?imei=&sameModel=1|0` → `ReplacementProduct[]` · `GET /after-sales/exchange/preview?imei=&replacementProductId=&buybackPrice=&deviceCondition=&newTotalMonths=&newInterestRate=` → `{ mode, tier, ncv, marketMin, expectedPl, blockers: { overdueBlocked, advanceBlocked }, hasUnpaidLateFee }` (รูปเดียวกับ `previewQ` ใน `ExchangeRequestForm.tsx` บรรทัด 105–126 — ย้ายโค้ดมาแล้วเปลี่ยน URL) · `POST /after-sales` multipart เพิ่ม `replacementProductId`, `buybackPrice`, `deviceCondition`, `newTotalMonths`, `newInterestRate`, `conditionNote`
- Produces: `ReplacementProductPicker({ imei, sameModel, value, onChange }: { imei: string; sameModel: boolean; value: string | null; onChange: (id: string | null) => void })` — รายการการ์ดเครื่อง (ยี่ห้อ รุ่น ความจุ สี IMEI ราคาสด) เลือกได้ 1 · ว่าง = ข้อความ "ไม่มีเครื่องรุ่น/ความจุเดิมพร้อมขายในสาขานี้" · `PricedExchangeFields({ imei, replacementProductId, value, onChange }: { imei; replacementProductId: string | null; value: PricedForm; onChange: (v: PricedForm) => void })` โดย `PricedForm = { buybackPrice: string; deviceCondition: 'A'|'B'|'C'|'D'; newTotalMonths: string; newInterestRatePct: string; conditionNote: string }` แสดง preview tier/NCV/blockers เหมือนฟอร์มเดิม (`pctToRate` ย้ายมาด้วย)

- [ ] **Step 1: เทสต์** — `AfterSalesNewPage.test.tsx`: (a) lookup สัญญาผ่อนในกรอบ 7 วัน → ปุ่ม "เปลี่ยนรุ่นเดิม" กดได้ → แสดง `ReplacementProductPicker` (mock ตอบ 2 เครื่อง) → เลือก 1 → สรุปก่อนบันทึกมีข้อความ 'ทางออก "เปลี่ยนรุ่นเดิม" · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน …' → submit multipart มี `outcome=SAME_MODEL_EXCHANGE`, `replacementProductId` และ **ไม่มี** `payer/repairSupplierId` (b) ไม่เลือกเครื่องทดแทน → ปุ่มบันทึกปิด + ข้อความใต้ปุ่ม (c) ปุ่ม "เปลี่ยนแบบมีราคา" → `PricedExchangeFields` + picker `sameModel=0`; preview mock tier REVIEW → ป้าย "ผจก.สาขาอนุมัติ"; submit มี `buybackPrice`, `deviceCondition`, `newTotalMonths`, `newInterestRate` (rate = pct/100 เป็น string) (d) preview `blockers.overdueBlocked` → ปุ่มบันทึกปิด + เหตุผล (e) ขายสด → ปุ่มเปลี่ยนรุ่นเดิมปิดพร้อม reason จาก API (ไม่เปลี่ยนจาก PR 1) · `PricedExchangeFields.test.tsx`: กรอกราคา → query preview ถูกเรียกด้วยพารามิเตอร์ครบ; mode MEMO → ซ่อนช่องราคา/งวด แสดง "ราคาเท่าเดิม (MEMO)"

- [ ] **Step 2: รันให้แดง** — `npx vitest run src/pages/AfterSalesNewPage.test.tsx src/pages/after-sales/PricedExchangeFields.test.tsx`

- [ ] **Step 3: implement** — ขั้น 3 ของ `AfterSalesNewPage`: หลัง `OutcomePicker` render ตาม `outcome`: REPAIR = ฟิลด์เดิม (ป้ายศูนย์ซ่อม = "ศูนย์ซ่อม (ไม่เลือก = ซ่อมที่ร้าน)") · SAME_MODEL = `ReplacementProductPicker sameModel` + กล่องข้อความ "ผจก.สาขา ต้องยืนยันก่อนเปลี่ยน · ราคาเท่าเดิม ไม่มีเงินเปลี่ยนมือ" (+ "ข้ามกรอบ 7 วัน — ต้องให้ ผจก. ยืนยัน" เมื่อ option.note มีคำนั้น) · PRICED = picker `sameModel=false` + `PricedExchangeFields` · สรุปก่อนบันทึก (แถบล่าง) ต่อทางออก · `handleSubmit` ต่อฟิลด์ตาม Interfaces · ปุ่มบันทึกปิดเมื่อ (ไม่เลือกเครื่องทดแทน) หรือ (preview มี blocker) · `OutcomePicker`: ปุ่ม `enabled && implemented` คลิกได้; `enabled && !implemented` = ปิดพร้อม "เร็ว ๆ นี้" (คงเดิมสำหรับ CASH)

- [ ] **Step 4: เขียว + Commit** — `git commit -m "feat(web/after-sales): แจ้งปัญหาเครื่องเลือกเปลี่ยนรุ่นเดิม/เปลี่ยนแบบมีราคา + เลือกเครื่องทดแทน + preview"`

---

### Task 11: เว็บ — หน้าเคส: ปุ่มตามทางออก · การ์ดเครื่องเดิม→ใหม่ · dialog ยืนยัน/ปฏิเสธ/เปลี่ยนเป็นซ่อม/อนุมัติ/ส่งมอบ · ซ่อมที่ร้าน

**Files:**
- Create: `apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx` · `ExchangeCard.tsx`
- Modify: `apps/web/src/pages/AfterSalesCasePage.tsx` · `RepairActionDialogs.tsx` (ส่งซ่อมจาก in-shop) · `CaseTimeline.tsx` (kind ใหม่)
- Test: `apps/web/src/pages/AfterSalesCasePage.test.tsx` (เพิ่ม (j)–(q))

**Interfaces:**
- Consumes: routes Task 8 · `CaseDetail.exchange`, `replacementProductId`, `repairTicket.repairSupplier`
- Produces: `ExchangeCard({ data }: { data: CaseDetail })` — การ์ด "เครื่องเดิม → เครื่องใหม่" (mockup: เครื่องเดิม/ใหม่ 2 กล่อง + ลูกศร + ป้าย "อยู่ในกรอบ 7 วัน · วันที่ N" / "รุ่น+ความจุตรงกัน" / "มีราคา · <tier>") · `ExchangeActionDialogs.tsx` exports `ConfirmExchangeDialog(DialogBaseProps & { data: CaseDetail })` (เช็คลิสต์ 3 ข้อจาก mockup: สภาพเครื่องเดิมตรงรูป · เครื่องใหม่จากสต๊อกสาขานี้ IMEI ตรง · ลูกค้าเซ็นใบส่งมอบแล้ว — 2 ข้อแรกบังคับ ข้อ 3 ไม่บังคับใน PR นี้ (PDF = PR 4) + note + กล่อง "เมื่อกดยืนยัน ระบบจะทำให้: …" 3 บรรทัดจาก mockup + `POST /after-sales/:id/exchange/confirm`), `RejectExchangeDialog(DialogBaseProps & { kind: 'SAME_MODEL' | 'PRICED' })` (reason ≥10 → `/exchange/reject` หรือ `/reject`), `SwitchToRepairDialog(DialogBaseProps & { defaultPayer })` (ผู้จ่าย · ค่าซ่อมประมาณ · ศูนย์ซ่อม (ไม่บังคับ) → `/switch-to-repair`), `ApprovePricedDialog(DialogBaseProps & { mode: 'MEMO'|'PRICED' })` (MEMO: 2 checkbox บังคับ "เซ็น ADDENDUM แล้ว" + "สลับ MDM แล้ว" → `/approve {memoAddendumSigned, memoMdmSwapped}`; PRICED: ยืนยันเฉย ๆ), `CancelSwapDialog(DialogBaseProps)` (reason → `/cancel-swap`), `DeliverExchangeConfirm` = `ConfirmDialog` "ส่งมอบเครื่องใหม่ให้ลูกค้าแล้ว — ระบบจะปิดเคส" → `/exchange/deliver`

**ปุ่มหลักปุ่มเดียวตาม outcome × stage × role (แทน `primaryLabelOf` เดิม):**

| outcome | stage | ปุ่มหลัก (STAFF) | เมื่อ role ไม่พอ | ปุ่มรอง |
|---|---|---|---|---|
| REPAIR | RECEIVED ไม่มีศูนย์ | "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)" → MarkRepairedDialog | — | "ส่งซ่อม" (outline) · "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" (MGR, สัญญาผ่อน) · ยกเลิกเคส (MGR) |
| REPAIR | RECEIVED มีศูนย์ | "ส่งซ่อม" | — | เหมือนแถวบน (ไม่มีปุ่มซ่อมที่ร้าน) |
| REPAIR | IN_REPAIR | "บันทึกซ่อมเสร็จ" | — | "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" (MGR) |
| REPAIR | READY_FOR_PICKUP (ticket ≠ REPLACED) | "ส่งมอบคืนลูกค้า" | — | "ส่งซ่อมต่อ" · ยกเลิกเคส (MGR) |
| REPAIR/SAME_MODEL | READY_FOR_PICKUP (มี replacementContractId) | สัญญาใหม่ DRAFT: OWNER/BM/FM ลิงก์ปุ่มหลัก "เปิดใช้สัญญาใหม่ <no> ที่หน้าสัญญา" · ไม่ DRAFT: "ส่งมอบเครื่องใหม่" (final fix I4) | DRAFT: "รอเปิดใช้สัญญาใหม่ <no>" | ลิงก์ "สัญญาใหม่ <no>" (`/contracts/:id`) |
| SAME_MODEL | AWAITING_APPROVAL | MGR: "ยืนยันเปลี่ยนเครื่อง" | SALES: ข้อความ "รอ ผจก.สาขา ยืนยัน" (ไม่มีปุ่ม) | "ปฏิเสธ (ใส่เหตุผล)" (MGR) · "เปลี่ยนเป็น 'ซ่อม' แทน" (STAFF) |
| PRICED | AWAITING_APPROVAL | อนุมัติได้ (BM เมื่อ approverRole=BRANCH_MANAGER · OWNER เสมอ): "อนุมัติ" | อื่น: "รอ <APPROVER_LABEL> อนุมัติ" | "ปฏิเสธ" (OWNER) — ไม่มี "ยกเลิกคำขอ" เพราะ engine ยกเลิกได้เฉพาะคำขอ APPROVED (final fix I2) · ไม่มีคำขอผูก: "ยกเลิกเคส" (MGR, M1) |
| PRICED | READY_FOR_PICKUP | สัญญาใหม่ DRAFT: ลิงก์ปุ่มหลัก "เปิดใช้สัญญาใหม่ <no> ที่หน้าสัญญา" (OWNER/BM/FM — ทางเดียวกับ SAME_MODEL, final fix I4) | "รอเปิดใช้สัญญาใหม่ <no>" | "ยกเลิกคำขอ" (MGR) |
| PRICED | CLOSED + คำขอ APPROVED | ไม่มี | — | "ยกเลิก swap" (MGR, final fix I3) |
| ทุกทาง | CLOSED / CANCELLED (นอกจากแถวบน) | ไม่มี | — | — |

- [ ] **Step 1: เทสต์** — (j) SAME_MODEL AWAITING BM → ปุ่มหลักเดียว "ยืนยันเปลี่ยนเครื่อง"; dialog ติ๊ก 2 ข้อบังคับแล้วยืนยัน → POST `/after-sales/<id>/exchange/confirm` (k) SALES เห็นข้อความ "รอ ผจก.สาขา ยืนยัน" ไม่มีปุ่มหลัก และมี "เปลี่ยนเป็น 'ซ่อม' แทน" (l) READY_FOR_PICKUP + replacementContractId + สัญญาใหม่ DRAFT → ปุ่ม "ส่งมอบเครื่องใหม่" + API 400 → toast error ข้อความ API (m) PRICED ESCALATE + BM → ไม่มีปุ่มอนุมัติ มี "รอ เจ้าของเท่านั้น อนุมัติ"; OWNER → "อนุมัติ" (n) PRICED MEMO + OWNER อนุมัติ → dialog 2 checkbox ปิดปุ่มจนติ๊กครบ → POST `/approve` body `{memoAddendumSigned:true, memoMdmSwapped:true}` (o) REPAIR RECEIVED ไม่มีศูนย์ → ปุ่มหลัก "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)" + รอง "ส่งซ่อม" (p) REPAIR IN_REPAIR BM สัญญาผ่อน → ปุ่มรอง "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" เปิด picker แล้ว confirm ส่ง `replacementProductId` (q) StepBar หัวข้อของ SAME_MODEL = 'รับเรื่องแล้ว/รอ ผจก. ยืนยัน/ส่งมอบเครื่องใหม่/ปิดเคส' ไม่มีเลขซ้ำ · ทุกเทสต์: ปุ่มสีเขียว (`bg-primary`) นับได้ 1 นอก `data-testid="mobile-bar"`

- [ ] **Step 2: รันให้แดง → Step 3: implement** ตามตาราง (แยก `primaryAction(data, role)` เป็นฟังก์ชันบริสุทธิ์ใน `after-sales.ts` คืน `{ label, dialog } | { waitingText } | null` เพื่อเทสต์ง่าย) · `ExchangeCard` ใต้การ์ดเครื่องและลูกค้าเมื่อ `data.exchange` · timeline label ใหม่: `APPROVED`→"ยืนยัน/อนุมัติ", `REJECTED`→"ปฏิเสธ", `EXCHANGE_REQUESTED`→"ยื่นคำขอ", `EXCHANGE_APPROVED`→"อนุมัติคำขอ", `EXCHANGE_REJECTED`→"ปฏิเสธคำขอ", `EXCHANGE_CANCELED`→"ยกเลิกคำขอ" · ทุก mutation invalidate `afterSalesKeys.all` · toast ตาม PR 1

- [ ] **Step 4: เขียว + Commit** — `git commit -m "feat(web/after-sales): หน้าเคสรองรับเปลี่ยนเครื่อง (ยืนยัน/ส่งมอบ/ปฏิเสธ/อนุมัติ/เปลี่ยนเป็นซ่อม) + ซ่อมที่ร้าน"`

---

### Task 12: เว็บ — แท็บ "รออนุมัติ" ตารางเฉพาะ + ปุ่มในแถว + ป้ายผู้อนุมัติ

**Files:**
- Create: `apps/web/src/pages/after-sales/ApprovalTable.tsx`
- Modify: `apps/web/src/pages/AfterSalesPage.tsx` · `CaseTable.tsx` (ชิป "รอ ผจก." บนแถว SAME_MODEL ในแท็บกำลังทำสำหรับ SALES)
- Test: `apps/web/src/pages/AfterSalesPage.test.tsx` (เพิ่ม) · `after-sales/ApprovalTable.test.tsx`

**Interfaces:**
- `ApprovalTable({ rows, role, onAction }: { rows: CaseRow[]; role: string; onAction: (row: CaseRow, action: 'confirm' | 'approve' | 'reject' | 'open') => void })` — คอลัมน์ตาม mockup C: ขอเมื่อ (+ผู้ยื่น) · เคส · ลูกค้า (+สัญญา) · เครื่องเดิม → ใหม่ (+สภาพ/ค้างงวด หรือ "รุ่น+ความจุเดิม · วันที่ N ของ 7") · ประเภท/ราคา (ชิป `EXCHANGE_KIND_LABEL` + tier + "รับซื้อ X · Y% ของยอดคงเหลือ" เมื่อ ncvSnapshot) · ใครอนุมัติได้ (ชิป `APPROVER_LABEL` เหลือง=ผจก.สาขา แดง=เจ้าของเท่านั้น พร้อมไอคอน) · การกระทำ: SAME_MODEL → "ยืนยันเปลี่ยนเครื่อง" (MGR) + "ปฏิเสธ"; PRICED → "อนุมัติ" (enabled ตาม approverRole × role) + "ปฏิเสธ" (OWNER) + "เปิดเคส" · แถวที่ role อนุมัติไม่ได้ = ปุ่มอนุมัติ `disabled` + ข้อความ "รอเจ้าของ · แจ้งแล้วในระบบ"
- ปุ่มในแถวเปิด dialog ตัวเดียวกับหน้าเคส (`ConfirmExchangeDialog` ต้องการ `CaseDetail` → กด "ยืนยันเปลี่ยนเครื่อง" จากแถว = นำทางไป `/after-sales/:id` แล้วเปิด dialog ผ่าน `?action=confirm` (หน้าเคสอ่าน query แล้วเปิด) — ไม่ต้องโหลดรายละเอียดในตาราง) · "อนุมัติ"/"ปฏิเสธ" ทำในตารางได้ (dialog ไม่ต้องใช้รายละเอียด)
- แท็บนี้แสดงเฉพาะ MGR/OWNER (คงเดิม: SALES ไม่เห็นแท็บ) แต่ **FM/ACCOUNTANT เห็นแท็บแบบอ่านอย่างเดียว** (ไม่มีปุ่ม) — spec ข้อ 12.1 "รายการอ่านได้ทุก role ปุ่มตามสิทธิ์"
- ข้อความว่าง: "ไม่มีรายการรออนุมัติ"

- [ ] **Step 1: เทสต์** — `ApprovalTable.test.tsx`: 3 แถวจาก mockup (PRICED REVIEW · SAME_MODEL · PRICED ESCALATE) กับ role BM → แถว 1 "อนุมัติ" enabled, แถว 2 "ยืนยันเปลี่ยนเครื่อง", แถว 3 "อนุมัติ" disabled + "รอเจ้าของ"; role OWNER → ทุกปุ่ม enabled; role FINANCE_MANAGER → ไม่มีปุ่ม · `AfterSalesPage.test.tsx`: (o) แท็บรออนุมัติ render `ApprovalTable` ไม่ใช่ `CaseTable`; กด "อนุมัติ" แถว MEMO → dialog checkbox → POST `/after-sales/<id>/approve`; กด "ยืนยันเปลี่ยนเครื่อง" → navigate `/after-sales/<id>?action=confirm` (p) SALES ในแท็บกำลังทำเห็นชิป "รอ ผจก." บนแถว SAME_MODEL

- [ ] **Step 2: รันให้แดง → Step 3: implement → Step 4: เขียว + Commit** — `git commit -m "feat(web/after-sales): แท็บรออนุมัติ — ตารางรวมเปลี่ยนรุ่นเดิม/มีราคา + ป้ายผู้อนุมัติ + ปุ่มในแถว"`

---

### Task 13: ถอดหน้าเก่า — redirect · ลบไฟล์ตาย · เมนู · E2E

**Files:**
- Modify: `apps/web/src/App.tsx` · `apps/web/src/config/menu.ts`
- Delete: `apps/web/src/pages/InsurancePage.tsx` · `pages/DefectExchangePage.tsx` · `pages/insurance/CreateInsuranceWizardPage.tsx` · `pages/insurance/ExchangeRequestForm.tsx` · `pages/insurance/ExchangeRequestsPage.tsx` · `pages/insurance/WarrantyCheckTab.tsx` + `WarrantyCheckTab.test.tsx` · `pages/insurance/WizardSteps/` ทั้งโฟลเดอร์ (ImeiLookupStep, DefectDescriptionStep, CustomerPickerStep, DevicePickerStep, ExchangeProductPickerStep, WarrantyPreviewStep) · `pages/insurance/__tests__/ImeiLookupStep.test.tsx` · `pages/insurance/components/WarrantyWindowCard.tsx` + `.test.tsx`
- Keep: `pages/insurance/RepairTicketDetailPage.tsx` + `components/WarrantyBadge.tsx` (fallback ของ `/insurance/:id` ตามสเปกข้อ 11 — คงอีก ≥2 deploy)
- E2E: ลบ `apps/web/e2e/{exchange-request-flow,insurance-wizard-repair,insurance-wizard-exchange,insurance-warranty-check,insurance-imei-wizard}.spec.ts` (เปิดแต่ละไฟล์ก่อนลบ: ลบเฉพาะที่นำทางไป route ที่ถอด; `insurance-repair-ticket.spec.ts` ถ้าใช้ `/insurance/:id` อย่างเดียว **เก็บ**; `role-access.spec.ts` แก้บรรทัดที่อ้าง `/insurance/exchange-requests` เป็น `/after-sales`) · สร้าง `apps/web/e2e/after-sales-hub.spec.ts` (spec ข้อ 13): login SALES → `/after-sales` → กรอก IMEI ของสัญญา seed (อ่านวิธี seed/ล็อกอินจาก spec ที่มีอยู่ เช่น `credit-payment-flow` / `insurance-repair-ticket`) → "แจ้งปัญหาเครื่อง" → อาการ + แนบรูป 1 (`page.setInputFiles`) + ทางออกซ่อม → "บันทึกและเปิดเคส" → หน้าเคส stage รับเรื่องแล้ว → "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)" ค่าซ่อม 500 ผู้จ่ายลูกค้า → "ส่งมอบคืนลูกค้า" → เห็น "ปิดเคส" + ลิงก์เอกสารรายได้อื่น `OI-`
- Test: `apps/web/src/config/__tests__/route-reachability.test.ts` ต้องเขียวโดยไม่เพิ่ม `KNOWN_GAPS_*`

**Routes หลังแก้ (`App.tsx`):**
```tsx
<Route path="/insurance" element={<Navigate to="/after-sales" replace />} />
<Route path="/insurance/new" element={<Navigate to="/after-sales/new" replace />} />
<Route path="/insurance/warranty-check" element={<Navigate to="/after-sales?check=1" replace />} />
<Route path="/insurance/exchange-request/new" element={<Navigate to="/after-sales/new" replace />} />
<Route path="/insurance/exchange-requests" element={<Navigate to="/after-sales?tab=AWAITING_APPROVAL" replace />} />
<Route path="/defect-exchange" element={<Navigate to="/after-sales" replace />} />
<Route path="/insurance/:id" element={<ProtectedRoute roles={[...5 role]}><TicketRedirect fallback={<RepairTicketDetailPage />} /></ProtectedRoute>} />
```
+ ลบ import ของหน้าที่ถูกลบ + แก้คอมเมนต์ผิดที่ `App.tsx:709` (ข้อ 12.6) · `AfterSalesPage` อ่าน `?tab=` จาก URL ตอนเปิด (ถ้ายังไม่รองรับ)
**เมนู:** ลบ entry `คำขอเปลี่ยนเครื่อง` (`/insurance/exchange-requests`) 4 ที่ (menu.ts บรรทัด ~184, 245, 369, 698) — ต้องลบ **พร้อม** route ProtectedRoute ของมัน (ข้างบนเป็น Navigate ไม่มี roles จึงไม่ต้องมีเมนู)

- [ ] **Step 1: ลบ + แก้ route/เมนู** · `grep -rn "InsurancePage\|DefectExchangePage\|CreateInsuranceWizardPage\|ExchangeRequestForm\|ExchangeRequestsPage\|WarrantyCheckTab\|WizardSteps\|WarrantyWindowCard" apps/web/src` ต้องเหลือ 0 (ยกเว้น `RepairTicketDetailPage`/`WarrantyBadge`) · `npx tsc --noEmit` · `npx vitest run src/config src/pages/after-sales src/pages/AfterSales*.test.tsx`
- [ ] **Step 2: E2E** — ลบ/แก้ตามรายการ · เขียน `after-sales-hub.spec.ts` · รันในเครื่องถ้ามีสูตร (`apps/web/e2e` README / `scripts/test-e2e.sh`) ไม่งั้นระบุในรายงานว่าให้ CI (E2E Tests 1–4) เป็นผู้ยืนยัน และ **ห้าม** ทิ้ง spec ที่รู้ว่าจะแดง
- [ ] **Step 3: Commit** — `git commit -m "refactor(web): ถอดหน้า /insurance เก่าและ /defect-exchange เป็น redirect + ลบ wizard ที่ไม่ได้ใช้ + E2E เส้นทางหลังการขาย"`

---

### Task 14: bump version · ตรวจทั้งชุด · ดูหน้าจริง · เปิด PR

**Files:** `apps/web/package.json` (`version` → ลำดับถัดไปของเดือน — ดูค่าปัจจุบัน) · `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` (บรรทัดสถานะ → "PR 2 implemented on branch …")

- [ ] **Step 1: API** — `cd apps/api && npx jest src/modules/after-sales src/modules/repair-tickets src/modules/defect-exchange src/modules/contract-exchange --runInBand` PASS · integration ทั้ง 2 ไฟล์บนฐานทดสอบทิ้ง PASS · `npx tsc --noEmit -p tsconfig.json` · `npx nest build`
- [ ] **Step 2: เว็บ** — `cd apps/web && npx vitest run` (ทั้งชุด — มีไฟล์ถูกลบ) PASS · `npx tsc --noEmit` · `npx eslint src/pages/after-sales src/pages/AfterSales*.tsx src/App.tsx src/config/menu.ts` 0 error
- [ ] **Step 3: ดูหน้าจริง** (สูตร PR 1 Task 12: mock API พอร์ต 3002 + Vite 5177 + Chrome headless 9338 โปรไฟล์แยก — ห้ามแตะ 5173/3001/9222 · **ยืนยัน `location.pathname` + breadcrumb ด้วย DOM assertion ก่อนถ่ายทุกภาพ** (บทเรียน PR 1 Task 12 fix round)) — ภาพ: แท็บรออนุมัติ (OWNER) · หน้าเคส SAME_MODEL รอ ผจก. (BM และ SALES) · หน้าเคส PRICED ESCALATE (BM) · แจ้งปัญหาขั้น 3 ทางออกเปลี่ยนรุ่นเดิม + picker · ทั้งจอสว่าง/มืด + มือถือ 390 หน้าเคส · เช็ค: ไม่มีคำ "รับเครื่อง" (ยกเว้น "ลูกค้ารับเครื่องไป"), ปุ่มเขียวหน้าละปุ่มเดียว, ป้ายเหลือง/แดงอ่านออกในจอมืด, ไม่มี scroll แนวนอนที่ 390 · ปิดทุก process ด้วย PID ที่ spawn เอง
- [ ] **Step 4: bump + spec + commit** — `git commit -m "chore(web): bump version 26.9.<n> — after-sales PR 2"`
- [ ] **Step 5: เปิด PR (ยังไม่ merge — เจ้าของสั่งเอง)** — `git push -u origin <branch>` + `gh pr create --base main --title "feat(after-sales): หลังการขาย PR 2 — เปลี่ยนเครื่องในเคส แท็บรออนุมัติ ซ่อมที่ร้าน ถอดหน้าเก่า"` body สรุป: migration `20261009000000_after_sales_exchange_link` (FK + backfill คำขอเดิม 1 แถว prod) · route ใหม่ 9 เส้น · endpoint เก่าของ `insurance/exchange-requests`/`defect-exchange` ยังอยู่ (LIFF/สคริปต์) · หน้าเก่าเป็น redirect · ไฟล์ที่ลบ · ข้อจำกัด: CASH_SAME_MODEL ยังปิด (ผู้สอบ) · LINE = PR 3 · PDF = PR 4 · ปิดท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## Self-review (ทำแล้ว 2026-09-24)

- **Spec coverage (PR 2 = ข้อ 14 แถว 2):** เปลี่ยนรุ่นเดิม (ผ่อน) ผ่านเคส 4.3/4.4 → T4 (ยื่น) + T5 (ยืนยัน/ส่งมอบ/ปฏิเสธ/ซ่อมไม่ได้→เปลี่ยน) · เปลี่ยนแบบมีราคา 4.3/4.4 → T4 (ยื่น+compensation) + T6 (อนุมัติ/ปฏิเสธ/ยกเลิก/preview) · แท็บรออนุมัติ 4.5 → T7 (ข้อมูล) + T12 (ตาราง+ป้ายผู้อนุมัติ) · stage ตารางข้อ 5 ทุกแถว → T2 · สิทธิ์ ข้อ 7 → T5/T6/T8 (service+controller) + T11/T12 (ปุ่ม) · API ข้อ 6 (`exchange/confirm`, `exchange/deliver`, `approve`, `reject`, `cancel-swap`) → T8 (เพิ่ม `switch-to-repair`, `exchange/reject`, `exchange/preview`, `replacement-products` ที่สเปกไม่ได้ระบุแต่ mockup/ฟอร์มเดิมต้องใช้) · backfill คำขอเดิม ข้อ 5 → T1 · เส้นทางเก่า ข้อ 11 → T13 · บั๊กข้อ 12: 12.1/12.2/12.3 หายไปพร้อมหน้าเก่า (ป้ายผู้อนุมัติต่อแถวใน T12 · ฟอร์มฝังใน T10) · 12.4 `conditionPhotos` = รูปอยู่ที่เคส (คำขอไม่เก็บรูป — T4 ไม่ส่งฟิลด์นี้) · 12.5/12.6 ลบไฟล์ใน T13 · 12.7 → PR 3 · ซ่อมที่ร้าน (R21) → T3 + T11 · R25 (a)(d) → T7/T2, (b)(c)(e) → T9, (g) → T8 เคส 8 · เทสต์ ข้อ 13 (E2E 1 เส้น) → T13 · ไม่อยู่ใน PR 2 โดยตั้งใจ: LINE (PR 3), PDF ใบรับฝาก/ใบส่งมอบ (PR 4), CASH_SAME_MODEL (PR 5), ลบ `RepairTicketDetailPage`/endpoint เก่า (≥2 deploy ตามสเปก 11)
- **Review Focus → เทสต์:** 1 → T5 (e) + T8 เคส 3 + T11 (k) · 2 → T5 (c) · 3 → T4 (d) + T8 เคส 6 · 4 → T5 (f) + T8 เคส 5 + T11 (l) · 5 → T2 reconcile (a) + T8 เคส 7
- **Type consistency:** `StageInput.exchange` (T2) ← select `exchangeRequest` ใน T2/T7 ชื่อฟิลด์ตรง (`status, mode, memoAppliedAt, newContract.status`) · `CaseRow.exchange` (T7 API) = (T9 web) ฟิลด์ตรงกัน (`kind, mode, approvalTier, requestStatus, buybackPrice, ncvSnapshot, approverRole, oldProduct, newProduct, replacementContract, requestedBy`) · DTO ชื่อฟิลด์ multipart (T4) = FormData (T10) (`replacementProductId, buybackPrice, deviceCondition, newTotalMonths, newInterestRate, conditionNote`) · path ใน T8 = ที่ T10–T12 เรียก · `ExchangeConfirmDto.replacementProductId` ใช้เฉพาะเคส REPAIR (T5 ↔ T11 (p))
- **ที่ผู้ทำต้องเปิดดูเองก่อนเขียน (ไฟล์มีอยู่แล้ว ไม่ใช่ placeholder):** รูป return ของ `DefectExchangeService.execute` (~บรรทัด 390–400) · ข้อความ `reasons` ของ `checkEligibility` (T4 regex) · guard ของ `ContractExchangeService.submit` ที่ seed ให้ล้มได้ง่ายสุด (T8 เคส 6) · วิธี cleanup สัญญา+JE ใน `exchange-priced-flow.integration.spec.ts` (T8) · สูตร login/seed ของ E2E เดิม (T13)
- **Rulings ที่ฝังในแผน (เจ้าของยังไม่ได้เห็น — รายงานตอน handoff):** P1 PRICED ใช้ compensation (เคสก่อน คำขอตาม ล้ม = ยกเลิกเคส) แทน tx เดียว เพราะไม่แตะ engine · P2 เครื่องทดแทนของเปลี่ยนรุ่นเดิม **ไม่ถูกจอง** ระหว่างรอ ผจก. (engine จองตอน execute) — ถ้าถูกขายไปก่อน ผจก. ได้ 400 ให้เลือกใหม่ · P3 ส่งมอบเครื่องใหม่ต้องเปิดใช้สัญญาใหม่ก่อน · P4 ซ่อมที่ร้าน + ร้านจ่าย = ไม่มีเอกสารรายจ่ายอัตโนมัติ (ไม่มี vendor) บันทึกเป็นหมายเหตุ · P5 ปฏิเสธเปลี่ยนรุ่นเดิม = เคสยกเลิก (ค่าเริ่มต้นสเปก ไม่กลับไป RECEIVED) แต่มีปุ่ม "เปลี่ยนเป็นซ่อมแทน" ให้ก่อนปฏิเสธ · P6 MEMO/PRICED ทั้งคู่เป็น outcome `PRICED_EXCHANGE` (สเปกข้อ 5) · P7 `originAfterSalesCaseId` เพิ่มใน DTO ของ defect-exchange (ไม่ใช่บัญชี) · P8 FM/ACCOUNTANT เห็นแท็บรออนุมัติแบบอ่านอย่างเดียว
