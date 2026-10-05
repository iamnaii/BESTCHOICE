# การจอง / มัดจำ — PR 2: ล็อกเครื่องเมื่อรับมัดจำ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เมื่อรับมัดจำ ใบจองล็อกเครื่องที่ผูกไว้ (`Product.status = RESERVED` + `Booking.lockedProductId`) จนกว่าจะขาย / ยกเลิก / หมดอายุ — ทั้งหมดใน transaction เดียวกับการรับเงิน ไม่มีการรับเงินโดยไม่ล็อก และไม่มีล็อกค้างหลังใบปิด

**Architecture:** ล็อก = compare-and-set บน `product.updateMany({ where: { id, status: 'IN_STOCK', branchId, deletedAt: null }, data: { status: 'RESERVED' } })` ใน `payDeposit` (แทนการอ่านอย่างเดียวของ PR 1) + เขียน `Booking.lockedProductId/lockedAt` + partial unique index กันเครื่องเดียวถูกล็อกโดยหลายใบ · ปลด = `updateMany({ where: { id: lockedProductId, status: 'RESERVED' }, data: { status: 'IN_STOCK' } })` ใน `cancel`/`autoExpire` (count 0 ไม่ throw — audit `BOOKING_UNLOCK_SKIPPED` + Sentry) · `convertToSale` claim จาก `RESERVED` เมื่อเครื่องเป็นของใบนี้ (ใบ PAID ยุคก่อนล็อกยัง claim จาก `IN_STOCK`) · POS/สัญญา/ของแถม ปฏิเสธ `RESERVED` อยู่แล้ว (`assertSaleProductEligible`) · `POST /products/:id/unreserve` ต้องปฏิเสธเครื่องที่ใบจองล็อก · ฝั่งเว็บ: แผงรายละเอียดรู้จัก "ล็อกไว้ให้ลูกค้ารายนี้แล้ว" (ปิดรอยรั่วที่ PR 1 ถือ RESERVED = ไม่พร้อมเสมอ) · ไม่มี JE ใหม่ (สินค้าคงคลัง S11-200x ไม่เปลี่ยนจนกว่าจะขาย — spec §7)

**Tech Stack:** NestJS + Prisma + PostgreSQL (`apps/api`), React 18 + Vite + Tailwind + shadcn/ui (`apps/web`), jest (`--runInBand`) + vitest integration (DB จริง) + Playwright

**Spec:** `docs/superpowers/specs/2026-10-05-bookings-redesign-design.md` — §2 ข้อ 1, §4 (กติกาและสถานะ), §5.1, §5.5, §6.1 (`pay-deposit`/`cancel`/`convert`), §7, §12 (PR 2) · ต่อจาก PR 1 = PR #1676 (`feat/bookings-redesign`)

**สาขาและฐาน:** สร้างสาขา `feat/bookings-lock` จาก `origin/main` **หลัง #1676 merge** · ถ้ายังไม่ merge ตอนเริ่ม ให้แตกจาก `feat/bookings-redesign` แล้ว rebase ลง main ก่อนเปิด PR (ห้าม merge stacked PR โดยไม่ retarget base → main) · worktree เดิม `~/Desktop/App/BESTCHOICE-bookings-redesign` ใช้ต่อได้ (`git checkout -b feat/bookings-lock origin/main`)

## Global Constraints

- **ข้อความ error ตาม spec §4 ตรงตัวอักษร:** ล็อกไม่สำเร็จ → `ConflictException('เครื่องนี้ถูกขายหรือย้ายสาขาไปแล้ว กรุณาแก้ใบจองเลือกเครื่องอื่นก่อนรับมัดจำ')` · ธุรกรรมทั้งก้อน rollback (ไม่มีการรับเงินโดยไม่ล็อก)
- **ล็อกเฉพาะตอนรับมัดจำ** — ใบ `PENDING_DEPOSIT` ไม่ล็อก (คำตัดสินเจ้าของข้อ 1) · ใบที่ไม่มีแถวรายการ (ยุคก่อน PR 1) รับมัดจำได้โดยไม่ล็อก (`lockedProductId` ว่าง)
- **ปลดล็อกไม่ผ่าน `product-enter-stock.util`** โดยตั้งใจ (คลาสเดียวกับปลดจองของแถม — เครื่องเป็น IN_STOCK มีราคาอยู่ก่อน) · ต้องเพิ่มบรรทัดในรายการข้อยกเว้นที่หัวไฟล์ `apps/api/src/modules/products/product-enter-stock.util.ts`
- **ปลดล็อก count = 0 ไม่ throw**: audit `BOOKING_UNLOCK_SKIPPED` (ใน tx) + `Sentry.captureMessage` ระดับ warning tag `module: 'booking-lock'` **หลัง commit** (ห้ามเรียก Sentry/`AuditService.log` ใน tx — `.claude/rules/database.md`)
- **หนึ่งล็อกต่อหนึ่งเครื่อง:** partial unique index `bookings_locked_product_active_unique ON bookings(locked_product_id) WHERE locked_product_id IS NOT NULL AND deleted_at IS NULL` (raw SQL ใน migration + คอมเมนต์ `///` ใน schema แบบ `ProductReservation`) · CAS บน `status: 'IN_STOCK'` เป็นด่านแรก index เป็นตาข่าย (P2002 → 409 ข้อความเดียวกัน)
- **`lockedProductId` ล้างทุกทางออก** (ยกเลิก / หมดอายุ / ขาย) · `lockedAt` คงไว้เป็นหลักฐาน · `unlockedAt` ตั้งทุกทางออก — ไม่งั้นใบ CONVERTED ถือ index ของเครื่องตลอดไป และใบจองใบใหม่ของเครื่องเดิม (หลัง void ใบขาย) จะชน unique
- **ไม่มี JE ใหม่ · ไม่แตะ template บัญชี** (spec §7) · เงิน `Prisma.Decimal` · `deletedAt: null` ทุก query · ข้อความไทยชี้ทางที่มีจริง (ปุ่ม "แก้ไขใบจอง" / "ยกเลิกใบจอง" มีจริงใน PR 1)
- **Migration ชื่อ `20261019000000_booking_lock_and_source`** (spec §5.5 ให้ `20261018000000` แต่ #1675 ใช้ prefix นั้นแล้ว — `20261018000000_purchase_order_payments`) · additive ทั้งหมด · ไม่มี backfill (prod 0 ใบ) · เพิ่มคอลัมน์ §5.1 ครบชุดในรอบเดียว (`locked_product_id`, `locked_at`, `unlocked_at`, `source_room_id`, `expiry_reminder_sent_at`, `expiry_reminder_skip_reason`) — สองคอลัมน์หลังเป็นของ PR 4/6 แต่ additive และ spec ตั้งชื่อ migration ครอบไว้
- **Prisma เขียน partial unique ไม่ได้** — `prisma migrate dev` จะเสนอ DROP INDEX ห้ามยอมรับ (คอมเมนต์ในสเกมา)
- **เว็บ:** design tokens เท่านั้น · ไทย `leading-snug` · สถานะห้ามบอกด้วยสีอย่างเดียว · ปฏิทินไทย (`fmtBangkokDateShort`/`fmtBangkokTime` จาก `utils.ts`)
- **เทส:** API `npm --prefix apps/api test -- --runInBand src/modules/bookings` · integration (DB จริง) `cd apps/api && npx vitest run --no-file-parallelism src/modules/bookings/__tests__/booking-lock.integration.spec.ts` (ต้องมี `DATABASE_URL` — CI มี; ในเครื่องถ้าไม่มี DB ให้รายงาน) · web `npm --prefix apps/web test -- --run src/pages/BookingsPage` · typecheck `./tools/check-types.sh all` · **ห้าม `npm --prefix apps/api run lint`** (มี `--fix`) · ห้าม lint ใดที่มี `--fix`
- **CI glob:** vitest ใน `.github/workflows/deploy-gcp.yml` ไม่ recurse — โฟลเดอร์ใหม่ต้องมี `BOOKINGS_FILES=$(ls src/modules/bookings/__tests__/*.integration.spec.ts)` + `$BOOKINGS_FILES` ในคำสั่ง (Task 6)
- **bump `apps/web/package.json`** เป็นเลขถัดไปจาก main ณ เวลานั้น (ตอนเขียนแผน main = 26.10.7, PR #1676 = 26.10.8 ⇒ PR นี้ = 26.10.9 ถ้าไม่มีใครแทรก)

## Review Focus

1. **สองคนรับมัดจำสองใบที่ผูกเครื่องเดียวกันพร้อมกัน** → ต้องสำเร็จใบเดียว อีกใบได้ 409 และไม่มีเงิน/JE ของใบที่แพ้ — ปักที่ Task 6 (integration: pay ใบ 2 หลังใบ 1 → 409 · และ `Promise.allSettled` คู่ขนาน → fulfilled 1)
2. **ใบ PAID ที่เครื่องถูกเปลี่ยนสถานะด้วยมือระหว่างล็อก** (เช่น ปรับสต็อก DAMAGED) แล้วยกเลิก/หมดอายุ → ใบต้องปิดได้ เงินคืน/ริบตามเดิม มี audit `BOOKING_UNLOCK_SKIPPED` — Task 3 (unit: `_tx.product.updateMany` คืน `{count:0}` → ไม่ throw, audit ถูกเขียน, Sentry ถูกเรียกหลัง tx)
3. **ใบ PAID ยุคก่อนล็อก** (`lockedProductId` ว่าง เครื่อง `IN_STOCK`) → แปลงขายได้เหมือนเดิม — Task 4 (unit: claim where `status: 'IN_STOCK'`)
4. **พนักงานกด `POST /products/:id/unreserve` บนเครื่องที่ใบจองล็อก** → ต้องถูกปฏิเสธพร้อมเลขใบจอง ไม่ใช่ปลดเงียบ ๆ — Task 5 (unit)
5. **แผงรายละเอียดของใบ PAID ที่ล็อกแล้ว** ต้องแสดง "ล็อกไว้ให้ลูกค้ารายนี้แล้ว" และ**เปิดปุ่มแปลงขาย** (PR 1 ถือ RESERVED = ไม่พร้อม จะปิดปุ่มขายของตัวเอง) — Task 7 (web unit)

---

### Task 1: Prisma schema + migration `20261019000000_booking_lock_and_source`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Booking` ~L8002-8044 · model `Product` relation list ~L2046-2071)
- Create: `apps/api/prisma/migrations/20261019000000_booking_lock_and_source/migration.sql`

**Interfaces:**
- Produces: `Booking.lockedProductId: string | null`, `Booking.lockedAt`, `Booking.unlockedAt`, `Booking.sourceRoomId`, `Booking.expiryReminderSentAt`, `Booking.expiryReminderSkipReason` · relation `Booking.lockedProduct Product?` ("BookingLockedProduct") และ `Product.lockedByBookings Booking[]` · DB index `bookings_locked_product_active_unique`

- [ ] **Step 1: เพิ่มคอลัมน์ + relation ใน schema**

ใน `model Booking` ต่อจากบรรทัด `convertedAt DateTime? @map("converted_at")` เพิ่ม:

```prisma
  /// PR 2 ล็อกเครื่อง (spec §4/§5.1): ตั้งตอนรับมัดจำ (IN_STOCK→RESERVED ใน tx เดียวกับ JE/สมุดเงิน)
  /// ล้างทุกทางออก (ยกเลิก/หมดอายุ/ขาย) · partial unique SQL-only
  /// `bookings_locked_product_active_unique` ON (locked_product_id) WHERE locked_product_id IS NOT NULL
  /// AND deleted_at IS NULL — สร้างด้วยมือใน migration 20261019000000 (Prisma declare partial unique ไม่ได้)
  /// ถ้ารัน `prisma migrate dev` อย่ายอมรับ diff ที่เสนอ DROP INDEX นี้ — มันคือตาข่าย "1 เครื่อง = ล็อกได้ใบเดียว"
  lockedProductId          String?   @map("locked_product_id")
  lockedAt                 DateTime? @map("locked_at")
  unlockedAt               DateTime? @map("unlocked_at")
  /// PR 4 (แชท): ห้องที่สร้างใบจองนี้ — เพิ่มล่วงหน้าใน migration เดียวตาม spec §5.5 (additive)
  sourceRoomId             String?   @map("source_room_id")
  /// PR 6 (LINE เตือนก่อนหมดอายุ) — เพิ่มล่วงหน้าเช่นกัน
  expiryReminderSentAt     DateTime? @map("expiry_reminder_sent_at")
  expiryReminderSkipReason String?   @map("expiry_reminder_skip_reason")
```

ในบล็อก relation ของ `Booking` (ใต้ `convertedToSale Sale? …`) เพิ่ม:

```prisma
  lockedProduct   Product?      @relation("BookingLockedProduct", fields: [lockedProductId], references: [id])
```

ใน `@@index` ของ `Booking` เพิ่ม `@@index([lockedProductId])` ก่อน `@@map("bookings")`.

ใน `model Product` ข้าง `bookingItems BookingItem[] @relation("ProductBookingItems")` เพิ่ม:

```prisma
  lockedByBookings Booking[] @relation("BookingLockedProduct")
```

(ชื่อ relation ต้องตรงกันสองฝั่ง — ห้ามใส่ `onDelete`; ล็อกต้องไม่หายเพราะเครื่องถูกลบ: `product-hold.util` กันลบเครื่อง RESERVED อยู่แล้ว)

- [ ] **Step 2: เขียน migration SQL**

```sql
-- PR 2 ล็อกเครื่องเมื่อรับมัดจำ (spec 2026-10-05 §4 §5.1 §5.5) — additive ทั้งหมด ไม่มี backfill (prod 0 ใบ)
-- คอลัมน์ของ PR 4 (source_room_id) และ PR 6 (expiry_reminder_*) เพิ่มมาด้วยตาม §5.5 เพื่อให้ migration ชุดนี้ครบในรอบเดียว
ALTER TABLE "bookings"
  ADD COLUMN "locked_product_id" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "unlocked_at" TIMESTAMP(3),
  ADD COLUMN "source_room_id" TEXT,
  ADD COLUMN "expiry_reminder_sent_at" TIMESTAMP(3),
  ADD COLUMN "expiry_reminder_skip_reason" TEXT;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_locked_product_id_fkey"
  FOREIGN KEY ("locked_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bookings_locked_product_id_idx" ON "bookings"("locked_product_id");

-- หนึ่งล็อกต่อหนึ่งเครื่อง (ใบที่ยังไม่ถูกลบ) — Prisma schema แสดงไม่ได้ ดูคอมเมนต์ที่ model Booking
CREATE UNIQUE INDEX "bookings_locked_product_active_unique"
  ON "bookings"("locked_product_id")
  WHERE "locked_product_id" IS NOT NULL AND "deleted_at" IS NULL;
```

หมายเหตุ: Prisma สร้าง FK ด้วย `ON DELETE SET NULL` สำหรับ relation optional ที่ไม่ระบุ `onDelete` — ใช้แบบเดียวกันเพื่อให้ `prisma migrate diff` ไม่เห็นความต่าง

- [ ] **Step 3: generate + typecheck**

Run: `cd apps/api && npx prisma generate && npx prisma validate && cd ../..` แล้ว `./tools/check-types.sh api`
Expected: `Web/API: OK` · ถ้ามี DB ในเครื่อง: `cd apps/api && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL"` ต้องไม่มี diff ยกเว้นข้อความเกี่ยวกับ partial index (ไม่มี DB = ข้ามและรายงาน)

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261019000000_booking_lock_and_source/migration.sql
git commit -m "feat(bookings): schema ล็อกเครื่อง — lockedProductId/lockedAt/unlockedAt + partial unique · คอลัมน์ล่วงหน้า sourceRoomId/expiryReminder*"
```

---

### Task 2: `payDeposit` ล็อกเครื่องแบบ compare-and-set

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`payDeposit` L698-808 · `loadBookableProduct` L384-399)
- Test: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` (บล็อก payDeposit ~L95-130)

**Interfaces:**
- Consumes: `preemptReservationsInTx(tx, ids)` (import อยู่แล้ว L16) · `TEST_SIDE_CUSTOMER_SELECT` · `loadBookableProduct` (ด่านอ่าน + รั้ว TEST- เดิม)
- Produces: payDeposit เขียน `lockedProductId`/`lockedAt` ลง booking และคืน booking ที่มีสองฟิลด์นี้ · audit `BOOKING_DEPOSIT_PAID.newValue.lockedProductId` · ค่าคงที่ `LOCK_FAILED_MSG` (export) ให้ Task 6/เว็บอ้าง

- [ ] **Step 1: เขียนเทสที่ล้ม (3 เคส) ใน `bookings.service.spec.ts` ต่อจากเทส payDeposit ที่มีอยู่ (~L120)**

```ts
  describe('payDeposit — ล็อกเครื่อง (PR 2)', () => {
    it('ล็อกเครื่อง IN_STOCK → RESERVED ใน tx เดียวกัน และเขียน lockedProductId/lockedAt', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce({
        id: 'bk-1', status: 'PENDING_DEPOSIT', branchId: 'br-1', depositAmount: new Prisma.Decimal(1000),
        expireDate: new Date(Date.now() + 86_400_000), bookingNumber: 'BK-20260517-0001',
        customerId: 'cust-1', items: [{ productId: 'prod-1' }],
      });
      await service.payDeposit('bk-1', { depositMethod: 'CASH' } as any, ownerUser);
      expect(prisma._tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', status: 'IN_STOCK', branchId: 'br-1', deletedAt: null },
        data: { status: 'RESERVED' },
      });
      expect(prisma._tx.productReservation.updateMany).toHaveBeenCalled();
      const bookingClaim = prisma._tx.booking.updateMany.mock.calls[0][0];
      expect(bookingClaim.data.lockedProductId).toBe('prod-1');
      expect(bookingClaim.data.lockedAt).toBeInstanceOf(Date);
      const audit = prisma._tx.auditLog.create.mock.calls.at(-1)![0];
      expect(audit.data.newValue.lockedProductId).toBe('prod-1');
    });

    it('CAS ล็อกไม่สำเร็จ (count 0) → 409 ข้อความ spec และไม่โพสต์ JE/สมุดเงิน', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce({
        id: 'bk-1', status: 'PENDING_DEPOSIT', branchId: 'br-1', depositAmount: new Prisma.Decimal(1000),
        expireDate: new Date(Date.now() + 86_400_000), bookingNumber: 'BK-20260517-0001',
        customerId: 'cust-1', items: [{ productId: 'prod-1' }],
      });
      prisma._tx.product.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.payDeposit('bk-1', { depositMethod: 'CASH' } as any, ownerUser)).rejects.toThrow(
        'เครื่องนี้ถูกขายหรือย้ายสาขาไปแล้ว กรุณาแก้ใบจองเลือกเครื่องอื่นก่อนรับมัดจำ',
      );
      expect(shopBookingDepositTemplate.execute).not.toHaveBeenCalled();
      expect(prisma._tx.shopTender.createMany).not.toHaveBeenCalled();
    });

    it('ใบยุคก่อน (ไม่มีแถวรายการ) รับมัดจำได้โดยไม่ล็อก — lockedProductId ว่าง', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce({
        id: 'bk-legacy', status: 'PENDING_DEPOSIT', branchId: 'br-1', depositAmount: new Prisma.Decimal(500),
        expireDate: new Date(Date.now() + 86_400_000), bookingNumber: 'BK-20260101-0001',
        customerId: 'cust-1', items: [],
      });
      await service.payDeposit('bk-legacy', { depositMethod: 'CASH' } as any, ownerUser);
      expect(prisma._tx.product.updateMany).not.toHaveBeenCalled();
      const bookingClaim = prisma._tx.booking.updateMany.mock.calls[0][0];
      expect(bookingClaim.data.lockedProductId).toBeUndefined();
    });
  });
```

(ชื่อตัวแปร `ownerUser`/`service`/`shopBookingDepositTemplate` ให้ใช้ชื่อที่ไฟล์นี้ประกาศไว้จริง — เปิดไฟล์ดูก่อน · `prisma._tx.shopTender` มี `createMany` ตามแบบที่ `ShopTenderRecorder` เรียก)

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- --runInBand src/modules/bookings/__tests__/bookings.service.spec.ts -t "ล็อกเครื่อง"`
Expected: FAIL — `product.updateMany` ไม่ถูกเรียก / ข้อความ error ไม่ตรง

- [ ] **Step 3: แก้ `payDeposit`**

เพิ่มค่าคงที่ระดับโมดูล (ใกล้ `OPEN_BOOKING_STATUSES`):

```ts
/** spec §4 — ล็อกเครื่องตอนรับมัดจำไม่สำเร็จ (ถูกขาย/ย้ายสาขา/ถูกใบอื่นล็อก) */
export const LOCK_FAILED_MSG =
  'เครื่องนี้ถูกขายหรือย้ายสาขาไปแล้ว กรุณาแก้ใบจองเลือกเครื่องอื่นก่อนรับมัดจำ';
```

แทนบล็อก "ใบเก่าที่ไม่มีแถวรายการ = ข้ามด่านนี้ …" (L722-731) และ booking CAS (L744-760) ด้วย:

```ts
      // ด่านอ่าน + รั้ว TEST- (เหมือน PR 1) — ให้ข้อความละเอียดก่อน (คนละสาขา / ไม่พบ / ไม่พร้อมขาย)
      // แล้วค่อย CAS ล็อกจริงด้านล่าง; ใบยุคก่อน PR 1 ที่ไม่มีแถวรายการ = รับมัดจำโดยไม่ล็อก
      const bookedProductId = booking.items?.find((i) => i.productId)?.productId ?? null;
      if (bookedProductId) {
        const owner = await tx.customer.findFirst({
          where: { id: booking.customerId, deletedAt: null },
          select: TEST_SIDE_CUSTOMER_SELECT,
        });
        if (!owner) throw new NotFoundException('ไม่พบลูกค้า');
        await this.loadBookableProduct(bookedProductId, booking.branchId, owner, tx);
      }
      // (บล็อก normalizeTenders / resolveInflowCashAccount / depositAccountCode เดิม — ไม่เปลี่ยน)
      …
      const claim = await tx.booking.updateMany({
        where: {
          id,
          deletedAt: null,
          status: 'PENDING_DEPOSIT',
          expireDate: { gt: now },
        },
        data: {
          status: 'PAID',
          depositPaidAt: now,
          depositMethod,
          depositAccountCode: cashAccountCode,
          depositReceivedById: user.id,
          // spec §4: ล็อกเครื่องให้ลูกค้าตอนรับมัดจำ — ใบไม่มีเครื่อง (ยุคก่อน) ไม่เขียนสองช่องนี้
          ...(bookedProductId ? { lockedProductId: bookedProductId, lockedAt: now } : {}),
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('ใบจองนี้หมดอายุ ถูกบันทึกมัดจำ หรือเปลี่ยนสถานะไปแล้ว');
      }
      if (bookedProductId) {
        // ล็อกเครื่อง = compare-and-set statement เดียว (แบบ contract-bundle.util.reserveContractBundles)
        // count 0 = เพิ่งถูกขาย/ย้ายสาขา/ถูกใบอื่นหรือสัญญาล็อกไปก่อน → ทั้ง tx rollback (เงินไม่เข้า)
        const lock = await tx.product.updateMany({
          where: { id: bookedProductId, status: 'IN_STOCK', branchId: booking.branchId, deletedAt: null },
          data: { status: 'RESERVED' },
        });
        if (lock.count !== 1) throw new ConflictException(LOCK_FAILED_MSG);
        // hold จากเว็บ (ตารางว่างตั้งแต่ 2026-09-28 แต่คง pattern เดียวกับของแถมสัญญา)
        await preemptReservationsInTx(tx, [bookedProductId]);
      }
```

และใน audit `BOOKING_DEPOSIT_PAID.newValue` เพิ่ม `lockedProductId: bookedProductId,` (null เมื่อไม่ล็อก).

ครอบ `this.prisma.$transaction(…)` ของ `payDeposit` ด้วยการแปล P2002 ของ partial unique เป็น 409 ข้อความเดียวกัน:

```ts
  async payDeposit(id: string, dto: PayDepositDto, user: RequestUser) {
    try {
      return await this.prisma.$transaction(async (tx) => { /* …เดิม… */ });
    } catch (err) {
      // ตาข่าย: unique index bookings_locked_product_active_unique (ใบอื่นที่ยังเปิดอยู่ล็อกเครื่องเดียวกัน
      // ด้วยช่องทางที่ไม่ผ่าน CAS เช่นข้อมูลแก้มือ) → ข้อความเดียวกับ CAS แพ้
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(LOCK_FAILED_MSG);
      }
      throw err;
    }
  }
```

- [ ] **Step 4: รันเทสผ่าน + ทั้งโมดูล**

Run: `npm --prefix apps/api test -- --runInBand src/modules/bookings` → Expected: PASS ทุก suite (เทสเดิมที่ assert `product.findFirst` ยังผ่าน — ด่านอ่านยังอยู่)
Run: `./tools/check-types.sh api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/bookings
git commit -m "feat(bookings): รับมัดจำแล้วล็อกเครื่อง IN_STOCK→RESERVED (CAS ใน tx เดียวกับ JE) + lockedProductId"
```

---

### Task 3: ปลดล็อกตอนยกเลิกและหมดอายุ (+ `BOOKING_UNLOCK_SKIPPED`)

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`cancel` L816-909 · `autoExpire` L1241-1328 · `BOOKING_EVENT_ACTIONS` L69-77)
- Modify: `apps/api/src/modules/products/product-enter-stock.util.ts` (รายการข้อยกเว้นที่หัวไฟล์ L6-40)
- Test: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts`

**Interfaces:**
- Consumes: `Booking.lockedProductId` (Task 1)
- Produces: `private async unlockBookedDevice(tx, booking: { id; lockedProductId: string | null; bookingNumber: string | null }, userId: string, now: Date): Promise<'UNLOCKED' | 'SKIPPED' | 'NONE'>` · action string ใหม่ `BOOKING_UNLOCK_SKIPPED` ใน `BOOKING_EVENT_ACTIONS` (ไทม์ไลน์เห็น) · `cancel`/`autoExpire` ตั้ง `unlockedAt` และล้าง `lockedProductId`

- [ ] **Step 1: เทสที่ล้ม (cancel 2 เคส · autoExpire 1 เคส)**

```ts
  describe('cancel/autoExpire — ปลดล็อกเครื่อง (PR 2)', () => {
    const paidLocked = () => ({
      id: 'bk-1', status: 'PAID', branchId: 'br-1', depositAmount: new Prisma.Decimal(1000),
      depositPaidAt: new Date(), depositMethod: 'CASH', bookingNumber: 'BK-20260517-0001',
      expireDate: new Date(Date.now() + 86_400_000), lockedProductId: 'prod-1',
    });

    it('ยกเลิกใบ PAID → RESERVED→IN_STOCK + ล้าง lockedProductId + unlockedAt', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce(paidLocked());
      await service.cancel('bk-1', { cancelReason: 'ลูกค้าเปลี่ยนใจ' }, ownerUser);
      expect(prisma._tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', status: 'RESERVED' },
        data: { status: 'IN_STOCK' },
      });
      const claim = prisma._tx.booking.updateMany.mock.calls[0][0];
      expect(claim.data).toMatchObject({ status: 'CANCELED', lockedProductId: null });
      expect(claim.data.unlockedAt).toBeInstanceOf(Date);
      expect(prisma._tx.auditLog.create.mock.calls.some((c) => c[0].data.action === 'BOOKING_UNLOCK_SKIPPED')).toBe(false);
    });

    it('ยกเลิก — เครื่องถูกเปลี่ยนสถานะด้วยมือระหว่างล็อก (count 0) → ไม่ throw · audit BOOKING_UNLOCK_SKIPPED · Sentry warning หลัง tx', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce(paidLocked());
      prisma._tx.product.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.cancel('bk-1', { cancelReason: 'ลูกค้าเปลี่ยนใจ' }, ownerUser)).resolves.toBeDefined();
      const skipped = prisma._tx.auditLog.create.mock.calls.find((c) => c[0].data.action === 'BOOKING_UNLOCK_SKIPPED');
      expect(skipped).toBeDefined();
      expect(skipped![0].data.newValue).toMatchObject({ lockedProductId: 'prod-1', reason: 'PRODUCT_NOT_RESERVED' });
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('unlock skipped'),
        expect.objectContaining({ level: 'warning', tags: expect.objectContaining({ module: 'booking-lock' }) }),
      );
    });

    it('autoExpire ใบ PAID ที่ล็อก → ปลดล็อกใน tx เดียวกับ EXPIRED + ริบมัดจำ', async () => {
      prisma.booking.findMany
        .mockResolvedValueOnce([{ id: 'bk-1' }])
        .mockResolvedValueOnce([]);
      prisma.booking.findFirst.mockResolvedValueOnce({
        ...paidLocked(), expireDate: new Date(Date.now() - 1000),
      });
      const n = await service.autoExpire(new Date());
      expect(n).toBe(1);
      expect(prisma._tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', status: 'RESERVED' },
        data: { status: 'IN_STOCK' },
      });
      expect(shopBookingForfeitTemplate.execute).toHaveBeenCalled();
      const claim = prisma._tx.booking.updateMany.mock.calls[0][0];
      expect(claim.data).toMatchObject({ status: 'EXPIRED', lockedProductId: null });
    });
  });
```

ที่หัวไฟล์ spec ต้องมี `jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }))` + `import * as Sentry from '@sentry/node'` ถ้ายังไม่มี (ตรวจก่อน — ไฟล์นี้อาจ mock Sentry อยู่แล้วสำหรับ autoExpire)

- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/api test -- --runInBand src/modules/bookings/__tests__/bookings.service.spec.ts -t "ปลดล็อก"` → FAIL

- [ ] **Step 3: implement**

(ก) `BOOKING_EVENT_ACTIONS` เพิ่ม `'BOOKING_UNLOCK_SKIPPED'` ท้ายรายการ (ก่อน `] as const`).

(ข) helper ส่วนตัวใน `BookingsService` (วางถัดจาก `lockBooking`):

```ts
  /**
   * ปลดล็อกเครื่องของใบ (spec §4): RESERVED→IN_STOCK แบบ CAS — count 0 ไม่ throw (เครื่องถูกเปลี่ยนสถานะ
   * ด้วยมือระหว่างล็อก เช่น ปรับสต็อก) แค่ทิ้งหลักฐานไว้: audit ใน tx + Sentry หลัง commit (ผู้เรียกส่งเอง)
   * จงใจไม่ผ่าน product-enter-stock.util — เครื่องเป็น IN_STOCK มีราคาอยู่ก่อนถูกล็อก (คลาสเดียวกับปลดจองของแถม)
   */
  private async unlockBookedDevice(
    tx: Prisma.TransactionClient,
    booking: { id: string; lockedProductId: string | null; bookingNumber: string | null },
    userId: string,
    now: Date,
  ): Promise<'UNLOCKED' | 'SKIPPED' | 'NONE'> {
    if (!booking.lockedProductId) return 'NONE';
    const released = await tx.product.updateMany({
      where: { id: booking.lockedProductId, status: 'RESERVED' },
      data: { status: 'IN_STOCK' },
    });
    if (released.count === 1) return 'UNLOCKED';
    await tx.auditLog.create({
      data: {
        action: 'BOOKING_UNLOCK_SKIPPED',
        entity: 'booking',
        entityId: booking.id,
        userId,
        newValue: {
          lockedProductId: booking.lockedProductId,
          bookingNumber: booking.bookingNumber,
          reason: 'PRODUCT_NOT_RESERVED',
          at: now.toISOString(),
        },
      },
    });
    return 'SKIPPED';
  }

  /** ยิง Sentry หลัง tx commit เท่านั้น (doctrine R-1 — ห้ามเรียกใน tx) */
  private warnUnlockSkipped(bookingId: string, productId: string | null, flow: 'cancel' | 'auto-expire') {
    Sentry.captureMessage(`[booking-lock] unlock skipped — product not RESERVED (${flow})`, {
      level: 'warning',
      tags: { module: 'booking-lock', flow },
      extra: { bookingId, productId },
    });
  }
```

(ค) `cancel`: select เพิ่ม `lockedProductId: true` · booking CAS `data` เพิ่ม `lockedProductId: null, unlockedAt: new Date()` · หลัง claim และก่อนบล็อกคืนเงิน:

```ts
      const unlock = await this.unlockBookedDevice(tx, {
        id, lockedProductId: booking.lockedProductId ?? null, bookingNumber: booking.bookingNumber ?? null,
      }, user.id, new Date());
```

และคืนค่าจาก tx เป็น `{ updated, unlock }` แล้วนอก tx:

```ts
    const { updated, unlock } = await this.prisma.$transaction(async (tx) => { … return { updated, unlock }; });
    if (unlock === 'SKIPPED') this.warnUnlockSkipped(id, updated?.lockedProductId ?? null, 'cancel');
    return updated;
```

(`updated.lockedProductId` จะเป็น null หลังล้าง — ส่ง `booking.lockedProductId` ที่อ่านก่อนล้างแทน: เก็บไว้ในตัวแปร `lockedProductIdBefore` ภายใน tx แล้วคืนมาด้วย)

(ง) `autoExpire`: ใน tx ต่อแถว หลัง CAS `EXPIRED` (ซึ่ง `data` ต้องเพิ่ม `lockedProductId: null, unlockedAt: now`) และก่อน forfeit:

```ts
            const unlock = await this.unlockBookedDevice(tx, {
              id: candidate.id, lockedProductId: booking.lockedProductId, bookingNumber: booking.bookingNumber,
            }, systemUserId, now);
```

คืน `{ didExpire: true, unlock, lockedProductId: booking.lockedProductId }` จาก tx; นอก tx ถ้า `unlock === 'SKIPPED'` → `this.warnUnlockSkipped(candidate.id, lockedProductId, 'auto-expire')`. audit `BOOKING_AUTO_EXPIRED.newValue` เพิ่ม `unlockedProductId: booking.lockedProductId`.

(จ) `product-enter-stock.util.ts` หัวไฟล์ — ในรายการ "ประตูที่จงใจไม่ผ่าน helper" บรรทัด **ปลดจอง** เพิ่มข้อความ: `· ปลดล็อกใบจอง RESERVED → IN_STOCK (bookings.service.ts unlockBookedDevice — ยกเลิก/หมดอายุ; เครื่องมีราคาอยู่ก่อนถูกล็อก)`

- [ ] **Step 4: รันผ่าน** — `npm --prefix apps/api test -- --runInBand src/modules/bookings` + `./tools/check-types.sh api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/bookings apps/api/src/modules/products/product-enter-stock.util.ts
git commit -m "feat(bookings): ปลดล็อกเครื่องตอนยกเลิก/หมดอายุ (CAS RESERVED→IN_STOCK · ไม่สำเร็จ = audit BOOKING_UNLOCK_SKIPPED + Sentry)"
```

---

### Task 4: `convertToSale` claim จาก RESERVED เมื่อเครื่องเป็นของใบนี้

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`convertToSale` L1005-1032 และ booking update L1143-1146)
- Test: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` (บล็อก convertToSale ~L540-620)

**Interfaces:**
- Consumes: `assertSaleProductEligible(product, branchId, actor, ack)` (`sales/services/sale-product-policy.ts` — ปฏิเสธทุกสถานะที่ไม่ใช่ IN_STOCK)
- Produces: convert ของใบที่ล็อก claim `where.status = 'RESERVED'`; ใบไม่ล็อก claim `'IN_STOCK'` เหมือนเดิม · หลังขาย `lockedProductId = null`, `unlockedAt = now`

- [ ] **Step 1: เทสที่ล้ม**

```ts
  describe('convertToSale — เครื่องที่ใบนี้ล็อกไว้ (PR 2)', () => {
    it('ใบ PAID ที่ล็อก: เครื่อง RESERVED ผ่านด่าน และ claim where status RESERVED → SOLD_CASH + ล้าง lockedProductId', async () => {
      const b = paidBooking();
      prisma.booking.findFirst.mockResolvedValueOnce({ ...b, lockedProductId: 'prod-1' });
      prisma._tx.product.findUnique.mockResolvedValueOnce({
        id: 'prod-1', status: 'RESERVED', branchId: 'br-1', deletedAt: null, costPrice: new Prisma.Decimal(6000),
        name: 'iPhone 15', imeiSerial: '356789012345678', category: 'PHONE_NEW', wasPreviouslyDamaged: false, po: null,
      });
      await service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' } as any, 'u-sales', ownerUser);
      expect(prisma._tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', status: 'RESERVED', branchId: 'br-1', deletedAt: null },
        data: { status: 'SOLD_CASH' },
      });
      const link = prisma._tx.booking.update.mock.calls.find((c) => c[0].data.convertedToSaleId);
      expect(link![0].data).toMatchObject({ convertedToSaleId: 'sale-new', lockedProductId: null });
      expect(link![0].data.unlockedAt).toBeInstanceOf(Date);
    });

    it('ใบ PAID ยุคก่อนล็อก (lockedProductId ว่าง): เครื่องต้อง IN_STOCK และ claim where IN_STOCK เหมือนเดิม', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce({ ...paidBooking(), lockedProductId: null });
      await service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' } as any, 'u-sales', ownerUser);
      expect(prisma._tx.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'IN_STOCK' }) }),
      );
    });

    it('ใบ PAID ที่ล็อก แต่เครื่องกลายเป็น RESERVED ของคนอื่น (lockedProductId ≠ product.id) → ปฏิเสธด่านพร้อมขาย', async () => {
      prisma.booking.findFirst.mockResolvedValueOnce({ ...paidBooking(), lockedProductId: 'prod-other' });
      prisma._tx.product.findUnique.mockResolvedValueOnce({ id: 'prod-1', status: 'RESERVED', branchId: 'br-1', deletedAt: null, po: null });
      await expect(service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' } as any, 'u-sales', ownerUser))
        .rejects.toThrow('สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว');
    });
  });
```

(`paidBooking()` คือ helper ที่มีอยู่ L36 — ตรวจว่า `items[0].productId === 'prod-1'`)

- [ ] **Step 2: รันให้ล้ม** — `-t "เครื่องที่ใบนี้ล็อกไว้"` → FAIL

- [ ] **Step 3: implement** — แทนบล็อก "2. Verify the product is still IN_STOCK" ถึง `stockClaim` (L1011-1032):

```ts
      // 2. เครื่องต้องพร้อมขาย — ใบที่ล็อกไว้ (PR 2) เครื่องเป็น RESERVED "ของใบนี้" ⇒ ถือเท่ากับ IN_STOCK
      //    ใบ PAID ยุคก่อนล็อก (lockedProductId ว่าง) ยังต้องเป็น IN_STOCK · RESERVED ของคนอื่น = ไม่พร้อม
      const product = await tx.product.findUnique({
        where: { id: firstItem.productId! },
        include: { po: { select: { poNumber: true } } },
      });
      const lockedByThisBooking =
        !!product && booking.lockedProductId === product.id && product.status === 'RESERVED';
      const expectedStatus: 'IN_STOCK' | 'RESERVED' = lockedByThisBooking ? 'RESERVED' : 'IN_STOCK';
      if (!product || product.deletedAt || product.status !== expectedStatus) {
        throw new BadRequestException(
          'สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว — กรุณาตรวจสอบสต็อก',
        );
      }
      // ด่านรวมของการขาย (สาขา/สิทธิ์/ประวัติเสียหาย) มองเห็นเครื่องที่ล็อกให้ใบนี้เป็น IN_STOCK
      assertSaleProductEligible(
        lockedByThisBooking ? { ...product, status: 'IN_STOCK' } : product,
        booking.branchId, user, dto.previouslyDamagedAcknowledged,
      );
      assertCustomerHasPhone(booking.customer, 'เปิดใบขาย');
      assertSameTestSide(booking.customer, product);

      const stockClaim = await tx.product.updateMany({
        where: { id: product.id, status: expectedStatus, branchId: booking.branchId, deletedAt: null },
        data: { status: 'SOLD_CASH' },
      });
      if (stockClaim.count !== 1) throw new ConflictException('สินค้าเพิ่งถูกขายหรือย้ายสาขา กรุณาตรวจสอบสต็อกอีกครั้ง');
```

และ "6. Link booking → sale":

```ts
      await tx.booking.update({
        where: { id },
        data: { convertedToSaleId: sale.id, lockedProductId: null, unlockedAt: new Date() },
      });
```

audit `BOOKING_CONVERTED.newValue` เพิ่ม `lockedProductId: booking.lockedProductId ?? null` (บันทึกว่าเคยล็อกเครื่องไหน).

- [ ] **Step 4: รันผ่าน** — ทั้งโมดูล + typecheck api

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/bookings
git commit -m "feat(bookings): แปลงขายจากเครื่องที่ใบล็อกไว้ (claim RESERVED→SOLD_CASH) · ล้าง lockedProductId ตอนขาย"
```

---

### Task 5: `POST /products/:id/unreserve` ต้องไม่ปลดล็อกของใบจอง

**Files:**
- Modify: `apps/api/src/modules/products/services/stock-reservation.service.ts` (`unreserve` L49-66)
- Test: `apps/api/src/modules/products/services/__tests__/stock-reservation.service.spec.ts` (สร้างใหม่ถ้าไม่มี — grep ก่อน)

**Interfaces:**
- Consumes: `prisma.booking.findFirst({ where: { lockedProductId, status: 'PAID', deletedAt: null } })`
- Produces: `unreserve` โยน `ConflictException('เครื่องนี้ถูกล็อกโดยใบจอง <BK> — ยกเลิกใบจองก่อน (หรือรอให้หมดอายุ) แล้วเครื่องจะกลับมาพร้อมขายเอง')`

- [ ] **Step 1: เทสที่ล้ม**

```ts
import { ConflictException } from '@nestjs/common';
import { StockReservationService } from '../stock-reservation.service';

describe('StockReservationService.unreserve — เครื่องที่ใบจองล็อก (PR 2)', () => {
  const prisma = {
    booking: { findFirst: jest.fn() },
    product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'prod-1' }) },
  } as any;
  const service = new StockReservationService(prisma);

  it('มีใบจอง PAID ล็อกเครื่องอยู่ → 409 พร้อมเลขใบ และไม่แตะสถานะเครื่อง', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({ id: 'bk-1', bookingNumber: 'BK-20260517-0001' });
    await expect(service.unreserve('prod-1')).rejects.toThrow(ConflictException);
    await expect(service.unreserve('prod-1')).rejects.toThrow('BK-20260517-0001');
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('ไม่มีใบจองล็อก → ปลดจองตามเดิม', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce(null);
    await service.unreserve('prod-1');
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'prod-1', deletedAt: null, status: 'RESERVED' }, data: { status: 'IN_STOCK' },
    });
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/api test -- --runInBand src/modules/products/services/__tests__/stock-reservation.service.spec.ts` → FAIL

- [ ] **Step 3: implement** — ต้นฟังก์ชัน `unreserve`:

```ts
  async unreserve(productId: string) {
    // PR 2: เครื่องที่ใบจองล็อกไว้ปลดได้ทางเดียวคือยกเลิกใบ/หมดอายุ (bookings.service) — ปุ่มปลดจองทั่วไปห้ามแย่ง
    const lockedBy = await this.prisma.booking.findFirst({
      where: { lockedProductId: productId, status: 'PAID', deletedAt: null },
      select: { id: true, bookingNumber: true },
    });
    if (lockedBy) {
      throw new ConflictException(
        `เครื่องนี้ถูกล็อกโดยใบจอง ${lockedBy.bookingNumber} — ยกเลิกใบจองก่อน (หรือรอให้หมดอายุ) แล้วเครื่องจะกลับมาพร้อมขายเอง`,
      );
    }
    const released = await this.prisma.product.updateMany({ … เดิม … });
```

(import `ConflictException` จาก `@nestjs/common`)

- [ ] **Step 4: รันผ่าน + typecheck** — Step 5: Commit

```bash
git add apps/api/src/modules/products
git commit -m "fix(products): ปลดจองทั่วไปห้ามปลดเครื่องที่ใบจองล็อก (409 บอกเลขใบ)"
```

---

### Task 6: Integration spec บน DB จริง + CI glob + ปรับ API e2e

**Files:**
- Create: `apps/api/src/modules/bookings/__tests__/booking-lock.integration.spec.ts`
- Modify: `.github/workflows/deploy-gcp.yml` (บล็อก vitest L286-308)
- Modify: `apps/api/e2e/bookings-lifecycle.e2e-spec.ts` (เทส `allows only one of two bookings…` L166-183 และ `rolls back conversion … foreign branch` L186-200)

**Interfaces:**
- Consumes: `BookingsService` + template จริง (แบบ `apps/api/e2e/bookings-lifecycle.e2e-spec.ts` L40-76 ประกอบ service ด้วย `new`) · `seedShopCoa`

- [ ] **Step 1: เขียน integration spec (vitest, DB จริง) — จะ RED ตั้งแต่ Task 1 ยังไม่ merge ถึงที่นี่ไม่ได้ (ไฟล์นี้วางหลัง Task 1–5 จึง GREEN ทันที; ให้ยืนยันว่า "ถ้าปิด CAS" ล้ม โดยคอมเมนต์บรรทัด lock ชั่วคราวแล้วรัน 1 รอบ แล้วคืน)**

```ts
/**
 * ล็อกเครื่องเมื่อรับมัดจำ — วงจรจริงบน DB จริง (PR 2, spec 2026-10-05 §4)
 * สิ่งที่ unit spec (mock prisma) มองไม่เห็น:
 *   1. รับมัดจำ → เครื่อง RESERVED + lockedProductId · ใบที่สองบนเครื่องเดียวกันรับมัดจำไม่ได้ (409 ข้อความ spec)
 *   2. สองใบรับมัดจำพร้อมกัน → สำเร็จใบเดียว (CAS)
 *   3. ยกเลิกใบ PAID → IN_STOCK + lockedProductId ว่าง + unlockedAt
 *   4. autoExpire ใบ PAID → IN_STOCK + ริบมัดจำ
 *   5. แปลงขายจากเครื่องที่ล็อก → SOLD_CASH + lockedProductId ว่าง · ใบจองใบใหม่บนเครื่องเดิมหลังขายไม่ชน unique
 *   6. partial unique: ตั้ง lockedProductId ซ้ำบนใบเปิดอีกใบตรง ๆ → P2002
 * รัน: cd apps/api && npx vitest run --no-file-parallelism src/modules/bookings/__tests__/booking-lock.integration.spec.ts
 * CI: glob BOOKINGS_FILES ใน deploy-gcp.yml (glob ไม่ recurse เอง)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { BookingsService, LOCK_FAILED_MSG } from '../bookings.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';

// ประกอบ service ด้วย `new` แบบเดียวกับ apps/api/e2e/bookings-lifecycle.e2e-spec.ts (constructor args อยู่ใน beforeAll ด้านล่าง)
const db = new PrismaClient();
const PREFIX = `TEST-LOCK-${randomUUID().slice(0, 8)}`;
let bookings: BookingsService;
let branchId: string; let customerId: string; let actor: any; let shopId: string;

const seedProduct = () => db.product.create({ data: {
  name: PREFIX, brand: 'SYNTHETIC', model: 'LOCK', category: 'PHONE_NEW',
  imeiSerial: `${PREFIX}-${randomUUID()}`, branchId, ownedByCompanyId: shopId,
  costPrice: 6000, cashPrice: 10000, status: 'IN_STOCK',
} });
const createBooking = (productId: string) => bookings.create({
  customerId, branchId, depositAmount: 1000,
  expireDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  items: [{ productId, description: PREFIX, quantity: 1, unitPrice: 10000 }],
} as any, actor.id, actor);
const pay = (id: string) => bookings.payDeposit(id, { depositMethod: 'CASH' } as any, actor);
const productStatus = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  await db.$connect();
  await seedShopCoa(db);
  shopId = (await db.companyInfo.upsert({ where: { companyCode: 'SHOP' }, create: {
    companyCode: 'SHOP', nameTh: 'ISOLATED SHOP', taxId: '9999999999996', address: 'Synthetic Road',
    directorName: 'Synthetic Director', vatRegistered: true, vatRate: '0.0700',
  }, update: {} })).id;
  await db.user.upsert({ where: { email: 'admin@bestchoice.com' }, create: {
    email: 'admin@bestchoice.com', password: 'unused', name: 'ISOLATED OWNER', role: 'OWNER',
  }, update: {} });
  branchId = (await db.branch.create({ data: { name: PREFIX, companyId: shopId, shopCashAccountCode: 'S11-1101' } })).id;
  actor = { id: (await db.user.create({ data: { name: PREFIX, email: `${PREFIX}@example.invalid`,
    password: 'unused', role: 'SALES', branchId } })).id, role: 'SALES', branchId };
  // ลูกค้าทดสอบต้องเป็นฝั่ง TEST- เหมือนเครื่อง (รั้ว assertSameTestSide) — ชื่อขึ้นต้น PREFIX
  customerId = (await db.customer.create({ data: { name: PREFIX, phone: '0800000000', nationalId: '7900000000003' } })).id;
  const journal = new JournalAutoService(db); const companies = new CompanyResolverService(db);
  bookings = new BookingsService(db,
    new ShopBookingDepositTemplate(journal, db, companies),
    new ShopBookingForfeitTemplate(journal, db, companies),
    new ShopBookingDepositAppliedTemplate(journal, db, companies),
    new ShopCashSaleTemplate(journal, db, companies),
    new ShopBookingRefundTemplate(journal, db, companies),
    new ShopAccountResolver(db));
});
afterAll(async () => {
  // ล้างเฉพาะแถวของรอบนี้ (PREFIX) — ลำดับตาม FK: tender/JE ของใบ → รายการ → ใบ → ใบขาย → เครื่อง → ลูกค้า → ผู้ใช้ → สาขา
  const ids = (await db.booking.findMany({ where: { bookingNumber: { startsWith: 'BK-' }, customerId }, select: { id: true } })).map((b) => b.id);
  await db.shopTender.deleteMany({ where: { bookingId: { in: ids } } });
  const jes = await db.journalEntry.findMany({ where: { metadata: { path: ['bookingId'], string_contains: '' } }, select: { id: true, metadata: true } });
  const jeIds = jes.filter((j) => ids.includes(String((j.metadata as Record<string, unknown>)?.bookingId))).map((j) => j.id);
  await db.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
  await db.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
  await db.salesCommission.deleteMany({ where: { sale: { customerId } } });
  await db.bookingItem.deleteMany({ where: { bookingId: { in: ids } } });
  await db.booking.deleteMany({ where: { id: { in: ids } } });
  await db.sale.deleteMany({ where: { customerId } });
  await db.product.deleteMany({ where: { name: PREFIX } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.user.deleteMany({ where: { id: actor.id } });
  await db.branch.deleteMany({ where: { id: branchId } });
  await db.$disconnect();
});

describe('ล็อกเครื่องเมื่อรับมัดจำ', () => {
  it('รับมัดจำ → RESERVED + lockedProductId · ใบที่สองบนเครื่องเดียวกันได้ 409 และเงินไม่เข้า', async () => {
    const product = await seedProduct();
    const first = await createBooking(product.id);
    const second = await createBooking(product.id); // สร้างได้ (ยังไม่ล็อกตอนสร้าง — คำตัดสินข้อ 1)
    await pay(first.id);
    expect(await productStatus(product.id)).toBe('RESERVED');
    const locked = await db.booking.findUniqueOrThrow({ where: { id: first.id } });
    expect(locked.lockedProductId).toBe(product.id);
    expect(locked.lockedAt).toBeInstanceOf(Date);
    await expect(pay(second.id)).rejects.toThrow(LOCK_FAILED_MSG);
    expect((await db.booking.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PENDING_DEPOSIT');
    expect(await db.shopTender.count({ where: { bookingId: second.id } })).toBe(0);
  });

  it('สองใบรับมัดจำพร้อมกัน → สำเร็จใบเดียว', async () => {
    const product = await seedProduct();
    const a = await createBooking(product.id); const b = await createBooking(product.id);
    const results = await Promise.allSettled([pay(a.id), pay(b.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await productStatus(product.id)).toBe('RESERVED');
    expect(await db.booking.count({ where: { lockedProductId: product.id, deletedAt: null } })).toBe(1);
  });

  it('ยกเลิกใบ PAID → IN_STOCK + lockedProductId ว่าง + unlockedAt', async () => {
    const product = await seedProduct(); const b = await createBooking(product.id); await pay(b.id);
    await bookings.cancel(b.id, { cancelReason: 'ลูกค้าเปลี่ยนใจ' }, actor);
    expect(await productStatus(product.id)).toBe('IN_STOCK');
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.lockedProductId).toBeNull(); expect(row.unlockedAt).toBeInstanceOf(Date); expect(row.lockedAt).toBeInstanceOf(Date);
  });

  it('autoExpire ใบ PAID → IN_STOCK + EXPIRED', async () => {
    const product = await seedProduct(); const b = await createBooking(product.id); await pay(b.id);
    await db.booking.update({ where: { id: b.id }, data: { expireDate: new Date(Date.now() - 60_000) } });
    expect(await bookings.autoExpire(new Date())).toBeGreaterThanOrEqual(1);
    expect(await productStatus(product.id)).toBe('IN_STOCK');
    const row = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe('EXPIRED'); expect(row.lockedProductId).toBeNull();
  });

  it('แปลงขายจากเครื่องที่ล็อก → SOLD_CASH + lockedProductId ว่าง · ใบใหม่บนเครื่องเดิมหลังคืนสต็อกไม่ชน unique', async () => {
    const product = await seedProduct(); const b = await createBooking(product.id); await pay(b.id);
    const { sale } = await bookings.convertToSale(b.id, { collectBalance: true, paymentMethod: 'CASH' } as any, actor.id, actor);
    expect(sale.id).toBeTruthy();
    expect(await productStatus(product.id)).toBe('SOLD_CASH');
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).lockedProductId).toBeNull();
    // จำลองเครื่องกลับเข้าสต็อก (void ใบขาย) แล้วจองใหม่ — unique ต้องไม่ชนเพราะใบ CONVERTED ล้าง lockedProductId แล้ว
    await db.product.update({ where: { id: product.id }, data: { status: 'IN_STOCK' } });
    const again = await createBooking(product.id);
    await expect(pay(again.id)).resolves.toBeDefined();
  });

  it('partial unique: ตั้ง lockedProductId ซ้ำบนใบเปิดอีกใบตรง ๆ → P2002', async () => {
    const product = await seedProduct(); const a = await createBooking(product.id); const b = await createBooking(product.id);
    await pay(a.id);
    await expect(db.booking.update({ where: { id: b.id }, data: { lockedProductId: product.id } }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});
```

(ตัวสร้าง `BookingsService` ตรงกับ `apps/api/e2e/bookings-lifecycle.e2e-spec.ts` L58-62 — ถ้า constructor เปลี่ยนให้ยึดไฟล์นั้น · `metadata.string_contains` เป็นเพียงตัวกรองหยาบ ตัวจริงคือการเทียบ `bookingId` ใน JS · ใบขายจาก convert ไม่มีสัญญา จึงลบ `salesCommission` ก่อน `sale` ได้)

- [ ] **Step 2: รัน (ถ้ามี DB)** — `cd apps/api && npx vitest run --no-file-parallelism src/modules/bookings/__tests__/booking-lock.integration.spec.ts && cd ../..` → PASS 6 · ไม่มี DB = `npx tsc --noEmit -p apps/api/tsconfig.json` ต้องผ่าน และรายงานว่าไม่ได้รัน

- [ ] **Step 3: CI glob** — ใน `.github/workflows/deploy-gcp.yml` หลังบรรทัด `PO_FILES=$(ls src/modules/purchase-orders/__tests__/*.integration.spec.ts)` เพิ่ม:

```yaml
          # ล็อกเครื่องใบจอง (PR 2, 2026-10-05) — โฟลเดอร์ใหม่ ⇒ glob ใหม่ (glob ไม่ recurse เอง)
          BOOKINGS_FILES=$(ls src/modules/bookings/__tests__/*.integration.spec.ts)
```

และต่อท้ายคำสั่ง vitest หลัง `$PO_FILES` เพิ่มบรรทัด `            $BOOKINGS_FILES` (ใส่ ` \` ท้าย `$PO_FILES`)

- [ ] **Step 4: ปรับ API e2e `bookings-lifecycle.e2e-spec.ts`** — เทส `allows only one of two bookings to sell the same physical device` เปลี่ยนความหมายเป็น "ใบที่สองรับมัดจำไม่ได้แล้ว":

```ts
  it('locks the device on deposit: the second booking on the same device cannot take a deposit, and only the first converts', async () => {
    const { booking: first, product } = await createBooking();
    const second = await bookings.create({ customerId, branchId, depositAmount: 1000,
      items: [{ productId: product.id, description: prefix, quantity: 1, unitPrice: 10000 }],
    }, actor.id, actor);
    await pay(first.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('RESERVED');
    await expect(pay(second.id)).rejects.toThrow('เครื่องนี้ถูกขายหรือย้ายสาขาไปแล้ว');
    await bookings.convertToSale(first.id, { collectBalance: true, paymentMethod: 'CASH' }, actor.id, actor);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe('SOLD_CASH');
    expect(await db.sale.count({ where: { productId: product.id } })).toBe(1);
    expect((await db.booking.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PENDING_DEPOSIT');
  });
```

เทส `rolls back conversion … foreign branch`: หลัง `pay(booking.id)` เครื่องเป็น RESERVED แล้ว การย้ายสาขาด้วย `db.product.update` ยังทำได้ (เทสเขียนตรง) — assertion เดิม (`rejects.toThrow`, สถานะใบยัง PAID) ยังถูก; เพิ่ม `expect(product.status).toBe('RESERVED')` หลังล้มเพื่อยืนยันล็อกไม่หลุด. เคส `damaged`/`quantity`/`multiple items` ไม่เปลี่ยน.

Run (ถ้ามี DB): `bash tools/test-chat-credit.sh` (ชุดที่ครอบไฟล์นี้) หรือรายงานว่ารันไม่ได้

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/bookings/__tests__/booking-lock.integration.spec.ts .github/workflows/deploy-gcp.yml apps/api/e2e/bookings-lifecycle.e2e-spec.ts
git commit -m "test(bookings): integration ล็อกเครื่องบน DB จริง + CI glob BOOKINGS_FILES · e2e ใบที่สองรับมัดจำไม่ได้"
```

---

### Task 7: เว็บ — แผงรายละเอียดรู้จักล็อกของตัวเอง · ไทม์ไลน์ · ประโยคในฟอร์ม/หน้าว่าง

**Files:**
- Modify: `apps/web/src/pages/BookingsPage/types.ts` (interface `Booking` L32-53)
- Modify: `apps/web/src/pages/BookingsPage/components/BookingDetailSheet.tsx` (`productState` L89-107)
- Modify: `apps/web/src/pages/BookingsPage/components/BookingTimeline.tsx` (`describeEvent` L22-66)
- Modify: `apps/web/src/pages/BookingsPage/components/CreateBookingDialog.tsx` (Step 2 `right` L310-314)
- Modify: `apps/web/src/pages/BookingsPage/components/BookingEmptyState.tsx` (บรรทัดกติกา L64-65)
- Test: `apps/web/src/pages/BookingsPage/__tests__/BookingDetailSheet.test.tsx`, `__tests__/BookingTimeline.test.tsx` (สร้างถ้าไม่มี), `__tests__/CreateBookingDialog.test.tsx`

**Interfaces:**
- Consumes: API คืน `lockedProductId`/`lockedAt`/`unlockedAt` (scalar ของ `Booking` มากับ include เดิมอัตโนมัติ) · event kind ใหม่ `BOOKING_UNLOCK_SKIPPED` · `BOOKING_DEPOSIT_PAID.data.lockedProductId`
- Produces: `productState` คืน `{ label: 'ล็อกไว้ให้ลูกค้ารายนี้แล้ว', tone: 'ok' }` เมื่อ `item.product.status === 'RESERVED' && booking.lockedProductId === item.productId` และ `{ label: 'พร้อมขาย · จะล็อกเมื่อรับมัดจำ', tone: 'ok' }` สำหรับ PENDING+IN_STOCK (spec §3.3)

- [ ] **Step 1: เทสที่ล้ม**

`BookingDetailSheet.test.tsx` — เพิ่มใน describe ของ productState/ปุ่มเงิน (ใช้ helper render ของไฟล์; mock `GET /bookings/:id` ให้คืน booking ด้านล่าง):

```ts
  it('ใบ PAID ที่ล็อกเครื่องของตัวเอง (RESERVED + lockedProductId ตรง) → ป้าย "ล็อกไว้ให้ลูกค้ารายนี้แล้ว" และปุ่มแปลงขายเปิด', async () => {
    mocks.booking = {
      ...paidBooking(),
      lockedProductId: 'prod-1',
      items: [{ ...paidBooking().items[0], productId: 'prod-1', product: { id: 'prod-1', name: 'iPhone 15', status: 'RESERVED', branchId: 'br-1' } }],
    };
    await renderSheet();
    expect(await screen.findByText('ล็อกไว้ให้ลูกค้ารายนี้แล้ว')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ออกใบขาย|รับส่วนต่าง/ })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ใบ PAID ที่เครื่องเป็น RESERVED ของคนอื่น (lockedProductId ว่าง) → ยังเป็น "มีคนอื่นถือเครื่องอยู่" และปุ่มเงินปิด', async () => {
    mocks.booking = {
      ...paidBooking(), lockedProductId: null,
      items: [{ ...paidBooking().items[0], productId: 'prod-1', product: { id: 'prod-1', name: 'iPhone 15', status: 'RESERVED', branchId: 'br-1' } }],
    };
    await renderSheet();
    expect(await screen.findByText(/มีคนอื่นถือเครื่องอยู่/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('ใบ PENDING + เครื่อง IN_STOCK → "พร้อมขาย · จะล็อกเมื่อรับมัดจำ"', async () => {
    mocks.booking = pendingBooking(); // helper เดิมของไฟล์ (เครื่อง IN_STOCK)
    await renderSheet();
    expect(await screen.findByText('พร้อมขาย · จะล็อกเมื่อรับมัดจำ')).toBeInTheDocument();
  });
```

`BookingTimeline.test.tsx` (ถ้ายังไม่มีไฟล์ ให้สร้างและเทส `describeEvent` ตรง ๆ):

```ts
import { describe, it, expect } from 'vitest';
import { describeEvent } from '../components/BookingTimeline';

describe('describeEvent — ล็อกเครื่อง (PR 2)', () => {
  const base = { id: 'e1', at: '2026-10-05T03:00:00.000Z', actor: { id: 'u1', name: 'สมชาย' } };
  it('รับมัดจำที่ล็อกเครื่อง → บอกว่าล็อกแล้ว', () => {
    expect(describeEvent({ ...base, kind: 'BOOKING_DEPOSIT_PAID', data: { depositMethod: 'CASH', lockedProductId: 'prod-1' } }).title)
      .toBe('รับมัดจำ · เงินสด · ล็อกเครื่องให้ลูกค้าแล้ว');
  });
  it('รับมัดจำใบยุคก่อน (ไม่ล็อก) → ข้อความเดิม', () => {
    expect(describeEvent({ ...base, kind: 'BOOKING_DEPOSIT_PAID', data: { depositMethod: 'CASH', lockedProductId: null } }).title)
      .toBe('รับมัดจำ · เงินสด');
  });
  it('BOOKING_UNLOCK_SKIPPED → เตือนว่าปลดล็อกไม่สำเร็จ', () => {
    const r = describeEvent({ ...base, kind: 'BOOKING_UNLOCK_SKIPPED', data: { reason: 'PRODUCT_NOT_RESERVED' } });
    expect(r.title).toBe('ปลดล็อกเครื่องไม่ได้ — สถานะเครื่องถูกเปลี่ยนไปแล้ว ตรวจสต็อก');
    expect(r.tone).toBe('destructive');
  });
});
```

`CreateBookingDialog.test.tsx` — เปลี่ยนเทสที่ assert ว่า **ไม่มี** `/ล็อก/` (เพิ่มใน PR 1 fix wave) เป็น assert ว่ามีข้อความ `เครื่องจะถูกล็อกไว้ให้ลูกค้าทันทีที่รับมัดจำ · ก่อนรับมัดจำยังขายได้ตามปกติ`

- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/web test -- --run src/pages/BookingsPage` → FAIL ที่เทสใหม่/ที่แก้

- [ ] **Step 3: implement**

`types.ts` ใน `Booking` เพิ่ม:

```ts
  /** PR 2 — เครื่องที่ใบนี้ล็อกไว้ตอนรับมัดจำ (ล้างเมื่อยกเลิก/หมดอายุ/ขาย) */
  lockedProductId?: string | null;
  lockedAt?: string | null;
  unlockedAt?: string | null;
```

`BookingDetailSheet.tsx` แทน `productState` ทั้งฟังก์ชัน:

```tsx
function productState(booking: Booking, item?: BookingItem): { label: string; tone: 'ok' | 'muted' | 'bad' } {
  if (booking.status === 'CONVERTED') return { label: 'ส่งมอบแล้ว', tone: 'muted' };
  if (!item?.productId) return { label: 'ไม่ได้ผูกเครื่อง — แปลงขายไม่ได้', tone: 'bad' };
  const product = item.product;
  const s = product?.status;
  if (!s) return { label: 'ไม่พบข้อมูลเครื่อง', tone: 'muted' };
  if (product.branchId !== booking.branch.id) return { label: 'เครื่องย้ายสาขาไปแล้ว', tone: 'bad' };
  // PR 2: ใบ PAID ล็อกเครื่องของตัวเองเป็น RESERVED — "ของเรา" = พร้อมส่งมอบ ไม่ใช่คนอื่นถือ
  if (s === 'RESERVED' && booking.lockedProductId === item.productId) {
    return { label: 'ล็อกไว้ให้ลูกค้ารายนี้แล้ว', tone: 'ok' };
  }
  if (s === 'IN_STOCK') {
    return booking.status === 'PENDING_DEPOSIT'
      ? { label: 'พร้อมขาย · จะล็อกเมื่อรับมัดจำ', tone: 'ok' }
      : { label: 'พร้อมขาย · ยังอยู่ในสต็อก', tone: 'ok' };
  }
  if (s === 'RESERVED') return { label: 'มีคนอื่นถือเครื่องอยู่ (จอง/สัญญาร่าง)', tone: 'bad' };
  if (s.startsWith('SOLD')) return { label: 'ถูกขายไปแล้ว — ต้องยกเลิกใบนี้แล้วออกใบใหม่', tone: 'bad' };
  return { label: `สถานะเครื่อง ${s}`, tone: 'muted' };
}
```

`BookingTimeline.tsx` — ใน `describeEvent`:

```ts
    case 'BOOKING_DEPOSIT_PAID': {
      const method = METHOD_LABEL[str(d.depositMethod)] ?? str(d.depositMethod);
      const parts = ['รับมัดจำ'];
      if (method) parts.push(method);
      if (str(d.lockedProductId)) parts.push('ล็อกเครื่องให้ลูกค้าแล้ว');
      return { title: parts.join(' · '), tone: 'success' };
    }
    case 'BOOKING_UNLOCK_SKIPPED':
      return { title: 'ปลดล็อกเครื่องไม่ได้ — สถานะเครื่องถูกเปลี่ยนไปแล้ว ตรวจสต็อก', tone: 'destructive' };
```

`CreateBookingDialog.tsx` Step 2 `right`:

```tsx
            right={
              <span className="text-xs text-muted-foreground leading-snug">
                เครื่องจะถูกล็อกไว้ให้ลูกค้าทันทีที่รับมัดจำ · ก่อนรับมัดจำยังขายได้ตามปกติ
              </span>
            }
```

`BookingEmptyState.tsx` บรรทัดกติกา (L64-65) → `ใบจองใช้ได้ 7 วันโดยค่าเริ่มต้น (แก้ได้ทุกใบ) · รับมัดจำแล้วเครื่องถูกล็อกให้ลูกค้า · เลยกำหนดแล้วมัดจำที่รับไว้จะถูกริบ · ยกเลิกก่อนหมดอายุคืนมัดจำเต็มจำนวน`

- [ ] **Step 4: รันผ่าน** — `npm --prefix apps/web test -- --run src/pages/BookingsPage` · `./tools/check-types.sh web` · `cd apps/web && npx eslint src/pages/BookingsPage && cd ../..` · Prettier

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): แผงรายละเอียดรู้จักเครื่องที่ล็อกให้ใบนี้ · ไทม์ไลน์บอกล็อก/ปลดล็อกไม่สำเร็จ · คืนประโยคล็อกในฟอร์ม"
```

---

### Task 8: หน้าสินค้าแสดง "จองไว้ · BK-… (ลูกค้า)" ลิงก์ไปใบจอง (spec §4 ผลต่อที่อื่น)

**Files:**
- Modify: `apps/api/src/modules/products/products.service.ts` (`productInclude` L58-79)
- Modify: `apps/web/src/pages/StockPage/components/StockProductCells.tsx` (`StockProductStatus` L246-264) + type `StockProduct` (grep `interface StockProduct` ใน `apps/web/src/pages/StockPage/`)
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (`subtitleParts` L389-396) + type ของ product detail (grep ตำแหน่งที่ประกาศ `activeContract`)
- Test: `apps/web/src/pages/StockPage/components/__tests__/StockProductCells.test.tsx` (สร้างถ้าไม่มี)

**Interfaces:**
- Consumes: relation `Product.lockedByBookings` (Task 1)
- Produces: payload สินค้าทุกตัวที่ใช้ `productInclude` มี `lockedByBookings: { id: string; bookingNumber: string; customer: { name: string } }[]` (0–1 แถว) · เว็บแสดงชิปลิงก์เมื่อ `status === 'RESERVED'` และมีแถว

- [ ] **Step 1: เทสที่ล้ม (web)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StockProductStatus } from '../StockProductCells';

const base = { id: 'p1', status: 'RESERVED', branch: { id: 'br-1', name: 'ลาดพร้าว' } } as any;

describe('StockProductStatus — เครื่องที่ใบจองล็อก (PR 2)', () => {
  it('RESERVED + lockedByBookings → ชิป "จองไว้ · BK-…" ลิงก์ไปใบจอง', () => {
    render(<MemoryRouter><StockProductStatus product={{ ...base, lockedByBookings: [{ id: 'bk-1', bookingNumber: 'BK-20260517-0001', customer: { name: 'สมหญิง' } }] }} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /จองไว้ · BK-20260517-0001 \(สมหญิง\)/ });
    expect(link).toHaveAttribute('href', '/bookings?bookingId=bk-1');
  });
  it('RESERVED โดยไม่มีใบจอง (สัญญาร่าง/ปลดจองทั่วไป) → ป้ายเดิม ไม่มีลิงก์', () => {
    render(<MemoryRouter><StockProductStatus product={{ ...base, lockedByBookings: [] }} /></MemoryRouter>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/จอง|ติดจอง/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/web test -- --run src/pages/StockPage` → FAIL

- [ ] **Step 3: implement**

API `productInclude` เพิ่มหลัง `productPhotos`:

```ts
  // PR 2 ล็อกเครื่องใบจอง — ใบ PAID ที่ล็อกเครื่องนี้ (0–1 แถวตาม partial unique) ให้หน้าสต็อก/รายละเอียดชี้ไปใบจอง
  lockedByBookings: {
    where: { status: 'PAID' as const, deletedAt: null },
    select: { id: true, bookingNumber: true, customer: { select: { name: true } } },
    take: 1,
  },
```

web type `StockProduct` เพิ่ม `lockedByBookings?: { id: string; bookingNumber: string; customer: { name: string } }[]` (และ type ของ product detail เช่นกัน). `StockProductStatus`:

```tsx
export function StockProductStatus({ product }: { product: StockProduct }) {
  const lock = product.status === 'RESERVED' ? product.lockedByBookings?.[0] : undefined;
  return (
    <div className="flex flex-wrap gap-1">
      {(product.stockGroup?.statuses ?? [product.status]).map((value) => {
        const status = statusLabels[value];
        if (value === 'RESERVED' && lock) {
          return (
            <Link
              key={value}
              to={`/bookings?bookingId=${lock.id}`}
              className={cn(
                'inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-snug underline-offset-2 hover:underline',
                status?.className || 'bg-muted text-foreground',
              )}
            >
              จองไว้ · {lock.bookingNumber} ({lock.customer.name})
            </Link>
          );
        }
        return (
          <span
            key={value}
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-snug',
              status?.className || 'bg-muted text-foreground',
            )}
          >
            {status?.label || value}
          </span>
        );
      })}
    </div>
  );
}
```

(import `Link` จาก `react-router-dom`; ถ้า `StockProductCells` ถูกเรนเดอร์นอก Router ที่ไหน ให้เทสนั้น wrap `MemoryRouter`)

`ProductDetailPage/index.tsx` หลัง `subtitleParts` เพิ่มชิ้นส่วน: ถ้า `product.status === 'RESERVED' && product.lockedByBookings?.[0]` ให้ `subtitleParts.push(\`จองไว้ · ${lock.bookingNumber} (${lock.customer.name})\`)` และวาง `<Link to={`/bookings?bookingId=${lock.id}`} className="text-sm underline-offset-2 hover:underline">เปิดใบจอง</Link>` ข้างป้ายสถานะ (ตำแหน่งเดียวกับที่หน้านี้วางลิงก์สัญญาสำหรับ `isSoldInstallment` — ดูโค้ดรอบ `statusCfg`)

- [ ] **Step 4: รันผ่าน** — web StockPage + ProductDetailPage tests · typecheck all (API include เปลี่ยนชนิดคืน — `./tools/check-types.sh api` ต้องผ่าน; ถ้ามี spec ของ products ที่ snapshot `productInclude` ให้ปรับ) · eslint ทั้งสองโฟลเดอร์

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/products/products.service.ts apps/web/src/pages/StockPage apps/web/src/pages/ProductDetailPage
git commit -m "feat(stock): เครื่อง RESERVED ที่ใบจองล็อก แสดง \"จองไว้ · BK-…\" ลิงก์ไปใบจอง (รายการสต็อก + รายละเอียดสินค้า)"
```

---

### Task 9: bump version · ตรวจรวม · ปิด PR

**Files:**
- Modify: `apps/web/package.json` (`version`)

- [ ] **Step 1: bump** — อ่าน `git show origin/main:apps/web/package.json | grep version` ก่อน แล้วตั้งเป็นเลขถัดไป (คาด `26.10.9`) · commit `chore(web): bump 26.10.9`
- [ ] **Step 2: ตรวจรวมบน tree สุดท้าย** — `./tools/check-types.sh all` · `npm --prefix apps/api test -- --runInBand src/modules/bookings src/modules/products/services` · `npm --prefix apps/web test -- --run` (ทั้งชุด) · `cd apps/web && npx eslint src/pages/BookingsPage src/pages/StockPage src/pages/ProductDetailPage && npx playwright test --list e2e/bookings.spec.ts e2e/flows/booking-deposit-convert.spec.ts e2e/sales-menu-regression.spec.ts && cd ../..` · integration spec (Task 6) ถ้ามี DB
- [ ] **Step 3: ผู้ตรวจอิสระอ่านทั้งสาขาก่อน push** (กติกาโปรเจกต์) → push → เปิด PR เข้า `main` (retarget ถ้าแตกจาก `feat/bookings-redesign`) · คำอธิบาย PR ต้องมี: ล็อกเริ่มมีผลตั้งแต่ deploy — ใบ PAID ที่รับมัดจำก่อน deploy **ไม่ถูกล็อก** (lockedProductId ว่าง) จนกว่าจะยกเลิกแล้วออกใบใหม่ · `POST /products/:id/unreserve` ปฏิเสธเครื่องที่ใบจองล็อก · migration additive 1 ไฟล์ · ไม่มี JE ใหม่

---

## Self-review (ทำแล้วตอนเขียนแผน)

- **Spec coverage:** §4 ล็อกตอนรับมัดจำ (Task 2) · ปลดล็อก cancel/autoExpire + `BOOKING_UNLOCK_SKIPPED` (Task 3) · convert claim RESERVED (Task 4) · partial unique (Task 1, พิสูจน์ Task 6) · ผลต่อที่อื่น: POS/สัญญา/ของแถม ปฏิเสธ RESERVED อยู่แล้ว (ไม่ต้องแก้ — `assertSaleProductEligible`) · `product-hold` remedy "ยกเลิกจองก่อน" ตอนนี้มีปุ่มจริง (ไม่แก้ข้อความ) · หน้ารายการสินค้า/รายละเอียดสินค้า "จองไว้ · BK-…" (Task 8) · §3.3 ป้ายสด 3 แบบ (Task 7) · §3.2 ประโยคล็อกในฟอร์ม (Task 7) · §5.1/§5.5 migration (Task 1 — ชื่อเลื่อนเป็น 20261019 เพราะ prefix ชน) · §6.1 `pay-deposit` ส่วน `slipTicket`/ใบรับมัดจำ = PR 3/5 ไม่อยู่ในแผนนี้ · §7 ไม่มี JE
- **เพิ่มจาก spec (ruling):** ด่าน `unreserve` (Task 5) — spec ไม่ได้พูด แต่ปล่อยไว้ = ปุ่มปลดจองทั่วไปทำลายล็อกได้ · ล้าง `lockedProductId` ตอน convert (spec พูดเฉพาะ cancel/expire) — จำเป็นต่อ unique index
- **Type consistency:** `LOCK_FAILED_MSG` export (Task 2) ใช้ใน Task 6 · `unlockBookedDevice` คืน `'UNLOCKED' | 'SKIPPED' | 'NONE'` (Task 3) · `BOOKING_UNLOCK_SKIPPED` อยู่ใน `BOOKING_EVENT_ACTIONS` (Task 3) และ `describeEvent` (Task 7) · `lockedByBookings` ชื่อเดียวกันใน schema (Task 1), `productInclude` (Task 8), web type (Task 8)
- **Review Focus → เทส:** 1→Task 6 (ชนกัน) · 2→Task 3 (count 0) · 3→Task 4 (legacy IN_STOCK) · 4→Task 5 · 5→Task 7
- **ค้างไป PR 3:** `BookingDepositReceipt` · ตอนนี้ `payDeposit` ยังไม่ออกใบรับมัดจำ
