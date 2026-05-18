# Phase 3 SP7 — Multi-Entity Legal Split (10 Sub-Project Prompts)

**Status:** 📝 **PROMPTS READY** — owner to dispatch SP-by-SP
**Branch convention:** `feat/p3-sp7-<n>-<short-slug>` (one branch per SP)
**Workflow per SP:** Write → `/review` (deep, 3-4 rounds) → fix Criticals → `/debug` → green test → ship → commit → merge → next SP
**Sequential execution:** SP7.1 → SP7.10 ห้าม parallel (each SP depends on previous schema/service)
**Source artifacts:**
- `.claude/rules/accounting.md` § "Out of scope for P3-SP5 (deferred to P3-SP7)"
- `.claude/CLAUDE.md` § "Multi-Entity Structure"
- `apps/api/src/modules/journal/paired-journal.service.ts`
- `apps/api/src/modules/journal/cpa-templates/shop-*.ts` (7 SHOP templates)

---

## 1. Why SP7 exists

BESTCHOICE ปัจจุบันรันเป็น **1 นิติบุคคล แต่ 2 ส่วนธุรกิจ** (SHOP ไม่ VAT, FINANCE VAT 7%). P3-SP5 ได้แยก chart of accounts (S-prefix สำหรับ SHOP) + ออก paired JE service + SHOP-side TB+P&L แล้ว แต่ยังเหลือ 5 ก้อนใหญ่:

1. Multi-entity legal split — JE มี `from_company_id`/`to_company_id` เป็น FK จริง (วันนี้ใช้ string `fromEntity`/`toEntity` + companyId เดี่ยว)
2. SHOP-side VAT reports — เผื่อ SHOP จด VAT ในอนาคต
3. SHOP-side payroll/SSO — วันนี้ FINANCE จ่ายให้หมด
4. Historical migration — สัญญาก่อน P3-SP5 ยังไม่มี SHOP-side JE
5. SHOP balance sheet — มีแค่ TB+P&L

SP7 จะเก็บทั้ง 5 ก้อน + วาง infrastructure ให้ Phase D (แยก DB จริง) เดินต่อได้ทันที

---

## 2. Decomposition Overview

| SP | Title | Scope | LOC est. | Test est. | Risk |
|---|---|---|---|---|---|
| **SP7.1** | Schema Foundation — true 2-company FK | Add `LegalEntity` model + migrate JE.companyId/IC FKs to point at legal entity (not CompanyInfo branding row) | ~600 | 25 | 🔴 High (schema-touching) |
| **SP7.2** | Inter-Company AR/AP Foundation | Inter-co subsidiary ledger + aging buckets + reconciliation report | ~800 | 30 | 🟡 Medium |
| **SP7.3** | PairedJournalService Migration | Re-route ContractActivation1A + ShopInventoryTransfer + ShopFinanceReceipt to PairedJournalService | ~500 | 35 | 🔴 High (touches activation flow) |
| **SP7.4** | SHOP Repossession Reversal Template | Build `ShopRepossessionReversalTemplate` + pair w/ `RepossessionJP5Template` | ~400 | 18 | 🟢 Low |
| **SP7.5** | SHOP Balance Sheet + Equity | `getBalanceSheetFromJournal(scope='SHOP')` + page `/shop/balance-sheet` | ~500 | 20 | 🟢 Low |
| **SP7.6** | Historical SHOP Migration | Backfill script: emit retroactive SHOP-side JEs for pre-SP5 contracts (idempotent + dry-run) | ~700 | 25 | 🔴 High (touches prod data) |
| **SP7.7** | SHOP VAT Toggle (Future-Proof) | `LegalEntity.isVatRegistered` flag + conditional VAT in shop templates + doc-prefix per entity | ~400 | 15 | 🟡 Medium |
| **SP7.8** | SHOP Payroll + SSO Split | `PayrollLine.legalEntityId` + per-entity SSO report + allocation UI | ~600 | 20 | 🟡 Medium |
| **SP7.9** | Inter-Company Settlement Workflow | Monthly settlement run: aggregate IC AR/AP → settlement doc → paired JE | ~700 | 25 | 🟡 Medium |
| **SP7.10** | DB Partition Prep + Docs | Document split, add `LEGAL_ENTITY_PRIMARY` env, prepare for separate-DB extraction, update CLAUDE.md/accounting.md | ~200 | 0 | 🟢 Low |

**Total estimate:** ~5,400 LOC / 213 tests / 10 PRs / 6-10 working days

---

## 3. Hard Rules (apply to every SP)

1. **อย่าทำลายข้อมูลเก่า** — ทุก migration เป็น additive ครั้งแรก, backfill, แล้วค่อย flip-required (2-step migration per `.claude/rules/database.md`)
2. **Soft delete only** — never hard-delete legal entities or IC transactions
3. **Decimal everywhere** — money เป็น `Prisma.Decimal` ไม่มี `Number()`
4. **Idempotency** — ทุก paired JE มี `metadata.flow + metadata.idempotencyKey` + DB partial unique index (เหมือน `journal_entries_idempotency_idx` ที่ทำใน P3-SP5 DEEP W8)
5. **CompanyResolverService เป็น single source** — ห้าม cache `companyId` per-instance ใน template (P3-SP5 DEEP W3 lesson)
6. **Per-SP DEEP review** — `/review` ต้องครอบคลุม security + race conditions + decimal precision + idempotency + scope leakage (Like P3-SP5 DEEP C1-C7, W1-W8)
7. **0 TS errors / 0 lint errors** — ก่อน commit ทุก SP
8. **AuditLog** — ทุก action ที่กระทบ legal entity ต้องเขียน audit log (entity=lowercase, userId=real FK)

---

## 4. Per-SP Prompts (copy-paste into fresh session)

> วิธีใช้: เปิด Claude Code session ใหม่ → paste prompt SP ที่ต้องการ → ทำงานจนเสร็จ → ใน prompt มี `/review` + `/debug` ในท้ายเสมอ → fix → ship → commit → merge → ไปต่อ SP ถัดไป

---

### 🟦 SP7.1 — Schema Foundation: True 2-Company FK

```
Project: BESTCHOICE Phase 3 SP7.1 — Schema Foundation
Branch: feat/p3-sp7-1-legal-entity-schema

## Context
อ่าน .claude/CLAUDE.md + .claude/rules/database.md + .claude/rules/accounting.md ก่อน
ดู apps/api/prisma/schema.prisma model CompanyInfo (line ~3034) + InterCompanyTransaction (line ~4067)
ดู docs/superpowers/specs/2026-05-18-phase-3-sp7-multi-entity-split-prompts.md § SP7.1

ปัญหาวันนี้:
- `CompanyInfo` ปนสองหน้าที่: (1) branding (logo, address, director สำหรับ contract PDF) + (2) legal entity (companyCode='SHOP'/'FINANCE')
- JournalEntry.companyId อ้าง CompanyInfo — ถ้า owner แก้ branding ของ FINANCE จะกระทบ JE FK
- InterCompanyTransaction.fromEntity/toEntity ยังเป็น string + fromCompanyId/toCompanyId อ้าง CompanyInfo
- Phase D (แยก DB) ต้องมี LegalEntity เป็น top-level partition key

## Goal
แยก `LegalEntity` (กฎหมาย) ออกจาก `CompanyInfo` (branding) — additive ไม่ลบของเก่า

## Tasks
1. เพิ่ม `LegalEntity` model:
   - id, code (unique: 'SHOP'|'FINANCE'|'GROUP'), nameTh, nameEn?, taxId (unique), taxBranchCode (default '00000'), isVatRegistered (boolean), vatRate Decimal?(5,4)?
   - createdAt/updatedAt/deletedAt
   - @@map("legal_entities")
2. เพิ่ม `CompanyInfo.legalEntityId String?` (nullable ระยะ A), FK → LegalEntity, @@index
3. เพิ่ม `JournalEntry.legalEntityId String?` (nullable ระยะ A), FK → LegalEntity, @@index — co-exist กับ companyId เดิม
4. เพิ่ม `InterCompanyTransaction.fromLegalEntityId String?` + `toLegalEntityId String?` (nullable), FK
5. Migration: `20260950000000_add_legal_entity` (idempotent, IF NOT EXISTS)
6. Seed `LegalEntity` 2 rows (SHOP, FINANCE) ใน apps/api/prisma/seed.ts + seed-production.ts (idempotent upsert)
7. Backfill script `apps/api/src/cli/backfill-legal-entity.cli.ts`:
   - Resolve `CompanyInfo.companyCode` → LegalEntity.code → set legalEntityId
   - Resolve JournalEntry.companyId → CompanyInfo.companyCode → LegalEntity → set JournalEntry.legalEntityId
   - Resolve InterCompanyTransaction.fromCompanyId/toCompanyId → LegalEntity → set fromLegalEntityId/toLegalEntityId
   - Dry-run mode `DRY_RUN=true` (default), commit mode `DRY_RUN=false`
   - Progress log every 1000 rows
8. Add `LegalEntityResolverService` (mirror CompanyResolverService pattern) — `resolveByCode('SHOP'|'FINANCE'): Promise<{ id, code, ... }>` with in-process cache invalidated on test seed cycles
9. ตรวจ TS เพื่อ 0 errors

## Constraints
- ห้ามแก้ companyId/fromCompanyId/toCompanyId เดิม (additive only — flip required เป็น SP7.10)
- ห้าม drop CompanyInfo.companyCode (SP5 ยังใช้)
- ทุก service ที่ทำ JE ใหม่ต้อง resolve และเซ็ต legalEntityId เพิ่ม (ไม่ต้องลบ companyId)
- Migration ต้องผ่าน wipe-accounting CLI guards (P3-SP5 DEEP C7) — ห้ามใส่ NOT NULL บน table ที่มีข้อมูล

## Tests
- LegalEntityResolverService: resolve SHOP, resolve FINANCE, resolve unknown → throw NotFoundException
- Backfill CLI: dry-run no writes; commit mode populates legalEntityId on all rows; idempotent (รัน 2 ครั้งไม่ duplicate)
- Migration up/down (CI runs both)
- Seed idempotency: รัน seed 2 ครั้ง = 2 rows (ไม่ใช่ 4)

## Acceptance
- [ ] Migration ทำได้บน DB ที่มีข้อมูล (dev backup) โดยไม่ error
- [ ] รัน backfill dry-run → log "would update N rows" ทุก table
- [ ] รัน backfill commit → ทุก row มี legalEntityId
- [ ] 25+ new tests pass
- [ ] 0 TS errors

## After implementation
1. /review (deep, 3-4 rounds) — ใช้ code-reviewer agent + custom prompt:
   "ตรวจ schema migration ว่า idempotent, NOT NULL safe (additive), foreign keys cascade correctly, indexes adequate. ตรวจ backfill ว่า atomic per row, idempotent, race-safe (lock when needed). ตรวจ resolver service ว่า cache invalidates per test seed (ดู P3-SP5 DEEP W3 lesson). หา race conditions, missing indexes, scope leakage."
   Fix ทุก Critical + Warning ก่อนข้าม
2. /debug — ตรวจ edge cases:
   - Backfill บน DB ว่างเปล่า (no CompanyInfo) — graceful skip
   - Backfill บน DB ที่ companyCode = null (CompanyInfo.companyCode optional) — skip with warning
   - Multiple LegalEntity ที่ taxId ซ้ำ — DB unique constraint catches
   - Resolver cache stale หลัง LegalEntity update — invalidation strategy
   - Concurrent backfill runs — advisory lock per table
3. Commit + push: feat/p3-sp7-1-legal-entity-schema
4. ห้าม merge ถ้า DEEP review ยังพบ Critical
```

---

### 🟦 SP7.2 — Inter-Company AR/AP Foundation

```
Project: BESTCHOICE Phase 3 SP7.2 — Inter-Company AR/AP Subsidiary Ledger
Branch: feat/p3-sp7-2-ic-arap-foundation

## Context
อ่าน .claude/rules/accounting.md § "Inter-Company Settlement" + SP7.1 spec (above) — SP7.1 ต้อง merge ก่อน
SHOP side: S11-3001 (FINANCE owes ยอดจัด), S11-3002 (FINANCE owes commission), S11-3003 (FINANCE ตีคืน)
FINANCE side: 21-1101 (เจ้าหนี้-หน้าร้าน ยอดจัด), 21-1102 (เจ้าหนี้ค่าคอม-หน้าร้าน)
วันนี้ aging report ไม่มี — ต้อง query JournalLine โดยตรง = ช้า + ไม่ trace ได้ว่า invoice ไหนยังไม่จ่าย

## Goal
สร้าง subsidiary ledger สำหรับ Inter-co AR/AP — แต่ละ contract activation/settlement = 1 row ที่ trace ได้

## Tasks
1. เพิ่ม model `InterCompanyLedger`:
   - id, fromLegalEntityId, toLegalEntityId, accountCode (S11-3001/S11-3002/S11-3003/21-1101/21-1102)
   - referenceType (CONTRACT_ACTIVATION|FINANCE_RECEIPT|REPOSSESSION|MANUAL_SETTLEMENT)
   - referenceId (contractId หรือ aggregated batch id)
   - amount Decimal(12,2)
   - direction (RECEIVABLE|PAYABLE)
   - status (OPEN|PARTIAL|SETTLED|VOIDED)
   - openedAt, dueAt?, settledAt?
   - openingJournalEntryId, settlementJournalEntryId?
   - createdAt/updatedAt/deletedAt + @@index(legalEntityId, accountCode, status)
2. แก้ `ShopInventoryTransferTemplate` + `ShopFinanceReceiptTemplate` ให้สร้าง InterCompanyLedger row ใน $transaction เดียวกับ JE
3. service: `InterCompanyLedgerService`:
   - `createOpening({ fromLegalEntityId, toLegalEntityId, ... })`
   - `settle(ledgerId, paymentJournalEntryId)` — flip status to SETTLED + set settledAt
   - `getAging(legalEntityId, asOfDate, scope='RECEIVABLE'|'PAYABLE'='RECEIVABLE')` — buckets: 0-30, 31-60, 61-90, 90+
   - `getOutstanding(legalEntityId, accountCode?)` — sum of OPEN/PARTIAL
4. endpoint `GET /inter-company/ledger` (OWNER, FM, ACC) — paginate, filter by status/account/date
5. endpoint `GET /inter-company/aging` (OWNER, FM, ACC) — aging buckets
6. endpoint `POST /inter-company/ledger/:id/settle` (OWNER, FM) — manual settle (audit log IC_LEDGER_SETTLED)
7. Frontend page `/inter-company/ledger` — table + aging banner + settle button
8. Backfill: รัน CLI สร้าง ledger entries จาก JournalLine ที่มีอยู่แล้ว (เฉพาะ accountCode IC ตามรายการ)

## Constraints
- ยอด ledger ต้อง = ยอดใน JournalLine (reconciliation check ทุกครั้งที่ ledger settle)
- Settle ledger = ต้องมี settlement JournalEntry FK (ป้องกัน orphan settle)
- ห้าม settle ที่ amount mismatch (throw if delta > 0.01)
- Audit log: IC_LEDGER_OPENED, IC_LEDGER_SETTLED, IC_LEDGER_VOIDED

## Tests
- Create ledger on contract activation — assert row exists with status=OPEN
- Settle ledger — assert status=SETTLED, settledAt set, FK populated
- Aging buckets — assert correct date math (use FakeTimers)
- Reconciliation check: ledger total === sum(JournalLine) per account+entity
- Voided ledger excluded from aging
- Endpoint permissions: SALES gets 403

## Acceptance
- [ ] 30+ new tests pass
- [ ] Backfill: รันบน dev DB → จำนวน ledger rows = จำนวน activation JE × 2 (1 for S11-3001, 1 for S11-3002)
- [ ] Aging report renders ใน UI พร้อม buckets
- [ ] 0 TS errors

## After implementation
1. /review (deep) — code-reviewer ตรวจ:
   "ตรวจ ledger service: reconciliation logic, idempotency (รัน settle 2 ครั้งไม่ flip กลับ), race condition (concurrent settle ด้วย same JE id), decimal precision (Prisma.Decimal ตลอด), scope leakage (BM 403, SALES 403). ตรวจ aging math กับ FakeTimers ว่า edge dates ถูก bucket"
2. /debug — edge cases:
   - Partial payment (settle ครึ่งหนึ่ง) — status=PARTIAL + remainder calculation
   - Settle หลัง void → ConflictException
   - Backfill บน prod-size data (10k JEs) — pagination + memory check
   - Aging on weekend/holiday — date math handles correctly
   - Ledger amount = 0 (corner case) — auto-SETTLE หรือ throw?
3. Commit + push: feat/p3-sp7-2-ic-arap-foundation
```

---

### 🟦 SP7.3 — PairedJournalService Migration

```
Project: BESTCHOICE Phase 3 SP7.3 — Migrate Activation+Receipt to PairedJournalService
Branch: feat/p3-sp7-3-paired-activation

## Context
อ่าน apps/api/src/modules/journal/paired-journal.service.ts + .claude/rules/accounting.md § "PairedJournalService"
วันนี้ ContractActivation1ATemplate post FINANCE side, ShopInventoryTransferTemplate post SHOP side — แยกกัน 2 transactions = ถ้า SHOP fail FINANCE จะติด orphan
P3-SP5 ทำไว้สำหรับ inventory transfer แล้ว แต่ตอน activation ยังแยกอยู่

## Goal
รวม activation flow เป็น 1 $transaction ผ่าน PairedJournalService — atomic SHOP+FINANCE post

## Tasks
1. สร้าง `ContractActivationPairedTemplate` ที่:
   - รับ contract input
   - คำนวณ SHOP JE (ใช้ logic จาก ShopInventoryTransferTemplate)
   - คำนวณ FINANCE JE (ใช้ logic จาก ContractActivation1ATemplate)
   - return `{ shop: { lines, description }, finance: { lines, description } }`
2. แก้ ContractService.activate ให้เรียก `pairedJournal.postPaired({ shop, finance, batchRef: contractId })` แทนการเรียก 2 templates แยก
3. ฝัง InterCompanyLedger create (จาก SP7.2) เข้า paired flow
4. PaymentReceipt: สร้าง `ShopFinanceReceiptPairedTemplate` ที่ pair กับ FINANCE-side receipt (Dr cash / Cr 21-1101 + Cr 21-1102) → post atomic
5. แก้ FinanceReceiptService ให้ใช้ paired template + auto-settle InterCompanyLedger rows ที่เกี่ยวข้อง
6. Backward compat: เก็บ ContractActivation1ATemplate + ShopInventoryTransferTemplate ไว้ deprecated (warn log) แต่ยังเรียกได้สำหรับ replay เก่า — ลบใน SP7.10

## Constraints
- ทุก paired post ต้องผ่าน LegalEntityResolverService (SP7.1) — ห้าม hardcode 'SHOP'/'FINANCE'
- batchId เดียวกันทั้ง SHOP + FINANCE JE (metadata.batchId)
- Invariant: `financedAmount + downAmount === salePrice` ตรวจ assert ใน template + throw if fail
- Throughput: paired post ต้องไม่ช้ากว่า 2× single post (target < 200ms)
- ห้ามแตะ existing posted JEs — เฉพาะ new activations หลัง deploy ใช้ paired

## Tests
- Paired activation: 1 contract activate → 2 JE rows, same batchId, both POSTED, both balanced
- Rollback: ถ้า SHOP side calc throws → ทั้ง 2 ไม่ post (verify count = 0 หลัง failure)
- IC ledger: หลัง activate → 2 ledger rows (S11-3001, S11-3002) status=OPEN
- IC ledger: หลัง finance receipt → 2 ledger rows status=SETTLED
- Idempotency: activate ซ้ำ contract เดิม → ConflictException (metadata.idempotencyKey unique catches it)
- Concurrent activate same contract: only 1 succeeds (DB unique constraint)
- Backward compat: old shop-inventory-transfer.template.spec.ts ยัง pass

## Acceptance
- [ ] 35+ new tests pass (รวม regression ของเดิม)
- [ ] Existing 577+ API tests ยัง green
- [ ] Manual E2E: สร้าง contract → activate → check 2 JEs + 2 ledger rows
- [ ] 0 TS errors

## After implementation
1. /review (deep) — code-reviewer:
   "ตรวจ atomic transaction guarantees: ถ้า 1 line fail ทั้ง 2 ฝั่ง rollback. ตรวจ metadata.batchId ต้องอยู่ทั้ง SHOP+FINANCE JE. ตรวจ idempotency key ครอบคลุม contract + activation + version (กันกรณี re-activate หลัง void). ตรวจ Decimal arithmetic ไม่มี Number(). ตรวจ throughput (Promise.all คาด 1 transaction). ตรวจ rollback ของ InterCompanyLedger ด้วย (อยู่ใน $transaction เดียวกัน)"
2. /debug — edge cases:
   - Contract activate ขณะ DB connection drop กลางทาง — rollback ทั้งหมด, no partial
   - Re-activate หลัง void → throw or allow? (Decision: allow but with new idempotencyKey suffix `-v2`)
   - คำนวณ commission % มี rounding edge (0.0049 → 0?) — ใช้ ROUND_DOWN (per accounting.md)
   - Cross-period activation (contract created Dec 31 23:59, activated Jan 1 00:01) — JE entryDate?
   - Concurrent finance receipt + manual ledger settle — last-write-wins or CAS?
3. Commit + push: feat/p3-sp7-3-paired-activation
```

---

### 🟦 SP7.4 — SHOP Repossession Reversal Template

```
Project: BESTCHOICE Phase 3 SP7.4 — SHOP Repossession Reversal
Branch: feat/p3-sp7-4-shop-repo-reversal

## Context
อ่าน .claude/rules/accounting.md § "JE Templates" § RepossessionJP5Template (FINANCE-only)
SHOP-side reversal เมื่อยึดเครื่องคืน: inventory กลับ S11-3003 หรือ S11-2002 (ขึ้นกับสภาพ) + clear ค้าง IC receivable
วันนี้ไม่มี — repossession.service.ts post แค่ FINANCE JE = SHOP TB ไม่บาลานซ์ตอน repossession

## Goal
สร้าง ShopRepossessionReversalTemplate + paired กับ RepossessionJP5 → 1 atomic transaction

## Tasks
1. สร้าง `ShopRepossessionReversalTemplate` ที่:
   - Input: contractId, repossessedInventoryAccountCode (S11-2002 sellable used | S11-3003 FINANCE ตีคืน), recoveryAmount, outstandingBalance
   - JE:
     ```
     Dr S11-2002 หรือ S11-3003 (inventory back)  [recoveryAmount]
     Dr S51-1102 (loss on repo)                   [shortfall = outstandingBalance - recoveryAmount, if positive]
        Cr S11-3001 (clear remaining receivable)   [outstandingBalance]
     ```
   - Validate: dr === cr ±0.01
2. แก้ RepossessionsService.execute() เรียก `pairedJournal.postPaired({ shop, finance, batchRef: repossessionId })` ใช้ ShopRepossessionReversalTemplate + RepossessionJP5Template
3. เพิ่ม IC ledger settle: settle row S11-3001 ที่ยังเปิดของ contractId นี้ (auto)
4. UI: หน้า /repossessions detail แสดง JE preview ก่อน execute (เห็นทั้ง 2 ฝั่ง)
5. ถ้า contractId ไม่มี SHOP-side activation JE (legacy pre-SP5) → throw BadRequest "ต้องรัน SP7.6 backfill ก่อน"

## Constraints
- Inventory account code ต้อง validate ว่าเป็น S11-2002 หรือ S11-3003 (regex)
- recoveryAmount ห้าม > original costPrice (sanity check)
- ห้ามเปลี่ยน RepossessionJP5Template — แค่ห่อด้วย paired
- Audit log: REPOSSESSION_PAIRED_POSTED

## Tests
- Happy path: full recovery — JE balance, ledger settle
- Shortfall: recovery < outstanding — S51-1102 = shortfall
- Surplus: recovery > outstanding — invalid, throw
- Idempotency: re-execute repossession → ConflictException
- IC ledger: หลัง execute → S11-3001 row status=SETTLED
- Legacy contract (no SHOP activation JE) → BadRequest "รัน backfill ก่อน"

## Acceptance
- [ ] 18+ new tests pass
- [ ] Manual: trigger repossession → see 2 JEs in journal ledger UI
- [ ] 0 TS errors

## After implementation
1. /review (deep):
   "ตรวจ balance invariant (Dr === Cr ±0.01) บน wave 1+wave 2 รวมกัน. ตรวจ shortfall math edge case (recovery = 0, recovery = outstanding exactly, recovery = outstanding - 0.01). ตรวจ inventory account whitelist regex. ตรวจ legacy contract guard ว่าตรง — ห้ามให้ post SHOP JE ทับ activation ที่ไม่มี"
2. /debug:
   - Repossession ของ contract ที่ activate ก่อน SP5 → behaviour ที่ดี? (Decision: guard + redirect to backfill)
   - Repossession ของ contract ที่ activate หลัง SP5 แต่ก่อน SP7.3 (mixed flow) — paired works?
   - 0 recovery (เครื่องพัง) → log full loss?
   - Concurrent repossession เดียวกัน — DB unique constraint catches
3. Commit + push: feat/p3-sp7-4-shop-repo-reversal
```

---

### 🟦 SP7.5 — SHOP Balance Sheet + Equity

```
Project: BESTCHOICE Phase 3 SP7.5 — SHOP Balance Sheet
Branch: feat/p3-sp7-5-shop-balance-sheet

## Context
อ่าน apps/api/src/modules/accounting/accounting.service.ts → getBalanceSheetFromJournal
วันนี้รองรับ FINANCE only. SHOP มีแค่ TB+P&L (P3-SP5)
อ่าน .claude/rules/accounting.md § "SHOP Accounting (Phase 3 SP5)" — chart prefix S

## Goal
ขยาย getBalanceSheetFromJournal ให้รองรับ scope='SHOP'|'FINANCE'|'ALL' + สร้างหน้า /shop/balance-sheet

## Tasks
1. แก้ `getBalanceSheetFromJournal(asOfDate?, scope='SHOP'|'FINANCE'|'ALL')`:
   - SHOP: Assets (S11+S12), Liabilities (S21+S22), Equity (S31+S32+S33)
   - Contra assets (ถ้ามี เช่น S11-2102 ในอนาคต) sum เป็นลบ
   - คำนวณ Retained Earnings จาก JE 33-1101 (จาก year-end closing) + current-year P&L (ถ้ายังไม่ปิด)
2. Endpoint: `GET /expenses/ledger/shop/balance-sheet` (OWNER, FM, ACC)
3. UI: ขยาย `ShopAccountingPage.tsx` เพิ่ม tab "งบดุล (BS)"
4. ใช้ `BalanceSheetTable` component เดิม (จาก FINANCE BS) — เพิ่ม prop `scope`
5. Reconciliation check: SHOP Assets === Liabilities + Equity (±1 THB tolerance)
6. ถ้า unbalanced → แสดง warning banner + Sentry alarm

## Constraints
- ใช้ `codePrefix(code)` เดิม (จัดการ S prefix ได้แล้ว ตาม P3-SP5 DEEP)
- ห้ามแตะ FINANCE BS (regression test ต้อง pass)
- BRANCH_MANAGER ไม่เห็น (W5 policy — เหมือน TB/P&L)
- เมื่อ scope='ALL' → return per-scope breakdown + check ทั้ง 2 ฝั่ง balance อิสระ

## Tests
- SHOP-only BS: assets, liab, equity balance
- After year-end closing: RE มียอด เพิ่ม
- Before year-end closing: implicit RE จาก P&L
- scope='ALL': perScope.{shop,finance} แสดง 2 ฝั่ง + isAllBalanced=true
- Roles: SALES 403, BM 403, OWNER/FM/ACC 200
- Snapshot test: เปรียบเทียบ TB total assets === BS total assets

## Acceptance
- [ ] 20+ new tests pass
- [ ] Manual: เปิดหน้า /shop/accounting → tab BS แสดงข้อมูลถูก
- [ ] FINANCE BS regression ทั้งหมด green
- [ ] 0 TS errors

## After implementation
1. /review (deep):
   "ตรวจ Decimal precision ใน sum operations (ใช้ Decimal.add, ห้าม Number()). ตรวจ contra asset sign handling. ตรวจ RE calculation: ต้องไม่ double-count (current year P&L + 33-1101 หลัง closing). ตรวจ scope filter ใน Prisma query (ป้องกัน SHOP rows leak เข้า FINANCE BS via wrong companyId). ตรวจ tolerance ±1 THB — ห้ามเป็น 0 (round error)."
2. /debug:
   - Date boundary: asOfDate = 2026-12-31 23:59:59.999 — included or excluded?
   - SHOP มี Equity = 0 ตอน start — handle gracefully
   - Year-end closing run ของ FINANCE only (SHOP ยังไม่ปิด) — SHOP BS ใช้ implicit RE
   - Reconciliation check fail in prod → Sentry alarm + UI warning (ไม่ crash)
3. Commit + push: feat/p3-sp7-5-shop-balance-sheet
```

---

### 🟦 SP7.6 — Historical SHOP Migration

```
Project: BESTCHOICE Phase 3 SP7.6 — Historical SHOP Backfill
Branch: feat/p3-sp7-6-historical-shop-backfill

## Context
อ่าน .claude/rules/accounting.md § "Out of scope for P3-SP5" — Historical migration deferred
SHOP JE templates มีตั้งแต่ P3-SP5 merge (2026-05-XX) เท่านั้น. Contract ที่ activate ก่อนหน้านั้นไม่มี SHOP JE = SHOP TB ก่อน cutoff ว่างเปล่า
ต้อง backfill retroactively แต่ idempotent + dry-run + rollback-safe

## Goal
รัน script สร้าง SHOP-side JEs (activation + finance receipt) ย้อนหลังสำหรับ contracts ก่อน cutoff

## Tasks
1. สร้าง CLI `apps/api/src/cli/backfill-shop-historical.cli.ts`:
   - Args: `--cutoff-date=2026-05-01` `--dry-run` (default true) `--batch-size=100` `--from-contract-id=`
   - Query: Contract WHERE activatedAt < cutoff AND deletedAt IS NULL AND NOT EXISTS (JE.metadata.flow = 'shop-inventory-transfer' AND metadata.contractId = contract.id)
   - For each contract:
     - Resolve SHOP LegalEntity
     - Replay ShopInventoryTransferTemplate ด้วย entryDate = contract.activatedAt (NOT today)
     - Replay ShopFinanceReceiptTemplate ด้วย entryDate = InterCompanyTransaction.reconciledAt (ถ้ามี)
     - Stamp metadata.idempotencyKey = `shop-historical-backfill-${contractId}` (unique)
     - Skip if duplicate detected
   - Output: report `{ total, posted, skipped, errors }` to stdout + write CSV `backfill-report-YYYYMMDD-HHMM.csv`
2. Guards:
   - Refuse to run on production unless `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` + `EXPECTED_DB_NAME=bestchoice_prod`
   - 5-second cooldown print to stderr before any write
   - Per-period guard: ห้าม post JE เข้า period ที่ status=CLOSED — ตรวจ AccountingPeriod ก่อน
3. Rollback CLI `apps/api/src/cli/rollback-shop-historical.cli.ts`:
   - Args: `--report-file=backfill-report-YYYYMMDD-HHMM.csv`
   - Void ทุก JE ใน report ที่ metadata.idempotencyKey ตรง
   - Idempotent (รัน 2 ครั้ง = no-op ครั้งที่ 2)
4. Verification report: TB-before vs TB-after diff per account, validate SHOP TB balanced
5. UI: หน้า /shop/historical-backfill (OWNER only) แสดงสถานะ + last run + report download

## Constraints
- ห้าม backfill หลัง year-end closing run แล้ว — ตรวจ year-end batch มีอยู่
- หลัง backfill → SHOP TB ต้อง balance per period
- ห้ามแตะ contracts ที่มี ShopInventoryTransfer JE อยู่แล้ว (idempotency)
- Contract ที่ถูก repossess ก่อน cutoff → skip + log "manual review needed" (don't backfill activation without reversal)
- Atomic per contract: $transaction wrap each contract — partial fail rollback that contract only

## Tests
- Dry-run: no writes, report counts ถูก
- Commit: writes JE + IC ledger rows ถูก
- Idempotency: run 2× → run #2 skips all
- CLOSED period guard: throws if any contract.activatedAt in closed period
- Repossessed contract: skip with reason "needs manual review"
- Verification report: TB before/after diff = expected JE sums
- Rollback: voids JEs + restores TB to before-state

## Acceptance
- [ ] 25+ new tests pass
- [ ] Dry-run บน dev DB → report makes sense
- [ ] Commit บน dev DB → SHOP TB balanced ทุก period
- [ ] Rollback บน dev DB → SHOP TB กลับเป็น 0
- [ ] 0 TS errors

## After implementation
1. /review (deep) — code-reviewer + accounting-audit subagent:
   "ตรวจ idempotency strategy: metadata.idempotencyKey unique constraint คุ้มครอง concurrent run. ตรวจ period guard: ห้าม post เข้า closed period (ผิด TFRS). ตรวจ atomicity: failure ของ 1 contract ห้ามกระทบ contract อื่น. ตรวจ entryDate: ใช้ contract.activatedAt (historical) ไม่ใช่ today. ตรวจ verification report: TB diff คำนวณ correct. ตรวจ rollback: ลบ JE + ลบ IC ledger + restore status. ตรวจ prod guards: 3 env vars + cooldown."
2. /debug:
   - Contract activatedAt = null (rare legacy) — skip with reason
   - InterCompanyTransaction.reconciledAt = null — use activatedAt + commission settle date heuristic หรือ skip
   - 10k+ contracts — memory + batching (batch-size flag)
   - Mid-run process kill (SIGTERM) — resume from last contractId via --from-contract-id
   - Year-end closing run between backfill batches — ต้อง re-check period status per contract
   - Concurrent backfill + new activation — PG advisory lock per legalEntityId
3. /accounting-audit (deep) — ผ่าน accounting-audit subagent:
   "ตรวจว่า backfill ทำตาม TFRS for NPAEs: SHOP TB balance, ไม่ post เข้า closed period, JE entryDate ตรง historical event date, audit trail ครบ"
4. Commit + push: feat/p3-sp7-6-historical-shop-backfill
5. ห้าม run บน prod จนกว่า owner approve + ทำ dry-run บน prod backup
```

---

### 🟦 SP7.7 — SHOP VAT Toggle (Future-Proof)

```
Project: BESTCHOICE Phase 3 SP7.7 — SHOP VAT Toggle
Branch: feat/p3-sp7-7-shop-vat-toggle

## Context
อ่าน .claude/CLAUDE.md § "Business Model" — SHOP ปัจจุบันไม่จด VAT, แต่อาจจดในอนาคต
LegalEntity.isVatRegistered (SP7.1) แล้ว — แต่ทุก SHOP template hardcode "ไม่มี VAT"

## Goal
ให้ SHOP template เคารพ flag `isVatRegistered` — vat-on/off ต่อ entity

## Tasks
1. แก้ทุก SHOP template (cash-sale, down-payment, inventory-transfer, finance-receipt, trade-in, expense, repo-reversal):
   - Inject LegalEntityResolverService
   - ก่อนคำนวณ VAT lines → check `shopEntity.isVatRegistered` && `shopEntity.vatRate > 0`
   - ถ้า off (default) → no VAT lines (เหมือนวันนี้)
   - ถ้า on → คำนวณ VAT 7% เพิ่มเข้า JE (Dr customer / Cr S21-2101 ภาษีขาย shop variant)
2. เพิ่ม CoA SHOP VAT accounts (ถ้ายังไม่มี):
   - S21-2101 ภาษีขาย shop (VAT Output settled)
   - S21-2102 ภาษีขายรอเรียกเก็บ shop (deferred)
   - S11-4101 ภาษีซื้อ shop (Input)
   - Migration `20260955000000_add_shop_vat_accounts` + seed update
3. Doc prefix per entity: SHOP receipt prefix แยกจาก FINANCE — ทำผ่าน SystemConfig key `doc_prefix_per_entity`
4. UI: ใน /settings#vat tab เพิ่ม section "VAT ต่อ Legal Entity" — toggle isVatRegistered ต่อ entity (audit log VAT_TOGGLE_PER_ENTITY)
5. ไม่ flip default: SHOP ยังคง isVatRegistered=false จนกว่า owner เปิด
6. SHOP VAT reports (ภ.พ.30): `/shop/vat-report` (OWNER, ACC) — ลูกของ /finance/vat แต่ filter scope=SHOP

## Constraints
- Default off (SHOP isVatRegistered=false) — no behavior change ใน production
- ห้ามเปลี่ยน VAT rate hardcoding ใน FINANCE templates
- ถ้า toggle on แล้ว posted JE ก่อนหน้า — ไม่ย้อนหลัง (forward-only)
- AuditLog: VAT_TOGGLE_PER_ENTITY with oldValue/newValue
- ทุก paired JE template (SP7.3) ต้อง re-test ภายใต้ SHOP VAT on/off

## Tests
- SHOP VAT off → templates produce ไม่มี VAT lines (regression)
- SHOP VAT on → templates produce VAT lines (Dr customer extra / Cr S21-2101)
- Toggle on/off audit log appears
- SHOP VAT report endpoint: aggregates JE lines อย่างถูก
- ภ.พ.30 SHOP report เปรียบเทียบกับ FINANCE — แยกได้

## Acceptance
- [ ] 15+ new tests pass
- [ ] Default: SHOP VAT off, behavior เดียวกับวันนี้
- [ ] Toggle SHOP VAT on → POS create transaction → JE มี VAT lines
- [ ] 0 TS errors

## After implementation
1. /review (deep):
   "ตรวจว่า default behavior ไม่เปลี่ยน — production ยังคง SHOP no-VAT. ตรวจ toggle audit log capture before/after. ตรวจ paired JE templates เรียก resolver แต่ละครั้ง (no cache stale). ตรวจ VAT rate ใช้ entity.vatRate ไม่ใช่ hardcoded 0.07. ตรวจ SHOP VAT report scope filter strict (เฉพาะ S21-2101)."
2. /debug:
   - Toggle on → off → on ใน 1 วัน — JE ระหว่างนั้นใช้ VAT (forward-only by design)
   - VAT rate change (7% → 10%) — ใช้ entity.vatRate ใน real-time
   - Mixed transactions (SHOP cash sale มี VAT + SHOP expense ไม่มี VAT) — JE balanced
   - SHOP VAT report ในช่วง toggle off → return empty (correct)
3. Commit + push: feat/p3-sp7-7-shop-vat-toggle
```

---

### 🟦 SP7.8 — SHOP Payroll + SSO Split

```
Project: BESTCHOICE Phase 3 SP7.8 — Payroll Per Legal Entity
Branch: feat/p3-sp7-8-payroll-split

## Context
อ่าน .claude/rules/accounting.md § "SSO accounts" + apps/api/src/modules/payroll/
วันนี้ PayrollLine ไม่มี legalEntityId — JE post เข้า FINANCE หมด แม้ employee ทำงานที่ SHOP branch
ผิดเชิงบัญชี: SHOP P&L ไม่มี salary expense = SHOP profit overstated

## Goal
แยก payroll ต่อ legal entity → SHOP salary expense เข้า S51-1101..1104 + FINANCE entered 51-XXXX

## Tasks
1. เพิ่ม `PayrollLine.legalEntityId String?` + FK + index
2. Backfill script: resolve PayrollLine.userId → User.branch → Branch.companyId → CompanyInfo.legalEntityId
3. แก้ `PayrollService` ให้ require legalEntityId ใน input + default จาก user.branch.legalEntity
4. แก้ payroll.template.ts ให้ split lines per legal entity:
   - SHOP employees → Dr S51-1101 / Cr S21-1103 (payable) + SSO ใช้ S21-3105/S21-3106 (new accounts ถ้ายังไม่มี)
   - FINANCE employees → Dr 51-XXXX / Cr 21-1104 (เหมือนเดิม)
5. ถ้า 1 payroll doc มี SHOP+FINANCE employees → post paired (PairedJournalService)
6. SHOP SSO accounts (ใหม่):
   - S21-3105 เงินสมทบประกันสังคม-พนักงานค้างนำส่ง (SHOP)
   - S21-3106 เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง (SHOP)
   - S53-1102 เงินสมทบประกันสังคม (นายจ้าง) - SHOP
7. สปส.1-10 report: split per entity — `/finance/sso-report?entity=SHOP|FINANCE|ALL`
8. UI: ใน payroll create form เพิ่ม preview ของ JE split per entity

## Constraints
- Default: backfill all existing payroll → SHOP if employee branch.legalEntity=SHOP, else FINANCE
- ห้ามแก้ posted JE — เฉพาะ new payroll หลัง deploy
- เก็บ legacy 21-1104 routing ไว้ — ห้าม remove (อาจมี FINANCE-only payroll)
- AuditLog: PAYROLL_LEGAL_ENTITY_ASSIGNED

## Tests
- Mixed payroll (5 SHOP + 3 FINANCE) → 2 JEs paired, balanced both
- All-SHOP payroll → 1 SHOP JE (no FINANCE post)
- Backfill: 100 historical lines → all get legalEntityId, no nulls
- SSO report split: SHOP gets S21-3105/06 totals, FINANCE gets 21-3105/06 totals
- Employee transfer SHOP → FINANCE mid-month → next payroll respects new branch

## Acceptance
- [ ] 20+ new tests pass
- [ ] Backfill: dev DB → all PayrollLine.legalEntityId populated
- [ ] Create payroll → JE preview shows correct entity split
- [ ] 0 TS errors

## After implementation
1. /review (deep):
   "ตรวจ paired post atomicity (SHOP+FINANCE in 1 transaction). ตรวจ SSO 5% cap 750/person per side. ตรวจ split per entity = ไม่ leak (SHOP employee ห้ามมี FINANCE expense line). ตรวจ backfill default = correct (branch lookup chain). ตรวจ SHOP SSO accounts seed idempotent."
2. /debug:
   - Employee ไม่มี branch (system user, contractor) → default to FINANCE หรือ throw?
   - Employee branch.legalEntity = null (legacy) — default + warning
   - Payroll create เดียว 100 employees mixed — performance check
   - Historical payroll ก่อน SP7.8 deploy — ยัง book เข้า FINANCE (forward-only)
   - SSO over-cap (>750) — clamp + audit warning
3. Commit + push: feat/p3-sp7-8-payroll-split
```

---

### 🟦 SP7.9 — Inter-Company Settlement Workflow

```
Project: BESTCHOICE Phase 3 SP7.9 — Monthly IC Settlement
Branch: feat/p3-sp7-9-ic-settlement-workflow

## Context
อ่าน InterCompanyLedger (SP7.2) — มี ledger แล้ว แต่ settle เป็น manual ทีละ row
Real-world: SHOP ออก invoice เก็บเงินจาก FINANCE 1 ครั้งต่อเดือน (รวมทุก contract ใน period)

## Goal
สร้าง monthly settlement run: aggregate IC ledger → settlement document → paired JE → settle ทุก ledger row

## Tasks
1. Model `InterCompanySettlement`:
   - id, settlementNumber (ICS-YYYYMM-NNNN), periodYear, periodMonth
   - fromLegalEntityId, toLegalEntityId
   - totalAmount Decimal
   - status (DRAFT|POSTED|PAID|VOIDED)
   - paymentJournalEntryId?, paidAt?
   - createdById, postedById?, voidedById?
   - createdAt/updatedAt/deletedAt
2. Model `InterCompanySettlementLine`:
   - id, settlementId, interCompanyLedgerId (FK), amount Decimal
3. Service `InterCompanySettlementService`:
   - `preview(fromEntity, toEntity, periodEnd)` — aggregate OPEN ledger rows up to periodEnd
   - `create(input)` — DRAFT, validate sum = ledger sum
   - `post(id)` — DRAFT → POSTED, marks ledger rows PARTIAL or SETTLED
   - `pay(id, paymentMethod, bankAccountCode)` — POSTED → PAID, creates paired JE (Dr cash on receiving side / Cr cash on paying side), settles all linked ledger rows
   - `void(id, reason)` — POSTED/PAID → VOIDED, reverses paired JE, re-opens ledger rows
4. CLI/cron `monthly-ic-settlement-suggestion.cron` (1st of month 09:00 BKK) — สร้าง DRAFT auto for last month (OWNER review then post)
5. Endpoints: CRUD + preview + post + pay + void (OWNER, FM)
6. UI: `/inter-company/settlements` (list) + `/inter-company/settlements/:id` (detail w/ lines)
7. PDF: settlement document for owner records (jspdf + Thai font)

## Constraints
- Settlement document number unique per period — advisory lock per period
- POSTED settlement = immutable (no edit) — only void
- VOIDED ของ PAID settlement = reverse JE + re-open ledger
- ห้าม settle ข้าม period (เฉพาะ period นี้ขึ้นไป — ตรวจ AccountingPeriod CLOSED)
- AuditLog: IC_SETTLEMENT_CREATED, IC_SETTLEMENT_POSTED, IC_SETTLEMENT_PAID, IC_SETTLEMENT_VOIDED

## Tests
- Preview: aggregates correct sum
- Create→Post→Pay→Void full lifecycle
- Concurrent post same period — only 1 wins
- Void of paid → reverse JE + ledger rows back to OPEN
- CLOSED period guard
- Cron generates DRAFT only (not auto-post)

## Acceptance
- [ ] 25+ new tests pass
- [ ] Monthly cron generates DRAFT
- [ ] OWNER can post + pay + download PDF
- [ ] 0 TS errors

## After implementation
1. /review (deep):
   "ตรวจ document number sequence (advisory lock per period, race-safe). ตรวจ Decimal sum integrity (preview total === posted total === paid total). ตรวจ ledger row state transitions (OPEN → PARTIAL → SETTLED idempotent). ตรวจ void reversal: original JE batchId tracked + reversal JE links back. ตรวจ paired JE balance (Dr cash on one side === Cr cash on other side). ตรวจ pay endpoint: bankAccountCode validated against allowed list."
2. /debug:
   - Period boundary: settle for Apr → contains ledger rows openedAt=Apr 30 23:59:59
   - Mixed PARTIAL ledger (some settled by manual previously) — preview excludes settled portion
   - Bank account code typo → BadRequest validation
   - Settlement doc number collision retry (race) — increment seq
   - Cron failure (DB down) — Sentry capture, no DRAFT created, no crash
3. Commit + push: feat/p3-sp7-9-ic-settlement-workflow
```

---

### 🟦 SP7.10 — DB Partition Prep + Documentation

```
Project: BESTCHOICE Phase 3 SP7.10 — Final Cleanup + Phase D Prep
Branch: feat/p3-sp7-10-final-docs-cleanup

## Context
SP7.1-7.9 ทำ infrastructure ครบแล้ว ยังเหลือ cleanup + เตรียม Phase D (separate DBs จริง)

## Goal
- Flip required: legalEntityId NOT NULL ทุก table ที่ backfilled
- ลบ deprecated templates (ContractActivation1ATemplate ถ้ายังไม่มีคนเรียก)
- Documentation update — เป็น single source of truth
- Phase D env scaffolding

## Tasks
1. Schema migration `20260970000000_flip_legal_entity_required`:
   - LegalEntityId NOT NULL บน CompanyInfo, JournalEntry, InterCompanyTransaction, PayrollLine
   - Pre-check: query for nulls → throw with row count if found
2. ลบ deprecated templates:
   - `ContractActivation1ATemplate` (replaced โดย `ContractActivationPairedTemplate` SP7.3)
   - `ShopInventoryTransferTemplate` (deprecated wrapper)
   - ลบ specs ที่เกี่ยวข้องด้วย — แต่ keep regression integration test ที่ใช้ paired template
3. Env vars สำหรับ Phase D:
   - `LEGAL_ENTITY_PRIMARY` (e.g., 'FINANCE') — entity ที่ DB นี้ดูแล
   - `LEGAL_ENTITY_SECONDARY_API_URL` (e.g., 'https://shop-api.bestchoice.com') — สำหรับ inter-co call cross-DB ใน Phase D
   - .env.example + docs/guides/DEPLOY.md update
4. CLAUDE.md update:
   - § "Hardening History" เพิ่ม section `v6 (SP7.1-SP7.10)` สรุปทุก SP
   - § "Multi-Entity Structure" rewrite ให้ใช้ LegalEntity (ไม่ใช่ CompanyInfo)
5. .claude/rules/accounting.md update:
   - ลบ section "Out of scope for P3-SP5 (deferred to P3-SP7)"
   - เพิ่ม § "Phase 3 SP7 Multi-Entity Split" — สรุป LegalEntity model + paired templates + IC ledger + settlement workflow
   - update § "SHOP Accounting (Phase 3 SP5)" → mark P3-SP7 graduated items
6. .claude/rules/database.md update — เพิ่ม pattern "Legal Entity Scoping"
7. Phase D preparation doc: `docs/superpowers/specs/2026-06-XX-phase-d-separate-db-design.md` (outline only)
8. Run full test suite + collect counts

## Constraints
- ห้าม drop column ที่ deprecated (companyCode, fromEntity/toEntity strings) — เก็บไว้ Phase D
- ทุก migration idempotent (IF EXISTS / IF NOT EXISTS)
- ต้อง verify pre-flight: SELECT COUNT(*) WHERE legalEntityId IS NULL = 0 ทุก table ก่อน NOT NULL
- Documentation accuracy: ทุก code reference + line number ต้อง verify (อ่าน file จริง)

## Tests
- Migration NOT NULL: throws if any null found
- After migration: all FK constraints intact
- Regression: ทุก test suite (API+web) ยัง pass
- E2E smoke: create contract → activate → finance receipt → settle → BS+TB still balance
- Doc references: grep verify ทุก file path ใน accounting.md + CLAUDE.md exists

## Acceptance
- [ ] 0 NULL legalEntityId ทุก table
- [ ] CLAUDE.md + accounting.md + database.md updated + reviewed
- [ ] .env.example updated
- [ ] Phase D outline doc committed
- [ ] All test counts (API+web) reported + no regression
- [ ] 0 TS errors / 0 lint errors

## After implementation
1. /review (deep) — code-reviewer + check docs:
   "ตรวจ migration: backfill pre-check + NOT NULL flip + index review. ตรวจ deprecated template removal: ตรวจว่าไม่มีใครเรียก (grep ทั้ง codebase). ตรวจ env vars: ทุก .env.example, docker-compose, GitHub Actions secrets reflect. ตรวจ documentation accuracy: ทุก file path + section reference อ้างของจริง. ตรวจ Phase D outline: ครอบคลุม DB split, cross-DB FK strategy, inter-co webhook, migration plan."
2. /debug:
   - Migration NOT NULL fails because backfill incomplete — pre-check guard catches before ALTER
   - Doc grep find broken reference — fix or remove
   - Phase D outline: identify cross-DB constraints (FK ไม่ทำงานข้าม DB → ใช้ events?)
   - Env var rename: backward compat alias
3. /accounting-audit:
   "Final audit: ทั้งระบบบัญชี SP7 ตาม TFRS for NPAEs. Multi-entity = 2 LegalEntity (SHOP, FINANCE) แยกชัด. Paired JE atomic. IC ledger reconcile. Settlement workflow audit trail. Year-end closing per entity."
4. Commit + push: feat/p3-sp7-10-final-docs-cleanup
5. After all 10 SP merged → tag release `v3.7.0` + write CEO update via /internal-comms
```

---

## 5. Dependency Graph

```
SP7.1 (LegalEntity schema)
  └─→ SP7.2 (IC Ledger uses LegalEntityId)
       └─→ SP7.3 (Paired templates use LegalEntityResolver + IC Ledger create)
            ├─→ SP7.4 (Paired repo reversal)
            ├─→ SP7.5 (SHOP BS — independent, can parallel)
            └─→ SP7.6 (Historical backfill uses paired templates)
                 ├─→ SP7.7 (VAT toggle — needs all SHOP templates ready)
                 ├─→ SP7.8 (Payroll — uses paired templates)
                 └─→ SP7.9 (Settlement — uses IC Ledger + paired)
                      └─→ SP7.10 (Final cleanup — needs everything green)
```

**Strict sequential:** SP7.1 → SP7.2 → SP7.3. After SP7.3 ship, SP7.4-7.9 can parallel ใน worktrees แยก แต่ default = sequential ลด context switch.

---

## 6. Cross-Cutting Concerns (review checklist ทุก SP)

ทุก SP ต้อง /review ตาม checklist นี้ (deep, 3-4 rounds):

### Security
- [ ] @Roles guard ทุก endpoint
- [ ] BRANCH_MANAGER scope correct (W5 policy)
- [ ] No SQL injection (Prisma parameterized)
- [ ] No PII leak in logs/audit/Sentry
- [ ] CSRF token enforced on POST/PATCH/DELETE

### Concurrency & Race
- [ ] PG advisory lock for sequential numbers
- [ ] CAS (compareAndSet) for status transitions
- [ ] $transaction wraps all atomic writes
- [ ] Idempotency keys on retryable operations
- [ ] Concurrent test: 2 parallel calls → only 1 succeeds

### Decimal Precision
- [ ] Money fields = `@db.Decimal(12, 2)` only
- [ ] All math via `Prisma.Decimal.add/sub/mul/div`
- [ ] Rounding mode matches accounting.md (ROUND_DOWN / ROUND_HALF_UP)
- [ ] No `Number()` on Decimal values

### Idempotency
- [ ] `metadata.flow + metadata.idempotencyKey` on every JE
- [ ] DB partial unique index (`journal_entries_idempotency_idx`)
- [ ] Retry handler skips duplicate gracefully

### Scope Isolation
- [ ] SHOP query filters out FINANCE rows + vice versa
- [ ] LegalEntityResolverService used (no hardcoded codes)
- [ ] companyId + legalEntityId both checked during transition (additive)

### Audit Trail
- [ ] AuditLog entry per mutating action
- [ ] `entity` lowercase, `userId` real FK, `oldValue`/`newValue` diff
- [ ] Sentry capture on unexpected error paths

### Testing
- [ ] Unit tests for service methods
- [ ] Integration tests for endpoints (with auth)
- [ ] E2E test for happy path (Playwright if UI)
- [ ] Edge case tests (null, empty, max, min, race)
- [ ] Regression: existing 577+ API tests still green

---

## 7. Per-SP Ship Checklist

Before pushing each SP:

```
[ ] /review pass (no Critical, Warnings addressed)
[ ] /debug edge cases covered
[ ] ./tools/check-types.sh all → 0 errors
[ ] cd apps/api && npm run lint → 0 errors
[ ] cd apps/web && npm run lint → 0 errors
[ ] cd apps/api && npm test → all green
[ ] cd apps/web && npm test → all green
[ ] E2E smoke if UI: cd apps/web && npx playwright test e2e/[relevant].spec.ts
[ ] CLAUDE.md / accounting.md updated if pattern changed
[ ] Commit message references SP7.X
[ ] PR description: scope, changes, test counts, screenshots if UI
[ ] DEEP review round (subagent code-reviewer + accounting-audit if accounting)
[ ] All Critical fixed before merge
[ ] Owner approval gate (especially SP7.1, SP7.6, SP7.10)
```

---

## 8. Risk Register

| Risk | SP | Mitigation |
|---|---|---|
| Legacy contracts ไม่มี SHOP JE → SHOP TB ผิด | SP7.6 | Backfill before flip required; verification report mandatory |
| Paired transaction deadlock under load | SP7.3 | Strict lock order (SHOP first then FINANCE always); load test pre-deploy |
| LegalEntity rename breaks string-coupled code | SP7.10 | Keep companyCode strings as alias; resolve via service |
| VAT toggle on/off mid-month → ภ.พ.30 ผิด | SP7.7 | Toggle audit log + UI warning; forward-only |
| Settlement document number collision | SP7.9 | Advisory lock per period + retry on conflict |
| Historical backfill posts to closed period | SP7.6 | Period guard mandatory; throw with period list if any closed |
| Test suite slow with 213 new tests | All | Use vitest parallel + sharding in CI |

---

## 9. After All 10 SPs

1. Tag release: `v3.7.0` (semver minor since additive)
2. Write CEO update: `/internal-comms` → describe split + benefits
3. Schedule Phase D kickoff meeting (separate DB extraction)
4. Update `docs/superpowers/specs/2026-05-17-sidebar-redesign-roadmap.md` to mark legal-entity items done
5. Owner deliverables:
   - Decide registration of SHOP for VAT (Q3 2026 target)
   - Prepare CPA handoff with new SHOP TB+BS
   - Phase D budget approval

---

## 10. Source References

- `.claude/CLAUDE.md`
- `.claude/rules/accounting.md` § P3-SP5 + § "Out of scope for P3-SP5 (deferred to P3-SP7)"
- `.claude/rules/database.md` § Soft Delete + § 2-Step Migration
- `.claude/rules/security.md`
- `apps/api/prisma/schema.prisma`:
  - `CompanyInfo` (line ~3034)
  - `InterCompanyTransaction` (line ~4067)
  - `ChartOfAccount` (line ~3510)
  - `JournalEntry` (line ~3542)
- `apps/api/src/modules/journal/paired-journal.service.ts`
- `apps/api/src/modules/journal/company-resolver.service.ts`
- `apps/api/src/modules/journal/cpa-templates/shop-*.ts`
- `apps/api/src/cli/wipe-accounting.cli.ts` (template for backfill CLIs)
- `docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md`
