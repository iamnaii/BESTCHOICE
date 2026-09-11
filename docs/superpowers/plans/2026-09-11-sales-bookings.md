# Sales Booking Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** ใบจองรับเงินและขายต่อได้โดยยอดเงิน สินค้า สาขา และสถานะตรงกัน แม้มีคำขอพร้อมกัน

**Architecture:** รักษา Booking เป็นเอกสาร SHOP และ convert แบบ CASH ใช้ row lock/status claim ใน transaction เดิม แยก product eligibility เป็น policy เล็กที่ writer และ booking เรียกได้ ไม่รวม writer ทั้งก้อนและไม่สร้าง ProductReservation อัตโนมัติ

**Tech Stack:** NestJS/Prisma/PostgreSQL, Decimal, React Query, Jest/Vitest

**Spec:** [แผนหลัก](2026-09-11-sales-remediation.md), audit F02/F03/F04/F08/F15 และ scrutinize S06/S07

B1-B4 implemented and verified. See [execution evidence](../../review/2026-09-11-sales/remediation-verification.md); mobile table layout and pagination continue in D4/D2.

## Global Constraints

- ใช้ข้อกำหนดแผนหลักทั้งหมด; `PAID` เปลี่ยนเงิน/เจ้าของ/เครื่อง/สาขาด้วย PATCH ไม่ได้
- รักษา JE idempotency keys เดิมและนโยบาย PAID expiry ที่อนุมัติอยู่; PENDING expiry ไม่ลงบัญชีเงิน
- convert ชุดแรกต้องมีหนึ่งรายการที่ผูก productId และ quantity=1; ใบเก่าที่ไม่ตรงยังอ่านได้ แต่ต้องไม่ขายตกหล่น
- Test concurrency ใช้ PostgreSQL จริงผ่าน harness; mock `claim.count=0` อย่างเดียวไม่พอ

## File Map

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/bookings/bookings.service.ts` | แก้ state transitions, mutation guards, locking, conversion |
| `apps/api/src/modules/bookings/dto/{create-booking,update-booking,pay-deposit,convert-booking}.dto.ts` | DTO ของแต่ละคำสั่ง; ห้ามใช้ DTO เดียวแก้ทุกสถานะ |
| `apps/api/src/modules/bookings/booking-expire.cron.ts` | คง schedule; รองรับผล expiry ทั้ง pending/paid |
| `apps/api/src/modules/sales/services/sale-product-policy.ts` (ใหม่) | stock/branch/damaged policy ที่รับ actor |
| `apps/api/src/modules/sales/services/{sale-creation,sale-writer}.service.ts` | ใช้ policy ร่วมในเส้นทางขายปกติและส่ง actor/ack ถึง transaction |
| `apps/web/src/pages/BookingsPage.tsx` | product picker, lock fields, method/summary, expiry message |
| `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` | service regressions |
| `apps/api/e2e/bookings-lifecycle.e2e-spec.ts` (ใหม่) |เงินจริงจำลองผ่าน ledger จริง, stock races, state races |
| `apps/web/src/pages/BookingsPage.test.tsx` | rendered forms/actions |
| `apps/web/src/lib/date.ts`, `apps/web/src/lib/date.test.ts` | แปลงวันหมดอายุที่เลือกเป็น cutoff เวลาไทย |

## Task B1: ทำ PAID immutable และปิด read/write race

**Interfaces:** คง `BookingsService.update(id, dto, user)` และ `RequestUser` เดิม; เพิ่ม private helper ใน service `lockBooking(tx: Prisma.TransactionClient, id: string): Promise<void>` สำหรับทุก mutation ที่แข่งกัน ไม่ export abstraction ใหม่

- [x] ใน booking service tests ใช้ `service`, `prisma`, `SALES_BR1` จาก beforeEach เดิม เพิ่ม paid fixture พร้อม depositAmount/totalAmount และ cases แก้ deposit/items/customer/branch:

```ts
prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'PAID', branchId: 'br-1',
  depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000) });
await expect(service.update('bk-1', { depositAmount: 2000 }, SALES_BR1))
  .rejects.toThrow(BadRequestException);
```

- [x] รัน `npm run test --workspace=apps/api -- --runInBand bookings.service.spec.ts`; คาด FAIL เพราะ PATCH ยังสำเร็จ
- [x] หลังเปิด transaction ล็อกแถว แล้วอ่าน status, branch, deposit, total จาก tx ใหม่ก่อนตรวจสิทธิ์/แก้ไข; payDeposit/cancel/convert/expire ใช้แถวเดียวกันหรือ atomic predicate ที่แข่งกับ lock ได้:

```ts
await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`;
const financialEdit = dto.customerId !== undefined || dto.branchId !== undefined ||
  dto.items !== undefined || dto.depositAmount !== undefined;
if (existing.status === 'PAID' && financialEdit) {
  throw new BadRequestException('รับมัดจำแล้ว ไม่สามารถแก้ลูกค้า สาขา สินค้า หรือยอดเงินในใบจองนี้');
}
const nextDeposit = new Prisma.Decimal(dto.depositAmount ?? existing.depositAmount);
const nextTotal = dto.items ? this.computeTotal(dto.items) : new Prisma.Decimal(existing.totalAmount);
this.assertDepositInRange(nextDeposit, nextTotal);
```

คอลัมน์ `bookings.id` เป็น TEXT ใน migration จริง จึงไม่ cast parameter เป็น uuid แม้ค่า ID จะหน้าตาเหมือน UUID

`existing` ใน block นี้ต้องเป็นแถวที่อ่านหลัง lock ผ่าน tx และ scope แล้ว ไม่ใช่ค่าอ่านนอก transaction เดิม

- [x] กรณี PENDING แก้เฉพาะ items ให้ตรวจ deposit เดิมเทียบ total ใหม่; delete/create items และ booking update อยู่ transaction เดียวกัน; PAID form ส่งเฉพาะ fields ที่แก้ได้และแสดงเหตุผล
- [x] เพิ่ม DB tests update↔payDeposit และ cancel↔payDeposit สอง connection: ผลสุดท้ายต้องมีแค่สถานะ/JE ที่สอดคล้องกัน ห้าม PAID พร้อมยอดที่ไม่ตรง journal หรือ CANCELED ที่ไม่คืนเงินซึ่งรับก่อน lock; การ retry ไม่เพิ่ม receipt/JE ซ้ำ
- [x] ทดสอบ rollback เมื่อ template ล้มเหลว: booking/items/เงินต้องไม่เปลี่ยน แล้วรัน harness + web tests + `local:check`; review/commit `fix(bookings): protect received deposits and serialize mutations`

## Task B2: ผูกเครื่องจริงและตรวจนโยบายก่อนตัดสต็อก

**Interfaces:** policy ใหม่ใช้ product snapshot ที่อ่านใน tx และ actor; คง `ConvertBookingDto` CASH เพิ่ม `previouslyDamagedAcknowledged?: boolean` ที่ validate Boolean ไม่รับ string ตามใจ

```ts
export type SaleProductActor = { role: string; branchId?: string | null };
export type SaleProductState = {
  status: string; deletedAt: Date | null; branchId: string | null;
  wasPreviouslyDamaged: boolean;
};
export function assertSaleProductEligible(
  product: SaleProductState, branchId: string, actor: SaleProductActor,
  previouslyDamagedAcknowledged = false,
): void;
```

- [x] เพิ่ม policy tests ที่ SALES/sาขา A ปฏิเสธเครื่องสาขา B และเครื่องเคย damaged แม้ส่ง acknowledge; OWNER ที่ acknowledge ผ่านเฉพาะเครื่องตรงสาขาเอกสาร:

```ts
expect(() => assertSaleProductEligible({ status: 'IN_STOCK', deletedAt: null,
  branchId: 'b', wasPreviouslyDamaged: false }, 'a', { role: 'SALES', branchId: 'a' }))
  .toThrow(ForbiddenException);
```

- [x] รัน unit tests ใหม่ `sale-product-policy.spec.ts` และ booking tests; คาด FAIL ก่อนมี policy/guard
- [x] policy ตรวจ `IN_STOCK`, not deleted, product.branchId=transaction branch, scope actor และ damaged acknowledgement+roles OWNER/FINANCE_MANAGER ตามกติกาขายเดิม การข้ามสาขาโดย role ไม่เท่ากับสิทธิ์ย้ายเครื่องให้เอกสารคนละสาขา; อย่าขยายสิทธิ์ controller เพราะ policy อนุญาต role เพิ่ม
- [x] โหลด product ใน tx หลัง lock/claim; ทั้ง booking convert และ writer ส่ง actor/ack จริงถึง validator; คง test-side check ลูกค้า/สินค้า/ของแถมเดิม; booking ตัด stock ด้วย updateMany ที่ where มี id/status=IN_STOCK/branchId/deletedAt และ throw ConflictException เมื่อ count ไม่ใช่1 เพื่อไม่ให้สองใบจองขายเครื่องเดียวกันได้ ส่วน writer คง Serializable retry เดิม
- [x] ก่อนสร้าง Sale บังคับขอบเขตที่ writer รองรับ:

```ts
if (booking.items.length !== 1 || !booking.items[0].productId || booking.items[0].quantity !== 1) {
  throw new BadRequestException('แปลงขายได้เมื่อใบจองมีสินค้า 1 เครื่อง จำนวน 1 ชิ้น');
}
```

- [x] UI เพิ่ม product picker แบบค้น API และสาขา แสดง IMEI/Serial/สถานะ; reuse selection logic จาก POS แต่แยกเป็น component ร่วมเฉพาะเมื่อไม่ลาก POS-specific dependencies มาด้วย การเลือกสินค้าใหม่ทำได้ตอน PENDING; legacy PAID ที่ขาดเครื่อง/หลายรายการแสดงสาเหตุและทางยกเลิก/คืนเงินเดิม ไม่เปิดช่องแก้ยอดข้าม B1
- [x] DB race สองใบจอง/หนึ่งเครื่อง: `Promise.allSettled` สอง convert แล้วต้องสำเร็จหนึ่งรายการ อีกคำขอได้ conflict/สินค้าไม่พร้อม; Sale หนึ่งใบ stock ถูกตัดหนึ่งครั้ง deposit applied หนึ่งชุด ของคำขอแพ้ยังไม่ CONVERTED ไม่มี JE ค้าง; ตรวจ retry duplicate booking เช่นเดียวกัน
- [x] รัน unit/web/harness + `local:check`, review/commit `fix(bookings): validate the complete product before conversion`

## Task B3: วิธีรับมัดจำและส่วนต่างตรงบัญชี SHOP

**Files เพิ่มเติม:** อ่าน/ทดสอบ `apps/api/src/modules/journal/shop-account-resolver.service.ts`, `cpa-templates/shop-booking-deposit-applied.template.ts`; ไม่เปลี่ยน global CashAccountSelect default ที่ FINANCE ใช้อยู่

**Interfaces:** payDeposit ใช้ method ที่รองรับจริง CASH/BANK_TRANSFER/QR_EWALLET; `depositAccountCode` เป็น optional compatibility input แต่ค่าที่เก็บต้องเป็นค่าที่ backend resolve จริง หากส่ง code ที่ไม่ตรงให้ตอบ 400 พร้อมบัญชีที่ควรใช้; convert paymentMethod เป็น enum เดียวกันและจำเป็นเมื่อมีส่วนต่าง

- [x] เพิ่ม service/DB test: มัดจำ CASH1000 แล้วส่วนต่าง BANK_TRANSFER9000 จากยอดขาย10000 ต้องมี net cash debit1000, net bank debit9000, booking liability0 และ sale.amountReceived10000; กลับวิธีรับและ full prepay ต้องถูกด้วย
- [x] รัน `bash tools/test-chat-credit.sh`; คาด FAIL ที่ metadata หรือวิธีรับ/บัญชีส่วนต่างก่อนแก้
- [x] Resolve ใน transaction และบันทึกค่าจริง:

```ts
const accountCode = await this.shopAccountResolver.resolveInflowCashAccount(
  booking.branchId, dto.depositMethod, tx,
);
if (dto.depositAccountCode && dto.depositAccountCode !== accountCode) {
  throw new BadRequestException('บัญชีรับเงินไม่ตรงกับสาขาและวิธีรับเงิน');
}
// booking.update data.depositAccountCode = accountCode
```

- [x] UI เลือกวิธีรับเงินและแสดงบัญชีที่จะใช้แบบอ่านอย่างเดียวจาก SHOP context; เลิกเสนอ 11-* FINANCE codes; migration compatibility ใช้ endpoint/DTO ที่รับ omitted code ได้ก่อนอัปเดต client; ผู้เรียกเก่าที่ส่งผิดได้รับ error ชัด ไม่รับแล้วเก็บ metadata เท็จ
- [x] Convert dialog แสดงยอดเต็ม/มัดจำที่รับแล้ว/ส่วนต่างและ method ของส่วนต่างแยกกัน หาก full prepay ไม่ขอ method ของเงินที่ไม่มีการรับเพิ่ม
- [x] ตรวจ JE full-sale + deposit-applied เดิมอย่างระวัง: reversal ของ cash leg ที่สร้างกลางทางต้องหักจากบัญชีของ full-sale leg เดียวกัน ไม่หักจากบัญชีมัดจำเดิมแล้วทำให้วิธีรับสองครั้งผิด ทดสอบยอดบัญชีสุทธิ ไม่ตรวจเพียงชื่อ template ว่าถูกเรียก
- [x] รัน unit/web/harness + `local:check`, review/commit `fix(bookings): persist the resolved receipt account and balance tender`

## Task B4: หมดอายุสอดคล้องกันทุก action

**Interfaces:** ใช้ instant UTC ใน DB; จุดปฏิเสธ `expireDate <= now`; date input ของ UI เป็น YYYY-MM-DD แล้วสร้าง cutoff ของวันถัดไปเวลา00:00 Bangkok แบบ explicit +07:00 (ไม่ขึ้นกับ browser TZ); cron ใช้ cutoff `now` เดียวและ recheck expireDate ใน claim งานนี้ไม่ต้องรอ D1

- [x] เพิ่ม unit+DB cases expired PENDING/PAID, ก่อน/ตรง/หลัง cutoff, ต่อวันหมดอายุแข่งกับ cron และ convert แข่งกับ expiry:

```ts
jest.useFakeTimers().setSystemTime(new Date('2026-09-11T17:00:00.000Z'));
prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'PAID', branchId: 'br-1',
  expireDate: new Date('2026-09-11T17:00:00.000Z'), depositAmount: new Prisma.Decimal(1000),
  totalAmount: new Prisma.Decimal(10000),
  items: [{ productId: 'prod-1', quantity: 1, amount: new Prisma.Decimal(10000) }] });
await expect(service.convertToSale('bk-1', { collectBalance: true }, SALES_BR1.id, SALES_BR1))
  .rejects.toThrow(/หมดอายุ/);
expect(prisma._tx.sale.create).not.toHaveBeenCalled();
jest.useRealTimers();
```

- [x] รัน `bookings.service.spec.ts` ก่อนแก้; คาด FAIL เพราะ convert ยังไม่ปฏิเสธด้วยข้อความหมดอายุ; เพิ่ม afterEach คืน timers แม้ assertion ล้มเหลว และหลัง B1 อ่านผ่าน tx ให้ fixture ของ tx.booking.findFirst คืนแถวเดียวกันด้วย
- [x] pay/convert ตรวจหลัง row lock; update ห้ามยืดวันของใบหมดอายุเพื่อข้ามการริบเดิม; หากธุรกิจต้องการคืนสภาพเป็นคำสั่งใหม่แยก ไม่เป็น PATCH loophole
- [x] cron candidate รวม PENDING_DEPOSIT/PAID แล้ว claim ด้วย status+expireDate cutoff+deletedAt; อ่านเงิน/สถานะหลัง lock ไม่ใช้ยอด candidate ที่ stale:

```ts
where: { id: candidate.id, status: existing.status, expireDate: { lte: now }, deletedAt: null }
// forfeit only when existing.status === 'PAID' && existing.depositAmount.gt(0)
```

- [x] บนหน้า list/detail แสดงหมดอายุตามเวลาแม้ status update จาก cron ยังมาไม่ถึง พร้อมระงับปุ่มรับเงิน/แปลงและปุ่ม reload; คำอธิบาย “รอประมวลผลหมดอายุ” แยกจาก “รับมัดจำแล้ว”
- [x] เพิ่ม `toBangkokExpiryInstant(dateOnly: string): string` ใน web `date.ts` และเรียกใน booking form; ใช้ `calendarParts`/`pad` ที่มีอยู่ในไฟล์เดียวกัน ตรวจ date-only ก่อนแปลง:

```ts
export function toBangkokExpiryInstant(dateOnly: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) throw new Error('วันที่หมดอายุไม่ถูกต้อง');
  const start = new Date(`${dateOnly}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime())) throw new Error('วันที่หมดอายุไม่ถูกต้อง');
  const [year, month, day] = calendarParts(start, 'Asia/Bangkok');
  if (`${year}-${pad(month)}-${pad(day)}` !== dateOnly) throw new Error('วันที่หมดอายุไม่ถูกต้อง');
  return new Date(start.getTime() + 86400000).toISOString();
}
```

วันที่11ก.ย.หมดอายุที่ `2026-09-11T17:00:00.000Z`; unit test ตรง cutoff ต้องไม่อนุญาตรับ/แปลง และ input `2026-02-30` ต้องปฏิเสธ
- [x] ทดสอบ expiry จำนวนเกิน500ไม่หายจากการรันรอบถัดไป และแถวหนึ่งผิดพลาดไม่ทำให้แถวอื่นค้าง; harness + `local:check`, review/commit `fix(bookings): enforce expiry at mutation time`
