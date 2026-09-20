# ใบรับเครื่องคืน (Device-Return Intake) Implementation Plan — Phase 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มประเภทลูกหนี้-หน้าร้าน `DEVICE_RETURN` (11-2107 ↔ S21-1104) ให้ครบทุกเลนส์/กระทบยอด, เป็นแถวหักประเภทที่ 3 ในรอบจ่าย INTER-CO, มีทางรับเงินสดสำรอง และมีด่านกันใบรับโอนจากหน้าร้านล้างซ้ำ — พร้อม integration tests บน DB จริง (spec §6.2–§6.5, §11 ข้อ 1)

**Architecture:** Phase 1 แตะเฉพาะชั้น "เลนส์/รอบจ่าย" ของโมดูล `interco-settlement` + util ประเภทลูกหนี้ใน `journal` + ด่านใน `ShopCollectSettlementTemplate` — **ไม่มี producer จริง** (JP5 ที่ stamp DEVICE_RETURN มาใน Phase 2) จึงพิสูจน์ด้วย JE สังเคราะห์ที่ shape ตรง producer ผ่าน `JournalAutoService.createAndPost`. สถาปัตยกรรม "เลนส์ gross + item gate" เดิมคงไว้ทุกประการ: batch JE ไม่ stamp `contractId`/`shopReceivableType`, "หักแล้วเท่าไร" อ่านจาก `InterCoSettlementItem` (คอลัมน์ใหม่ `deviceReturnAmount`), แถว `DEVICE_RETURN` เป็น mirror ของแถว `RECALL` ทุกจุด. ลำดับงานบังคับ: ประเภท+เลนส์ (Tasks 2–5) ต้องเสร็จก่อนรอบจ่าย (Tasks 7–9) เพราะ drift guard/กระทบยอดอ่านเลนส์.

**Tech Stack:** NestJS 11 + Prisma 6.19 (PostgreSQL 16/pgvector) + jest (unit, mocked PrismaService) + vitest (DB-backed `*.integration.spec.ts` + specs ใต้ `cpa-templates/`) · ไม่มีงาน frontend ใน Phase นี้

## Global Constraints

- ห้าม `git commit` / `git push` / เปิด PR ในทุกขั้น — คำสั่งเจ้าของ 2026-09-05 (ยังไม่ได้อนุญาต); ทุก task จบด้วย Checkpoint (type-check + tests) แทน commit
- โค้ดยึดคืน/INTER-CO ต้องอ่านจาก `origin/main` (worktree `D:/BESTCHOICE APP/BESTCHOICE-device-return` สร้างจาก origin/main) — ห้าม implement บน branch `feat/stock-go-live-2026-09`
- ข้อความ error/UI เป็นภาษาไทย; เงินใช้ `Prisma.Decimal` (`@db.Decimal(12, 2)`) ห้าม Number(); soft delete เท่านั้น; ทุก controller `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles` ทุก method; route รูป `/:id` บังคับขอบเขตสาขาใน service (BranchGuard ไม่ครอบ)
- AuditLog: action เป็น String; เขียนหลัง `$transaction` commit ผ่าน `AuditService.log` (pattern `pendingAudit`) ยกเว้นที่ต้อง atomic ใช้ `tx.auditLog.create` (แถวนั้นหลุด Merkle chain — ระบุเหตุผลในคอมเมนต์)
- JE ทุกใบ idempotent ด้วย `metadata.flow + idempotencyKey` (DB partial unique index); JE ที่แตะ 11-2107/S21-1104 ต้อง stamp `metadata.shopReceivableType` + `metadata.contractId`
- Unit tests = jest `*.spec.ts` (mock PrismaService; run `npm --prefix apps/api test -- <path>`); DB-backed tests = vitest `*.integration.spec.ts` under `__tests__/` (pattern: `apps/api/src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts` — real PrismaClient, seeds CoA via `seedFinanceCoa`/`seedShopCoa`; run `cd apps/api && npx vitest run --no-file-parallelism <file>` with local Postgres per `.env`); new `__tests__/` directories MUST be added to the vitest globs in `.github/workflows/deploy-gcp.yml` (step "Run DB-backed money-invariant specs", lines ~259-290 on origin/main — globs do not recurse)
- Type check: `./tools/check-types.sh api` / `./tools/check-types.sh web` must be 0 errors at every checkpoint
- Prettier: semi, singleQuote, printWidth 100, tabWidth 2; camelCase/PascalCase; kebab-case files
- Migrations: additive only, descriptive names, timestamp later than `20261002100000_customer_journey`; partial unique index = raw SQL in migration (Prisma cannot express it)
- Frontend: React Query for data, `api` from `@/lib/api`, shadcn/ui + tokens only (no hardcoded colors), `toast` from sonner, Thai text with `leading-snug`

---

## อ่านก่อนเริ่ม (สำหรับวิศวกรที่ยังไม่รู้จัก codebase)

- **Spec:** `docs/superpowers/specs/2026-09-20-device-return-intake-design.md` §6.2–§6.5 (Phase นี้), §11 (ลำดับ)
- **กติกาบัญชี:** `.claude/rules/accounting.md` หัวข้อ "Inter-Co Settlement Batch", "หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน (Phase 2)", "ยกเลิกสัญญา (Flow C — Phase 3)", "การกระทบยอดระหว่างกิจการ (Phase 4)", "ยึดเครื่อง — ราคาเดียว"
- **เลขบรรทัดทุกตัวในแผนนี้ = origin/main (commit `9a30e6609d`)** — worktree ที่ Task 0 สร้างคือสำเนาของ origin/main จึงเปิดไฟล์ในนั้นแล้วเลขตรงกัน. ห้ามอ่านโค้ดจาก branch `feat/stock-go-live-2026-09` (ตามหลัง main 369 commits)
- **ไฟล์ต้นแบบที่ต้องเปิดคู่กันเสมอ** (ทุก task อ้างถึง):
  - แถวหักเดิม (`RECALL`) ที่ `DEVICE_RETURN` เลียนแบบทุกจุด: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts` (1728 บรรทัด) + `interco-pending.service.ts` (548) + `interco-typed-balance.ts` (165) + `interco-aging.service.ts` (938)
  - Integration harness ต้นแบบ: `apps/api/src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts` (2451 — real PrismaClient ไม่ใช้ Nest DI, seed CoA, cleanup แบบ scoped)
  - Unit spec ต้นแบบ (jest, mock PrismaService): `interco-pending.service.spec.ts`, `interco-settlement.service.spec.ts`, `interco-settlement.controller.spec.ts`
  - Unit spec ต้นแบบของ template (vitest — jest **ignore** ทุก `cpa-templates/*.spec.ts` ยกเว้น contract-cancellation ตาม `apps/api/package.json` `testPathIgnorePatterns`): `apps/api/src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts`
- **วิธีรันเทส (ทุกคำสั่งรันจาก root ของ worktree):**
  - jest unit: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-pending.service.spec.ts`
  - vitest DB-backed: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
  - vitest template spec: `cd apps/api && npx vitest run src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts && cd ../..`
  - type-check: `./tools/check-types.sh api`
- **หลัก 3 ข้อของสถาปัตยกรรมที่ห้ามละเมิด** (จาก accounting.md): (1) batch JE ห้าม stamp top-level `contractId`/`shopReceivableType` — ไม่งั้นรั่วเข้าเลนส์ typed; (2) "หักแล้ว" อ่านจาก `InterCoSettlementItem` ใน batch `POSTED` เท่านั้น (REVERSED = คืนเอง); (3) เงื่อนไข SQL ของประเภทลูกหนี้ต้องตรง `classifyShopReceivable` ทุกตัวอักษร — Task 3 เปลี่ยน IN-list ทุกจุดให้สร้างจากค่าคงที่เดียว
- **กติกาที่ตัดสินแล้ว (spec §6.3 ฉบับปรับ 2026-09-20 — สูตร NET ต่างกันตามประเภทแถว):** คิว recall คง **หักทุกประเภท** (`recallGl = typed PAYOUT_RECALL gross − Σ(swapCreditAmount + recallAmount + deviceReturnAmount)`) เพราะ gross ของ redirect C-2 นับเครดิตสวอปที่เคยหักไปแล้วซ้ำ; ส่วน **คิวค่าเครื่องคืนหักเฉพาะประเภทเดียวกัน** (`deviceReturnGl = typed DEVICE_RETURN gross − Σ deviceReturnAmount ของ item ใน batch POSTED ของสัญญานั้น`) เพราะค่าเครื่องคืนเป็นหนี้ก้อนใหม่ ไม่เกี่ยวกับเครดิตสวอปเดิม — สัญญา swap ที่ถูกหักเครดิต 8,000 แล้วภายหลังถูกยึด (7,000) จึงอยู่ในคิวที่ 7,000 (สูตร all-types จะได้ −1,000 = หลุดทุกเส้นทาง). ใช้สูตรนี้ 3 จุด: `getPendingDeviceReturns` (Task 4 — export `postedDeductionsByContract(client, contractIds, columns)` + ค่าคงที่คอลัมน์ใน `interco-typed-balance.ts` — Phase 2 import จากที่เดียวกัน), drift guard แถว DEVICE_RETURN ใน `approveBatch` (Task 8 — `priorPostedDeviceReturnDeductions`), cap ของ `settleDeductionCash(…, 'DEVICE_RETURN')` (Task 9 — สืบทอดจากคิว). **ไม่เปลี่ยน**: `alarmNettingResiduals` และ `intercoNet` ของรายงานอายุยังเป็นสูตร combined ระดับสัญญา (typed 3 ประเภท − Σ deduction ทุกประเภท) ซึ่งให้ 8,000 + 7,000 − 8,000 = 7,000 ถูกต้องอยู่แล้ว; ด่าน untyped (ii) ของ `ShopCollectSettlementTemplate` ก็เป็นระดับสัญญาอยู่แล้ว (15,000 − 8,000 = 7,000). Phase 2 `findAll.deviceReturnOutstanding` ต้องใช้สูตร same-type ตัวเดียวกัน. เทสที่ปัก: Task 4 (ง) (synthetic), Task 8 + Task 9 (flow จริง swap → หัก 8,000 → ยึด → หัก/รับเงินสด 7,000)
- **ข้อจำกัดที่เหลือ (ตั้งใจ ไม่แก้ในเฟสนี้):** สัญญาที่ยังมีแถวจ่ายเจ้าหนี้ค้าง (SETTLEMENT — ยึดก่อนเคยถูกจ่ายผ่านรอบจ่าย) **อยู่รอบเดียวกับแถวค่าเครื่องคืนของตัวเองไม่ได้** เพราะ `@@unique([batchId, contractId])` ของ `InterCoSettlementItem` — `buildSnapshot` ปฏิเสธด้วยข้อความไทยที่ชี้ทางออกจริง (จ่ายเจ้าหนี้รอบนี้ก่อนแล้วหักในรอบถัดไป หรือใช้ปุ่มรับเงินสดค่าเครื่องคืน — Task 7/9)

### สัญญา interface ที่ Phase 2/3 พึ่งพา (ผลิตโดยแผนนี้ — ชื่อห้ามเปลี่ยน)

| ที่ | ชื่อ/ลายเซ็น |
|---|---|
| Prisma | `enum InterCoItemType { SETTLEMENT RECALL DEVICE_RETURN }` · `InterCoSettlementItem.deviceReturnAmount Decimal @default(0) @map("device_return_amount") @db.Decimal(12, 2)` |
| `journal/shop-receivable-type.util.ts` | `export const SHOP_RECEIVABLE_TYPES = ['SWAP_CREDIT','PAYOUT_RECALL','SHOP_COLLECT','DEVICE_RETURN'] as const` · `export type ShopReceivableType = (typeof SHOP_RECEIVABLE_TYPES)[number] \| 'UNKNOWN'` |
| `interco-settlement/interco-typed-balance.ts` | `deviceReturnFinanceBalance(client, contractId): Promise<Prisma.Decimal>` (11-2107 Σ Dr−Cr, explicit stamp) · `deviceReturnShopBalance(client, contractId): Promise<Prisma.Decimal>` (S21-1104 Σ Cr−Dr, key `metadata.contractId`) |
| `interco-pending.service.ts` | `export interface DeviceReturnCandidate { contractId; contractNumber; customerName; deviceReturnGl: Prisma.Decimal; shopDeviceReturnGl: Prisma.Decimal }` · `getPendingDeviceReturns(tx?: Prisma.TransactionClient): Promise<DeviceReturnCandidate[]>` · `ReconcileTotals.glDeviceReturnTotal: Prisma.Decimal` |
| `interco-settlement.service.ts` | `export type DeductionCashType = 'PAYOUT_RECALL' \| 'DEVICE_RETURN'` · `settleDeductionCash(contractId: string, type: DeductionCashType, dto: SettleRecallCashDto, userId: string)` · `settleRecallCash(...)` = wrapper · `export const DEVICE_RETURN_CASH_SHOP_FLOW = 'interco-device-return-cash-shop'` |
| `dto/create-batch.dto.ts` | `CreateBatchDto.deviceReturnContractIds?: string[]` |
| controller | `POST /interco-settlement/device-returns/:contractId/settle-cash` (`@Roles('OWNER','FINANCE_MANAGER')`) · `GET /interco-settlement/pending` → `{ pending, recalls, deviceReturns, reconcile }` |
| `interco-aging.service.ts` | `ShopReceivableAgingRow.deviceReturnGross` · `ShopReceivableAgingRow.shopMirrorDeviceReturnGross` · `intercoNet` รวม `deviceReturnGross` |
| `cpa-templates/shop-collect-settlement.template.ts` | `typeStamp?: 'SHOP_COLLECT' \| 'PAYOUT_RECALL' \| 'DEVICE_RETURN'` + ด่าน §6.4 |
| AuditLog action ใหม่ | `INTERCO_DEVICE_RETURN_CASH_SETTLED` (entity `contract`) |

---

### Task 0: สร้าง worktree จาก origin/main + ติดตั้ง + Prisma + DB + baseline

**Files:**
- Create (worktree): `D:/BESTCHOICE APP/BESTCHOICE-device-return` (branch `feat/device-return-intake` จาก `origin/main`)
- Copy เข้า worktree: `docs/superpowers/specs/2026-09-20-device-return-intake-design.md`, `docs/superpowers/plans/2026-09-20-device-return-phase1-interco-type.md`, `docs/superpowers/plans/2026-09-20-device-return-phase2-*.md`, `docs/superpowers/plans/2026-09-20-device-return-phase3-*.md`, `apps/api/.env` (gitignored — มีอยู่ใน main tree ตั้งแต่ 2026-06-23)

**Interfaces:**
- Produces: worktree ที่ `npm install` แล้ว, Prisma client 2 ตัว generate แล้ว, DB local migrate ถึง origin/main, `./tools/check-types.sh api` = 0 errors — ทุก task ถัดไปรันคำสั่ง**ในโฟลเดอร์ worktree นี้เท่านั้น**

- [ ] **Step 1: สร้าง worktree** (รันจาก main tree — คำสั่งเดียวที่รันนอก worktree)

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE" && git fetch origin main && git worktree add "D:/BESTCHOICE APP/BESTCHOICE-device-return" -b feat/device-return-intake origin/main
```

Expected: `Preparing worktree (new branch 'feat/device-return-intake')` … `HEAD is now at 9a30e6609 …`. ถ้า branch มีอยู่แล้ว (รันซ้ำ): `git worktree add "D:/BESTCHOICE APP/BESTCHOICE-device-return" feat/device-return-intake` แทน (ห้าม reset branch — เจ้าของรันหลาย session บน tree เดียวกัน)

- [ ] **Step 2: คัดลอก spec/แผน/.env เข้า worktree** (ไฟล์เหล่านี้ยังไม่อยู่บน origin/main)

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE" && W="D:/BESTCHOICE APP/BESTCHOICE-device-return" && mkdir -p "$W/docs/superpowers/specs" "$W/docs/superpowers/plans" && cp docs/superpowers/specs/2026-09-20-device-return-intake-design.md "$W/docs/superpowers/specs/" && cp docs/superpowers/plans/2026-09-20-device-return-phase1-*.md docs/superpowers/plans/2026-09-20-device-return-phase2-*.md docs/superpowers/plans/2026-09-20-device-return-phase3-*.md "$W/docs/superpowers/plans/" && cp apps/api/.env "$W/apps/api/.env" && ls "$W/docs/superpowers/plans/" "$W/apps/api/.env"
```

Expected: แสดงชื่อแผน 3 ไฟล์ + `.env`. ถ้า `apps/api/.env` ไม่มีใน main tree ให้สร้างจาก `.env.example` ที่ root แล้วใส่อย่างน้อย `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/installment_db?schema=public"`, `DATABASE_URL_FINANCE="postgresql://postgres:postgres@localhost:5433/installment_finance_db?schema=public"`, `JWT_SECRET=dev-secret`

- [ ] **Step 3: ติดตั้ง dependencies + generate Prisma client ทั้งสองตัว** (monorepo workspaces — ต้องรันที่ root ของ worktree; Prisma มี 2 schema)

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && npm install && cd apps/api && npx prisma generate && npx prisma generate --schema=prisma-finance/schema.prisma && cd ../..
```

Expected: `npm install` จบโดยไม่มี ERR (warnings ได้), `✔ Generated Prisma Client` 2 ครั้ง

- [ ] **Step 4: Postgres + migrate** — ใช้ compose project **ชื่อเดียวกับ main tree** (`bestchoice`) เพื่อไม่สร้าง container ชุดที่สองที่จะชนพอร์ต 5432/5433/6379 (image ต้องเป็น `pgvector/pgvector:pg16` ตาม `docker-compose.yml` บน origin/main — มี migration `CREATE EXTENSION vector`)

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && docker compose -p bestchoice up -d && docker compose -p bestchoice ps && cd apps/api && npx prisma migrate deploy && npx prisma migrate deploy --schema=prisma-finance/schema.prisma && cd ../..
```

Expected: `postgres`, `postgres-finance`, `redis` เป็น `running`; `migrate deploy` พิมพ์ `All migrations have been successfully applied.` (หรือรายการ migration ที่เพิ่ง apply — DB local ตามหลัง origin/main อยู่ จึงมีหลายใบ). **ถ้า migrate deploy ล้มเพราะ schema drift** ให้ใช้ `npx prisma migrate reset --force` แทน — Prisma บล็อกคำสั่งนี้เมื่อรันผ่าน Claude Code ต้องได้ "yes" จากผู้ใช้สด ๆ แล้วส่งผ่าน env `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<ข้อความยินยอม>` (memory `project_local_dev_setup.md`); reset ล้าง DB local ทั้งหมด (มีแต่ข้อมูลทดสอบ CANCELTEST-* / JE flow `test-*`)

- [ ] **Step 5: Checkpoint baseline** — type-check + เทสต์เดิมของโมดูลต้องเขียวก่อนเริ่มแก้ (ถ้าแดงตรงนี้ = สภาพแวดล้อม ไม่ใช่งานเรา)

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return" && ./tools/check-types.sh api && npm --prefix apps/api test -- src/modules/interco-settlement && cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts && cd ../..
```

Expected: `API: OK` + `TypeScript check passed!`; jest: `Tests: … passed` (6 suites ของโมดูล: pending / settlement service / controller / batch-number / 2 cron specs); vitest netting: ทุก test ผ่าน (ใช้เวลาหลายนาที — เทส race ใช้ 2 connections). **Do NOT commit.**

---

### Task 1: Prisma — `InterCoItemType.DEVICE_RETURN` + `InterCoSettlementItem.deviceReturnAmount` + migration + โครง integration spec

**Files:**
- Modify: `apps/api/prisma/schema.prisma:4591-4597` (enum), `:4619-4620` (doc `totalDeduction`), `:4681-4682` (ต่อท้าย `recallAmount`)
- Create: `apps/api/prisma/migrations/20261003000000_interco_device_return_type/migration.sql`
- Create (test): `apps/api/src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts` (โครง harness — task ถัดไปเติม `describe` ต่อท้าย)

**Interfaces:**
- Produces: `InterCoItemType = 'SETTLEMENT' | 'RECALL' | 'DEVICE_RETURN'`; `InterCoSettlementItem.deviceReturnAmount: Prisma.Decimal` (default 0) — ทุก task ถัดไปอ่าน/เขียนคอลัมน์นี้

- [ ] **Step 1: เขียนเทสที่ล้มก่อน** — สร้างไฟล์ integration spec (ต้นแบบ: `interco-netting.integration.spec.ts` บรรทัด 1-136 harness, 143-195 `seedBaseContract`, 197-212 `seed1a`, 318-331 `seedShopLegs`, 487-556 helpers, 620-670 cleanup). ไฟล์นี้ import ทุกอย่างที่ task ถัดไปใช้ไว้ล่วงหน้า (tsconfig ไม่มี `noUnusedLocals` — ไม่ error)

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ContractStatus, InterCoBatchStatus, Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';

// Partial mock — residual-alarm assertions (Task 8) อ่าน Sentry.captureMessage; ที่เหลือของ
// @sentry/nestjs เป็นของจริง (ไม่มี DSN = no-op) — shape เดียวกับ interco-netting spec
vi.mock('@sentry/nestjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nestjs')>();
  return { ...actual, captureMessage: vi.fn(), captureException: vi.fn() };
});
import { randomUUID } from 'crypto';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { PairedJournalService } from '../../journal/paired-journal.service';
import { glContractBalance } from '../../journal/gl-contract-balance';
import { IntercoPendingService } from '../interco-pending.service';
import { IntercoBatchNumberService } from '../interco-batch-number.service';
import { IntercoSettlementService } from '../interco-settlement.service';
import { IntercoAgingService } from '../interco-aging.service';

/**
 * ใบรับเครื่องคืน — ประเภทลูกหนี้ DEVICE_RETURN ครบทุกเลนส์ + แถวหักประเภทที่ 3 ในรอบจ่าย
 * INTER-CO + รับเงินสดสำรอง + ด่านใบรับโอน (spec 2026-09-20 §6.2–§6.5) บน DB จริง.
 *
 * Phase 1 ไม่มี producer จริง (JP5 ที่ stamp DEVICE_RETURN มาใน Phase 2 —
 * RepossessionsService.createInTx) จึง seed JE สังเคราะห์ผ่าน JournalAutoService.createAndPost
 * ด้วย metadata shape ตรง producer:
 *   - FINANCE JP5 (golden §6.5) → Dr 11-2107 [DEVICE_RETURN] 7,000 + ขาอื่นของการยึด
 *   - SHOP intake (flow 'shop-repossession-intake') → Cr S21-1104 [DEVICE_RETURN] 7,000
 *   - สัญญาปกติ Y (1A + SHOP legs) → เจ้าหนี้ 10,000 + 1,000 ให้รอบจ่ายมีเงินให้หัก
 *
 * Harness conventions ตาม interco-netting.integration.spec.ts (real PrismaClient ไม่ใช้
 * Nest DI, seedFinanceCoa/seedShopCoa, cleanup แบบ scoped, JournalPostAuditLog ลบก่อน JE).
 * Fixture prefix DRTEST- สำหรับ cleanup; assertion ระดับบัญชีเป็น **delta** เสมอ (DB แชร์กับ
 * suite อื่น).
 */

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as never);
const pendingService = new IntercoPendingService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const pairedJournal = new PairedJournalService(journalAuto, prisma as never, companyResolver);
const batchNumberService = new IntercoBatchNumberService(prisma as never);
const agingService = new IntercoAgingService(prisma as never);
// uploadSlip (StorageService dep) unused by this suite — stub instead of real S3.
const storageStub = { upload: async () => undefined, delete: async () => undefined };
// Real template — Task 6 พิสูจน์ด่าน §6.4 ผ่านเส้นทาง production จริง และ Task 9 ใช้เป็น
// FINANCE leg ของ settleDeductionCash
const shopCollectTemplate = new ShopCollectSettlementTemplate(journalAuto, prisma as never);
const settlementService = new IntercoSettlementService(
  prisma as never,
  pendingService,
  batchNumberService,
  pairedJournal,
  companyResolver,
  journalAuto,
  storageStub as never,
  shopCollectTemplate,
);

// ---------------------------------------------------------------------------
// Tracked rows for SCOPED cleanup
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdBatchIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string;
let shopId: string;
let financeId: string;
let branchId: string;

// Unique-per-run suffix — leftovers ของ run ที่ crash (unique nationalId/imeiSerial/phone)
// ชนกับ run นี้ไม่ได้
const RUN = Date.now().toString(36);
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');

const dec = (s: string) => new Decimal(s);
const zero = dec('0');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Customer + product + contract — prefix DRTEST- for cleanup. `status` default ACTIVE;
 * สัญญาที่ "ยึดแล้ว" ส่ง 'CLOSED_BAD_DEBT' (เครื่อง REPOSSESSED / ย้ายไป SHOP / PHONE_USED
 * ตามที่ JP5 ทำจริง) — hydrate ของคิวค่าเครื่องคืนต้องไม่กรองสถานะนี้ออก
 */
async function seedBaseContract(seq: number, status: ContractStatus = 'ACTIVE'): Promise<string> {
  const tag = `${RUN}-${seq}`;
  const repossessed = status === 'CLOSED_BAD_DEBT';
  const customer = await prisma.customer.create({
    data: {
      name: `__DRTEST_${tag}__`,
      phone: `095${RUN_NUM}${seq}`,
      nationalId: `DRTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `Device Return Test ${tag}`,
      brand: 'DrTestBrand',
      model: `DrModel-${tag}`,
      storage: '128GB',
      imeiSerial: `DRTEST-${tag}`,
      category: repossessed ? 'PHONE_USED' : 'PHONE_NEW',
      costPrice: dec('6000.00'),
      installmentPrice: dec('12000.00'),
      branchId,
      status: repossessed ? 'REPOSSESSED' : 'SOLD_INSTALLMENT',
      ownedByCompanyId: repossessed ? shopId : financeId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `DRTEST-${tag}`,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'),
      downPayment: dec('2000.00'),
      financedAmount: dec('10000.00'),
      interestRate: dec('0.0500'),
      totalMonths: 12,
      interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'),
      vatAmount: dec('1190.00'),
      vatPct: dec('0.0700'),
      monthlyPayment: dec('1515.83'),
      status,
    },
  });
  createdContractIds.push(contract.id);
  return contract.id;
}

/** 1A synthetic — สัญญาเข้าคิวรอจ่าย (21-1101 10,000 / 21-1102 1,000). */
async function seed1a(id: string) {
  await journalAuto.createAndPost({
    description: '1A synthetic',
    companyId: financeId,
    metadata: { flow: 'test-1a', idempotencyKey: `t1a:${id}`, contractId: id, tag: '1A' },
    lines: [
      { accountCode: '11-2101', dr: dec('17000'), cr: zero },
      { accountCode: '11-2105', dr: dec('1190'), cr: zero },
      { accountCode: '21-1101', dr: zero, cr: dec('10000') },
      { accountCode: '21-1102', dr: zero, cr: dec('1000') },
      { accountCode: '11-2106', dr: zero, cr: dec('6000') },
      { accountCode: '21-2102', dr: zero, cr: dec('1190') },
    ],
  });
}

/** SHOP legs synthetic (S11-3001/S11-3002 receivable) — shape เดียวกับ interco-netting spec. */
async function seedShopLegs(id: string, financed: string, commission: string) {
  await journalAuto.createAndPost({
    description: 'SHOP legs synthetic',
    companyId: shopId,
    metadata: { flow: 'test-shop-legs', idempotencyKey: `tsl:${id}`, contractId: id },
    lines: [
      { accountCode: 'S11-3001', dr: dec(financed), cr: zero },
      { accountCode: 'S11-3002', dr: dec(commission), cr: zero },
      { accountCode: 'S41-1101', dr: zero, cr: dec(financed) },
      { accountCode: 'S41-1201', dr: zero, cr: dec(commission) },
    ],
  });
}

/** สัญญาขายปกติ Y: payable 10,000+1,000 + SHOP legs เท่ากัน — เงินของรอบจ่ายที่ค่าเครื่องคืนจะถูกหักออก */
async function seedNormalContract(id: string) {
  await seed1a(id);
  await seedShopLegs(id, '10000', '1000');
}

interface LineRow {
  accountCode: string;
  debit: { toString(): string };
  credit: { toString(): string };
}

/** Σ of one side for a given account code over JE lines. */
function sumSide(lines: LineRow[], code: string, side: 'dr' | 'cr'): Decimal {
  return lines
    .filter((l) => l.accountCode === code)
    .reduce(
      (s, l) => s.plus(side === 'dr' ? l.debit.toString() : l.credit.toString()),
      new Decimal(0),
    );
}

/** Whole-account Σ(Dr−Cr) — NO metadata filter (ขา Cr ของ batch นับปกติแม้เลนส์ typed ไม่เห็น). */
async function wholeAccountBalance(code: string): Promise<Decimal> {
  const rows = await prisma.$queryRaw<Array<{ balance: unknown }>>(Prisma.sql`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code = ${code}
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
  `);
  return new Decimal(String(rows[0]?.balance ?? 0));
}

/** Minimal batch row (ไม่มี JE) — สำหรับ settled-gate/clash fixtures. */
async function seedBatch(status: InterCoBatchStatus, seq: number) {
  const batch = await prisma.interCoSettlementBatch.create({
    data: {
      batchNumber: `IC-DRTEST-${RUN}-${seq}`,
      status,
      transferDate: new Date(),
      financeBankCode: '11-1201',
      shopBankCode: 'S11-1201',
      totalFinanced: dec('10000.00'),
      totalCommission: dec('1000.00'),
      totalAmount: dec('11000.00'),
      shopPostedAmount: dec('11000.00'),
      makerId: adminId,
    },
  });
  createdBatchIds.push(batch.id);
  return batch;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let normalId: string;
let schemaProbeId: string;

describe('ใบรับเครื่องคืน — DEVICE_RETURN ครบทุกเลนส์ + รอบจ่าย INTER-CO (real DB)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    shopId = shop.id;
    financeId = finance.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__device_return_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__device_return_test_branch__', companyId: shopId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }

    normalId = await seedBaseContract(1);
    await seedNormalContract(normalId);
    schemaProbeId = await seedBaseContract(99);
  }, 120_000);

  afterAll(async () => {
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      for (const key of ['contractId', 'newContractId']) {
        const rows = await prisma.journalEntry.findMany({
          where: { metadata: { path: [key], equals: cid } as never },
          select: { id: true },
        });
        rows.forEach((r) => jeIds.add(r.id));
      }
    }
    // Settlement + reversal JEs carry metadata.settlementBatchId (NOT contractId — architecture ruling)
    for (const bid of createdBatchIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['settlementBatchId'], equals: bid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    // JournalPostAuditLog FK-references journal_entries — clear first (a48fe1fe convention)
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.interCoSettlementItem.deleteMany({ where: { batchId: { in: createdBatchIds } } });
    await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: createdBatchIds } } });

    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    if (createdBranchId) {
      try {
        await prisma.branch.delete({ where: { id: createdBranchId } });
      } catch {
        // referenced by rows outside this spec's scope — leave it
      }
    }
    await prisma.$disconnect();
  }, 120_000);

  // ===========================================================================
  // Task 1 — schema
  // ===========================================================================
  it('schema: InterCoSettlementItem รับ itemType DEVICE_RETURN + deviceReturnAmount (migration 20261003000000)', async () => {
    // batch CANCELLED — ไม่เข้า settled gate / Σ deduction ของเลนส์ใด (ไม่รบกวนเทสถัดไป)
    const batch = await seedBatch('CANCELLED', 1);
    const item = await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch.id,
        contractId: schemaProbeId,
        itemType: 'DEVICE_RETURN',
        financedGl: zero,
        commissionGl: zero,
        shopFinancedGl: zero,
        shopCommissionGl: zero,
        deviceReturnAmount: dec('7000.00'),
      },
    });
    expect(item.itemType).toBe('DEVICE_RETURN');
    expect(item.deviceReturnAmount.toFixed(2)).toBe('7000.00');
    // คอลัมน์เดิม default 0 — ไม่ถูกแตะ
    expect(item.swapCreditAmount.toFixed(2)).toBe('0.00');
    expect(item.recallAmount.toFixed(2)).toBe('0.00');

    // แถวเดิมที่ไม่ส่ง deviceReturnAmount → default 0 (additive migration)
    const legacy = await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch.id,
        contractId: normalId,
        itemType: 'SETTLEMENT',
        financedGl: dec('10000.00'),
        commissionGl: dec('1000.00'),
        shopFinancedGl: dec('10000.00'),
        shopCommissionGl: dec('1000.00'),
      },
    });
    expect(legacy.deviceReturnAmount.toFixed(2)).toBe('0.00');
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — `PrismaClientValidationError: … Invalid value for argument \`itemType\`. Expected InterCoItemType.` (enum ยังไม่มีค่า) และ/หรือ `Unknown argument \`deviceReturnAmount\``

- [ ] **Step 3: แก้ schema + เขียน migration**

`apps/api/prisma/schema.prisma` — เดิม (L4591-4597):

```prisma
/// ประเภทแถวในรอบจ่าย (Phase 2 หักกลบ — workbook จุดที่ 3):
/// SETTLEMENT = สัญญาปกติ/สัญญา swap (จ่ายเจ้าหนี้ อาจมีหักเครดิตเปลี่ยนเครื่อง)
/// RECALL = สัญญายกเลิกหลังตัดจ่าย (Flow C-2) — หักเรียกคืนอย่างเดียว ไม่มีเจ้าหนี้
enum InterCoItemType {
  SETTLEMENT
  RECALL
}
```

ใหม่:

```prisma
/// ประเภทแถวในรอบจ่าย (Phase 2 หักกลบ — workbook จุดที่ 3):
/// SETTLEMENT = สัญญาปกติ/สัญญา swap (จ่ายเจ้าหนี้ อาจมีหักเครดิตเปลี่ยนเครื่อง)
/// RECALL = สัญญายกเลิกหลังตัดจ่าย (Flow C-2) — หักเรียกคืนอย่างเดียว ไม่มีเจ้าหนี้
/// DEVICE_RETURN = ใบรับเครื่องคืน (spec 2026-09-20 §6.3) — หักค่าเครื่องคืน (11-2107 DEVICE_RETURN ↔ S21-1104) อย่างเดียว ไม่มีเจ้าหนี้
enum InterCoItemType {
  SETTLEMENT
  RECALL
  DEVICE_RETURN
}
```

เดิม (L4619-4620):

```prisma
  /// Σ swapCreditAmount + recallAmount ของทุก item (Phase 2 หักกลบ)
  totalDeduction Decimal @default(0) @map("total_deduction") @db.Decimal(12, 2)
```

ใหม่:

```prisma
  /// Σ swapCreditAmount + recallAmount + deviceReturnAmount ของทุก item (Phase 2 หักกลบ + ใบรับเครื่องคืน 2026-09-20)
  totalDeduction Decimal @default(0) @map("total_deduction") @db.Decimal(12, 2)
```

เดิม (L4681-4682):

```prisma
  /// Snapshot ยอดเรียกคืนจากยกเลิก (11-2107 PAYOUT_RECALL) — ใช้เฉพาะแถว RECALL
  recallAmount Decimal @default(0) @map("recall_amount") @db.Decimal(12, 2)
```

ใหม่:

```prisma
  /// Snapshot ยอดเรียกคืนจากยกเลิก (11-2107 PAYOUT_RECALL) — ใช้เฉพาะแถว RECALL
  recallAmount Decimal @default(0) @map("recall_amount") @db.Decimal(12, 2)
  /// Snapshot ค่าเครื่องคืน (11-2107 DEVICE_RETURN = S21-1104 ของสัญญานี้) — ใช้เฉพาะแถว DEVICE_RETURN (ใบรับเครื่องคืน 2026-09-20 §6.3)
  deviceReturnAmount Decimal @default(0) @map("device_return_amount") @db.Decimal(12, 2)
```

สร้าง `apps/api/prisma/migrations/20261003000000_interco_device_return_type/migration.sql` (pattern: `20260997000000_interco_netting_columns` + idiom `ADD VALUE IF NOT EXISTS` ของ `20260986000000_online_order_unfulfillable`):

```sql
-- ใบรับเครื่องคืน (docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4.2, §6.3)
-- แถวหักประเภทที่ 3 ในรอบจ่าย INTER-CO — additive only, ไม่มี backfill
-- หมายเหตุ: ALTER TYPE ... ADD VALUE ถอยไม่ได้ (Postgres ไม่มี DROP VALUE) — precedent
-- 20260986000000_online_order_unfulfillable
ALTER TYPE "InterCoItemType" ADD VALUE IF NOT EXISTS 'DEVICE_RETURN';

ALTER TABLE "inter_co_settlement_items"
  ADD COLUMN IF NOT EXISTS "device_return_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
```

แล้ว apply + generate:

```bash
cd "D:/BESTCHOICE APP/BESTCHOICE-device-return/apps/api" && npx prisma migrate deploy && npx prisma generate && cd ../..
```

Expected: `Applying migration \`20261003000000_interco_device_return_type\`` … `✔ Generated Prisma Client`. ตรวจ: `npx prisma validate` → `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: PASS (1 test)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors (`API: OK`). **Do NOT commit.**

---

### Task 2: `SHOP_RECEIVABLE_TYPES` — แหล่งเดียวของประเภทลูกหนี้ 11-2107 (+ `DEVICE_RETURN` explicit-only)

**Files:**
- Modify: `apps/api/src/modules/journal/shop-receivable-type.util.ts:8-25` (ตาราง doc + union + `EXPLICIT`)
- Test: `apps/api/src/modules/journal/shop-receivable-type.util.spec.ts` (jest — มีอยู่แล้ว 34 บรรทัด)

**Interfaces:**
- Produces: `export const SHOP_RECEIVABLE_TYPES = ['SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT', 'DEVICE_RETURN'] as const;` · `export type ShopReceivableType = (typeof SHOP_RECEIVABLE_TYPES)[number] | 'UNKNOWN';` · `classifyShopReceivable({ shopReceivableType: 'DEVICE_RETURN' }) === 'DEVICE_RETURN'` · **ไม่มี** `FLOW_MAP` entry ใหม่ (spec §6.2 — แถวยึดเก่า flow `shop-repossession-intake` ที่ไม่มี stamp = โหมดโอนทันที ไม่แตะ S21-1104)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน** — ต่อท้าย `describe` ใน `shop-receivable-type.util.spec.ts` (ก่อน `});` ปิดท้าย บรรทัด 34) และแก้ import บรรทัด 1

เดิม (L1):

```ts
import { classifyShopReceivable } from './shop-receivable-type.util';
```

ใหม่:

```ts
import { SHOP_RECEIVABLE_TYPES, classifyShopReceivable } from './shop-receivable-type.util';
```

เพิ่มก่อน `});` สุดท้าย (หลังเทส `'ไม่รู้จัก = UNKNOWN (ห้ามเดา)'`):

```ts
  it('DEVICE_RETURN (ใบรับเครื่องคืน 2026-09-20 §6.2): explicit stamp เท่านั้น — ไม่มี flow fallback', () => {
    expect(classifyShopReceivable({ shopReceivableType: 'DEVICE_RETURN' })).toBe('DEVICE_RETURN');
    // explicit ชนะ marker เก่าของ JP5 (shopReceivable: '11-2107' เคยแปลว่า SHOP_COLLECT)
    expect(
      classifyShopReceivable({ shopReceivableType: 'DEVICE_RETURN', shopReceivable: '11-2107' }),
    ).toBe('DEVICE_RETURN');
    // แถวยึดเก่า flow shop-repossession-intake ที่ไม่มี stamp = โหมดโอนทันที (ไม่แตะ S21-1104)
    // ถ้าใส่ flow fallback จะถูกจัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง — ต้องเป็น UNKNOWN
    expect(classifyShopReceivable({ flow: 'shop-repossession-intake' })).toBe('UNKNOWN');
  });

  it('SHOP_RECEIVABLE_TYPES เป็นแหล่งเดียวของ EXPLICIT — ทุกค่าในลิสต์ classify เป็นตัวเอง', () => {
    expect([...SHOP_RECEIVABLE_TYPES]).toEqual([
      'SWAP_CREDIT',
      'PAYOUT_RECALL',
      'SHOP_COLLECT',
      'DEVICE_RETURN',
    ]);
    for (const type of SHOP_RECEIVABLE_TYPES) {
      expect(classifyShopReceivable({ shopReceivableType: type })).toBe(type);
    }
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/journal/shop-receivable-type.util.spec.ts`
Expected: FAIL — `TypeError: SHOP_RECEIVABLE_TYPES is not iterable` (export ยังไม่มี) และ `Expected: "DEVICE_RETURN" Received: "UNKNOWN"`

- [ ] **Step 3: แก้ util** — เดิม (L8-25):

```ts
 * | Type          | ความหมาย                                            | ล้างที่ |
 * |---------------|------------------------------------------------------|---------|
 * | SWAP_CREDIT   | เครดิตราคารับซื้อจากรับคืนเครื่อง (Flow B / A.3+A.4) | รอบจ่าย INTER-CO (Phase 2) หรือ shop-collect |
 * | PAYOUT_RECALL | เงินตัดจ่ายแล้วต้องเรียกคืน จากยกเลิกสัญญา (Flow C-2) | รอบจ่ายถัดไป หรือรับเงินสดคืน (Phase 3) |
 * | SHOP_COLLECT  | เงินลูกค้าที่หน้าร้านรับแทน (Flow D)                  | settleShopCollect — ไม่เข้ารอบจ่าย |
 *
 * SQL twins: เงื่อนไข explicit-stamp/FLOW_MAP ของ SWAP_CREDIT + PAYOUT_RECALL
 * ถูก reproduce เป็น raw SQL ใน `interco-settlement/interco-typed-balance.ts`,
 * เลนส์ `IntercoPendingService` และรายงานอายุ `IntercoAgingService` — แก้การ
 * classify ที่นี่ต้องแก้ทุกที่ (เฉพาะ SWAP_CREDIT ฝั่ง 11-2107 มี **4 จุด**).
 * NB: ฝั่ง S21-1104 SQL เป็น **stamp-only ไม่มี flow fallback** ทั้งที่ FLOW_MAP
 * map 'shop-exchange-return' → SWAP_CREDIT — แคบกว่า util ตัวนี้โดยตั้งใจ
 * (carry → Phase 5, ดู .claude/rules/accounting.md "ยังเปิดอยู่ → Phase 5")
 * (anti-drift net: interco-netting.integration.spec.ts).
 */
export type ShopReceivableType = 'SWAP_CREDIT' | 'PAYOUT_RECALL' | 'SHOP_COLLECT' | 'UNKNOWN';

const EXPLICIT: ReadonlySet<string> = new Set(['SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT']);
```

ใหม่:

```ts
 * | Type          | ความหมาย                                            | ล้างที่ |
 * |---------------|------------------------------------------------------|---------|
 * | SWAP_CREDIT   | เครดิตราคารับซื้อจากรับคืนเครื่อง (Flow B / A.3+A.4) | รอบจ่าย INTER-CO (Phase 2) หรือ shop-collect |
 * | PAYOUT_RECALL | เงินตัดจ่ายแล้วต้องเรียกคืน จากยกเลิกสัญญา (Flow C-2) | รอบจ่ายถัดไป หรือรับเงินสดคืน (Phase 3) |
 * | SHOP_COLLECT  | เงินลูกค้าที่หน้าร้านรับแทน (Flow D)                  | settleShopCollect — ไม่เข้ารอบจ่าย |
 * | DEVICE_RETURN | ค่าเครื่องคืนจากใบรับเครื่องคืน (JP5 ยืนยัน 2026-09-20 §6.3) | หักในรอบจ่าย INTER-CO หรือรับเงินสด (settleDeductionCash) — ห้ามล้างผ่านใบรับโอน (§6.4) |
 *
 * `SHOP_RECEIVABLE_TYPES` คือ**แหล่งเดียว**ของลิสต์ประเภท: `EXPLICIT` และ IN-list ใน raw SQL
 * ทุกตัว (`interco-typed-balance.ts`, `IntercoPendingService`, `IntercoAgingService`) สร้างจาก
 * ค่านี้ผ่าน `Prisma.join([...SHOP_RECEIVABLE_TYPES])` — เพิ่มประเภทที่นี่ที่เดียว carve-out
 * "stamp ที่รู้จักชนะ fallback" จะครอบประเภทใหม่ทุกจุดพร้อมกัน (spec 2026-09-20 §6.2).
 * DEVICE_RETURN เป็น explicit-stamp-only **โดยตั้งใจ ห้ามเพิ่ม FLOW_MAP**: แถวยึดเก่า flow
 * 'shop-repossession-intake' ที่ไม่มี stamp คือโหมดโอนทันที (Cr S11-1202 ไม่แตะ S21-1104) —
 * flow fallback จะทำให้ util จัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง.
 *
 * SQL twins: เงื่อนไข explicit-stamp/FLOW_MAP ของ SWAP_CREDIT + PAYOUT_RECALL
 * ถูก reproduce เป็น raw SQL ใน `interco-settlement/interco-typed-balance.ts`,
 * เลนส์ `IntercoPendingService` และรายงานอายุ `IntercoAgingService` — แก้การ
 * classify ที่นี่ต้องแก้ทุกที่ (เฉพาะ SWAP_CREDIT ฝั่ง 11-2107 มี **4 จุด**).
 * NB: ฝั่ง S21-1104 SQL เป็น **stamp-only ไม่มี flow fallback** ทั้งที่ FLOW_MAP
 * map 'shop-exchange-return' → SWAP_CREDIT — แคบกว่า util ตัวนี้โดยตั้งใจ
 * (carry → Phase 5, ดู .claude/rules/accounting.md "ยังเปิดอยู่ → Phase 5")
 * (anti-drift net: interco-netting.integration.spec.ts + interco-device-return.integration.spec.ts).
 */
export const SHOP_RECEIVABLE_TYPES = [
  'SWAP_CREDIT',
  'PAYOUT_RECALL',
  'SHOP_COLLECT',
  'DEVICE_RETURN',
] as const;

export type ShopReceivableType = (typeof SHOP_RECEIVABLE_TYPES)[number] | 'UNKNOWN';

const EXPLICIT: ReadonlySet<string> = new Set<string>(SHOP_RECEIVABLE_TYPES);
```

(`FLOW_MAP` บรรทัด 27-32 และ `classifyShopReceivable` บรรทัด 34-53 **ไม่แตะ**)

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/journal/shop-receivable-type.util.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit.**

---

### Task 3: typed balances `deviceReturnFinanceBalance` / `deviceReturnShopBalance` + IN-list จากค่าคงที่ (typed-balance + pending lens)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-typed-balance.ts:1-3` (import), `:67-73` (IN-list ของ `swapCreditFinanceBalance`), `:111-119` (IN-list ของ `shopCollectTypedBalance`), ต่อท้ายไฟล์หลัง `:165` (helper ใหม่ 2 ตัว)
- Modify: `apps/api/src/modules/interco-settlement/interco-pending.service.ts:1-3` (import), `:206-210` (IN-list เลนส์ SWAP_CREDIT ต่อสัญญา), `:505-509` (IN-list `glSwapCreditTotal`)
- Test (jest): `apps/api/src/modules/interco-settlement/interco-pending.service.spec.ts` (เพิ่มเทส anti-drift)
- Test (vitest): `interco-device-return.integration.spec.ts` (เพิ่ม helper `seedDeviceReturnPair` + `describe` Task 3)

**Interfaces:**
- Consumes: `SHOP_RECEIVABLE_TYPES` (Task 2)
- Produces: `export function deviceReturnFinanceBalance(client: Client, contractId: string): Promise<Prisma.Decimal>` (11-2107 Σ Dr−Cr, `je.metadata->>'contractId' = $1 AND je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'`) · `export function deviceReturnShopBalance(client: Client, contractId: string): Promise<Prisma.Decimal>` (S21-1104 Σ Cr−Dr, predicate เดียวกัน) — ใช้โดย Task 5 (drift), Task 6 (ด่าน template), Task 8 (drift guard), Task 9 (settle-cash)
- หมายเหตุ: IN-list อีก 4 จุดใน `interco-aging.service.ts` (L384, 396, 583, 909) แก้ใน **Task 5** พร้อมคอลัมน์ใหม่ของรายงานอายุ — ระหว่าง Task 3-4 รายงานอายุจึงยังนับ JP5 ที่ stamp DEVICE_RETURN (มี `shopReceivable: '11-2107'`) เป็น SHOP_COLLECT ชั่วคราว (ตั้งใจ — Task 5 ปิด)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) jest — แก้ import บรรทัด 1-3 ของ `interco-pending.service.spec.ts`:

เดิม (L1-3):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { IntercoPendingService } from './interco-pending.service';
import { PrismaService } from '../../prisma/prisma.service';
```

ใหม่:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { IntercoPendingService } from './interco-pending.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SHOP_RECEIVABLE_TYPES } from '../journal/shop-receivable-type.util';
```

เพิ่มเทสใน `describe('swapCreditGl / shopBuybackPayableGl / swapCreditEligible (Phase 2)')` หลังเทส `'เงื่อนไข SQL ของสองเลนส์ใหม่สอดคล้อง classifyShopReceivable …'` (ก่อน `});` ปิด describe บรรทัด 262):

```ts
    it('anti-drift: IN-list ของ carve-out "stamp ที่รู้จักชนะ fallback" สร้างจาก SHOP_RECEIVABLE_TYPES (Prisma.join)', async () => {
      queueLenses(financeRow, [], [], []);
      lookupC1();
      await service.getPendingContracts();

      // tagged template: calls[i] = [TemplateStringsArray, ...values] — Prisma.join คืน Sql
      // ที่ .values = ลิสต์ประเภท ⇒ ลิสต์ในตัวอักษร SQL หายไป ต้องมาจากค่าคงที่เท่านั้น
      const swapCall = prisma.$queryRaw.mock.calls[2] as unknown[];
      const swapSql = (swapCall[0] as string[]).join('');
      expect(swapSql).not.toContain("'SHOP_COLLECT'");
      const joinArgs = swapCall.slice(1).filter((v) => v instanceof Prisma.Sql) as Prisma.Sql[];
      expect(joinArgs).toHaveLength(1);
      expect(joinArgs[0].values).toEqual([...SHOP_RECEIVABLE_TYPES]);
      expect(joinArgs[0].values).toContain('DEVICE_RETURN');
    });
```

และใน `describe('IntercoPendingService.getReconcileTotals')` หลังเทส `'whole-account GL queries: …'` (ก่อน `});` ปิด describe บรรทัด 433):

```ts
  it('anti-drift: glSwapCreditTotal ใช้ IN-list จาก SHOP_RECEIVABLE_TYPES เช่นกัน', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // FINANCE lens (pending) — empty
      .mockResolvedValueOnce([{ balance: 0 }])
      .mockResolvedValueOnce([{ balance: 0 }])
      .mockResolvedValueOnce([{ balance: 0 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 0 }])
      .mockResolvedValueOnce([{ balance: 0 }]);
    await service.getReconcileTotals();
    const swapCall = prisma.$queryRaw.mock.calls[3] as unknown[];
    const joinArgs = swapCall.slice(1).filter((v) => v instanceof Prisma.Sql) as Prisma.Sql[];
    expect(joinArgs).toHaveLength(1);
    expect(joinArgs[0].values).toEqual([...SHOP_RECEIVABLE_TYPES]);
  });
```

(ข) vitest — ใน `interco-device-return.integration.spec.ts`: เพิ่ม import (ใต้ `import { IntercoAgingService } …`):

```ts
import { SHOP_RECEIVABLE_TYPES, classifyShopReceivable } from '../../journal/shop-receivable-type.util';
import {
  deviceReturnFinanceBalance,
  deviceReturnShopBalance,
  recallFinanceBalance,
  recallShopBalance,
  shopCollectShopBalance,
  shopCollectTypedBalance,
  swapCreditFinanceBalance,
  swapCreditShopBalance,
} from '../interco-typed-balance';
```

เพิ่ม helper ใต้ `seedNormalContract` (ก่อน `interface LineRow`):

```ts
/**
 * JE คู่ของใบรับเครื่องคืนหลังยืนยัน — shape ตรง producer ของ Phase 2 (RepossessionsService.createInTx):
 *   FINANCE JP5 (golden §6.5 — สัญญา 17,000/12 งวด จ่าย 4 ยังไม่ accrual ราคาประเมิน 7,000):
 *     Dr 11-2107 7,000 · Dr 11-2106 4,000 · Dr 21-2102 793.32 · Dr 51-1102 5,126.68
 *     / Cr 11-2101 11,333.36 · Cr 11-2105 793.32 · Cr 21-2101 793.32 · Cr 41-1101 4,000  (Σ 16,920.00)
 *   SHOP intake (ShopCollectShopLegs.postRepossessionIntake): Dr S11-2002 / Cr S21-1104 [ราคาประเมิน]
 * ทั้งสองใบ stamp shopReceivableType DEVICE_RETURN + metadata.contractId (key ของทุกเลนส์).
 * JP5 ยัง stamp shopReceivable '11-2107' (marker เก่าของ JP4/JP5) — explicit stamp ต้องชนะ
 * ไม่งั้นเลนส์ SHOP_COLLECT นับซ้ำ (นี่คือเหตุที่ IN-list ต้องมี DEVICE_RETURN — Task 3).
 * `shopAmount` ต่างจาก 7,000 = fixture สองสมุดไม่ตรง (guard tests).
 */
async function seedDeviceReturnPair(contractId: string, opts: { shopAmount?: string } = {}) {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: { productId: true },
  });
  await journalAuto.createAndPost({
    description: 'JP5 synthetic (ใบรับเครื่องคืน)',
    companyId: financeId,
    metadata: {
      flow: 'test-jp5-device-return',
      idempotencyKey: `tjp5dr:${contractId}`,
      tag: 'JP5',
      contractId,
      shopReceivableType: 'DEVICE_RETURN',
      shopReceivable: '11-2107',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('7000.00'), cr: zero },
      { accountCode: '11-2106', dr: dec('4000.00'), cr: zero },
      { accountCode: '21-2102', dr: dec('793.32'), cr: zero },
      { accountCode: '51-1102', dr: dec('5126.68'), cr: zero },
      { accountCode: '11-2101', dr: zero, cr: dec('11333.36') },
      { accountCode: '11-2105', dr: zero, cr: dec('793.32') },
      { accountCode: '21-2101', dr: zero, cr: dec('793.32') },
      { accountCode: '41-1101', dr: zero, cr: dec('4000.00') },
    ],
  });
  const shopAmount = dec(opts.shopAmount ?? '7000.00');
  await journalAuto.createAndPost({
    description: 'SHOP intake synthetic (ใบรับเครื่องคืน)',
    companyId: shopId,
    metadata: {
      flow: 'shop-repossession-intake',
      idempotencyKey: `shop-repossession-intake:${contractId}`,
      contractId,
      productId: contract.productId,
      companyCode: 'SHOP',
      shopReceivableType: 'DEVICE_RETURN',
    },
    lines: [
      { accountCode: 'S11-2002', dr: shopAmount, cr: zero },
      { accountCode: 'S21-1104', dr: zero, cr: shopAmount },
    ],
  });
}
```

เพิ่มตัวแปร module-level ใต้ `let schemaProbeId: string;`:

```ts
/** สัญญา X — ยึดแล้ว (CLOSED_BAD_DEBT) มีคู่ JE DEVICE_RETURN 7,000/7,000 */
let deviceReturnId: string;
```

ใน `beforeAll` ต่อจาก `schemaProbeId = await seedBaseContract(99);`:

```ts
    deviceReturnId = await seedBaseContract(2, 'CLOSED_BAD_DEBT');
    await seedDeviceReturnPair(deviceReturnId);
```

เพิ่ม describe ต่อท้ายเทส Task 1 (ก่อน `});` ปิด describe หลัก):

```ts
  // ===========================================================================
  // Task 3 — typed balances + classify (SQL twins ของ classifyShopReceivable)
  // ===========================================================================
  describe('typed balances — DEVICE_RETURN แยกประเภทจริง (Task 3)', () => {
    it('deviceReturnFinanceBalance/ShopBalance = 7,000 ทั้งสองสมุด; ประเภทอื่นของ X = 0; สัญญาปกติ = 0', async () => {
      expect((await deviceReturnFinanceBalance(prisma, deviceReturnId)).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('7000.00');

      // explicit stamp ชนะ marker เก่า (shopReceivable '11-2107' บน JP5) — ห้ามรั่วเข้า SHOP_COLLECT
      expect((await shopCollectTypedBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await shopCollectShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await swapCreditFinanceBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await swapCreditShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await recallFinanceBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await recallShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');

      expect((await deviceReturnFinanceBalance(prisma, normalId)).toFixed(2)).toBe('0.00');
      expect((await deviceReturnShopBalance(prisma, normalId)).toFixed(2)).toBe('0.00');
    });

    it('classifyShopReceivable ของ JE ทั้งสองใบ = DEVICE_RETURN (anti-drift util ↔ SQL)', async () => {
      const jes = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: deviceReturnId } as never, deletedAt: null },
        include: { lines: true },
      });
      const typed = jes.filter((je) =>
        je.lines.some((l) => l.accountCode === '11-2107' || l.accountCode === 'S21-1104'),
      );
      expect(typed).toHaveLength(2);
      for (const je of typed) {
        expect(classifyShopReceivable(je.metadata)).toBe('DEVICE_RETURN');
      }
      expect(SHOP_RECEIVABLE_TYPES).toContain('DEVICE_RETURN');
    });
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-pending.service.spec.ts`
Expected: FAIL — `expect(received).toHaveLength(expected) … Received length: 0` (ยังไม่มี `Prisma.Sql` ใน args — ลิสต์ยังเป็นตัวอักษรใน SQL)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — `TypeError: deviceReturnFinanceBalance is not a function` (export ยังไม่มี)

- [ ] **Step 3: แก้โค้ด**

`interco-typed-balance.ts` — เดิม (L1-3):

```ts
import { Prisma, PrismaClient } from '@prisma/client';

type Client = Prisma.TransactionClient | PrismaClient;
```

ใหม่:

```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { SHOP_RECEIVABLE_TYPES } from '../journal/shop-receivable-type.util';

type Client = Prisma.TransactionClient | PrismaClient;
```

เดิม (L67-73 — ใน `swapCreditFinanceBalance`):

```ts
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'))`,
```

ใหม่:

```ts
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 (${Prisma.join([...SHOP_RECEIVABLE_TYPES])}))
             AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'))`,
```

เดิม (L111-119 — ใน `shopCollectTypedBalance`):

```ts
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`,
```

ใหม่:

```ts
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 (${Prisma.join([...SHOP_RECEIVABLE_TYPES])}))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`,
```

ต่อท้ายไฟล์ (หลัง `recallShopBalance` บรรทัด 165):

```ts

/**
 * 11-2107 Σ(Dr−Cr) เฉพาะประเภท DEVICE_RETURN ของสัญญาหนึ่ง — ค่าเครื่องคืนจากใบรับเครื่องคืน
 * (spec 2026-09-20 §6.2; producer = JP5 ตอน FINANCE ยืนยันใบ — Phase 2). explicit stamp
 * เท่านั้น ไม่มี legacy fallback (ประเภทใหม่ — JP5 ยุคก่อนหน้า stamp SHOP_COLLECT และล้าง
 * ทางเดิม forward-only ตาม spec §6.6). Key ด้วย metadata.contractId ทั้งสองสมุด.
 *
 * ผู้ใช้: ด่านใบรับโอน (`ShopCollectSettlementTemplate` §6.4), drift guard แถว DEVICE_RETURN
 * ใน `approveBatch`, `settleDeductionCash`, residual alarm — SQL twin ของเลนส์
 * `getPendingDeviceReturns` + `DEVICE_RETURN_COND` ในรายงานอายุ (แก้ที่ไหนต้องแก้ทุกที่).
 */
export function deviceReturnFinanceBalance(
  client: Client,
  contractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    '11-2107',
    'dr-cr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'`,
  );
}

/** S21-1104 Σ(Cr−Dr) เฉพาะ DEVICE_RETURN — key ด้วย metadata.contractId (ขาคู่ SHOP ของ JP5 ใบรับเครื่องคืน) */
export function deviceReturnShopBalance(
  client: Client,
  contractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    'S21-1104',
    'cr-dr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'`,
  );
}
```

`interco-pending.service.ts` — เดิม (L1-3):

```ts
import { Injectable } from '@nestjs/common';
import { InterCoBatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
```

ใหม่:

```ts
import { Injectable } from '@nestjs/common';
import { InterCoBatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SHOP_RECEIVABLE_TYPES } from '../journal/shop-receivable-type.util';
```

เดิม (L206-210 — เลนส์ SWAP_CREDIT ต่อสัญญาใน `getPendingContracts`):

```ts
        AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
             OR ((je.metadata->>'shopReceivableType' IS NULL
                  OR je.metadata->>'shopReceivableType' NOT IN
                     ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
                 AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'))
```

ใหม่:

```ts
        AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
             OR ((je.metadata->>'shopReceivableType' IS NULL
                  OR je.metadata->>'shopReceivableType' NOT IN
                     (${Prisma.join([...SHOP_RECEIVABLE_TYPES])}))
                 AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'))
```

เดิม (L505-509 — `glSwapCreditTotal` ใน `getReconcileTotals`): ข้อความเดียวกันเป๊ะกับ L206-210 → แก้แบบเดียวกัน (`('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT')` → `(${Prisma.join([...SHOP_RECEIVABLE_TYPES])})`)

หมายเหตุ: `Prisma.join` ซ้อนใน tagged template `$queryRaw` และใน `Prisma.sql` ใช้ได้ (precedent บน origin/main: `products-stock-groups.ts:110,163`, `consecutive-missed.service.ts:26`) — ค่าถูกส่งเป็น bind parameter `$n` ไม่ใช่ตัวอักษรใน SQL

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-pending.service.spec.ts` — Expected: PASS (ทุก test เดิม + 2 ใหม่; เทส SQL-text เดิมยังผ่านเพราะ assert เฉพาะส่วนตัวอักษรที่ยังอยู่ เช่น `= 'SWAP_CREDIT'`)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (3 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. รัน `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts && cd ../..` (regression ของ twins — ต้องเขียวเหมือน Task 0). **Do NOT commit.**

---

### Task 4: คิวค่าเครื่องคืน — `DeviceReturnCandidate` + `getPendingDeviceReturns` + `glDeviceReturnTotal` + Σ deduction รวม `deviceReturnAmount`

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-typed-balance.ts` — ต่อท้ายไฟล์หลัง `deviceReturnShopBalance` (ที่ Task 3 เพิ่ม): export `DeductionColumn` / `ALL_DEDUCTION_COLUMNS` / `DEVICE_RETURN_DEDUCTION_COLUMNS` / `postedDeductionsByContract`
- Modify: `apps/api/src/modules/interco-settlement/interco-pending.service.ts:1-3` (import helper), `:53-70` (ต่อท้าย `RecallCandidate` ด้วย interface ใหม่), `:72-87` (`ReconcileTotals` + field), `:402-421` (แทน Σ deduction inline ด้วย helper), หลัง `:457` (method ใหม่), `:513-523` (query typed total ใหม่ต่อจาก recall), `:538-546` (return)
- Create (jest): `apps/api/src/modules/interco-settlement/interco-typed-balance.spec.ts` (unit ของ export ใหม่ผ่าน client mock)
- Test (jest): `apps/api/src/modules/interco-settlement/interco-pending.service.spec.ts:351-433` (`getReconcileTotals` — ลำดับ mock + จำนวน call 6→7) + describe ใหม่ต่อท้ายไฟล์
- Test (vitest): `interco-device-return.integration.spec.ts` (describe Task 4 + baseline totals ใน `beforeAll`)

**Interfaces:**
- Consumes: `deviceReturnAmount` (Task 1), `Client` union ของ `interco-typed-balance.ts` (Task 3)
- Produces (ใน `interco-typed-balance.ts` — **export ระดับ module** เพราะ Phase 2 `RepossessionsService.findAll` ต้องใช้ตัวเดียวกันจากนอกโมดูล): `export type DeductionColumn = 'swapCreditAmount' | 'recallAmount' | 'deviceReturnAmount'` · `export const ALL_DEDUCTION_COLUMNS: readonly DeductionColumn[]` (ทั้งสาม — คิว recall) · `export const DEVICE_RETURN_DEDUCTION_COLUMNS: readonly DeductionColumn[]` (`['deviceReturnAmount']` — คิวค่าเครื่องคืน + Phase 2) · `export async function postedDeductionsByContract(client: Client, contractIds: string[], columns: readonly DeductionColumn[]): Promise<Map<string, Prisma.Decimal>>` (Σ เฉพาะคอลัมน์ที่ขอ ของ item ใน batch POSTED ที่ไม่ถูกลบ; สัญญาที่ไม่มี item = ไม่มี key ⇒ ผู้เรียกใช้ `?? 0`)
- Produces (ใน `interco-pending.service.ts`): `export interface DeviceReturnCandidate { contractId: string; contractNumber: string; customerName: string; deviceReturnGl: Prisma.Decimal; shopDeviceReturnGl: Prisma.Decimal }` · `async getPendingDeviceReturns(tx?: Prisma.TransactionClient): Promise<DeviceReturnCandidate[]>` · `ReconcileTotals.glDeviceReturnTotal: Prisma.Decimal` — ทั้งสองคิว import helper จาก `./interco-typed-balance` (ไม่มี private method)
- **สูตร NET ต่างกันตามคิว (spec §6.3 ฉบับตัดสิน):** recall = gross − Σ ทั้งสามคอลัมน์ (byte-identical กับเดิม); ค่าเครื่องคืน = gross − Σ `deviceReturnAmount` **เท่านั้น** — เครดิตสวอป/เรียกคืนที่เคยหักไม่เกี่ยวกับหนี้ก้อนใหม่นี้ (ดู "กติกาที่ตัดสินแล้ว" หัวแผน)
- หมายเหตุ (brief vs โค้ดจริง): `getPendingContracts` (L121-317) **ไม่มี** Σ deduction บน origin/main (มีแค่ settled gate) — ไม่มีอะไรให้เติม; ที่ต้องเติมคือ `getPendingRecalls` เท่านั้น

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) jest — `interco-pending.service.spec.ts` ใน `describe('IntercoPendingService.getReconcileTotals')`:

เดิม (L368-397 — เทสแรก):

```ts
  it('computes drift = pendingTotal − glFinanceTotal (+ 3 typed whole-account totals ของ Phase 2)', async () => {
    // Call order: getPendingContracts() → [finance rows, shop rows, swap-credit
    // rows, shop-buyback rows], then getReconcileTotals' own 5 whole-account
    // queries: [finance total, shop total, swap-credit total, recall total,
    // shop-buyback total].
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // swap-credit lens
      .mockResolvedValueOnce([]) // shop-buyback lens
      .mockResolvedValueOnce([{ balance: 12000 }]) // glFinanceTotal (includes a stray JE the lens missed)
      .mockResolvedValueOnce([{ balance: 9000 }]) // glShopTotal
      .mockResolvedValueOnce([{ balance: 16000 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 22000 }]) // glRecallTotal
      .mockResolvedValueOnce([{ balance: 30000 }]); // glShopBuybackTotal
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const totals = await service.getReconcileTotals();
    expect(totals.pendingTotal.toNumber()).toBe(11000);
    expect(totals.glFinanceTotal.toNumber()).toBe(12000);
    expect(totals.glShopTotal.toNumber()).toBe(9000);
    expect(totals.drift.toNumber()).toBe(11000 - 12000);
    expect(totals.glSwapCreditTotal.toNumber()).toBe(16000);
    expect(totals.glRecallTotal.toNumber()).toBe(22000);
    expect(totals.glShopBuybackTotal.toNumber()).toBe(30000);
  });
```

ใหม่:

```ts
  it('computes drift = pendingTotal − glFinanceTotal (+ 4 typed whole-account totals: Phase 2 + DEVICE_RETURN)', async () => {
    // Call order: getPendingContracts() → [finance rows, shop rows, swap-credit
    // rows, shop-buyback rows], then getReconcileTotals' own 6 whole-account
    // queries: [finance total, shop total, swap-credit total, recall total,
    // device-return total, shop-buyback total].
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // swap-credit lens
      .mockResolvedValueOnce([]) // shop-buyback lens
      .mockResolvedValueOnce([{ balance: 12000 }]) // glFinanceTotal (includes a stray JE the lens missed)
      .mockResolvedValueOnce([{ balance: 9000 }]) // glShopTotal
      .mockResolvedValueOnce([{ balance: 16000 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 22000 }]) // glRecallTotal
      .mockResolvedValueOnce([{ balance: 7000 }]) // glDeviceReturnTotal (ใบรับเครื่องคืน 2026-09-20)
      .mockResolvedValueOnce([{ balance: 37000 }]); // glShopBuybackTotal
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const totals = await service.getReconcileTotals();
    expect(totals.pendingTotal.toNumber()).toBe(11000);
    expect(totals.glFinanceTotal.toNumber()).toBe(12000);
    expect(totals.glShopTotal.toNumber()).toBe(9000);
    expect(totals.drift.toNumber()).toBe(11000 - 12000);
    expect(totals.glSwapCreditTotal.toNumber()).toBe(16000);
    expect(totals.glRecallTotal.toNumber()).toBe(22000);
    expect(totals.glDeviceReturnTotal.toNumber()).toBe(7000);
    expect(totals.glShopBuybackTotal.toNumber()).toBe(37000);
  });
```

เดิม (L399-432 — เทสที่สอง):

```ts
  it('whole-account GL queries: ยอดเดิมไม่กรอง metadata — ยอด typed ใหม่กรองเฉพาะ type (ไม่กรอง contractId)', async () => {
    // getPendingContracts() short-circuits after an empty FINANCE lens (no
    // further lens calls), so 6 total $queryRaw calls happen here: the empty
    // lens + the 5 whole-account totals.
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // FINANCE lens (pending) — empty
      .mockResolvedValueOnce([{ balance: 0 }]) // glFinanceTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glShopTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glRecallTotal
      .mockResolvedValueOnce([{ balance: 0 }]); // glShopBuybackTotal

    await service.getReconcileTotals();

    const calls = prisma.$queryRaw.mock.calls;
    expect(calls.length).toBe(6);
    const sqlAt = (i: number) => (calls[i][0] as unknown as string[]).join('');

    // ยอดเดิม 2 ตัว — ไม่กรอง metadata ใดๆ (พฤติกรรมเดิม ห้ามขยับ)
    expect(sqlAt(1)).not.toContain('metadata');
    expect(sqlAt(2)).not.toContain('metadata');

    // ยอด typed ใหม่ — กรอง type แต่ต้องไม่กรอง contractId (ทั้งบัญชี)
    const swapSql = sqlAt(3);
    expect(swapSql).toContain("je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'");
    expect(swapSql).toContain("je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'");
    expect(swapSql).not.toContain('contractId');
    const recallSql = sqlAt(4);
    expect(recallSql).toContain("je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'");
    expect(recallSql).not.toContain('contractId');
    // S21-1104 ทั้งบัญชี — ไม่กรอง type เลย
    expect(sqlAt(5)).toContain('S21-1104');
    expect(sqlAt(5)).not.toContain('metadata');
  });
```

ใหม่:

```ts
  it('whole-account GL queries: ยอดเดิมไม่กรอง metadata — ยอด typed ใหม่กรองเฉพาะ type (ไม่กรอง contractId)', async () => {
    // getPendingContracts() short-circuits after an empty FINANCE lens (no
    // further lens calls), so 7 total $queryRaw calls happen here: the empty
    // lens + the 6 whole-account totals.
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // FINANCE lens (pending) — empty
      .mockResolvedValueOnce([{ balance: 0 }]) // glFinanceTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glShopTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glRecallTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glDeviceReturnTotal
      .mockResolvedValueOnce([{ balance: 0 }]); // glShopBuybackTotal

    await service.getReconcileTotals();

    const calls = prisma.$queryRaw.mock.calls;
    expect(calls.length).toBe(7);
    const sqlAt = (i: number) => (calls[i][0] as unknown as string[]).join('');

    // ยอดเดิม 2 ตัว — ไม่กรอง metadata ใดๆ (พฤติกรรมเดิม ห้ามขยับ)
    expect(sqlAt(1)).not.toContain('metadata');
    expect(sqlAt(2)).not.toContain('metadata');

    // ยอด typed ใหม่ — กรอง type แต่ต้องไม่กรอง contractId (ทั้งบัญชี)
    const swapSql = sqlAt(3);
    expect(swapSql).toContain("je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'");
    expect(swapSql).toContain("je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'");
    expect(swapSql).not.toContain('contractId');
    const recallSql = sqlAt(4);
    expect(recallSql).toContain("je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'");
    expect(recallSql).not.toContain('contractId');
    // DEVICE_RETURN ทั้งบัญชี — explicit stamp เท่านั้น ไม่กรอง contractId ไม่มี flow fallback
    const deviceReturnSql = sqlAt(5);
    expect(deviceReturnSql).toContain('11-2107');
    expect(deviceReturnSql).toContain("je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'");
    expect(deviceReturnSql).not.toContain('contractId');
    expect(deviceReturnSql).not.toContain("'flow'");
    // S21-1104 ทั้งบัญชี — ไม่กรอง type เลย
    expect(sqlAt(6)).toContain('S21-1104');
    expect(sqlAt(6)).not.toContain('metadata');
  });
```

(เทส anti-drift ที่ Task 3 เพิ่มไว้ใน describe นี้: เพิ่ม `.mockResolvedValueOnce([{ balance: 0 }])` อีก 1 บรรทัดให้ครบ 7 — index ของ `calls[3]` ไม่เปลี่ยน)

ต่อท้ายไฟล์ (describe ใหม่ — ต้นแบบ `describe('IntercoPendingService.getPendingRecalls')` L265-349):

```ts
describe('IntercoPendingService.getPendingDeviceReturns (ใบรับเครื่องคืน 2026-09-20 §6.3)', () => {
  let service: IntercoPendingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      interCoSettlementItem: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [IntercoPendingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(IntercoPendingService);
  });

  /** $queryRaw order: 11-2107 DEVICE_RETURN lens first, S21-1104 DEVICE_RETURN lens second. */
  const queueDeviceReturnLenses = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    financeRows: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shopRows: any[] = [],
  ) => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValueOnce(financeRows).mockResolvedValueOnce(shopRows);
  };
  const lookupC1 = () =>
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า X' } },
    ]);

  it('returns [] when the DEVICE_RETURN lens has no rows — no gate/lookup calls', async () => {
    queueDeviceReturnLenses([]);
    const result = await service.getPendingDeviceReturns();
    expect(result).toEqual([]);
    expect(prisma.interCoSettlementItem.findMany).not.toHaveBeenCalled();
  });

  it('เงื่อนไข SQL: DEVICE_RETURN explicit stamp เท่านั้น (ไม่มี flow fallback) key ด้วย contractId ทั้งสองสมุด', async () => {
    queueDeviceReturnLenses(
      [{ contract_id: 'c-1', amount: 7000 }],
      [{ contract_id: 'c-1', amount: 7000 }],
    );
    lookupC1();

    const [row] = await service.getPendingDeviceReturns();
    expect(row.deviceReturnGl.toNumber()).toBe(7000);
    expect(row.shopDeviceReturnGl.toNumber()).toBe(7000);
    expect(row.contractNumber).toBe('CT-0001');
    expect(row.customerName).toBe('ลูกค้า X');

    const financeSql = (prisma.$queryRaw.mock.calls[0][0] as unknown as string[]).join('');
    expect(financeSql).toContain('11-2107');
    expect(financeSql).toContain("je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'");
    expect(financeSql).not.toContain("'flow'");
    expect(financeSql).toContain('HAVING SUM(jl.debit - jl.credit) > 0');

    const shopSql = (prisma.$queryRaw.mock.calls[1][0] as unknown as string[]).join('');
    expect(shopSql).toContain('S21-1104');
    expect(shopSql).toContain("je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'");
    expect(shopSql).toContain("je.metadata->>'contractId'");
    expect(shopSql).not.toContain('newContractId');
  });

  it('settled gate กรอง itemType DEVICE_RETURN เท่านั้น — item SETTLEMENT เดิม (สัญญาที่ยึดเคยถูกจ่าย) ต้องไม่บังคิว', async () => {
    queueDeviceReturnLenses([{ contract_id: 'c-1', amount: 7000 }], []);
    prisma.interCoSettlementItem.findMany.mockResolvedValue([{ contractId: 'c-1' }]);

    const result = await service.getPendingDeviceReturns();
    expect(result).toEqual([]); // gated out by the mocked DEVICE_RETURN item

    const where = prisma.interCoSettlementItem.findMany.mock.calls[0][0].where;
    expect(where.itemType).toBe('DEVICE_RETURN');
    expect(where.batch.status.in).toEqual(['PENDING_APPROVAL', 'POSTED']);
    expect(where.batch.status.in).not.toContain('REVERSED');
    expect(where.batch.status.in).not.toContain('CANCELLED');
  });

  it('hydrate ไม่กรองสถานะสัญญา (สัญญาที่ยึดเป็น CLOSED_BAD_DEBT โดยนิยาม) — where มีแค่ id + deletedAt', async () => {
    queueDeviceReturnLenses([{ contract_id: 'c-1', amount: 7000 }], []);
    lookupC1();
    await service.getPendingDeviceReturns();

    const where = prisma.contract.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ id: { in: ['c-1'] }, deletedAt: null });
    expect(where).not.toHaveProperty('status');
    const select = prisma.contract.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('financedAmount');
  });

  it('ยอด = gross − Σ deviceReturnAmount เท่านั้น (same-type NET — spec §6.3 ฉบับตัดสิน): เครดิตสวอปที่เคยหักไม่ลดค่าเครื่องคืน', async () => {
    queueDeviceReturnLenses(
      [{ contract_id: 'c-1', amount: 7000 }],
      [{ contract_id: 'c-1', amount: 7000 }],
    );
    lookupC1();
    prisma.interCoSettlementItem.findMany
      .mockResolvedValueOnce([]) // settled gate — ไม่มี DEVICE_RETURN item ใน batch เปิด
      .mockResolvedValueOnce([
        // สัญญา swap ที่ถูกหักเครดิต 8,000 ในรอบเก่าแล้วภายหลังถูกยึด — deduction ประเภทอื่น
        // ต้องไม่ลด gross ของค่าเครื่องคืน (สูตร all-types เดิมจะได้ −1,000 = หลุดคิว)
        {
          contractId: 'c-1',
          swapCreditAmount: new Prisma.Decimal(8000),
          recallAmount: new Prisma.Decimal(0),
          deviceReturnAmount: new Prisma.Decimal(0),
        },
      ]);
    const [row] = await service.getPendingDeviceReturns();
    expect(row.deviceReturnGl.toNumber()).toBe(7000);
    expect(row.shopDeviceReturnGl.toNumber()).toBe(7000);

    // รูป query เดียวกับคิว recall: select ครบสามคอลัมน์เสมอ แล้วรวมเฉพาะที่ขอ
    const select = prisma.interCoSettlementItem.findMany.mock.calls[1][0].select;
    expect(select).toEqual({
      contractId: true,
      swapCreditAmount: true,
      recallAmount: true,
      deviceReturnAmount: true,
    });
  });

  it('deduction ประเภทเดียวกัน (deviceReturnAmount) ลด net ทั้งสองสมุด; หักครบ → net 0 → หลุดคิว', async () => {
    queueDeviceReturnLenses(
      [{ contract_id: 'c-1', amount: 7000 }],
      [{ contract_id: 'c-1', amount: 7000 }],
    );
    lookupC1();
    prisma.interCoSettlementItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          contractId: 'c-1',
          swapCreditAmount: new Prisma.Decimal(0),
          recallAmount: new Prisma.Decimal(0),
          deviceReturnAmount: new Prisma.Decimal(3000),
        },
      ]);
    const [row] = await service.getPendingDeviceReturns();
    expect(row.deviceReturnGl.toNumber()).toBe(4000);
    expect(row.shopDeviceReturnGl.toNumber()).toBe(4000);

    // หักครบ → net 0 → หลุดคิว
    queueDeviceReturnLenses([{ contract_id: 'c-1', amount: 7000 }], []);
    lookupC1();
    prisma.interCoSettlementItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          contractId: 'c-1',
          swapCreditAmount: new Prisma.Decimal(0),
          recallAmount: new Prisma.Decimal(0),
          deviceReturnAmount: new Prisma.Decimal(7000),
        },
      ]);
    expect(await service.getPendingDeviceReturns()).toEqual([]);
  });

  it('shopDeviceReturnGl default 0 เมื่อฝั่ง SHOP ไม่มีแถว (JE ขาคู่หาย — guard สองสมุดของ buildSnapshot จับต่อ)', async () => {
    queueDeviceReturnLenses([{ contract_id: 'c-1', amount: 7000 }], []);
    lookupC1();
    const [row] = await service.getPendingDeviceReturns();
    expect(row.shopDeviceReturnGl.toNumber()).toBe(0);
  });

  it('getPendingRecalls ก็รวม deviceReturnAmount ใน Σ deduction (helper เดียวกัน)', async () => {
    queueDeviceReturnLenses(
      [{ contract_id: 'c-1', recall: 11000 }],
      [{ contract_id: 'c-1', recall: 11000 }],
    );
    lookupC1();
    prisma.interCoSettlementItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          contractId: 'c-1',
          swapCreditAmount: new Prisma.Decimal(0),
          recallAmount: new Prisma.Decimal(0),
          deviceReturnAmount: new Prisma.Decimal(1000),
        },
      ]);
    const [row] = await service.getPendingRecalls();
    expect(row.recallGl.toNumber()).toBe(10000);
    expect(row.shopRecallGl.toNumber()).toBe(10000);
  });
});
```

(ข) vitest — `interco-device-return.integration.spec.ts`: เพิ่มตัวแปร module-level ใต้ `let deviceReturnId: string;`

```ts
let baselineTotals: Awaited<ReturnType<IntercoPendingService['getReconcileTotals']>>;
```

ใน `beforeAll` **ก่อน** บรรทัด `deviceReturnId = await seedBaseContract(2, 'CLOSED_BAD_DEBT');`:

```ts
    // Whole-account baselines BEFORE this run's DEVICE_RETURN seeds — assertion เป็น delta
    baselineTotals = await pendingService.getReconcileTotals();
```

เพิ่ม describe ต่อท้าย describe Task 3:

```ts
  // ===========================================================================
  // Task 4 — คิวค่าเครื่องคืน (mirror ของคิว recall) + reconcile totals
  // ===========================================================================
  describe('คิวค่าเครื่องคืน — getPendingDeviceReturns + glDeviceReturnTotal (Task 4)', () => {
    it('X (CLOSED_BAD_DEBT) อยู่ในคิวที่ 7,000 ทั้งสองสมุด; ไม่โผล่คิวรอจ่าย/คิวเรียกคืน; Y ไม่โผล่คิวนี้', async () => {
      const contract = await prisma.contract.findUniqueOrThrow({ where: { id: deviceReturnId } });
      expect(contract.status).toBe('CLOSED_BAD_DEBT'); // hydrate ต้องไม่กรองสถานะนี้

      const rows = await pendingService.getPendingDeviceReturns();
      const row = rows.find((r) => r.contractId === deviceReturnId)!;
      expect(row).toBeDefined();
      expect(row.deviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(row.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(row.contractNumber.startsWith('DRTEST-')).toBe(true);
      expect(row.customerName).toContain('__DRTEST_');
      expect(rows.some((r) => r.contractId === normalId)).toBe(false);

      const pending = await pendingService.getPendingContracts();
      expect(pending.some((p) => p.contractId === deviceReturnId)).toBe(false);
      expect(pending.some((p) => p.contractId === normalId)).toBe(true);
      const recalls = await pendingService.getPendingRecalls();
      expect(recalls.some((r) => r.contractId === deviceReturnId)).toBe(false);
    });

    it('reconcile totals: glDeviceReturnTotal +7,000 และ glShopBuybackTotal +7,000 (delta จาก baseline); ยอดเดิมยังอยู่ครบ', async () => {
      const totals = await pendingService.getReconcileTotals();
      expect(
        totals.glDeviceReturnTotal.minus(baselineTotals.glDeviceReturnTotal).toFixed(2),
      ).toBe('7000.00');
      expect(
        totals.glShopBuybackTotal.minus(baselineTotals.glShopBuybackTotal).toFixed(2),
      ).toBe('7000.00');
      // SWAP_CREDIT / PAYOUT_RECALL ไม่ขยับ (แยกประเภทจริง)
      expect(totals.glSwapCreditTotal.minus(baselineTotals.glSwapCreditTotal).toFixed(2)).toBe('0.00');
      expect(totals.glRecallTotal.minus(baselineTotals.glRecallTotal).toFixed(2)).toBe('0.00');
      expect(totals.pendingTotal).toBeDefined();
      expect(totals.drift).toBeDefined();
    });

    it('settled gate: SETTLEMENT item เดิมไม่บังคิว — DEVICE_RETURN item ใน batch เปิดเท่านั้นที่ตัดออก; สูตร NET หัก deduction ทุกประเภทของ batch POSTED', async () => {
      const g = await seedBaseContract(3, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(g);

      // (a) สัญญาที่ยึดเคยถูกจ่ายในรอบ POSTED มาก่อนโดยนิยาม — item SETTLEMENT (ไม่มีอะไรหัก)
      //     ต้องไม่บังคิวค่าเครื่องคืน
      const b1 = await seedBatch('POSTED', 2);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: b1.id,
          contractId: g,
          itemType: 'SETTLEMENT',
          financedGl: dec('10000.00'),
          commissionGl: dec('1000.00'),
          shopFinancedGl: dec('10000.00'),
          shopCommissionGl: dec('1000.00'),
        },
      });
      let rows = await pendingService.getPendingDeviceReturns();
      expect(rows.find((r) => r.contractId === g)!.deviceReturnGl.toFixed(2)).toBe('7000.00');

      // (b) DEVICE_RETURN item ใน batch PENDING_APPROVAL → ตัดออกจากคิว
      const b2 = await seedBatch('PENDING_APPROVAL', 3);
      const gateItem = await prisma.interCoSettlementItem.create({
        data: {
          batchId: b2.id,
          contractId: g,
          itemType: 'DEVICE_RETURN',
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          deviceReturnAmount: dec('7000.00'),
        },
      });
      rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === g)).toBe(false);
      expect(rows.some((r) => r.contractId === deviceReturnId)).toBe(true); // X ไม่เกี่ยว

      // (c) รอบนั้น CANCELLED → item หลุด gate → กลับเข้าคิวเต็ม 7,000 (REVERSED/CANCELLED ไม่นับ)
      await prisma.interCoSettlementBatch.update({ where: { id: b2.id }, data: { status: 'CANCELLED' } });
      rows = await pendingService.getPendingDeviceReturns();
      expect(rows.find((r) => r.contractId === g)!.deviceReturnGl.toFixed(2)).toBe('7000.00');

      // (ง) สูตร NET same-type (spec §6.3 ฉบับตัดสิน): deduction ของ item **ประเภทอื่น** ใน batch
      //     POSTED ต้อง**ไม่**ลดค่าเครื่องคืน — SETTLEMENT item ของ b1 ถือ swapCreditAmount 8,000
      //     (สัญญา swap ที่เคยถูกหักเครดิตแล้วภายหลังถูกยึด) → ยังอยู่ในคิวที่ 7,000 ทั้งสองสมุด
      //     (สูตร all-types เดิมจะได้ 7,000 − 8,000 < 0 = หลุดคิวทั้งที่หนี้มีจริง)
      await prisma.interCoSettlementItem.updateMany({
        where: { batchId: b1.id, contractId: g },
        data: { swapCreditAmount: dec('8000.00') },
      });
      rows = await pendingService.getPendingDeviceReturns();
      const netRow = rows.find((r) => r.contractId === g)!;
      expect(netRow).toBeDefined();
      expect(netRow.deviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(netRow.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');

      // cleanup ของเทสนี้เอง — deduction สังเคราะห์ที่ไม่มี GL หนุนต้องไม่ค้างไปกวน
      // Σ settledDeduction ทั้งตารางของ getTypedAccountDrift (Task 5)
      await prisma.interCoSettlementItem.delete({ where: { id: gateItem.id } });
      await prisma.interCoSettlementItem.deleteMany({ where: { batchId: b1.id } });
      await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: [b1.id, b2.id] } } });
    });
  });
```

(ค) jest — สร้าง `apps/api/src/modules/interco-settlement/interco-typed-balance.spec.ts` (unit ของ export ใหม่ — jest จับไฟล์ `*.spec.ts` ใต้ `src/modules/interco-settlement/` ตาม `testRegex` เดิม; SQL twins ของไฟล์นี้ยังทดสอบบน DB จริงใน integration spec):

```ts
import { Prisma } from '@prisma/client';
import {
  ALL_DEDUCTION_COLUMNS,
  DEVICE_RETURN_DEDUCTION_COLUMNS,
  postedDeductionsByContract,
} from './interco-typed-balance';

/**
 * `postedDeductionsByContract` — export ระดับ module (ใบรับเครื่องคืน 2026-09-20): ผู้เรียก =
 * IntercoPendingService (สองคิว) + Phase 2 RepossessionsService.findAll (deviceReturnOutstanding).
 * ที่นี่ปักเฉพาะตรรกะ "รวมเฉพาะคอลัมน์ที่ขอ" + where/select ผ่าน client mock.
 */
describe('postedDeductionsByContract (interco-typed-balance)', () => {
  const D = (v: number) => new Prisma.Decimal(v);
  const items = [
    { contractId: 'c-1', swapCreditAmount: D(8000), recallAmount: D(0), deviceReturnAmount: D(0) },
    { contractId: 'c-1', swapCreditAmount: D(0), recallAmount: D(0), deviceReturnAmount: D(3000) },
    { contractId: 'c-2', swapCreditAmount: D(0), recallAmount: D(11000), deviceReturnAmount: D(0) },
  ];
  const clientWith = (rows: typeof items) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    return { client: { interCoSettlementItem: { findMany } } as never, findMany };
  };

  it('ALL_DEDUCTION_COLUMNS (คิว recall): รวมสามคอลัมน์ต่อสัญญา + where/select รูปเดียว', async () => {
    const { client, findMany } = clientWith(items);
    const map = await postedDeductionsByContract(client, ['c-1', 'c-2'], ALL_DEDUCTION_COLUMNS);
    expect(map.get('c-1')!.toString()).toBe('11000');
    expect(map.get('c-2')!.toString()).toBe('11000');
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      contractId: { in: ['c-1', 'c-2'] },
      deletedAt: null,
      batch: { status: 'POSTED', deletedAt: null },
    });
    expect(args.select).toEqual({
      contractId: true,
      swapCreditAmount: true,
      recallAmount: true,
      deviceReturnAmount: true,
    });
  });

  it('DEVICE_RETURN_DEDUCTION_COLUMNS (คิวค่าเครื่องคืน / Phase 2 findAll): รวมเฉพาะ deviceReturnAmount — เครดิตสวอป/เรียกคืนไม่นับ', async () => {
    const { client } = clientWith(items);
    const map = await postedDeductionsByContract(
      client,
      ['c-1', 'c-2'],
      DEVICE_RETURN_DEDUCTION_COLUMNS,
    );
    expect(map.get('c-1')!.toString()).toBe('3000');
    expect(map.get('c-2')!.toString()).toBe('0');
  });

  it('สัญญาที่ไม่มี item ใน batch POSTED = ไม่มี key (ผู้เรียกใช้ `?? 0`)', async () => {
    const { client } = clientWith([]);
    const map = await postedDeductionsByContract(client, ['c-9'], ALL_DEDUCTION_COLUMNS);
    expect(map.size).toBe(0);
    expect(map.get('c-9')).toBeUndefined();
  });

  it('ค่าคงที่สองตัวเป็นแหล่งเดียวของสูตร: ALL = ทั้งสาม, DEVICE_RETURN = คอลัมน์เดียว', () => {
    expect([...ALL_DEDUCTION_COLUMNS]).toEqual([
      'swapCreditAmount',
      'recallAmount',
      'deviceReturnAmount',
    ]);
    expect([...DEVICE_RETURN_DEDUCTION_COLUMNS]).toEqual(['deviceReturnAmount']);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-typed-balance.spec.ts src/modules/interco-settlement/interco-pending.service.spec.ts`
Expected: FAIL — typed-balance spec: `TypeError: (0 , _intercoTypedBalance.postedDeductionsByContract) is not a function` (export ยังไม่มี); pending spec: `TypeError: service.getPendingDeviceReturns is not a function`; `expect(calls.length).toBe(7) … Received: 6`; `totals.glDeviceReturnTotal` undefined

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — `TypeError: pendingService.getPendingDeviceReturns is not a function`

- [ ] **Step 3: แก้ `interco-typed-balance.ts` (export helper) + `interco-pending.service.ts`**

`interco-typed-balance.ts` — ต่อท้ายไฟล์ (หลัง `deviceReturnShopBalance` ที่ Task 3 เพิ่มไว้):

```ts

// ---------------------------------------------------------------------------
// Σ deduction ที่รอบจ่าย POSTED หักไปแล้ว — export ระดับ module (ใบรับเครื่องคืน 2026-09-20):
// ผู้เรียก = IntercoPendingService (สองคิว) + Phase 2 RepossessionsService.findAll
// (`deviceReturnOutstanding`) — สูตรเดียว ห้ามมีสำเนา; อยู่ไฟล์นี้เพราะรับ `Client` union
// ชุดเดียวกับ typed-balance helpers (ใช้ได้ทั้งใน tx และ root prisma)
// ---------------------------------------------------------------------------

/** คอลัมน์ deduction บน InterCoSettlementItem — ทุกแถวมีครบสาม (คอลัมน์ที่ไม่เกี่ยวกับประเภทแถวเป็น 0) */
export type DeductionColumn = 'swapCreditAmount' | 'recallAmount' | 'deviceReturnAmount';

/** คิว recall: สูตร NET ทุกประเภท — gross ของ redirect C-2 นับเครดิตสวอปที่เคยหักไปแล้วซ้ำ (Phase 3 Task 4) */
export const ALL_DEDUCTION_COLUMNS: readonly DeductionColumn[] = [
  'swapCreditAmount',
  'recallAmount',
  'deviceReturnAmount',
];

/**
 * คิวค่าเครื่องคืน + Phase 2 `findAll.deviceReturnOutstanding`: same-type เท่านั้น (spec
 * 2026-09-20 §6.3 ฉบับตัดสิน) — ค่าเครื่องคืนเป็นหนี้ก้อนใหม่ ไม่เกี่ยวกับเครดิตสวอปเดิม; สัญญา
 * swap ที่ถูกหัก 8,000 แล้วถูกยึด 7,000 ต้องอยู่คิวที่ 7,000
 */
export const DEVICE_RETURN_DEDUCTION_COLUMNS: readonly DeductionColumn[] = ['deviceReturnAmount'];

/**
 * Σ deduction ต่อสัญญาจาก batch POSTED (ไม่ถูกลบ) — item ทุก itemType แต่รวม**เฉพาะคอลัมน์ที่ขอ**
 * (สถาปัตยกรรม gross-lens: "หักแล้วเท่าไร" อยู่ที่ item table ไม่ใช่ GL metadata — ขา Cr ของ batch
 * ไม่ stamp contractId). สัญญาที่ไม่มี item = ไม่มี key ใน Map (ผู้เรียกใช้ `?? 0`).
 * select ครบสามคอลัมน์เสมอ (รูป query เดียว) แล้วรวมเฉพาะที่ขอ — ผู้เรียก:
 *   - `IntercoPendingService.getPendingRecalls` → `ALL_DEDUCTION_COLUMNS` (byte-identical กับก่อน 2026-09-20)
 *   - `IntercoPendingService.getPendingDeviceReturns` → `DEVICE_RETURN_DEDUCTION_COLUMNS`
 *   - Phase 2 `RepossessionsService.findAll` (`deviceReturnOutstanding`) → `DEVICE_RETURN_DEDUCTION_COLUMNS`
 */
export async function postedDeductionsByContract(
  client: Client,
  contractIds: string[],
  columns: readonly DeductionColumn[],
): Promise<Map<string, Prisma.Decimal>> {
  const items = await client.interCoSettlementItem.findMany({
    where: {
      contractId: { in: contractIds },
      deletedAt: null,
      batch: { status: 'POSTED', deletedAt: null },
    },
    select: {
      contractId: true,
      swapCreditAmount: true,
      recallAmount: true,
      deviceReturnAmount: true,
    },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    const prev = map.get(item.contractId) ?? new Prisma.Decimal(0);
    map.set(
      item.contractId,
      columns.reduce((s, col) => s.plus(item[col]), prev),
    );
  }
  return map;
}
```

`interco-pending.service.ts` — import (เดิมหลัง Task 3 คือ 4 บรรทัดแรก; เพิ่มบรรทัดที่ 5):

```ts
import { Injectable } from '@nestjs/common';
import { InterCoBatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SHOP_RECEIVABLE_TYPES } from '../journal/shop-receivable-type.util';
import {
  ALL_DEDUCTION_COLUMNS,
  DEVICE_RETURN_DEDUCTION_COLUMNS,
  postedDeductionsByContract,
} from './interco-typed-balance';
```

เดิม (L53-70):

```ts
/**
 * แถวคิวหักเรียกคืน (Flow C-2 — spec §4.1): สัญญายกเลิกหลังตัดจ่ายที่มี
 * 11-2107 [PAYOUT_RECALL] ค้าง — แสดงเป็น "แถวหัก" ในหน้ารอบจ่าย
 * (ไม่มีเจ้าหนี้ 21-1101/21-1102 ของตัวเอง).
 */
export interface RecallCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /**
   * ยอดเรียกคืน **สุทธิ** (Phase 3 Task 4 — carry b) = typed 11-2107
   * [PAYOUT_RECALL] gross − Σ(swapCreditAmount + recallAmount) ของ item
   * ทุกประเภทใน batch POSTED ของสัญญานั้น. ดู jsdoc `getPendingRecalls`.
   */
  recallGl: Prisma.Decimal;
  /** S21-1104 PAYOUT_RECALL สุทธิด้วยสูตรเดียวกัน (ต้อง = recallGl จึงหักได้) */
  shopRecallGl: Prisma.Decimal;
}
```

ใหม่:

```ts
/**
 * แถวคิวหักเรียกคืน (Flow C-2 — spec §4.1): สัญญายกเลิกหลังตัดจ่ายที่มี
 * 11-2107 [PAYOUT_RECALL] ค้าง — แสดงเป็น "แถวหัก" ในหน้ารอบจ่าย
 * (ไม่มีเจ้าหนี้ 21-1101/21-1102 ของตัวเอง).
 */
export interface RecallCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /**
   * ยอดเรียกคืน **สุทธิ** (Phase 3 Task 4 — carry b) = typed 11-2107
   * [PAYOUT_RECALL] gross − Σ(swapCreditAmount + recallAmount + deviceReturnAmount)
   * ของ item ทุกประเภทใน batch POSTED ของสัญญานั้น. ดู jsdoc `getPendingRecalls`.
   */
  recallGl: Prisma.Decimal;
  /** S21-1104 PAYOUT_RECALL สุทธิด้วยสูตรเดียวกัน (ต้อง = recallGl จึงหักได้) */
  shopRecallGl: Prisma.Decimal;
}

/**
 * แถวคิวหักค่าเครื่องคืน (ใบรับเครื่องคืน — spec 2026-09-20 §6.3): สัญญาที่ยึด/รับคืน
 * แล้ว (CLOSED_BAD_DEBT) ที่มี 11-2107 [DEVICE_RETURN] ค้าง — แสดงเป็น "แถวหัก" ประเภทที่ 3
 * ในหน้ารอบจ่าย (ไม่มีเจ้าหนี้ 21-1101/21-1102 ของตัวเอง เหมือนแถว RECALL).
 */
export interface DeviceReturnCandidate {
  contractId: string;
  contractNumber: string;
  customerName: string;
  /**
   * ค่าเครื่องคืน **สุทธิ** = typed 11-2107 [DEVICE_RETURN] gross − Σ `deviceReturnAmount`
   * ของ item ใน batch POSTED ของสัญญานั้น (**same-type เท่านั้น** — spec §6.3 ฉบับตัดสิน:
   * ค่าเครื่องคืนเป็นหนี้ก้อนใหม่ เครดิตสวอป/เรียกคืนที่เคยหักไม่เกี่ยว; ต่างจากคิว recall ที่หัก
   * ทุกประเภทเพราะ redirect นับเครดิตสวอปซ้ำใน gross). ดู jsdoc `getPendingDeviceReturns`.
   */
  deviceReturnGl: Prisma.Decimal;
  /** S21-1104 DEVICE_RETURN สุทธิด้วยสูตรเดียวกัน (ต้อง = deviceReturnGl จึงหักได้) */
  shopDeviceReturnGl: Prisma.Decimal;
}
```

เดิม (L83-86 — ใน `ReconcileTotals`):

```ts
  /** 11-2107 typed PAYOUT_RECALL ทั้งบัญชี (Dr−Cr — explicit stamp เท่านั้น) */
  glRecallTotal: Prisma.Decimal;
  /** S21-1104 ทั้งบัญชี (Cr−Dr — ไม่กรอง type) */
  glShopBuybackTotal: Prisma.Decimal;
```

ใหม่:

```ts
  /** 11-2107 typed PAYOUT_RECALL ทั้งบัญชี (Dr−Cr — explicit stamp เท่านั้น) */
  glRecallTotal: Prisma.Decimal;
  /** 11-2107 typed DEVICE_RETURN ทั้งบัญชี (Dr−Cr — explicit stamp เท่านั้น; ใบรับเครื่องคืน 2026-09-20) */
  glDeviceReturnTotal: Prisma.Decimal;
  /** S21-1104 ทั้งบัญชี (Cr−Dr — ไม่กรอง type: SWAP_CREDIT + PAYOUT_RECALL + DEVICE_RETURN + SHOP_COLLECT) */
  glShopBuybackTotal: Prisma.Decimal;
```

เดิม (L402-421 — ใน `getPendingRecalls`):

```ts
    // Σ deductions ต่อสัญญาจาก batch POSTED (ทุก itemType — สูตร NET, ดู jsdoc):
    // แถว SETTLEMENT ของรอบเก่าถือ swapCreditAmount ที่เคยหัก, แถว RECALL ของ
    // รอบก่อนหน้าถือ recallAmount ที่เรียกคืนไปแล้ว — ทั้งสองก้อนคือเงินที่
    // FINANCE ไม่เคยจ่ายจริง/ได้คืนแล้ว จึงหักออกจาก gross ทั้งคู่.
    const postedDeductionItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId: { in: remainingIds },
        deletedAt: null,
        batch: { status: 'POSTED', deletedAt: null },
      },
      select: { contractId: true, swapCreditAmount: true, recallAmount: true },
    });
    const postedDeductionByContract = new Map<string, Prisma.Decimal>();
    for (const item of postedDeductionItems) {
      const prev = postedDeductionByContract.get(item.contractId) ?? new Prisma.Decimal(0);
      postedDeductionByContract.set(
        item.contractId,
        prev.plus(item.swapCreditAmount).plus(item.recallAmount),
      );
    }
```

ใหม่:

```ts
    // Σ deductions ต่อสัญญาจาก batch POSTED (ทุก itemType — สูตร NET, ดู jsdoc):
    // แถว SETTLEMENT ของรอบเก่าถือ swapCreditAmount ที่เคยหัก, แถว RECALL ของ
    // รอบก่อนหน้าถือ recallAmount ที่เรียกคืนไปแล้ว, แถว DEVICE_RETURN ถือ
    // deviceReturnAmount — ทุกก้อนคือเงินที่ FINANCE ไม่เคยจ่ายจริง/ได้คืนแล้ว
    // จึงหักออกจาก gross ทั้งหมด (ALL_DEDUCTION_COLUMNS — byte-identical กับเดิม;
    // helper เดียวกับคิวค่าเครื่องคืนซึ่งส่งเฉพาะคอลัมน์ของตัวเอง — ห้ามมีสำเนา).
    const postedDeductionByContract = await postedDeductionsByContract(
      client,
      remainingIds,
      ALL_DEDUCTION_COLUMNS,
    );
```

เพิ่มหลัง `getPendingRecalls` (หลัง `}` ปิด method บรรทัด 457, ก่อน jsdoc ของ `getReconcileTotals`):

```ts

  /**
   * คิวค่าเครื่องคืน (ใบรับเครื่องคืน — spec 2026-09-20 §6.3): สัญญาที่มี 11-2107
   * [DEVICE_RETURN] ค้าง **สุทธิ** > 0 และไม่อยู่ใน batch เปิด. producer ของ JE คือ JP5
   * ตอน FINANCE ยืนยันใบรับคืน (Phase 2 — `RepossessionsService.createInTx` ขา Dr =
   * 11-2107 stamp DEVICE_RETURN) + ขาคู่ SHOP `Cr S21-1104` stamp เดียวกัน
   * (`ShopCollectShopLegs.postRepossessionIntake`).
   *
   * Mirror ของ `getPendingRecalls` ทุกประการ (explicit stamp เท่านั้น — type ใหม่ไม่มี
   * legacy; SQL twins = `deviceReturnFinanceBalance` / `deviceReturnShopBalance` +
   * `DEVICE_RETURN_COND` ในรายงานอายุ — แก้ที่ไหนต้องแก้ทุกที่):
   *   - settled gate เฉพาะ `itemType: 'DEVICE_RETURN'` ใน batch เปิด — สัญญาที่ถูกยึด
   *     เคยถูกจ่ายในรอบ POSTED มาก่อนโดยนิยาม (มี SETTLEMENT item ถาวร); any-type gate
   *     จะทำให้คิวนี้ว่างตลอดกาล
   *   - ยอด = gross − Σ `deviceReturnAmount` ของ item ใน batch POSTED ของสัญญานั้น
   *     (**same-type เท่านั้น** — spec §6.3 ฉบับตัดสิน: ค่าเครื่องคืนเป็นหนี้ก้อนใหม่ ไม่เกี่ยวกับ
   *     เครดิตสวอป/เรียกคืนที่เคยหัก; สัญญา swap ที่ถูกหัก 8,000 แล้วภายหลังถูกยึด 7,000 ต้อง
   *     อยู่ในคิวที่ 7,000 — สูตร all-types ของคิว recall จะให้ −1,000); net ≤ 0.01 หลุดคิว
   *   - hydrate **ไม่กรอง status** — สัญญาที่ยึดแล้วเป็น CLOSED_BAD_DEBT โดยนิยาม
   *     (คิวรอจ่ายกรอง CANCELED ออก; คิวนี้กับคิว recall ไม่กรอง)
   */
  async getPendingDeviceReturns(tx?: Prisma.TransactionClient): Promise<DeviceReturnCandidate[]> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;

    // FINANCE lens — 11-2107 [DEVICE_RETURN] (explicit stamp เท่านั้น)
    const financeRows = await client.$queryRaw<
      Array<{ contract_id: string | null; amount: unknown }>
    >`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS amount
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'
      GROUP BY 1
      HAVING SUM(jl.debit - jl.credit) > 0
    `;
    const validRows = financeRows.filter(
      (r): r is { contract_id: string; amount: unknown } => !!r.contract_id,
    );
    if (validRows.length === 0) return [];

    // SHOP lens — S21-1104 [DEVICE_RETURN], key ด้วย metadata.contractId (เหมือนขา recall)
    const shopRows = await client.$queryRaw<
      Array<{ contract_id: string | null; amount: unknown }>
    >`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(jl.credit - jl.debit), 0)::decimal AS amount
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-1104'
        AND jl.deleted_at IS NULL AND je.status = 'POSTED' AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'
      GROUP BY 1
    `;
    const shopByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopRows) {
      if (!row.contract_id) continue;
      shopByContract.set(row.contract_id, new Prisma.Decimal(String(row.amount ?? 0)));
    }

    const contractIds = validRows.map((r) => r.contract_id);

    // "settled" gate — เฉพาะ item DEVICE_RETURN ใน batch เปิด (ดู jsdoc ด้านบน)
    const settledItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId: { in: contractIds },
        itemType: 'DEVICE_RETURN',
        deletedAt: null,
        batch: { status: { in: OPEN_BATCH_STATUSES }, deletedAt: null },
      },
      select: { contractId: true },
    });
    const settledContractIds = new Set(settledItems.map((i) => i.contractId));

    const remainingIds = contractIds.filter((id) => !settledContractIds.has(id));
    if (remainingIds.length === 0) return [];

    // same-type NET (spec §6.3 ฉบับตัดสิน) — ส่งเฉพาะคอลัมน์ deviceReturnAmount
    const postedDeductionByContract = await postedDeductionsByContract(
      client,
      remainingIds,
      DEVICE_RETURN_DEDUCTION_COLUMNS,
    );

    // hydrate — ไม่กรอง status (CLOSED_BAD_DEBT โดยนิยาม); เลือกเฉพาะ id/เลขสัญญา/ชื่อลูกค้า
    const contracts = await client.contract.findMany({
      where: { id: { in: remainingIds }, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        customer: { select: { name: true } },
      },
    });
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    const result: DeviceReturnCandidate[] = [];
    for (const row of validRows) {
      const contract = contractById.get(row.contract_id);
      if (!contract) continue; // settled, soft-deleted, or otherwise gone

      const postedDeduction =
        postedDeductionByContract.get(row.contract_id) ?? new Prisma.Decimal(0);
      const deviceReturnGl = new Prisma.Decimal(String(row.amount ?? 0)).minus(postedDeduction);
      // net ≤ 0.01 = หักครบแล้ว (หรือมีแต่ยอดที่เคยหักไว้) — ออกจากคิว
      if (deviceReturnGl.lte('0.01')) continue;
      const shopDeviceReturnGl = (
        shopByContract.get(row.contract_id) ?? new Prisma.Decimal(0)
      ).minus(postedDeduction);

      result.push({
        contractId: row.contract_id,
        contractNumber: contract.contractNumber,
        customerName: contract.customer.name,
        deviceReturnGl,
        shopDeviceReturnGl,
      });
    }

    return result;
  }

```

(ไม่มี private helper ใน service — `postedDeductionsByContract` / ค่าคงที่สองตัว import จาก `./interco-typed-balance` ตามบล็อกแรกของ Step นี้; ทั้งสองคิวเรียกฟังก์ชันเดียวกันด้วย `client` ตัวเดียวกับที่ใช้ query เลนส์ — ใน tx หรือ root prisma ตามที่ผู้เรียกส่งมา)

เดิม (L513-523 — recall total ใน `getReconcileTotals`) คงไว้ แล้วเพิ่มต่อจากบรรทัด 523 (`const glRecallTotal = …;`):

```ts

    // 11-2107 typed DEVICE_RETURN ทั้งบัญชี (explicit stamp เท่านั้น — ใบรับเครื่องคืน 2026-09-20;
    // gross สะสมเหมือนสองตัวบน: ขา Cr ของ batch ไม่ stamp จึงไม่ลดตัวเลขนี้)
    const deviceReturnTotalRows = await this.prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'
    `;
    const glDeviceReturnTotal = new Prisma.Decimal(String(deviceReturnTotalRows[0]?.balance ?? 0));
```

เดิม (L525-526 คอมเมนต์ + L538-546 return):

```ts
    // S21-1104 ทั้งบัญชี — ไม่กรอง type (กระทบยอดรวมสองสมุด: SWAP_CREDIT +
    // PAYOUT_RECALL รวมกันต้องหนุนยอดบัญชีนี้)
```
→
```ts
    // S21-1104 ทั้งบัญชี — ไม่กรอง type (กระทบยอดรวมสองสมุด: SWAP_CREDIT +
    // PAYOUT_RECALL + DEVICE_RETURN (+ SHOP_COLLECT) รวมกันต้องหนุนยอดบัญชีนี้)
```

```ts
    return {
      pendingTotal,
      glFinanceTotal,
      glShopTotal,
      drift,
      glSwapCreditTotal,
      glRecallTotal,
      glShopBuybackTotal,
    };
```
→
```ts
    return {
      pendingTotal,
      glFinanceTotal,
      glShopTotal,
      drift,
      glSwapCreditTotal,
      glRecallTotal,
      glDeviceReturnTotal,
      glShopBuybackTotal,
    };
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-typed-balance.spec.ts src/modules/interco-settlement/interco-pending.service.spec.ts` — Expected: PASS (typed-balance spec 4 tests; pending spec ทุก test รวม describe ใหม่ 8 tests — same-type NET, same-type deduction, gate, hydrate, SQL, default 0, empty, recall รวม deviceReturnAmount)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (6 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit.**

---

### Task 5: รายงานอายุ + กระทบยอดระดับบัญชี — `DEVICE_RETURN_COND`, คอลัมน์ใหม่, `negativeTypedFields`, `getTypedAccountDrift` (+ IN-list 4 จุดที่เหลือ)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-aging.service.ts:1-3` (import), `:5-25` (header doc), `:26-82` (`ShopReceivableAgingRow`), `:204-207` (doc `TypedAccountDriftRow.settledDeduction`), `:299-302` (`NegativeCheckable`), `:322-356` (`negativeTypedFields`), `:376-399` (typed conds), `:409-417` (`FinanceAgingRow`), `:536-553` (Query A), `:558-606` (Query B), `:630-645` (Query C), `:670-708` (rows), `:860-911` (`getTypedAccountDrift`)
- Modify: `apps/api/src/modules/interco-settlement/crons/shop-receivable-aging.cron.ts:322-328` (บรรทัดแยกประเภทในคำอธิบาย Todo)
- Modify (fixtures ที่จะ compile ไม่ผ่าน): `apps/api/src/modules/interco-settlement/__tests__/shop-receivable-aging.cron.spec.ts:41-45` (`makeRow`), `apps/api/src/modules/interco-settlement/__tests__/interco-reconcile.cron.spec.ts:54-58` (`makeRow`)
- Test (vitest): `interco-device-return.integration.spec.ts` (describe Task 5)
- **ไม่แตะ** `crons/interco-reconcile.cron.ts` — ตรวจแล้ว (origin/main L307-456): ไม่มี kind ใหม่; `NEGATIVE_TYPED` วนตาม `negativeTypedFields(row)` จึงเห็นช่องใหม่เอง; `BOOK_MISMATCH` อ่าน `intercoNet`/`shopMirrorNet` ที่รวม DEVICE_RETURN แล้ว; `SWAP_CREDIT_ONE_BOOK` ใช้ `swapCreditGross`/`shopMirrorGross` (ไม่เกี่ยว) — ตรงกับ spec §6.2 "crons: ไม่มี kind ใหม่; แขน INTERCO ครอบประเภทนี้เอง"

**Interfaces:**
- Consumes: `SHOP_RECEIVABLE_TYPES` (Task 2), `deviceReturnAmount` (Task 1)
- Produces: `ShopReceivableAgingRow.deviceReturnGross: Prisma.Decimal` (11-2107 typed DEVICE_RETURN Σ Dr−Cr) · `ShopReceivableAgingRow.shopMirrorDeviceReturnGross: Prisma.Decimal` (S21-1104 typed DEVICE_RETURN Σ Cr−Dr) · `intercoNet = swapCreditGross + payoutRecallGross + deviceReturnGross − settledDeduction` · `shopMirrorGross` รวม DEVICE_RETURN (key `metadata.contractId`) · `negativeTypedFields` รายงาน field `deviceReturnGross` / `shopMirrorDeviceReturnGross` · `getTypedAccountDrift()` lens totals รวม DEVICE_RETURN + `settledDeduction` รวม `deviceReturnAmount`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) fixtures — `shop-receivable-aging.cron.spec.ts` เดิม (L41-45, สังเกต indent 2 ช่องของ 3 บรรทัดกลางตามไฟล์จริง):

```ts
    shopMirrorGross: D(0),
  shopMirrorSwapGross: D(0),
  shopMirrorRecallGross: D(0),
  shopMirrorCollectGross: D(0),
    shopMirrorNet: D(0),
```

ใหม่:

```ts
    shopMirrorGross: D(0),
    shopMirrorSwapGross: D(0),
    shopMirrorRecallGross: D(0),
    shopMirrorDeviceReturnGross: D(0),
    shopMirrorCollectGross: D(0),
    shopMirrorNet: D(0),
```

และในไฟล์เดียวกัน เดิม (L35-36):

```ts
    swapCreditGross: D(0),
    payoutRecallGross: D(0),
```

ใหม่:

```ts
    swapCreditGross: D(0),
    payoutRecallGross: D(0),
    deviceReturnGross: D(0),
```

`interco-reconcile.cron.spec.ts` — แก้ `makeRow` (L44-67) แบบเดียวกันเป๊ะ: เพิ่ม `deviceReturnGross: D(0),` ใต้ `payoutRecallGross: D(0),` (L49) และ `shopMirrorDeviceReturnGross: D(0),` ใต้ `shopMirrorRecallGross: D(0),` (L56)

(ข) vitest — `interco-device-return.integration.spec.ts`: แก้ import

เดิม:

```ts
import { IntercoAgingService } from '../interco-aging.service';
```

ใหม่:

```ts
import { IntercoAgingService, negativeTypedFields } from '../interco-aging.service';
```

เพิ่ม describe ต่อท้าย describe Task 4:

```ts
  // ===========================================================================
  // Task 5 — รายงานอายุ + กระทบยอดระดับบัญชี (anti-drift บังคับตาม spec §6.2)
  // ===========================================================================
  describe('รายงานอายุ + getTypedAccountDrift (Task 5)', () => {
    it('แถว X: deviceReturnGross 7,000 เข้ากลุ่ม interco, กระจก SHOP 7,000, ไม่ mismatch, ไม่ใช่ legacy, อายุ 0 วัน', async () => {
      const res = await agingService.getShopReceivableAging();
      const row = res.rows.find((r) => r.contractId === deviceReturnId)!;
      expect(row).toBeDefined();
      expect(row.deviceReturnGross.toFixed(2)).toBe('7000.00');
      expect(row.swapCreditGross.toFixed(2)).toBe('0.00');
      expect(row.payoutRecallGross.toFixed(2)).toBe('0.00');
      expect(row.shopCollect.toFixed(2)).toBe('0.00'); // marker shopReceivable '11-2107' ต้องไม่รั่ว
      expect(row.settledDeduction.toFixed(2)).toBe('0.00');
      expect(row.intercoNet.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorDeviceReturnGross.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorGross.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorSwapGross.toFixed(2)).toBe('0.00');
      expect(row.shopMirrorRecallGross.toFixed(2)).toBe('0.00');
      expect(row.shopMirrorCollectGross.toFixed(2)).toBe('0.00');
      expect(row.shopMirrorNet.toFixed(2)).toBe('7000.00');
      expect(row.bookMismatch).toBe(false);
      expect(row.legacyOneBook).toBe(false);
      expect(row.intercoAgeDays).toBe(0);
      expect(row.shopCollectAgeDays).toBeNull();
      // totals นับ X (ไม่ใช่ legacy) — อย่างน้อยเท่ายอดของ X
      expect(res.totals.intercoNet.gte('7000.00')).toBe(true);
    });

    it('สองสมุดไม่ตรง (FINANCE 7,000 / SHOP 6,000) → bookMismatch = true และแถวยังรายงาน', async () => {
      const id = await seedBaseContract(4, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id, { shopAmount: '6000.00' });
      const res = await agingService.getShopReceivableAging();
      const row = res.rows.find((r) => r.contractId === id)!;
      expect(row).toBeDefined();
      expect(row.intercoNet.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorNet.toFixed(2)).toBe('6000.00');
      expect(row.bookMismatch).toBe(true);
    });

    it('getTypedAccountDrift: seed คู่ DEVICE_RETURN ใหม่ → lens/account ขยับ 7,000 เท่ากัน, drift ไม่ขยับ (ทั้ง 11-2107 และ S21-1104)', async () => {
      const before = await agingService.getTypedAccountDrift();
      const id = await seedBaseContract(5, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id);
      const after = await agingService.getTypedAccountDrift();
      expect(after.map((d) => d.accountCode)).toEqual(['11-2107', 'S21-1104']);
      for (const code of ['11-2107', 'S21-1104']) {
        const b = before.find((d) => d.accountCode === code)!;
        const a = after.find((d) => d.accountCode === code)!;
        expect(a.accountTotal.minus(b.accountTotal).toFixed(2)).toBe('7000.00');
        expect(a.lensTotal.minus(b.lensTotal).toFixed(2)).toBe('7000.00');
        expect(a.settledDeduction.minus(b.settledDeduction).toFixed(2)).toBe('0.00');
        expect(a.drift.minus(b.drift).abs().lte('0.01')).toBe(true);
      }
    });

    it('negativeTypedFields รายงานช่อง deviceReturnGross / shopMirrorDeviceReturnGross ที่ติดลบ (แหล่งเดียวของ reconcile cron)', () => {
      const base = {
        intercoNet: dec('0'),
        shopCollect: dec('0'),
        shopMirrorNet: dec('0'),
        shopMirrorCollectGross: dec('0'),
        deviceReturnGross: dec('0'),
        shopMirrorDeviceReturnGross: dec('0'),
        legacyOneBook: false,
      };
      expect(negativeTypedFields(base)).toEqual([]);
      const fields = negativeTypedFields({
        ...base,
        deviceReturnGross: dec('-7000'),
        shopMirrorDeviceReturnGross: dec('-7000'),
      }).map((f) => f.field);
      expect(fields).toEqual(['deviceReturnGross', 'shopMirrorDeviceReturnGross']);
      // แถว legacy ยังใช้ยอดรวมระดับสัญญา (ไม่แตะกติกาเดิม)
      expect(
        negativeTypedFields({ ...base, legacyOneBook: true, deviceReturnGross: dec('-1') }),
      ).toEqual([]);
    });
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — `expect(received).toBe(expected) … Expected: "7000.00" Received: undefined` (ไม่มี `deviceReturnGross`) และ `shopCollect` ของ X = `7000.00` (marker เก่ารั่วเพราะ IN-list ของ aging ยังไม่มี DEVICE_RETURN)

Run: `./tools/check-types.sh api` — Expected: ยังผ่าน (fixture เพิ่ม field ที่ interface ยังไม่มี → error `Object literal may only specify known properties` — **นี่คือ red ของ (ก)**; ถ้าผ่านแปลว่ายังไม่ได้แก้ fixture)

- [ ] **Step 3: แก้ `interco-aging.service.ts`**

เดิม (L1-3):

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
```

ใหม่:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SHOP_RECEIVABLE_TYPES } from '../journal/shop-receivable-type.util';
```

เดิม (L16-19 ใน header doc):

```ts
 *   - 11-2107 PAYOUT_RECALL = explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 *   - 11-2107 SHOP_COLLECT  = explicit stamp ชนะ; ไม่มี stamp → flow/collectedByShop fallback
 *   - S21-1104 SWAP_CREDIT  key ด้วย metadata.newContractId (A.4 stamp)
 *   - S21-1104 PAYOUT_RECALL key ด้วย metadata.contractId (C-2 redirect / cash settle SHOP leg)
```

ใหม่:

```ts
 *   - 11-2107 PAYOUT_RECALL = explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 *   - 11-2107 DEVICE_RETURN = explicit stamp เท่านั้น (ใบรับเครื่องคืน 2026-09-20 — JP5 ตอนยืนยัน)
 *   - 11-2107 SHOP_COLLECT  = explicit stamp ชนะ; ไม่มี stamp → flow/collectedByShop fallback
 *   - S21-1104 SWAP_CREDIT  key ด้วย metadata.newContractId (A.4 stamp)
 *   - S21-1104 PAYOUT_RECALL key ด้วย metadata.contractId (C-2 redirect / cash settle SHOP leg)
 *   - S21-1104 DEVICE_RETURN key ด้วย metadata.contractId (ขาคู่ SHOP ของ JP5 ใบรับเครื่องคืน / cash settle SHOP leg)
 * IN-list ของ carve-out ทุกจุดสร้างจาก SHOP_RECEIVABLE_TYPES (Prisma.join) — เพิ่มประเภทที่ util
 * ที่เดียว (spec 2026-09-20 §6.2).
```

เดิม (L30-37 ใน `ShopReceivableAgingRow`):

```ts
  /** 11-2107 typed SWAP_CREDIT gross (Dr−Cr) ของสัญญา */
  swapCreditGross: Prisma.Decimal;
  /** 11-2107 typed PAYOUT_RECALL gross (Dr−Cr) ของสัญญา */
  payoutRecallGross: Prisma.Decimal;
  /** Σ (swapCreditAmount + recallAmount) ของ item ทุก itemType ใน batch POSTED */
  settledDeduction: Prisma.Decimal;
  /** ยอดกลุ่มระหว่างกิจการคงเหลือจริง = swapCreditGross + payoutRecallGross − settledDeduction */
  intercoNet: Prisma.Decimal;
```

ใหม่:

```ts
  /** 11-2107 typed SWAP_CREDIT gross (Dr−Cr) ของสัญญา */
  swapCreditGross: Prisma.Decimal;
  /** 11-2107 typed PAYOUT_RECALL gross (Dr−Cr) ของสัญญา */
  payoutRecallGross: Prisma.Decimal;
  /** 11-2107 typed DEVICE_RETURN gross (Dr−Cr) ของสัญญา — ค่าเครื่องคืนจากใบรับเครื่องคืน (2026-09-20) */
  deviceReturnGross: Prisma.Decimal;
  /** Σ (swapCreditAmount + recallAmount + deviceReturnAmount) ของ item ทุก itemType ใน batch POSTED */
  settledDeduction: Prisma.Decimal;
  /** ยอดกลุ่มระหว่างกิจการคงเหลือจริง = swapCreditGross + payoutRecallGross + deviceReturnGross − settledDeduction */
  intercoNet: Prisma.Decimal;
```

เดิม (L48-51):

```ts
  /** S21-1104 เฉพาะ SWAP_CREDIT (Cr−Dr) — คู่กระจกของ `swapCreditGross` (B2 2026-08-25) */
  shopMirrorSwapGross: Prisma.Decimal;
  /** S21-1104 เฉพาะ PAYOUT_RECALL (Cr−Dr) — คู่กระจกของ `payoutRecallGross` (B2 2026-08-25) */
  shopMirrorRecallGross: Prisma.Decimal;
```

ใหม่:

```ts
  /** S21-1104 เฉพาะ SWAP_CREDIT (Cr−Dr) — คู่กระจกของ `swapCreditGross` (B2 2026-08-25) */
  shopMirrorSwapGross: Prisma.Decimal;
  /** S21-1104 เฉพาะ PAYOUT_RECALL (Cr−Dr) — คู่กระจกของ `payoutRecallGross` (B2 2026-08-25) */
  shopMirrorRecallGross: Prisma.Decimal;
  /** S21-1104 เฉพาะ DEVICE_RETURN (Cr−Dr) — คู่กระจกของ `deviceReturnGross` (รวมใน `shopMirrorGross` — กลุ่ม interco) */
  shopMirrorDeviceReturnGross: Prisma.Decimal;
```

เดิม (L206-207):

```ts
  /** Σ (swapCreditAmount + recallAmount) ของ item ทุกใบใน batch POSTED */
  settledDeduction: Prisma.Decimal;
```

ใหม่:

```ts
  /** Σ (swapCreditAmount + recallAmount + deviceReturnAmount) ของ item ทุกใบใน batch POSTED */
  settledDeduction: Prisma.Decimal;
```

เดิม (L299-302):

```ts
export type NegativeCheckable = Pick<
  ShopReceivableAgingRow,
  'intercoNet' | 'shopCollect' | 'shopMirrorNet' | 'shopMirrorCollectGross' | 'legacyOneBook'
>;
```

ใหม่:

```ts
export type NegativeCheckable = Pick<
  ShopReceivableAgingRow,
  | 'intercoNet'
  | 'shopCollect'
  | 'shopMirrorNet'
  | 'shopMirrorCollectGross'
  | 'deviceReturnGross'
  | 'shopMirrorDeviceReturnGross'
  | 'legacyOneBook'
>;
```

เดิม (L346-355 ท้าย `negativeTypedFields`):

```ts
  // ขาคู่ SHOP ของ SHOP_COLLECT (S21-1104, 2026-09-05) — ด่านใน shopCollectSettlement กันล้างเกินผ่านแอป
  // แต่ JV มือที่ stamp SHOP_COLLECT ยังทำให้ติดลบได้ ต้องเห็นที่ NEGATIVE_TYPED เหมือนช่องอื่น
  if (row.shopMirrorCollectGross.lt(neg)) {
    out.push({
      field: 'shopMirrorCollectGross',
      label: 'กระจกฝั่ง SHOP — หน้าร้านรับแทน (S21-1104)',
      value: row.shopMirrorCollectGross,
    });
  }
  return out;
```

ใหม่:

```ts
  // ขาคู่ SHOP ของ SHOP_COLLECT (S21-1104, 2026-09-05) — ด่านใน shopCollectSettlement กันล้างเกินผ่านแอป
  // แต่ JV มือที่ stamp SHOP_COLLECT ยังทำให้ติดลบได้ ต้องเห็นที่ NEGATIVE_TYPED เหมือนช่องอื่น
  if (row.shopMirrorCollectGross.lt(neg)) {
    out.push({
      field: 'shopMirrorCollectGross',
      label: 'กระจกฝั่ง SHOP — หน้าร้านรับแทน (S21-1104)',
      value: row.shopMirrorCollectGross,
    });
  }
  // ค่าเครื่องคืน (2026-09-20 §6.2): typed gross ต้องไม่ติดลบเลย — ขา Cr ของรอบจ่ายไม่ stamp
  // (ไม่ลด typed) และเส้นทางรับเงินสด (settleDeductionCash) มีด่าน amount ≤ net ⇒ ติดลบ =
  // JV มือ/ล้างเกิน. เช็คแยกช่องเพราะ intercoNet รวมสามประเภท — ค่าติดลบของประเภทนี้ถูก
  // ยอดบวกของประเภทอื่นกลบได้
  if (row.deviceReturnGross.lt(neg)) {
    out.push({
      field: 'deviceReturnGross',
      label: 'ค่าเครื่องคืน (11-2107)',
      value: row.deviceReturnGross,
    });
  }
  if (row.shopMirrorDeviceReturnGross.lt(neg)) {
    out.push({
      field: 'shopMirrorDeviceReturnGross',
      label: 'กระจกฝั่ง SHOP — ค่าเครื่องคืน (S21-1104)',
      value: row.shopMirrorDeviceReturnGross,
    });
  }
  return out;
```

เดิม (L382-399 — typed conds):

```ts
const LEGACY_SWAP_COND = Prisma.sql`((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
         AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')`;
// explicit stamp **ชนะ** flow fallback (Phase 4 Task 6) — mirror
// `classifyShopReceivable` ที่เช็ค EXPLICIT ก่อน FLOW_MAP เหมือนที่
// SHOP_COLLECT_COND ทำอยู่แล้ว. ไม่งั้น JE รูป A.3 ที่ stamp ประเภทอื่นจะถูกนับ
// ทั้ง swap_gross และ recall_gross/shop_collect พร้อมกัน ⇒ intercoNet บวมเท่าตัว
const SWAP_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR ${LEGACY_SWAP_COND})`;
const RECALL_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL')`;
const SHOP_COLLECT_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT'))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`;
```

ใหม่:

```ts
const LEGACY_SWAP_COND = Prisma.sql`((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 (${Prisma.join([...SHOP_RECEIVABLE_TYPES])}))
         AND je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')`;
// explicit stamp **ชนะ** flow fallback (Phase 4 Task 6) — mirror
// `classifyShopReceivable` ที่เช็ค EXPLICIT ก่อน FLOW_MAP เหมือนที่
// SHOP_COLLECT_COND ทำอยู่แล้ว. ไม่งั้น JE รูป A.3 ที่ stamp ประเภทอื่นจะถูกนับ
// ทั้ง swap_gross และ recall_gross/shop_collect พร้อมกัน ⇒ intercoNet บวมเท่าตัว
const SWAP_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR ${LEGACY_SWAP_COND})`;
const RECALL_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL')`;
// ค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20) — explicit stamp เท่านั้น, twin ของ
// deviceReturnFinanceBalance; JP5 ยัง stamp shopReceivable '11-2107' (marker เก่า) จึงต้อง
// อยู่ใน IN-list ของ SHOP_COLLECT_COND ไม่งั้นถูกนับซ้ำเป็น SHOP_COLLECT
const DEVICE_RETURN_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'DEVICE_RETURN')`;
// กลุ่มระหว่างกิจการ (intercoNet / interco_oldest / financeLensTotal) = 3 ประเภทนี้
const INTERCO_COND = Prisma.sql`(${SWAP_COND} OR ${RECALL_COND} OR ${DEVICE_RETURN_COND})`;
const SHOP_COLLECT_COND = Prisma.sql`(je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
         OR ((je.metadata->>'shopReceivableType' IS NULL
              OR je.metadata->>'shopReceivableType' NOT IN
                 (${Prisma.join([...SHOP_RECEIVABLE_TYPES])}))
             AND (je.metadata->>'collectedByShop' = 'true'
                  OR je.metadata->>'shopReceivable' = '11-2107'
                  OR je.metadata->>'flow' = 'shop-collect-settlement')))`;
```

เดิม (L409-417):

```ts
interface FinanceAgingRow {
  contract_id: string | null;
  swap_gross: unknown;
  recall_gross: unknown;
  shop_collect: unknown;
  legacy_swap_gross: unknown;
  interco_oldest: Date | null;
  collect_oldest: Date | null;
}
```

ใหม่:

```ts
interface FinanceAgingRow {
  contract_id: string | null;
  swap_gross: unknown;
  recall_gross: unknown;
  device_return_gross: unknown;
  shop_collect: unknown;
  legacy_swap_gross: unknown;
  interco_oldest: Date | null;
  collect_oldest: Date | null;
}
```

เดิม (L536-553 — Query A):

```ts
    const financeRows = await this.prisma.$queryRaw<FinanceAgingRow[]>(Prisma.sql`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(CASE WHEN ${SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS swap_gross,
             COALESCE(SUM(CASE WHEN ${RECALL_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS recall_gross,
             COALESCE(SUM(CASE WHEN ${SHOP_COLLECT_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS shop_collect,
             COALESCE(SUM(CASE WHEN ${LEGACY_SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS legacy_swap_gross,
             MIN(CASE WHEN jl.debit > 0 AND (${SWAP_COND} OR ${RECALL_COND}) THEN je.posted_at END) AS interco_oldest,
             MIN(CASE WHEN jl.debit > 0 AND ${SHOP_COLLECT_COND} THEN je.posted_at END) AS collect_oldest
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (${SWAP_COND} OR ${RECALL_COND} OR ${SHOP_COLLECT_COND})
      GROUP BY 1
    `);
```

ใหม่:

```ts
    const financeRows = await this.prisma.$queryRaw<FinanceAgingRow[]>(Prisma.sql`
      SELECT je.metadata->>'contractId' AS contract_id,
             COALESCE(SUM(CASE WHEN ${SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS swap_gross,
             COALESCE(SUM(CASE WHEN ${RECALL_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS recall_gross,
             COALESCE(SUM(CASE WHEN ${DEVICE_RETURN_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS device_return_gross,
             COALESCE(SUM(CASE WHEN ${SHOP_COLLECT_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS shop_collect,
             COALESCE(SUM(CASE WHEN ${LEGACY_SWAP_COND} THEN jl.debit - jl.credit ELSE 0 END), 0)::decimal AS legacy_swap_gross,
             MIN(CASE WHEN jl.debit > 0 AND ${INTERCO_COND} THEN je.posted_at END) AS interco_oldest,
             MIN(CASE WHEN jl.debit > 0 AND ${SHOP_COLLECT_COND} THEN je.posted_at END) AS collect_oldest
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = '11-2107'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        AND je.metadata->>'contractId' IS NOT NULL
        AND (${INTERCO_COND} OR ${SHOP_COLLECT_COND})
      GROUP BY 1
    `);
```

เดิม (L555-606 — Query B + maps):

```ts
    // Query B — S21-1104 group by conditional key (SWAP_CREDIT → newContractId,
    // อื่น → contractId), Σ(Cr−Dr). WHERE จำกัดสองประเภท = union ของ twins
    // `swapCreditShopBalance` + `recallShopBalance` ตรงตัว.
    const shopRows = await this.prisma.$queryRaw<
      Array<{
        contract_id: string | null;
        mirror_gross: unknown;
        mirror_swap: unknown;
        mirror_recall: unknown;
        mirror_collect: unknown;
      }>
    >(Prisma.sql`
      SELECT ${SHOP_KEY} AS contract_id,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL')
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_gross,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_swap,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_recall,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_collect
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-1104'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        -- SHOP_COLLECT (2026-09-05): ขาคู่ SHOP ของการยึด — เก็บแยกคอลัมน์ ไม่เข้า mirror_gross
        AND je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT')
        AND (${SHOP_KEY}) IS NOT NULL
      GROUP BY 1
    `);
    const shopByContract = new Map<string, Prisma.Decimal>();
    // B2 (ผู้สอบ 2026-08-25): "ต้องแยกแสดง" — ฝั่ง 11-2107 แยก 3 ประเภทมานานแล้ว
    // แต่ฝั่ง S21-1104 เคยรวมเป็นก้อนเดียว ⇒ แยกให้ตรงกันทั้งสองสมุด
    //
    // ปลอดภัยเพราะ JE ที่ติด stamp แต่ละใบมีประเภทเดียวเสมอ (A.4 = SWAP_CREDIT,
    // C-2 redirect = PAYOUT_RECALL, settleRecallCash = PAYOUT_RECALL) ส่วนใบรอบจ่าย
    // ที่ผสมสองประเภทในใบเดียว **ไม่ stamp โดยตั้งใจ** จึงไม่เข้า WHERE ของคิวรีนี้อยู่แล้ว
    const shopSwapByContract = new Map<string, Prisma.Decimal>();
    const shopRecallByContract = new Map<string, Prisma.Decimal>();
    const shopCollectMirrorByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopRows) {
      if (!row.contract_id) continue;
      shopByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_gross ?? 0)));
      shopSwapByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_swap ?? 0)));
      shopRecallByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_recall ?? 0)));
      shopCollectMirrorByContract.set(
        row.contract_id,
        new Prisma.Decimal(String(row.mirror_collect ?? 0)),
      );
    }
```

ใหม่:

```ts
    // Query B — S21-1104 group by conditional key (SWAP_CREDIT → newContractId,
    // อื่น → contractId), Σ(Cr−Dr). WHERE = ทุกประเภทใน SHOP_RECEIVABLE_TYPES = union ของ
    // twins `swapCreditShopBalance` + `recallShopBalance` + `deviceReturnShopBalance` +
    // `shopCollectShopBalance` ตรงตัว.
    const shopRows = await this.prisma.$queryRaw<
      Array<{
        contract_id: string | null;
        mirror_gross: unknown;
        mirror_swap: unknown;
        mirror_recall: unknown;
        mirror_device_return: unknown;
        mirror_collect: unknown;
      }>
    >(Prisma.sql`
      SELECT ${SHOP_KEY} AS contract_id,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL', 'DEVICE_RETURN')
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_gross,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_swap,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_recall,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'DEVICE_RETURN'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_device_return,
             COALESCE(SUM(CASE WHEN je.metadata->>'shopReceivableType' = 'SHOP_COLLECT'
                          THEN jl.credit - jl.debit ELSE 0 END), 0)::decimal AS mirror_collect
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.account_code = 'S21-1104'
        AND jl.deleted_at IS NULL
        AND je.status = 'POSTED'
        AND je.deleted_at IS NULL
        -- SHOP_COLLECT (2026-09-05): ขาคู่ SHOP ของการยึดยุคก่อน — เก็บแยกคอลัมน์ ไม่เข้า mirror_gross
        -- DEVICE_RETURN (2026-09-20): ขาคู่ SHOP ของใบรับเครื่องคืน — เข้า mirror_gross (กลุ่ม interco ล้างผ่านรอบจ่าย)
        AND je.metadata->>'shopReceivableType' IN (${Prisma.join([...SHOP_RECEIVABLE_TYPES])})
        AND (${SHOP_KEY}) IS NOT NULL
      GROUP BY 1
    `);
    const shopByContract = new Map<string, Prisma.Decimal>();
    // B2 (ผู้สอบ 2026-08-25): "ต้องแยกแสดง" — ฝั่ง 11-2107 แยกประเภทมานานแล้ว
    // แต่ฝั่ง S21-1104 เคยรวมเป็นก้อนเดียว ⇒ แยกให้ตรงกันทั้งสองสมุด
    //
    // ปลอดภัยเพราะ JE ที่ติด stamp แต่ละใบมีประเภทเดียวเสมอ (A.4 = SWAP_CREDIT,
    // C-2 redirect = PAYOUT_RECALL, settleDeductionCash = PAYOUT_RECALL/DEVICE_RETURN,
    // JP5 intake = DEVICE_RETURN) ส่วนใบรอบจ่ายที่ผสมหลายประเภทในใบเดียว **ไม่ stamp
    // โดยตั้งใจ** จึงไม่เข้า WHERE ของคิวรีนี้อยู่แล้ว
    const shopSwapByContract = new Map<string, Prisma.Decimal>();
    const shopRecallByContract = new Map<string, Prisma.Decimal>();
    const shopDeviceReturnByContract = new Map<string, Prisma.Decimal>();
    const shopCollectMirrorByContract = new Map<string, Prisma.Decimal>();
    for (const row of shopRows) {
      if (!row.contract_id) continue;
      shopByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_gross ?? 0)));
      shopSwapByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_swap ?? 0)));
      shopRecallByContract.set(row.contract_id, new Prisma.Decimal(String(row.mirror_recall ?? 0)));
      shopDeviceReturnByContract.set(
        row.contract_id,
        new Prisma.Decimal(String(row.mirror_device_return ?? 0)),
      );
      shopCollectMirrorByContract.set(
        row.contract_id,
        new Prisma.Decimal(String(row.mirror_collect ?? 0)),
      );
    }
```

เดิม (L630-645 — Query C):

```ts
    const deductionGroups = await this.prisma.interCoSettlementItem.groupBy({
      by: ['contractId'],
      where: {
        contractId: { in: universeIds },
        deletedAt: null,
        batch: { status: 'POSTED', deletedAt: null },
      },
      _sum: { swapCreditAmount: true, recallAmount: true },
    });
    const deductionByContract = new Map<string, Prisma.Decimal>();
    for (const g of deductionGroups) {
      deductionByContract.set(
        g.contractId,
        new Prisma.Decimal(g._sum.swapCreditAmount ?? 0).plus(g._sum.recallAmount ?? 0),
      );
    }
```

ใหม่:

```ts
    const deductionGroups = await this.prisma.interCoSettlementItem.groupBy({
      by: ['contractId'],
      where: {
        contractId: { in: universeIds },
        deletedAt: null,
        batch: { status: 'POSTED', deletedAt: null },
      },
      _sum: { swapCreditAmount: true, recallAmount: true, deviceReturnAmount: true },
    });
    const deductionByContract = new Map<string, Prisma.Decimal>();
    for (const g of deductionGroups) {
      deductionByContract.set(
        g.contractId,
        new Prisma.Decimal(g._sum.swapCreditAmount ?? 0)
          .plus(g._sum.recallAmount ?? 0)
          .plus(g._sum.deviceReturnAmount ?? 0),
      );
    }
```

เดิม (L670-678 ในลูป rows):

```ts
      const fin = financeByContract.get(contractId);
      const swapCreditGross = new Prisma.Decimal(String(fin?.swap_gross ?? 0));
      const payoutRecallGross = new Prisma.Decimal(String(fin?.recall_gross ?? 0));
      const shopCollect = new Prisma.Decimal(String(fin?.shop_collect ?? 0));
      const legacySwapGross = new Prisma.Decimal(String(fin?.legacy_swap_gross ?? 0));
      const settledDeduction = deductionByContract.get(contractId) ?? zero;
      const shopGross = shopByContract.get(contractId) ?? zero;

      const intercoNet = swapCreditGross.plus(payoutRecallGross).minus(settledDeduction);
```

ใหม่:

```ts
      const fin = financeByContract.get(contractId);
      const swapCreditGross = new Prisma.Decimal(String(fin?.swap_gross ?? 0));
      const payoutRecallGross = new Prisma.Decimal(String(fin?.recall_gross ?? 0));
      const deviceReturnGross = new Prisma.Decimal(String(fin?.device_return_gross ?? 0));
      const shopCollect = new Prisma.Decimal(String(fin?.shop_collect ?? 0));
      const legacySwapGross = new Prisma.Decimal(String(fin?.legacy_swap_gross ?? 0));
      const settledDeduction = deductionByContract.get(contractId) ?? zero;
      const shopGross = shopByContract.get(contractId) ?? zero;

      // invariant ถือที่ระดับสัญญา (ไม่ใช่ระดับประเภท) — สามประเภทของกลุ่ม interco รวมก่อนหัก
      const intercoNet = swapCreditGross
        .plus(payoutRecallGross)
        .plus(deviceReturnGross)
        .minus(settledDeduction);
```

เดิม (L691-699 ใน `rows.push`):

```ts
        swapCreditGross,
        payoutRecallGross,
        settledDeduction,
        intercoNet,
        shopCollect,
        shopMirrorGross: shopGross,
        shopMirrorSwapGross: shopSwapByContract.get(contractId) ?? zero,
        shopMirrorRecallGross: shopRecallByContract.get(contractId) ?? zero,
        shopMirrorCollectGross: shopCollectMirrorByContract.get(contractId) ?? zero,
```

ใหม่:

```ts
        swapCreditGross,
        payoutRecallGross,
        deviceReturnGross,
        settledDeduction,
        intercoNet,
        shopCollect,
        shopMirrorGross: shopGross,
        shopMirrorSwapGross: shopSwapByContract.get(contractId) ?? zero,
        shopMirrorRecallGross: shopRecallByContract.get(contractId) ?? zero,
        shopMirrorDeviceReturnGross: shopDeviceReturnByContract.get(contractId) ?? zero,
        shopMirrorCollectGross: shopCollectMirrorByContract.get(contractId) ?? zero,
```

เดิม (L861-869 ใน `getTypedAccountDrift`):

```ts
    // Σ deduction ของ item ทุกใบใน batch POSTED = ขาล้างที่ไม่ stamp ทั้งสองสมุด
    // (ทุกแถวหักลง `Cr 11-2107` ฝั่ง FINANCE และ `Dr S21-1104` ฝั่ง SHOP ยอดเท่ากัน)
    const agg = await this.prisma.interCoSettlementItem.aggregate({
      where: { deletedAt: null, batch: { status: 'POSTED', deletedAt: null } },
      _sum: { swapCreditAmount: true, recallAmount: true },
    });
    const settledDeduction = new Prisma.Decimal(agg._sum.swapCreditAmount ?? 0).plus(
      agg._sum.recallAmount ?? 0,
    );
```

ใหม่:

```ts
    // Σ deduction ของ item ทุกใบใน batch POSTED = ขาล้างที่ไม่ stamp ทั้งสองสมุด
    // (ทุกแถวหักลง `Cr 11-2107` ฝั่ง FINANCE และ `Dr S21-1104` ฝั่ง SHOP ยอดเท่ากัน —
    // รวมแถว DEVICE_RETURN ของใบรับเครื่องคืน 2026-09-20)
    const agg = await this.prisma.interCoSettlementItem.aggregate({
      where: { deletedAt: null, batch: { status: 'POSTED', deletedAt: null } },
      _sum: { swapCreditAmount: true, recallAmount: true, deviceReturnAmount: true },
    });
    const settledDeduction = new Prisma.Decimal(agg._sum.swapCreditAmount ?? 0)
      .plus(agg._sum.recallAmount ?? 0)
      .plus(agg._sum.deviceReturnAmount ?? 0);
```

เดิม (L892 ใน `financeLensTotal`):

```ts
        AND (${SWAP_COND} OR ${RECALL_COND} OR ${SHOP_COLLECT_COND})
```

ใหม่:

```ts
        AND (${INTERCO_COND} OR ${SHOP_COLLECT_COND})
```

เดิม (L909 ใน `shopLensTotal`):

```ts
        AND je.metadata->>'shopReceivableType' IN ('SWAP_CREDIT', 'PAYOUT_RECALL', 'SHOP_COLLECT')
```

ใหม่:

```ts
        AND je.metadata->>'shopReceivableType' IN (${Prisma.join([...SHOP_RECEIVABLE_TYPES])})
```

`crons/shop-receivable-aging.cron.ts` — เดิม (L322-328):

```ts
      if (v.arm === 'INTERCO') {
        lines.push(
          `   - เครดิตเปลี่ยนเครื่อง (SWAP_CREDIT) ${formatAmount(row.swapCreditGross)} บาท · ` +
            `เรียกคืนจากยกเลิก (PAYOUT_RECALL) ${formatAmount(row.payoutRecallGross)} บาท · ` +
            `หักไปแล้วในรอบจ่าย ${formatAmount(row.settledDeduction)} บาท`,
        );
      }
```

ใหม่:

```ts
      if (v.arm === 'INTERCO') {
        lines.push(
          `   - เครดิตเปลี่ยนเครื่อง (SWAP_CREDIT) ${formatAmount(row.swapCreditGross)} บาท · ` +
            `เรียกคืนจากยกเลิก (PAYOUT_RECALL) ${formatAmount(row.payoutRecallGross)} บาท · ` +
            `ค่าเครื่องคืน (DEVICE_RETURN) ${formatAmount(row.deviceReturnGross)} บาท · ` +
            `หักไปแล้วในรอบจ่าย ${formatAmount(row.settledDeduction)} บาท`,
        );
      }
```

(`howTo` ของแขน INTERCO บรรทัด 278-280 **ไม่แก้** — ข้อความเดิม "หักกลบในรอบจ่าย INTER-CO … หรือรับเงินสดคืนจากหน้าร้าน" ครอบค่าเครื่องคืนอยู่แล้ว และ cron spec assert ข้อความนี้)

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (10 tests)

Run: `npm --prefix apps/api test -- src/modules/interco-settlement` — Expected: PASS (cron specs compile ผ่านหลังเติม 2 field ใน `makeRow`; พฤติกรรมเดิมทุกเทสไม่เปลี่ยน)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts && cd ../..` — Expected: PASS (regression ของรายงานอายุเดิม — ไม่มี JE ประเภท DEVICE_RETURN ใน fixture ของมัน ทุกยอดจึงเท่าเดิม)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit.**

---

### Task 6: ด่านใบรับโอนจากหน้าร้าน — `ShopCollectSettlementTemplate` (`typeStamp` + §6.4 + Σ deduction รวม `deviceReturnAmount`)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts:1-8` (import), `:23-33` (`typeStamp` union → type ใหม่ + ตารางข้อความ), `:46-57` (class doc — เพิ่ม guard), `:128` (typeStamp const), หลัง `:181` (ด่านใหม่), `:213-235` (deductionItems), `:284-324` (descriptions)
- Create (vitest): `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts` (ต้นแบบ: `shop-collect-shop-legs.template.spec.ts` — vitest เพราะ jest ignore ไฟล์ใต้ `cpa-templates/`; CI glob `FILES=$(ls src/modules/journal/cpa-templates/*.spec.ts | grep -v contract-cancellation…)` ที่ `deploy-gcp.yml:263` ครอบไฟล์ใหม่อัตโนมัติ)
- Test (vitest): `interco-device-return.integration.spec.ts` (describe Task 6)

**Interfaces:**
- Consumes: `deviceReturnFinanceBalance` (Task 3), `deviceReturnAmount` (Task 1)
- Produces: `export type ShopCollectTypeStamp = 'SHOP_COLLECT' | 'PAYOUT_RECALL' | 'DEVICE_RETURN'` · `ShopCollectSettlementInput.typeStamp?: ShopCollectTypeStamp` · ด่าน: เมื่อ `typeStamp !== 'DEVICE_RETURN'` และ `deviceReturnFinanceBalance(client, contractId) > 0` → `BadRequestException('สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น')` (หลัง requestId idempotency, ก่อนคำนวณ outstanding) · ข้อความ JE ของ DEVICE_RETURN: description `รับเงินค่าเครื่องคืนจากหน้าร้าน — สัญญา ${label} (ล้าง 11-2107 ค่าเครื่องคืน)`, cash line `รับเงินค่าเครื่องคืนจากหน้าร้าน ${amountStr} ฿`, receivable line `ล้างลูกหนี้-หน้าร้าน (ค่าเครื่องคืน)` — Task 9 ใช้ผ่าน `typeStamp: 'DEVICE_RETURN'`
- ผู้เรียก production เดิม (`ContractPaymentService.shopCollectSettlement` — ไม่ส่ง typeStamp) ได้ด่านนี้ทันที = ใบรับโอนจากหน้าร้านล้างค่าเครื่องคืนไม่ได้ (spec §6.4)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) สร้าง `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopCollectSettlementTemplate } from './shop-collect-settlement.template';

/**
 * ด่านกันล้างซ้ำสองทาง (ใบรับเครื่องคืน 2026-09-20 §6.4) + Σ deduction รวม deviceReturnAmount.
 * Runner: vitest — ไฟล์ใต้ cpa-templates/ ถูก jest ignore (testPathIgnorePatterns) และ CI รันด้วย glob
 * `src/modules/journal/cpa-templates/*.spec.ts` (deploy-gcp.yml L263) เหมือน shop-collect-shop-legs.template.spec.ts.
 * Prisma mock ทั้งก้อน: `$queryRaw` = deviceReturnFinanceBalance (sumTyped), `journalLine.findMany` =
 * outstanding 11-2107 ต่อสัญญา, `interCoSettlementItem.findMany` = deduction ของ batch,
 * `contract.findUnique` = resolveContractLabel, `journalEntry.findFirst` = requestId dedupe (null = ไม่ซ้ำ).
 */
const D = (v: string | number) => new Prisma.Decimal(v);

function build(opts: {
  deviceReturnBalance: string;
  lines?: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>;
  deductionItems?: Array<{
    swapCreditAmount: Prisma.Decimal;
    recallAmount: Prisma.Decimal;
    deviceReturnAmount: Prisma.Decimal;
    batch: { status: string; batchNumber: string };
  }>;
}) {
  const createAndPost = vi.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202609-00001' });
  const prisma = {
    journalEntry: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue([{ balance: opts.deviceReturnBalance }]),
    journalLine: { findMany: vi.fn().mockResolvedValue(opts.lines ?? []) },
    interCoSettlementItem: { findMany: vi.fn().mockResolvedValue(opts.deductionItems ?? []) },
    contract: { findUnique: vi.fn().mockResolvedValue({ contractNumber: 'DRTEST-001' }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const template = new ShopCollectSettlementTemplate({ createAndPost } as any, prisma as any);
  return { template, prisma, createAndPost };
}

const baseInput = {
  contractId: 'c-1',
  depositAccountCode: '11-1201',
  amount: 7000,
  requestId: 'req-1',
};
const GUARD_MSG =
  'สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น';
const lineTuples = (input: {
  lines: Array<{ accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description?: string }>;
}) => input.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2), l.description]);

describe('ShopCollectSettlementTemplate — ด่านค่าเครื่องคืน (§6.4)', () => {
  it('typeStamp เริ่มต้น (SHOP_COLLECT) + มีค่าเครื่องคืนค้าง → 400 ชี้ทางรอบจ่าย ไม่โพสต์ ไม่คำนวณ outstanding', async () => {
    const { template, prisma, createAndPost } = build({
      deviceReturnBalance: '7000',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    await expect(template.execute(baseInput)).rejects.toThrow(BadRequestException);
    await expect(template.execute(baseInput)).rejects.toThrow(GUARD_MSG);
    expect(createAndPost).not.toHaveBeenCalled();
    expect(prisma.journalLine.findMany).not.toHaveBeenCalled(); // ด่านอยู่ก่อน outstanding
    expect(prisma.journalEntry.findFirst).toHaveBeenCalled(); // แต่หลัง requestId idempotency
  });

  it('typeStamp PAYOUT_RECALL + มีค่าเครื่องคืนค้าง → ปฏิเสธเช่นกัน (ยกเว้นเฉพาะ DEVICE_RETURN)', async () => {
    const { template, createAndPost } = build({ deviceReturnBalance: '7000' });
    await expect(template.execute({ ...baseInput, typeStamp: 'PAYOUT_RECALL' })).rejects.toThrow(
      GUARD_MSG,
    );
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('typeStamp DEVICE_RETURN → ข้ามด่าน แล้วโพสต์ใบที่ stamp DEVICE_RETURN + คำอธิบายค่าเครื่องคืน', async () => {
    const { template, createAndPost } = build({
      deviceReturnBalance: '7000',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    const result = await template.execute({ ...baseInput, typeStamp: 'DEVICE_RETURN' });
    expect(result).toEqual({ entryNo: 'JE-202609-00001', deduped: false });

    const input = createAndPost.mock.calls[0][0];
    expect(input.description).toBe(
      'รับเงินค่าเครื่องคืนจากหน้าร้าน — สัญญา DRTEST-001 (ล้าง 11-2107 ค่าเครื่องคืน)',
    );
    expect(input.reference).toBe('c-1:shop-collect-settlement:req-1');
    expect(input.metadata).toMatchObject({
      tag: 'SCS',
      flow: 'shop-collect-settlement',
      contractId: 'c-1',
      amount: '7000.00',
      depositAccountCode: '11-1201',
      requestId: 'req-1',
      shopReceivableType: 'DEVICE_RETURN',
      idempotencyKey: 'c-1:req-1',
    });
    expect(lineTuples(input)).toEqual([
      ['11-1201', '7000.00', '0.00', 'รับเงินค่าเครื่องคืนจากหน้าร้าน 7000.00 ฿'],
      ['11-2107', '0.00', '7000.00', 'ล้างลูกหนี้-หน้าร้าน (ค่าเครื่องคืน)'],
    ]);
  });

  it('ไม่มีค่าเครื่องคืนค้าง (0) → ด่านเงียบ ไปต่อด่านเดิม (ไม่มียอด 11-2107 ค้าง)', async () => {
    const { template } = build({ deviceReturnBalance: '0' });
    await expect(template.execute(baseInput)).rejects.toThrow(/ไม่มียอด 11-2107 ค้างชำระ/);
  });

  it('outstanding หัก deviceReturnAmount ของ batch POSTED ด้วย + where.OR ครอบคอลัมน์ใหม่', async () => {
    const { template, prisma } = build({
      deviceReturnBalance: '7000',
      lines: [{ debit: D(7000), credit: D(0) }],
      deductionItems: [
        {
          swapCreditAmount: D(0),
          recallAmount: D(0),
          deviceReturnAmount: D(7000),
          batch: { status: 'POSTED', batchNumber: 'IC-20260920-0001' },
        },
      ],
    });
    await expect(template.execute({ ...baseInput, typeStamp: 'DEVICE_RETURN' })).rejects.toThrow(
      /ไม่มียอด 11-2107 ค้างชำระ/,
    );
    const where = prisma.interCoSettlementItem.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { swapCreditAmount: { gt: 0 } },
      { recallAmount: { gt: 0 } },
      { deviceReturnAmount: { gt: 0 } },
    ]);
    const select = prisma.interCoSettlementItem.findMany.mock.calls[0][0].select;
    expect(select.deviceReturnAmount).toBe(true);
  });

  it('พฤติกรรมเดิม (SHOP_COLLECT ไม่มีค่าเครื่องคืน) byte-identical: คำอธิบาย/stamp เดิม', async () => {
    const { template, createAndPost } = build({
      deviceReturnBalance: '0',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    await template.execute(baseInput);
    const input = createAndPost.mock.calls[0][0];
    expect(input.description).toBe('รับโอนจากหน้าร้าน — สัญญา DRTEST-001 (ล้าง 11-2107)');
    expect(input.metadata.shopReceivableType).toBe('SHOP_COLLECT');
    expect(lineTuples(input)).toEqual([
      ['11-1201', '7000.00', '0.00', 'รับโอนจากหน้าร้าน 7000.00 ฿'],
      ['11-2107', '0.00', '7000.00', 'ล้างลูกหนี้-หน้าร้าน (shop-collect)'],
    ]);
  });

  it('PAYOUT_RECALL ไม่มีค่าเครื่องคืน byte-identical: คำอธิบายเรียกคืนเดิม', async () => {
    const { template, createAndPost } = build({
      deviceReturnBalance: '0',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    await template.execute({ ...baseInput, typeStamp: 'PAYOUT_RECALL' });
    const input = createAndPost.mock.calls[0][0];
    expect(input.description).toBe(
      'รับเงินคืนจากหน้าร้าน — สัญญา DRTEST-001 (ล้าง 11-2107 เรียกคืน)',
    );
    expect(lineTuples(input)).toEqual([
      ['11-1201', '7000.00', '0.00', 'รับเงินคืนจากหน้าร้าน 7000.00 ฿'],
      ['11-2107', '0.00', '7000.00', 'ล้างลูกหนี้-หน้าร้าน (เรียกคืนยกเลิก)'],
    ]);
  });
});
```

(ข) integration — เพิ่ม describe ต่อท้าย describe Task 5 ใน `interco-device-return.integration.spec.ts`:

```ts
  // ===========================================================================
  // Task 6 — ด่านใบรับโอนจากหน้าร้าน (§6.4) ผ่านเส้นทาง production จริง
  // ===========================================================================
  describe('ด่านใบรับโอนจากหน้าร้าน — ShopCollectSettlementTemplate (Task 6)', () => {
    it('สัญญาที่มีค่าเครื่องคืนค้าง → ใบรับโอน (typeStamp เริ่มต้น) ถูกปฏิเสธ และ GL ไม่ขยับ', async () => {
      const id = await seedBaseContract(6, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id);

      await expect(
        shopCollectTemplate.execute({
          contractId: id,
          depositAccountCode: '11-1201',
          amount: 7000,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow(/ค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO/);

      expect((await glContractBalance(prisma, id, '11-2107', 'dr')).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnFinanceBalance(prisma, id)).toFixed(2)).toBe('7000.00');
      // ยังอยู่ในคิวค่าเครื่องคืน — ทางล้างเดียวคือรอบจ่าย/รับเงินสด (Task 7-9)
      const rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === id)).toBe(true);
    });
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `cd apps/api && npx vitest run src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts && cd ../..`
Expected: FAIL — เทส 1/2 ได้ `/ไม่มียอด 11-2107 ค้างชำระ/` หรือโพสต์สำเร็จแทน GUARD_MSG; เทส DEVICE_RETURN ได้ description แบบ SHOP_COLLECT; `where.OR` มี 2 สมาชิก (TS ก็แดงที่ `typeStamp: 'DEVICE_RETURN'` — vitest ไม่ type-check แต่ `check-types` จะจับ)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — `promise resolved instead of rejecting` (ใบรับโอนโพสต์ผ่าน) และ GL 11-2107 ของสัญญากลายเป็น 0.00

- [ ] **Step 3: แก้ template**

เดิม (L1-8):

```ts
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';
import { resolveContractLabel } from '../contract-label.util';
```

ใหม่:

```ts
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';
import { resolveContractLabel } from '../contract-label.util';
import { deviceReturnFinanceBalance } from '../../interco-settlement/interco-typed-balance';
```

เดิม (L23-33):

```ts
  /**
   * ประเภทลูกหนี้ 11-2107 ที่ใบนี้ล้าง (Phase 3 Task 6 — เส้นทางรับเงินสดคืน):
   * default `'SHOP_COLLECT'` — caller เดิม (JP4/shop-collect settle) ต้องได้
   * พฤติกรรม byte-identical. `'PAYOUT_RECALL'` ใช้โดย
   * `IntercoSettlementService.settleRecallCash` เท่านั้น — stamp ลง
   * `metadata.shopReceivableType` ให้ typed recall lens หักยอดต่อสัญญาได้ตรงประเภท.
   * Guards/idempotency/outstanding computation ไม่แตกต่างตามประเภท (untyped
   * per-contract Σ − POSTED deductions เหมือนเดิมทุกเส้นทาง).
   */
  typeStamp?: 'SHOP_COLLECT' | 'PAYOUT_RECALL';
}
```

ใหม่:

```ts
  /**
   * ประเภทลูกหนี้ 11-2107 ที่ใบนี้ล้าง (Phase 3 Task 6 — เส้นทางรับเงินสดคืน):
   * default `'SHOP_COLLECT'` — caller เดิม (JP4/shop-collect settle) ต้องได้
   * พฤติกรรม byte-identical. `'PAYOUT_RECALL'` / `'DEVICE_RETURN'` ใช้โดย
   * `IntercoSettlementService.settleDeductionCash` เท่านั้น — stamp ลง
   * `metadata.shopReceivableType` ให้ typed lens หักยอดต่อสัญญาได้ตรงประเภท.
   * Guards/idempotency/outstanding computation ไม่แตกต่างตามประเภท (untyped
   * per-contract Σ − POSTED deductions เหมือนเดิมทุกเส้นทาง) — ยกเว้นด่าน §6.4
   * (ค่าเครื่องคืนค้าง) ซึ่งยกเว้นให้เฉพาะ `'DEVICE_RETURN'` (ดู `execute`).
   */
  typeStamp?: ShopCollectTypeStamp;
}

/** ประเภทที่ใบรับโอน/รับเงินสดล้างได้ — ทุกค่าต้องเป็นสมาชิกของ SHOP_RECEIVABLE_TYPES */
export type ShopCollectTypeStamp = 'SHOP_COLLECT' | 'PAYOUT_RECALL' | 'DEVICE_RETURN';

/** ข้อความ JE ต่อประเภท — สองประเภทเดิม byte-identical กับก่อน 2026-09-20 */
const TYPE_TEXT: Record<
  ShopCollectTypeStamp,
  {
    description: (contractLabel: string) => string;
    cashLine: (amountStr: string) => string;
    receivableLine: string;
  }
> = {
  SHOP_COLLECT: {
    description: (label) => `รับโอนจากหน้าร้าน — สัญญา ${label} (ล้าง 11-2107)`,
    cashLine: (amountStr) => `รับโอนจากหน้าร้าน ${amountStr} ฿`,
    receivableLine: 'ล้างลูกหนี้-หน้าร้าน (shop-collect)',
  },
  PAYOUT_RECALL: {
    description: (label) => `รับเงินคืนจากหน้าร้าน — สัญญา ${label} (ล้าง 11-2107 เรียกคืน)`,
    cashLine: (amountStr) => `รับเงินคืนจากหน้าร้าน ${amountStr} ฿`,
    receivableLine: 'ล้างลูกหนี้-หน้าร้าน (เรียกคืนยกเลิก)',
  },
  DEVICE_RETURN: {
    description: (label) =>
      `รับเงินค่าเครื่องคืนจากหน้าร้าน — สัญญา ${label} (ล้าง 11-2107 ค่าเครื่องคืน)`,
    cashLine: (amountStr) => `รับเงินค่าเครื่องคืนจากหน้าร้าน ${amountStr} ฿`,
    receivableLine: 'ล้างลูกหนี้-หน้าร้าน (ค่าเครื่องคืน)',
  },
};
```

เดิม (L46-57 ใน class doc):

```ts
 * Guards:
 *   - depositAccountCode must be in CASH_ACCOUNT_CODES
 *   - outstanding 11-2107 (ΣDr − ΣCr over metadata.contractId, MINUS every
 *     deduction already taken by a POSTED interco batch — batch netting JEs
 *     deliberately carry no metadata.contractId, so "หักแล้ว" is read off
 *     InterCoSettlementItem, never GL metadata) must be > 0
 *   - rejected outright while the contract has a deduction row inside a
 *     PENDING_APPROVAL interco batch (final review C1 ด่าน (ii) — the same
 *     8,000 must not clear via cash here AND via the batch's netting leg;
 *     DRAFT batches don't block: approve's drift guard covers that ordering
 *     and the maker can still edit a DRAFT)
 *   - amount must be ≤ outstanding + 0.01 (over-settle rejected)
```

ใหม่:

```ts
 * Guards:
 *   - depositAccountCode must be in CASH_ACCOUNT_CODES
 *   - (ใบรับเครื่องคืน 2026-09-20 §6.4) rejected outright while the contract has a
 *     typed DEVICE_RETURN balance on 11-2107 and this call is NOT itself the
 *     DEVICE_RETURN cash path (`typeStamp !== 'DEVICE_RETURN'`) — ค่าเครื่องคืนล้างได้
 *     เฉพาะรอบจ่าย INTER-CO หรือ settleDeductionCash; ใบรับโอนที่ stamp ประเภทอื่นจะล้าง
 *     11-2107 (type-blind ด้านล่าง) โดยเลนส์ DEVICE_RETURN ไม่ลด ⇒ รอบจ่ายถัดไปหักซ้ำ
 *   - outstanding 11-2107 (ΣDr − ΣCr over metadata.contractId, MINUS every
 *     deduction already taken by a POSTED interco batch — swap credit, recall AND
 *     device-return columns; batch netting JEs deliberately carry no
 *     metadata.contractId, so "หักแล้ว" is read off InterCoSettlementItem, never
 *     GL metadata) must be > 0
 *   - rejected outright while the contract has a deduction row inside a
 *     PENDING_APPROVAL interco batch (final review C1 ด่าน (ii) — the same
 *     8,000 must not clear via cash here AND via the batch's netting leg;
 *     DRAFT batches don't block: approve's drift guard covers that ordering
 *     and the maker can still edit a DRAFT)
 *   - amount must be ≤ outstanding + 0.01 (over-settle rejected)
```

เดิม (L128):

```ts
    const typeStamp = input.typeStamp ?? 'SHOP_COLLECT';
```

ใหม่:

```ts
    const typeStamp: ShopCollectTypeStamp = input.typeStamp ?? 'SHOP_COLLECT';
    const text = TYPE_TEXT[typeStamp];
```

แทรกหลังบรรทัด 181 (`    }` ปิด `if (input.requestId) {…}`) ก่อนคอมเมนต์ `// ── Compute outstanding 11-2107 for this contract ──` (L183):

```ts

    // ── ด่านกันล้างซ้ำสองทาง (ใบรับเครื่องคืน 2026-09-20 §6.4) ────────────────────
    // ค่าเครื่องคืน (11-2107 typed DEVICE_RETURN) ล้างได้ทาง "หักกลบรอบจ่าย INTER-CO" หรือ
    // "รับเงินสด" (settleDeductionCash — ส่ง typeStamp DEVICE_RETURN มาเอง) เท่านั้น. ใบรับโอน
    // ที่ stamp SHOP_COLLECT/PAYOUT_RECALL ล้าง 11-2107 ทั้งสัญญา (outstanding ด้านล่างเป็น
    // type-blind) แต่เลนส์ DEVICE_RETURN ไม่ลด ⇒ รอบจ่ายถัดไปหักซ้ำ (S21-1104/11-2107 ติดลบ).
    // อยู่หลัง requestId idempotency (retry ของคำขอเดิมต้องคืนผลเดิม) และก่อนคำนวณ outstanding.
    if (typeStamp !== 'DEVICE_RETURN') {
      const deviceReturnOutstanding = await deviceReturnFinanceBalance(client, contractId);
      if (deviceReturnOutstanding.gt(0)) {
        throw new BadRequestException(
          'สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น',
        );
      }
    }
```

เดิม (L213-235):

```ts
    const deductionItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId,
        deletedAt: null,
        OR: [{ swapCreditAmount: { gt: 0 } }, { recallAmount: { gt: 0 } }],
        batch: { status: { in: ['PENDING_APPROVAL', 'POSTED'] }, deletedAt: null },
      },
      select: {
        swapCreditAmount: true,
        recallAmount: true,
        batch: { select: { status: true, batchNumber: true } },
      },
    });
    const openDeduction = deductionItems.find((i) => i.batch.status === 'PENDING_APPROVAL');
    if (openDeduction) {
      throw new BadRequestException(
        `สัญญานี้อยู่ในรอบจ่าย INTER-CO ${openDeduction.batch.batchNumber} ที่รอการอนุมัติและมียอดหักเครดิต — รอผลอนุมัติหรือถอนรอบก่อน`,
      );
    }
    const postedDeductions = deductionItems.reduce(
      (s, i) => s.plus(i.swapCreditAmount.toString()).plus(i.recallAmount.toString()),
      new Decimal(0),
    );
```

ใหม่:

```ts
    const deductionItems = await client.interCoSettlementItem.findMany({
      where: {
        contractId,
        deletedAt: null,
        OR: [
          { swapCreditAmount: { gt: 0 } },
          { recallAmount: { gt: 0 } },
          { deviceReturnAmount: { gt: 0 } },
        ],
        batch: { status: { in: ['PENDING_APPROVAL', 'POSTED'] }, deletedAt: null },
      },
      select: {
        swapCreditAmount: true,
        recallAmount: true,
        deviceReturnAmount: true,
        batch: { select: { status: true, batchNumber: true } },
      },
    });
    const openDeduction = deductionItems.find((i) => i.batch.status === 'PENDING_APPROVAL');
    if (openDeduction) {
      throw new BadRequestException(
        `สัญญานี้อยู่ในรอบจ่าย INTER-CO ${openDeduction.batch.batchNumber} ที่รอการอนุมัติและมียอดหักเครดิต — รอผลอนุมัติหรือถอนรอบก่อน`,
      );
    }
    const postedDeductions = deductionItems.reduce(
      (s, i) =>
        s
          .plus(i.swapCreditAmount.toString())
          .plus(i.recallAmount.toString())
          .plus(i.deviceReturnAmount.toString()),
      new Decimal(0),
    );
```

เดิม (L286-289 ใน `createAndPost`):

```ts
          description:
            typeStamp === 'PAYOUT_RECALL'
              ? `รับเงินคืนจากหน้าร้าน — สัญญา ${contractLabel} (ล้าง 11-2107 เรียกคืน)`
              : `รับโอนจากหน้าร้าน — สัญญา ${contractLabel} (ล้าง 11-2107)`,
```

ใหม่:

```ts
          description: text.description(contractLabel),
```

เดิม (L310-313):

```ts
              description:
                typeStamp === 'PAYOUT_RECALL'
                  ? `รับเงินคืนจากหน้าร้าน ${amountStr} ฿`
                  : `รับโอนจากหน้าร้าน ${amountStr} ฿`,
```

ใหม่:

```ts
              description: text.cashLine(amountStr),
```

เดิม (L319-322):

```ts
              description:
                typeStamp === 'PAYOUT_RECALL'
                  ? 'ล้างลูกหนี้-หน้าร้าน (เรียกคืนยกเลิก)'
                  : 'ล้างลูกหนี้-หน้าร้าน (shop-collect)',
```

ใหม่:

```ts
              description: text.receivableLine,
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `cd apps/api && npx vitest run src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts && cd ../..` — Expected: PASS (7 tests)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (11 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. Regression ของผู้เรียกเดิม (ไม่มี DEVICE_RETURN ในสัญญาของ fixture — ด่านต้องเงียบ): `cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-settlement.integration.spec.ts src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts && cd ../..` — Expected: PASS. **Do NOT commit.**

---

### Task 7: รอบจ่าย INTER-CO — DTO + snapshot แถว `DEVICE_RETURN` + createBatch/updateBatch/submitBatch (clash type-aware)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/dto/create-batch.dto.ts:27-31` (เพิ่ม field ต่อท้าย `recallContractIds`)
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts:32-38` (helpers ระดับ module ต่อท้าย constants), `:49-75` (`BuiltSnapshotItem`/`BuiltSnapshot`), `:107-133` (doc + signature `buildSnapshot`), `:181-191` (item literal SETTLEMENT), `:216-226` (item literal RECALL), หลัง `:228` (block DEVICE_RETURN), `:230-234` (totalDeduction), `:318` + `:350-358` (createBatch), `:378` + `:416-423` (updateBatch), `:445-468` (submitBatch clash)
- Test (jest): `apps/api/src/modules/interco-settlement/interco-settlement.service.spec.ts:117-120` (pendingService mock), `:366` + `:386` (submit fixtures ต้องมี `itemType`), `:574-587` (approve fixture — `deviceReturnAmount`), describe ใหม่
- Test (vitest): `interco-device-return.integration.spec.ts` (describe Task 7)

**Interfaces:**
- Consumes: `getPendingDeviceReturns` / `DeviceReturnCandidate` (Task 4), `deviceReturnAmount` (Task 1)
- Produces: `CreateBatchDto.deviceReturnContractIds?: string[]` · `buildSnapshot(tx, contractIds, recallContractIds?, deviceReturnContractIds?)` สร้าง item `{ itemType: 'DEVICE_RETURN', deviceReturnAmount: net, swapCreditAmount: 0, recallAmount: 0, financedGl: 0, commissionGl: 0, shopFinancedGl: 0, shopCommissionGl: 0, legacyNoShop: false }` · `totalDeduction = Σ swapCreditAmount + recallAmount + deviceReturnAmount` · module helpers `ITEM_ROLE` (`satisfies Record<InterCoItemType, 'PAYABLE' | 'DEDUCTION_ONLY'>`), `isPayableRow`, `sumDeductions`, `buildClashConditions` (Task 8 ใช้ต่อใน approve/lines/alarm)
- ข้อความ error ใหม่ (ไทย): `สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการค่าเครื่องคืนไม่ได้ — จ่ายเจ้าหนี้ในรอบนี้ก่อน แล้วหักค่าเครื่องคืนในรอบถัดไป หรือใช้ปุ่มรับเงินสดค่าเครื่องคืน` (ข้อจำกัด `@@unique([batchId, contractId])` — ชี้ทางออกที่มีจริง: อีกรอบ หรือ settle-cash Task 9) · `สัญญาเดียวกันอยู่ทั้งรายการเรียกคืนและรายการค่าเครื่องคืนไม่ได้` · `สัญญา ${label} ไม่อยู่ในคิวค่าเครื่องคืน หรืออยู่ในรอบจ่ายอื่นแล้ว` · `ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา ${contractNumber} (FINANCE x / SHOP y) — ตรวจสอบ GL ก่อนสร้างรอบ`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) jest `interco-settlement.service.spec.ts`:

เดิม (L117-120):

```ts
    pendingService = {
      getPendingContracts: jest.fn().mockResolvedValue([]),
      getPendingRecalls: jest.fn().mockResolvedValue([]),
    };
```

ใหม่:

```ts
    pendingService = {
      getPendingContracts: jest.fn().mockResolvedValue([]),
      getPendingRecalls: jest.fn().mockResolvedValue([]),
      getPendingDeviceReturns: jest.fn().mockResolvedValue([]),
    };
```

เดิม (L366 และ L386 — fixture ของ submit สองเทส):

```ts
        items: [{ contractId: 'c-1' }],
```

ใหม่ (ทั้งสองจุด — `ITEM_ROLE` ตัดสินจาก `itemType` จริง ไม่เดาแถวที่ไม่มี type เป็น SETTLEMENT):

```ts
        items: [{ contractId: 'c-1', itemType: 'SETTLEMENT' }],
```

เดิม (L583-584 ใน `approvableBatchFixture`):

```ts
            swapCreditAmount: new Prisma.Decimal(0),
            recallAmount: new Prisma.Decimal(0),
```

ใหม่:

```ts
            swapCreditAmount: new Prisma.Decimal(0),
            recallAmount: new Prisma.Decimal(0),
            deviceReturnAmount: new Prisma.Decimal(0),
```

เพิ่ม describe ใหม่ก่อน `describe('updateBatch', …)` (หลัง `});` ปิด `describe('createBatch')` บรรทัด 276):

```ts
  describe('createBatch/submitBatch — แถว DEVICE_RETURN (ใบรับเครื่องคืน 2026-09-20 §6.3)', () => {
    const deviceReturnRow = (over: Record<string, unknown> = {}) => ({
      contractId: 'c-dr',
      contractNumber: 'CT-0100',
      customerName: 'ลูกค้า X',
      deviceReturnGl: new Prisma.Decimal(7000),
      shopDeviceReturnGl: new Prisma.Decimal(7000),
      ...over,
    });

    it('snapshot: แถว DEVICE_RETURN ได้ deviceReturnAmount = net, GL 4 เลนส์ = 0, legacyNoShop=false; totals หัก 7,000 (golden §6.5: 11,000 − 7,000 = 4,000 ทั้งสองสมุด)', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow()]);
      pendingService.getPendingDeviceReturns.mockResolvedValue([deviceReturnRow()]);
      tx.interCoSettlementBatch.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'batch-1', ...data }),
      );

      await service.createBatch(
        dto({ contractIds: ['c-1'], deviceReturnContractIds: ['c-dr'] }),
        'user-1',
      );

      const createArgs = tx.interCoSettlementBatch.create.mock.calls[0][0];
      expect((createArgs.data.totalAmount as Prisma.Decimal).toString()).toBe('11000');
      expect((createArgs.data.shopPostedAmount as Prisma.Decimal).toString()).toBe('11000');
      expect((createArgs.data.totalDeduction as Prisma.Decimal).toString()).toBe('7000');
      expect((createArgs.data.netTransferAmount as Prisma.Decimal).toString()).toBe('4000');
      expect((createArgs.data.shopNetAmount as Prisma.Decimal).toString()).toBe('4000');

      const items = createArgs.data.items.create as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      const drItem = items.find((i) => i.contractId === 'c-dr')!;
      expect(drItem.itemType).toBe('DEVICE_RETURN');
      expect(drItem.legacyNoShop).toBe(false);
      expect((drItem.deviceReturnAmount as Prisma.Decimal).toString()).toBe('7000');
      for (const key of [
        'financedGl',
        'commissionGl',
        'shopFinancedGl',
        'shopCommissionGl',
        'swapCreditAmount',
        'recallAmount',
      ]) {
        expect((drItem[key] as Prisma.Decimal).toString()).toBe('0');
      }
      const normalItem = items.find((i) => i.contractId === 'c-1')!;
      expect(normalItem.itemType).toBe('SETTLEMENT');
      expect((normalItem.deviceReturnAmount as Prisma.Decimal).toString()).toBe('0');

      const audit = tx.auditLog.create.mock.calls[0][0].data.newValue;
      expect(audit.deviceReturnContractIds).toEqual(['c-dr']);
      expect(audit.totalDeduction).toBe('7000.00');
    });

    it('guard: ยอดค่าเครื่องคืนสองสมุดไม่ตรง → reject พร้อมเลขสัญญา', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow()]);
      pendingService.getPendingDeviceReturns.mockResolvedValue([
        deviceReturnRow({ shopDeviceReturnGl: new Prisma.Decimal(6000) }),
      ]);
      await expect(
        service.createBatch(dto({ contractIds: ['c-1'], deviceReturnContractIds: ['c-dr'] }), 'user-1'),
      ).rejects.toThrow(/ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา CT-0100/);
      expect(tx.interCoSettlementBatch.create).not.toHaveBeenCalled();
    });

    it('guard: ไม่อยู่ในคิวค่าเครื่องคืน → reject พร้อมเลขสัญญา', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow()]);
      pendingService.getPendingDeviceReturns.mockResolvedValue([]);
      tx.contract.findMany.mockResolvedValue([{ id: 'c-dr', contractNumber: 'CT-0100' }]);
      await expect(
        service.createBatch(dto({ contractIds: ['c-1'], deviceReturnContractIds: ['c-dr'] }), 'user-1'),
      ).rejects.toThrow(/CT-0100 ไม่อยู่ในคิวค่าเครื่องคืน/);
    });

    it('guard: สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการค่าเครื่องคืน → reject', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow()]);
      await expect(
        service.createBatch(dto({ contractIds: ['c-1'], deviceReturnContractIds: ['c-1'] }), 'user-1'),
      ).rejects.toThrow(/ทั้งรายการจ่ายและรายการค่าเครื่องคืน/);
    });

    it('guard: สัญญาเดียวกันอยู่ทั้งรายการเรียกคืนและรายการค่าเครื่องคืน → reject', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow()]);
      pendingService.getPendingRecalls.mockResolvedValue([
        {
          contractId: 'c-x',
          contractNumber: 'CT-0200',
          customerName: 'ลูกค้า C',
          recallGl: new Prisma.Decimal(1000),
          shopRecallGl: new Prisma.Decimal(1000),
        },
      ]);
      await expect(
        service.createBatch(
          dto({ contractIds: ['c-1'], recallContractIds: ['c-x'], deviceReturnContractIds: ['c-x'] }),
          'user-1',
        ),
      ).rejects.toThrow(/ทั้งรายการเรียกคืนและรายการค่าเครื่องคืน/);
    });

    it('submitBatch: แถว DEVICE_RETURN clash เฉพาะ itemType DEVICE_RETURN; แถว SETTLEMENT clash ทุกประเภท', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
        batchNumber: 'IC-20260920-0001',
        items: [
          { contractId: 'c-1', itemType: 'SETTLEMENT' },
          { contractId: 'c-dr', itemType: 'DEVICE_RETURN' },
        ],
      });
      tx.interCoSettlementItem.findMany.mockResolvedValue([]);

      const result = await service.submitBatch('batch-1', 'maker-1');
      expect(result.status).toBe('PENDING_APPROVAL');
      const where = tx.interCoSettlementItem.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { contractId: { in: ['c-1'] } },
        { contractId: { in: ['c-dr'] }, itemType: 'DEVICE_RETURN' },
      ]);
      expect(where.batchId).toEqual({ not: 'batch-1' });
      expect(where.batch.status.in).toEqual(['PENDING_APPROVAL', 'POSTED']);
    });
  });
```

(ข) vitest — เพิ่ม describe ต่อท้าย describe Task 6 ใน `interco-device-return.integration.spec.ts`:

```ts
  // ===========================================================================
  // Task 7 — createBatch/updateBatch/submitBatch: snapshot แถว DEVICE_RETURN + guards
  // (DRAFT ไม่ lock สัญญา — fixture X/Y ใช้ซ้ำได้จน submit)
  // ===========================================================================
  describe('createBatch/updateBatch/submitBatch — แถว DEVICE_RETURN (Task 7)', () => {
    it('golden §6.5: Y (10,000+1,000) + ค่าเครื่องคืน X 7,000 → totals 11,000 / หัก 7,000 / โอนสุทธิ 4,000 ทั้งสองสมุด', async () => {
      const batch = await settlementService.createBatch(
        { contractIds: [normalId], deviceReturnContractIds: [deviceReturnId], transferDate: '2026-09-20' },
        adminId,
      );
      createdBatchIds.push(batch.id);

      expect(batch.totalAmount.toFixed(2)).toBe('11000.00');
      expect(batch.shopPostedAmount.toFixed(2)).toBe('11000.00');
      expect(batch.totalDeduction.toFixed(2)).toBe('7000.00');
      expect(batch.netTransferAmount!.toFixed(2)).toBe('4000.00');
      expect(batch.shopNetAmount!.toFixed(2)).toBe('4000.00');
      expect(batch.items).toHaveLength(2);

      const dr = batch.items.find((i) => i.contractId === deviceReturnId)!;
      expect(dr.itemType).toBe('DEVICE_RETURN');
      expect(dr.deviceReturnAmount.toFixed(2)).toBe('7000.00');
      expect(dr.swapCreditAmount.toFixed(2)).toBe('0.00');
      expect(dr.recallAmount.toFixed(2)).toBe('0.00');
      expect(dr.financedGl.toFixed(2)).toBe('0.00');
      expect(dr.commissionGl.toFixed(2)).toBe('0.00');
      expect(dr.shopFinancedGl.toFixed(2)).toBe('0.00');
      expect(dr.shopCommissionGl.toFixed(2)).toBe('0.00');
      expect(dr.legacyNoShop).toBe(false);

      const y = batch.items.find((i) => i.contractId === normalId)!;
      expect(y.itemType).toBe('SETTLEMENT');
      expect(y.deviceReturnAmount.toFixed(2)).toBe('0.00');
      expect(y.financedGl.toFixed(2)).toBe('10000.00');
    });

    it('guard: ยอดสุทธิติดลบ (มีแต่ค่าเครื่องคืน ไม่มีสัญญาจ่าย) → reject', async () => {
      await expect(
        settlementService.createBatch(
          { contractIds: [], deviceReturnContractIds: [deviceReturnId], transferDate: '2026-09-20' },
          adminId,
        ),
      ).rejects.toThrow(/เกินยอดจ่ายของรอบ/);
    });

    it('guard: สองสมุดไม่ตรง (7,000 / 6,000) → reject; สัญญาปกติในรายการค่าเครื่องคืน → reject; ซ้ำสองรายการ → reject', async () => {
      const mismatch = await seedBaseContract(7, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(mismatch, { shopAmount: '6000.00' });
      await expect(
        settlementService.createBatch(
          { contractIds: [normalId], deviceReturnContractIds: [mismatch], transferDate: '2026-09-20' },
          adminId,
        ),
      ).rejects.toThrow(/ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน/);

      await expect(
        settlementService.createBatch(
          { contractIds: [], deviceReturnContractIds: [normalId], transferDate: '2026-09-20' },
          adminId,
        ),
      ).rejects.toThrow(/ไม่อยู่ในคิวค่าเครื่องคืน/);

      await expect(
        settlementService.createBatch(
          { contractIds: [normalId], deviceReturnContractIds: [normalId], transferDate: '2026-09-20' },
          adminId,
        ),
      ).rejects.toThrow(/ทั้งรายการจ่ายและรายการค่าเครื่องคืน/);
    });

    it('updateBatch: re-snapshot เพิ่มแถว DEVICE_RETURN + totals ใหม่', async () => {
      const y = await seedBaseContract(8);
      await seedNormalContract(y);
      const batch = await settlementService.createBatch(
        { contractIds: [y], transferDate: '2026-09-20' },
        adminId,
      );
      createdBatchIds.push(batch.id);
      expect(batch.totalDeduction.toFixed(2)).toBe('0.00');

      const updated = await settlementService.updateBatch(
        batch.id,
        { contractIds: [y], deviceReturnContractIds: [deviceReturnId], transferDate: '2026-09-20' },
        adminId,
      );
      expect(updated.items).toHaveLength(2);
      expect(updated.totalDeduction.toFixed(2)).toBe('7000.00');
      expect(updated.netTransferAmount!.toFixed(2)).toBe('4000.00');
      expect(updated.shopNetAmount!.toFixed(2)).toBe('4000.00');
      const drItem = updated.items.find((i) => i.contractId === deviceReturnId)!;
      expect(drItem.itemType).toBe('DEVICE_RETURN');
      expect(drItem.deviceReturnAmount.toFixed(2)).toBe('7000.00');
    });

    it('submitBatch: แถว DEVICE_RETURN ที่สัญญามี SETTLEMENT item เก่าใน batch POSTED (ยึดหลังเคยถูกจ่าย) → submit ผ่าน; batch ที่สองจับสัญญาเดิม → reject', async () => {
      const yA = await seedBaseContract(9);
      await seedNormalContract(yA);
      const yB = await seedBaseContract(10);
      await seedNormalContract(yB);
      const xOld = await seedBaseContract(11, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(xOld);

      // สัญญาที่ถูกยึดเคยถูกจ่ายในรอบ POSTED มาก่อนโดยนิยาม — SETTLEMENT item ถาวร
      const hist = await seedBatch('POSTED', 4);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: hist.id,
          contractId: xOld,
          itemType: 'SETTLEMENT',
          financedGl: dec('10000.00'),
          commissionGl: dec('1000.00'),
          shopFinancedGl: dec('10000.00'),
          shopCommissionGl: dec('1000.00'),
        },
      });

      const b1 = await settlementService.createBatch(
        { contractIds: [yA], deviceReturnContractIds: [xOld], transferDate: '2026-09-20' },
        adminId,
      );
      createdBatchIds.push(b1.id);
      const b2 = await settlementService.createBatch(
        { contractIds: [yB], deviceReturnContractIds: [xOld], transferDate: '2026-09-20' },
        adminId,
      );
      createdBatchIds.push(b2.id);

      const submitted = await settlementService.submitBatch(b1.id, adminId);
      expect(submitted.status).toBe('PENDING_APPROVAL');

      await expect(settlementService.submitBatch(b2.id, adminId)).rejects.toThrow(
        /อยู่ในรอบจ่ายอื่นแล้ว/,
      );
      // xOld หลุดคิวค่าเครื่องคืนระหว่างที่ b1 ค้างอนุมัติ (settled gate)
      const rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === xOld)).toBe(false);
    });
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-settlement.service.spec.ts`
Expected: FAIL — `expect(items).toHaveLength(2) … Received length: 1` (ไม่มีแถว DEVICE_RETURN) และ TS error `Object literal may only specify known properties, and 'deviceReturnContractIds' does not exist in type 'CreateBatchDto'` (ts-jest)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — `expect(batch.totalDeduction.toFixed(2)).toBe('7000.00') … Received: "0.00"`

- [ ] **Step 3: แก้โค้ด**

`dto/create-batch.dto.ts` — เดิม (L27-31):

```ts
  /** สัญญายกเลิก (C-2) ที่เลือกหักเรียกคืนในรอบนี้ — optional (Phase 2) */
  @IsOptional()
  @IsArray({ message: 'recallContractIds ต้องเป็น array' })
  @IsUUID('4', { each: true, message: 'recallContractIds ต้องเป็น UUID' })
  recallContractIds?: string[];
```

ใหม่:

```ts
  /** สัญญายกเลิก (C-2) ที่เลือกหักเรียกคืนในรอบนี้ — optional (Phase 2) */
  @IsOptional()
  @IsArray({ message: 'recallContractIds ต้องเป็น array' })
  @IsUUID('4', { each: true, message: 'recallContractIds ต้องเป็น UUID' })
  recallContractIds?: string[];

  /** สัญญาที่มีค่าเครื่องคืน (ใบรับเครื่องคืน — 11-2107 DEVICE_RETURN) ที่เลือกหักในรอบนี้ — optional (2026-09-20 §6.3) */
  @IsOptional()
  @IsArray({ message: 'deviceReturnContractIds ต้องเป็น array' })
  @IsUUID('4', { each: true, message: 'deviceReturnContractIds ต้องเป็น UUID' })
  deviceReturnContractIds?: string[];
```

`interco-settlement.service.ts` — เพิ่มหลังบรรทัด 38 (`const DRIFT_TOLERANCE = …;`):

```ts

/**
 * บทบาทของแต่ละ itemType ในรอบจ่าย — `satisfies Record<InterCoItemType, …>` บังคับให้ค่า enum
 * ใหม่ต้องถูกตัดสินที่นี่ก่อน compile ผ่าน (pattern DUE_STATUS_MAP / FOUND_POLICY):
 *   PAYABLE        = แถวจ่ายเจ้าหนี้ (Dr 21-1101/21-1102 + Cr S11-3001/S11-3002; clash กับ item ทุกประเภท)
 *   DEDUCTION_ONLY = แถวหักอย่างเดียว (Cr 11-2107 / Dr S21-1104; clash เฉพาะ item ประเภทเดียวกัน —
 *                    สัญญาของแถวพวกนี้มี SETTLEMENT item ถาวรในรอบ POSTED เก่าโดยนิยาม)
 */
const ITEM_ROLE = {
  SETTLEMENT: 'PAYABLE',
  RECALL: 'DEDUCTION_ONLY',
  DEVICE_RETURN: 'DEDUCTION_ONLY',
} as const satisfies Record<InterCoItemType, 'PAYABLE' | 'DEDUCTION_ONLY'>;

const DEDUCTION_ONLY_TYPES = (Object.keys(ITEM_ROLE) as InterCoItemType[]).filter(
  (t) => ITEM_ROLE[t] === 'DEDUCTION_ONLY',
);

function isPayableRow(itemType: InterCoItemType): boolean {
  return ITEM_ROLE[itemType] === 'PAYABLE';
}

/** คอลัมน์ deduction ของ item หนึ่งแถว (ทุกแถวมีครบสามคอลัมน์ — ที่ไม่เกี่ยวเป็น 0) */
interface DeductionColumns {
  swapCreditAmount: Prisma.Decimal;
  recallAmount: Prisma.Decimal;
  deviceReturnAmount: Prisma.Decimal;
}

/**
 * Σ ยอดหักทุกประเภทของ items (swapCredit + recall + deviceReturn) — สูตรเดียวกับ
 * `totalDeduction` ของ batch และ `postedDeductionsByContract` ของ pending lens (ห้ามมีสำเนา).
 */
function sumDeductions(items: ReadonlyArray<DeductionColumns>): Prisma.Decimal {
  return items.reduce(
    (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount).plus(i.deviceReturnAmount),
    new Prisma.Decimal(0),
  );
}

/**
 * เงื่อนไข clash ต่อประเภทแถว (submit + approve ใช้ชุดเดียวกัน): แถวจ่ายเจ้าหนี้ clash กับ item
 * ทุกประเภทใน batch เปิดอื่น (กันจ่ายซ้ำ); แถวหักอย่างเดียว clash เฉพาะ item ประเภทเดียวกัน —
 * mirror settled gate ของแต่ละคิว (`getPendingRecalls` / `getPendingDeviceReturns`); any-type
 * จะทำให้รอบที่มีแถวหักแม้แถวเดียว submit/approve ไม่ได้ตลอดกาล (สัญญา C-2/ยึด มี SETTLEMENT
 * item ถาวรในรอบ POSTED เก่าโดยนิยาม).
 */
function buildClashConditions(
  items: ReadonlyArray<{ contractId: string; itemType: InterCoItemType }>,
): Prisma.InterCoSettlementItemWhereInput[] {
  const conditions: Prisma.InterCoSettlementItemWhereInput[] = [];
  const payableIds = items.filter((i) => isPayableRow(i.itemType)).map((i) => i.contractId);
  if (payableIds.length > 0) conditions.push({ contractId: { in: payableIds } });
  for (const type of DEDUCTION_ONLY_TYPES) {
    const ids = items.filter((i) => i.itemType === type).map((i) => i.contractId);
    if (ids.length > 0) conditions.push({ contractId: { in: ids }, itemType: type });
  }
  return conditions;
}
```

เดิม (L57-61 ใน `BuiltSnapshotItem`):

```ts
  /** Snapshot เครดิตเปลี่ยนเครื่อง (11-2107 SWAP_CREDIT) — 0 เมื่อไม่ใช่ swap/ไม่ eligible */
  swapCreditAmount: Prisma.Decimal;
  /** Snapshot ยอดเรียกคืน (11-2107 PAYOUT_RECALL) — ใช้เฉพาะแถว RECALL */
  recallAmount: Prisma.Decimal;
}
```

ใหม่:

```ts
  /** Snapshot เครดิตเปลี่ยนเครื่อง (11-2107 SWAP_CREDIT) — 0 เมื่อไม่ใช่ swap/ไม่ eligible */
  swapCreditAmount: Prisma.Decimal;
  /** Snapshot ยอดเรียกคืน (11-2107 PAYOUT_RECALL) — ใช้เฉพาะแถว RECALL */
  recallAmount: Prisma.Decimal;
  /** Snapshot ค่าเครื่องคืน (11-2107 DEVICE_RETURN) — ใช้เฉพาะแถว DEVICE_RETURN (ใบรับเครื่องคืน 2026-09-20) */
  deviceReturnAmount: Prisma.Decimal;
}
```

เดิม (L69-70):

```ts
  /** Σ swapCreditAmount + recallAmount ของทุก item (Phase 2 หักกลบ) */
  totalDeduction: Prisma.Decimal;
```

ใหม่:

```ts
  /** Σ swapCreditAmount + recallAmount + deviceReturnAmount ของทุก item (Phase 2 หักกลบ + ใบรับเครื่องคืน) */
  totalDeduction: Prisma.Decimal;
```

เดิม (L117-133 — ท้าย jsdoc + signature ของ `buildSnapshot`):

```ts
   * Phase 2 (หักกลบ 11-2107 — spec §4.1/§5.1): the lens amounts stay GROSS —
   * the snapshot captures them as-is and layers the deduction on top:
   *   - SETTLEMENT items carry `swapCreditAmount` (= swapCreditGl when
   *     eligible, else 0 — legacy/mixed-era swaps enter WITHOUT a deduction).
   *   - RECALL rows (Flow C-2) come from `getPendingRecalls` and have no
   *     payable/receivable of their own (all 4 GL snapshots = 0,
   *     legacyNoShop = false) — only `recallAmount`.
   *   - totals: totalDeduction = Σ(swapCredit + recall);
   *     netTransferAmount = totalAmount − totalDeduction;
   *     shopNetAmount = shopPostedAmount − totalDeduction — both must be ≥ 0
   *     (เงินสดส่วนที่หักเกินต้องเรียกคืนผ่านช่องทางรับโอนจากหน้าร้าน ไม่ใช่รอบจ่าย).
   */
  private async buildSnapshot(
    tx: Prisma.TransactionClient,
    contractIds: string[],
    recallContractIds?: string[],
  ): Promise<BuiltSnapshot> {
```

ใหม่:

```ts
   * Phase 2 (หักกลบ 11-2107 — spec §4.1/§5.1): the lens amounts stay GROSS —
   * the snapshot captures them as-is and layers the deduction on top:
   *   - SETTLEMENT items carry `swapCreditAmount` (= swapCreditGl when
   *     eligible, else 0 — legacy/mixed-era swaps enter WITHOUT a deduction).
   *   - RECALL rows (Flow C-2) come from `getPendingRecalls` and have no
   *     payable/receivable of their own (all 4 GL snapshots = 0,
   *     legacyNoShop = false) — only `recallAmount`.
   *   - DEVICE_RETURN rows (ใบรับเครื่องคืน 2026-09-20 §6.3) come from
   *     `getPendingDeviceReturns` — same shape as RECALL rows, only
   *     `deviceReturnAmount` (= net); rejected when the two books disagree > 0.01.
   *   - totals: totalDeduction = Σ(swapCredit + recall + deviceReturn);
   *     netTransferAmount = totalAmount − totalDeduction;
   *     shopNetAmount = shopPostedAmount − totalDeduction — both must be ≥ 0
   *     (เงินสดส่วนที่หักเกินต้องเรียกคืนผ่านช่องทางรับโอนจากหน้าร้าน ไม่ใช่รอบจ่าย).
   */
  private async buildSnapshot(
    tx: Prisma.TransactionClient,
    contractIds: string[],
    recallContractIds?: string[],
    deviceReturnContractIds?: string[],
  ): Promise<BuiltSnapshot> {
```

เดิม (L181-191 — item literal SETTLEMENT):

```ts
      return {
        contractId,
        itemType: 'SETTLEMENT' as const,
        financedGl: p.financedGl,
        commissionGl: p.commissionGl,
        shopFinancedGl: p.shopFinancedGl,
        shopCommissionGl: p.shopCommissionGl,
        legacyNoShop: p.legacyNoShop,
        swapCreditAmount,
        recallAmount: zero,
      };
```

ใหม่:

```ts
      return {
        contractId,
        itemType: 'SETTLEMENT' as const,
        financedGl: p.financedGl,
        commissionGl: p.commissionGl,
        shopFinancedGl: p.shopFinancedGl,
        shopCommissionGl: p.shopCommissionGl,
        legacyNoShop: p.legacyNoShop,
        swapCreditAmount,
        recallAmount: zero,
        deviceReturnAmount: zero,
      };
```

เดิม (L216-226 — item literal RECALL):

```ts
        items.push({
          contractId: id,
          itemType: 'RECALL' as const,
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          legacyNoShop: false,
          swapCreditAmount: zero,
          recallAmount: r.recallGl,
        });
```

ใหม่:

```ts
        items.push({
          contractId: id,
          itemType: 'RECALL' as const,
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          legacyNoShop: false,
          swapCreditAmount: zero,
          recallAmount: r.recallGl,
          deviceReturnAmount: zero,
        });
```

แทรกหลังบรรทัด 228 (`    }` ปิด `if (recallIds.length > 0) {…}`) ก่อน `const totalAmount = …` (L230):

```ts

    // DEVICE_RETURN rows (ใบรับเครื่องคืน — spec 2026-09-20 §6.3): mirror ของแถว RECALL
    const deviceReturnIds = [...new Set(deviceReturnContractIds ?? [])];
    if (deviceReturnIds.some((id) => contractIds.includes(id))) {
      // ข้อจำกัด @@unique([batchId, contractId]) (สัญญาที่ยึดก่อนเคยถูกจ่าย) — ชี้ทางออกที่มีจริง
      throw new BadRequestException(
        'สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการค่าเครื่องคืนไม่ได้ — ' +
          'จ่ายเจ้าหนี้ในรอบนี้ก่อน แล้วหักค่าเครื่องคืนในรอบถัดไป หรือใช้ปุ่มรับเงินสดค่าเครื่องคืน',
      );
    }
    if (deviceReturnIds.some((id) => recallIds.includes(id))) {
      throw new BadRequestException('สัญญาเดียวกันอยู่ทั้งรายการเรียกคืนและรายการค่าเครื่องคืนไม่ได้');
    }
    if (deviceReturnIds.length > 0) {
      const deviceReturns = await this.pendingService.getPendingDeviceReturns(tx);
      const byId = new Map(deviceReturns.map((d) => [d.contractId, d]));
      for (const id of deviceReturnIds) {
        const d = byId.get(id);
        if (!d) {
          const labels = await this.resolveContractLabels(tx, [id]);
          throw new BadRequestException(
            `สัญญา ${labels[0]} ไม่อยู่ในคิวค่าเครื่องคืน หรืออยู่ในรอบจ่ายอื่นแล้ว`,
          );
        }
        // ห้ามหักข้างเดียว: ฝั่ง SHOP ต้องมี S21-1104 ให้ Dr เท่ากัน ไม่งั้นใบ SHOP ไม่ balance
        if (d.deviceReturnGl.minus(d.shopDeviceReturnGl).abs().gt('0.01')) {
          throw new BadRequestException(
            `ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา ${d.contractNumber} ` +
              `(FINANCE ${d.deviceReturnGl.toFixed(2)} / SHOP ${d.shopDeviceReturnGl.toFixed(2)}) — ตรวจสอบ GL ก่อนสร้างรอบ`,
          );
        }
        items.push({
          contractId: id,
          itemType: 'DEVICE_RETURN' as const,
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          legacyNoShop: false,
          swapCreditAmount: zero,
          recallAmount: zero,
          deviceReturnAmount: d.deviceReturnGl,
        });
      }
    }
```

เดิม (L230-234):

```ts
    const totalAmount = totalFinanced.plus(totalCommission);
    const totalDeduction = items.reduce(
      (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount),
      zero,
    );
```

ใหม่:

```ts
    const totalAmount = totalFinanced.plus(totalCommission);
    const totalDeduction = sumDeductions(items);
```

เดิม (L318 ใน `createBatch`):

```ts
      const snapshot = await this.buildSnapshot(tx, dto.contractIds, dto.recallContractIds);
```

ใหม่:

```ts
      const snapshot = await this.buildSnapshot(
        tx,
        dto.contractIds,
        dto.recallContractIds,
        dto.deviceReturnContractIds,
      );
```

เดิม (L350-358 — audit ของ createBatch):

```ts
          newValue: {
            batchNumber: batch.batchNumber,
            contractIds: dto.contractIds,
            recallContractIds: dto.recallContractIds ?? [],
            totalAmount: snapshot.totalAmount.toFixed(2),
            shopPostedAmount: snapshot.shopPostedAmount.toFixed(2),
            totalDeduction: snapshot.totalDeduction.toFixed(2),
            netTransferAmount: snapshot.netTransferAmount.toFixed(2),
          },
```

ใหม่:

```ts
          newValue: {
            batchNumber: batch.batchNumber,
            contractIds: dto.contractIds,
            recallContractIds: dto.recallContractIds ?? [],
            deviceReturnContractIds: dto.deviceReturnContractIds ?? [],
            totalAmount: snapshot.totalAmount.toFixed(2),
            shopPostedAmount: snapshot.shopPostedAmount.toFixed(2),
            totalDeduction: snapshot.totalDeduction.toFixed(2),
            netTransferAmount: snapshot.netTransferAmount.toFixed(2),
          },
```

เดิม (L378 ใน `updateBatch`): ข้อความเดียวกับ L318 → แก้แบบเดียวกัน (ส่ง `dto.deviceReturnContractIds` เป็น argument ที่ 4)

เดิม (L416-423 — audit ของ updateBatch):

```ts
          newValue: {
            batchNumber: batch.batchNumber,
            contractIds: dto.contractIds,
            recallContractIds: dto.recallContractIds ?? [],
            totalAmount: snapshot.totalAmount.toFixed(2),
            totalDeduction: snapshot.totalDeduction.toFixed(2),
            netTransferAmount: snapshot.netTransferAmount.toFixed(2),
          },
```

ใหม่:

```ts
          newValue: {
            batchNumber: batch.batchNumber,
            contractIds: dto.contractIds,
            recallContractIds: dto.recallContractIds ?? [],
            deviceReturnContractIds: dto.deviceReturnContractIds ?? [],
            totalAmount: snapshot.totalAmount.toFixed(2),
            totalDeduction: snapshot.totalDeduction.toFixed(2),
            netTransferAmount: snapshot.netTransferAmount.toFixed(2),
          },
```

เดิม (L445-468 ใน `submitBatch`):

```ts
      // Re-validate: none of this batch's contracts may have been grabbed by
      // another batch that is now PENDING_APPROVAL/POSTED since createBatch
      // snapshotted them (race between two makers).
      //
      // Type-aware per item (Phase 2): a RECALL row's contract BY DEFINITION
      // carries a permanent SETTLEMENT item in some old POSTED batch (Flow
      // C-2 = ยกเลิกหลังตัดจ่าย) — counting that as a clash would make every
      // batch with a recall row structurally unsubmittable. Mirror
      // `getPendingRecalls`'s settled gate instead: RECALL rows clash only
      // with other RECALL items; SETTLEMENT rows keep the any-type clash
      // (same as `getPendingContracts`'s gate).
      const settlementIds = batch.items
        .filter((i) => i.itemType !== 'RECALL')
        .map((i) => i.contractId);
      const recallIds = batch.items
        .filter((i) => i.itemType === 'RECALL')
        .map((i) => i.contractId);
      const clashConditions: Prisma.InterCoSettlementItemWhereInput[] = [];
      if (settlementIds.length > 0) {
        clashConditions.push({ contractId: { in: settlementIds } });
      }
      if (recallIds.length > 0) {
        clashConditions.push({ contractId: { in: recallIds }, itemType: 'RECALL' });
      }
```

ใหม่:

```ts
      // Re-validate: none of this batch's contracts may have been grabbed by
      // another batch that is now PENDING_APPROVAL/POSTED since createBatch
      // snapshotted them (race between two makers).
      //
      // Type-aware per item (Phase 2 + ใบรับเครื่องคืน 2026-09-20): a RECALL /
      // DEVICE_RETURN row's contract BY DEFINITION carries a permanent SETTLEMENT
      // item in some old POSTED batch (จ่ายไปแล้วก่อนยกเลิก/ยึด) — counting that
      // as a clash would make every batch with a deduction-only row structurally
      // unsubmittable. `buildClashConditions` mirrors each queue's settled gate:
      // deduction-only rows clash only with items of the SAME type; SETTLEMENT
      // rows keep the any-type clash (same as `getPendingContracts`'s gate).
      const clashConditions = buildClashConditions(batch.items);
```

(บรรทัด 469-485 `if (clashConditions.length > 0) { … }` คงเดิม)

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-settlement.service.spec.ts` — Expected: PASS (เทสเดิมทั้งหมด + 6 ใหม่)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (16 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors (approve/lines ยังไม่อ่าน `deviceReturnAmount` — Task 8). **Do NOT commit.**

---

### Task 8: approveBatch / reverseBatch — drift guard แถว `DEVICE_RETURN`, บรรทัด JE สองสมุด, metadata `items[].deviceReturn`, residual alarm

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts:23-28` (import typed balances), `:789-808` (approve clash → helper), `:839-866` (drift guard ด่าน (i) + branch DEVICE_RETURN), `:947-954` (`itemsMetadata`), `:1122-1169` (`alarmNettingResiduals`), `:1579-1697` (`buildFinanceLines` / `buildShopLines` + private `deductionOf` ใหม่)
- Test (jest): `interco-settlement.service.spec.ts` — describe ใหม่ใน `describe('approveBatch')`
- Test (vitest): `interco-device-return.integration.spec.ts` (describe Task 8 — golden §6.5)
- **ไม่แตะ** `reverseBatch` (L1198-1338): mirror สองใบตามเดิมครอบบรรทัด `Cr 11-2107`/`Dr S21-1104` ใหม่เอง; guard สัญญา CANCELED scope เฉพาะแถว SETTLEMENT (L1228-1231) จึงไม่บล็อกแถว DEVICE_RETURN (สัญญาเป็น CLOSED_BAD_DEBT อยู่แล้ว) — พิสูจน์ในเทส reverse ด้านล่าง

**Interfaces:**
- Consumes: `deviceReturnFinanceBalance` / `deviceReturnShopBalance` (Task 3), `isPayableRow` / `sumDeductions` / `buildClashConditions` (Task 7)
- Produces: FINANCE line `{ accountCode: '11-2107', cr: deviceReturnAmount, description: 'หักค่าเครื่องคืน ${contractNumber}' }` · SHOP line `{ accountCode: 'S21-1104', dr: deviceReturnAmount, description: 'ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน ${contractNumber}' }` · JE metadata `items[]` entry ของแถวนี้ `{ contractId, type: 'DEVICE_RETURN', financed: '0.00', commission: '0.00', swapCredit: '0.00', recall: '0.00', deviceReturn: '<2dp>' }` (ทุกแถวได้ key `deviceReturn` — SETTLEMENT/RECALL = `'0.00'`) · **ไม่มี** top-level `contractId`/`shopReceivableType` บน batch JE (เดิม) · private `deductionOf(item): { amount; financeDescription; shopDescription }`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) jest — เพิ่มใน `describe('approveBatch')` ของ `interco-settlement.service.spec.ts` (หลังเทส `'P2034 (SSI abort) → …'` ก่อน `});` ปิด describe บรรทัด 740):

```ts
    // --- ใบรับเครื่องคืน 2026-09-20 §6.3 — แถวหักประเภทที่ 3 --------------------
    describe('แถว DEVICE_RETURN', () => {
      const D = (v: number) => new Prisma.Decimal(v);
      /** Golden ย่อ: Y เจ้าหนี้ 100 (ไม่มีค่าคอม) + ค่าเครื่องคืน X 70 → โอนสุทธิ 30 ทั้งสองสมุด */
      function fixtureWithDeviceReturn() {
        const fixture = approvableBatchFixture();
        fixture.items.push({
          contractId: 'c-dr',
          itemType: 'DEVICE_RETURN',
          financedGl: D(0),
          commissionGl: D(0),
          shopFinancedGl: D(0),
          shopCommissionGl: D(0),
          legacyNoShop: false,
          swapCreditAmount: D(0),
          recallAmount: D(0),
          deviceReturnAmount: D(70),
          contract: { contractNumber: 'CT-0100' },
        });
        fixture.totalDeduction = D(70);
        fixture.netTransferAmount = D(30);
        fixture.shopNetAmount = D(30);
        return fixture;
      }
      /** GL ตรง snapshot: 21-1101/S11-3001 = 100, untyped 11-2107 ของ c-dr = 70 (ด่าน i), typed ตามข้อความ SQL */
      function glMocks(typedDeviceReturn: number) {
        tx.journalLine.findMany.mockImplementation(({ where }: { where: { accountCode: string } }) => {
          if (where.accountCode === '21-1101') return Promise.resolve([{ debit: D(0), credit: D(100) }]);
          if (where.accountCode === 'S11-3001') return Promise.resolve([{ debit: D(100), credit: D(0) }]);
          if (where.accountCode === '11-2107') return Promise.resolve([{ debit: D(70), credit: D(0) }]);
          return Promise.resolve([]);
        });
        // sumTyped ส่ง Prisma.Sql เข้า $queryRaw — แยกประเภทจากข้อความ: DEVICE_RETURN = typed ของ
        // c-dr, ที่เหลือ (SWAP_CREDIT ของ c-1) = 0 ไม่งั้น branch (ข) จะเห็นเครดิต nettable ปลอม
        tx.$queryRaw.mockImplementation((sql: Prisma.Sql) => {
          const text = sql.strings.join('');
          return Promise.resolve([{ balance: text.includes("= 'DEVICE_RETURN'") ? typedDeviceReturn : 0 }]);
        });
      }
      const tuples = (lines: Array<{ accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description?: string }>) =>
        lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2), l.description]);

      it('drift ผ่าน (typed net ทั้งสองสมุด = snapshot) → FINANCE Cr 11-2107 + SHOP Dr S21-1104 คำอธิบายค่าเครื่องคืน, ไม่มี Dr 21-1101 ยอด 0, metadata.items.deviceReturn', async () => {
        tx.interCoSettlementBatch.findUnique.mockResolvedValue(fixtureWithDeviceReturn());
        glMocks(70);
        pairedJournal.postPaired.mockResolvedValue({
          financeJournalEntryId: 'je-f',
          shopJournalEntryId: 'je-s',
        });

        const posted = await service.approveBatch('batch-1', 'approver-1');
        expect(posted.status).toBe('POSTED');

        const args = pairedJournal.postPaired.mock.calls[0][0];
        expect(tuples(args.finance.lines)).toEqual([
          ['21-1101', '100.00', '0.00', 'ล้างเจ้าหนี้ยอดจัด CT-0001'],
          ['11-2107', '0.00', '70.00', 'หักค่าเครื่องคืน CT-0100'],
          ['11-1201', '0.00', '30.00', expect.stringContaining('จ่ายให้หน้าร้าน รอบ')],
        ]);
        expect(tuples(args.shop.lines)).toEqual([
          ['S11-1201', '30.00', '0.00', expect.stringContaining('รับโอนจาก FINANCE รอบ')],
          ['S21-1104', '70.00', '0.00', 'ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน CT-0100'],
          ['S11-3001', '0.00', '100.00', 'ล้างลูกหนี้ FINANCE-ยอดจัด CT-0001'],
        ]);

        for (const half of [args.finance, args.shop]) {
          expect(half.metadata.netTransferAmount).toBe('30.00');
          expect(half.metadata.contractId).toBeUndefined();
          expect(half.metadata.shopReceivableType).toBeUndefined();
          const drMeta = half.metadata.items.find((i: { contractId: string }) => i.contractId === 'c-dr');
          expect(drMeta).toEqual({
            contractId: 'c-dr',
            type: 'DEVICE_RETURN',
            financed: '0.00',
            commission: '0.00',
            swapCredit: '0.00',
            recall: '0.00',
            deviceReturn: '70.00',
          });
          const yMeta = half.metadata.items.find((i: { contractId: string }) => i.contractId === 'c-1');
          expect(yMeta.deviceReturn).toBe('0.00');
        }

        // clash re-check type-aware (ชุดเดียวกับ submit)
        const clashWhere = tx.interCoSettlementItem.findMany.mock.calls[0][0].where;
        expect(clashWhere.OR).toEqual([
          { contractId: { in: ['c-1'] } },
          { contractId: { in: ['c-dr'] }, itemType: 'DEVICE_RETURN' },
        ]);
      });

      it('drift: typed DEVICE_RETURN net (60) ≠ snapshot (70) → reject ไม่โพสต์', async () => {
        tx.interCoSettlementBatch.findUnique.mockResolvedValue(fixtureWithDeviceReturn());
        glMocks(60);
        await expect(service.approveBatch('batch-1', 'approver-1')).rejects.toThrow(
          /CT-0100.*เปลี่ยนไปจากตอนสร้างรอบ/,
        );
        expect(pairedJournal.postPaired).not.toHaveBeenCalled();
        expect(tx.interCoSettlementBatch.update).not.toHaveBeenCalled();
      });

      it('ด่าน (i): untyped 11-2107 ของสัญญา (60) ไม่คุ้มยอดหัก (70) → reject (กันหักซ้ำกับใบรับโอน)', async () => {
        tx.interCoSettlementBatch.findUnique.mockResolvedValue(fixtureWithDeviceReturn());
        glMocks(70);
        tx.journalLine.findMany.mockImplementation(({ where }: { where: { accountCode: string } }) => {
          if (where.accountCode === '21-1101') return Promise.resolve([{ debit: D(0), credit: D(100) }]);
          if (where.accountCode === 'S11-3001') return Promise.resolve([{ debit: D(100), credit: D(0) }]);
          if (where.accountCode === '11-2107') return Promise.resolve([{ debit: D(70), credit: D(10) }]);
          return Promise.resolve([]);
        });
        await expect(service.approveBatch('batch-1', 'approver-1')).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
        expect(pairedJournal.postPaired).not.toHaveBeenCalled();
      });

      it('same-type NET (spec §6.3 ฉบับตัดสิน): เครดิตสวอป 80 ที่รอบ POSTED อื่นหักไปแล้วไม่ลดค่าเครื่องคืน 70 → approve ผ่าน (สูตร all-types จะ reject)', async () => {
        tx.interCoSettlementBatch.findUnique.mockResolvedValue(fixtureWithDeviceReturn());
        glMocks(70);
        // untyped 11-2107 ของ c-dr = A.3 80 + JP5 70 = 150 (ขา Cr ของรอบเก่าไม่ stamp contractId)
        tx.journalLine.findMany.mockImplementation(({ where }: { where: { accountCode: string } }) => {
          if (where.accountCode === '21-1101') return Promise.resolve([{ debit: D(0), credit: D(100) }]);
          if (where.accountCode === 'S11-3001') return Promise.resolve([{ debit: D(100), credit: D(0) }]);
          if (where.accountCode === '11-2107') return Promise.resolve([{ debit: D(150), credit: D(0) }]);
          return Promise.resolve([]);
        });
        // call 0 = clash re-check (ว่าง), call 1 = priorItems ของ c-dr: SETTLEMENT item รอบเก่าที่หักเครดิตสวอป 80
        tx.interCoSettlementItem.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { swapCreditAmount: D(80), recallAmount: D(0), deviceReturnAmount: D(0) },
          ]);
        pairedJournal.postPaired.mockResolvedValue({
          financeJournalEntryId: 'je-f',
          shopJournalEntryId: 'je-s',
        });

        // ด่าน (i): 150 − 80 = 70 ≥ 70 ✓ · branch DEVICE_RETURN: typed 70 − same-type 0 = 70 = snapshot ✓
        const posted = await service.approveBatch('batch-1', 'approver-1');
        expect(posted.status).toBe('POSTED');
        const args = pairedJournal.postPaired.mock.calls[0][0];
        expect(tuples(args.finance.lines)).toContainEqual(['11-2107', '0.00', '70.00', 'หักค่าเครื่องคืน CT-0100']);
      });
    });
```

(ข) vitest — เพิ่ม helper `seedSwapContract` ใต้ `seedDeviceReturnPair` ใน `interco-device-return.integration.spec.ts` (shape เดียวกับ netting spec L219-261: 1A + SHOP legs + A.3 stamp SWAP_CREDIT + A.4 key `newContractId`) — ใช้พิสูจน์กติกา same-type บน flow จริง (Task 8 + Task 9):

```ts
/**
 * สัญญา swap ตาม workbook Case 8 (payable 10,000+1,000 / SHOP legs เท่ากัน / เครดิตรับซื้อ 8,000):
 * A.3 → 11-2107 [SWAP_CREDIT] (flow legacy + explicit stamp), A.4 → S21-1104 [SWAP_CREDIT] key
 * ด้วย metadata.newContractId. ใช้เป็น "สัญญาที่เคยถูกหักเครดิตในรอบจ่าย แล้วภายหลังถูกยึด".
 */
async function seedSwapContract(id: string) {
  await seed1a(id);
  await seedShopLegs(id, '10000', '1000');
  await journalAuto.createAndPost({
    description: 'A.3 synthetic',
    companyId: financeId,
    metadata: {
      flow: 'exchange-buyback-receivable-11-2107',
      idempotencyKey: `ta3:${id}`,
      contractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('8000'), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec('8000') },
    ],
  });
  await journalAuto.createAndPost({
    description: 'A.4 synthetic',
    companyId: shopId,
    metadata: {
      flow: 'shop-exchange-return',
      idempotencyKey: `ta4:${id}`,
      contractId: `${id}-old`,
      newContractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: 'S11-2002', dr: dec('8000'), cr: zero },
      { accountCode: 'S21-1104', dr: zero, cr: dec('8000') },
    ],
  });
}
```

แล้วเพิ่ม describe ต่อท้าย describe Task 7:

```ts
  // ===========================================================================
  // Task 8 — approve/reverse: golden §6.5 สองสมุด + drift + residual + reverse
  // ===========================================================================
  describe('approveBatch/reverseBatch — golden §6.5 (Task 8)', () => {
    let goldenNormalId: string;
    let goldenDrId: string;
    let goldenBatchId: string;
    let goldenFinanceJeId: string;
    let goldenShopJeId: string;
    let preApprove2107: Decimal;
    let preApproveS21: Decimal;
    let preApproveDrift: Awaited<ReturnType<IntercoAgingService['getTypedAccountDrift']>>;

    beforeAll(async () => {
      // Safety nets (convention ของ netting spec): SoD flag / งวด 2026-09 ที่ปิดจาก run ก่อน
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 9 },
      });
      goldenNormalId = await seedBaseContract(20);
      await seedNormalContract(goldenNormalId);
      goldenDrId = await seedBaseContract(21, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(goldenDrId);
    }, 120_000);

    it(
      'approve → FINANCE Dr 21-1101 10,000 · Dr 21-1102 1,000 / Cr 11-2107 7,000 · Cr 11-1201 4,000; SHOP Dr S21-1104 7,000 · Dr S11-1201 4,000 / Cr S11-3001 10,000 · Cr S11-3002 1,000',
      async () => {
        preApprove2107 = await wholeAccountBalance('11-2107');
        preApproveS21 = await wholeAccountBalance('S21-1104');
        preApproveDrift = await agingService.getTypedAccountDrift();

        const batch = await settlementService.createBatch(
          {
            contractIds: [goldenNormalId],
            deviceReturnContractIds: [goldenDrId],
            transferDate: '2026-09-20',
          },
          adminId,
        );
        createdBatchIds.push(batch.id);
        goldenBatchId = batch.id;
        await settlementService.submitBatch(batch.id, adminId);
        const posted = await settlementService.approveBatch(batch.id, adminId);
        expect(posted.status).toBe('POSTED');
        goldenFinanceJeId = posted.financeJournalEntryId!;
        goldenShopJeId = posted.shopJournalEntryId!;

        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: goldenFinanceJeId },
          include: { lines: true },
        });
        expect(sumSide(je.lines, '21-1101', 'dr').toFixed(2)).toBe('10000.00');
        expect(sumSide(je.lines, '21-1102', 'dr').toFixed(2)).toBe('1000.00');
        expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('7000.00');
        expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('4000.00');
        expect(je.lines).toHaveLength(4); // แถว DEVICE_RETURN ไม่สร้าง Dr 21-1101 ยอด 0
        const cr2107 = je.lines.find((l) => l.accountCode === '11-2107')!;
        expect(cr2107.description).toContain('หักค่าเครื่องคืน');

        const shopJe = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: goldenShopJeId },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S21-1104', 'dr').toFixed(2)).toBe('7000.00');
        expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('4000.00');
        expect(sumSide(shopJe.lines, 'S11-3001', 'cr').toFixed(2)).toBe('10000.00');
        expect(sumSide(shopJe.lines, 'S11-3002', 'cr').toFixed(2)).toBe('1000.00');
        expect(shopJe.lines).toHaveLength(4);
        const drS21 = shopJe.lines.find((l) => l.accountCode === 'S21-1104')!;
        expect(drS21.description).toContain('ค่าเครื่องคืน');

        // เลนส์ gross + item gate: typed ไม่ขยับ, item POSTED = หักแล้ว, X หลุดคิว
        expect((await deviceReturnFinanceBalance(prisma, goldenDrId)).toFixed(2)).toBe('7000.00');
        expect((await deviceReturnShopBalance(prisma, goldenDrId)).toFixed(2)).toBe('7000.00');
        const rows = await pendingService.getPendingDeviceReturns();
        expect(rows.some((r) => r.contractId === goldenDrId)).toBe(false);
        const pending = await pendingService.getPendingContracts();
        expect(pending.some((p) => p.contractId === goldenNormalId)).toBe(false);

        // ระดับบัญชี (trial balance): ขา Cr/Dr ของ batch นับปกติ
        expect((await wholeAccountBalance('11-2107')).minus(preApprove2107).toFixed(2)).toBe('-7000.00');
        expect((await wholeAccountBalance('S21-1104')).minus(preApproveS21).toFixed(2)).toBe('7000.00');

        // กระทบยอดระดับบัญชี: drift ไม่ขยับ (accountTotal −7,000 = expected −7,000 ผ่าน settledDeduction +7,000)
        const drift = await agingService.getTypedAccountDrift();
        for (const code of ['11-2107', 'S21-1104']) {
          const b = preApproveDrift.find((d) => d.accountCode === code)!;
          const a = drift.find((d) => d.accountCode === code)!;
          expect(a.settledDeduction.minus(b.settledDeduction).toFixed(2)).toBe('7000.00');
          expect(a.drift.minus(b.drift).abs().lte('0.01')).toBe(true);
        }
      },
      120_000,
    );

    it('metadata.items ของทั้งสองใบ: type DEVICE_RETURN + deviceReturn 7000.00; ไม่ stamp contractId/shopReceivableType top-level', async () => {
      const [financeJe, shopJe] = await Promise.all([
        prisma.journalEntry.findUniqueOrThrow({ where: { id: goldenFinanceJeId } }),
        prisma.journalEntry.findUniqueOrThrow({ where: { id: goldenShopJeId } }),
      ]);
      for (const [je, book] of [
        [financeJe, 'FINANCE'],
        [shopJe, 'SHOP'],
      ] as const) {
        const meta = je.metadata as {
          flow?: string;
          idempotencyKey?: string;
          netTransferAmount?: string;
          contractId?: unknown;
          shopReceivableType?: unknown;
          items?: Array<Record<string, string>>;
        };
        expect(meta.flow).toBe('interco-settlement-batch');
        expect(meta.idempotencyKey).toBe(`interco:${goldenBatchId}:${book}`);
        expect(meta.netTransferAmount).toBe('4000.00');
        expect(meta.contractId).toBeUndefined();
        expect(meta.shopReceivableType).toBeUndefined();
        const drMeta = meta.items!.find((i) => i.contractId === goldenDrId)!;
        expect(drMeta.type).toBe('DEVICE_RETURN');
        expect(drMeta.deviceReturn).toBe('7000.00');
        expect(drMeta.swapCredit).toBe('0.00');
        expect(drMeta.recall).toBe('0.00');
        expect(drMeta.financed).toBe('0.00');
        const yMeta = meta.items!.find((i) => i.contractId === goldenNormalId)!;
        expect(yMeta.type).toBe('SETTLEMENT');
        expect(yMeta.deviceReturn).toBe('0.00');
      }
      // JE ทั้งสองใบไม่เข้าเลนส์ใด — classify = UNKNOWN (ตามสถาปัตยกรรม)
      expect(classifyShopReceivable(financeJe.metadata)).toBe('UNKNOWN');
    });

    it('residual alarm เงียบหลัง approve (typed gross 7,000 − Σ POSTED deduction 7,000 = 0)', async () => {
      const svc = settlementService as unknown as {
        alarmNettingResiduals(batchId: string): Promise<void>;
      };
      const captureMessage = vi.mocked(Sentry.captureMessage);
      captureMessage.mockClear();
      await svc.alarmNettingResiduals(goldenBatchId);
      expect(
        captureMessage.mock.calls.filter(
          ([msg]) => msg === 'Interco netting: residual balance after approve',
        ),
      ).toHaveLength(0);
    });

    it(
      'drift guard: JE DEVICE_RETURN แทรกหลัง submit → approve reject (net 7,500 ≠ snapshot 7,000)',
      async () => {
        const y = await seedBaseContract(22);
        await seedNormalContract(y);
        const x = await seedBaseContract(23, 'CLOSED_BAD_DEBT');
        await seedDeviceReturnPair(x);

        const batch = await settlementService.createBatch(
          { contractIds: [y], deviceReturnContractIds: [x], transferDate: '2026-09-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);

        await journalAuto.createAndPost({
          description: 'DEVICE_RETURN drift synthetic',
          companyId: financeId,
          metadata: {
            flow: 'test-jp5-device-return',
            idempotencyKey: `tjp5drift:${x}`,
            contractId: x,
            shopReceivableType: 'DEVICE_RETURN',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('500'), cr: zero },
            { accountCode: '21-1103', dr: zero, cr: dec('500') },
          ],
        });

        await expect(settlementService.approveBatch(batch.id, adminId)).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
        const after = await prisma.interCoSettlementBatch.findUniqueOrThrow({ where: { id: batch.id } });
        expect(after.status).toBe('PENDING_APPROVAL');
        expect(after.financeJournalEntryId).toBeNull();
      },
      120_000,
    );

    it(
      'approve ผ่านทั้งที่สัญญาค่าเครื่องคืนมี SETTLEMENT item ใน batch POSTED เดิม (ยึดหลังเคยถูกจ่าย — clash type-aware ที่ approve)',
      async () => {
        const y = await seedBaseContract(24);
        await seedNormalContract(y);
        const x = await seedBaseContract(25, 'CLOSED_BAD_DEBT');
        await seedDeviceReturnPair(x);
        const hist = await seedBatch('POSTED', 5);
        await prisma.interCoSettlementItem.create({
          data: {
            batchId: hist.id,
            contractId: x,
            itemType: 'SETTLEMENT',
            financedGl: dec('10000.00'),
            commissionGl: dec('1000.00'),
            shopFinancedGl: dec('10000.00'),
            shopCommissionGl: dec('1000.00'),
          },
        });

        const batch = await settlementService.createBatch(
          { contractIds: [y], deviceReturnContractIds: [x], transferDate: '2026-09-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);
        const posted = await settlementService.approveBatch(batch.id, adminId);
        expect(posted.status).toBe('POSTED');
      },
      120_000,
    );

    it(
      'กติกาที่ตัดสิน (same-type NET): swap ที่ถูกหักเครดิต 8,000 ในรอบ POSTED แล้วถูกยึด (ค่าเครื่องคืน 7,000) → คิวเห็น 7,000, รอบถัดไปหัก 7,000 ผ่าน drift guard, ทั้งบัญชีปิดพอดี, residual alarm เงียบ',
      async () => {
        const pre2107 = await wholeAccountBalance('11-2107');
        const preS21 = await wholeAccountBalance('S21-1104');

        // (1) swap ปกติ → รอบจ่ายแรกหักเครดิต 8,000 → POSTED (A.3 ไม่ถูก mirror เพราะไม่ได้ยกเลิก)
        const swap = await seedBaseContract(26);
        await seedSwapContract(swap);
        const b1 = await settlementService.createBatch(
          { contractIds: [swap], transferDate: '2026-09-20' },
          adminId,
        );
        createdBatchIds.push(b1.id);
        await settlementService.submitBatch(b1.id, adminId);
        await settlementService.approveBatch(b1.id, adminId);
        expect((await swapCreditFinanceBalance(prisma, swap)).toFixed(2)).toBe('8000.00'); // เลนส์ gross

        // (2) ภายหลังถูกยึด → คู่ JE DEVICE_RETURN 7,000 (สัญญา → CLOSED_BAD_DEBT)
        await prisma.contract.update({ where: { id: swap }, data: { status: 'CLOSED_BAD_DEBT' } });
        await seedDeviceReturnPair(swap);

        // คิวค่าเครื่องคืน: NET หักเฉพาะ deviceReturnAmount — เครดิตสวอป 8,000 ที่หักไปแล้วไม่เกี่ยว
        // (สูตร all-types จะได้ 7,000 − 8,000 < 0 ⇒ หลุดคิวทั้งที่หนี้ค่าเครื่องคืนมีจริง)
        let rows = await pendingService.getPendingDeviceReturns();
        const row = rows.find((r) => r.contractId === swap)!;
        expect(row).toBeDefined();
        expect(row.deviceReturnGl.toFixed(2)).toBe('7000.00');
        expect(row.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');
        // รายงานอายุ (สูตร combined ระดับสัญญา — ไม่เปลี่ยน): 8,000 + 7,000 − 8,000 = 7,000
        const aging = await agingService.getShopReceivableAging();
        const agingRow = aging.rows.find((r) => r.contractId === swap)!;
        expect(agingRow.intercoNet.toFixed(2)).toBe('7000.00');
        expect(agingRow.shopMirrorNet.toFixed(2)).toBe('7000.00');
        expect(agingRow.bookMismatch).toBe(false);

        // (3) รอบถัดไป: Y ปกติ + ค่าเครื่องคืนของ swap → approve ผ่าน (drift branch ใช้ same-type;
        //     ด่าน (i) untyped 15,000 − 8,000 = 7,000 ≥ 7,000)
        const y = await seedBaseContract(27);
        await seedNormalContract(y);
        const b2 = await settlementService.createBatch(
          { contractIds: [y], deviceReturnContractIds: [swap], transferDate: '2026-09-20' },
          adminId,
        );
        createdBatchIds.push(b2.id);
        expect(b2.items.find((i) => i.contractId === swap)!.deviceReturnAmount.toFixed(2)).toBe('7000.00');
        await settlementService.submitBatch(b2.id, adminId);
        const posted = await settlementService.approveBatch(b2.id, adminId);
        expect(posted.status).toBe('POSTED');
        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.financeJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('7000.00');
        expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('4000.00');

        // ทั้งบัญชี: +8,000 (A.3) −8,000 (b1) +7,000 (JP5) −7,000 (b2) = 0 ทั้งสองสมุด
        expect((await wholeAccountBalance('11-2107')).minus(pre2107).toFixed(2)).toBe('0.00');
        expect((await wholeAccountBalance('S21-1104')).minus(preS21).toFixed(2)).toBe('0.00');
        rows = await pendingService.getPendingDeviceReturns();
        expect(rows.some((r) => r.contractId === swap)).toBe(false);

        // residual alarm (สูตร combined — ไม่เปลี่ยน): typed 8,000 + 7,000 − Σ POSTED 15,000 = 0 ทั้งสองรอบ
        const svc = settlementService as unknown as {
          alarmNettingResiduals(batchId: string): Promise<void>;
        };
        const captureMessage = vi.mocked(Sentry.captureMessage);
        captureMessage.mockClear();
        await svc.alarmNettingResiduals(b1.id);
        await svc.alarmNettingResiduals(b2.id);
        expect(
          captureMessage.mock.calls.filter(
            ([msg]) => msg === 'Interco netting: residual balance after approve',
          ),
        ).toHaveLength(0);
      },
      180_000,
    );

    it(
      'reverse → X กลับเข้าคิวที่ 7,000, Y กลับเข้าคิวรอจ่าย, mirror ครอบบรรทัดหักเอง, บัญชีกลับเท่าก่อน approve',
      async () => {
        const preReverse2107 = await wholeAccountBalance('11-2107');
        const reversed = await settlementService.reverseBatch(
          goldenBatchId,
          adminId,
          'ทดสอบย้อนกลับรอบหักค่าเครื่องคืน',
        );
        expect(reversed.status).toBe('REVERSED');

        const rows = await pendingService.getPendingDeviceReturns();
        expect(rows.find((r) => r.contractId === goldenDrId)!.deviceReturnGl.toFixed(2)).toBe('7000.00');
        const pending = await pendingService.getPendingContracts();
        expect(pending.some((p) => p.contractId === goldenNormalId)).toBe(true);

        const reversals = await prisma.journalEntry.findMany({
          where: {
            metadata: { path: ['flow'], equals: 'interco-settlement-batch-reverse' } as never,
            deletedAt: null,
          },
          include: { lines: true },
        });
        const revFin = reversals.find(
          (je) => (je.metadata as { reversesEntryId?: string }).reversesEntryId === goldenFinanceJeId,
        )!;
        expect(revFin).toBeDefined();
        expect(sumSide(revFin.lines, '11-2107', 'dr').toFixed(2)).toBe('7000.00');
        expect(sumSide(revFin.lines, '11-1201', 'dr').toFixed(2)).toBe('4000.00');
        expect(sumSide(revFin.lines, '21-1101', 'cr').toFixed(2)).toBe('10000.00');
        const revShop = reversals.find(
          (je) => (je.metadata as { reversesEntryId?: string }).reversesEntryId === goldenShopJeId,
        )!;
        expect(revShop).toBeDefined();
        expect(sumSide(revShop.lines, 'S21-1104', 'cr').toFixed(2)).toBe('7000.00');
        expect(sumSide(revShop.lines, 'S11-1201', 'cr').toFixed(2)).toBe('4000.00');

        expect((await wholeAccountBalance('11-2107')).minus(preReverse2107).toFixed(2)).toBe('7000.00');
      },
      120_000,
    );
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-settlement.service.spec.ts`
Expected: FAIL — เทสแรกของ describe ใหม่: FINANCE lines มี `['21-1101', '0.00', '0.00', 'ล้างเจ้าหนี้ยอดจัด CT-0100']` (แถว DEVICE_RETURN ถูกปฏิบัติเป็น SETTLEMENT) และไม่มีบรรทัด 11-2107 (`deductionOf` ยังไม่มี — `item.itemType === 'RECALL' ? … : swapCreditAmount` = 0)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..`
Expected: FAIL — approve โยน `Unbalanced JE` (Cr bank 4,000 แต่ไม่มี Cr 11-2107) หรือ drift guard reject เพราะ branch DEVICE_RETURN ยังไม่มี (แถวตกไปเช็คแบบ SETTLEMENT)

- [ ] **Step 3: แก้ `interco-settlement.service.ts`**

เดิม (L23-28):

```ts
import {
  recallFinanceBalance,
  recallShopBalance,
  swapCreditFinanceBalance,
  swapCreditShopBalance,
} from './interco-typed-balance';
```

ใหม่:

```ts
import {
  deviceReturnFinanceBalance,
  deviceReturnShopBalance,
  recallFinanceBalance,
  recallShopBalance,
  swapCreditFinanceBalance,
  swapCreditShopBalance,
} from './interco-typed-balance';
```

เดิม (L789-808 — clash ใน `approveBatch`):

```ts
      // 2. re-check no item's contract got grabbed by another PENDING_APPROVAL/POSTED batch.
      //    Type-aware per item (Phase 2 — same split as submitBatch): a RECALL
      //    row's contract BY DEFINITION carries a permanent SETTLEMENT item in
      //    some old POSTED batch (Flow C-2 = ยกเลิกหลังตัดจ่าย) — counting that
      //    as a clash would make every batch with a recall row structurally
      //    unapprovable. RECALL rows clash only with other RECALL items;
      //    SETTLEMENT rows keep the any-type clash (double-pay guard).
      const clashSettlementIds = batch.items
        .filter((i) => i.itemType !== 'RECALL')
        .map((i) => i.contractId);
      const clashRecallIds = batch.items
        .filter((i) => i.itemType === 'RECALL')
        .map((i) => i.contractId);
      const clashConditions: Prisma.InterCoSettlementItemWhereInput[] = [];
      if (clashSettlementIds.length > 0) {
        clashConditions.push({ contractId: { in: clashSettlementIds } });
      }
      if (clashRecallIds.length > 0) {
        clashConditions.push({ contractId: { in: clashRecallIds }, itemType: 'RECALL' });
      }
```

ใหม่:

```ts
      // 2. re-check no item's contract got grabbed by another PENDING_APPROVAL/POSTED batch.
      //    Type-aware per item (Phase 2 + ใบรับเครื่องคืน 2026-09-20 — same split as
      //    submitBatch): a RECALL / DEVICE_RETURN row's contract BY DEFINITION carries a
      //    permanent SETTLEMENT item in some old POSTED batch — counting that as a clash
      //    would make every batch with a deduction-only row structurally unapprovable.
      //    `buildClashConditions`: deduction-only rows clash only with items of the SAME
      //    type; SETTLEMENT rows keep the any-type clash (double-pay guard).
      const clashConditions = buildClashConditions(batch.items);
```

(บรรทัด 809-825 `if (clashConditions.length > 0) { … }` คงเดิม)

เดิม (L839-866 — ด่าน (i) ใน drift guard):

```ts
        const deduction = item.swapCreditAmount.plus(item.recallAmount);
        // Σ deduction ที่ batch POSTED **อื่น** เคยหักไปแล้ว (ทุก itemType) —
        // ใช้ร่วมกันทั้งด่าน (i) และเช็ค NET ของแถว RECALL ด้านล่าง. batch
        // ปัจจุบันยัง PENDING_APPROVAL จึงไม่เข้า filter POSTED โดยสถานะอยู่แล้ว
        // แต่ exclude ด้วย `batchId: { not: id }` ให้ชัดตาม pattern ด่าน (i).
        let priorPostedDeductions = new Prisma.Decimal(0);
        if (deduction.gt(0)) {
          const [untypedBal, priorItems] = await Promise.all([
            glContractBalance(tx, item.contractId, '11-2107', 'dr'),
            tx.interCoSettlementItem.findMany({
              where: {
                contractId: item.contractId,
                batchId: { not: id },
                deletedAt: null,
                batch: { status: 'POSTED', deletedAt: null },
              },
              select: { swapCreditAmount: true, recallAmount: true },
            }),
          ]);
          priorPostedDeductions = priorItems.reduce(
            (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount),
            new Prisma.Decimal(0),
          );
          if (untypedBal.minus(priorPostedDeductions).lt(deduction.minus(DRIFT_TOLERANCE))) {
            driftedContractNumbers.push(item.contract.contractNumber);
            continue;
          }
        }
```

ใหม่:

```ts
        const deduction = sumDeductions([item]);
        // Σ deduction ที่ batch POSTED **อื่น** เคยหักไปแล้ว (ทุก itemType) —
        // ใช้ร่วมกันทั้งด่าน (i) และเช็ค NET ของแถว RECALL / DEVICE_RETURN ด้านล่าง.
        // batch ปัจจุบันยัง PENDING_APPROVAL จึงไม่เข้า filter POSTED โดยสถานะอยู่แล้ว
        // แต่ exclude ด้วย `batchId: { not: id }` ให้ชัดตาม pattern ด่าน (i).
        let priorPostedDeductions = new Prisma.Decimal(0);
        // same-type (spec §6.3 ฉบับตัดสิน): แถว DEVICE_RETURN เทียบ NET ที่หักเฉพาะ deviceReturnAmount
        // ของ batch POSTED อื่น — เครดิตสวอป/เรียกคืนที่เคยหักไม่ลดค่าเครื่องคืน (สูตรเดียวกับ
        // getPendingDeviceReturns / DEVICE_RETURN_DEDUCTION_COLUMNS)
        let priorPostedDeviceReturnDeductions = new Prisma.Decimal(0);
        if (deduction.gt(0)) {
          const [untypedBal, priorItems] = await Promise.all([
            glContractBalance(tx, item.contractId, '11-2107', 'dr'),
            tx.interCoSettlementItem.findMany({
              where: {
                contractId: item.contractId,
                batchId: { not: id },
                deletedAt: null,
                batch: { status: 'POSTED', deletedAt: null },
              },
              select: { swapCreditAmount: true, recallAmount: true, deviceReturnAmount: true },
            }),
          ]);
          priorPostedDeductions = sumDeductions(priorItems);
          priorPostedDeviceReturnDeductions = priorItems.reduce(
            (s, i) => s.plus(i.deviceReturnAmount),
            new Prisma.Decimal(0),
          );
          // ด่าน (i) ยังเป็นระดับสัญญา (untyped − ทุกประเภท): สัญญา swap ที่เคยถูกหัก 8,000 แล้วถูกยึด
          // มี untyped 8,000 + 7,000 − 8,000 = 7,000 ≥ ยอดหัก 7,000 → ผ่าน
          if (untypedBal.minus(priorPostedDeductions).lt(deduction.minus(DRIFT_TOLERANCE))) {
            driftedContractNumbers.push(item.contract.contractNumber);
            continue;
          }
        }
        if (item.itemType === 'DEVICE_RETURN') {
          // แถว DEVICE_RETURN (ใบรับเครื่องคืน §6.3 ฉบับตัดสิน) — same-type NET (ต่างจากแถว RECALL
          // ด้านล่างที่หักทุกประเภท): typed DEVICE_RETURN ทั้งสองสมุด − Σ deviceReturnAmount ที่
          // batch POSTED อื่นหักไปแล้ว ต้องเท่ากับ snapshot ±0.01 (snapshot จาก
          // getPendingDeviceReturns เป็น net สูตรเดียวกัน — ถ้าหักทุกประเภทที่นี่ รอบที่ถูกต้องของ
          // สัญญา swap-แล้วถูกยึด จะ reject ทันที: 7,000 − 8,000 ≠ 7,000)
          const [drFin, drShop] = await Promise.all([
            deviceReturnFinanceBalance(tx, item.contractId),
            deviceReturnShopBalance(tx, item.contractId),
          ]);
          const netFin = drFin.minus(priorPostedDeviceReturnDeductions);
          const netShop = drShop.minus(priorPostedDeviceReturnDeductions);
          if (
            netFin.minus(item.deviceReturnAmount).abs().gt(DRIFT_TOLERANCE) ||
            netShop.minus(item.deviceReturnAmount).abs().gt(DRIFT_TOLERANCE)
          ) {
            driftedContractNumbers.push(item.contract.contractNumber);
          }
          continue;
        }
```

(บรรทัด 867-890 branch `if (item.itemType === 'RECALL') { … continue; }` และ 891-928 branch SETTLEMENT คงเดิม)

เดิม (L947-954):

```ts
      const itemsMetadata = batch.items.map((i) => ({
        contractId: i.contractId,
        type: i.itemType,
        financed: i.financedGl.toFixed(2),
        commission: i.commissionGl.toFixed(2),
        swapCredit: i.swapCreditAmount.toFixed(2),
        recall: i.recallAmount.toFixed(2),
      }));
```

ใหม่:

```ts
      const itemsMetadata = batch.items.map((i) => ({
        contractId: i.contractId,
        type: i.itemType,
        financed: i.financedGl.toFixed(2),
        commission: i.commissionGl.toFixed(2),
        swapCredit: i.swapCreditAmount.toFixed(2),
        recall: i.recallAmount.toFixed(2),
        deviceReturn: i.deviceReturnAmount.toFixed(2),
      }));
```

เดิม (L1129-1131 ใน jsdoc ของ `alarmNettingResiduals`):

```ts
   * สูตร COMBINED ต่อสัญญา (Phase 3 Task 4 — ปิด carry b): typed gross =
   * SWAP_CREDIT + PAYOUT_RECALL **รวมสองประเภท** ต่อสมุด, เทียบกับ Σ deduction
   * ทุก itemType ใน batch POSTED. เหตุผล: สัญญา swap ที่ถูกยกเลิก (C-2) มี
```

ใหม่:

```ts
   * สูตร COMBINED ต่อสัญญา (Phase 3 Task 4 — ปิด carry b; + DEVICE_RETURN ใบรับเครื่องคืน
   * 2026-09-20 §6.3): typed gross = SWAP_CREDIT + PAYOUT_RECALL + DEVICE_RETURN **รวมทุก
   * ประเภทของกลุ่ม interco** ต่อสมุด, เทียบกับ Σ deduction ทุก itemType ใน batch POSTED.
   * เหตุผล: สัญญา swap ที่ถูกยกเลิก (C-2) มี
```

เดิม (L1146-1169):

```ts
    for (const item of batch.items) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      if (deduction.lte(0)) continue;
      const [swapFin, swapShop, recFin, recShop] = await Promise.all([
        swapCreditFinanceBalance(this.prisma, item.contractId),
        swapCreditShopBalance(this.prisma, item.contractId),
        recallFinanceBalance(this.prisma, item.contractId),
        recallShopBalance(this.prisma, item.contractId),
      ]);
      const fin = swapFin.plus(recFin);
      const shop = swapShop.plus(recShop);
      // Σ deduction ของสัญญานี้ในทุก batch POSTED (รวมรอบนี้เอง)
      const postedItems = await this.prisma.interCoSettlementItem.findMany({
        where: {
          contractId: item.contractId,
          deletedAt: null,
          batch: { status: 'POSTED', deletedAt: null },
        },
        select: { swapCreditAmount: true, recallAmount: true },
      });
      const postedDeduction = postedItems.reduce(
        (s, i) => s.plus(i.swapCreditAmount).plus(i.recallAmount),
        new Prisma.Decimal(0),
      );
```

ใหม่:

```ts
    for (const item of batch.items) {
      const deduction = sumDeductions([item]);
      if (deduction.lte(0)) continue;
      const [swapFin, swapShop, recFin, recShop, drFin, drShop] = await Promise.all([
        swapCreditFinanceBalance(this.prisma, item.contractId),
        swapCreditShopBalance(this.prisma, item.contractId),
        recallFinanceBalance(this.prisma, item.contractId),
        recallShopBalance(this.prisma, item.contractId),
        deviceReturnFinanceBalance(this.prisma, item.contractId),
        deviceReturnShopBalance(this.prisma, item.contractId),
      ]);
      const fin = swapFin.plus(recFin).plus(drFin);
      const shop = swapShop.plus(recShop).plus(drShop);
      // Σ deduction ของสัญญานี้ในทุก batch POSTED (รวมรอบนี้เอง) — ทุก itemType
      const postedItems = await this.prisma.interCoSettlementItem.findMany({
        where: {
          contractId: item.contractId,
          deletedAt: null,
          batch: { status: 'POSTED', deletedAt: null },
        },
        select: { swapCreditAmount: true, recallAmount: true, deviceReturnAmount: true },
      });
      const postedDeduction = sumDeductions(postedItems);
```

เดิม (L1579-1697 — `buildFinanceLines` + `buildShopLines` ทั้งสอง method):

```ts
  /**
   * Dr 21-1101 per SETTLEMENT contract (always) + Dr 21-1102 per contract
   * (skip zero) + Cr 11-2107 per deduction (swap credit / recall — Phase 2
   * หักกลบ, workbook จุดที่ 3) + Cr bank = netTransferAmount (skip when 0 —
   * รอบที่หักจนเงินโอนจริงเป็นศูนย์ต้องไม่มีบรรทัดธนาคาร). RECALL rows carry
   * no payable snapshot of their own — they contribute ONLY the Cr 11-2107
   * leg (never a zero-amount Dr 21-1101 line).
   */
  private buildFinanceLines(batch: BatchWithItems, description: string): JeLineInput[] {
    const zero = new Prisma.Decimal(0);
    const lines: JeLineInput[] = [];
    for (const item of batch.items) {
      if (item.itemType === 'RECALL') continue;
      lines.push({
        accountCode: '21-1101',
        dr: item.financedGl,
        cr: zero,
        description: `ล้างเจ้าหนี้ยอดจัด ${item.contract.contractNumber}`,
      });
    }
    for (const item of batch.items) {
      if (item.commissionGl.gt(0)) {
        lines.push({
          accountCode: '21-1102',
          dr: item.commissionGl,
          cr: zero,
          description: `ล้างเจ้าหนี้ค่าคอม ${item.contract.contractNumber}`,
        });
      }
    }
    for (const item of batch.items) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      if (deduction.gt(0)) {
        lines.push({
          accountCode: '11-2107',
          dr: zero,
          cr: deduction,
          description:
            item.itemType === 'RECALL'
              ? `หักเรียกคืนจากยกเลิก ${item.contract.contractNumber}`
              : `หักเครดิตเปลี่ยนเครื่อง ${item.contract.contractNumber}`,
        });
      }
    }
    // Pre-Phase 2 batches have no netTransferAmount snapshot — fall back to
    // the gross total (identical: their totalDeduction is definitionally 0).
    const netCash = batch.netTransferAmount ?? batch.totalAmount;
    if (netCash.gt(0)) {
      lines.push({
        accountCode: batch.financeBankCode,
        dr: zero,
        cr: netCash,
        description,
      });
    }
    return lines;
  }

  /**
   * Dr shopBankCode = shopNetAmount (skip when 0) + Dr S21-1104 per deduction
   * row (ล้างเจ้าหนี้ FINANCE ฝั่ง SHOP — Phase 2 หักกลบ, ทั้ง SWAP_CREDIT ของ
   * settlement items และ RECALL rows) + Cr S11-3001 per-contract (always) +
   * Cr S11-3002 per-contract (skip zero) — settlement legs ONLY over
   * SETTLEMENT items with `legacyNoShop=false`. Empty array = no SHOP half at
   * all (caller skips `postPaired` and posts FINANCE alone via
   * `JournalAutoService`).
   */
  private buildShopLines(batch: BatchWithItems): JeLineInput[] {
    const zero = new Prisma.Decimal(0);
    const shopItems = batch.items.filter((i) => i.itemType === 'SETTLEMENT' && !i.legacyNoShop);
    const deductionItems = batch.items.filter((i) =>
      (i.itemType === 'RECALL' ? i.recallAmount : i.swapCreditAmount).gt(0),
    );
    if (shopItems.length === 0 && deductionItems.length === 0) return [];

    const lines: JeLineInput[] = [];
    // Pre-Phase 2 batches have no shopNetAmount snapshot — fall back to the
    // gross posted amount (identical: their totalDeduction is definitionally 0).
    const shopNet = batch.shopNetAmount ?? batch.shopPostedAmount;
    if (shopNet.gt(0)) {
      lines.push({
        accountCode: batch.shopBankCode,
        dr: shopNet,
        cr: zero,
        description: `รับโอนจาก FINANCE รอบ ${batch.batchNumber}`,
      });
    }
    for (const item of deductionItems) {
      const deduction = item.itemType === 'RECALL' ? item.recallAmount : item.swapCreditAmount;
      lines.push({
        accountCode: 'S21-1104',
        dr: deduction,
        cr: zero,
        description:
          item.itemType === 'RECALL'
            ? `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${item.contract.contractNumber}`
            : `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน ${item.contract.contractNumber}`,
      });
    }
    for (const item of shopItems) {
      lines.push({
        accountCode: 'S11-3001',
        dr: zero,
        cr: item.shopFinancedGl,
        description: `ล้างลูกหนี้ FINANCE-ยอดจัด ${item.contract.contractNumber}`,
      });
    }
    for (const item of shopItems) {
      if (item.shopCommissionGl.gt(0)) {
        lines.push({
          accountCode: 'S11-3002',
          dr: zero,
          cr: item.shopCommissionGl,
          description: `ล้างลูกหนี้ FINANCE-ค่าคอม ${item.contract.contractNumber}`,
        });
      }
    }
    return lines;
  }
```

ใหม่ (แทนทั้งสอง method + เพิ่ม `deductionOf`):

```ts
  /**
   * ยอดหัก + คำอธิบายบรรทัดหัก (FINANCE `Cr 11-2107` / SHOP `Dr S21-1104`) ของ item หนึ่งแถว
   * ตามประเภท — แหล่งเดียวของ mapping itemType → คอลัมน์ snapshot/ข้อความ (ห้าม inline ternary
   * ซ้ำ): SETTLEMENT = เครดิตเปลี่ยนเครื่อง (swap), RECALL = เรียกคืนยกเลิก (C-2),
   * DEVICE_RETURN = ค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20 §6.3).
   */
  private deductionOf(item: BatchWithItems['items'][number]): {
    amount: Prisma.Decimal;
    financeDescription: string;
    shopDescription: string;
  } {
    const no = item.contract.contractNumber;
    switch (item.itemType) {
      case 'RECALL':
        return {
          amount: item.recallAmount,
          financeDescription: `หักเรียกคืนจากยกเลิก ${no}`,
          shopDescription: `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${no}`,
        };
      case 'DEVICE_RETURN':
        return {
          amount: item.deviceReturnAmount,
          financeDescription: `หักค่าเครื่องคืน ${no}`,
          shopDescription: `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน ${no}`,
        };
      default:
        return {
          amount: item.swapCreditAmount,
          financeDescription: `หักเครดิตเปลี่ยนเครื่อง ${no}`,
          shopDescription: `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน ${no}`,
        };
    }
  }

  /**
   * Dr 21-1101 per SETTLEMENT contract (always) + Dr 21-1102 per contract
   * (skip zero) + Cr 11-2107 per deduction (swap credit / recall / device
   * return — Phase 2 หักกลบ workbook จุดที่ 3 + ใบรับเครื่องคืน 2026-09-20 §6.3)
   * + Cr bank = netTransferAmount (skip when 0 — รอบที่หักจนเงินโอนจริงเป็นศูนย์
   * ต้องไม่มีบรรทัดธนาคาร). Deduction-only rows (RECALL / DEVICE_RETURN) carry
   * no payable snapshot of their own — they contribute ONLY the Cr 11-2107 leg
   * (never a zero-amount Dr 21-1101 line).
   */
  private buildFinanceLines(batch: BatchWithItems, description: string): JeLineInput[] {
    const zero = new Prisma.Decimal(0);
    const lines: JeLineInput[] = [];
    for (const item of batch.items) {
      if (!isPayableRow(item.itemType)) continue;
      lines.push({
        accountCode: '21-1101',
        dr: item.financedGl,
        cr: zero,
        description: `ล้างเจ้าหนี้ยอดจัด ${item.contract.contractNumber}`,
      });
    }
    for (const item of batch.items) {
      if (item.commissionGl.gt(0)) {
        lines.push({
          accountCode: '21-1102',
          dr: item.commissionGl,
          cr: zero,
          description: `ล้างเจ้าหนี้ค่าคอม ${item.contract.contractNumber}`,
        });
      }
    }
    for (const item of batch.items) {
      const deduction = this.deductionOf(item);
      if (deduction.amount.gt(0)) {
        lines.push({
          accountCode: '11-2107',
          dr: zero,
          cr: deduction.amount,
          description: deduction.financeDescription,
        });
      }
    }
    // Pre-Phase 2 batches have no netTransferAmount snapshot — fall back to
    // the gross total (identical: their totalDeduction is definitionally 0).
    const netCash = batch.netTransferAmount ?? batch.totalAmount;
    if (netCash.gt(0)) {
      lines.push({
        accountCode: batch.financeBankCode,
        dr: zero,
        cr: netCash,
        description,
      });
    }
    return lines;
  }

  /**
   * Dr shopBankCode = shopNetAmount (skip when 0) + Dr S21-1104 per deduction
   * row (ล้างเจ้าหนี้ FINANCE ฝั่ง SHOP — Phase 2 หักกลบ: SWAP_CREDIT ของ
   * settlement items, RECALL rows และ DEVICE_RETURN rows) + Cr S11-3001
   * per-contract (always) + Cr S11-3002 per-contract (skip zero) — settlement
   * legs ONLY over SETTLEMENT items with `legacyNoShop=false`. Empty array = no
   * SHOP half at all (caller skips `postPaired` and posts FINANCE alone via
   * `JournalAutoService`).
   */
  private buildShopLines(batch: BatchWithItems): JeLineInput[] {
    const zero = new Prisma.Decimal(0);
    const shopItems = batch.items.filter((i) => i.itemType === 'SETTLEMENT' && !i.legacyNoShop);
    const deductionItems = batch.items.filter((i) => this.deductionOf(i).amount.gt(0));
    if (shopItems.length === 0 && deductionItems.length === 0) return [];

    const lines: JeLineInput[] = [];
    // Pre-Phase 2 batches have no shopNetAmount snapshot — fall back to the
    // gross posted amount (identical: their totalDeduction is definitionally 0).
    const shopNet = batch.shopNetAmount ?? batch.shopPostedAmount;
    if (shopNet.gt(0)) {
      lines.push({
        accountCode: batch.shopBankCode,
        dr: shopNet,
        cr: zero,
        description: `รับโอนจาก FINANCE รอบ ${batch.batchNumber}`,
      });
    }
    for (const item of deductionItems) {
      const deduction = this.deductionOf(item);
      lines.push({
        accountCode: 'S21-1104',
        dr: deduction.amount,
        cr: zero,
        description: deduction.shopDescription,
      });
    }
    for (const item of shopItems) {
      lines.push({
        accountCode: 'S11-3001',
        dr: zero,
        cr: item.shopFinancedGl,
        description: `ล้างลูกหนี้ FINANCE-ยอดจัด ${item.contract.contractNumber}`,
      });
    }
    for (const item of shopItems) {
      if (item.shopCommissionGl.gt(0)) {
        lines.push({
          accountCode: 'S11-3002',
          dr: zero,
          cr: item.shopCommissionGl,
          description: `ล้างลูกหนี้ FINANCE-ค่าคอม ${item.contract.contractNumber}`,
        });
      }
    }
    return lines;
  }
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement/interco-settlement.service.spec.ts` — Expected: PASS (เทสเดิม + 3 ใหม่)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (23 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. Regression golden เดิม (swap 8,000 + recall 11,000 → บรรทัด/คำอธิบายเดิมทุกไบต์): `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts src/modules/interco-settlement/__tests__/interco-settlement.integration.spec.ts && cd ../..` — Expected: PASS. **Do NOT commit.**

---

### Task 9: รับเงินสดสำรอง — `settleDeductionCash` (generalize `settleRecallCash`) + route `device-returns/:contractId/settle-cash` + `GET pending` คืน `deviceReturns`

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts:32-34` (constant flow ใหม่ + ตาราง kind), `:1340-1577` (แทน `settleRecallCash` ทั้ง method ด้วย `settleDeductionCash` + wrapper)
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.controller.ts:65-75` (`pending()`), หลัง `:245` (route ใหม่)
- Modify: `apps/api/src/modules/interco-settlement/dto/settle-recall-cash.dto.ts:7-14` (doc — DTO ใช้ร่วมสองเส้นทาง; ไม่แก้ field)
- Test (jest): `interco-settlement.controller.spec.ts:39-88` (mocks), `:91-131` (roles matrix), `:133-145` (`pending()`), describe ใหม่ · `interco-settlement.service.spec.ts` (เทส wrapper)
- Test (vitest): `interco-device-return.integration.spec.ts` (describe Task 9 + helper `seedRecallContract`)

**Interfaces:**
- Consumes: `getPendingDeviceReturns` (Task 4), `ShopCollectSettlementTemplate.typeStamp: 'DEVICE_RETURN'` (Task 6)
- Produces: `export type DeductionCashType = 'PAYOUT_RECALL' | 'DEVICE_RETURN'` · `export const DEVICE_RETURN_CASH_SHOP_FLOW = 'interco-device-return-cash-shop'` · `async settleDeductionCash(contractId: string, type: DeductionCashType, dto: SettleRecallCashDto, userId: string): Promise<{ financeEntryNo: string; shopEntryNo: string; deduped: boolean }>` · `settleRecallCash(contractId, dto, userId)` = `settleDeductionCash(contractId, 'PAYOUT_RECALL', dto, userId)` (พฤติกรรม/ข้อความ/flow/บัญชี default **byte-identical**) · route `POST /interco-settlement/device-returns/:contractId/settle-cash` (`@Roles('OWNER','FINANCE_MANAGER')`, body `SettleRecallCashDto`) · `GET /interco-settlement/pending` → `{ pending, recalls, deviceReturns, reconcile }` · AuditLog `INTERCO_DEVICE_RETURN_CASH_SETTLED` (entity `contract`, newValue `{ contractNumber, amount, financeDepositAccountCode, shopPayoutAccountCode, requestId, financeEntryNo, shopEntryNo, deviceReturnNetBefore }`)
- **การตัดสินใจเรื่องบัญชีจ่ายฝั่ง SHOP (spec §6.3 vs โค้ดเดิม):** spec ระบุ default `S11-1202` สำหรับค่าเครื่องคืน ส่วนเส้นทาง recall เดิม default `S11-1201` (`ShopAccountResolver.SHOP_RECEIVING_BANK`). เก็บทั้งสองไว้ตามที่แต่ละเส้นทางระบุ — recall ต้อง byte-identical (เทส netting ปัก `Cr S11-1201`), ค่าเครื่องคืนใช้ `ShopAccountResolver.SHOP_PAYING_BANK` (= `'S11-1202'` ธนาคาร SHOP จ่าย — ตรงกับที่ `ShopCollectShopLegs` เคยใช้ตอนหน้าร้านโอนให้ FINANCE) ผู้ใช้ override ผ่าน `shopPayoutAccountCode` ได้ทั้งคู่
- JE SHOP ของค่าเครื่องคืน: description `จ่ายค่าเครื่องคืนให้ FINANCE — สัญญา ${contractNumber}` · line S21-1104 `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน ${contractNumber}` · line เงินสด `จ่ายค่าเครื่องคืนให้ FINANCE ${amountStr} ฿` · metadata `{ flow: DEVICE_RETURN_CASH_SHOP_FLOW, idempotencyKey: '${contractId}:${requestId}:SHOP', contractId, requestId, amount, shopPayoutAccountCode, shopReceivableType: 'DEVICE_RETURN' }` · reference `${contractId}:${DEVICE_RETURN_CASH_SHOP_FLOW}:${requestId}`
- ข้อความ error ของค่าเครื่องคืน: `สัญญานี้มีรายการค่าเครื่องคืนในรอบจ่าย ${batchNumber} (สถานะ ${status}) — รอผลอนุมัติ ถอน หรือยกเลิกรอบก่อนรับเงินสด` · `สัญญานี้ไม่อยู่ในคิวค่าเครื่องคืน — ไม่มียอดค่าเครื่องคืนค้าง หรืออยู่ในรอบจ่ายอื่นแล้ว` · `ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา ${no} (FINANCE x / SHOP y) — ตรวจสอบ GL ก่อนรับเงินสด` · `ยอดรับเงินสด ${amountStr} ฿ เกินยอดค่าเครื่องคืนคงเหลือ ${net} ฿ ไม่อนุญาต`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

(ก) jest — `interco-settlement.controller.spec.ts`:

เดิม (L51-59):

```ts
      settleRecallCash: jest
        .fn()
        .mockResolvedValue({ financeEntryNo: 'JE-1', shopEntryNo: 'JE-2', deduped: false }),
    };
    pendingService = {
      getPendingContracts: jest.fn().mockResolvedValue([{ contractId: 'c-1' }]),
      getPendingRecalls: jest.fn().mockResolvedValue([{ contractId: 'c-recall' }]),
      getReconcileTotals: jest.fn().mockResolvedValue({ pendingTotal: 0, drift: 0 }),
    };
```

ใหม่:

```ts
      settleRecallCash: jest
        .fn()
        .mockResolvedValue({ financeEntryNo: 'JE-1', shopEntryNo: 'JE-2', deduped: false }),
      settleDeductionCash: jest
        .fn()
        .mockResolvedValue({ financeEntryNo: 'JE-3', shopEntryNo: 'JE-4', deduped: false }),
    };
    pendingService = {
      getPendingContracts: jest.fn().mockResolvedValue([{ contractId: 'c-1' }]),
      getPendingRecalls: jest.fn().mockResolvedValue([{ contractId: 'c-recall' }]),
      getPendingDeviceReturns: jest.fn().mockResolvedValue([{ contractId: 'c-dr' }]),
      getReconcileTotals: jest.fn().mockResolvedValue({ pendingTotal: 0, drift: 0 }),
    };
```

เดิม (L103 ใน roles matrix):

```ts
      ['settleRecallCash', ['OWNER', 'FINANCE_MANAGER']],
```

ใหม่:

```ts
      ['settleRecallCash', ['OWNER', 'FINANCE_MANAGER']],
      ['settleDeviceReturnCash', ['OWNER', 'FINANCE_MANAGER']],
```

เดิม (L126-130):

```ts
    it('checker endpoints (approve/reverse/settleRecallCash) do NOT allow ACCOUNTANT (maker role only)', () => {
      for (const m of ['approve', 'reverse', 'settleRecallCash']) {
        expect(methodRoles(m)).not.toContain('ACCOUNTANT');
      }
    });
```

ใหม่:

```ts
    it('checker endpoints (approve/reverse/settleRecallCash/settleDeviceReturnCash) do NOT allow ACCOUNTANT (maker role only)', () => {
      for (const m of ['approve', 'reverse', 'settleRecallCash', 'settleDeviceReturnCash']) {
        expect(methodRoles(m)).not.toContain('ACCOUNTANT');
      }
    });
```

เดิม (L133-145):

```ts
  describe('pending()', () => {
    it('combines getPendingContracts + getPendingRecalls + getReconcileTotals into { pending, recalls, reconcile }', async () => {
      const result = await controller.pending();
      expect(pendingService.getPendingContracts).toHaveBeenCalledTimes(1);
      expect(pendingService.getPendingRecalls).toHaveBeenCalledTimes(1);
      expect(pendingService.getReconcileTotals).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        pending: [{ contractId: 'c-1' }],
        recalls: [{ contractId: 'c-recall' }],
        reconcile: { pendingTotal: 0, drift: 0 },
      });
    });
  });
```

ใหม่:

```ts
  describe('pending()', () => {
    it('combines getPendingContracts + getPendingRecalls + getPendingDeviceReturns + getReconcileTotals into { pending, recalls, deviceReturns, reconcile }', async () => {
      const result = await controller.pending();
      expect(pendingService.getPendingContracts).toHaveBeenCalledTimes(1);
      expect(pendingService.getPendingRecalls).toHaveBeenCalledTimes(1);
      expect(pendingService.getPendingDeviceReturns).toHaveBeenCalledTimes(1);
      expect(pendingService.getReconcileTotals).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        pending: [{ contractId: 'c-1' }],
        recalls: [{ contractId: 'c-recall' }],
        deviceReturns: [{ contractId: 'c-dr' }],
        reconcile: { pendingTotal: 0, drift: 0 },
      });
    });
  });
```

เพิ่มหลัง `describe('settleRecallCash()')` (หลัง `});` บรรทัด 217):

```ts
  describe('settleDeviceReturnCash()', () => {
    it('passes contractId + type DEVICE_RETURN + dto + userId through to settleDeductionCash', async () => {
      const dto = {
        amount: 7000,
        financeDepositAccountCode: '11-1201',
        requestId: '3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      } as never;
      const result = await controller.settleDeviceReturnCash('c-dr', dto, 'approver-1');
      expect(service.settleDeductionCash).toHaveBeenCalledWith(
        'c-dr',
        'DEVICE_RETURN',
        dto,
        'approver-1',
      );
      expect(result).toEqual({ financeEntryNo: 'JE-3', shopEntryNo: 'JE-4', deduped: false });
      // เส้นทางเดิมยังเรียก wrapper เดิม (ไม่ผ่าน settleDeductionCash ที่ controller)
      expect(service.settleDeductionCash).toHaveBeenCalledTimes(1);
    });
  });
```

`interco-settlement.service.spec.ts` — เพิ่ม describe ท้ายไฟล์ (ก่อน `});` ปิด describe หลัก บรรทัด 741):

```ts
  describe('settleRecallCash (wrapper — ใบรับเครื่องคืน 2026-09-20 generalize เป็น settleDeductionCash)', () => {
    it('delegates ไป settleDeductionCash ด้วย type PAYOUT_RECALL (พฤติกรรมเดิมทุกประการ)', async () => {
      const spy = jest
        .spyOn(service, 'settleDeductionCash')
        .mockResolvedValue({ financeEntryNo: 'JE-1', shopEntryNo: 'JE-2', deduped: false });
      const dto = {
        amount: 3000,
        financeDepositAccountCode: '11-1201',
        requestId: '3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      };
      const result = await service.settleRecallCash('c-recall', dto, 'approver-1');
      expect(spy).toHaveBeenCalledWith('c-recall', 'PAYOUT_RECALL', dto, 'approver-1');
      expect(result).toEqual({ financeEntryNo: 'JE-1', shopEntryNo: 'JE-2', deduped: false });
    });
  });
```

(ข) vitest — เพิ่ม helper ใต้ `seedDeviceReturnPair` ใน integration spec (copy จาก netting spec L286-316 — regression ของ wrapper):

```ts
/** สัญญายกเลิก C-2 (shape ตาม netting spec) — regression ว่า settleRecallCash ยัง byte-identical */
async function seedRecallContract(id: string) {
  await journalAuto.createAndPost({
    description: 'C-2 recall synthetic',
    companyId: financeId,
    metadata: {
      flow: 'test-c2-recall',
      idempotencyKey: `tc2:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('11000'), cr: zero },
      { accountCode: '21-1103', dr: zero, cr: dec('11000') },
    ],
  });
  await journalAuto.createAndPost({
    description: 'C-2 recall SHOP synthetic',
    companyId: shopId,
    metadata: {
      flow: 'test-c2-recall-shop',
      idempotencyKey: `tc2s:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: 'S21-1104', dr: zero, cr: dec('11000') },
      { accountCode: 'S11-1201', dr: dec('11000'), cr: zero },
    ],
  });
}
```

เพิ่ม describe ต่อท้าย describe Task 8:

```ts
  // ===========================================================================
  // Task 9 — settleDeductionCash(DEVICE_RETURN): รับเงินสดสำรอง (spec §6.3)
  // ===========================================================================
  describe('settleDeductionCash — รับเงินสดค่าเครื่องคืน (Task 9)', () => {
    beforeAll(async () => {
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 9 },
      });
    }, 60_000);

    it(
      'settle เต็ม 7,000 → FINANCE ใบ shop-collect-settlement stamp DEVICE_RETURN + SHOP Dr S21-1104 / Cr S11-1202 (default) stamp DEVICE_RETURN; typed = 0; หลุดคิว; audit',
      async () => {
        const x = await seedBaseContract(30, 'CLOSED_BAD_DEBT');
        await seedDeviceReturnPair(x);
        const requestId = randomUUID();

        const result = await settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 7000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        );
        expect(result.deduped).toBe(false);

        const financeJe = await prisma.journalEntry.findFirstOrThrow({
          where: { entryNumber: result.financeEntryNo },
          include: { lines: true },
        });
        expect(sumSide(financeJe.lines, '11-1201', 'dr').toFixed(2)).toBe('7000.00');
        expect(sumSide(financeJe.lines, '11-2107', 'cr').toFixed(2)).toBe('7000.00');
        expect(financeJe.lines).toHaveLength(2);
        expect(financeJe.companyId).toBe(financeId);
        expect(financeJe.description).toContain('ค่าเครื่องคืน');
        const finMeta = financeJe.metadata as Record<string, unknown>;
        expect(finMeta.flow).toBe('shop-collect-settlement');
        expect(finMeta.shopReceivableType).toBe('DEVICE_RETURN');
        expect(finMeta.contractId).toBe(x);

        const shopJe = await prisma.journalEntry.findFirstOrThrow({
          where: { entryNumber: result.shopEntryNo },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S21-1104', 'dr').toFixed(2)).toBe('7000.00');
        expect(sumSide(shopJe.lines, 'S11-1202', 'cr').toFixed(2)).toBe('7000.00'); // default SHOP_PAYING_BANK
        expect(shopJe.lines).toHaveLength(2);
        expect(shopJe.companyId).toBe(shopId);
        const shopMeta = shopJe.metadata as Record<string, unknown>;
        expect(shopMeta.flow).toBe('interco-device-return-cash-shop');
        expect(shopMeta.idempotencyKey).toBe(`${x}:${requestId}:SHOP`);
        expect(shopMeta.shopReceivableType).toBe('DEVICE_RETURN');
        expect(shopMeta.contractId).toBe(x);
        expect(shopJe.lines.find((l) => l.accountCode === 'S21-1104')!.description).toBe(
          `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน DRTEST-${RUN}-30`,
        );

        // typed lens: ใบ settle stamp DEVICE_RETURN + contractId → หักใน typed ตรงๆ → 0 ทั้งสองสมุด
        expect((await deviceReturnFinanceBalance(prisma, x)).toFixed(2)).toBe('0.00');
        expect((await deviceReturnShopBalance(prisma, x)).toFixed(2)).toBe('0.00');
        expect((await pendingService.getPendingDeviceReturns()).some((r) => r.contractId === x)).toBe(false);
        expect((await glContractBalance(prisma, x, '11-2107', 'dr')).toFixed(2)).toBe('0.00');
        expect((await glContractBalance(prisma, x, 'S21-1104', 'cr')).toFixed(2)).toBe('0.00');
        // explicit stamp ชนะ flow fallback 'shop-collect-settlement' — ไม่รั่วเข้าเลนส์ SHOP_COLLECT
        expect((await shopCollectTypedBalance(prisma, x)).toFixed(2)).toBe('0.00');

        const audit = await prisma.auditLog.findFirst({
          where: { action: 'INTERCO_DEVICE_RETURN_CASH_SETTLED', entityId: x },
        });
        expect(audit).toBeTruthy();
        const nv = audit!.newValue as Record<string, unknown>;
        expect(nv.amount).toBe('7000.00');
        expect(nv.deviceReturnNetBefore).toBe('7000.00');
        expect(nv.shopPayoutAccountCode).toBe('S11-1202');
        expect(nv.requestId).toBe(requestId);
      },
      120_000,
    );

    it(
      'settle เกิน net → reject; บางส่วน 3,000 → ผ่าน + คิวเหลือ 4,000 ทั้งสองสมุด; retry requestId เดิม → deduped; ยอดต่าง → 409',
      async () => {
        const x = await seedBaseContract(31, 'CLOSED_BAD_DEBT');
        await seedDeviceReturnPair(x);

        await expect(
          settlementService.settleDeductionCash(
            x,
            'DEVICE_RETURN',
            { amount: 7000.02, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/เกินยอดค่าเครื่องคืนคงเหลือ/);

        const requestId = randomUUID();
        const partial = await settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 3000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        );
        expect(partial.deduped).toBe(false);
        const row = (await pendingService.getPendingDeviceReturns()).find((r) => r.contractId === x)!;
        expect(row.deviceReturnGl.toFixed(2)).toBe('4000.00');
        expect(row.shopDeviceReturnGl.toFixed(2)).toBe('4000.00');

        const again = await settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 3000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        );
        expect(again.deduped).toBe(true);
        expect(again.shopEntryNo).toBe(partial.shopEntryNo);

        await expect(
          settlementService.settleDeductionCash(
            x,
            'DEVICE_RETURN',
            { amount: 1000, financeDepositAccountCode: '11-1201', requestId },
            adminId,
          ),
        ).rejects.toThrow(ConflictException);
      },
      120_000,
    );

    it(
      'มี DEVICE_RETURN item ใน batch เปิด (PENDING/DRAFT) → reject ชี้รอบ; ยกเลิกรอบแล้ว settle ผ่าน (เลือกบัญชี S11-1101 ได้)',
      async () => {
        const y = await seedBaseContract(32);
        await seedNormalContract(y);
        const x = await seedBaseContract(33, 'CLOSED_BAD_DEBT');
        await seedDeviceReturnPair(x);

        const batch = await settlementService.createBatch(
          { contractIds: [y], deviceReturnContractIds: [x], transferDate: '2026-09-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);
        await expect(
          settlementService.settleDeductionCash(
            x,
            'DEVICE_RETURN',
            { amount: 7000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/รายการค่าเครื่องคืนในรอบจ่าย/);

        await settlementService.withdrawBatch(batch.id, adminId); // DRAFT ก็ block
        await expect(
          settlementService.settleDeductionCash(
            x,
            'DEVICE_RETURN',
            { amount: 7000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/รายการค่าเครื่องคืนในรอบจ่าย/);

        await settlementService.cancelBatch(batch.id, adminId);
        const result = await settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          {
            amount: 7000,
            financeDepositAccountCode: '11-1201',
            shopPayoutAccountCode: 'S11-1101',
            requestId: randomUUID(),
          },
          adminId,
        );
        const shopJe = await prisma.journalEntry.findFirstOrThrow({
          where: { entryNumber: result.shopEntryNo },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S11-1101', 'cr').toFixed(2)).toBe('7000.00');
      },
      120_000,
    );

    it('สองสมุดไม่ตรง / ไม่อยู่ในคิว → reject (ห้ามโพสต์ข้างเดียว)', async () => {
      const mismatch = await seedBaseContract(34, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(mismatch, { shopAmount: '6000.00' });
      await expect(
        settlementService.settleDeductionCash(
          mismatch,
          'DEVICE_RETURN',
          { amount: 6000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน/);

      await expect(
        settlementService.settleDeductionCash(
          normalId,
          'DEVICE_RETURN',
          { amount: 100, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/ไม่อยู่ในคิวค่าเครื่องคืน/);
    }, 120_000);

    it(
      'กติกาที่ตัดสิน (same-type NET): swap ที่ถูกหักเครดิต 8,000 แล้วถูกยึด → รับเงินสดค่าเครื่องคืน 7,000 ผ่านทั้ง cap ของคิวและด่าน untyped ของ template',
      async () => {
        const swap = await seedBaseContract(36);
        await seedSwapContract(swap);
        const b1 = await settlementService.createBatch(
          { contractIds: [swap], transferDate: '2026-09-20' },
          adminId,
        );
        createdBatchIds.push(b1.id);
        await settlementService.submitBatch(b1.id, adminId);
        await settlementService.approveBatch(b1.id, adminId);
        await prisma.contract.update({ where: { id: swap }, data: { status: 'CLOSED_BAD_DEBT' } });
        await seedDeviceReturnPair(swap);

        // cap = net จากคิว (same-type) = 7,000; template gate (ii) untyped ระดับสัญญา:
        // 8,000 (A.3) + 7,000 (JP5) − Σ POSTED ทุกประเภท 8,000 = 7,000 → settle 7,000 พอดี
        const result = await settlementService.settleDeductionCash(
          swap,
          'DEVICE_RETURN',
          { amount: 7000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        );
        expect(result.deduped).toBe(false);
        expect((await deviceReturnFinanceBalance(prisma, swap)).toFixed(2)).toBe('0.00');
        expect((await deviceReturnShopBalance(prisma, swap)).toFixed(2)).toBe('0.00');
        expect((await swapCreditFinanceBalance(prisma, swap)).toFixed(2)).toBe('8000.00'); // เลนส์ gross ไม่ขยับ
        expect((await pendingService.getPendingDeviceReturns()).some((r) => r.contractId === swap)).toBe(false);
        // untyped ต่อสัญญาหลัง settle = 15,000 − 7,000 = 8,000 = เครดิตสวอปที่รอบ b1 หักไปแล้ว
        // (ขา Cr ของ batch ไม่ stamp contractId — สถาปัตยกรรมเดิม)
        expect((await glContractBalance(prisma, swap, '11-2107', 'dr')).toFixed(2)).toBe('8000.00');
        // รายงานอายุ (combined): 8,000 + 0 − 8,000 = 0 — ไม่มีหนี้ค้าง ไม่ mismatch
        const agingRow = (await agingService.getShopReceivableAging()).rows.find(
          (r) => r.contractId === swap,
        );
        expect(agingRow).toBeUndefined(); // intercoNet 0 + ไม่ mismatch ⇒ ไม่ใช่ "หนี้ที่ต้องไปตาม"
      },
      180_000,
    );

    it('wrapper settleRecallCash ยัง byte-identical: flow interco-recall-cash-shop, Cr S11-1201 default, audit INTERCO_RECALL_CASH_SETTLED', async () => {
      const r = await seedBaseContract(35);
      await seedRecallContract(r);
      const result = await settlementService.settleRecallCash(
        r,
        { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
        adminId,
      );
      const shopJe = await prisma.journalEntry.findFirstOrThrow({
        where: { entryNumber: result.shopEntryNo },
        include: { lines: true },
      });
      expect((shopJe.metadata as Record<string, unknown>).flow).toBe('interco-recall-cash-shop');
      expect((shopJe.metadata as Record<string, unknown>).shopReceivableType).toBe('PAYOUT_RECALL');
      expect(sumSide(shopJe.lines, 'S11-1201', 'cr').toFixed(2)).toBe('11000.00');
      expect(shopJe.lines.find((l) => l.accountCode === 'S21-1104')!.description).toBe(
        `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก DRTEST-${RUN}-35`,
      );
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'INTERCO_RECALL_CASH_SETTLED', entityId: r },
      });
      expect((audit!.newValue as Record<string, unknown>).recallNetBefore).toBe('11000.00');
      expect((await recallFinanceBalance(prisma, r)).toFixed(2)).toBe('0.00');
    }, 120_000);
  });
```

และแก้ import ของ integration spec: `import { ConflictException } from '@nestjs/common';` (เพิ่มบรรทัดใต้ `import { Decimal } …` — ใช้ใน `rejects.toThrow(ConflictException)` ของเทส idempotency)

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement` — Expected: FAIL — controller: `expect(received).toEqual(expected)` ไม่มี `deviceReturns`, roles ของ `settleDeviceReturnCash` undefined; service: `Cannot spy on the settleDeductionCash property because it is not a function`

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: FAIL — `TypeError: settlementService.settleDeductionCash is not a function`

- [ ] **Step 3: แก้โค้ด**

`interco-settlement.service.ts` — เดิม (L32-34):

```ts
const DEFAULT_FINANCE_BANK_CODE = '11-1201';
/** SHOP leg ของเส้นทางรับเงินสดคืน (Phase 3 Task 6) — Dr S21-1104 / Cr เงินสด SHOP */
const RECALL_CASH_SHOP_FLOW = 'interco-recall-cash-shop';
```

ใหม่:

```ts
const DEFAULT_FINANCE_BANK_CODE = '11-1201';
/** SHOP leg ของเส้นทางรับเงินสดคืน (Phase 3 Task 6) — Dr S21-1104 / Cr เงินสด SHOP */
const RECALL_CASH_SHOP_FLOW = 'interco-recall-cash-shop';
/** SHOP leg ของเส้นทางรับเงินสดค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20 §6.3) — Dr S21-1104 / Cr เงินสด SHOP */
export const DEVICE_RETURN_CASH_SHOP_FLOW = 'interco-device-return-cash-shop';

/** ประเภทลูกหนี้ 11-2107 ที่รับเงินสดล้างได้นอกรอบจ่าย (SHOP_COLLECT ล้างผ่านใบรับโอน ไม่ใช่ที่นี่) */
export type DeductionCashType = 'PAYOUT_RECALL' | 'DEVICE_RETURN';

/**
 * ค่าคงที่ต่อประเภทของ `settleDeductionCash` — ข้อความ/flow/บัญชี default ของ PAYOUT_RECALL
 * ต้อง **byte-identical** กับ `settleRecallCash` เดิม (interco-netting.integration.spec.ts ปัก
 * `Cr S11-1201` + ข้อความเดิมทุกตัว). DEVICE_RETURN ตาม spec 2026-09-20 §6.3 (default บัญชีจ่าย
 * ฝั่ง SHOP = S11-1202 ธนาคาร SHOP จ่าย — `ShopAccountResolver.SHOP_PAYING_BANK`).
 */
interface DeductionCashKind {
  itemType: InterCoItemType;
  shopFlow: string;
  defaultShopPayoutAccountCode: string;
  auditAction: string;
  netBeforeKey: string;
  openItemMessage: (batchNumber: string, status: string) => string;
  notInQueueMessage: string;
  mismatchMessage: (contractNumber: string, fin: string, shop: string) => string;
  exceedMessage: (amountStr: string, net: string) => string;
  shopDescription: (contractNumber: string) => string;
  shopPayableLine: (contractNumber: string) => string;
  shopCashLine: (amountStr: string) => string;
}

const DEDUCTION_CASH_KINDS: Record<DeductionCashType, DeductionCashKind> = {
  PAYOUT_RECALL: {
    itemType: 'RECALL',
    shopFlow: RECALL_CASH_SHOP_FLOW,
    defaultShopPayoutAccountCode: ShopAccountResolver.SHOP_RECEIVING_BANK,
    auditAction: 'INTERCO_RECALL_CASH_SETTLED',
    netBeforeKey: 'recallNetBefore',
    openItemMessage: (batchNumber, status) =>
      `สัญญานี้มีรายการเรียกคืนในรอบจ่าย ${batchNumber} ` +
      `(สถานะ ${status}) — รอผลอนุมัติ ถอน หรือยกเลิกรอบก่อนรับเงินสดคืน`,
    notInQueueMessage:
      'สัญญานี้ไม่อยู่ในคิวเรียกคืน — ไม่มียอดเรียกคืนค้าง หรืออยู่ในรอบจ่ายอื่นแล้ว',
    mismatchMessage: (no, fin, shop) =>
      `ยอดเรียกคืนสองสมุดไม่ตรงกัน สัญญา ${no} (FINANCE ${fin} / SHOP ${shop}) — ตรวจสอบ GL ก่อนรับเงินคืน`,
    exceedMessage: (amountStr, net) =>
      `ยอดรับเงินคืน ${amountStr} ฿ เกินยอดเรียกคืนคงเหลือ ${net} ฿ ไม่อนุญาต`,
    shopDescription: (no) => `จ่ายเงินคืน FINANCE — เรียกคืนจากยกเลิกสัญญา ${no}`,
    shopPayableLine: (no) => `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${no}`,
    shopCashLine: (amountStr) => `จ่ายเงินคืน FINANCE ${amountStr} ฿`,
  },
  DEVICE_RETURN: {
    itemType: 'DEVICE_RETURN',
    shopFlow: DEVICE_RETURN_CASH_SHOP_FLOW,
    defaultShopPayoutAccountCode: ShopAccountResolver.SHOP_PAYING_BANK,
    auditAction: 'INTERCO_DEVICE_RETURN_CASH_SETTLED',
    netBeforeKey: 'deviceReturnNetBefore',
    openItemMessage: (batchNumber, status) =>
      `สัญญานี้มีรายการค่าเครื่องคืนในรอบจ่าย ${batchNumber} ` +
      `(สถานะ ${status}) — รอผลอนุมัติ ถอน หรือยกเลิกรอบก่อนรับเงินสด`,
    notInQueueMessage:
      'สัญญานี้ไม่อยู่ในคิวค่าเครื่องคืน — ไม่มียอดค่าเครื่องคืนค้าง หรืออยู่ในรอบจ่ายอื่นแล้ว',
    mismatchMessage: (no, fin, shop) =>
      `ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา ${no} (FINANCE ${fin} / SHOP ${shop}) — ตรวจสอบ GL ก่อนรับเงินสด`,
    exceedMessage: (amountStr, net) =>
      `ยอดรับเงินสด ${amountStr} ฿ เกินยอดค่าเครื่องคืนคงเหลือ ${net} ฿ ไม่อนุญาต`,
    shopDescription: (no) => `จ่ายค่าเครื่องคืนให้ FINANCE — สัญญา ${no}`,
    shopPayableLine: (no) => `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน ${no}`,
    shopCashLine: (amountStr) => `จ่ายค่าเครื่องคืนให้ FINANCE ${amountStr} ฿`,
  },
};
```

แทนที่ทั้ง method `settleRecallCash` (jsdoc L1340-1368 + body L1369-1577) ด้วย:

```ts
  /**
   * เส้นทางรับเงินสดคืนจากยกเลิกสัญญา (Flow C-2 — Phase 3 Task 6): wrapper ของ
   * `settleDeductionCash(…, 'PAYOUT_RECALL')` — พฤติกรรม/ข้อความ/flow/บัญชี default
   * byte-identical กับก่อน 2026-09-20 (ดู DEDUCTION_CASH_KINDS.PAYOUT_RECALL).
   */
  async settleRecallCash(
    contractId: string,
    dto: SettleRecallCashDto,
    userId: string,
  ): Promise<{ financeEntryNo: string; shopEntryNo: string; deduped: boolean }> {
    return this.settleDeductionCash(contractId, 'PAYOUT_RECALL', dto, userId);
  }

  /**
   * รับเงินสดล้างลูกหนี้-หน้าร้านประเภทหัก (spec 2026-08-19 §5.4 ทางเลือกที่สองของ recall +
   * ใบรับเครื่องคืน 2026-09-20 §6.3): SHOP โอนเงินสดให้ FINANCE แทนการรอหักในรอบจ่ายถัดไป.
   * โพสต์สองใบใน `$transaction` เดียว:
   *
   *   FINANCE — reuse `ShopCollectSettlementTemplate` + `typeStamp: type` →
   *   `Dr <financeDepositAccountCode> / Cr 11-2107` (stamp `shopReceivableType: type` +
   *   `metadata.contractId` ⇒ typed lens ของประเภทนั้นหักตรงต่อสัญญา — ต่างจากขา batch
   *   ที่ไม่ stamp; template gate เดิม (untyped − Σ POSTED deductions + block PENDING
   *   deduction batch) เดินครบ; ด่าน §6.4 ของ template ยกเว้นให้เมื่อ type = DEVICE_RETURN)
   *
   *   SHOP — `Dr S21-1104 / Cr <shopPayoutAccountCode>` (default ตามประเภท: recall =
   *   S11-1201, ค่าเครื่องคืน = S11-1202) ผ่าน `journalAuto.createAndPost` ตรงๆ
   *
   * Guards (ตามลำดับ — ชุดเดียวกันทั้งสองประเภท):
   *   0. idempotency requestId — เช็คก่อน guard คิวทั้งหมด: retry หลัง settle เต็มจำนวน
   *      สัญญาหลุดคิวไปแล้ว ต้องคืนผลเดิมไม่ใช่ reject
   *   1. ไม่มี item ประเภทนี้ (RECALL / DEVICE_RETURN) ใน batch เปิด (DRAFT/PENDING_APPROVAL)
   *      — settled gate ของคิวจับ PENDING อยู่แล้ว แต่ต้องได้ข้อความไทยชี้รอบ + block DRAFT
   *      ด้วย (กันเงินก้อนเดียวถูกรับสดที่นี่และหักในรอบพร้อมกัน)
   *   2. สัญญาอยู่ในคิวของประเภทนั้น — `getPendingRecalls` (ยอด NET หัก deduction ทุกประเภท)
   *      / `getPendingDeviceReturns` (ยอด NET หักเฉพาะ deviceReturnAmount — spec §6.3
   *      ฉบับตัดสิน); cap ข้อ 4 ใช้ยอดจากคิวตรง ๆ **ห้ามคำนวณซ้ำที่นี่** — ด่าน untyped (ii)
   *      ของ template ยังเป็นระดับสัญญา (15,000 − 8,000 = 7,000 สำหรับ swap ที่ถูกยึด) จึง
   *      สอดคล้องกันโดยโครงสร้าง
   *   3. ยอดสองสมุดตรงกัน ±0.01 (mirror guard ของ `buildSnapshot` — ห้ามโพสต์ข้างเดียว)
   *   4. amount ≤ net + 0.01
   */
  async settleDeductionCash(
    contractId: string,
    type: DeductionCashType,
    dto: SettleRecallCashDto,
    userId: string,
  ): Promise<{ financeEntryNo: string; shopEntryNo: string; deduped: boolean }> {
    const kind = DEDUCTION_CASH_KINDS[type];
    const amount = new Prisma.Decimal(String(dto.amount));
    if (amount.lte(0)) {
      throw new BadRequestException('ยอดรับเงินคืนต้องมากกว่า 0');
    }
    const amountStr = amount.toFixed(2);
    const shopPayoutAccountCode = dto.shopPayoutAccountCode ?? kind.defaultShopPayoutAccountCode;

    // SERIALIZABLE — doctrine ของ template ตัวเดียวกัน (ดู comment ใน
    // shop-collect-settlement.template.ts รอบ catch P2002/P2034): guard
    // "amount ≤ net" อ่าน journal_lines แล้วค่อย insert แถวที่เปลี่ยนผล
    // การอ่านนั้น — ภายใต้ READ COMMITTED สองคำขอพร้อมกัน**คนละ requestId**
    // บนสัญญาเดียวจะผ่าน guard ทั้งคู่ (idempotency จับไม่ได้ — key ต่างกัน)
    // ⇒ over-settle (typed ติดลบ, เงินสดเดบิตเกิน). SSI ทำให้ผู้แพ้
    // ถูก abort ด้วย 40001 (Prisma P2034) — แปลเป็น 409 ใน catch ด้านล่าง.
    const run = async (tx: Prisma.TransactionClient) => {
      // 0. idempotency — SHOP leg เป็น marker: สองใบโพสต์ใน tx เดียว ดังนั้น
      //    "มีใบ SHOP" ⇔ "มีใบ FINANCE" เสมอ. contractId เป็นส่วนหนึ่งของ
      //    เงื่อนไข (กัน requestId ชนข้ามสัญญา — pattern เดียวกับ template).
      const shopDupe = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: kind.shopFlow } } as Prisma.JournalEntryWhereInput,
            { metadata: { path: ['requestId'], equals: dto.requestId } } as Prisma.JournalEntryWhereInput,
            { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
          ],
          deletedAt: null,
        },
      });
      if (shopDupe) {
        const dupeMeta = shopDupe.metadata as Record<string, unknown> | null;
        const bookedAmount = dupeMeta?.['amount'];
        if (typeof bookedAmount !== 'string' || bookedAmount !== amountStr) {
          throw new ConflictException(
            `คำขอนี้ถูกบันทึกไปแล้วที่ยอด ${typeof bookedAmount === 'string' ? bookedAmount : 'ไม่ทราบยอด'} ฿ — ` +
              'กรุณาปิดหน้าต่างรับเงินคืนแล้วเปิดใหม่ หากต้องการบันทึกยอดใหม่',
          );
        }
        const financeDupe = await tx.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as Prisma.JournalEntryWhereInput,
              { metadata: { path: ['requestId'], equals: dto.requestId } } as Prisma.JournalEntryWhereInput,
              { metadata: { path: ['contractId'], equals: contractId } } as Prisma.JournalEntryWhereInput,
            ],
            deletedAt: null,
          },
        });
        return {
          financeEntryNo: financeDupe?.entryNumber ?? '',
          shopEntryNo: shopDupe.entryNumber,
          deduped: true,
        };
      }

      // 1. item ประเภทนี้ใน batch เปิด → reject พร้อมชื่อรอบ
      const openItem = await tx.interCoSettlementItem.findFirst({
        where: {
          contractId,
          itemType: kind.itemType,
          deletedAt: null,
          batch: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, deletedAt: null },
        },
        include: { batch: { select: { batchNumber: true, status: true } } },
      });
      if (openItem) {
        throw new BadRequestException(
          kind.openItemMessage(openItem.batch.batchNumber, openItem.batch.status),
        );
      }

      // 2. อยู่ในคิวของประเภทนั้น (ยอด net) + 3. สองสมุดตรงกัน + 4. ไม่เกิน net
      const candidate = await this.findDeductionCandidate(tx, type, contractId);
      if (!candidate) {
        throw new BadRequestException(kind.notInQueueMessage);
      }
      if (candidate.net.minus(candidate.shopNet).abs().gt('0.01')) {
        throw new BadRequestException(
          kind.mismatchMessage(
            candidate.contractNumber,
            candidate.net.toFixed(2),
            candidate.shopNet.toFixed(2),
          ),
        );
      }
      if (amount.gt(candidate.net.plus('0.01'))) {
        throw new BadRequestException(kind.exceedMessage(amountStr, candidate.net.toFixed(2)));
      }

      // FINANCE leg — template เดิม + typeStamp (guards/idempotency ของ
      // template เดินครบทุกด่าน รวม gate (ii) untyped − POSTED deductions)
      const finance = await this.shopCollectTemplate.execute(
        {
          contractId,
          depositAccountCode: dto.financeDepositAccountCode,
          amount: dto.amount,
          postedById: userId,
          requestId: dto.requestId,
          typeStamp: type,
        },
        tx,
      );
      if (finance.deduped) {
        // SHOP pre-check (ด่าน 0) ไม่พบใบ แต่ template พบ requestId เดิม —
        // แปลว่า requestId นี้ถูกใช้ไปแล้วกับ flow settleShopCollect (คนละ
        // เส้นทาง): โพสต์ SHOP leg เดี่ยวต่อไปจะได้ใบขาเดียว — ห้าม.
        throw new ConflictException(
          'requestId นี้ถูกใช้ไปแล้วกับรายการรับโอนจากหน้าร้าน (shop-collect) — กรุณาสร้างคำขอใหม่',
        );
      }

      // SHOP leg — Dr S21-1104 / Cr เงินสด/ธนาคาร SHOP
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      let shopJe: { id: string; entryNumber: string };
      try {
        shopJe = await this.journalAuto.createAndPost(
          {
            description: kind.shopDescription(candidate.contractNumber),
            reference: `${contractId}:${kind.shopFlow}:${dto.requestId}`,
            companyId: shopCompanyId,
            metadata: {
              flow: kind.shopFlow,
              // สมมาตรกับ FINANCE leg (template: `${contractId}:${requestId}`) —
              // requestId reuse ข้ามสัญญาจะไม่ชน DB unique index ของสัญญาอื่น
              // (โพสต์อิสระตาม semantics ของ template) แทนที่จะได้ 409 ผิดบริบท.
              idempotencyKey: `${contractId}:${dto.requestId}:SHOP`,
              contractId,
              requestId: dto.requestId,
              amount: amountStr,
              shopPayoutAccountCode,
              shopReceivableType: type,
            },
            lines: [
              {
                accountCode: 'S21-1104',
                dr: amount,
                cr: new Prisma.Decimal(0),
                description: kind.shopPayableLine(candidate.contractNumber),
              },
              {
                accountCode: shopPayoutAccountCode,
                dr: new Prisma.Decimal(0),
                cr: amount,
                description: kind.shopCashLine(amountStr),
              },
            ],
          },
          tx,
        );
      } catch (err) {
        // Race เดียวกับ W2: ผู้แพ้ของ double-submit ชน DB unique index
        // (flow + idempotencyKey) — แปลงเป็น 409 ไทย ไม่ใช่ raw 500;
        // tx ทั้งก้อน (รวมใบ FINANCE) roll back.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(
            'รายการนี้กำลังถูกบันทึกอยู่ (กดยืนยันซ้ำพร้อมกัน) — กรุณารอสักครู่ แล้วตรวจสอบรายการก่อนลองใหม่',
          );
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: kind.auditAction,
          entity: 'contract',
          entityId: contractId,
          newValue: {
            contractNumber: candidate.contractNumber,
            amount: amountStr,
            financeDepositAccountCode: dto.financeDepositAccountCode,
            shopPayoutAccountCode,
            requestId: dto.requestId,
            financeEntryNo: finance.entryNo,
            shopEntryNo: shopJe.entryNumber,
            [kind.netBeforeKey]: candidate.net.toFixed(2),
          },
        },
      });

      return { financeEntryNo: finance.entryNo, shopEntryNo: shopJe.entryNumber, deduped: false };
    };

    try {
      return await this.prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      // ผู้แพ้ SSI race (40001 → Prisma P2034) โผล่ได้ทั้งกลาง tx และตอน
      // commit — แปลเป็น 409 ไทยให้ client ลองใหม่ได้ ไม่ใช่ raw 500
      // (pattern เดียวกับ template's P2034 catch + W2). ConflictException/
      // BadRequestException จากใน tx ผ่าน catch นี้ออกไปตามเดิม.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        throw new ConflictException(
          'มีการบันทึกรายการนี้พร้อมกันจากอีกจุดหนึ่ง (write conflict) — กรุณาลองใหม่อีกครั้ง',
        );
      }
      throw err;
    }
  }

  /**
   * แถวคิวของประเภทนั้นสำหรับสัญญาเดียว (ยอด NET ทั้งสองสมุด) — อ่านผ่านคิวจริง
   * (`getPendingRecalls` / `getPendingDeviceReturns`) ไม่คำนวณเอง ⇒ settle-cash กับรอบจ่าย
   * ใช้ยอดก้อนเดียวกันเสมอ.
   */
  private async findDeductionCandidate(
    tx: Prisma.TransactionClient,
    type: DeductionCashType,
    contractId: string,
  ): Promise<{ contractNumber: string; net: Prisma.Decimal; shopNet: Prisma.Decimal } | undefined> {
    if (type === 'PAYOUT_RECALL') {
      const r = (await this.pendingService.getPendingRecalls(tx)).find(
        (x) => x.contractId === contractId,
      );
      return r ? { contractNumber: r.contractNumber, net: r.recallGl, shopNet: r.shopRecallGl } : undefined;
    }
    const d = (await this.pendingService.getPendingDeviceReturns(tx)).find(
      (x) => x.contractId === contractId,
    );
    return d
      ? { contractNumber: d.contractNumber, net: d.deviceReturnGl, shopNet: d.shopDeviceReturnGl }
      : undefined;
  }
```

`interco-settlement.controller.ts` — เดิม (L65-75):

```ts
  /** คิวรอจ่าย + คิวหักเรียกคืน (C-2) + reconcile totals ระดับบัญชี (spec §4/§8 แท็บ "รอจ่าย"). */
  @Get('pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async pending() {
    const [pending, recalls, reconcile] = await Promise.all([
      this.pendingService.getPendingContracts(),
      this.pendingService.getPendingRecalls(),
      this.pendingService.getReconcileTotals(),
    ]);
    return { pending, recalls, reconcile };
  }
```

ใหม่:

```ts
  /**
   * คิวรอจ่าย + คิวหักเรียกคืน (C-2) + คิวค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20 §6.3) +
   * reconcile totals ระดับบัญชี (spec §4/§8 แท็บ "รอจ่าย").
   */
  @Get('pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async pending() {
    const [pending, recalls, deviceReturns, reconcile] = await Promise.all([
      this.pendingService.getPendingContracts(),
      this.pendingService.getPendingRecalls(),
      this.pendingService.getPendingDeviceReturns(),
      this.pendingService.getReconcileTotals(),
    ]);
    return { pending, recalls, deviceReturns, reconcile };
  }
```

เพิ่มหลัง method `settleRecallCash` (หลัง `}` บรรทัด 245, ก่อน jsdoc ของ `uploadSlip`):

```ts

  /**
   * รับเงินสดค่าเครื่องคืนจากหน้าร้าน (ใบรับเครื่องคืน 2026-09-20 §6.3): ล้างค่าเครื่องคืน
   * (11-2107 DEVICE_RETURN ↔ S21-1104) ด้วยเงินสดแทนการหักในรอบจ่าย — JE สองสมุดทันที
   * (ไม่มี batch/maker-checker ชั้นเอกสาร) จึง gate ด้วย role ระดับ checker เหมือน
   * approve/reverse/settleRecallCash. DTO ชุดเดียวกับ recall.
   */
  @Post('device-returns/:contractId/settle-cash')
  @Roles('OWNER', 'FINANCE_MANAGER')
  settleDeviceReturnCash(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body() dto: SettleRecallCashDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.settleDeductionCash(contractId, 'DEVICE_RETURN', dto, userId);
  }
```

`dto/settle-recall-cash.dto.ts` — เดิม (L7-14):

```ts
/**
 * เส้นทางรับเงินสดคืนจากยกเลิกสัญญา (Flow C-2 — Phase 3 Task 6, spec §5.4
 * ทางเลือกที่สองนอกจากหักกลบรอบจ่าย):
 * `POST /interco-settlement/recalls/:contractId/settle-cash`.
 *
 * FINANCE: `Dr <financeDepositAccountCode> / Cr 11-2107` (stamp PAYOUT_RECALL)
 * SHOP:    `Dr S21-1104 / Cr <shopPayoutAccountCode>` — สองใบใน tx เดียว.
 */
```

ใหม่:

```ts
/**
 * เส้นทางรับเงินสดล้างลูกหนี้-หน้าร้านประเภทหัก — ใช้ร่วมสองเส้นทาง:
 *   - `POST /interco-settlement/recalls/:contractId/settle-cash` (Flow C-2 — Phase 3 Task 6,
 *     spec §5.4 ทางเลือกที่สองนอกจากหักกลบรอบจ่าย; stamp PAYOUT_RECALL; default บัญชีจ่าย SHOP S11-1201)
 *   - `POST /interco-settlement/device-returns/:contractId/settle-cash` (ใบรับเครื่องคืน 2026-09-20
 *     §6.3; stamp DEVICE_RETURN; default บัญชีจ่าย SHOP S11-1202)
 *
 * FINANCE: `Dr <financeDepositAccountCode> / Cr 11-2107` (stamp ตามประเภท)
 * SHOP:    `Dr S21-1104 / Cr <shopPayoutAccountCode>` — สองใบใน tx เดียว.
 */
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/interco-settlement` — Expected: PASS (controller + service + pending + crons)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts && cd ../..` — Expected: PASS (29 tests)

- [ ] **Step 5: Checkpoint** — Run `./tools/check-types.sh api` — Expected: 0 errors. Regression ของ wrapper บน suite เดิม (รวม race test สองคอนเนกชัน): `cd apps/api && npx vitest run --no-file-parallelism src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts && cd ../..` — Expected: PASS. **Do NOT commit.**

---

### Task 10: byte-parity ของ `settledPayoutByContract` (โมดูล contracts) + regression ทั้งชุด + CI

**Files:**
- Modify: `apps/api/src/modules/contracts/services/contract-cancellation.service.ts:41-42` (doc field), `:52-56` (jsdoc), `:86-88` (Σ deduction)
- Modify (fixtures): `apps/api/src/modules/contracts/contracts.service.spec.ts:1571-1573` และ `:1708-1710` (item mock ต้องมี `deviceReturnAmount` — ไม่งั้น `undefined.toString()` โยน TypeError)
- Create (jest): `apps/api/src/modules/contracts/services/contract-cancellation.settled-payout.spec.ts`

**Interfaces:**
- Consumes: `deviceReturnAmount` (Task 1)
- Produces: `SettledPayout.settledDeductions = Σ(swapCreditAmount + recallAmount + deviceReturnAmount)` ของ item SETTLEMENT ใน batch POSTED — **ตัวเลขไม่เปลี่ยน** (แถว SETTLEMENT มี `deviceReturnAmount = 0` โดยนิยาม snapshot) แต่ jsdoc ของ helper สัญญาว่า "ตรงกับ `totalDeduction` ของ batch แบบไบต์ต่อไบต์" ⇒ ต้องเติมให้สูตรตรงกันจริง ไม่งั้นสำเนาสูตรที่สองเกิดขึ้นเงียบ ๆ (ห้ามมีสำเนา — doctrine ของโมดูล)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน** — สร้าง `apps/api/src/modules/contracts/services/contract-cancellation.settled-payout.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { settledPayoutByContract } from './contract-cancellation.service';

/**
 * `settledPayoutByContract` = แหล่งเดียวของ C-2 detect (approveCancellation / listPendingCancellations /
 * exchange-cancel). `settledDeductions` ต้องเป็นสูตรเดียวกับ `totalDeduction` ของ batch —
 * ตั้งแต่ใบรับเครื่องคืน 2026-09-20 รวม `deviceReturnAmount` (แถว SETTLEMENT = 0 เสมอ จึงเป็น
 * no-op เชิงตัวเลข แต่กัน "สำเนาสูตรที่สอง").
 */
describe('settledPayoutByContract — Σ deduction รวม deviceReturnAmount (byte-parity กับ totalDeduction)', () => {
  const D = (v: number) => new Prisma.Decimal(v);

  it('รวม swapCredit + recall + deviceReturn และเลือกเฉพาะ item SETTLEMENT ใน batch POSTED', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        contractId: 'c-1',
        financedGl: D(10000),
        commissionGl: D(1000),
        shopFinancedGl: D(10000),
        shopCommissionGl: D(1000),
        swapCreditAmount: D(2000),
        recallAmount: D(0),
        deviceReturnAmount: D(500),
        batch: { batchNumber: 'IC-20260920-0001' },
      },
    ]);
    const client = { interCoSettlementItem: { findMany } } as unknown as Prisma.TransactionClient;

    const map = await settledPayoutByContract(client, ['c-1']);
    const entry = map.get('c-1')!;
    expect(entry.settledTotal.toString()).toBe('11000');
    expect(entry.settledShopTotal.toString()).toBe('11000');
    expect(entry.settledDeductions.toString()).toBe('2500');
    expect(entry.batchNumbers).toEqual(['IC-20260920-0001']);

    const where = findMany.mock.calls[0][0].where;
    expect(where.itemType).toBe('SETTLEMENT');
    expect(where.batch).toEqual({ status: 'POSTED', deletedAt: null });
  });

  it('รายการว่าง → Map ว่างโดยไม่ query', async () => {
    const findMany = jest.fn();
    const client = { interCoSettlementItem: { findMany } } as unknown as Prisma.TransactionClient;
    expect((await settledPayoutByContract(client, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
```

และแก้ fixture ใน `contracts.service.spec.ts` — เดิม (L1571-1573 และ L1708-1710 — สองจุดข้อความเดียวกันต่าง indent):

```ts
          swapCreditAmount: new Prisma.Decimal('2000.00'),
          recallAmount: new Prisma.Decimal(0),
          batch: { batchNumber: 'IC-20260820-0009' },
```

ใหม่ (ทั้งสองจุด — คง indent เดิมของแต่ละจุด):

```ts
          swapCreditAmount: new Prisma.Decimal('2000.00'),
          recallAmount: new Prisma.Decimal(0),
          deviceReturnAmount: new Prisma.Decimal(0),
          batch: { batchNumber: 'IC-20260820-0009' },
```

- [ ] **Step 2: รันเทสให้เห็นว่าล้ม**

Run: `npm --prefix apps/api test -- src/modules/contracts/services/contract-cancellation.settled-payout.spec.ts`
Expected: FAIL — `Expected: "2500" Received: "2000"`

- [ ] **Step 3: แก้ `contract-cancellation.service.ts`**

เดิม (L41-42):

```ts
  /** Σ swapCreditAmount + recallAmount — ส่วนที่ถูกหักกลบในรอบ (เงินไม่เคยโอนจริง) */
  settledDeductions: Decimal;
```

ใหม่:

```ts
  /** Σ swapCreditAmount + recallAmount + deviceReturnAmount — ส่วนที่ถูกหักกลบในรอบ (เงินไม่เคยโอนจริง) */
  settledDeductions: Decimal;
```

เดิม (L52-56):

```ts
 * `settledDeductions` = Σ(swapCreditAmount + recallAmount) ของ item ชุดเดียวกัน
 * — เงินส่วนที่ถูกหักกลบในรอบ ไม่เคยโอนจริง ⇒ ยอดเรียกคืนสุทธิที่ C-2 จะเหลือ
 * ให้ตามเก็บ = settledTotal − settledDeductions (นิยามเดียวกับ net ของ
 * `IntercoPendingService.getPendingRecalls`). แถว SETTLEMENT มี recallAmount = 0
 * โดยนิยาม — รวมไว้เพื่อให้สูตรตรงกับ totalDeduction ของ batch แบบไบต์ต่อไบต์.
```

ใหม่:

```ts
 * `settledDeductions` = Σ(swapCreditAmount + recallAmount + deviceReturnAmount) ของ item
 * ชุดเดียวกัน — เงินส่วนที่ถูกหักกลบในรอบ ไม่เคยโอนจริง ⇒ ยอดเรียกคืนสุทธิที่ C-2 จะเหลือ
 * ให้ตามเก็บ = settledTotal − settledDeductions (นิยามเดียวกับ net ของ
 * `IntercoPendingService.getPendingRecalls`). แถว SETTLEMENT มี recallAmount และ
 * deviceReturnAmount = 0 โดยนิยาม — รวมไว้เพื่อให้สูตรตรงกับ totalDeduction ของ batch
 * แบบไบต์ต่อไบต์ (ใบรับเครื่องคืน 2026-09-20 เพิ่มคอลัมน์ที่สาม).
```

เดิม (L86-88):

```ts
    entry.settledDeductions = entry.settledDeductions
      .plus(item.swapCreditAmount.toString())
      .plus(item.recallAmount.toString());
```

ใหม่:

```ts
    entry.settledDeductions = entry.settledDeductions
      .plus(item.swapCreditAmount.toString())
      .plus(item.recallAmount.toString())
      .plus(item.deviceReturnAmount.toString());
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/contracts/services/contract-cancellation.settled-payout.spec.ts src/modules/contracts/contracts.service.spec.ts` — Expected: PASS

- [ ] **Step 5: Checkpoint สุดท้ายของ Phase 1 — regression ทั้งชุด** (ทุกคำสั่งจาก root ของ worktree)

```bash
./tools/check-types.sh all
```

Expected: `API: OK` + `Web: OK` (web ไม่ถูกแตะ — `GET pending` แค่เพิ่ม key `deviceReturns` ซึ่ง type ฝั่ง web ยังไม่อ่าน; Phase 3 เติม)

```bash
npm --prefix apps/api test -- src/modules/interco-settlement src/modules/journal/shop-receivable-type.util.spec.ts src/modules/contracts/contracts.service.spec.ts src/modules/contracts/services/contract-cancellation.settled-payout.spec.ts
```

Expected: PASS ทุก suite (interco 6 suites + util + contracts 2)

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts && cd ../..
```

Expected: PASS (template specs — vitest)

```bash
cd apps/api && npx vitest run --no-file-parallelism \
  src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts \
  src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts \
  src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts \
  src/modules/interco-settlement/__tests__/interco-settlement.integration.spec.ts \
  src/modules/contracts/shop-collect-settlement.integration.spec.ts \
  src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts \
  src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts \
  && cd ../..
```

Expected: PASS ทุกไฟล์ (DB-backed — ใช้เวลาหลายนาที; ถ้าไฟล์ใดแดงเฉพาะ `P2028`/timeout ให้รันไฟล์นั้นซ้ำเดี่ยว ๆ ก่อนสรุปว่า regression). **Do NOT commit** — รายงานผลให้เจ้าของ (คำสั่ง 2026-09-05) แล้วส่งต่อ Phase 2

---

## สรุปเทสเดิมที่แตะ (ตามคำขอ: grep origin/main `recallAmount|settleRecallCash|swapCreditAmount` ใน spec files)

| ไฟล์ (origin/main) | แตะเพราะ | แก้ที่ Task |
|---|---|---|
| `journal/shop-receivable-type.util.spec.ts` | ประเภทใหม่ + ค่าคงที่ | 2 (เพิ่ม 2 เทส) |
| `interco-settlement/interco-pending.service.spec.ts` | IN-list เป็น bind param (เพิ่มเทส anti-drift), `getReconcileTotals` ยิง query เพิ่ม 1 ตัว (call count 6→7, index ขยับ), describe ใหม่ของคิวค่าเครื่องคืน | 3, 4 |
| `interco-settlement/__tests__/shop-receivable-aging.cron.spec.ts` L31-54 `makeRow` | `ShopReceivableAgingRow` ได้ 2 field บังคับ → literal ไม่ compile | 5 |
| `interco-settlement/__tests__/interco-reconcile.cron.spec.ts` L44-67 `makeRow` | เดียวกัน | 5 |
| `interco-settlement/interco-settlement.service.spec.ts` | mock `getPendingDeviceReturns`; submit fixtures ต้องมี `itemType` (ITEM_ROLE ตัดสินจาก type จริง); approve fixture ต้องมี `deviceReturnAmount` (`sumDeductions([item])`); เทสใหม่ snapshot/clash/approve/wrapper | 7, 8, 9 |
| `interco-settlement/interco-settlement.controller.spec.ts` | `pending()` คืน key เพิ่ม (`toEqual` แดง), roles matrix + mock ของ route ใหม่ | 9 |
| `contracts/contracts.service.spec.ts` L1571-1573, L1708-1710 | item mock ขาด `deviceReturnAmount` → TypeError หลัง Task 10 | 10 |
| `interco-settlement/__tests__/interco-netting.integration.spec.ts` · `interco-aging.integration.spec.ts` · `interco-settlement.integration.spec.ts` · `contracts/__tests__/contract-cancellation.integration.spec.ts` · `contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` | **ไม่ต้องแก้** — สร้าง item ผ่าน Prisma (default 0) หรือผ่าน service จริง; assertion เป็นราย field/บรรทัด ไม่มี `toEqual` ทั้งแถว; รันเป็น regression ใน Task 10 | — |
| `apps/web/src/pages/__tests__/IntercompanySettlementPage.test.tsx` · `ContractCancellationPage.test.tsx` | **ไม่ต้องแก้ใน Phase 1** — web ไม่ถูกแตะ (`deviceReturns` เป็น key เพิ่มที่ web ยังไม่อ่าน; Phase 3 เติม `types.ts`/`PendingTab`) | — |

## CI (`.github/workflows/deploy-gcp.yml` — origin/main L259-291)

- **ไม่ต้องแก้ workflow ใน Phase 1**: ไฟล์ integration ใหม่ `src/modules/interco-settlement/__tests__/interco-device-return.integration.spec.ts` ถูกครอบโดย glob เดิม `INTERCO_FILES=$(ls src/modules/interco-settlement/__tests__/*.integration.spec.ts)` (L267) และ template spec ใหม่ `src/modules/journal/cpa-templates/shop-collect-settlement.template.spec.ts` ถูกครอบโดย `FILES=$(ls src/modules/journal/cpa-templates/*.spec.ts | grep -v contract-cancellation.template.spec.ts)` (L263) — step นี้รันด้วย `--no-file-parallelism` อยู่แล้ว (integration specs แชร์ DB)
- jest specs ใหม่/ที่แก้ (`*.spec.ts` นอก `cpa-templates/`, ไม่ใช่ `*.integration.spec.ts`) รันใน step "Test API" ตาม `testRegex` เดิม — `contract-cancellation.settled-payout.spec.ts` อยู่ใต้ `src/modules/contracts/services/` และ `interco-typed-balance.spec.ts` อยู่ใต้ `src/modules/interco-settlement/` ซึ่ง jest ครอบทั้งคู่
- Phase 2 จะเพิ่ม directory ใหม่ `src/modules/device-returns/__tests__/` ⇒ **ต้องเพิ่ม glob ใหม่ตอนนั้น** (บทเรียน jp5-vat-split: glob ไม่ recurse)

## ส่งต่อ Phase 2 (สิ่งที่ Phase 2 พึ่งพาจากแผนนี้ — ห้ามเปลี่ยนชื่อ)

- Prisma: `InterCoItemType.DEVICE_RETURN`, `InterCoSettlementItem.deviceReturnAmount`
- `SHOP_RECEIVABLE_TYPES` / `ShopReceivableType` มี `'DEVICE_RETURN'`; `classifyShopReceivable` explicit-only
- `deviceReturnFinanceBalance` / `deviceReturnShopBalance` (ใช้ใน `findAll.deviceReturnOutstanding` ของ repossessions — **ต้องใช้สูตร same-type ตัวเดียวกับ `getPendingDeviceReturns`**: `deviceReturnFinanceBalance − Σ deviceReturnAmount ของ item ใน batch POSTED ของสัญญา` (ไม่ใช่ทุกประเภท — ดู "กติกาที่ตัดสินแล้ว" หัวแผน; สูตรใน brief Phase 2 ที่เขียนว่า "Σ POSTED deductions" ต้องอ่านเป็นคอลัมน์ `deviceReturnAmount` เท่านั้น)
- `IntercoPendingService.getPendingDeviceReturns`, `ReconcileTotals.glDeviceReturnTotal`
- **helper Σ deduction สำหรับ Phase 2 (`RepossessionsService.findAll.deviceReturnOutstanding`)** — import จาก `'../interco-settlement/interco-typed-balance'`: `postedDeductionsByContract(client, contractIds, DEVICE_RETURN_DEDUCTION_COLUMNS)` (export ระดับ module รับ `Client` union — ใช้ได้ทั้งใน tx และ root prisma) ⇒ `deviceReturnOutstanding = deviceReturnFinanceBalance(client, id).minus(map.get(id) ?? 0)` (2dp) — คำนวณทีเดียวทั้งหน้าด้วย `contractIds` ทั้งชุด ไม่ใช่ทีละสัญญาในลูป; ห้าม inline สูตร/คอลัมน์ซ้ำ
- `IntercoSettlementService.settleDeductionCash(contractId, 'DEVICE_RETURN', dto, userId)` + route `POST /interco-settlement/device-returns/:contractId/settle-cash` + `GET /interco-settlement/pending` → `deviceReturns`
- `ShopCollectSettlementTemplate` ด่าน §6.4: JP5 ที่ Phase 2 stamp `shopReceivableType: 'DEVICE_RETURN'` + `shopReceivable: '11-2107'` จะถูกเลนส์ทุกตัวจัดเป็น DEVICE_RETURN (ไม่ใช่ SHOP_COLLECT) และใบรับโอนจากหน้าร้าน (`POST /contracts/:id/shop-collect-settlement`) จะปฏิเสธสัญญานั้น — เป็นพฤติกรรมที่ต้องการตาม spec
- JE metadata shape ที่ producer จริงต้องยิงให้ตรง fixture `seedDeviceReturnPair` ของแผนนี้: FINANCE `{ contractId, shopReceivableType: 'DEVICE_RETURN', shopReceivable: '11-2107', … }`, SHOP `{ flow: 'shop-repossession-intake', idempotencyKey: 'shop-repossession-intake:<contractId>', contractId, productId, shopReceivableType: 'DEVICE_RETURN' }` (+ `deviceReturnId` ตาม brief Phase 2)
