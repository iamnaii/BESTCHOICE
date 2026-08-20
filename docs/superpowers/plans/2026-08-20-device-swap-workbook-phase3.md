# Device Swap Workbook — Phase 3 Implementation Plan (Flow C: ยกเลิกสัญญา C-1/C-2 + PAYOUT_RECALL producer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ยกเลิกสัญญาก่อนชำระงวดแรกได้ถูกต้องทั้งสองกรณีตาม workbook Flow C — C-1 (ยังไม่ตัดจ่าย → กลับรายการทั้งชุด) และ C-2 (ตัดจ่ายแล้ว → ตั้งลูกหนี้เรียกคืน 11-2107 `PAYOUT_RECALL` ให้หักกลบรอบถัดไปหรือรับเงินสดคืน) — spec §5 + คำตัดสินเจ้าของ D3

**Architecture:** generalize `ExchangeCancelReversalTemplate` เป็น sweep engine ตัวเดียว (เพิ่ม excludeFlows + **account redirect**); C-2 = sweep-with-redirect (`21-1101/21-1102 → 11-2107`, `S11-3001/S11-3002 → S21-3001`, stamp `PAYOUT_RECALL`); อัปเดตเลนส์/guards ของ Phase 2 เป็นสูตร **net of Σ POSTED deductions** (จำเป็นจากเคสยกเลิก swap — ดู "เลขทองของเฟส" ด้านล่าง); เส้นทางเงินสดคืนผ่าน settle template + SHOP leg ใหม่

**Tech Stack:** เดิมทั้งหมด — NestJS/Prisma/Decimal, jest + vitest `--no-file-parallelism`, React

**Base:** branch `feat/device-swap-cancel-phase3` (แตกจาก main `0e8240e41` — Phases 1-2 merged แล้ว)

## เลขทองของเฟส (คิดจบแล้ว — ทุก task ต้องสอดคล้อง)

**เคสยกเลิก swap หลังตัดจ่าย (ตัวเลข Phase 2 golden):** สัญญาใหม่ payable 10,000+1,000; เครดิตรับซื้อ 8,000; batch POSTED จ่ายจริง 3,000 (item: financedGl 10,000, commissionGl 1,000, swapCreditAmount 8,000)

GL หลังยกเลิก (C-2 ผ่าน exchange-cancel):
```
11-2107: A.3 Dr 8,000 [SWAP_CREDIT] + batch Cr 8,000 [ไม่ stamp] + redirect Dr 11,000 [PAYOUT_RECALL] + A.3-mirror Cr 8,000 [SWAP_CREDIT]
  = ยอดบัญชีจริง 3,000 Dr ✓ (เงินสดที่ FINANCE จ่ายไปจริง)
S21-3001: A.4 Cr 8,000 + batch Dr 8,000 + A.4-mirror Dr 8,000 + redirect Cr 11,000 = 3,000 Cr ✓
typed SWAP_CREDIT (stamped): 8,000 − 8,000 = 0 ✓
typed PAYOUT_RECALL (stamped): 11,000 ← GROSS — ยอดเรียกคืนจริง = 11,000 − Σ POSTED deductions (8,000) = 3,000
```
**บทบังคับ:** คิวเรียกคืน + drift guard แถว RECALL + residual alarm ของ Phase 2 ต้องเปลี่ยนเป็นสูตร net (`typed − Σ deductions ใน batch POSTED ของสัญญานั้น`) — ไม่งั้นรอบถัดไปหักซ้ำ 8,000 (บัญชีติดลบ). สัญญา C-2 ธรรมดา (ไม่ใช่ swap) Σ deductions = 0 → net = gross เหมือน Phase 2 เดิมทุกประการ

## Global Constraints

- เงิน `Prisma.Decimal` เท่านั้น; error ภาษาไทย; migration additive เท่านั้น (เฟสนี้**ไม่มี** migration ใหม่)
- flow strings / idempotency keys เดิมห้ามเปลี่ยน; batch JE ยังห้าม stamp `contractId`
- **ยกเลิกได้เฉพาะก่อนชำระงวดแรก (D3)**: มี Payment `PAID`/`amountPaid > 0` ที่ไม่ถูก void → reject "มีการชำระเงินบนสัญญาแล้ว — ต้อง void ใบเสร็จทั้งหมดก่อนยกเลิก" (void ออกใบลดหนี้ ม.86/10 อัตโนมัติอยู่แล้ว); สัญญาที่เดินไปแล้ว → เส้นทางยึดเครื่อง (JP5)
- Sweep engine: ข้าม `metadata.reversed = true`, ข้าม `tag: 'REVERSAL'`, ข้าม flow ของตัวเอง, mirror copy `companyId` + `contractId` + `shopReceivableType` + `newContractId` (พฤติกรรม `ExchangeCancelReversalTemplate` ปัจจุบัน — ห้ามถอย regression)
- Sweep ของ generic cancel ต้อง **exclude flows**: `provision`, `stage-reverse` (ECL — ใช้ release ใบเดียวจาก live GL แทน กัน double: scrutiny finding 2), `shop-collect-settlement` (เงินสดจริง ห้าม mirror)
- C-2 redirect ต้อง **cross-check**: Σ ยอดที่ redirect เข้า 11-2107 == Σ (financedGl+commissionGl) ของ SETTLEMENT items ใน batch POSTED ±0.01 — ไม่ตรง = GL มี hand-JV แปลก → reject ทั้งการยกเลิก (ห้ามเดา)
- Carry จาก Phase 2 ที่เฟสนี้ต้องปิด: (a) producer ตั้ง PAYOUT_RECALL เฉพาะเมื่อมี SETTLEMENT item ใน batch **POSTED** (= ตัว detection ของ C-2 เอง); (b) residual alarm รวม typed สองประเภทก่อนหัก Σ POSTED
- vitest integration ทุกครั้ง `--no-file-parallelism`; ทุก subagent ใช้ model fable

---

### Task 1: Generalize sweep engine — excludeFlows + account redirect

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/exchange-cancel-reversal.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/exchange-cancel-reversal.template.spec.ts` (สร้างใหม่ถ้ายังไม่มี — jest unit, mock JournalAutoService/Prisma ตาม pattern template specs ข้างเคียง)

**Interfaces:**
- Consumes: พฤติกรรมปัจจุบันของ `reverse({ jeIds, newContractId })`
- Produces (signature ใหม่ — backward compatible):
```ts
export interface SweepRedirect {
  /** บัญชีปลายทางของ mirror leg (เช่น 21-1101 → 11-2107) */
  to: string;
  /** description ของ leg ที่ redirect */
  description: string;
}
export interface CancelSweepInput {
  jeIds: string[];
  /** ชื่อเดิมคงไว้ — คือ contractId ที่ใช้ sweep (exchange ส่ง newContractId, generic ส่ง contractId) */
  newContractId: string;
  /** flows ที่ห้าม mirror (default [] — พฤติกรรม exchange เดิมไม่เปลี่ยน) */
  excludeFlows?: string[];
  /** map บัญชี → redirect ปลายทาง ใช้ใน C-2 (default undefined = mirror ตรง) */
  redirects?: Record<string, SweepRedirect>;
  /** stamp เพิ่มบน reversal JE ที่มี redirect leg (เช่น shopReceivableType: 'PAYOUT_RECALL') */
  redirectStamp?: Record<string, string>;
  /** flow/label ของ reversal (default 'exchange-cancel' + prefix '[ยกเลิกเปลี่ยนเครื่อง]') */
  flowLabel?: string;
  descriptionPrefix?: string;
}
// reverse() คืน { reversalJeIds, redirectedTotals: Record<string, Prisma.Decimal> }
//   redirectedTotals key = บัญชีปลายทาง, value = Σ(Dr−Cr) ที่ redirect เข้าบัญชีนั้น (caller ใช้ cross-check)
```

- [ ] **Step 1: เขียน failing unit tests**

Create/extend spec — เคสที่ต้องมี (mock `journal.createAndPost` จับ lines; mock prisma.journalEntry.findMany คืน fixture JEs):
```ts
it('default: พฤติกรรมเดิมทุกประการ (mirror + skip reversed/REVERSAL + flow exchange-cancel)', ...);
it('excludeFlows: JE flow=provision ไม่ถูก mirror', ...);
it('redirect: mirror leg 21-1101 Dr 10,000 → กลายเป็น 11-2107 Dr 10,000 + description ใหม่ + JE stamp redirectStamp', ...);
it('redirectedTotals: รวม Dr−Cr ต่อบัญชีปลายทางถูกต้อง (สอง JE, สองบัญชีต้นทาง → ปลายทางเดียว)', ...);
it('flowLabel/descriptionPrefix override: metadata.flow และ idempotencyKey prefix เปลี่ยนตาม', ...);
```

- [ ] **Step 2: รันให้ fail** — `cd apps/api && npx jest src/modules/journal/cpa-templates/exchange-cancel-reversal.template.spec.ts`

- [ ] **Step 3: Implement**

ใน `reverse()`:
- หลังโหลด swept: filter เพิ่ม `if (input.excludeFlows?.includes(meta['flow'] as string)) continue;` (วางถัดจาก skip flow ตัวเอง — ใช้ `flowLabel ?? 'exchange-cancel'` ในเงื่อนไข skip ตัวเอง)
- ตอน map lines: ถ้า `input.redirects?.[l.accountCode]` → ใช้ `accountCode: redirect.to`, ยอด mirror เดิม (dr↔cr สลับแล้ว), `description: redirect.description`; สะสม `redirectedTotals[redirect.to] += (dr − cr)`
- metadata ของ reversal JE: `flow: input.flowLabel ?? 'exchange-cancel'`, `idempotencyKey: \`${input.flowLabel ?? 'cancel'}:${je.id}\`` — **ระวัง**: exchange เดิมใช้ `cancel:${je.id}` — คง default เดิมไว้เป๊ะ (`cancel:` prefix เมื่อไม่ส่ง flowLabel); เมื่อ JE ใบนั้นมี redirect leg → merge `...(input.redirectStamp ?? {})` เข้า metadata
- description: `\`${input.descriptionPrefix ?? '[ยกเลิกเปลี่ยนเครื่อง]'} กลับรายการ ${je.entryNumber}\`` + per-line prefix เดียวกัน
- return เพิ่ม `redirectedTotals`
- **ห้ามแตะ**: skip conditions เดิม, การ copy companyId/contractId/shopReceivableType/newContractId, การ stamp reversed:true บน original

- [ ] **Step 4: รันให้ผ่าน** — unit ใหม่ + `npx vitest run src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts --no-file-parallelism` (พฤติกรรม exchange เดิมห้ามขยับแม้แต่ byte — cancel cases 2 ตัวต้องผ่านโดยไม่แก้ assertion)

- [ ] **Step 5: Commit** — `feat(journal): generalize cancel sweep — excludeFlows + account redirect + redirectedTotals (Phase 3)`

---

### Task 2: Generic cancellation C-1 — guards + sweep + ECL + restore

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/contract-cancellation.template.ts` (ยกเครื่อง — เลิก mirror-1A-เอง เปลี่ยนไปเรียก sweep engine)
- Modify: `apps/api/src/modules/contracts/services/contract-cancellation.service.ts` (guards + restore + ECL orchestration)
- Test: `apps/api/src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts` (ไฟล์ใหม่ — vitest DB จริง; ดู setup pattern จาก `interco-netting.integration.spec.ts`) + อัปเดต unit spec เดิมของ service/template ถ้าปักพฤติกรรมเก่า

**Interfaces:**
- Consumes: sweep engine (Task 1), `EclStageReverseTemplate` (`execute({ contractId, reverseAmount, fromBucket, toBucket }, tx)` — self-skip เมื่อ ≤ 0), `glContractBalance`
- Produces: `approveCancellation` เวอร์ชัน C-1 ครบวงจร — Task 3 ต่อ C-2 branch บนโครงนี้

- [ ] **Step 1: เขียน failing integration tests**

Seed แบบ synthetic (pattern เดียวกับ interco-netting: JournalAutoService จริง + Contract/Customer/Product จริง prefix `CANCELTEST-`):
```ts
it('C-1: ยกเลิกก่อนตัดจ่าย → GL net 0 ทุกบัญชี + สัญญา CANCELED + product กลับ SHOP stock', async () => {
  // seed: 1A (17,000 gross shape) + SHOP legs (inventory-transfer 2 ใบ) + 2A accrual 1 งวด + provision JE 1 ใบ (flow='provision' + BadDebtProvision row)
  // approve cancellation →
  // - ทุกบัญชีของสัญญา net 0: 11-2101, 11-2105, 11-2106, 21-2102, 21-1101, 21-1102, 11-2103, 41-1101, S11-3001, S11-3002, S41-1101, S50-1101, S11-2001
  // - 11-2102 = 0 ผ่าน "release ใบเดียว" (JE flow='stage-reverse' ใบใหม่ 1 ใบ — ไม่ใช่ mirror ของ provision)
  // - JE provision เดิมไม่ถูก mirror (exclude)
  // - BadDebtProvision rows → REVERSED
  // - contract.status = CANCELED; product.status = IN_STOCK + ownedByCompanyId = SHOP
  // - payments + installmentSchedules soft-deleted
});
it('guard: มี Payment PAID ไม่ void → reject ข้อความ void ก่อน', ...);
it('guard: สัญญาอยู่ใน batch DRAFT/PENDING_APPROVAL → reject บอกให้ถอนรอบก่อน', ...);
it('guard: refundAmount > 0 → reject (deprecated — เงินคืนลูกค้าอยู่ฝั่ง SHOP)', ...);
it('guard: 11-2107 SHOP_COLLECT ของสัญญาค้าง (หน้าร้านถือเงินลูกค้ายังไม่ settle) → reject', ...);
```

- [ ] **Step 2: รันให้ fail**

- [ ] **Step 3: ยกเครื่อง `ContractCancellationTemplate`**

แทน logic mirror-1A ด้วย:
```ts
    // C-1: sweep-reverse ทุก JE ของสัญญา ยกเว้น ECL flows (release แยกใบเดียว —
    // exclude กัน double: sweep mirror + release พร้อมกันจะทำ 11-2102 ติดลบ)
    const { reversalJeIds } = await this.sweepTemplate.reverse(
      {
        jeIds: [],
        newContractId: contractId, // ชื่อ param เดิมของ engine — คือ contractId ที่ sweep
        excludeFlows: ['provision', 'stage-reverse', 'shop-collect-settlement'],
        flowLabel: 'contract-cancellation',
        descriptionPrefix: '[ยกเลิกสัญญา]',
      },
      tx,
    );
    // ECL: release ใบเดียวจาก live GL (pattern JP4 C1) + flip provision rows
    const eclBal = await glContractBalance(tx, contractId, '11-2102', 'cr');
    if (eclBal.gt(0)) {
      await this.eclStageReverse.execute(
        { contractId, reverseAmount: eclBal, fromBucket: 'CANCEL', toBucket: 'CANCEL' },
        tx,
      );
    }
    await tx.badDebtProvision.updateMany({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      data: { status: 'REVERSED' },
    });
```
(inject `ExchangeCancelReversalTemplate` + `EclStageReverseTemplate` — ดู module providers ของ journal ว่า export อยู่แล้ว; idempotency ของ template เดิม (`flow='contract-cancellation'` + cancellationId) คงไว้เป็น guard ชั้นแรกก่อน sweep; **ลบ** refund JE block เดิม (Dr 52-1106 / Cr 11-1201) — ดู Step 4)

- [ ] **Step 4: Guards + restore ใน `contract-cancellation.service.ts`**

ใน `approveCancellation` ก่อนโพสต์ (ใน tx เดียวกัน):
```ts
      const contract = cancellation.contract;
      if (contract.status !== 'ACTIVE') {
        throw new BadRequestException('ยกเลิกได้เฉพาะสัญญาสถานะ ACTIVE — สัญญาที่เดินไปแล้วใช้เส้นทางยึดเครื่อง (JP5)');
      }
      const paid = await tx.payment.findFirst({
        where: { contractId: contract.id, deletedAt: null, OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }] },
        select: { id: true },
      });
      if (paid) {
        throw new BadRequestException('มีการชำระเงินบนสัญญาแล้ว — ต้อง void ใบเสร็จทั้งหมดก่อนยกเลิก (ระบบออกใบลดหนี้ให้อัตโนมัติ)');
      }
      const openItem = await tx.interCoSettlementItem.findFirst({
        where: { contractId: contract.id, deletedAt: null,
          batch: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, deletedAt: null } },
        include: { batch: { select: { batchNumber: true } } },
      });
      if (openItem) {
        throw new BadRequestException(
          `สัญญาอยู่ในรอบจ่าย ${openItem.batch.batchNumber} ที่ยังไม่อนุมัติ — ถอน/ยกเลิกรอบก่อนจึงจะยกเลิกสัญญาได้`,
        );
      }
      if (new Prisma.Decimal(cancellation.refundAmount.toString()).gt(0)) {
        throw new BadRequestException('refundAmount ไม่รองรับแล้ว — เงินคืนลูกค้า (เงินดาวน์) จัดการฝั่ง SHOP หลังยกเลิก');
      }
      const shopCollectBal = await shopCollectTypedBalance(tx, contract.id); // helper ใหม่เล็กๆ: 11-2107 Σ(Dr−Cr) ที่ classify เป็น SHOP_COLLECT (stamped/collectedByShop) ของสัญญา
      if (shopCollectBal.abs().gt('0.01')) {
        throw new BadRequestException('มีเงินที่หน้าร้านรับแทนยัง settle ไม่ครบ (11-2107) — เคลียร์ก่อนยกเลิก');
      }
```
หลังโพสต์ template (ใน tx เดิม): product restore + soft-delete (pattern exchange-cancel):
```ts
      await tx.product.update({
        where: { id: contract.productId },
        data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
      });
      await tx.payment.updateMany({ where: { contractId: contract.id, deletedAt: null }, data: { deletedAt: now } });
      await tx.installmentSchedule.updateMany({ where: { contractId: contract.id, deletedAt: null }, data: { deletedAt: now } });
```
(shopCompanyId ผ่าน `CompanyResolverService`; เงินดาวน์: sweep คืน `Cr S21-2001` อยู่แล้วโดยโครงสร้าง — การจ่ายคืนเงินสดจริงเป็นขั้นตอน SHOP แยก (มี `ShopDownPaymentReversalTemplate` รองรับอยู่แล้วสำหรับ flow ก่อน activate — บันทึกใน docs ว่า post-activation ให้ใช้ JV ผ่านหน้าบัญชีจนกว่าจะมี UI เฉพาะ) — **อย่า** auto-จ่ายเงินสด)

- [ ] **Step 5: รันให้ผ่าน + รัน unit เดิม** — `npx jest src/modules/contracts --silent` (spec เก่าที่ mock template เดิมต้องอัปเดต) + integration ใหม่
- [ ] **Step 6: Commit** — `feat(contracts): ยกเลิกสัญญา C-1 — sweep ทั้งชุด + ECL release + guards + restore (Phase 3)`

---

### Task 3: C-2 producer (generic) — redirect เป็น PAYOUT_RECALL

**Files:**
- Modify: `contract-cancellation.template.ts` + `contract-cancellation.service.ts` (C-2 branch)
- Test: `contract-cancellation.integration.spec.ts` (ต่อไฟล์)

**Interfaces:**
- Consumes: sweep redirect (Task 1), Phase 2 batch flow (สร้าง batch POSTED ใน test ผ่าน `IntercoSettlementService` จริง)
- Produces: JE ยกเลิกแบบ C-2 ตรง workbook Case 3A กรณี 2; AuditLog `CONTRACT_CANCELED_AFTER_PAYOUT`

- [ ] **Step 1: Failing tests**

```ts
it('C-2 (ตัดจ่ายแล้ว): redirect เจ้าหนี้เป็น PAYOUT_RECALL ตรง workbook Case 3A กรณี 2', async () => {
  // seed สัญญาปกติ (1A 17,000 + SHOP legs 10,000+1,000) → batch → submit → approve (จ่ายเต็ม 11,000)
  // → void ไม่มี (ยังไม่จ่ายงวด) → approveCancellation
  // FINANCE reversal ของ 1A: Dr 11-2107 11,000 [PAYOUT_RECALL] + Dr 11-2106 6,000 + Dr 21-2102 1,190
  //                          / Cr 11-2101 17,000 + Cr 11-2105 1,190  (ไม่มีขา 21-1101/21-1102)
  // SHOP reversal ของ JE B: มี Cr S21-3001 11,000 [PAYOUT_RECALL] แทน Cr S11-3001/S11-3002
  // GL: 21-1101/21-1102 ของสัญญา = 0 (ไม่ติดลบ!); S11-3001/2 = 0
  // typed PAYOUT_RECALL fin = 11,000; คิวเรียกคืน (หลัง Task 4 จะ net — เทสนี้ปัก gross ไว้ก่อนแล้ว Task 4 มาแก้เป็น net ซึ่งเคสนี้เท่ากัน เพราะ Σ deductions ของสัญญาปกติ = 0)
  // AuditLog CONTRACT_CANCELED_AFTER_PAYOUT + newValue.recallAmount = '11000.00' + batchNumbers
});
it('C-2 cross-check: hand-JV ทำให้ redirect รวม ≠ Σ settled ของ batch POSTED → reject ทั้งการยกเลิก', ...);
```

- [ ] **Step 2: รันให้ fail**

- [ ] **Step 3: Implement — service detect + template branch**

Service: detect ก่อนเรียก template
```ts
      const postedItems = await tx.interCoSettlementItem.findMany({
        where: { contractId: contract.id, deletedAt: null, itemType: 'SETTLEMENT',
          batch: { status: 'POSTED', deletedAt: null } },
        include: { batch: { select: { batchNumber: true } } },
      });
      const settledTotal = postedItems.reduce(
        (s, i) => s.plus(i.financedGl).plus(i.commissionGl), new Prisma.Decimal(0));
      const isC2 = settledTotal.gt(0);
```
Template รับ `{ isC2, settledTotal }` → เมื่อ isC2 ส่ง redirect เข้า sweep:
```ts
        redirects: {
          '21-1101': { to: '11-2107', description: 'ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ยอดจัดที่ตัดจ่ายแล้ว)' },
          '21-1102': { to: '11-2107', description: 'ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ค่าคอมที่ตัดจ่ายแล้ว)' },
          'S11-3001': { to: 'S21-3001', description: 'ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ยอดจัด)' },
          'S11-3002': { to: 'S21-3001', description: 'ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ค่าคอม)' },
        },
        redirectStamp: { shopReceivableType: 'PAYOUT_RECALL' },
```
Cross-check หลัง sweep (carry (a) + กัน hand-JV):
```ts
      const redirected = redirectedTotals['11-2107'] ?? new Prisma.Decimal(0);
      if (redirected.minus(settledTotal).abs().gt('0.01')) {
        throw new BadRequestException(
          `ยอดเรียกคืน (${redirected.toFixed(2)}) ไม่ตรงกับยอดที่ตัดจ่ายใน batch POSTED (${settledTotal.toFixed(2)}) — มีรายการเดินบัญชีผิดปกติ ตรวจสอบก่อนยกเลิก`,
        );
      }
```
(throw ใน tx → sweep rollback ทั้งหมด ✓) AuditLog action `CONTRACT_CANCELED_AFTER_PAYOUT` (entity contract, newValue: recallAmount + batchNumbers + reversalCount); C-1 ใช้ `CONTRACT_CANCELED` เดิม

- [ ] **Step 4: รันให้ผ่าน + Commit** — `feat(contracts): C-2 producer — redirect เจ้าหนี้เป็น PAYOUT_RECALL + cross-check settled (Phase 3)`

---

### Task 4: Phase-2 lens/guards → สูตร net (ปิด carry b)

**Files:**
- Modify: `apps/api/src/modules/interco-settlement/interco-pending.service.ts` (`getPendingRecalls`)
- Modify: `apps/api/src/modules/interco-settlement/interco-settlement.service.ts` (drift RECALL + `alarmNettingResiduals`)
- Test: `interco-netting.integration.spec.ts` (แก้/เพิ่ม)

**Interfaces:**
- Produces: `RecallCandidate.recallGl/shopRecallGl` = **net** (`typed PAYOUT_RECALL − Σ(swapCreditAmount+recallAmount) ของ items ใน batch POSTED ของสัญญา`), HAVING net > 0; drift RECALL เทียบ net; residual alarm = `(typed SWAP_CREDIT + typed PAYOUT_RECALL) − Σ POSTED deductions`

- [ ] **Step 1: Failing tests**

```ts
it('recall queue: สัญญาที่เคยถูกหักเครดิตในรอบเก่า → ยอดเรียกคืน net (11,000 − 8,000 = 3,000)', async () => {
  // seed swap + batch POSTED (หัก 8,000) + synthetic redirect JEs (PAYOUT_RECALL 11,000 fin/shop + SWAP_CREDIT mirror Cr 8,000)
  // — shape ตรงกับผลของ exchange-cancel C-2 (Task 5 จะพิสูจน์ผ่าน flow จริง)
  // expect recallGl = 3,000.00 ทั้งสองสมุด
});
it('recall net → batch รอบถัดไปหัก 3,000 → approve ผ่าน + 11-2107 ทั้งบัญชี = 0 + residual alarm เงียบ', ...);
it('drift RECALL: JE แทรกทำ typed ขยับ → net ≠ recallAmount → reject', ...); // ปรับเทสเดิมเป็นสูตร net
```

- [ ] **Step 2: รันให้ fail** (เทส Phase 2 เดิมของ recall — สัญญาไม่มี prior deductions → net = gross → ต้องผ่านเหมือนเดิมโดยไม่แก้)

- [ ] **Step 3: Implement**

- `getPendingRecalls`: หลังได้ typed rows → โหลด Σ deductions ต่อ contract (`interCoSettlementItem.groupBy`/`findMany` where batch POSTED) → `recallGl = typed − posted`; filter `recallGl > 0.01`; `shopRecallGl` net ด้วยสูตรเดียวกัน
- Drift guard แถว RECALL: `netFin = recallFinanceBalance − ΣpostedDeductions(contract)` เทียบ `item.recallAmount` (Σposted **ไม่รวม batch ปัจจุบัน** — ยัง PENDING) — เขียน comment สูตรพร้อมเหตุผลเคส swap-cancelled
- `alarmNettingResiduals`: `residual = (swapCreditFin + recallFin) − ΣpostedDeductions` ต่อสัญญา (SHOP ฝั่งเดียวกัน) — อัปเดต comment + extras (`typedFinanceGross` = ผลรวมสองประเภท)

- [ ] **Step 4: รันให้ผ่าน (รวมเทส Phase 2 เดิมทั้งไฟล์)** + **Commit** — `fix(interco): recall lens/drift/residual เป็นสูตร net of POSTED deductions (Phase 3 carry b)`

---

### Task 5: exchange-cancel C-2 branch (§5.5) — เทสทองของเฟส

**Files:**
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange-cancel.service.ts`
- Test: `exchange-priced-flow.integration.spec.ts` (เพิ่ม case ใหม่)

**Interfaces:**
- Consumes: sweep redirect (Task 1), detect pattern (Task 3), lens net (Task 4)
- Produces: ยกเลิก swap หลัง batch POSTED ได้ → recall net 3,000 เข้าคิว

- [ ] **Step 1: Failing test — สถานการณ์เต็มจาก "เลขทองของเฟส"**

```ts
it('ยกเลิก swap หลังรอบจ่าย POSTED → PAYOUT_RECALL net 3,000 + GL ทุกบัญชีถูก', async () => {
  // finalize swap (Case 2A fixture) → createBatch([newContract]) → submit → approve (จ่ายสุทธิ 3,000, หัก 8,000)
  // → cancel exchange →
  // - ไม่ throw (เดิมจะ throw ไม่ได้เพราะไม่มี guard — เดิม mirror ตรงทำเจ้าหนี้ติดลบ: RED พิสูจน์)
  // - 21-1101/21-1102 ของสัญญาใหม่ = 0 (ไม่ติดลบ)
  // - 11-2107 ทั้งบัญชี delta สุทธิของสัญญา = 3,000 Dr (เงินที่ต้องเรียกคืนจริง)
  // - typed: SWAP_CREDIT = 0, PAYOUT_RECALL = 11,000 (gross) → getPendingRecalls เห็น 3,000
  // - S21-3001 sym ฝั่ง SHOP; สัญญาเก่า ACTIVE คืน, เครื่องเก่ากลับ FINANCE, costPrice restore (Phase 1)
  // - AuditLog EXCHANGE_CANCELED มี newValue.recallAmount = '3000.00' (net) + window 'AFTER_PAYOUT'
});
it('guard: swap อยู่ใน batch DRAFT/PENDING → reject บอกถอนรอบก่อน', ...);
```

- [ ] **Step 2: รันให้ fail** (test แรกต้อง RED แบบ "เจ้าหนี้ติดลบ/assert fail" — พิสูจน์ gap เดิมมีจริง)

- [ ] **Step 3: Implement ใน finalized-cancel path**

- Guard เปิด: query openItem (DRAFT/PENDING_APPROVAL — pattern Task 2) ของ newContractId → reject
- Detect: postedItems SETTLEMENT ของ newContractId (pattern Task 3) → `isC2`, `settledTotal` (financedGl+commissionGl), `settledDeductions` (swapCreditAmount)
- เรียก `reversalTemplate.reverse` เดิม แต่เมื่อ isC2 เพิ่ม `redirects` + `redirectStamp` ชุดเดียวกับ Task 3 (flowLabel/descriptionPrefix คงของ exchange เดิม)
- Cross-check: `redirectedTotals['11-2107'] == settledTotal ±0.01` → ไม่ตรง reject
- `markCanceled` เพิ่มข้อมูล: `cancelWindow: isC2 ? 'AFTER_PAYOUT' : window` + audit `newValue.recallAmount = settledTotal.minus(settledDeductions).toFixed(2)` (net — เงินสดที่ต้องเรียกคืนจริง)
- **ห้ามแตะ** MEMO / PRE_FINALIZE paths และ restore states เดิม (Phase 1 costPrice restore ต้องยังทำงาน)

- [ ] **Step 4: รันให้ผ่านทั้งไฟล์ exchange + interco-netting + Commit** — `feat(exchange): cancel หลังตัดจ่าย (C-2) — redirect PAYOUT_RECALL + guard batch เปิด (Phase 3)`

---

### Task 6: เส้นทางรับเงินสดคืน (cash recall)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-collect-settlement.template.ts` (optional `typeStamp`)
- Create: SHOP leg ภายใน `interco-settlement.service.ts` (method `settleRecallCash`) — ไม่สร้าง template ใหม่ถ้า JE เล็ก (2 บรรทัด ผ่าน `journalAuto.createAndPost` + `PairedJournalService` ไม่จำเป็น — สองใบใน tx เดียว)
- Modify: `interco-settlement.controller.ts` (+DTO ใหม่ `settle-recall-cash.dto.ts`)
- Test: `interco-netting.integration.spec.ts`

**Interfaces:**
- Produces: `POST /interco-settlement/recalls/:contractId/settle-cash` (Roles OWNER, FINANCE_MANAGER; body `{ amount, financeDepositAccountCode, shopPayoutAccountCode?, requestId }`):
  - FINANCE: reuse `ShopCollectSettlementTemplate.execute` + param ใหม่ `typeStamp: 'PAYOUT_RECALL'` (default `'SHOP_COLLECT'` — caller เดิมไม่เปลี่ยน) → `Dr <cash> / Cr 11-2107` stamped PAYOUT_RECALL + contractId
  - SHOP: `Dr S21-3001 [amount] / Cr <shopPayoutAccountCode default 'S11-1201'>` metadata `{ flow: 'interco-recall-cash-shop', idempotencyKey: requestId+':SHOP', contractId, shopReceivableType: 'PAYOUT_RECALL' }`
  - Guard: `amount ≤ recallGl net ของคิว ±0.01` + สัญญาไม่อยู่ใน batch เปิด (RECALL item)
- typed lens หลัง settle เต็มจำนวน: PAYOUT_RECALL fin = 11,000 − 3,000(settle) = 8,000 → net = 8,000 − 8,000(ΣPOSTED) = 0 → หลุดคิว ✓ (เทสต้องพิสูจน์เลขนี้)

- [ ] **Step 1: Failing tests** — settle เต็ม → คิวว่าง + GL 11-2107/S21-3001 ของสัญญา = 0 ทั้งบัญชี; settle เกิน → reject; Phase-2 gate (ii) ยังทำงาน (สัญญามี RECALL item ใน batch PENDING → reject)
- [ ] **Step 2: RED → Implement → GREEN** (ระวัง: `typeStamp` default ต้องไม่เปลี่ยนพฤติกรรม JP4/shop-collect เดิม — รัน `shop-collect-*.integration.spec.ts` ทั้งสองไฟล์ยืนยัน)
- [ ] **Step 3: Commit** — `feat(interco): รับเงินสดคืนจากหน้าร้าน (recall cash settle สองสมุด, Phase 3)`

---

### Task 7: UI — C-1/C-2 บนหนายกเลิก + ปุ่มรับเงินสดคืน

**Files:**
- Modify: `apps/web/src/pages/finance/ContractCancellationPage.tsx` (คิวอนุมัติยกเลิก)
- Modify: `apps/web/src/pages/interco/PendingTab.tsx` (ปุ่ม "รับเงินสดคืน" ใน recall section + dialog เล็ก)
- Modify: `apps/web/src/pages/interco/types.ts` (ถ้า API เพิ่ม field)
- Test: web unit ที่มีของสองหน้า

**สิ่งที่ต้องได้:**
1. API `listPendingCancellations` เพิ่มต่อแถว: `settledInBatch: boolean` + `recallAmount: string | null` (จาก postedItems query — service side ใน Task 3 ทำ detection แล้ว expose เพิ่ม) → หน้า approve โชว์ badge **"ตัดจ่ายแล้ว — จะตั้งเรียกคืน ฿X"** (variant warning) กับ **"ยังไม่ตัดจ่าย — กลับรายการทั้งชุด"** (secondary) + confirm dialog ระบุผลทางบัญชี
2. Recall section (PendingTab): ปุ่ม "รับเงินสดคืน" ต่อแถว → dialog เลือกบัญชีรับเงิน (constants cash accounts เดิม) + ยอด (default = net) → POST settle-cash → invalidate + toast
3. กติกา FE เดิมทั้งหมด (fmtMoney, tokens, ไทย, react-query)

- [ ] **Steps: types/API expose → RED (test POST body + badge) → implement → GREEN → Commit** — `feat(ui): หน้ายกเลิกโชว์ C-1/C-2 + ปุ่มรับเงินสดคืน recall (Phase 3)`

---

### Task 8: Docs + verification รวม

**Files:** `.claude/rules/accounting.md`, spec §5 sync

- [ ] **Step 1: accounting.md** — หัวข้อใหม่ "ยกเลิกสัญญา (Flow C — Phase 3)": กติกา D3, C-1 sweep+exclude ECL flows+release ใบเดียว, C-2 redirect (ตาราง account map + stamp PAYOUT_RECALL) + cross-check settled, เลขทองยกเลิก swap (net 3,000) + สูตร net ของ recall lens/drift/residual (แก้ของ Phase 2 ที่เขียนไว้เป็น gross — ระบุว่าแก้เพราะเคสยกเลิก swap), cash recall สองสมุด, AuditLog actions ใหม่, carry ที่ปิดแล้ว (a)(b) + carry คงเหลือไป Phase 4 (TOCTOU, A.3-only post-snapshot — reconcile cron)
- [ ] **Step 2: spec §5 + §4.7 sync** — annotate `[implemented]` + แก้จุดที่ต่างของจริง
- [ ] **Step 3: Verification รวม**
```bash
./tools/check-types.sh all
cd apps/api && npx jest src/modules/contracts src/modules/contract-exchange src/modules/interco-settlement src/modules/journal --silent
cd apps/api && npx vitest run src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts src/modules/contracts/shop-collect-settlement.integration.spec.ts src/modules/contracts/shop-collect-payoff.integration.spec.ts --no-file-parallelism
cd apps/web && npx vitest run src --silent
```
- [ ] **Step 4: ตรวจ CI glob** — `contract-cancellation.integration.spec.ts` อยู่ `src/modules/contracts/__tests__/` — **เช็คว่า glob ใน deploy-gcp.yml ครอบหรือไม่** (มี glob `src/modules/contracts/*.integration.spec.ts` หรือเปล่า? ไฟล์ shop-collect อยู่ตรง `src/modules/contracts/` ไม่มี `__tests__` — ถ้า glob ไม่ครอบ subdir ให้เพิ่ม glob `src/modules/contracts/__tests__/*.integration.spec.ts` — บทเรียน jp5-vat-split)
- [ ] **Step 5: Commit** — `docs(rules): Flow C ยกเลิกสัญญา + สูตร net recall (Phase 3)`

---

## Self-Review Notes

- **Spec §5 coverage:** §5.1 → Task 2 guards (+Task 5 exchange guard); §5.2 → Tasks 1-2; §5.3 → Task 2; §5.4 → Tasks 3+4+6; §5.5 → Task 5 ✓; carry (a) → detection = POSTED item (Task 3/5); carry (b) → Task 4
- **เลขทอง 3,000 สอดคล้องทุกชั้น:** redirect 11,000 − ΣPOSTED 8,000 = queue 3,000 = drift net = residual 0 หลังหัก = cash settle เต็มแล้วหลุดคิว — Tasks 3/4/5/6 ปักเลขชุดเดียวกัน
- **ลำดับ:** 1→2→3→4→5→6→7→8 (Task 5 ต้องมาหลัง 4 เพราะปัก net ในคิว; Task 6 หลัง 4 เพราะ guard ใช้ net)
- **Type consistency:** `redirectedTotals` (Task 1) ใช้ใน Task 3/5; `settledTotal/settledDeductions` ชื่อเดียวกัน; `typeStamp` (Task 6) default `'SHOP_COLLECT'`
- **ความเสี่ยงที่รู้:** เทส C-2 ปกติ (Task 3) ปัก recall gross = net (Σ deductions = 0) — Task 4 ไม่ทำให้แตก; unit spec เดิมของ cancellation template (ถ้า mock 1A lookup) จะแตกที่ Task 2 — plan สั่งอัปเดตแล้ว
