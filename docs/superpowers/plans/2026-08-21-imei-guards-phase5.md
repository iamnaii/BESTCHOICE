# Device Swap Workbook — Phase 5 Implementation Plan (IMEI/สถานะสินค้า + carries ปิดท้าย)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดช่องที่เครื่องเดียวไปอยู่สองสัญญา/ขายซ้ำได้จริง + ทำให้เครื่องมือสองที่รับคืนมาขายต่อได้ตามเส้นทางที่ตั้งใจ + เก็บ carries ที่ค้างจาก Phase 4 (spec §7 + คำตัดสินเจ้าของ 2026-08-21)

**Architecture:** guard ที่จุดเดียวกับที่ข้อมูลเปลี่ยน (delete/activate/finalize) ไม่สร้าง state machine กลางใหม่; ปุ่ม "นำเข้าคลังพร้อมขาย" เป็น endpoint เฉพาะ + audit; carries ของ Phase 4 เป็นงานต่อยอดบน service ที่มีอยู่

**Tech Stack:** NestJS + Prisma, jest (unit) + vitest `--no-file-parallelism` (integration, DB จริง), React

**Base:** branch `feat/imei-guards-phase5` (แตกจาก main `45a43a451` — Phases 1-4 merged)

## สิ่งที่ค้นพบจากโค้ดจริง (แก้ข้อสมมติของ spec §7 — อ่านก่อนเริ่ม)

1. **IMEI ซ้ำข้ามแถวสินค้า = เป็นไปไม่ได้อยู่แล้ว** — migration `20260525200000_product_imei_partial_unique` สร้าง `products_imei_serial_active_unique ON products(imei_serial) WHERE deleted_at IS NULL` ⇒ spec §7 ข้อ 1 ในความหมาย "สองแถวสินค้า IMEI เดียวกัน" ถูกกันที่ระดับ DB แล้ว
2. **แต่รูจริงอยู่ที่การลบ**: `ProductsService.remove()` (`products.service.ts:253-259`) soft-delete โดย **ไม่เช็คอะไรเลย** — ลบเครื่องที่ `SOLD_INSTALLMENT` (อยู่ในสัญญาที่ยัง ACTIVE) ได้ และการลบ **ปลด IMEI ให้ว่าง** (index กรอง `deleted_at IS NULL`) ⇒ รับ IMEI เดิมเข้าสต็อกใหม่แล้วขาย/จัดไฟแนนซ์ซ้ำได้ทั้งที่สัญญาแรกยังเดิน = เคสที่ workbook ห้าม
3. **Activation ไม่เช็ค `deletedAt`** — `contract-workflow.service.ts:388` และ `:427` ใช้ `findUnique({ where: { id } })` เฉย ๆ ⇒ สินค้าที่ถูก soft-delete แต่สถานะยัง `RESERVED` เปิดสัญญาได้
4. **`REFURBISHED` ขายที่ POS ไม่ได้** — `sale-writer.service.ts:125` รับเฉพาะ `IN_STOCK`; เครื่องคืนจากเปลี่ยนเครื่อง (`contract-exchange.service.ts:464,933`) และเครื่องยึดที่พร้อมขาย (`repossessions.service.ts:1001`) ถูกตั้งเป็น `REFURBISHED` ⇒ วันนี้ต้องเข้าไปแก้สถานะเองที่หน้าสินค้า (ทำได้เพราะ `REFURBISHED` ไม่อยู่ใน `SYSTEM_MANAGED_STATUSES`) โดยไม่มีร่องรอยว่าใครเอาเข้าคลังเมื่อไร
5. เครื่องยึดมีเส้นทางขายของตัวเอง (`repossessions.service.ts:893-894`: `READY_FOR_SALE → REFURBISHED`, `SOLD → SOLD_RESELL`) — **ไม่ต้องแตะ**

## คำตัดสินเจ้าของ (2026-08-21)

**เครื่องมือสองที่รับคืนมา → "มีปุ่มให้หน้าร้านกดเอง"**: เพิ่มปุ่ม "นำเข้าคลังพร้อมขาย" ที่หน้าสินค้า (REFURBISHED → IN_STOCK + audit ว่าใคร/เมื่อไร) — **POS คงกติกาเดิม (ขายเฉพาะ `IN_STOCK`)** เพราะมีจังหวะตรวจสภาพ/ตั้งราคาก่อนขาย ไม่ใช่ปล่อยขายทันทีที่รับคืน

## Global Constraints

- Error/UI ภาษาไทย; เงิน `Decimal`; soft-delete เท่านั้น (ห้าม hard delete)
- **ห้ามแตะเส้นทางเงินของ Phase 1-4** ยกเว้นที่ระบุใน Task 5
- ห้ามสร้าง state-machine กลางใหม่ (guard ที่จุดที่ข้อมูลเปลี่ยนเท่านั้น — บทเรียน: refactor ใหญ่เพิ่มความเสี่ยงโดยไม่จำเป็น)
- ทุก guard ต้องบอก**ทางออก**ในข้อความ (เช่น "ยกเลิกสัญญา/ยึดเครื่องก่อน") ไม่ใช่แค่ปฏิเสธ
- vitest integration `--no-file-parallelism` เสมอ; subagent ใช้ model opus (Fable ชนลิมิต — คำสั่งเจ้าของ 2026-08-21)
- Migration: เฟสนี้**ไม่ควรมี** — ถ้าจำเป็นต้องมีให้ additive + timestamp ใหม่สุด + เหตุผลใน report

---

### Task 1: Guard การลบสินค้า (ปิดห่วงโซ่ขายซ้ำ)

**Files:**
- Modify: `apps/api/src/modules/products/products.service.ts` (`remove`)
- Test: `apps/api/src/modules/products/__tests__/product-delete-guard.spec.ts` (jest ใหม่ — ถ้ามี spec ของ products อยู่แล้วให้ต่อไฟล์เดิม)

**Interfaces:** `remove(id)` throw `BadRequestException` ภาษาไทยเมื่อเครื่องยัง "ถูกถือครอง"

- [ ] **Step 1: เขียน failing tests**

```ts
it('ลบไม่ได้เมื่อสถานะ SOLD_INSTALLMENT (อยู่ในสัญญา)', ...);       // ข้อความต้องบอกให้ยกเลิกสัญญา/ยึดเครื่องก่อน
it('ลบไม่ได้เมื่อสถานะ RESERVED (ติดจอง)', ...);                    // บอกให้ยกเลิกจองก่อน
it('ลบไม่ได้เมื่อมีสัญญาที่ยังไม่จบอ้างอิงอยู่ แม้สถานะจะเป็น IN_STOCK', ...); // สถานะเพี้ยนก็ต้องกัน
it('ลบได้เมื่อ IN_STOCK และไม่มีสัญญาค้าง', ...);
it('ลบได้เมื่อ SOLD_CASH (ขายจบแล้ว — IMEI กลับมาใหม่ได้ตามเจตนา T5-C12)', ...);
```

- [ ] **Step 2: รันให้ fail** — `cd apps/api && npx jest src/modules/products --silent`

- [ ] **Step 3: Implement**

```ts
  /** สถานะที่แปลว่า "เครื่องยังถูกถือครองอยู่" — ลบไม่ได้ (จะปลด IMEI ให้ว่างทั้งที่ของยังผูกอยู่) */
  private static readonly HELD_STATUSES: ReadonlySet<ProductStatus> = new Set([
    ProductStatus.RESERVED,
    ProductStatus.SOLD_INSTALLMENT,
    ProductStatus.REPOSSESSED,
  ]);

  async remove(id: string) {
    const product = await this.findOne(id);
    if (ProductsService.HELD_STATUSES.has(product.status)) {
      throw new BadRequestException(
        `สินค้าอยู่สถานะ ${product.status} — ลบไม่ได้เพราะยังผูกกับรายการที่เดินอยู่ ` +
          'ให้จัดการผ่าน flow นั้นก่อน (ยกเลิกจอง / ยกเลิกสัญญา / ยึดเครื่อง / ขายต่อ) แล้วค่อยลบ',
      );
    }
    // กันสถานะเพี้ยน: สินค้าอาจเป็น IN_STOCK ทั้งที่ยังมีสัญญาค้างอยู่ (ข้อมูลเก่า/JV มือ)
    const liveContract = await this.prisma.contract.findFirst({
      where: {
        productId: id,
        deletedAt: null,
        status: { notIn: ['CANCELED', 'COMPLETED', 'CLOSED_BAD_DEBT', 'EXCHANGED'] },
      },
      select: { contractNumber: true, status: true },
    });
    if (liveContract) {
      throw new BadRequestException(
        `สินค้ายังผูกกับสัญญา ${liveContract.contractNumber} (สถานะ ${liveContract.status}) — ` +
          'ปิด/ยกเลิกสัญญาก่อนจึงจะลบสินค้าได้',
      );
    }
    return this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  }
```
**หมายเหตุ implementer:** ตรวจค่า enum `ContractStatus` จริงใน `schema.prisma` ก่อนใส่ `notIn` (ชื่อสถานะต้องตรง — ถ้ามีสถานะอื่นที่แปลว่า "จบแล้ว" ให้เพิ่ม และเขียนเหตุผลใน report). อย่าใช้ list "สถานะที่ยังเดิน" แบบ include เพราะสถานะใหม่ในอนาคตจะหลุด guard เงียบ ๆ

- [ ] **Step 4: GREEN + `./tools/check-types.sh api`**
- [ ] **Step 5: Commit** — `fix(products): กันลบสินค้าที่ยังถูกถือครอง (ปิดช่องปลด IMEI แล้วขายซ้ำ, Phase 5)`

---

### Task 2: Activation/finalize ต้องไม่รับสินค้าที่ถูกลบ

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts` (~`:388` pre-tx และ `:427` in-tx)
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` (จุดที่ใช้ `newProductId` ตอน approve/finalize — หา `findUniqueOrThrow`/`findUnique` ของ product แล้วเติมเงื่อนไข)
- Test: integration `apps/api/src/modules/contracts/__tests__/` (ต่อไฟล์ที่มี หรือสร้าง `product-guard.integration.spec.ts`)

- [ ] **Step 1: Failing tests**

```ts
it('เปิดสัญญาไม่ได้ถ้าสินค้าถูกลบไปแล้ว (deletedAt ≠ null) แม้สถานะยัง RESERVED', ...);
it('finalize เปลี่ยนเครื่องไม่ได้ถ้าเครื่องใหม่ถูกลบ', ...);
```

- [ ] **Step 2: RED → Implement** — เปลี่ยน lookup ทั้งสองจุดของ activation เป็น
```ts
    const product = await this.prisma.product.findFirst({
      where: { id: contract.productId, deletedAt: null },
    });
```
(และ in-tx เช่นกัน) — ข้อความเดิม "สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)" ครอบอยู่แล้ว ไม่ต้องเปลี่ยน; ฝั่ง exchange ใช้เงื่อนไขเดียวกัน + ข้อความไทยของมันเอง

- [ ] **Step 3: GREEN + รัน** `npx jest src/modules/contracts src/modules/contract-exchange --silent` + integration ที่แตะ
- [ ] **Step 4: Commit** — `fix(contracts): เปิดสัญญา/เปลี่ยนเครื่องต้องไม่รับสินค้าที่ถูกลบ (Phase 5)`

---

### Task 3: ปุ่ม "นำเข้าคลังพร้อมขาย" (REFURBISHED → IN_STOCK + audit)

**Files:**
- Modify: `apps/api/src/modules/products/products.service.ts` (method ใหม่), `products.controller.ts` (route ใหม่)
- Modify: `apps/api/src/modules/products/product-status.util.ts` (ปิดทางแก้มือ — ดู Step 3)
- Modify: หน้าสินค้าฝั่ง web (หา component รายละเอียดสินค้าจริงก่อน — ปุ่ม + confirm dialog + invalidate)
- Test: jest service/controller + web unit ของหน้าที่แก้

**Interfaces:** `POST /products/:id/return-to-stock` body `{ note?: string }` — Roles `OWNER`, `BRANCH_MANAGER`

- [ ] **Step 1: Failing tests**

```ts
it('REFURBISHED → IN_STOCK สำเร็จ + เขียน AuditLog PRODUCT_RETURNED_TO_STOCK (มี userId/สถานะเดิม/note)', ...);
it('สถานะอื่น (IN_STOCK/SOLD_INSTALLMENT/DAMAGED) → reject ภาษาไทย', ...);
it('สินค้าที่ถูกลบ → reject', ...);
it('เตือน/ไม่ให้ผ่านเมื่อไม่มีราคาขาย (ตัดสินเอง: block หรือ allow+flag) — เขียนเหตุผลใน report', ...);
it('PATCH /products/:id เปลี่ยน REFURBISHED → IN_STOCK ตรง ๆ ไม่ได้อีกต่อไป (ต้องใช้ปุ่ม)', ...);
```

- [ ] **Step 2: RED → Implement service+controller**

```ts
  /**
   * นำเครื่องมือสองที่รับคืนมา (เปลี่ยนเครื่อง/ยึด) กลับเข้าคลังพร้อมขาย — คำตัดสินเจ้าของ 2026-08-21:
   * ต้องกดยืนยันจากหน้าสินค้า ไม่ใช่ขายจาก REFURBISHED ได้ทันที เพราะมีจังหวะตรวจสภาพ/ตั้งราคาก่อน
   * POS ยังขายเฉพาะ IN_STOCK ตามเดิม (sale-writer.service.ts) — endpoint นี้คือสะพานเดียวที่บันทึกร่องรอย
   */
  async returnToStock(id: string, userId: string, note?: string) { ... }
```
- guard: `deletedAt: null` + `status === 'REFURBISHED'` เท่านั้น (ข้อความไทยบอกสถานะปัจจุบัน + ทางที่ถูก)
- update สถานะ + `AuditLog { action: 'PRODUCT_RETURNED_TO_STOCK', entity: 'product', entityId: id, oldValue: { status }, newValue: { status: 'IN_STOCK', note } }` **ใน `$transaction` เดียว** (ดู pattern audit ของโมดูลข้างเคียง — products ยังไม่มี AuditService ใช้ตรง ให้ใช้ `tx.auditLog.create` แบบเดียวกับ `contract-cancellation.service.ts`)

- [ ] **Step 3: ปิดทางแก้มือ** — `product-status.util.ts`: เพิ่ม `REFURBISHED` เข้า `SYSTEM_MANAGED_STATUSES` **ถ้าทำได้โดยไม่ตัดเส้นทางที่ใช้จริง** — ตรวจก่อนว่ามี flow ไหนตั้ง/ปลด REFURBISHED ด้วยมือบ้าง (เช่น DAMAGED → REFURBISHED หลังซ่อม); ถ้ามี ให้ใช้กติกาแคบกว่า: ห้ามเฉพาะ `REFURBISHED → IN_STOCK` ผ่าน PATCH (บอกให้ใช้ปุ่ม) และคง transition อื่นไว้ + คอมเมนต์อธิบาย **ตัดสินเองแล้วเขียนเหตุผลใน report**
- [ ] **Step 4: UI** — ปุ่มบนหน้ารายละเอียดสินค้า แสดงเฉพาะเมื่อสถานะ REFURBISHED + role ผ่าน; ConfirmDialog ภาษาไทยอธิบายผล ("เครื่องจะพร้อมขายที่ POS"); `toast.success` + `invalidateQueries`; กติกา FE เดิม (tokens/ไทย/leading-snug/shadcn)
- [ ] **Step 5: GREEN ทุก suite + `./tools/check-types.sh all`**
- [ ] **Step 6: Commit** — `feat(products): ปุ่มนำเข้าคลังพร้อมขายสำหรับเครื่องมือสองที่รับคืน (Phase 5)`

---

### Task 4: Integration — พิสูจน์ state diagram ของ workbook

**Files:** `apps/api/src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts` (ใหม่ — prefix `LIFECYCLETEST-`)

เทสต์ที่ต้องมี (ทุกตัวผ่าน flow จริง ไม่ใช่ synthetic update):

```ts
it('เครื่องเดียวเปิดสองสัญญาพร้อมกันไม่ได้ (สัญญาที่สองแพ้ตอน activate)', ...);
it('ขายซ้ำไม่ได้: ขายสด IN_STOCK → SOLD_CASH แล้วขายอีกครั้งถูกปฏิเสธ', ...);
it('ห่วงโซ่ที่ปิดใน Task 1-2: ลบเครื่องที่อยู่ในสัญญา ACTIVE ไม่ได้ ⇒ รับ IMEI เดิมเข้าใหม่ไม่ได้ (unique index) ⇒ ขายซ้ำไม่ได้', ...);
it('เปลี่ยนเครื่อง: เครื่องเก่า → REFURBISHED, กดปุ่มนำเข้าคลัง → IN_STOCK, ขาย POS ได้', ...);
it('ยึดเครื่อง: SOLD_INSTALLMENT → REPOSSESSED → REFURBISHED → ขายผ่านเมนูยึด → SOLD_RESELL', ...);
```

- [ ] **Steps: RED (เขียนก่อน Task 1-3 เสร็จก็ได้ แต่รันหลัง) → GREEN → Commit** — `test(products): state diagram เครื่อง — เปิดสัญญา/ขายซ้ำ/คืนเครื่อง/ยึด (Phase 5)`
- [ ] **CI glob:** ตรวจว่า `src/modules/contracts/__tests__/*.integration.spec.ts` ถูกครอบ (Phase 3 เพิ่มไว้แล้ว) — ยืนยันใน report

---

### Task 5: Carries จาก Phase 4

**Files:** `interco-aging.service.ts`, `interco-settlement.controller.ts`, `contract-cancellation.service.ts`, UI แท็บ aging, `interco-reconcile.cron.ts`

ทำ 4 ข้อ (เรียงตามคุณค่า):

1. **หน้าจอสำหรับ finding ที่ยังไม่มีที่ให้ดู** — `GET /interco-settlement/shop-receivable-aging?view=pairing|negative` (หรือ endpoint แยก ตามที่สะอาดกว่า) คืน `getPayablePairing()` (เฉพาะ `mismatch`) และ `getNegativeTypedRows()` + section/แท็บย่อยใน UI — ปิดช่องที่ Todo บอกว่า "ใช้ข้อมูลในใบนี้" เพราะไม่มีที่ให้ดู
2. **`approveCancellation` เป็น Serializable + P2034 → 409** (pattern เดียวกับ `approveBatch`/`settleRecallCash` รวม log/Sentry) + test race 2 connections
3. **M1: แถวที่ hydrate สัญญาไม่ได้** — `buildAllRows` ปัจจุบัน `continue` ทิ้งเงียบ ๆ ขณะที่ `getPayablePairing` แสดงเป็น `(ไม่พบสัญญา)` → ทำให้สองที่สอดคล้องกัน (แสดงแทนที่จะทิ้ง) + test
4. **ปุ่ม/endpoint สั่งรัน reconcile เอง** — `POST /interco-settlement/reconcile/run` (OWNER/FM) เรียก `tick()` ตรง คืนสรุป findings (ไม่ต้องรอวันที่ 1) + ปุ่มในแท็บ aging; **ต้องกัน Todo ซ้ำด้วย dedup เดิม**

- [ ] **Steps ต่อข้อ: RED → implement → GREEN**; รัน `npx jest src/modules/interco-settlement src/modules/contracts --silent` + integration interco/aging/cancellation ทุกครั้ง
- [ ] **Commit** (แยกได้ตามข้อ) — เช่น `feat(interco): หน้าจอคู่เจ้าหนี้ไม่ตรง/ยอดติดลบ + สั่งรันกระทบยอดเอง (Phase 5 carries)`

**ไม่ทำในเฟสนี้ (บันทึกเหตุผล):** P2034 translation ที่ payment path — แตะเส้นทางเงินหลักโดยยังไม่มีสัญญาณจริง; เกณฑ์คือรอ Sentry `[interco] P2034 …` spike ตาม runbook ของ Phase 4

---

### Task 6: Docs + verification รวม

**Files:** `.claude/rules/accounting.md` (หรือ `.claude/rules/database.md` ถ้าเหมาะกว่า — ตัดสินเอง), spec §7 sync

- [ ] **Step 1: Docs** — หัวข้อ "สถานะสินค้า & IMEI (Phase 5)": partial-unique index บน IMEI (active rows) + เหตุผล T5-C12, guard การลบ (สถานะที่ห้าม + สัญญาค้าง) พร้อมเหตุผลว่าทำไมการลบเคยเป็นช่องขายซ้ำ, ปุ่มนำเข้าคลัง (คำตัดสินเจ้าของ + ทำไม POS ยังขายเฉพาะ IN_STOCK), state diagram ของ workbook เทียบสถานะจริงในระบบ, carries ที่ปิดในเฟสนี้ + ที่เหลือ
- [ ] **Step 2: spec §7 sync** — `[implemented]` + **ระบุให้ชัดว่าข้อสมมติเดิมของ spec ต่างจากความจริง** (IMEI ซ้ำถูกกันด้วย index อยู่แล้ว; รูจริงคือ delete + activation ไม่เช็ค deletedAt; REFURBISHED ขาย POS ไม่ได้)
- [ ] **Step 3: Verification**

```bash
./tools/check-types.sh all
cd apps/api && npx jest src/modules/products src/modules/contracts src/modules/contract-exchange src/modules/interco-settlement src/modules/sales --silent
cd apps/api && npx vitest run src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts src/modules/interco-settlement/__tests__/interco-aging.integration.spec.ts src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts --no-file-parallelism
cd apps/web && npx vitest run src --silent
```
Failure ที่ไม่เกี่ยว Phase 5 → บันทึก ห้ามแก้เอง (known flake: `AssetsListPage.statcards`)

- [ ] **Step 4: Commit** — `docs(rules): สถานะสินค้า/IMEI + guard การลบ + ปุ่มนำเข้าคลัง (Phase 5)`

---

## Self-Review Notes

- **Spec §7 coverage:** ข้อ 1 → Tasks 1-2 (ตีความใหม่ตามความจริงของ DB); ข้อ 2 → Task 3 + POS เดิมที่ guard อยู่แล้ว; ข้อ 3 → Task 4 (พิสูจน์ด้วยเทสต์แทน state machine กลาง); ข้อ 4 → Task 4
- **ลำดับ:** 1 → 2 → 3 → 4 (พิสูจน์ 1-3) → 5 (อิสระ) → 6; Task 5 สลับขึ้นก่อนได้ถ้าอยากปิด carries เร็ว
- **ความเสี่ยงที่รู้:** (ก) `HELD_STATUSES` + `notIn` ของสถานะสัญญาต้องตรวจกับ enum จริงก่อน ไม่งั้นกันเกิน/กันขาด; (ข) เพิ่ม `REFURBISHED` เข้า `SYSTEM_MANAGED_STATUSES` อาจตัด transition ที่ใช้จริง (DAMAGED→REFURBISHED หลังซ่อม) — Task 3 Step 3 สั่งให้ตรวจก่อนตัดสิน; (ค) Task 5 ข้อ 2 แตะ tx ของการยกเลิกสัญญา — ต้องรัน cancellation integration ทั้งไฟล์ยืนยัน
