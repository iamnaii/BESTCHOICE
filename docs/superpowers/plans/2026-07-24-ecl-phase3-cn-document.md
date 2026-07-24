# ECL Phase 3 — เอกสารใบลดหนี้ ม.82/5 + ส่ง LINE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ออกเอกสารใบลดหนี้ (Receipt `CREDIT_NOTE`, เลข RT) อัตโนมัติจาก JE ยึดเครื่อง (JP5) และตัดหนี้สูญ ที่ stamp `metadata.creditNoteIssued=true` แล้วส่งให้ลูกค้าทาง LINE FINANCE (Flex + ลิงก์ PDF token) พร้อม delivery tracking + fallback Todo — spec: `docs/superpowers/specs/2026-07-23-ecl-excel-v3-alignment-design.md` §6

**Architecture:** `CreditNoteDocumentService` ใหม่ใน receipts module เป็นแกน: คำนวณยอดจาก `computeInstallmentBreakdown` (แหล่งเดียวกับ JE — เลขตรงกันเสมอ), เกต clean/dirty (owner 2026-07-24: เคสมีงวด PARTIALLY_PAID ค้าง **ไม่ออกเอกสาร** สร้าง Todo รอ CPA), สร้าง Receipt ใน tx เดียวกับ caller, ส่ง LINE หลัง commit แบบ non-blocking (`NotificationLog` + Todo fallback เมื่อ fail)

**Tech Stack:** NestJS + Prisma, Receipt/ReceiptNumberService/receipt-pdf (มีอยู่), LineFinanceClientService (flex), NotificationLog, Todo, React (ReceiptsTab + RepossessionsPage)

## Global Constraints

- เงิน `Prisma.Decimal` เท่านั้น; ยอด CN ต้องมาจาก `computeInstallmentBreakdown` + จำนวนงวด accrued-ค้าง (นิยามเดียวกับ `bad-debt-writeoff.template.ts:139-152`: `accrualJournalEntryId !== null` และไม่มี Payment `status='PAID'`) — **ห้าม**คำนวณสูตรใหม่
- นโยบาย owner 2026-07-24: งวด accrued-ค้างใดมี Payment `status='PARTIALLY_PAID'` → **dirty** → ไม่สร้าง Receipt/ไม่ออกเลข RT — สร้าง Todo (tag `credit-note-review`) + AuditLog `CN_HELD_PARTIAL_PAID` เท่านั้น (รอ CPA เคาะ pro-rate)
- Receipt CN: `receiptType='CREDIT_NOTE'`, `paymentId=null`, `amount`=installmentTotal×count, `vatAmount`=vatPerInst×count (ต้องเท่ากับ `metadata.creditNoteVatAmount` ของ JE — assert), `amountBeforeVat`=installmentExclVat×count, เลขจาก `ReceiptNumberService.generateReceiptNumber(tx)` (RT-YYYYMM-NNNNN — convention เดิมของ void-CN)
- Idempotent: 1 CN ต่อ (contract, source) — schema unique + เช็คก่อนสร้าง
- LINE: channel **line-finance** เท่านั้น; resolve ลูกค้าจาก `CustomerLineLink{channel:FINANCE, unlinkedAt:null}` → fallback `customer.lineIdFinance`; ไม่มี link → ถือว่า send FAILED ทันที (ไป fallback Todo)
- Delivery: `NotificationLog` (channel LINE, channelKey 'line-finance', category 'CREDIT_NOTE', relatedId=receiptId); fail → Todo (createdById = SYSTEM user `isSystemUser`, title มีเลข CN + ชื่อลูกค้า, tags `['credit-note']`) + AuditLog `CN_SEND_FAILED`; สำเร็จ → `CN_SENT`
- Public PDF: endpoint token ใหม่ (ลูกค้าไม่มี JWT) — token สุ่ม ≥32 bytes, หมดอายุ 30 วัน, throttle, **ต้องเพิ่มเข้า `.claude/rules/security.md` intentionally-public list**
- AuditLog: action SCREAMING_SNAKE (`CN_ISSUED`/`CN_HELD_PARTIAL_PAID`/`CN_SENT`/`CN_SEND_FAILED`), `entity:'receipt'` (held ใช้ `entity:'contract'`), ผ่าน `AuditService.log` หรือ tx.auditLog.create ตาม convention ไฟล์ข้างเคียง
- ห้ามแตะ JE templates (JP5/write-off) — เฟสนี้อ่าน metadata อย่างเดียว
- Unit spec = jest; DB-backed spec (vitest) วางใน `apps/api/src/modules/journal/cpa-templates/` เท่านั้น (CI glob)
- ทุก commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` — branch `feat/ecl-phase3-cn-document`

---

### Task 1: Schema — CN traceability + public token

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model Receipt ~3167)
- Create: migration `add_credit_note_source_fields`

**Interfaces:**
- Produces: `Receipt.cnSource String?` (`'REPOSSESSION' | 'WRITE_OFF'`), `Receipt.sourceJournalEntryId String?`, `Receipt.publicToken String? @unique`, `Receipt.publicTokenExpiresAt DateTime?`, partial unique `@@unique([contractId, cnSource])` (Postgres partial ผ่าน raw SQL ใน migration: `WHERE cn_source IS NOT NULL AND deleted_at IS NULL` — Receipt ไม่มี deletedAt → ใช้ `WHERE cn_source IS NOT NULL` เท่านั้น)

- [ ] **Step 1:** เพิ่ม fields ใน model Receipt:

```prisma
  /// Phase 3 CN: แหล่งที่มาใบลดหนี้อัตโนมัติ — 'REPOSSESSION' | 'WRITE_OFF' (null = receipt ปกติ/void-CN เดิม)
  cnSource              String?   @map("cn_source")
  sourceJournalEntryId  String?   @map("source_journal_entry_id")
  /// ลิงก์ PDF สาธารณะสำหรับลูกค้า (LINE) — หมดอายุตาม publicTokenExpiresAt
  publicToken           String?   @unique @map("public_token")
  publicTokenExpiresAt  DateTime? @map("public_token_expires_at")
```

- [ ] **Step 2:** `cd apps/api && npx prisma migrate dev --name add_credit_note_source_fields --create-only` แล้วเติมท้ายไฟล์ migration:

```sql
CREATE UNIQUE INDEX "receipts_contract_cn_source_key" ON "receipts"("contract_id", "cn_source") WHERE "cn_source" IS NOT NULL;
```

(เช็คชื่อตาราง/คอลัมน์จริงจาก migration ที่ generate — `@@map` ของ Receipt)

- [ ] **Step 3:** `npx prisma migrate dev` (apply local) + `npx prisma generate` + `./tools/check-types.sh api` → 0 errors
- [ ] **Step 4:** Commit: `feat(cn): schema — Receipt cnSource/sourceJournalEntryId/publicToken + partial unique`

---

### Task 2: CreditNoteDocumentService — ออกเอกสาร + เกต clean/dirty

**Files:**
- Create: `apps/api/src/modules/receipts/services/credit-note-document.service.ts`
- Modify: `apps/api/src/modules/receipts/receipts.module.ts` (provider + export)
- Test: `apps/api/src/modules/receipts/services/credit-note-document.service.spec.ts` (jest, mock prisma)

**Interfaces:**
- Consumes: `ReceiptNumberService.generateReceiptNumber(tx)`, `computeInstallmentBreakdown` (`apps/api/src/modules/journal/compute-installment-breakdown.ts`)
- Produces:
```ts
issueForContract(input: {
  contractId: string;
  source: 'REPOSSESSION' | 'WRITE_OFF';
  /** เลข JE จาก template result (templates คืน { entryNo } — ไม่มี UUID) */
  sourceJournalEntryNo: string;
  actorUserId: string;
}, tx: Prisma.TransactionClient): Promise<
  | { outcome: 'ISSUED'; receiptId: string; receiptNumber: string }
  | { outcome: 'HELD_PARTIAL_PAID'; todoId: string }
  | { outcome: 'SKIPPED_NO_ACCRUED' | 'SKIPPED_DUPLICATE' }
>
```
Logic ตามลำดับ: (1) duplicate check `receipt.findFirst({ contractId, cnSource: source })` → SKIPPED_DUPLICATE; (2) โหลด contract + installmentSchedules + payments แล้วหา accrued-unpaid (นิยามใน Global Constraints); count=0 → SKIPPED_NO_ACCRUED; (3) มี PARTIALLY_PAID ใน accrued-unpaid → สร้าง Todo (หา SYSTEM user `isSystemUser:true` เป็น createdById, title `ตรวจใบลดหนี้ [เลขสัญญา] — มีงวดจ่ายบางส่วน รอ CPA (ม.82/5)`, priority HIGH, tags ['credit-note-review']) + AuditLog `CN_HELD_PARTIAL_PAID` (entity 'contract') → HELD; (4) clean → คำนวณยอดจาก breakdown, สร้าง Receipt (fields ตาม Global Constraints + `payerName`=customer.name, `receiverName`='BESTCHOICE FINANCE', `paidDate`=now, `issuedById`=actorUserId, `itemDescription`=`ใบลดหนี้ยกเลิกงวดค้าง N งวด — เลิกสัญญา (ม.82/5)`, publicToken=`crypto.randomBytes(32).toString('base64url')`, expiry now+30d) + AuditLog `CN_ISSUED` → ISSUED
- Resolve JE: `tx.journalEntry.findUnique({ where: { entryNumber: sourceJournalEntryNo } })` → เก็บ `je.id` ลง `Receipt.sourceJournalEntryId`; Assert ยอด: `vatAmount.toFixed(2)` ต้องเท่ากับ `je.metadata.creditNoteVatAmount` — ไม่เท่า → throw (Thai message) กัน drift (อยู่ใน tx เดียวกับที่ JE เพิ่ง post — เห็นแน่นอน)

- [ ] **Step 1:** เขียน failing jest tests: (a) clean 3 งวด accrued-unpaid fixture 17k/12 → ISSUED, Receipt ถูกสร้างด้วย amount 4,547.49 / vat 297.51 / beforeVat 4,249.98, token มี expiry; (b) มี 1 งวด PARTIALLY_PAID → HELD + todo.create ถูกเรียก + ไม่มี receipt.create; (c) duplicate → SKIPPED_DUPLICATE; (d) vat mismatch กับ JE metadata → throws
- [ ] **Step 2:** รัน fail → implement → รันผ่าน (`npm run test --workspace=apps/api -- credit-note-document`)
- [ ] **Step 3:** `./tools/check-types.sh api` → 0; Commit: `feat(cn): CreditNoteDocumentService — ออก CN อัตโนมัติ + เกต PARTIALLY_PAID รอ CPA`

---

### Task 3: Wire triggers — repossession + write-off

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (หลัง JP5 execute ใน tx เดียวกัน ~line 370-380) + module import
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts` (`writeOffBadDebt` หลัง template execute ใน tx) + accounting.module
- Tests: แก้ spec ทั้งสอง (mock service ใหม่ + assert เรียกด้วย source ถูกต้อง)

**Interfaces:**
- Consumes: `CreditNoteDocumentService.issueForContract` (Task 2 — receipts.module ต้อง export; ระวัง circular import: accounting/repossessions import receipts module — เช็คว่า receipts module ไม่ import กลับ; ถ้า circular ให้ใช้ `forwardRef` ตาม pattern ที่มีใน codebase)
- กติกา: เรียก `issueForContract` **ภายใน** tx (atomic กับ JE — throw = rollback ทั้งก้อน) ด้วย `sourceJournalEntryNo` จาก template result; ผลลัพธ์ (outcome + receiptId) ต้อง**ส่งออกมาจาก tx closure** (return ค่าเพิ่ม)
- **ห้ามเรียก LINE delivery ภายใน tx เด็ดขาด** (scrutinize blocker: ยิงก่อน commit = ลูกค้ากดลิงก์แล้ว 404 / tx rollback แล้วลูกค้าได้ลิงก์ผี) — pattern บังคับ:
```ts
const result = await this.prisma.$transaction(async (tx) => { /* ...JE + issueForContract... */ return { ..., cnReceiptId }; });
if (result.cnReceiptId) void this.cnDelivery.deliver(result.cnReceiptId).catch((e) => Sentry.captureException(e));
return result;
```
+ unit test ยืนยันลำดับ: deliver ถูกเรียก**หลัง** $transaction resolve (mock $transaction แล้ว assert call order)

- [ ] **Step 1:** failing tests ในทั้ง 2 spec (mock `creditNoteDocumentService.issueForContract` — assert ถูกเรียกด้วย `{ source: 'REPOSSESSION' }` / `{ source: 'WRITE_OFF' }` + sourceJournalEntryId จาก template result)
- [ ] **Step 2:** implement ทั้ง 2 จุด → tests เขียว (`repossessions.service.spec` + `bad-debt.service.spec` ทั้งไฟล์)
- [ ] **Step 3:** DB-backed integration (vitest ใน cpa-templates dir): `cn-issue-on-writeoff.spec.ts` — seed 17k/12 + 1A + 2A×3 + terminate + writeOffBadDebt จริง → Receipt CN เกิดจริง เลข RT + ยอด 4,547.49/297.51 + JE metadata ตรง (โครง setup ลอก `ecl-terminated-base.spec.ts`; ต้องสร้าง SYSTEM user + customer + FM/OWNER users ใน setup)
- [ ] **Step 4:** Commit: `feat(cn): ออกใบลดหนี้อัตโนมัติจาก repossession + write-off (atomic กับ JE)`

---

### Task 4: PDF standalone CN + public token endpoint

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-pdf.service.ts` (รองรับ CN ที่ `voidedReceiptId=null`: กล่องอ้างอิงเปลี่ยนจาก "ยกเลิกใบเสร็จ X" → `อ้างอิง: เลิกสัญญา [contractNumber] — ใบลดหนี้ตาม ม.82/5` + แสดง amountBeforeVat/vatAmount)
- Modify: `apps/api/src/modules/receipts/receipts.controller.ts` — เพิ่ม `@Get('public/:token/pdf')` **ไม่มี JwtAuthGuard** (ประกาศเหนือ class-level guard ไม่ได้ — ทำ controller ย่อย `receipts-public.controller.ts` แยก): validate token + expiry → 404 Thai ถ้าหมดอายุ/ไม่พบ; `@Throttle` เข้ม (เช่น 10/min); ห้าม log token เต็ม
- Modify: `.claude/rules/security.md` — เพิ่ม `receipts-public` เข้า intentionally-public list พร้อมเหตุผล
- Tests: jest controller/service spec — token ถูก → 200 pdf; หมดอายุ → 404; token มั่ว → 404

- [ ] **Step 1:** failing tests → implement → เขียว
- [ ] **Step 2:** Commit: `feat(cn): PDF ใบลดหนี้ standalone + public token endpoint (30 วัน, throttled)`

---

### Task 5: LINE send + delivery tracking + fallback Todo

**Files:**
- Create: `apps/api/src/modules/receipts/services/credit-note-delivery.service.ts`
- Modify: `apps/api/src/modules/line-oa/services/line-flex-builder.service.ts` หรือสร้าง flex ใน delivery service (ดู pattern `payment-link.service.ts:231 sendPaymentFlex`)
- Modify: triggers (Task 3) — หลัง tx commit สำเร็จ เรียก `deliver(receiptId)` แบบ fire-and-forget (`.catch(Sentry)`)
- Test: jest spec ของ delivery service

**Interfaces:**
- Produces: `deliver(receiptId: string): Promise<{ delivered: boolean }>`
- Logic: โหลด receipt+contract+customer → resolve LINE userId (`CustomerLineLink` FINANCE → fallback `lineIdFinance`) → ไม่มี → FAILED path; มี → push Flex ผ่าน `LineFinanceClientService.pushMessage` (การ์ด: หัว "ใบลดหนี้", เลขที่ RT, สัญญา, ยอดลดหนี้รวม, ปุ่ม "ดูเอกสาร" → `${baseUrl}/cn/${publicToken}` — **หน้า frontend** ตาม pattern `/pay/:token` และใช้ baseUrl จาก config ตัวเดียวกับ `payment-link.service.ts` เป๊ะ ห้ามใช้ env อื่น) → เขียน `NotificationLog` SENT + AuditLog `CN_SENT`
- **PDPA (ตัดสินใจแล้ว):** ส่งโดยไม่ gate consent — ใบลดหนี้เป็นเอกสารภาษีตามหน้าที่กฎหมาย (legitimate interest) ไม่ใช่ marketing ต่างจาก receipt flex เดิมที่ gate (`line-flex-builder :115`) — ใส่ comment อธิบายในโค้ด
- **Retry (ตัดสินใจแล้ว):** v1 ไม่มี auto-retry — ปุ่มส่งซ้ำ + Todo fallback ครอบแล้ว; ประเมิน reuse `notification-dispatch.send` (ได้ retry queue ฟรี) ไว้เป็น follow-up ถ้า volume โต — บันทึกเหตุผลใน jsdoc
- FAILED path (push throw หรือไม่มี LINE): `NotificationLog` FAILED (errorMsg, blockReason ถ้ามี) + Todo (SYSTEM user, title `ส่งใบลดหนี้ ${receiptNumber} ให้ ${customer.name} — LINE ไม่สำเร็จ (แนบซอง EMS กับหนังสือบอกเลิกได้)`, tags ['credit-note'], priority MEDIUM) + AuditLog `CN_SEND_FAILED` — **ห้าม throw** (ต้องไม่ทำให้ caller พัง)
- Resend: reuse endpoint `POST /receipts/:id/send-line` เดิม (`receipt-issuance.service.ts:181`) — เพิ่ม branch: ถ้า `receiptType==='CREDIT_NOTE' && cnSource != null` → เรียก `CreditNoteDeliveryService.deliver` แทน `sendPaymentReceipt` (ช่องทาง finance ไม่ใช่ shop)

- [ ] **Step 1:** failing tests: (a) มี LINE link → pushMessage เรียกด้วย channel line-finance + NotificationLog SENT; (b) push throw → NotificationLog FAILED + todo.create + ไม่ throw; (c) ไม่มี LINE link → FAILED path; (d) resend CN route ไป deliver
- [ ] **Step 2:** implement → เขียว → types 0
- [ ] **Step 3:** Commit: `feat(cn): ส่งใบลดหนี้ทาง LINE FINANCE + NotificationLog + fallback Todo`

---

### Task 6: Frontend — ReceiptsTab + RepossessionsPage

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/ReceiptsTab.tsx` — CN แถวที่ `cnSource` มี: แสดง chip แหล่งที่มา (ยึดเครื่อง/ตัดหนี้สูญ) + สถานะส่ง LINE (จาก NotificationLog ล่าสุด — เพิ่ม field ใน API response ของ receipts list) — ปุ่ม PDF/ส่ง LINE ใช้ของเดิมได้เลย
- Modify: `apps/web/src/pages/RepossessionsPage.tsx` — actions column (~line 292-323): ถ้าสัญญามี CN (`cnSource='REPOSSESSION'`) → ปุ่ม "ใบลดหนี้" (เปิด PDF `/receipts/:id/pdf`) + ปุ่มส่งซ้ำ; API: เพิ่ม cn info ใน repossessions list response (join Receipt โดย contractId+cnSource)
- Create: `apps/web/src/pages/CreditNoteViewPage.tsx` — หน้า public `/cn/:token` (lazy, ไม่มี ProtectedRoute — ตาม pattern `/pay/:token` PayPage): fetch `GET /api/receipts/public/:token/pdf` เป็น blob แสดงใน viewer/iframe + ปุ่มดาวน์โหลด; token ผิด/หมดอายุ → ข้อความไทยสุภาพ (ไม่ leak รายละเอียด)
- ตาม design tokens (ห้าม hardcode สี), toast จาก sonner, react-query invalidate หลัง resend

- [ ] **Step 1:** Backend: เติม `creditNote` summary ใน responses ทั้งสอง (receipts list มีอยู่แล้วเป็นแถวปกติ — เพิ่มเฉพาะ repossessions list + lastDelivery ใน receipt row)
- [ ] **Step 2:** Frontend edits + `./tools/check-types.sh all` → 0
- [ ] **Step 3:** Commit: `feat(cn): UI ใบลดหนี้ — ReceiptsTab chips + RepossessionsPage ปุ่มดู/ส่งซ้ำ`

---

### Task 7: Docs + verification gate + PR

- [ ] **Step 1:** `.claude/rules/accounting.md` — เพิ่มหัวข้อ CN document (trigger, clean/dirty gate รอ CPA, เลข RT, token 30 วัน, delivery tracking, audit actions) ใต้ section ECL v3
- [ ] **Step 2:** `./tools/check-types.sh all` + `npm run test --workspace=apps/api` (triage เทียบ baseline depreciation) + vitest CI-equivalent (รวม spec ใหม่ Task 3)
- [ ] **Step 3:** dispatch code-reviewer ครอบทั้ง branch → แก้ Critical/Important → รายงาน owner → approve → PR → admin merge (house pattern)
- [ ] **Step 4 (rollout):** ไม่มี SQL/config — deploy อัตโนมัติพอ; แจ้งทีมว่า CN จะเด้งใน LINE ลูกค้า + Todo เมื่อส่งไม่ผ่าน; เคส HELD รอ CPA ดูได้จาก TodosPage tag `credit-note-review`

## Out of scope
- Pro-rate CN สำหรับ PARTIALLY_PAID (รอ CPA — เคสถูก HELD ไว้)
- CN ย้อนหลังสำหรับ JE ที่ post ไปก่อนเฟสนี้ (forward-only; ถ้าต้องการ backfill ทำ CLI แยก)
- แนบ PDF เป็นไฟล์ใน LINE (LINE Messaging API ไม่รองรับ push ไฟล์ PDF ตรง — ใช้ลิงก์)
