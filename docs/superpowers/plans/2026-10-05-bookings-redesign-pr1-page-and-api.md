# การจอง / มัดจำ — PR 1: หน้า /bookings ใหม่ + API ตัวกรอง/สรุป/ไทม์ไลน์ — แผนงาน

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แทนหน้า `/bookings` เดิม (ไฟล์เดียว 991 บรรทัด) ด้วยหน้าใหม่ตาม mockup 1A/1B/2A/2B/3A/3B/4A/4B และเพิ่ม API ที่หน้าใหม่ต้องใช้ (ตัวกรอง/ค้นหา/เรียง · ตัวเลข KPI · ไทม์ไลน์เหตุการณ์ · กติกา 1 เครื่อง + เหตุผลยกเลิกบังคับ) โดย **ไม่มี migration** และไม่แตะการลงบัญชี

**Architecture:** API ขยาย `BookingsService.findAll` (where/orderBy ใหม่ + ค้นเบอร์/IMEI) เพิ่ม `summary()` และ `events[]` ใน `findOne` · web แยก `pages/BookingsPage.tsx` เป็นโฟลเดอร์ `pages/BookingsPage/` (index + components + hooks) ตามแบบ `pages/CustomersPage/` — URL เป็นแหล่งความจริงของตัวกรองผ่าน `useLatestSearchParams` · ตาราง = `DataTable` กลาง `density="dense"` 1,120 px · รายละเอียดเป็น `Sheet` ด้านขวา · ปุ่มหลักปุ่มเดียวตามสถานะ · ยกเลิกต้องผ่านกล่องยืนยัน + เหตุผลบังคับ

**Tech Stack:** NestJS + Prisma (jest) · React 18 + react-router + @tanstack/react-query + shadcn/ui (Sheet, Popover, Command, DropdownMenu, ConfirmDialog, Badge, Textarea) + lucide-react (vitest + testing-library) · Playwright e2e

**Spec:** `docs/superpowers/specs/2026-10-05-bookings-redesign-design.md` (§3 หน้าจอ · §4 กติกา · §6.1–6.3 API · §11 เทส · §12 ลำดับ PR — PR นี้คือแถวที่ 1) · mockup `https://claude.ai/artifact/1do1Dgg1fspTeXm188xYFV`

## Global Constraints

- ทำงานใน worktree `~/Desktop/App/BESTCHOICE-bookings-redesign` สาขา `feat/bookings-redesign` · **ห้าม push** โดยไม่ถามเจ้าของ (repo เป็น public) · commit ย่อยได้ทุก task
- UI ภาษาไทยทั้งหมด · สีผ่านโทเคนเท่านั้น (`bg-card text-muted-foreground border-border bg-primary/10 text-warning-strong text-destructive`) **ห้าม** hex / `text-gray-*` / `bg-white` · ตัวอักษรบน `bg-primary` ใช้ `text-primary-foreground` · ตัวอักษรเหลืองใช้ `text-warning-strong` ห้าม `text-warning` · ข้อความไทยใช้ `leading-snug` ห้าม `leading-none` · สถานะต้องมีข้อความกำกับ ไม่บอกด้วยสีอย่างเดียว
- ดึงข้อมูลผ่าน `useQuery`/`useMutation` + `api` จาก `@/lib/api` เท่านั้น · แจ้งผลด้วย `toast` จาก `sonner` · **ห้าม** `alert()`/`confirm()` · หลัง mutation ใบจองเรียก `invalidateSalesQueries(qc, 'booking-updated' | 'booking-converted')` (ของเดิม)
- เขียน URL ผ่าน `useLatestSearchParams` เท่านั้น (ห้าม `setSearchParams` ตรง) · ค่าเริ่มต้นไม่เขียนคีย์ · เปลี่ยนตัวกรองแล้ว `next.delete('page')`
- ตารางใช้ `DataTable` กลาง `density="dense"` · ความกว้างคอลัมน์รวม **1,120 px** พอดี (136/190/236/92/108/100/118/96/44) ห้ามซ่อนคอลัมน์
- API: เงินเป็น `Prisma.Decimal` ห้าม `Number()` ในการคำนวณ · ข้อความ error ภาษาไทย · ทุก query มี `deletedAt: null` · roles ตามเดิม (อ่าน OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT/SALES · เขียน OWNER/BRANCH_MANAGER/SALES · ลบ OWNER/BRANCH_MANAGER) · AuditLog ที่ต้อง atomic เขียนด้วย `tx.auditLog.create` ในธุรกรรมเดียว
- ไม่มี migration ใน PR นี้ · ไม่มี JE ใหม่
- คำสั่งทดสอบ: API `npm --prefix apps/api test -- <path>` (jest `--runInBand` อยู่ในสคริปต์แล้ว) · web `npm --prefix apps/web test -- <path>` (vitest) · typecheck `./tools/check-types.sh all` · **ห้าม**รัน `npm --prefix apps/api run lint` (มี `--fix` แก้ไฟล์ทั้งโปรเจกต์)
- หน้า API ที่หน้าเว็บเก่าใช้ (`GET /bookings?page&limit&status&search` และ response `{ data, total, page, limit }`) ต้องยังทำงานเดิมได้ ตลอด PR
- ตอนท้าย bump `version` ใน `apps/web/package.json` จาก `26.10.6` → `26.10.7` (ถ้าตอน merge มี PR อื่นใช้เลขนี้แล้ว ให้ขยับเป็นเลขถัดไป)

## Review Focus

1. ค้นหาด้วยเบอร์ที่พิมพ์มีขีด/เว้นวรรค (`081-234 5678`) ต้องเจอใบของลูกค้าเบอร์ `0812345678` — เทสอยู่ Task 1 (`buildBookingSearchWhere`)
2. ใบที่เลยกำหนดแล้วแต่ cron 00:30 ยังไม่ปิด ต้องยังอยู่ในมุมมอง "ที่ยังเปิดอยู่" และนับใน "ใกล้หมดอายุ" และบนแผงปุ่มทุกอย่างปิดพร้อมป้าย "รอระบบปิด" — Task 1 (`expireDate lte` ไม่มี `gt`) · Task 5 (`describeExpiry` tone `overdue`) · Task 11
3. SALES ที่ไม่มี `branchId` เรียก summary ต้องได้ศูนย์ทั้งชุด ไม่ใช่ 500 — Task 2
4. กดการ์ด KPI สองใบติดกันก่อนจอ render → ตัวกรองไม่ทับกันและ `?zone=` คงอยู่ — Task 6 (เทส rapid writes)
5. ใบที่มัดจำเต็มจำนวน (`deposit === total`) แผงต้องไม่ขอรับส่วนต่าง ปุ่มหลักเป็น "ออกใบขายโดยใช้มัดจำ" และส่ง `collectBalance` เป็น `undefined` — Task 11

---

## File Structure

**API (`apps/api/src/modules/bookings/`)**
- Modify `bookings.service.ts` — `findAll` (where/orderBy ใหม่) · `summary()` ใหม่ · `findOne` + `events[]` · `update` เขียน AuditLog `BOOKING_UPDATED` · `create`/`update` บังคับ 1 เครื่อง + ตรวจเครื่องพร้อมขาย · export ค่าคงที่/ชนิดที่ web และ task ถัดไปใช้
- Modify `bookings.controller.ts` — query ใหม่ของ `GET /bookings` · route `GET /bookings/summary` (ต้องอยู่ **ก่อน** `GET :id`)
- Modify `dto/create-booking.dto.ts`, `dto/update-booking.dto.ts`, `dto/cancel-booking.dto.ts`
- Create `__tests__/bookings.list-filters.spec.ts` · `__tests__/bookings.summary.spec.ts` · `__tests__/bookings.events.spec.ts` · `__tests__/booking-rules.dto.spec.ts`
- Modify `__tests__/bookings.service.spec.ts` — เทส create เดิมให้ผูกเครื่อง + mock `product.findFirst`

**Web (`apps/web/src/pages/BookingsPage/` — โฟลเดอร์ใหม่; ไฟล์เดิม `pages/BookingsPage.tsx` ยังทำงานจนกว่า Task 12 จะลบ เพราะ Vite/TS เลือกไฟล์ `.tsx` ก่อนโฟลเดอร์ชื่อเดียวกัน)**
- `types.ts` — ชนิดข้อมูลของ API ใบจอง (ย้ายจากไฟล์เดิม + `events`, `product`, `BookingSummary`)
- `utils.ts` — `STATUS_LABEL` · `STATUS_VARIANT` · `computeBookingTotal` · `isDepositInRange` · `fmtMoney` · `fmtDate` · `describeExpiry` · `isOpenStatus`
- `hooks/useBookingsQuery.ts` — URL state + query รายการ/สรุป/สาขา
- `components/BookingKpiCards.tsx` — การ์ด 6 ใบ (5 กดกรอง + 1 ตัวเลข)
- `components/BookingFilterBar.tsx` — ค้นหา · สถานะ · สาขา · ช่วงวันที่
- `components/bookingColumns.tsx` — คอลัมน์ DataTable + เมนู ⋯ ท้ายแถว
- `components/BookingTable.tsx` — DataTable (จอใหญ่) + `BookingCardList.tsx` (จอโทรศัพท์)
- `components/BookingEmptyState.tsx` — หน้าว่าง 1B
- `components/CustomerCombobox.tsx` — ค้นหา+เลือกลูกค้าช่องเดียว + สร้างลูกค้าใหม่
- `components/CreateBookingDialog.tsx` — ฟอร์ม 2A (สร้าง/แก้ไข)
- `components/BookingTimeline.tsx` — ไทม์ไลน์จาก `events[]`
- `components/BookingDetailSheet.tsx` — แผง 3A/3B/4A
- `components/CancelBookingDialog.tsx` — กล่อง 4B
- `index.tsx` — ประกอบหน้า
- `__tests__/utils.test.ts` · `__tests__/useBookingsQuery.test.tsx` · `__tests__/BookingKpiCards.test.tsx` · `__tests__/BookingTable.test.tsx` · `__tests__/CreateBookingDialog.test.tsx` · `__tests__/BookingDetailSheet.test.tsx` · `__tests__/BookingsPage.test.tsx`
- Delete (Task 12): `pages/BookingsPage.tsx` · `pages/BookingsPage.test.tsx` · `pages/BookingsPage.forms.test.tsx`
- Modify `apps/web/e2e/bookings.spec.ts` · `apps/web/package.json` (version)
- `apps/web/src/App.tsx` **ไม่ต้องแก้** — `lazy(() => import('@/pages/BookingsPage'))` จะชี้ไปที่ `BookingsPage/index.tsx` เองเมื่อไฟล์เดิมถูกลบ

---

### Task 1: API — ตัวกรอง / ค้นหา / เรียง ใหม่ของ `GET /bookings`

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (ส่วน `BOOKING_DEFAULT_INCLUDE` บรรทัด ~43–58 และ `findAll` บรรทัด ~116–170)
- Modify: `apps/api/src/modules/bookings/bookings.controller.ts` (`findAll` บรรทัด ~36–66)
- Test: `apps/api/src/modules/bookings/__tests__/bookings.list-filters.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: `bangkokStartOfDay`, `bangkokDateRange` จาก `apps/api/src/utils/date.util.ts` · `normalizeThaiPhone` จาก `apps/api/src/utils/thai-phone.util.ts`
- Produces (export จาก `bookings.service.ts` — Task 2/3 และ web ใช้ชื่อเดียวกัน):
  ```ts
  export const OPEN_BOOKING_STATUSES = ['PENDING_DEPOSIT', 'PAID'] as const;
  export const CLOSED_BOOKING_STATUSES = ['CONVERTED', 'CANCELED', 'EXPIRED'] as const;
  export type BookingListSort = 'expireDate' | 'createdAt';
  export interface BookingListOptions {
    page?: number; limit?: number; status?: string; open?: boolean; expiringDays?: number;
    branchId?: string; customerId?: string; search?: string; from?: string; to?: string;
    sort?: BookingListSort; order?: 'asc' | 'desc';
  }
  export function expiringBefore(now: Date, days: number): Date;          // เที่ยงคืนไทยของ (วันนี้ + days + 1) — ใช้กับ `lte` (expireDate เก็บเป็นเที่ยงคืนไทยของวันถัดจากวันสุดท้ายที่ใช้ได้)
  export function buildBookingSearchWhere(term: string): Prisma.BookingWhereInput[];
  ```
  response ของ `findAll` คงรูป `{ data, total, page, limit }` · แต่ละ `items[]` มี `product: { id, name, status, branchId, imeiSerial, wasPreviouslyDamaged } | null`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/bookings/__tests__/bookings.list-filters.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BookingsService, expiringBefore, buildBookingSearchWhere } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

jest.mock('../../../utils/sequence.util', () => ({
  generateBookingNumber: jest.fn().mockResolvedValue('BK-20261005-0001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };
const SALES_BR1 = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };

describe('BookingsService.findAll — ตัวกรองหน้ารายการใหม่', () => {
  let service: BookingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    const stub = { execute: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopBookingDepositTemplate, useValue: stub },
        { provide: ShopBookingForfeitTemplate, useValue: stub },
        { provide: ShopBookingDepositAppliedTemplate, useValue: stub },
        { provide: ShopCashSaleTemplate, useValue: stub },
        { provide: ShopBookingRefundTemplate, useValue: stub },
        { provide: ShopAccountResolver, useValue: { resolveInflowCashAccount: jest.fn() } },
      ],
    }).compile();
    service = mod.get(BookingsService);
  });

  const whereOf = () => prisma.booking.findMany.mock.calls[0][0].where;
  const orderOf = () => prisma.booking.findMany.mock.calls[0][0].orderBy;

  it('open=true → เฉพาะใบที่ยังเปิดอยู่ และเรียงใกล้หมดอายุก่อน', async () => {
    await service.findAll({ open: true }, OWNER);
    expect(whereOf().status).toEqual({ in: ['PENDING_DEPOSIT', 'PAID'] });
    expect(orderOf()).toEqual([{ expireDate: 'asc' }, { id: 'desc' }]);
  });

  it('status=CLOSED → ขายแล้ว/ยกเลิก/หมดอายุ และเรียงใบใหม่สุดก่อน', async () => {
    await service.findAll({ status: 'CLOSED' }, OWNER);
    expect(whereOf().status).toEqual({ in: ['CONVERTED', 'CANCELED', 'EXPIRED'] });
    expect(orderOf()).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('status เดี่ยวยังใช้ได้เหมือนเดิม (หน้าเว็บเก่า)', async () => {
    await service.findAll({ status: 'PAID' }, OWNER);
    expect(whereOf().status).toBe('PAID');
    expect(orderOf()[0]).toEqual({ createdAt: 'desc' });
  });

  it('status ที่ไม่รู้จัก → BadRequest ไม่ยิง query', async () => {
    await expect(service.findAll({ status: 'HELLO' }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('expiringDays=3 → ใบเปิดที่ expireDate ≤ เที่ยงคืนไทยของอีก 4 วัน (= ใช้ได้ถึงสิ้นวันที่ +3 · รวมใบที่เลยกำหนดแล้วแต่ยังไม่ปิด)', async () => {
    const before = Date.now();
    await service.findAll({ expiringDays: 3 }, OWNER);
    const where = whereOf();
    expect(where.status).toEqual({ in: ['PENDING_DEPOSIT', 'PAID'] });
    expect(where.expireDate.gt).toBeUndefined();
    expect(where.expireDate.lt).toBeUndefined();
    const lte: Date = where.expireDate.lte;
    const expected = expiringBefore(new Date(before), 3);
    expect(Math.abs(lte.getTime() - expected.getTime())).toBeLessThan(5_000);
  });

  it('search เบอร์ที่มีขีด/เว้นวรรค → ค้น phone แบบ normalize + เลขที่ + ชื่อ + IMEI', async () => {
    await service.findAll({ search: '081-234 5678' }, OWNER);
    const or = whereOf().OR;
    expect(or).toEqual(expect.arrayContaining([
      { bookingNumber: { contains: '081-234 5678', mode: 'insensitive' } },
      { customer: { name: { contains: '081-234 5678', mode: 'insensitive' } } },
      { items: { some: { product: { imeiSerial: { contains: '081-234 5678', mode: 'insensitive' } } } } },
      { customer: { phone: { contains: '0812345678' } } },
    ]));
  });

  it('search ที่เป็นข้อความ → ไม่เพิ่มเงื่อนไขเบอร์โทร', () => {
    const or = buildBookingSearchWhere('สมชาย');
    expect(or.some((w) => 'customer' in w && (w.customer as { phone?: unknown }).phone)).toBe(false);
    expect(or).toHaveLength(3);
  });

  it('sort/order ที่ส่งมาชนะค่าเริ่มต้น', async () => {
    await service.findAll({ open: true, sort: 'createdAt', order: 'asc' }, OWNER);
    expect(orderOf()).toEqual([{ createdAt: 'asc' }, { id: 'desc' }]);
  });

  it('from/to เป็นวันไทย YYYY-MM-DD → createdAt [gte, lt) และรูปแบบผิด → BadRequest', async () => {
    await service.findAll({ from: '2026-10-01', to: '2026-10-05' }, OWNER);
    const createdAt = whereOf().createdAt;
    expect(createdAt.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(createdAt.lt.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    await expect(service.findAll({ from: '1/10/2026' }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SALES ถูกบังคับสาขาตัวเองเสมอ', async () => {
    await service.findAll({ open: true, branchId: 'br-1' }, SALES_BR1);
    expect(whereOf().branchId).toBe('br-1');
  });

  it('expiringBefore — เที่ยงคืนไทยของ (วันนี้ + days + 1)', () => {
    // 2026-10-05 10:00 เวลาไทย = 03:00Z → อีก 3 วัน = ใช้ได้ถึงสิ้นวัน 8 ต.ค. ซึ่งเก็บเป็น 9 ต.ค. 00:00 ไทย = 8 ต.ค. 17:00Z ⇒ เทียบด้วย lte
    expect(expiringBefore(new Date('2026-10-05T03:00:00.000Z'), 3).toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.list-filters.spec.ts`
Expected: FAIL — `expiringBefore is not a function` / `buildBookingSearchWhere` ไม่มี

- [ ] **Step 3: แก้ service**

ใน `bookings.service.ts` เพิ่ม import และค่าคงที่ใต้ `type RequestUser` (บรรทัด ~41):

```ts
import { BookingStatus, Prisma } from '@prisma/client';   // แทนบรรทัด `import { Prisma } from '@prisma/client';`
import { bangkokDateRange, bangkokStartOfDay } from '../../utils/date.util';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';

export const OPEN_BOOKING_STATUSES = ['PENDING_DEPOSIT', 'PAID'] as const;
export const CLOSED_BOOKING_STATUSES = ['CONVERTED', 'CANCELED', 'EXPIRED'] as const;
const ALL_BOOKING_STATUSES: readonly string[] = [...OPEN_BOOKING_STATUSES, ...CLOSED_BOOKING_STATUSES];
export type BookingListSort = 'expireDate' | 'createdAt';

export interface BookingListOptions {
  page?: number;
  limit?: number;
  /** สถานะเดี่ยว หรือ `CLOSED` = CONVERTED+CANCELED+EXPIRED */
  status?: string;
  /** PENDING_DEPOSIT + PAID (ค่าเริ่มต้นของหน้ารายการใหม่) */
  open?: boolean;
  /** ใบเปิดที่หมดอายุภายใน n วัน (รวมใบที่เลยกำหนดแล้วแต่ cron ยังไม่ปิด) */
  expiringDays?: number;
  branchId?: string;
  customerId?: string;
  search?: string;
  /** วันไทย YYYY-MM-DD (รวมปลาย) */
  from?: string;
  to?: string;
  sort?: BookingListSort;
  order?: 'asc' | 'desc';
}

/**
 * เที่ยงคืนไทยของ (วันนี้ + days + 1) — ใบจองเก็บ `expireDate` เป็นเที่ยงคืนไทยของวันถัดจากวันสุดท้ายที่ใช้ได้
 * (`toBangkokExpiryInstant` ฝั่งเว็บ) จึงต้องเทียบด้วย `lte` ให้ "ภายใน n วัน" ครอบใบที่ใช้ได้ถึงสิ้นวันที่ n พอดี
 */
export function expiringBefore(now: Date, days: number): Date {
  return new Date(bangkokStartOfDay(now).getTime() + (days + 1) * 86_400_000);
}

/** เงื่อนไขค้นหา: เลขที่ · ชื่อลูกค้า · IMEI/Serial ของเครื่องที่ผูก · เบอร์โทร (เฉพาะเมื่อพิมพ์เป็นตัวเลข ≥ 3 หลัก หลัง normalize) */
export function buildBookingSearchWhere(term: string): Prisma.BookingWhereInput[] {
  const or: Prisma.BookingWhereInput[] = [
    { bookingNumber: { contains: term, mode: 'insensitive' } },
    { customer: { name: { contains: term, mode: 'insensitive' } } },
    { items: { some: { product: { imeiSerial: { contains: term, mode: 'insensitive' } } } } },
  ];
  const digits = normalizeThaiPhone(term) ?? '';
  if (/^\d{3,}$/.test(digits)) or.push({ customer: { phone: { contains: digits } } });
  return or;
}
```

แก้ `BOOKING_DEFAULT_INCLUDE.items` ให้ดึงสถานะเครื่องปัจจุบันติดมา (แผงใช้เช็คสด):

```ts
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: {
        select: { id: true, name: true, status: true, branchId: true, imeiSerial: true, wasPreviouslyDamaged: true },
      },
    },
  },
```

แทนทั้งเมธอด `findAll` ด้วย:

```ts
  async findAll(opts: BookingListOptions, user: RequestUser) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;
    const now = new Date();

    const baseWhere: Prisma.BookingWhereInput = { deletedAt: null };
    if (opts.status === 'CLOSED') {
      baseWhere.status = { in: [...CLOSED_BOOKING_STATUSES] };
    } else if (opts.status && ALL_BOOKING_STATUSES.includes(opts.status)) {
      baseWhere.status = opts.status as BookingStatus;
    } else if (opts.status) {
      throw new BadRequestException('สถานะใบจองไม่ถูกต้อง');
    } else if (opts.open || opts.expiringDays) {
      baseWhere.status = { in: [...OPEN_BOOKING_STATUSES] };
    }
    // ไม่ใส่ `gt: now` — ใบที่เลยกำหนดแต่รอบ 00:30 ยังไม่ปิด ต้องยังโผล่ให้พนักงานเห็น (ป้าย "รอระบบปิด")
    if (opts.expiringDays) baseWhere.expireDate = { lte: expiringBefore(now, opts.expiringDays) };
    if (opts.customerId) baseWhere.customerId = opts.customerId;
    const term = opts.search?.trim();
    if (term) baseWhere.OR = buildBookingSearchWhere(term);
    const range = bangkokDateRange(opts.from, opts.to);
    if (range.gte || range.lt) baseWhere.createdAt = range;

    const { where, empty } = this.applyBranchScope(baseWhere, user, opts.branchId);
    if (empty) return { data: [], total: 0, page, limit };

    // ค่าเริ่มต้น: มุมมอง "ที่ยังเปิดอยู่/ใกล้หมดอายุ" เรียงใกล้หมดอายุก่อน · ที่เหลือใบใหม่สุดก่อน
    const sortField: BookingListSort =
      opts.sort ?? ((opts.open || opts.expiringDays) && !opts.status ? 'expireDate' : 'createdAt');
    const direction: 'asc' | 'desc' = opts.order ?? (sortField === 'expireDate' ? 'asc' : 'desc');

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_DEFAULT_INCLUDE,
        skip,
        take: limit,
        orderBy: [{ [sortField]: direction }, { id: 'desc' }],
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { data, total, page, limit };
  }
```

- [ ] **Step 4: แก้ controller**

แทนเมธอด `findAll` ใน `bookings.controller.ts`:

```ts
  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ค้นหา / แสดงรายการใบจอง' })
  findAll(
    @Req() req: AuthRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('open') open?: string,
    @Query('expiring') expiring?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    const expiringDays = expiring ? Math.min(30, Math.max(0, parseInt(expiring, 10) || 0)) : 0;
    return this.bookingsService.findAll(
      {
        page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
        limit: limit ? Math.min(200, parseInt(limit, 10) || 50) : undefined,
        status: status || undefined,
        open: open === '1' || open === 'true',
        expiringDays: expiringDays > 0 ? expiringDays : undefined,
        branchId: branchId || undefined,
        customerId: customerId || undefined,
        search: search || undefined,
        from: from || undefined,
        to: to || undefined,
        sort: sort === 'expireDate' || sort === 'createdAt' ? sort : undefined,
        order: order === 'asc' || order === 'desc' ? order : undefined,
      },
      user,
    );
  }
```

- [ ] **Step 5: รันเทสให้ผ่าน + เทสเดิม + typecheck**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.list-filters.spec.ts src/modules/bookings/__tests__/bookings.service.spec.ts`
Expected: PASS ทั้งสองไฟล์ (เทสเดิม `findAll — SALES is forced…` ยังผ่าน เพราะ response/scope เดิม)
Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/bookings
git commit -m "feat(bookings): ตัวกรอง open/expiring/CLOSED · ค้นเบอร์/IMEI · เรียงใกล้หมดอายุ · ส่งสถานะเครื่องติดรายการ"
```

---

### Task 2: API — `GET /bookings/summary` ตัวเลขการ์ด KPI

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (เพิ่มเมธอด `summary` ใต้ `findAll`)
- Modify: `apps/api/src/modules/bookings/bookings.controller.ts` (route ใหม่ **ก่อน** `@Get(':id')`)
- Test: `apps/api/src/modules/bookings/__tests__/bookings.summary.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: `OPEN_BOOKING_STATUSES`, `expiringBefore`, `applyBranchScope` (Task 1) · `bangkokCalendarParts`, `bangkokMidnight`, `bangkokDateRange` จาก `utils/date.util.ts`
- Produces:
  ```ts
  export interface BookingSummary {
    total: number; open: number; pendingDeposit: number; paid: number;
    /** Σ มัดจำของใบ PAID — เงินที่ร้านถืออยู่ (string 2 ตำแหน่ง) */
    paidDepositHeld: string;
    expiringWithin3Days: number;
    closed: { converted: number; canceled: number; expired: number; total: number };
    /** Σ มัดจำที่ริบจากใบที่หมดอายุในเดือนไทยปัจจุบัน (ไม่สนช่วงวันที่ที่กรอง) */
    forfeitedThisMonth: string;
  }
  BookingsService.summary(opts: { branchId?: string; from?: string; to?: string }, user: RequestUser): Promise<BookingSummary>
  GET /bookings/summary?branchId&from&to → BookingSummary
  ```

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/bookings/__tests__/bookings.summary.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BookingsService } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

jest.mock('../../../utils/sequence.util', () => ({
  generateBookingNumber: jest.fn(), generateSaleNumber: jest.fn(),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };
const SALES_NO_BRANCH = { id: 'u-sales', role: 'SALES', branchId: null as string | null };
const SALES_BR1 = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };

describe('BookingsService.summary', () => {
  let service: BookingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      booking: {
        // ลำดับเดียวกับ Promise.all ใน summary(): total, open, pending, paid, expiring, converted, canceled, expired
        count: jest.fn()
          .mockResolvedValueOnce(8).mockResolvedValueOnce(5).mockResolvedValueOnce(1).mockResolvedValueOnce(4)
          .mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1),
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { depositAmount: new Prisma.Decimal('33900') } })
          .mockResolvedValueOnce({ _sum: { depositAmount: new Prisma.Decimal('3000') } }),
      },
    };
    const stub = { execute: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopBookingDepositTemplate, useValue: stub },
        { provide: ShopBookingForfeitTemplate, useValue: stub },
        { provide: ShopBookingDepositAppliedTemplate, useValue: stub },
        { provide: ShopCashSaleTemplate, useValue: stub },
        { provide: ShopBookingRefundTemplate, useValue: stub },
        { provide: ShopAccountResolver, useValue: { resolveInflowCashAccount: jest.fn() } },
      ],
    }).compile();
    service = mod.get(BookingsService);
  });

  it('รวมตัวเลขทุกการ์ดในรอบเดียว และยอดเงินเป็น string 2 ตำแหน่ง', async () => {
    const result = await service.summary({}, OWNER);
    expect(result).toEqual({
      total: 8, open: 5, pendingDeposit: 1, paid: 4, paidDepositHeld: '33900.00', expiringWithin3Days: 3,
      closed: { converted: 1, canceled: 1, expired: 1, total: 3 }, forfeitedThisMonth: '3000.00',
    });
    expect(prisma.booking.count).toHaveBeenCalledTimes(8);
    expect(prisma.booking.aggregate).toHaveBeenCalledTimes(2);
  });

  it('การ์ดกับตารางอ่านเงื่อนไขเดียวกัน: "ใกล้หมดอายุ" = สถานะเปิด + expireDate lte เที่ยงคืนไทยอีก 4 วัน', async () => {
    await service.summary({}, OWNER);
    const expiringCall = prisma.booking.count.mock.calls[4][0].where;
    expect(expiringCall.status).toEqual({ in: ['PENDING_DEPOSIT', 'PAID'] });
    expect(expiringCall.expireDate.lte).toBeInstanceOf(Date);
    expect(expiringCall.expireDate.gt).toBeUndefined();
  });

  it('ริบมัดจำเดือนนี้: EXPIRED ที่เคยรับมัดจำ และ expireDate อยู่ในเดือนไทยนี้ — ไม่สนช่วงวันที่ที่กรอง', async () => {
    await service.summary({ from: '2026-01-01', to: '2026-01-31' }, OWNER);
    const forfeit = prisma.booking.aggregate.mock.calls[1][0].where;
    expect(forfeit.status).toBe('EXPIRED');
    expect(forfeit.depositPaidAt).toEqual({ not: null });
    expect(forfeit.createdAt).toBeUndefined();
    expect(forfeit.expireDate.gte).toBeInstanceOf(Date);
    expect(forfeit.expireDate.lt).toBeInstanceOf(Date);
    // ส่วนการ์ดอื่นเคารพช่วงวันที่
    expect(prisma.booking.count.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('SALES ไม่มีสาขา → ศูนย์ทั้งชุด ไม่ยิง query', async () => {
    const result = await service.summary({}, SALES_NO_BRANCH);
    expect(result.total).toBe(0);
    expect(result.paidDepositHeld).toBe('0.00');
    expect(prisma.booking.count).not.toHaveBeenCalled();
  });

  it('SALES ถูกบังคับสาขาตัวเองทุก query', async () => {
    await service.summary({}, SALES_BR1);
    for (const call of prisma.booking.count.mock.calls) expect(call[0].where.branchId).toBe('br-1');
    for (const call of prisma.booking.aggregate.mock.calls) expect(call[0].where.branchId).toBe('br-1');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.summary.spec.ts`
Expected: FAIL — `service.summary is not a function`

- [ ] **Step 3: เพิ่มเมธอดใน service**

เพิ่ม import `bangkokCalendarParts, bangkokMidnight` ในบรรทัด import ของ `date.util` และเพิ่มใต้ `findAll`:

```ts
export interface BookingSummary {
  total: number;
  open: number;
  pendingDeposit: number;
  paid: number;
  paidDepositHeld: string;
  expiringWithin3Days: number;
  closed: { converted: number; canceled: number; expired: number; total: number };
  forfeitedThisMonth: string;
}

const EMPTY_SUMMARY: BookingSummary = {
  total: 0, open: 0, pendingDeposit: 0, paid: 0, paidDepositHeld: '0.00', expiringWithin3Days: 0,
  closed: { converted: 0, canceled: 0, expired: 0, total: 0 }, forfeitedThisMonth: '0.00',
};
```

(วาง `EMPTY_SUMMARY` ไว้ระดับโมดูลใต้ `ZERO`) แล้วในคลาส:

```ts
  /**
   * ตัวเลขการ์ด KPI ของหน้ารายการ — ทุกตัวสร้างจาก `where` ตัวเดียวกับ findAll (สาขา + ช่วงวันที่สร้าง)
   * ยกเว้น "ริบมัดจำเดือนนี้" ที่ยึดเดือนไทยปัจจุบันเสมอ (การ์ดบอกเล่าภาพรวม ไม่ใช่ตัวกรอง)
   */
  async summary(opts: { branchId?: string; from?: string; to?: string }, user: RequestUser): Promise<BookingSummary> {
    const now = new Date();
    const base: Prisma.BookingWhereInput = { deletedAt: null };
    const range = bangkokDateRange(opts.from, opts.to);
    if (range.gte || range.lt) base.createdAt = range;
    const scoped = this.applyBranchScope(base, user, opts.branchId);
    if (scoped.empty) return EMPTY_SUMMARY;
    const where = scoped.where;
    const monthScope = this.applyBranchScope({ deletedAt: null }, user, opts.branchId).where;
    const { year, month } = bangkokCalendarParts(now);
    const monthStart = bangkokMidnight(year, month, 1);
    const monthEnd = bangkokMidnight(year, month + 1, 1);

    const count = (extra: Prisma.BookingWhereInput) => this.prisma.booking.count({ where: { ...where, ...extra } });
    const [total, open, pendingDeposit, paid, expiring, converted, canceled, expired, held, forfeited] = await Promise.all([
      count({}),
      count({ status: { in: [...OPEN_BOOKING_STATUSES] } }),
      count({ status: 'PENDING_DEPOSIT' }),
      count({ status: 'PAID' }),
      count({ status: { in: [...OPEN_BOOKING_STATUSES] }, expireDate: { lte: expiringBefore(now, 3) } }),
      count({ status: 'CONVERTED' }),
      count({ status: 'CANCELED' }),
      count({ status: 'EXPIRED' }),
      this.prisma.booking.aggregate({ where: { ...where, status: 'PAID' }, _sum: { depositAmount: true } }),
      this.prisma.booking.aggregate({
        where: { ...monthScope, status: 'EXPIRED', depositPaidAt: { not: null }, expireDate: { gte: monthStart, lt: monthEnd } },
        _sum: { depositAmount: true },
      }),
    ]);

    return {
      total, open, pendingDeposit, paid,
      paidDepositHeld: (held._sum.depositAmount ?? ZERO).toFixed(2),
      expiringWithin3Days: expiring,
      closed: { converted, canceled, expired, total: converted + canceled + expired },
      forfeitedThisMonth: (forfeited._sum.depositAmount ?? ZERO).toFixed(2),
    };
  }
```

- [ ] **Step 4: เพิ่ม route (ก่อน `@Get(':id')`)**

ใน `bookings.controller.ts` วางก่อนเมธอด `findOne`:

```ts
  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ตัวเลขการ์ด KPI ของหน้าการจอง (สาขา/ช่วงวันที่เดียวกับรายการ)' })
  summary(
    @Req() req: AuthRequest,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.summary(
      { branchId: branchId || undefined, from: from || undefined, to: to || undefined },
      user,
    );
  }
```

- [ ] **Step 5: รันเทส + typecheck**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.summary.spec.ts`
Expected: PASS 5 เทส
Run: `./tools/check-types.sh api` → 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/bookings
git commit -m "feat(bookings): GET /bookings/summary ตัวเลขการ์ด KPI (where เดียวกับรายการ)"
```

---

### Task 3: API — `events[]` ไทม์ไลน์ใน `GET /bookings/:id` + AuditLog `BOOKING_UPDATED`

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`findOne`, `update`)
- Modify: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` (เพิ่ม `auditLog.findMany` ใน prisma mock ราก)
- Test: `apps/api/src/modules/bookings/__tests__/bookings.events.spec.ts` (ใหม่)

**Interfaces:**
- Produces:
  ```ts
  export const BOOKING_EVENT_ACTIONS = [
    'BOOKING_CREATED', 'BOOKING_UPDATED', 'BOOKING_DEPOSIT_PAID', 'BOOKING_CANCELED',
    'BOOKING_CONVERTED', 'BOOKING_AUTO_EXPIRED', 'BOOKING_DELETED',
  ] as const;
  export type BookingEventKind = (typeof BOOKING_EVENT_ACTIONS)[number];
  export interface BookingEvent { id: string; kind: BookingEventKind; at: string; actor: { id: string; name: string } | null; data: Prisma.JsonValue | null }
  // findOne(...) คืน booking เดิม + `events: BookingEvent[]` เรียงเก่า→ใหม่
  ```
  web (Task 5) ประกาศชนิดเดียวกันใน `types.ts`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/bookings/__tests__/bookings.events.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BookingsService, BOOKING_EVENT_ACTIONS } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

jest.mock('../../../utils/sequence.util', () => ({
  generateBookingNumber: jest.fn(), generateSaleNumber: jest.fn(),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };

describe('BookingsService — ไทม์ไลน์เหตุการณ์ของใบจอง', () => {
  let service: BookingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const booking = { id: 'bk-1', bookingNumber: 'BK-20261005-0001', status: 'PAID', branchId: 'br-1', items: [] };

  beforeEach(async () => {
    const txAuditLog = { create: jest.fn().mockResolvedValue({ id: 'al-new' }) };
    prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(booking) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'al-1', action: 'BOOKING_CREATED', createdAt: new Date('2026-10-05T03:42:00Z'),
            newValue: { bookingNumber: 'BK-20261005-0001' }, user: { id: 'u-sales', name: 'น้ำ' } },
          { id: 'al-2', action: 'BOOKING_DEPOSIT_PAID', createdAt: new Date('2026-10-05T03:55:00Z'),
            newValue: { depositMethod: 'CASH', depositAmount: '5000.00' }, user: { id: 'u-sales', name: 'น้ำ' } },
        ]),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({
        $queryRaw: jest.fn().mockResolvedValue([]),
        booking: {
          findFirst: jest.fn().mockResolvedValue({ id: 'bk-1', status: 'PAID', branchId: 'br-1',
            totalAmount: new Prisma.Decimal(10000), depositAmount: new Prisma.Decimal(1000),
            expireDate: new Date(Date.now() + 86_400_000) }),
          update: jest.fn().mockResolvedValue({ id: 'bk-1', expireDate: new Date('2026-10-12T17:00:00.000Z'),
            depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000), notes: 'แก้แล้ว' }),
        },
        auditLog: txAuditLog,
      })),
      _txAuditLog: txAuditLog,
    };
    const stub = { execute: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopBookingDepositTemplate, useValue: stub },
        { provide: ShopBookingForfeitTemplate, useValue: stub },
        { provide: ShopBookingDepositAppliedTemplate, useValue: stub },
        { provide: ShopCashSaleTemplate, useValue: stub },
        { provide: ShopBookingRefundTemplate, useValue: stub },
        { provide: ShopAccountResolver, useValue: { resolveInflowCashAccount: jest.fn() } },
      ],
    }).compile();
    service = mod.get(BookingsService);
  });

  it('findOne — แปะ events จาก AuditLog ของใบนี้ เรียงเก่า→ใหม่ พร้อมชื่อผู้ทำ', async () => {
    const result = await service.findOne('bk-1', OWNER);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entity: 'booking', entityId: 'bk-1', action: { in: [...BOOKING_EVENT_ACTIONS] } },
      orderBy: { createdAt: 'asc' },
    }));
    expect(result.events).toEqual([
      { id: 'al-1', kind: 'BOOKING_CREATED', at: '2026-10-05T03:42:00.000Z', actor: { id: 'u-sales', name: 'น้ำ' },
        data: { bookingNumber: 'BK-20261005-0001' } },
      { id: 'al-2', kind: 'BOOKING_DEPOSIT_PAID', at: '2026-10-05T03:55:00.000Z', actor: { id: 'u-sales', name: 'น้ำ' },
        data: { depositMethod: 'CASH', depositAmount: '5000.00' } },
    ]);
    expect(result.bookingNumber).toBe('BK-20261005-0001');
  });

  it('update — เขียน AuditLog BOOKING_UPDATED ในธุรกรรมเดียว บอกว่าแก้ช่องไหน', async () => {
    await service.update('bk-1', { notes: 'แก้แล้ว', expireDate: '2026-10-12T17:00:00.000Z' }, OWNER);
    expect(prisma._txAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'BOOKING_UPDATED', entity: 'booking', entityId: 'bk-1', userId: 'u-owner',
        newValue: expect.objectContaining({ changed: ['notes', 'expireDate'] }),
      }),
    });
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.events.spec.ts`
Expected: FAIL — `BOOKING_EVENT_ACTIONS` ไม่มี / `result.events` undefined

- [ ] **Step 3: แก้ service**

ใต้ `BookingListOptions` เพิ่ม:

```ts
export const BOOKING_EVENT_ACTIONS = [
  'BOOKING_CREATED',
  'BOOKING_UPDATED',
  'BOOKING_DEPOSIT_PAID',
  'BOOKING_CANCELED',
  'BOOKING_CONVERTED',
  'BOOKING_AUTO_EXPIRED',
  'BOOKING_DELETED',
] as const;
export type BookingEventKind = (typeof BOOKING_EVENT_ACTIONS)[number];
export interface BookingEvent {
  id: string;
  kind: BookingEventKind;
  at: string;
  actor: { id: string; name: string } | null;
  data: Prisma.JsonValue | null;
}
```

แทน `findOne`:

```ts
  async findOne(id: string, user: RequestUser) {
    const baseWhere: Prisma.BookingWhereInput = { id, deletedAt: null };
    const { where, empty } = this.applyBranchScope(baseWhere, user);
    if (empty) throw new NotFoundException('ไม่พบใบจอง');
    const booking = await this.prisma.booking.findFirst({ where, include: BOOKING_DEFAULT_INCLUDE });
    if (!booking) throw new NotFoundException('ไม่พบใบจอง');
    const logs = await this.prisma.auditLog.findMany({
      where: { entity: 'booking', entityId: id, action: { in: [...BOOKING_EVENT_ACTIONS] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, createdAt: true, newValue: true, user: { select: { id: true, name: true } } },
    });
    const events: BookingEvent[] = logs.map((log) => ({
      id: log.id,
      kind: log.action as BookingEventKind,
      at: log.createdAt.toISOString(),
      actor: log.user ? { id: log.user.id, name: log.user.name } : null,
      data: log.newValue,
    }));
    return { ...booking, events };
  }
```

ใน `update` แทนบรรทัดท้าย `return tx.booking.update({...})` ด้วย:

```ts
      const updated = await tx.booking.update({
        where: { id },
        data: updates,
        include: BOOKING_DEFAULT_INCLUDE,
      });
      const changed = (Object.keys(dto) as (keyof UpdateBookingDto)[]).filter((key) => dto[key] !== undefined);
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_UPDATED',
          entity: 'booking',
          entityId: id,
          userId: user.id,
          oldValue: { status: existing.status },
          newValue: {
            changed,
            expireDate: updated.expireDate.toISOString(),
            depositAmount: updated.depositAmount.toFixed(2),
            totalAmount: updated.totalAmount.toFixed(2),
          },
        },
      });
      return updated;
```

- [ ] **Step 4: เติม mock ในเทสเดิม**

ใน `__tests__/bookings.service.spec.ts` ตรงที่ประกาศ `prisma = {` (บรรทัด ~204) เพิ่มคีย์รากหลัง `user: {...}`:

```ts
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
```

- [ ] **Step 5: รันเทส + typecheck**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.events.spec.ts src/modules/bookings/__tests__/bookings.service.spec.ts`
Expected: PASS ทั้งสองไฟล์
Run: `./tools/check-types.sh api` → 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/bookings
git commit -m "feat(bookings): events[] ไทม์ไลน์จาก AuditLog + บันทึก BOOKING_UPDATED ตอนแก้ใบจอง"
```

---

### Task 4: API — กติกา 1 เครื่อง · มัดจำ > 0 · เหตุผลยกเลิกบังคับ

**Files:**
- Modify: `apps/api/src/modules/bookings/dto/create-booking.dto.ts`, `dto/update-booking.dto.ts`, `dto/cancel-booking.dto.ts`
- Modify: `apps/api/src/modules/bookings/bookings.service.ts` (`create`, `update`)
- Modify: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` (เทส create เดิม)
- Test: `apps/api/src/modules/bookings/__tests__/booking-rules.dto.spec.ts` (ใหม่)

**Interfaces:**
- Produces: `CreateBookingItemDto.productId` เป็น **required** · `CreateBookingDto.items` ยาวได้ 1 · `depositAmount ≥ 0.01` · `CancelBookingDto.cancelReason` required 3–500 ตัวอักษร · service `private assertSingleDeviceItem(items)` และ `private async loadBookableProduct(productId, branchId, customer)`
- ข้อความ error (web แสดงผ่าน `getErrorMessage`): `ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง จำนวน 1 ชิ้น` · `ไม่พบเครื่องที่เลือก` · `เครื่องที่เลือกอยู่คนละสาขากับใบจอง` · `เครื่องนี้ไม่พร้อมขาย กรุณาเลือกเครื่องอื่น` · `มัดจำต้องมากกว่า 0 บาท` · `กรุณาระบุเหตุผลการยกเลิก (อย่างน้อย 3 ตัวอักษร)`

- [ ] **Step 1: เขียนเทส DTO ที่ล้มก่อน**

สร้าง `apps/api/src/modules/bookings/__tests__/booking-rules.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBookingDto } from '../dto/create-booking.dto';
import { UpdateBookingDto } from '../dto/update-booking.dto';
import { CancelBookingDto } from '../dto/cancel-booking.dto';

const item = { productId: '0f5c6a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', description: 'iPhone 16 Pro', quantity: 1, unitPrice: 42900 };
const base = { customerId: '1f5c6a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', branchId: '2f5c6a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', depositAmount: 5000 };
const messages = (errors: ReturnType<typeof validateSync>) =>
  JSON.stringify(errors.map((e) => [e.constraints, e.children?.map((c) => c.children?.map((cc) => cc.constraints))]));

describe('กติกาใบจอง (คำตัดสินเจ้าของ 2026-10-05 ข้อ 2)', () => {
  it('รับใบที่ผูกเครื่อง 1 เครื่อง จำนวน 1', () => {
    expect(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [item] }))).toHaveLength(0);
  });
  it('ปฏิเสธรายการที่ไม่มี productId (พิมพ์รุ่นเอง)', () => {
    const errors = validateSync(plainToInstance(CreateBookingDto, { ...base, items: [{ ...item, productId: undefined }] }));
    expect(messages(errors)).toContain('กรุณาเลือกเครื่องในสต็อก');
  });
  it('ปฏิเสธมากกว่า 1 รายการ และจำนวนมากกว่า 1', () => {
    expect(messages(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [item, item] })))).toContain('1 เครื่อง');
    expect(messages(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [{ ...item, quantity: 2 }] })))).toContain('1 ชิ้น');
  });
  it('ปฏิเสธมัดจำ 0 (ไม่มีอะไรให้ล็อก)', () => {
    expect(messages(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [item], depositAmount: 0 })))).toContain('มากกว่า 0');
    expect(messages(validateSync(plainToInstance(UpdateBookingDto, { depositAmount: 0 })))).toContain('มากกว่า 0');
  });
  it('ยกเลิกต้องมีเหตุผลอย่างน้อย 3 ตัวอักษร', () => {
    expect(validateSync(plainToInstance(CancelBookingDto, {})).length).toBeGreaterThan(0);
    expect(messages(validateSync(plainToInstance(CancelBookingDto, { cancelReason: 'ok' })))).toContain('อย่างน้อย 3');
    expect(validateSync(plainToInstance(CancelBookingDto, { cancelReason: 'ลูกค้าเปลี่ยนใจ' }))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/booking-rules.dto.spec.ts`
Expected: FAIL (DTO เดิมยอมรับ productId ว่าง / มัดจำ 0 / ไม่มีเหตุผล)

- [ ] **Step 3: แก้ DTO**

`dto/create-booking.dto.ts` — เพิ่ม `ArrayMaxSize`, `Max` ใน import แล้วแก้:

```ts
export class CreateBookingItemDto {
  @IsUUID(undefined, { message: 'กรุณาเลือกเครื่องในสต็อก' })
  productId!: string;

  @IsString({ message: 'description ต้องเป็น string' })
  description!: string;

  @IsInt({ message: 'quantity ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'quantity ต้องอย่างน้อย 1' })
  @Max(1, { message: 'จองได้เครื่องละ 1 ชิ้น' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice ต้องเป็นตัวเลข' })
  @Min(0, { message: 'unitPrice ต้องไม่ติดลบ' })
  unitPrice!: number;
}
```

ใน `CreateBookingDto`: `items` เพิ่ม `@ArrayMaxSize(1, { message: 'ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง' })` ใต้ `@ArrayMinSize(1, …)` · `depositAmount` เปลี่ยน `@Min(0, …)` เป็น `@Min(0.01, { message: 'มัดจำต้องมากกว่า 0 บาท' })`

`dto/update-booking.dto.ts`: `items` เพิ่ม `@ArrayMaxSize(1, { message: 'ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง' })` (import `ArrayMaxSize`) · `depositAmount` เปลี่ยนเป็น `@Min(0.01, { message: 'มัดจำต้องมากกว่า 0 บาท' })`

`dto/cancel-booking.dto.ts` ทั้งไฟล์:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelBookingDto {
  @IsString({ message: 'กรุณาระบุเหตุผลการยกเลิก' })
  @MinLength(3, { message: 'กรุณาระบุเหตุผลการยกเลิก (อย่างน้อย 3 ตัวอักษร)' })
  @MaxLength(500, { message: 'cancelReason ยาวไม่เกิน 500 ตัวอักษร' })
  cancelReason!: string;
}
```

- [ ] **Step 4: รันเทส DTO ให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/booking-rules.dto.spec.ts src/modules/bookings/__tests__/booking-receipt.dto.spec.ts`
Expected: PASS

- [ ] **Step 5: เขียนเทส service ที่ล้มก่อน (แก้ไฟล์เดิม)**

ใน `__tests__/bookings.service.spec.ts`:
1. ใน `beforeEach` ที่ `prisma = {` เปลี่ยน `product: { findMany: jest.fn().mockResolvedValue([]) },` เป็น

```ts
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'prod-1', status: 'IN_STOCK', branchId: 'br-1', name: 'iPhone 15', imeiSerial: '356789012345678' }),
      },
```

2. แก้เทส `create` เดิมให้เป็นใบ 1 เครื่อง (กติกาใหม่) — ค้นด้วย `grep -n "service.create(" apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts`:
   - `create — computes totalAmount…` (บรรทัด ~292): แทน `items: [ {iPhone 15 35000}, {AirPods 5990} ]` ด้วย `items: [{ productId: 'prod-1', description: 'iPhone 15', quantity: 1, unitPrice: 35000 }]` และเปลี่ยน `expect(Number(createArgs.data.totalAmount)).toBe(40990)` → `.toBe(35000)`
   - `create — uses Prisma.Decimal…` (~329): `items: [{ productId: 'prod-1', description: 'penny test', quantity: 1, unitPrice: 0.3 }]` (quantity ต้องเป็น 1) — expected `'0.30'` คงเดิม
   - `create — rejects depositAmount > totalAmount` (~346) และ `create — SALES cannot create…` (~361): เติม `productId: 'prod-1'` ในรายการ
   - `create — ผู้สนใจจากแชทที่ยังไม่มีเบอร์…` (~855): เติม `productId: 'prod-1'` (ด่านเบอร์อยู่ก่อนด่านเครื่อง เทสยังผ่านเหมือนเดิม)
3. แทนเทส `create — รายการไม่ผูกเครื่อง (description อย่างเดียว) ไม่ query สินค้า` (บรรทัด ~805) ด้วย:

```ts
  it('create — รายการที่ไม่ผูกเครื่อง → BadRequest ก่อนเปิด tx (คำตัดสินเจ้าของ 2026-10-05 ข้อ 2)', async () => {
    await expect(service.create({ customerId: 'cust-1', branchId: 'br-1', depositAmount: 500,
      items: [{ description: 'iPhone รุ่นใหม่ที่ยังไม่เข้า', quantity: 1, unitPrice: 42900 } as never] }, SALES_BR1.id, SALES_BR1))
      .rejects.toThrow(/1 เครื่อง/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('create — เครื่องไม่ได้อยู่ในสาขาของใบจอง → BadRequest', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1', status: 'IN_STOCK', branchId: 'br-2' });
    await expect(service.create({ customerId: 'cust-1', branchId: 'br-1', depositAmount: 500,
      items: [{ productId: 'prod-1', description: 'iPhone 15', quantity: 1, unitPrice: 42900 }] }, SALES_BR1.id, SALES_BR1))
      .rejects.toThrow(/คนละสาขา/);
  });

  it('create — เครื่องไม่พร้อมขาย (RESERVED/SOLD) → BadRequest', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1', status: 'RESERVED', branchId: 'br-1' });
    await expect(service.create({ customerId: 'cust-1', branchId: 'br-1', depositAmount: 500,
      items: [{ productId: 'prod-1', description: 'iPhone 15', quantity: 1, unitPrice: 42900 }] }, SALES_BR1.id, SALES_BR1))
      .rejects.toThrow(/ไม่พร้อมขาย/);
  });
```

4. ใน `txProduct` (บรรทัด ~177) เพิ่ม `findFirst: jest.fn().mockResolvedValue({ id: 'prod-1', status: 'IN_STOCK', branchId: 'br-1', name: 'iPhone 15', imeiSerial: '356789012345678' }),` (update ที่แก้ items บน PENDING ตรวจเครื่องผ่าน tx)
5. เทส `create — รายการที่ผูกเครื่อง TEST- กับลูกค้าจริง → BadRequest ก่อนเปิด tx` (บรรทัด ~783): เปลี่ยน `prisma.product.findMany.mockResolvedValue([ {...} ])` เป็น `prisma.product.findFirst.mockResolvedValue({ ...ของเดิมตัวแรก, status: 'IN_STOCK', branchId: 'br-1' })` และ assertion `expect(prisma.product.findMany)` → `expect(prisma.product.findFirst)`

- [ ] **Step 6: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/bookings/__tests__/bookings.service.spec.ts`
Expected: FAIL เทสใหม่ 3 ตัว (service ยังรับรายการไม่ผูกเครื่อง)

- [ ] **Step 7: แก้ service `create`/`update`**

เพิ่ม helper ในคลาส (ใต้ `assertDepositInRange`):

```ts
  /** คำตัดสินเจ้าของ 2026-10-05 ข้อ 2: ใบจอง = เครื่องในสต็อก 1 เครื่อง จำนวน 1 ชิ้น (ตรงกับกติกาตอนแปลงขาย) */
  private assertSingleDeviceItem(items: { productId?: string; quantity: number }[]): string {
    const [item] = items;
    if (items.length !== 1 || !item?.productId || item.quantity !== 1) {
      throw new BadRequestException('ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง จำนวน 1 ชิ้น');
    }
    return item.productId;
  }

  /** เครื่องต้องมีจริง อยู่สาขาเดียวกับใบ และพร้อมขาย — ด่านนี้ให้ข้อความดี ๆ ตอนสร้าง (ด่านจริงตอนรับมัดจำอยู่ PR ล็อกเครื่อง) */
  private async loadBookableProduct(
    productId: string,
    branchId: string,
    customer: Parameters<typeof assertSameTestSide>[0],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const product = await client.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, status: true, branchId: true, ...TEST_SIDE_PRODUCT_SELECT },
    });
    if (!product) throw new NotFoundException('ไม่พบเครื่องที่เลือก');
    if (product.branchId !== branchId) throw new BadRequestException('เครื่องที่เลือกอยู่คนละสาขากับใบจอง');
    if (product.status !== 'IN_STOCK') throw new BadRequestException('เครื่องนี้ไม่พร้อมขาย กรุณาเลือกเครื่องอื่น');
    assertSameTestSide(customer, product);
    return product;
  }
```

ใน `create` แทนบล็อก `// test-data fence …` จนถึง `for (const product of fencedProducts) assertSameTestSide(customer, product); }` ด้วย:

```ts
    const productId = this.assertSingleDeviceItem(dto.items);
    await this.loadBookableProduct(productId, dto.branchId, customer);
```

ใน `update` หลังบรรทัด `if (dto.branchId) this.assertCanWriteBranch(user, dto.branchId);` เพิ่ม:

```ts
      if (dto.items) {
        const productId = this.assertSingleDeviceItem(dto.items);
        const owner = await tx.customer.findFirst({
          where: { id: dto.customerId ?? existing.customerId, deletedAt: null },
          select: TEST_SIDE_CUSTOMER_SELECT,
        });
        if (!owner) throw new NotFoundException('ไม่พบลูกค้า');
        await this.loadBookableProduct(productId, dto.branchId ?? existing.branchId, owner, tx);
      }
```

และเพิ่ม `customerId: true,` ใน `select` ของ `loadBookingScoped` ที่ต้นเมธอด `update` (ถัดจาก `branchId: true,`) — `TEST_SIDE_CUSTOMER_SELECT` import อยู่แล้ว

- [ ] **Step 8: รันเทสทั้งโมดูล + typecheck**

Run: `npm --prefix apps/api test -- src/modules/bookings`
Expected: PASS ทุกไฟล์ (list-filters · summary · events · booking-rules.dto · booking-receipt.dto · bookings.service)
Run: `./tools/check-types.sh api` → 0 errors

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/bookings
git commit -m "feat(bookings): บังคับผูกเครื่องในสต็อก 1 เครื่อง · มัดจำ > 0 · เหตุผลยกเลิกบังคับ"
```

---

### Task 5: Web — โฟลเดอร์ใหม่: `types.ts` + `utils.ts` (+ `describeExpiry`)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/types.ts`
- Create: `apps/web/src/pages/BookingsPage/utils.ts`
- Test: `apps/web/src/pages/BookingsPage/__tests__/utils.test.ts`

**Interfaces:**
- Consumes: `formatThaiDateShort`, `formatThaiDateTime` จาก `@/lib/date`
- Produces (ทุก task ถัดไป import จากสองไฟล์นี้):
  ```ts
  // types.ts
  export type BookingStatus = 'PENDING_DEPOSIT' | 'PAID' | 'CANCELED' | 'EXPIRED' | 'CONVERTED';
  export interface BookingProductRef { id: string; name: string; status: string; branchId: string; imeiSerial?: string | null; wasPreviouslyDamaged?: boolean }
  export interface BookingItem { id: string; productId?: string | null; description: string; quantity: number; unitPrice: string | number; amount: string | number; product?: BookingProductRef | null }
  export interface BookingEvent { id: string; kind: string; at: string; actor: { id: string; name: string } | null; data: Record<string, unknown> | null }
  export interface Booking { id; bookingNumber; status; depositAmount; totalAmount; expireDate; notes?; depositPaidAt?; depositMethod?; canceledAt?; cancelReason?; convertedAt?; customer: { id; name; phone? }; branch: { id; name; shopCashAccountCode? }; createdBy: { id; name }; canceledBy?; convertedToSale?: { id; saleNumber } | null; items: BookingItem[]; createdAt; events?: BookingEvent[] }
  export interface BookingListResponse { data: Booking[]; total: number; page: number; limit: number }
  export interface BookingSummary { total; open; pendingDeposit; paid; paidDepositHeld: string; expiringWithin3Days; closed: { converted; canceled; expired; total }; forfeitedThisMonth: string }
  export interface CustomerOption { id: string; name: string; phone?: string | null; chatPlaceholder?: boolean }
  export interface BranchOption { id: string; name: string }
  // utils.ts
  export const STATUS_LABEL: Record<BookingStatus, string>;
  export const STATUS_VARIANT: Record<BookingStatus, 'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info'>;
  export const OPEN_STATUSES: readonly BookingStatus[];
  export function isOpenStatus(s: BookingStatus): boolean;
  export function computeBookingTotal(items: { quantity: number; unitPrice: number }[]): number;
  export function isDepositInRange(deposit: number, total: number): boolean;   // 0 < deposit ≤ total
  export function fmtMoney(v: string | number): string;                         // 42,900.00
  export function fmtMoneyShort(v: string | number): string;                    // 42,900 (ไม่มีทศนิยมเมื่อเป็นจำนวนเต็ม)
  export function fmtDate(iso: string): string;                                  // formatThaiDateTime เวลาไทย
  export function bangkokDayDiff(iso: string, nowMs: number): number;
  export type ExpiryTone = 'normal' | 'soon' | 'today' | 'overdue' | 'closed';
  export interface ExpiryInfo { label: string; sub: string; tone: ExpiryTone }
  export const lastValidMs: (expireDate: string) => number;          // expireDate − 1 ms = วันสุดท้ายที่ใช้ได้
  export function describeExpiry(b: Pick<Booking, 'status' | 'expireDate' | 'convertedAt' | 'canceledAt' | 'depositPaidAt' | 'depositAmount'>, nowMs: number): ExpiryInfo;
  export function awaitingExpiry(b: Pick<Booking, 'status' | 'expireDate'>, nowMs: number): boolean;
  ```

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/web/src/pages/BookingsPage/__tests__/utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeBookingTotal, describeExpiry, isDepositInRange, STATUS_LABEL, bangkokDayDiff, fmtMoneyShort, awaitingExpiry } from '../utils';

// 5 ต.ค. 2569 10:00 เวลาไทย
const NOW = new Date('2026-10-05T03:00:00.000Z').getTime();
/** ใบจองเก็บ expireDate เป็นเที่ยงคืนไทยของวันถัดจากวันสุดท้ายที่ใช้ได้ (`toBangkokExpiryInstant`) */
const validThrough = (date: string) => `${date}T17:00:00.000Z`;
const open = (expireDate: string) => ({ status: 'PAID' as const, expireDate, convertedAt: null, canceledAt: null, depositPaidAt: '2026-10-01T03:00:00Z', depositAmount: '5000' });

describe('computeBookingTotal / isDepositInRange', () => {
  it('รวมยอดปัดทศนิยม 2 ตำแหน่ง', () => {
    expect(computeBookingTotal([{ quantity: 1, unitPrice: 35000 }, { quantity: 2, unitPrice: 5990 }])).toBe(46980);
    expect(computeBookingTotal([])).toBe(0);
  });
  it('มัดจำต้องมากกว่า 0 และไม่เกินยอดรวม (คำตัดสิน 2026-10-05)', () => {
    expect(isDepositInRange(0, 1000)).toBe(false);
    expect(isDepositInRange(500, 1000)).toBe(true);
    expect(isDepositInRange(1000, 1000)).toBe(true);
    expect(isDepositInRange(-1, 1000)).toBe(false);
    expect(isDepositInRange(1001, 1000)).toBe(false);
  });
});

describe('STATUS_LABEL', () => {
  it('ครบ 5 สถานะเป็นภาษาไทย', () => {
    expect(STATUS_LABEL).toEqual({ PENDING_DEPOSIT: 'รอชำระมัดจำ', PAID: 'มัดจำแล้ว', CANCELED: 'ยกเลิก', EXPIRED: 'หมดอายุ', CONVERTED: 'ขายแล้ว' });
  });
});

describe('describeExpiry — วันคงเหลือตามปฏิทินไทย', () => {
  it('หมดอายุสิ้นวันนี้ → "วันนี้" สีเตือน', () => {
    expect(describeExpiry(open(validThrough('2026-10-05')), NOW)).toMatchObject({ label: 'วันนี้', tone: 'today', sub: '5 ต.ค. 69' });
  });
  it('พรุ่งนี้ และ อีก 2–3 วัน → tone soon · อีก 6 วัน → normal', () => {
    expect(describeExpiry(open(validThrough('2026-10-06')), NOW)).toMatchObject({ label: 'พรุ่งนี้', tone: 'soon' });
    expect(describeExpiry(open(validThrough('2026-10-08')), NOW)).toMatchObject({ label: 'อีก 3 วัน', tone: 'soon' });
    expect(describeExpiry(open(validThrough('2026-10-11')), NOW)).toMatchObject({ label: 'อีก 6 วัน', tone: 'normal' });
  });
  it('เลยกำหนดแต่ cron ยังไม่ปิด → "หมดอายุแล้ว · รอระบบปิด"', () => {
    expect(describeExpiry(open(validThrough('2026-10-04')), NOW)).toEqual({ label: 'หมดอายุแล้ว', sub: 'รอระบบปิด', tone: 'overdue' });
    expect(awaitingExpiry(open(validThrough('2026-10-04')), NOW)).toBe(true);
    expect(awaitingExpiry(open(validThrough('2026-10-05')), NOW)).toBe(false);
  });
  it('สถานะปิดแล้วบอกเหตุการณ์แทนวันคงเหลือ', () => {
    expect(describeExpiry({ ...open(validThrough('2026-10-11')), status: 'CONVERTED', convertedAt: '2026-10-01T07:20:00Z' }, NOW))
      .toEqual({ label: 'ขายแล้ว', sub: '1 ต.ค. 69', tone: 'closed' });
    expect(describeExpiry({ ...open(validThrough('2026-10-11')), status: 'CANCELED', canceledAt: '2026-09-27T05:00:00Z' }, NOW))
      .toEqual({ label: 'ยกเลิก', sub: 'คืนมัดจำ 27 ก.ย. 69', tone: 'closed' });
    expect(describeExpiry({ ...open(validThrough('2026-09-27')), status: 'CANCELED', canceledAt: '2026-09-27T05:00:00Z', depositPaidAt: null }, NOW))
      .toEqual({ label: 'ยกเลิก', sub: '27 ก.ย. 69', tone: 'closed' });
    expect(describeExpiry({ ...open(validThrough('2026-09-27')), status: 'EXPIRED' }, NOW))
      .toEqual({ label: 'หมดอายุ', sub: 'ริบมัดจำ 5,000', tone: 'closed' });
  });
  it('bangkokDayDiff นับวันปฏิทินไทย ไม่ใช่ 24 ชม.', () => {
    // 23:30 ไทย วันนี้ (16:30Z) vs 00:30 ไทย พรุ่งนี้ (17:30Z) = ต่างกัน 1 วัน (นับวันปฏิทินไทย)
    expect(bangkokDayDiff('2026-10-05T17:30:00.000Z', new Date('2026-10-05T16:30:00.000Z').getTime())).toBe(1);
  });
  it('fmtMoneyShort ตัดทศนิยมเมื่อเป็นจำนวนเต็ม', () => {
    expect(fmtMoneyShort('42900.00')).toBe('42,900');
    expect(fmtMoneyShort(1500.5)).toBe('1,500.50');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/utils.test.ts`
Expected: FAIL — module `../utils` not found

- [ ] **Step 3: สร้าง `types.ts`**

```ts
export type BookingStatus = 'PENDING_DEPOSIT' | 'PAID' | 'CANCELED' | 'EXPIRED' | 'CONVERTED';

/** สถานะเครื่องปัจจุบันที่ API แปะมากับรายการ (เช็คสดในแผง) */
export interface BookingProductRef {
  id: string;
  name: string;
  status: string;
  branchId: string;
  imeiSerial?: string | null;
  wasPreviouslyDamaged?: boolean;
}

export interface BookingItem {
  id: string;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: string | number;
  amount: string | number;
  product?: BookingProductRef | null;
}

/** จาก AuditLog ของใบ (GET /bookings/:id → events[]) */
export interface BookingEvent {
  id: string;
  kind: string;
  at: string;
  actor: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

export interface Booking {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  depositAmount: string | number;
  totalAmount: string | number;
  expireDate: string;
  notes?: string | null;
  depositPaidAt?: string | null;
  depositMethod?: string | null;
  canceledAt?: string | null;
  cancelReason?: string | null;
  convertedAt?: string | null;
  customer: { id: string; name: string; phone?: string | null };
  branch: { id: string; name: string; shopCashAccountCode?: string | null };
  createdBy: { id: string; name: string };
  canceledBy?: { id: string; name: string } | null;
  convertedToSale?: { id: string; saleNumber: string } | null;
  items: BookingItem[];
  createdAt: string;
  events?: BookingEvent[];
}

export interface BookingListResponse {
  data: Booking[];
  total: number;
  page: number;
  limit: number;
}

export interface BookingSummary {
  total: number;
  open: number;
  pendingDeposit: number;
  paid: number;
  paidDepositHeld: string;
  expiringWithin3Days: number;
  closed: { converted: number; canceled: number; expired: number; total: number };
  forfeitedThisMonth: string;
}

export interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
  chatPlaceholder?: boolean;
}

export interface BranchOption {
  id: string;
  name: string;
}
```

- [ ] **Step 4: สร้าง `utils.ts`**

```ts
import { formatThaiDateShort, formatThaiDateTime } from '@/lib/date';
import type { Booking, BookingStatus } from './types';

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING_DEPOSIT: 'รอชำระมัดจำ',
  PAID: 'มัดจำแล้ว',
  CANCELED: 'ยกเลิก',
  EXPIRED: 'หมดอายุ',
  CONVERTED: 'ขายแล้ว',
};

export const STATUS_VARIANT: Record<BookingStatus, 'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info'> = {
  PENDING_DEPOSIT: 'info',
  PAID: 'success',
  CANCELED: 'destructive',
  EXPIRED: 'outline',
  CONVERTED: 'primary',
};

export const OPEN_STATUSES: readonly BookingStatus[] = ['PENDING_DEPOSIT', 'PAID'];
export const isOpenStatus = (status: BookingStatus): boolean => OPEN_STATUSES.includes(status);

export function computeBookingTotal(items: { quantity: number; unitPrice: number }[]): number {
  return items.reduce((sum, it) => sum + Math.round(it.quantity * it.unitPrice * 100) / 100, 0);
}

/** คำตัดสินเจ้าของ 2026-10-05: มัดจำต้อง > 0 (ไม่มีมัดจำ = ไม่มีอะไรให้ล็อกเครื่อง) และไม่เกินยอดรวม */
export function isDepositInRange(depositAmount: number, totalAmount: number): boolean {
  if (!Number.isFinite(depositAmount) || !Number.isFinite(totalAmount)) return false;
  return depositAmount > 0 && depositAmount <= totalAmount;
}

const toNumber = (v: string | number): number => (typeof v === 'string' ? parseFloat(v) : v);

export function fmtMoney(v: string | number): string {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtMoneyShort(v: string | number): string {
  const n = toNumber(v);
  if (!Number.isFinite(n)) return '0';
  const whole = Number.isInteger(Math.round(n * 100) / 100) && Number.isInteger(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

export function fmtDate(iso: string): string {
  return formatThaiDateTime(iso, 'Asia/Bangkok');
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const bangkokDayIndex = (ms: number): number => Math.floor((ms + BANGKOK_OFFSET_MS) / 86_400_000);

/** จำนวนวันปฏิทินไทยจาก "ตอนนี้" ถึง `iso` (0 = วันเดียวกัน) */
export function bangkokDayDiff(iso: string, nowMs: number): number {
  return bangkokDayIndex(new Date(iso).getTime()) - bangkokDayIndex(nowMs);
}

export function awaitingExpiry(b: Pick<Booking, 'status' | 'expireDate'>, nowMs: number): boolean {
  return isOpenStatus(b.status) && new Date(b.expireDate).getTime() <= nowMs;
}

export type ExpiryTone = 'normal' | 'soon' | 'today' | 'overdue' | 'closed';
export interface ExpiryInfo {
  label: string;
  sub: string;
  tone: ExpiryTone;
}

/** คอลัมน์/แถบ "หมดอายุ": ใบเปิด = วันคงเหลือ · ใบปิดแล้ว = เหตุการณ์ที่ปิด */
/** วันสุดท้ายที่ใช้ได้ = 1 ms ก่อน expireDate (ฟอร์มเก็บเป็นเที่ยงคืนไทยของวันถัดไป — `toBangkokExpiryInstant`) */
export const lastValidMs = (expireDate: string): number => new Date(expireDate).getTime() - 1;

export function describeExpiry(
  b: Pick<Booking, 'status' | 'expireDate' | 'convertedAt' | 'canceledAt' | 'depositPaidAt' | 'depositAmount'>,
  nowMs: number,
): ExpiryInfo {
  const lastValid = lastValidMs(b.expireDate);
  if (b.status === 'CONVERTED') {
    return { label: 'ขายแล้ว', sub: b.convertedAt ? formatThaiDateShort(b.convertedAt) : '', tone: 'closed' };
  }
  if (b.status === 'CANCELED') {
    const when = b.canceledAt ? formatThaiDateShort(b.canceledAt) : '';
    return { label: 'ยกเลิก', sub: b.depositPaidAt && when ? `คืนมัดจำ ${when}` : when, tone: 'closed' };
  }
  if (b.status === 'EXPIRED') {
    return { label: 'หมดอายุ', sub: b.depositPaidAt ? `ริบมัดจำ ${fmtMoneyShort(b.depositAmount)}` : formatThaiDateShort(new Date(lastValid)), tone: 'closed' };
  }
  if (new Date(b.expireDate).getTime() <= nowMs) return { label: 'หมดอายุแล้ว', sub: 'รอระบบปิด', tone: 'overdue' };
  const days = bangkokDayDiff(new Date(lastValid).toISOString(), nowMs);
  const sub = formatThaiDateShort(new Date(lastValid));
  if (days <= 0) return { label: 'วันนี้', sub, tone: 'today' };
  if (days === 1) return { label: 'พรุ่งนี้', sub, tone: 'soon' };
  return { label: `อีก ${days} วัน`, sub, tone: days <= 3 ? 'soon' : 'normal' };
}
```

- [ ] **Step 5: รันเทสให้ผ่าน**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/utils.test.ts`
Expected: PASS 8 เทส (ถ้า `formatThaiDateShort` ให้ปีไม่ตรง `69` ให้ดูค่าจริงที่พิมพ์แล้วปรับ expected ให้ตรงกับ helper กลาง — ห้ามแก้ helper กลาง)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): โฟลเดอร์ใหม่ types/utils + describeExpiry วันคงเหลือตามปฏิทินไทย"
```

---

### Task 6: Web — `useBookingsQuery` (URL state + query รายการ/สรุป/สาขา)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/hooks/useBookingsQuery.ts`
- Test: `apps/web/src/pages/BookingsPage/__tests__/useBookingsQuery.test.tsx`

**Interfaces:**
- Consumes: `useLatestSearchParams` (`@/hooks/useLatestSearchParams`) · `useDebounce` · `useAuth` · `api` · `TableSort` จาก `@/components/ui/DataTable` · types/utils ของ Task 5 · API ของ Task 1–2
- Produces:
  ```ts
  export type BookingView = 'open' | 'all' | 'status' | 'expiring';
  export const BOOKING_PAGE_LIMIT = 50;
  export interface UseBookingsQueryResult {
    view: BookingView; status: string; expiring: string; branchId: string; from: string; to: string;
    search: string; setSearch: (v: string) => void; debouncedSearch: string;
    page: number; setPage: (p: number) => void;
    sort: TableSort | null; setSort: (s: TableSort | null) => void;
    setFilters: (patch: Record<string, string>) => void; clearFilters: () => void; hasActiveFilters: boolean;
    activeKpiKey: 'open' | 'pendingDeposit' | 'paid' | 'expiring' | 'closed' | '';
    branches: BranchOption[]; canFilterBranch: boolean;
    listResult?: BookingListResponse; summary?: BookingSummary;
    isLoading: boolean; isError: boolean; error: unknown; refetch: () => void;
    buildParams: (targetPage?: number) => Record<string, string>;
  }
  export function useBookingsQuery(): UseBookingsQueryResult;
  ```
  URL keys: `status` · `all=1` · `expiring=3` · `branchId` · `from` · `to` · `q` · `sortBy` · `sortDirection` · `page` (ไม่มีคีย์เลย = มุมมอง "ที่ยังเปิดอยู่")
  query keys: `['bookings', params]` · `['bookings-summary', { branchId, from, to }]` · `['booking-branches']`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/web/src/pages/BookingsPage/__tests__/useBookingsQuery.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBookingsQuery } from '../hooks/useBookingsQuery';

const mocks = vi.hoisted(() => ({ get: vi.fn(), role: 'OWNER' as string }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get }, getErrorMessage: () => 'โหลดไม่สำเร็จ' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }) }));

function setup(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{children}</MemoryRouter></QueryClientProvider>
  );
  return renderHook(() => ({ q: useBookingsQuery(), location: useLocation() }), { wrapper });
}
const paramsOf = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useBookingsQuery — URL คือแหล่งความจริงของตัวกรอง', () => {
  beforeEach(() => {
    mocks.role = 'OWNER';
    mocks.get.mockReset();
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/bookings/summary')) return { data: { total: 8, open: 5, pendingDeposit: 1, paid: 4, paidDepositHeld: '33900.00', expiringWithin3Days: 3, closed: { converted: 1, canceled: 1, expired: 1, total: 3 }, forfeitedThisMonth: '3000.00' } };
      if (path === '/branches') return { data: [{ id: 'br-1', name: 'ลาดพร้าว' }, { id: 'br-2', name: 'รามอินทรา' }] };
      return { data: { data: [], total: 0, page: 1, limit: 50 } };
    });
  });

  it('ไม่มีคีย์ในกริ้ง → มุมมอง "ที่ยังเปิดอยู่" ส่ง open=1 เรียง expireDate asc', () => {
    const { result } = setup('/bookings?zone=shop');
    expect(result.current.q.view).toBe('open');
    expect(result.current.q.activeKpiKey).toBe('open');
    expect(result.current.q.buildParams()).toMatchObject({ open: '1', sort: 'expireDate', order: 'asc', page: '1', limit: '50' });
    expect(result.current.q.buildParams().status).toBeUndefined();
  });

  it('การ์ด "มัดจำแล้ว" → status=PAID ลบ open/expiring/all/page และคง ?zone=', () => {
    const { result } = setup('/bookings?zone=shop&page=3&expiring=3');
    act(() => result.current.q.setFilters({ status: 'PAID', expiring: '', all: '' }));
    expect(paramsOf(result.current.location.search)).toEqual({ zone: 'shop', status: 'PAID' });
    expect(result.current.q.view).toBe('status');
    expect(result.current.q.activeKpiKey).toBe('paid');
    expect(result.current.q.buildParams()).toMatchObject({ status: 'PAID', sort: 'createdAt', order: 'desc' });
  });

  it('กดการ์ดสองใบติดกันก่อน render → ใบหลังชนะ ตัวกรองไม่ทับกัน', () => {
    const { result } = setup('/bookings?zone=shop');
    act(() => {
      result.current.q.setFilters({ status: 'PAID', expiring: '', all: '' });
      result.current.q.setFilters({ expiring: '3', status: '', all: '' });
    });
    expect(paramsOf(result.current.location.search)).toEqual({ zone: 'shop', expiring: '3' });
    expect(result.current.q.activeKpiKey).toBe('expiring');
  });

  it('สถานะ "ทั้งหมด" ในดรอปดาวน์ = all=1 (ไม่ส่ง open)', () => {
    const { result } = setup('/bookings');
    act(() => result.current.q.setFilters({ all: '1', status: '', expiring: '' }));
    expect(result.current.q.view).toBe('all');
    expect(result.current.q.activeKpiKey).toBe('');
    const params = result.current.q.buildParams();
    expect(params.open).toBeUndefined();
    expect(params.status).toBeUndefined();
  });

  it('เรียงจากหัวตาราง เขียน sortBy/sortDirection และส่งเป็น sort/order', () => {
    const { result } = setup('/bookings');
    act(() => result.current.q.setSort({ key: 'createdAt', direction: 'asc' }));
    expect(paramsOf(result.current.location.search)).toEqual({ sortBy: 'createdAt', sortDirection: 'asc' });
    expect(result.current.q.buildParams()).toMatchObject({ sort: 'createdAt', order: 'asc' });
  });

  it('ค้นหา debounce แล้วส่งเป็น search และ reset หน้า', async () => {
    const { result } = setup('/bookings?page=2');
    act(() => result.current.q.setSearch('081-234'));
    await waitFor(() => expect(result.current.q.debouncedSearch).toBe('081-234'));
    expect(result.current.q.buildParams()).toMatchObject({ search: '081-234', page: '1' });
  });

  it('SALES ไม่เห็นตัวกรองสาขา และ branchId ในลิงก์ถูกเพิกเฉย', () => {
    mocks.role = 'SALES';
    const { result } = setup('/bookings?branchId=br-2');
    expect(result.current.q.canFilterBranch).toBe(false);
    expect(result.current.q.branchId).toBe('');
    expect(result.current.q.buildParams().branchId).toBeUndefined();
  });

  it('โหลดสรุปด้วยสาขา/ช่วงวันที่เดียวกับรายการ', async () => {
    const { result } = setup('/bookings?branchId=br-2&from=2026-10-01&to=2026-10-05');
    await waitFor(() => expect(result.current.q.summary?.total).toBe(8));
    const summaryCall = mocks.get.mock.calls.find(([path]) => String(path).startsWith('/bookings/summary'))?.[0] as string;
    expect(paramsOf(summaryCall.split('?')[1])).toEqual({ branchId: 'br-2', from: '2026-10-01', to: '2026-10-05' });
    expect(result.current.q.hasActiveFilters).toBe(true);
    act(() => result.current.q.clearFilters());
    expect(result.current.location.search).toBe('');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/useBookingsQuery.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: สร้าง hook**

`apps/web/src/pages/BookingsPage/hooks/useBookingsQuery.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TableSort } from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { useLatestSearchParams } from '@/hooks/useLatestSearchParams';
import api from '@/lib/api';
import type { BookingListResponse, BookingSummary, BranchOption } from '../types';

/**
 * URL state + query ของหน้า /bookings — ลอกกติกาจาก `pages/CustomersPage/hooks/useCustomersQuery.ts`:
 * อ่านตรงจาก searchParams (ไม่มี useState เงา ยกเว้นช่องค้นหาที่ debounce) · เขียนผ่าน
 * `useLatestSearchParams` เท่านั้น · ค่าเริ่มต้นไม่เขียนคีย์ · เปลี่ยนตัวกรองแล้วลบ page
 *
 * มุมมอง (ลำดับความสำคัญเมื่อมีหลายคีย์): status → expiring → all → open (ค่าเริ่มต้น)
 */
export type BookingView = 'open' | 'all' | 'status' | 'expiring';
export type BookingKpiKey = 'open' | 'pendingDeposit' | 'paid' | 'expiring' | 'closed' | '';

export const BOOKING_PAGE_LIMIT = 50;
const STATUS_VALUES = ['PENDING_DEPOSIT', 'PAID', 'CONVERTED', 'CANCELED', 'EXPIRED', 'CLOSED'] as const;
const SORT_KEYS = ['expireDate', 'createdAt'] as const;
const FILTER_KEYS = ['status', 'all', 'expiring', 'branchId', 'from', 'to', 'q', 'sortBy', 'sortDirection', 'page'] as const;
/** บทบาทที่ GET /branches ยอมให้เห็นข้ามสาขา (CROSS_BRANCH_ROLES ฝั่ง API) */
const BRANCH_FILTER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : '';
}

export interface UseBookingsQueryResult {
  view: BookingView;
  status: string;
  expiring: string;
  branchId: string;
  from: string;
  to: string;
  search: string;
  setSearch: (value: string) => void;
  debouncedSearch: string;
  page: number;
  setPage: (page: number) => void;
  sort: TableSort | null;
  setSort: (sort: TableSort | null) => void;
  /** ตั้งหลายคีย์พร้อมกัน (การ์ด KPI / ดรอปดาวน์) — ค่าว่าง = ลบคีย์ */
  setFilters: (patch: Record<string, string>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  activeKpiKey: BookingKpiKey;
  branches: BranchOption[];
  canFilterBranch: boolean;
  listResult?: BookingListResponse;
  summary?: BookingSummary;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  buildParams: (targetPage?: number) => Record<string, string>;
}

export function useBookingsQuery(): UseBookingsQueryResult {
  const [searchParams, updateParams] = useLatestSearchParams();
  const { user } = useAuth();
  const canFilterBranch = BRANCH_FILTER_ROLES.includes(user?.role ?? '');

  const status = pick(searchParams.get('status'), STATUS_VALUES);
  const expiring = /^\d+$/.test(searchParams.get('expiring') ?? '') ? (searchParams.get('expiring') as string) : '';
  const all = searchParams.get('all') === '1';
  const view: BookingView = status ? 'status' : expiring ? 'expiring' : all ? 'all' : 'open';
  const branchId = canFilterBranch ? (searchParams.get('branchId') ?? '') : '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const sortBy = pick(searchParams.get('sortBy'), SORT_KEYS);
  const sort: TableSort | null = sortBy
    ? { key: sortBy, direction: searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc' }
    : null;

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(search);

  const write = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      updateParams((next) => {
        mutate(next);
        next.delete('page');
      });
    },
    [updateParams],
  );

  const setFilters = useCallback(
    (patch: Record<string, string>) => {
      write((next) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
      });
    },
    [write],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    write((next) => FILTER_KEYS.forEach((key) => next.delete(key)));
  }, [write]);

  const setSort = useCallback(
    (next: TableSort | null) => {
      write((params) => {
        if (next && (SORT_KEYS as readonly string[]).includes(next.key)) {
          params.set('sortBy', next.key);
          params.set('sortDirection', next.direction);
        } else {
          params.delete('sortBy');
          params.delete('sortDirection');
        }
      });
    },
    [write],
  );

  const setPage = useCallback(
    (next: number) => {
      updateParams((params) => {
        if (next > 1) params.set('page', String(next));
        else params.delete('page');
      });
    },
    [updateParams],
  );

  const activeKpiKey: BookingKpiKey =
    view === 'open' ? 'open'
    : view === 'expiring' ? 'expiring'
    : status === 'PENDING_DEPOSIT' ? 'pendingDeposit'
    : status === 'PAID' ? 'paid'
    : status === 'CLOSED' ? 'closed'
    : '';

  const buildParams = useCallback(
    (targetPage: number = debouncedSearch !== (searchParams.get('q') ?? '') ? 1 : page): Record<string, string> => {
      const params: Record<string, string> = { page: String(targetPage), limit: String(BOOKING_PAGE_LIMIT) };
      if (view === 'status') params.status = status;
      else if (view === 'expiring') params.expiring = expiring;
      else if (view === 'open') params.open = '1';
      if (branchId) params.branchId = branchId;
      if (from) params.from = from;
      if (to) params.to = to;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const sortField = sort?.key ?? (view === 'open' || view === 'expiring' ? 'expireDate' : 'createdAt');
      params.sort = sortField;
      params.order = sort?.direction ?? (sortField === 'expireDate' ? 'asc' : 'desc');
      return params;
    },
    [view, status, expiring, branchId, from, to, debouncedSearch, sort, page, searchParams],
  );

  const listParams = useMemo(() => buildParams(), [buildParams]);
  const listQuery = useQuery<BookingListResponse>({
    queryKey: ['bookings', listParams],
    queryFn: async () => (await api.get(`/bookings?${new URLSearchParams(listParams)}`)).data,
  });

  const summaryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (branchId) params.branchId = branchId;
    if (from) params.from = from;
    if (to) params.to = to;
    return params;
  }, [branchId, from, to]);
  const summaryQuery = useQuery<BookingSummary>({
    queryKey: ['bookings-summary', summaryParams],
    queryFn: async () => (await api.get(`/bookings/summary?${new URLSearchParams(summaryParams)}`)).data,
  });

  const branchesQuery = useQuery<BranchOption[]>({
    queryKey: ['booking-branches'],
    enabled: canFilterBranch,
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return (data.data ?? data ?? []) as BranchOption[];
    },
  });

  const hasActiveFilters = view !== 'open' || !!branchId || !!from || !!to || !!debouncedSearch.trim() || !!sort;

  return {
    view, status, expiring, branchId, from, to,
    search, setSearch, debouncedSearch,
    page, setPage, sort, setSort,
    setFilters, clearFilters, hasActiveFilters, activeKpiKey,
    branches: branchesQuery.data ?? [], canFilterBranch,
    listResult: listQuery.data, summary: summaryQuery.data,
    isLoading: listQuery.isLoading, isError: listQuery.isError, error: listQuery.error,
    refetch: () => { void listQuery.refetch(); void summaryQuery.refetch(); },
    buildParams,
  };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/useBookingsQuery.test.tsx`
Expected: PASS 8 เทส

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): useBookingsQuery — ตัวกรองใน URL (open/status/expiring/all · สาขา · วันที่ · เรียง)"
```

---

### Task 7: Web — `BookingKpiCards` (การ์ด 6 ใบ กดกรอง)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/components/BookingKpiCards.tsx`
- Test: `apps/web/src/pages/BookingsPage/__tests__/BookingKpiCards.test.tsx`

**Interfaces:**
- Consumes: `BookingSummary`, `BookingKpiKey` · `fmtMoneyShort` · `Card`/`CardContent` จาก `@/components/ui/card` · `cn`
- Produces:
  ```ts
  export interface BookingKpiSpec { key: BookingKpiKey | 'forfeited'; label: string; tone: 'primary' | 'info' | 'success' | 'warning' | 'muted'; value: string; sub?: string; params?: Record<string, string> }  // ไม่มี params = ไม่กดกรอง
  export function bookingKpiCards(summary?: BookingSummary): BookingKpiSpec[];   // 6 ใบ เรียงตาม mockup 1A
  export default function BookingKpiCards({ summary, activeKey, onPick }: { summary?: BookingSummary; activeKey: BookingKpiKey; onPick: (params: Record<string, string>) => void }): JSX.Element;
  ```
  `params` ของแต่ละใบ **เขียนทับคีย์ของกันครบ** (status/expiring/all) — กดต่อกันแล้วไม่เหลือตัวกรองซ้อน (บทเรียนหน้าลูกค้า)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingKpiCards, { bookingKpiCards } from '../components/BookingKpiCards';

const summary = { total: 8, open: 5, pendingDeposit: 1, paid: 4, paidDepositHeld: '33900.00', expiringWithin3Days: 3,
  closed: { converted: 1, canceled: 1, expired: 1, total: 3 }, forfeitedThisMonth: '3000.00' };

describe('BookingKpiCards', () => {
  it('6 ใบ: 5 ใบกดกรองได้ และใบ "ริบเดือนนี้" เป็นตัวเลขอย่างเดียว', () => {
    const specs = bookingKpiCards(summary);
    expect(specs.map((s) => s.key)).toEqual(['open', 'pendingDeposit', 'paid', 'expiring', 'closed', 'forfeited']);
    expect(specs.filter((s) => s.params)).toHaveLength(5);
    expect(specs.find((s) => s.key === 'paid')).toMatchObject({ value: '4', sub: 'ถือมัดจำอยู่ ฿33,900' });
    expect(specs.find((s) => s.key === 'forfeited')).toMatchObject({ value: '฿3,000', params: undefined });
  });

  it('ทุกใบที่กดได้เขียนทับ status/expiring/all ครบ (กดต่อกันแล้วไม่ซ้อน)', () => {
    for (const spec of bookingKpiCards(summary).filter((s) => s.params)) {
      expect(Object.keys(spec.params!).sort()).toEqual(['all', 'expiring', 'status']);
    }
    expect(bookingKpiCards(summary).find((s) => s.key === 'open')!.params).toEqual({ status: '', expiring: '', all: '' });
    expect(bookingKpiCards(summary).find((s) => s.key === 'expiring')!.params).toEqual({ status: '', expiring: '3', all: '' });
    expect(bookingKpiCards(summary).find((s) => s.key === 'closed')!.params).toEqual({ status: 'CLOSED', expiring: '', all: '' });
  });

  it('กดใบ "ใกล้หมดอายุ" ส่ง params ของใบนั้น และใบที่ active มี aria-pressed', async () => {
    const onPick = vi.fn();
    render(<BookingKpiCards summary={summary} activeKey="open" onPick={onPick} />);
    expect(screen.getByRole('button', { name: /ที่ยังเปิดอยู่/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /ใกล้หมดอายุ/ }));
    expect(onPick).toHaveBeenCalledWith({ status: '', expiring: '3', all: '' });
    expect(screen.queryByRole('button', { name: /ริบเดือนนี้/ })).toBeNull();
  });

  it('ยังไม่มีสรุป → แสดง 0 ไม่พัง', () => {
    render(<BookingKpiCards activeKey="" onPick={() => {}} />);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingKpiCards.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: สร้าง component**

```tsx
import { cn } from '@/lib/utils';
import type { BookingKpiKey } from '../hooks/useBookingsQuery';
import type { BookingSummary } from '../types';
import { fmtMoneyShort } from '../utils';

type Tone = 'primary' | 'info' | 'success' | 'warning' | 'muted';
const TONE_BAR: Record<Tone, string> = {
  primary: 'bg-primary', info: 'bg-info', success: 'bg-success', warning: 'bg-warning', muted: 'bg-muted-foreground',
};
const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-foreground', info: 'text-info', success: 'text-success', warning: 'text-warning-strong', muted: 'text-foreground',
};

export interface BookingKpiSpec {
  key: BookingKpiKey | 'forfeited';
  label: string;
  tone: Tone;
  value: string;
  sub?: string;
  /** ไม่มี = การ์ดตัวเลขอย่างเดียว ไม่กดกรอง */
  params?: Record<string, string>;
}

/**
 * การ์ด 6 ใบตาม mockup 1A · ใบที่กดได้ **เขียนทับ status/expiring/all ครบทุกใบ** — กดต่อกันแล้วไม่เหลือ
 * ตัวกรองซ้อนที่มองไม่เห็น (บทเรียน CustomerKpiCards) · ตัวเลขทุกใบมาจาก GET /bookings/summary
 * ซึ่งใช้ where เดียวกับรายการ ⇒ การ์ดกับตารางไม่เถียงกัน
 */
export function bookingKpiCards(summary?: BookingSummary): BookingKpiSpec[] {
  const s = summary;
  return [
    { key: 'open', label: 'ที่ยังเปิดอยู่', tone: 'primary', value: String(s?.open ?? 0), sub: `ทั้งหมด ${s?.total ?? 0} ใบ`, params: { status: '', expiring: '', all: '' } },
    { key: 'pendingDeposit', label: 'รอชำระมัดจำ', tone: 'info', value: String(s?.pendingDeposit ?? 0), sub: 'ยังไม่รับเงิน', params: { status: 'PENDING_DEPOSIT', expiring: '', all: '' } },
    { key: 'paid', label: 'มัดจำแล้ว · รอรับเครื่อง', tone: 'success', value: String(s?.paid ?? 0), sub: `ถือมัดจำอยู่ ฿${fmtMoneyShort(s?.paidDepositHeld ?? 0)}`, params: { status: 'PAID', expiring: '', all: '' } },
    { key: 'expiring', label: 'ใกล้หมดอายุ (≤ 3 วัน)', tone: 'warning', value: String(s?.expiringWithin3Days ?? 0), sub: 'รวมใบที่รอระบบปิด', params: { status: '', expiring: '3', all: '' } },
    { key: 'closed', label: 'ปิดแล้ว', tone: 'muted', value: String(s?.closed.total ?? 0), sub: `ขาย ${s?.closed.converted ?? 0} · ยกเลิก ${s?.closed.canceled ?? 0} · หมดอายุ ${s?.closed.expired ?? 0}`, params: { status: 'CLOSED', expiring: '', all: '' } },
    { key: 'forfeited', label: 'มัดจำที่ริบเดือนนี้', tone: 'muted', value: `฿${fmtMoneyShort(s?.forfeitedThisMonth ?? 0)}`, sub: 'ใบหมดอายุที่เคยรับมัดจำ' },
  ];
}

export default function BookingKpiCards({
  summary,
  activeKey,
  onPick,
}: {
  summary?: BookingSummary;
  activeKey: BookingKpiKey;
  onPick: (params: Record<string, string>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="สรุปใบจอง">
      {bookingKpiCards(summary).map((card) => {
        const active = card.key === activeKey;
        const body = (
          <>
            <span aria-hidden="true" className={cn('absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r', TONE_BAR[card.tone])} />
            <span className="text-xs leading-snug text-muted-foreground">{card.label}</span>
            <span className={cn('text-2xl font-semibold leading-tight tabular-nums', TONE_TEXT[card.tone])}>{card.value}</span>
            {card.sub && <span className="text-[11px] leading-snug text-muted-foreground">{card.sub}</span>}
          </>
        );
        const className = cn(
          'relative flex flex-col items-start gap-1 overflow-hidden rounded-lg border bg-card px-3.5 py-3 pl-[18px] text-left shadow-card',
          active ? 'border-primary ring-1 ring-primary' : 'border-border',
        );
        return card.params ? (
          <button key={card.key} type="button" aria-pressed={active} onClick={() => onPick(card.params!)} className={cn(className, 'transition-shadow hover:shadow-card-hover')}>
            {body}
          </button>
        ) : (
          <div key={card.key} className={className}>{body}</div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingKpiCards.test.tsx`
Expected: PASS 4 เทส

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): การ์ด KPI 6 ใบ กดกรอง เขียนทับคีย์ครบ"
```

---

### Task 8: Web — `BookingFilterBar` (ค้นหา · สถานะ · สาขา · ช่วงวันที่)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/components/BookingFilterBar.tsx`
- Test: รวมอยู่ในเทสหน้า (Task 12) — ชิ้นนี้ไม่มี logic นอกจากต่อสาย

**Interfaces:**
- Consumes: `FilterSelect` + `ALL` จาก `@/pages/CustomersPage/components/FilterSelect` (default export · props `ariaLabel placeholder value onChange width groups`) · `ResponsiveFilterPanel` (default export · props `search children`) · `DateRangeChips` (**named export** `{ DateRangeChips }`) · `STATUS_LABEL`
- Produces:
  ```ts
  export const BOOKING_SEARCH_PLACEHOLDER = 'ค้นหา เลขที่ใบจอง · ชื่อลูกค้า · เบอร์โทร · IMEI';
  export default function BookingFilterBar(props: { search: string; setSearch: (v: string) => void; view: BookingView; status: string; branchId: string; from: string; to: string; branches: BranchOption[]; canFilterBranch: boolean; setFilters: (patch: Record<string, string>) => void }): JSX.Element;
  ```
  ดรอปดาวน์สถานะ: ค่า `OPEN` (ที่ยังเปิดอยู่ = ค่าเริ่มต้น) · `ALL` (ทั้งหมด → `all=1`) · 5 สถานะ · `CLOSED` (ปิดแล้ว)

- [ ] **Step 1: สร้าง component**

```tsx
import { Search } from 'lucide-react';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import FilterSelect, { ALL } from '@/pages/CustomersPage/components/FilterSelect';
import type { BookingView } from '../hooks/useBookingsQuery';
import type { BranchOption } from '../types';
import { STATUS_LABEL } from '../utils';

export const BOOKING_SEARCH_PLACEHOLDER = 'ค้นหา เลขที่ใบจอง · ชื่อลูกค้า · เบอร์โทร · IMEI';
const OPEN = 'OPEN';

/** ค่าในดรอปดาวน์ ↔ ตัวกรองใน URL (ดรอปดาวน์กับการ์ด KPI เขียนคีย์ชุดเดียวกัน) */
function statusSelectValue(view: BookingView, status: string): string {
  if (view === 'status') return status;
  if (view === 'all') return ALL;
  return OPEN;
}
function statusPatch(value: string): Record<string, string> {
  if (value === ALL) return { all: '1', status: '', expiring: '' };
  if (value === OPEN) return { all: '', status: '', expiring: '' };
  return { status: value, all: '', expiring: '' };
}

export default function BookingFilterBar({
  search, setSearch, view, status, branchId, from, to, branches, canFilterBranch, setFilters,
}: {
  search: string;
  setSearch: (value: string) => void;
  view: BookingView;
  status: string;
  branchId: string;
  from: string;
  to: string;
  branches: BranchOption[];
  canFilterBranch: boolean;
  setFilters: (patch: Record<string, string>) => void;
}) {
  return (
    <ResponsiveFilterPanel
      search={
        <div className="relative lg:col-span-2">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={BOOKING_SEARCH_PLACEHOLDER}
            aria-label="ค้นหาใบจอง"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-hidden transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
      }
    >
      <FilterSelect
        ariaLabel="สถานะใบจอง"
        placeholder="ทั้งหมด"
        value={statusSelectValue(view, status)}
        onChange={(value) => setFilters(statusPatch(value))}
        width="w-[180px]"
        groups={[
          { options: [{ value: OPEN, label: 'ที่ยังเปิดอยู่' }] },
          { label: 'สถานะ', options: (Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
          { options: [{ value: 'CLOSED', label: 'ปิดแล้ว (ขาย/ยกเลิก/หมดอายุ)' }] },
        ]}
      />
      {canFilterBranch && (
        <FilterSelect
          ariaLabel="สาขา"
          placeholder="ทุกสาขา"
          value={branchId || ALL}
          onChange={(value) => setFilters({ branchId: value === ALL ? '' : value })}
          width="w-[150px]"
          groups={[{ options: branches.map((b) => ({ value: b.id, label: b.name })) }]}
        />
      )}
      <DateRangeChips
        startDate={from}
        endDate={to}
        onChange={({ startDate, endDate }) => setFilters({ from: startDate, to: endDate })}
      />
    </ResponsiveFilterPanel>
  );
}
```

ก่อน commit เปิด `FilterSelect.tsx` ยืนยันชื่อ prop `width` (ถ้าชื่อต่าง เช่น `className` ให้ใช้ตามไฟล์จริง) และ `ResponsiveFilterPanel` รับ `search` + `children` (ตรวจแล้ว 2026-10-05)

- [ ] **Step 2: typecheck**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): แถบตัวกรอง ค้นหา/สถานะ/สาขา/ช่วงวันที่ เขียน URL ชุดเดียวกับการ์ด"
```

---

### Task 9: Web — คอลัมน์ตาราง 1,120 px · `BookingTable` · `BookingCardList` (จอโทรศัพท์)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/components/bookingColumns.tsx`
- Create: `apps/web/src/pages/BookingsPage/components/BookingTable.tsx`
- Create: `apps/web/src/pages/BookingsPage/components/BookingCardList.tsx`
- Test: `apps/web/src/pages/BookingsPage/__tests__/BookingTable.test.tsx`

**Interfaces:**
- Consumes: `DataTable`, `Column`, `TableSort` จาก `@/components/ui/DataTable` · `Badge`, `BadgeDot` จาก `@/components/ui/badge` · `DropdownMenu*` จาก `@/components/ui/dropdown-menu` · `Button` · `useIsMobile` จาก `@/hooks/useIsMobile` · utils/types
- Produces:
  ```ts
  export interface BookingRowActions { onOpen: (b: Booking) => void; onCollectDeposit: (b: Booking) => void; onCancel: (b: Booking) => void; canMutate: boolean }
  export const BOOKING_COLUMN_WIDTHS = { number: 136, customer: 190, product: 236, branch: 92, deposit: 108, balance: 100, status: 118, expiry: 96, menu: 44 } as const;  // รวม 1,120
  export function bookingColumns(nowMs: number, actions: BookingRowActions): Column<Booking>[];
  export function ExpiryCell({ booking, nowMs }: { booking: Booking; nowMs: number }): JSX.Element;
  export default function BookingTable(props: { rows: Booking[]; total: number; page: number; onPageChange: (p: number) => void; sort: TableSort | null; onSortChange: (s: TableSort | null) => void; isLoading: boolean; nowMs: number; actions: BookingRowActions; hasActiveFilters: boolean; onClearFilters: () => void }): JSX.Element;
  export function toApiSort(s: TableSort | null): TableSort | null;     // คีย์คอลัมน์ → คีย์ API (bookingNumber → createdAt)
  export function toColumnSort(s: TableSort | null): TableSort | null;  // คีย์ API → คีย์คอลัมน์ (DataTable ไฮไลต์ตาม col.key)
  export function BookingCardList(props: { rows: Booking[]; nowMs: number; onOpen: (b: Booking) => void }): JSX.Element;
  ```

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingTable, { BookingCardList, toApiSort, toColumnSort } from '../components/BookingTable';
import { BOOKING_COLUMN_WIDTHS, bookingColumns } from '../components/bookingColumns';
import type { Booking } from '../types';

const NOW = new Date('2026-10-05T03:00:00.000Z').getTime();
const row = (over: Partial<Booking>): Booking => ({
  id: 'bk-1', bookingNumber: 'BK-20261005-0002', status: 'PAID', depositAmount: '5000', totalAmount: '42900',
  expireDate: '2026-10-11T17:00:00.000Z', depositPaidAt: '2026-10-05T03:55:00Z', createdAt: '2026-10-05T03:42:00Z',
  customer: { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' }, branch: { id: 'br-1', name: 'ลาดพร้าว' },
  createdBy: { id: 'u1', name: 'น้ำ' },
  items: [{ id: 'i1', productId: 'p1', description: 'iPhone 16 Pro 256GB · ดำไทเทเนียม', quantity: 1, unitPrice: '42900', amount: '42900',
    product: { id: 'p1', name: 'iPhone 16 Pro 256GB', status: 'IN_STOCK', branchId: 'br-1', imeiSerial: '354912070045218' } }],
  ...over,
});
const actions = { onOpen: vi.fn(), onCollectDeposit: vi.fn(), onCancel: vi.fn(), canMutate: true };
const tableProps = { total: 2, page: 1, onPageChange: vi.fn(), sort: null, onSortChange: vi.fn(), isLoading: false, nowMs: NOW, actions, hasActiveFilters: false, onClearFilters: vi.fn() };

describe('bookingColumns', () => {
  it('9 คอลัมน์ กว้างรวม 1,120 px พอดีจอ 1440 (งบโซน shop) และทุกคอลัมน์ตั้ง width', () => {
    const cols = bookingColumns(NOW, actions);
    expect(cols).toHaveLength(9);
    expect(Object.values(BOOKING_COLUMN_WIDTHS).reduce((a, b) => a + b, 0)).toBe(1120);
    expect(cols.every((c) => typeof c.width === 'string' && c.width.endsWith('px'))).toBe(true);
    expect(cols.map((c) => c.label)).toEqual(['เลขที่ / สร้างเมื่อ', 'ลูกค้า', 'สินค้าที่จอง', 'สาขา', 'มัดจำ', 'คงเหลือ', 'สถานะ', 'หมดอายุ', '']);
    expect(cols.filter((c) => c.sortable).map((c) => c.sortKey ?? c.key)).toEqual(['createdAt', 'expireDate']);
  });
});

describe('BookingTable', () => {
  it('แสดงมัดจำ "จาก ยอดรวม" คงเหลือ และวันคงเหลือสีเตือนเมื่อหมดอายุวันนี้', () => {
    render(<BookingTable {...tableProps} rows={[row({}), row({ id: 'bk-2', bookingNumber: 'BK-20261002-0001', expireDate: '2026-10-05T17:00:00.000Z', depositAmount: '10000', totalAmount: '29900' })]} />);
    const first = screen.getByText('BK-20261005-0002').closest('tr')!;
    expect(within(first).getByText('5,000')).toBeInTheDocument();
    expect(within(first).getByText('จาก 42,900')).toBeInTheDocument();
    expect(within(first).getByText('37,900')).toBeInTheDocument();
    expect(within(first).getByText('อีก 6 วัน')).toBeInTheDocument();
    const second = screen.getByText('BK-20261002-0001').closest('tr')!;
    expect(within(second).getByText('วันนี้')).toHaveClass('text-warning-strong');
  });

  it('ใบปิดแล้ว: คงเหลือเป็น — และคอลัมน์หมดอายุบอกเหตุการณ์', () => {
    render(<BookingTable {...tableProps} rows={[row({ status: 'CONVERTED', convertedAt: '2026-10-01T07:20:00Z' })]} />);
    const tr = screen.getByText('BK-20261005-0002').closest('tr')!;
    expect(within(tr).getByText('—')).toBeInTheDocument();
    expect(within(tr).getAllByText('ขายแล้ว').length).toBeGreaterThanOrEqual(2); // ป้ายสถานะ + คอลัมน์หมดอายุ
  });

  it('กดแถวเปิดแผง · เมนู ⋯ ของใบรอมัดจำมี "รับมัดจำ" และไม่พาไปเปิดแผงซ้ำ', async () => {
    const onOpen = vi.fn(); const onCollectDeposit = vi.fn();
    render(<BookingTable {...tableProps} actions={{ ...actions, onOpen, onCollectDeposit }} rows={[row({ status: 'PENDING_DEPOSIT', depositPaidAt: null })]} />);
    await userEvent.click(screen.getByText('สมชาย ใจดี'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /การกระทำ BK-20261005-0002/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'รับมัดจำ' }));
    expect(onCollectDeposit).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-1' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ผลกรองว่าง → ปุ่มล้างตัวกรอง', async () => {
    const onClearFilters = vi.fn();
    render(<BookingTable {...tableProps} rows={[]} total={0} hasActiveFilters onClearFilters={onClearFilters} />);
    await userEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    expect(onClearFilters).toHaveBeenCalled();
  });
});

describe('การแปลงคีย์เรียง (DataTable ส่ง col.key แต่ API รู้จัก createdAt/expireDate)', () => {
  it('bookingNumber ↔ createdAt · expireDate คงเดิม · null ผ่าน', () => {
    expect(toApiSort({ key: 'bookingNumber', direction: 'asc' })).toEqual({ key: 'createdAt', direction: 'asc' });
    expect(toColumnSort({ key: 'createdAt', direction: 'desc' })).toEqual({ key: 'bookingNumber', direction: 'desc' });
    expect(toApiSort({ key: 'expireDate', direction: 'asc' })).toEqual({ key: 'expireDate', direction: 'asc' });
    expect(toApiSort(null)).toBeNull();
  });
});

describe('BookingCardList (จอโทรศัพท์)', () => {
  it('การ์ดต่อใบ แสดงเลขที่ ชื่อ มัดจำ คงเหลือ และกดเปิดได้', async () => {
    const onOpen = vi.fn();
    render(<BookingCardList rows={[row({})]} nowMs={NOW} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /BK-20261005-0002/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-1' }));
    expect(screen.getByText(/คงเหลือ/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingTable.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: สร้าง `bookingColumns.tsx`**

```tsx
import { Ban, Clock, HandCoins, MoreHorizontal, ExternalLink } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';
import { Badge, BadgeDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Booking } from '../types';
import { describeExpiry, fmtMoneyShort, formatCreated, isOpenStatus, STATUS_LABEL, STATUS_VARIANT } from '../utils';

export interface BookingRowActions {
  onOpen: (b: Booking) => void;
  onCollectDeposit: (b: Booking) => void;
  onCancel: (b: Booking) => void;
  canMutate: boolean;
}

/** รวม 1,120 px = งบตารางโซน shop บนจอ 1440 (เมนูซ้าย 292 + ขอบ 28) — ห้ามซ่อนคอลัมน์ บีบให้พอดีเท่านั้น */
export const BOOKING_COLUMN_WIDTHS = {
  number: 136, customer: 190, product: 236, branch: 92, deposit: 108, balance: 100, status: 118, expiry: 96, menu: 44,
} as const;
const px = (n: number) => `${n}px`;

const TONE_CLASS = {
  normal: 'text-foreground',
  soon: 'text-warning-strong font-medium',
  today: 'text-warning-strong font-semibold',
  overdue: 'text-destructive font-semibold',
  closed: 'text-muted-foreground',
} as const;

export function ExpiryCell({ booking, nowMs }: { booking: Booking; nowMs: number }) {
  const info = describeExpiry(booking, nowMs);
  return (
    <div className="min-w-0 leading-snug">
      <span className={cn('inline-flex items-center gap-1', TONE_CLASS[info.tone])}>
        {(info.tone === 'soon' || info.tone === 'today' || info.tone === 'overdue') && <Clock aria-hidden="true" className="size-3.5" />}
        {info.label}
      </span>
      {info.sub && <span className="block truncate text-[11px] text-muted-foreground">{info.sub}</span>}
    </div>
  );
}

const balanceOf = (b: Booking) => Number(b.totalAmount) - Number(b.depositAmount);

export function bookingColumns(nowMs: number, actions: BookingRowActions): Column<Booking>[] {
  return [
    {
      key: 'bookingNumber', label: 'เลขที่ / สร้างเมื่อ', sortable: true, sortKey: 'createdAt', width: px(BOOKING_COLUMN_WIDTHS.number),
      className: 'pl-4', headerClassName: 'pl-4',
      render: (b) => (
        <div className="leading-snug">
          <span className="font-mono text-xs">{b.bookingNumber}</span>
          <span className="block text-[11px] text-muted-foreground">{formatCreated(b.createdAt)}</span>
        </div>
      ),
    },
    {
      key: 'customer', label: 'ลูกค้า', width: px(BOOKING_COLUMN_WIDTHS.customer),
      render: (b) => (
        <div className="min-w-0 leading-snug">
          <span className="block truncate font-medium">{b.customer.name}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{b.customer.phone ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'product', label: 'สินค้าที่จอง', width: px(BOOKING_COLUMN_WIDTHS.product),
      render: (b) => {
        const item = b.items[0];
        const imei = item?.product?.imeiSerial;
        return (
          <div className="min-w-0 leading-snug">
            <span className="block truncate">{item?.description ?? '—'}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{imei ? `IMEI …${imei.slice(-4)}` : item?.productId ? 'ผูกเครื่องแล้ว' : 'ไม่ได้ผูกเครื่อง'}</span>
          </div>
        );
      },
    },
    { key: 'branch', label: 'สาขา', width: px(BOOKING_COLUMN_WIDTHS.branch), render: (b) => <span className="block truncate">{b.branch.name}</span> },
    {
      key: 'deposit', label: 'มัดจำ', align: 'right', width: px(BOOKING_COLUMN_WIDTHS.deposit),
      render: (b) => (
        <div className="leading-snug tabular-nums">
          <span className="font-medium">{fmtMoneyShort(b.depositAmount)}</span>
          <span className="block text-[11px] text-muted-foreground">จาก {fmtMoneyShort(b.totalAmount)}</span>
        </div>
      ),
    },
    {
      key: 'balance', label: 'คงเหลือ', align: 'right', width: px(BOOKING_COLUMN_WIDTHS.balance),
      render: (b) => {
        if (!isOpenStatus(b.status)) return <span className="text-muted-foreground">—</span>;
        const balance = balanceOf(b);
        return balance <= 0 ? <span className="text-muted-foreground">0</span> : <span className="font-medium tabular-nums">{fmtMoneyShort(balance)}</span>;
      },
    },
    {
      key: 'status', label: 'สถานะ', width: px(BOOKING_COLUMN_WIDTHS.status),
      render: (b) => (
        <Badge variant={STATUS_VARIANT[b.status]} className="gap-1.5 whitespace-nowrap">
          <BadgeDot />
          {STATUS_LABEL[b.status]}
        </Badge>
      ),
    },
    { key: 'expireDate', label: 'หมดอายุ', sortable: true, width: px(BOOKING_COLUMN_WIDTHS.expiry), render: (b) => <ExpiryCell booking={b} nowMs={nowMs} /> },
    {
      key: 'menu', label: '', align: 'center', width: px(BOOKING_COLUMN_WIDTHS.menu),
      render: (b) => (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" aria-label={`การกระทำ ${b.bookingNumber}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => actions.onOpen(b)}><ExternalLink className="size-4" /> เปิด</DropdownMenuItem>
              {actions.canMutate && b.status === 'PENDING_DEPOSIT' && (
                <DropdownMenuItem onSelect={() => actions.onCollectDeposit(b)}><HandCoins className="size-4" /> รับมัดจำ</DropdownMenuItem>
              )}
              {actions.canMutate && isOpenStatus(b.status) && (
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => actions.onCancel(b)}><Ban className="size-4" /> ยกเลิกใบจอง</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}
```

เพิ่มใน `utils.ts`:

```ts
import { formatThaiDateShort, formatThaiDateTime, formatThaiTime } from '@/lib/date';
/** "5 ต.ค. 69 10:42" สำหรับคอลัมน์เลขที่ */
export function formatCreated(iso: string): string {
  return `${formatThaiDateShort(iso)} ${formatThaiTime(iso)}`;
}
```

- [ ] **Step 4: สร้าง `BookingTable.tsx` + `BookingCardList.tsx`**

`BookingTable.tsx`:

```tsx
import { CalendarDays } from 'lucide-react';
import DataTable, { type TableSort } from '@/components/ui/DataTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { BOOKING_PAGE_LIMIT } from '../hooks/useBookingsQuery';
import type { Booking } from '../types';
import { bookingColumns, type BookingRowActions } from './bookingColumns';
import { BookingCardList } from './BookingCardList';

export { BookingCardList };

/** DataTable รายงานการเรียงด้วย `col.key` (บรรทัด ~292 ของ DataTable.tsx) แต่ API รู้จัก `createdAt`/`expireDate` — แปลงสองทางที่นี่ที่เดียว */
const COLUMN_TO_API: Record<string, string> = { bookingNumber: 'createdAt', expireDate: 'expireDate' };
const API_TO_COLUMN: Record<string, string> = { createdAt: 'bookingNumber', expireDate: 'expireDate' };
export const toApiSort = (s: TableSort | null): TableSort | null => (s ? { ...s, key: COLUMN_TO_API[s.key] ?? s.key } : null);
export const toColumnSort = (s: TableSort | null): TableSort | null => (s ? { ...s, key: API_TO_COLUMN[s.key] ?? s.key } : null);

export default function BookingTable({
  rows, total, page, onPageChange, sort, onSortChange, isLoading, nowMs, actions, hasActiveFilters, onClearFilters,
}: {
  rows: Booking[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  isLoading: boolean;
  nowMs: number;
  actions: BookingRowActions;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  const isMobile = useIsMobile();
  if (isMobile) return <BookingCardList rows={rows} nowMs={nowMs} onOpen={actions.onOpen} />;
  return (
    <DataTable<Booking>
      columns={bookingColumns(nowMs, actions)}
      data={rows}
      isLoading={isLoading}
      density="dense"
      minWidth="1120px"
      sort={toColumnSort(sort)}
      onSortChange={(next) => onSortChange(toApiSort(next))}
      onRowClick={actions.onOpen}
      emptyIcon={CalendarDays}
      emptyMessage={hasActiveFilters ? 'ไม่พบใบจองตามตัวกรอง' : 'ยังไม่มีใบจองที่เปิดอยู่'}
      emptyDescription={hasActiveFilters ? 'ลองล้างตัวกรองหรือค้นด้วยเลขที่/ชื่อ/เบอร์โทร' : 'ใบที่ปิดแล้วดูได้จากการ์ด “ปิดแล้ว”'}
      emptyActionLabel={hasActiveFilters ? 'ล้างตัวกรอง' : undefined}
      onEmptyAction={hasActiveFilters ? onClearFilters : undefined}
      pagination={{ page, totalPages: Math.max(1, Math.ceil(total / BOOKING_PAGE_LIMIT)), total, onPageChange }}
    />
  );
}
```

ตรวจ `DataTable` ว่า `useIsMobile` คืน boolean (ไฟล์ `apps/web/src/hooks/useIsMobile.ts`) และ `DataTable` เป็น default export (`export default DataTable` ท้ายไฟล์ — ถ้าเป็น named export ให้ import แบบ `{ DataTable }`)

`BookingCardList.tsx`:

```tsx
import { Badge, BadgeDot } from '@/components/ui/badge';
import type { Booking } from '../types';
import { fmtMoneyShort, isOpenStatus, STATUS_LABEL, STATUS_VARIANT } from '../utils';
import { ExpiryCell } from './bookingColumns';

/** จอ < md: การ์ดแทนตาราง 9 คอลัมน์ (mockup 2B) */
export function BookingCardList({ rows, nowMs, onOpen }: { rows: Booking[]; nowMs: number; onOpen: (b: Booking) => void }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">ไม่พบใบจอง</p>;
  return (
    <ul className="flex flex-col gap-2.5 p-3">
      {rows.map((b) => {
        const item = b.items[0];
        const balance = Number(b.totalAmount) - Number(b.depositAmount);
        return (
          <li key={b.id}>
            <button type="button" onClick={() => onOpen(b)} aria-label={`เปิดใบจอง ${b.bookingNumber}`}
              className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left shadow-card">
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{b.bookingNumber}</span>
                <Badge variant={STATUS_VARIANT[b.status]} className="gap-1.5"><BadgeDot />{STATUS_LABEL[b.status]}</Badge>
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold leading-snug">{b.customer.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{b.customer.phone ?? ''}</span>
              </span>
              <span className="truncate text-sm leading-snug">{item?.description ?? '—'}</span>
              <span className="flex items-center justify-between gap-2 text-sm tabular-nums">
                <span><span className="text-muted-foreground">มัดจำ </span><span className="font-medium">{fmtMoneyShort(b.depositAmount)}</span>
                  {isOpenStatus(b.status) && <><span className="text-muted-foreground"> · คงเหลือ </span><span className="font-medium">{fmtMoneyShort(balance)}</span></>}</span>
                <ExpiryCell booking={b} nowMs={nowMs} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: รันเทส + typecheck**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingTable.test.tsx`
Expected: PASS 7 เทส — `useIsMobile` เรียก `window.matchMedia` ซึ่ง jsdom ไม่มี ⇒ ใส่ `vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }))` ไว้บนสุดของไฟล์เทสนี้ (เทสการ์ดเรียก `BookingCardList` ตรง ไม่ผ่าน hook) · เกณฑ์จอเล็กของ hook = กว้าง < 1024 px
Run: `./tools/check-types.sh web` → 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): ตาราง DataTable 9 คอลัมน์ 1,120 px + เมนู ⋯ + การ์ดจอโทรศัพท์"
```

---

### Task 10: Web — `CustomerCombobox` + `CreateBookingDialog` (ฟอร์ม 2A)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/components/CustomerCombobox.tsx`
- Create: `apps/web/src/pages/BookingsPage/components/CreateBookingDialog.tsx`
- Test: `apps/web/src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx`

**Interfaces:**
- Consumes: `Popover*` (`@/components/ui/popover`) · `Command*` (`@/components/ui/command` — ส่ง `shouldFilter={false}` ได้ เพราะ wrapper spread props) · `CustomerCreateDialog` (default) + `splitDisplayName` + `type CreatedCustomer` จาก `@/components/customer/CustomerCreateDialog` (props: `open onOpenChange initialValues onCreated`) · `BookingProductPicker` (default) จาก `@/components/bookings/BookingProductPicker` — `onSelect({ productId, description, quantity, unitPrice })`, `onClear()`, `branchId`, `selectedId` · `toBangkokDateString`, `toBangkokExpiryInstant`, `formatThaiDateLong` จาก `@/lib/date` · `Dialog*`, `Input`, `Label`, `Textarea`, `Select*`, `Button`
- Produces:
  ```ts
  export default function CustomerCombobox(props: { value: CustomerOption | null; onChange: (c: CustomerOption | null) => void; disabled?: boolean; canCreate: boolean }): JSX.Element;
  export interface CreateBookingDialogProps { open: boolean; onClose: () => void; onSaved: (booking: Booking, opts: { collectDeposit: boolean }) => void; initialBooking?: Booking; initialCustomer?: CustomerOption | null }
  export default function CreateBookingDialog(props: CreateBookingDialogProps): JSX.Element;
  ```
  payload `POST /bookings` = `{ customerId, branchId, expireDate: toBangkokExpiryInstant(YYYY-MM-DD), depositAmount, notes?, items: [{ productId, description, quantity: 1, unitPrice }] }` · แก้ใบ PAID → `PATCH { notes, expireDate }` เท่านั้น · แก้ใบ PENDING → PATCH ครบชุด · วันหมดอายุเดิมที่ไม่ได้แก้ส่งค่า ISO เดิมกลับไป (ไม่ปัดเป็นสิ้นวัน)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

```tsx
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { toBangkokDateString, toBangkokExpiryInstant } from '@/lib/date';
import CreateBookingDialog from '../components/CreateBookingDialog';
import type { Booking } from '../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), role: 'SALES' as string, customersFail: false }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch }, getErrorMessage: (e: Error) => e.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }) }));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({
  default: ({ open, onCreated }: { open: boolean; onCreated: (c: { id: string; name: string; phone?: string }) => void }) =>
    open ? <button type="button" onClick={() => onCreated({ id: 'c-new', name: 'ลูกค้าใหม่', phone: '0899999999' })}>สร้างลูกค้าใหม่ (จำลอง)</button> : null,
  splitDisplayName: (s: string) => ({ firstName: s }),
}));

const customer = { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' };
const product = { id: 'p1', name: 'iPhone 16 Pro 256GB', imeiSerial: '354912070045218', branchId: 'br-1', status: 'IN_STOCK', cashPrice: '42900', installmentPrice: '45900', prices: [] };
const paidBooking: Booking = { id: 'bk-1', bookingNumber: 'BK-20261005-0002', status: 'PAID', depositAmount: '5000', totalAmount: '42900',
  expireDate: '2026-10-11T17:00:00.000Z', depositPaidAt: '2026-10-05T03:55:00Z', notes: 'เดิม', createdAt: '2026-10-05T03:42:00Z',
  customer, branch: { id: 'br-1', name: 'ลาดพร้าว' }, createdBy: { id: 'u1', name: 'น้ำ' },
  items: [{ id: 'i1', productId: 'p1', description: 'iPhone 16 Pro 256GB · 354912070045218', quantity: 1, unitPrice: '42900', amount: '42900' }] };

function renderDialog(props: Partial<React.ComponentProps<typeof CreateBookingDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(<MemoryRouter><QueryClientProvider client={client}>
    <CreateBookingDialog open onClose={onClose} onSaved={onSaved} {...props} />
  </QueryClientProvider></MemoryRouter>);
  return { onSaved, onClose };
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'SALES'; mocks.customersFail = false;
  mocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/customers')) { if (mocks.customersFail) throw new Error('ค้นหาล้ม'); return { data: { data: [customer] } }; }
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'ลาดพร้าว' }] };
    if (path === '/products') return { data: { data: [product] } };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: { ...paidBooking, id: 'bk-new', status: 'PENDING_DEPOSIT' } });
  mocks.patch.mockResolvedValue({ data: paidBooking });
});

describe('CreateBookingDialog', () => {
  it('ต้องมีลูกค้า + เครื่อง ก่อนปุ่มบันทึกจะเปิด · ส่ง 1 เครื่อง quantity 1 · วันหมดอายุ = สิ้นวันไทยของชิป 7 วัน', async () => {
    const { onSaved } = renderDialog({ initialCustomer: customer });
    const save = screen.getByRole('button', { name: 'บันทึกใบจอง' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
    await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
    expect(screen.getAllByText('42,900').length).toBeGreaterThan(0);   // ราคาเงินสดจากเครื่อง (การ์ด + แถบสรุป)
    await userEvent.click(screen.getByRole('button', { name: /20%/ })); // มัดจำ 20% = 8,580
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [, body] = mocks.post.mock.calls[0];
    expect(body.items).toEqual([{ productId: 'p1', description: expect.stringContaining('iPhone 16 Pro'), quantity: 1, unitPrice: 42900 }]);
    expect(body.depositAmount).toBe(8580);
    expect(body.customerId).toBe('c1');
    expect(body.expireDate).toBe(toBangkokExpiryInstant(toBangkokDateString(new Date(Date.now() + 7 * 86_400_000))));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-new' }), { collectDeposit: false });
  });

  it('ชิปวันหมดอายุ 3 วัน เปลี่ยนวันที่ และ "บันทึกและรับมัดจำเลย" ส่ง collectDeposit: true', async () => {
    const { onSaved } = renderDialog({ initialCustomer: customer });
    await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
    await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
    await userEvent.click(screen.getByRole('button', { name: 'เต็มจำนวน' }));
    await userEvent.click(screen.getByRole('button', { name: '3 วัน' }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและรับมัดจำเลย' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.anything(), { collectDeposit: true }));
    const body = mocks.post.mock.calls[0][1];
    expect(body.depositAmount).toBe(42900);
    expect(body.expireDate).toBe(toBangkokExpiryInstant(toBangkokDateString(new Date(Date.now() + 3 * 86_400_000))));
  });

  it('มัดจำ 0 หรือเกินยอดรวม → บันทึกไม่ได้ และบอกเหตุผล', async () => {
    renderDialog({ initialCustomer: customer });
    await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
    await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
    const deposit = screen.getByLabelText('เงินมัดจำที่จะรับ (บาท)');
    await userEvent.clear(deposit); await userEvent.type(deposit, '0');
    expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeDisabled();
    expect(screen.getByText(/มัดจำต้องมากกว่า 0/)).toBeInTheDocument();
    await userEvent.clear(deposit); await userEvent.type(deposit, '50000');
    expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeDisabled();
  });

  it('เลือกลูกค้าจากช่องค้นหาช่องเดียว และสร้างลูกค้าใหม่ได้โดยไม่ออกจากฟอร์ม', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
    await userEvent.type(screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร'), 'สม');
    await userEvent.click(await screen.findByText('สมชาย ใจดี'));
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('สมชาย ใจดี');
    await userEvent.click(screen.getByRole('button', { name: 'ล้างลูกค้า' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
    await userEvent.click(await screen.findByRole('button', { name: /สร้างลูกค้าใหม่/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'สร้างลูกค้าใหม่ (จำลอง)' }));
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('ลูกค้าใหม่');
  });

  it('ลูกค้าที่เลือกไว้ยังอยู่เมื่อการค้นหาครั้งต่อไปล้ม', async () => {
    renderDialog({ initialCustomer: customer });
    mocks.customersFail = true;
    await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
    await userEvent.type(screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร'), 'x');
    expect(await screen.findByText(/โหลดลูกค้าไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('สมชาย ใจดี');
  });

  it('แก้ใบที่มัดจำแล้ว: แก้ได้เฉพาะหมายเหตุ/วันหมดอายุ · ล้างหมายเหตุได้ · ไม่ส่งเงิน/เครื่อง · คงเวลาหมดอายุเดิม', async () => {
    const { onSaved } = renderDialog({ initialBooking: paidBooking });
    expect(screen.getByRole('heading', { name: 'แก้หมายเหตุ / วันหมดอายุ' })).toBeInTheDocument();
    expect(screen.queryByLabelText('เงินมัดจำที่จะรับ (บาท)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกและรับมัดจำเลย' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('หมายเหตุ'));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/bookings/bk-1', { notes: '', expireDate: '2026-10-11T17:00:00.000Z' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-1' }), { collectDeposit: false });
  });

  it('แก้ใบที่ยังไม่รับมัดจำ: เปลี่ยนมัดจำแต่ไม่แตะวัน → ส่งเวลาหมดอายุเดิมตรงตัว (ไม่ปัดเป็นสิ้นวัน)', async () => {
    renderDialog({ initialBooking: { ...paidBooking, status: 'PENDING_DEPOSIT', depositPaidAt: null, expireDate: '2026-10-11T10:30:00.000Z' } });
    const deposit = screen.getByLabelText('เงินมัดจำที่จะรับ (บาท)');
    await userEvent.clear(deposit); await userEvent.type(deposit, '6000');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/bookings/bk-1', expect.objectContaining({ depositAmount: 6000, expireDate: '2026-10-11T10:30:00.000Z',
      items: [{ productId: 'p1', description: expect.any(String), quantity: 1, unitPrice: 42900 }] })));
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: สร้าง `CustomerCombobox.tsx`**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Plus, X } from 'lucide-react';
import CustomerCreateDialog, { splitDisplayName, type CreatedCustomer } from '@/components/customer/CustomerCreateDialog';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import type { CustomerOption } from '../types';

/**
 * ค้นหา + เลือกลูกค้าในช่องเดียว (เดิมเป็น Input ค้นหา + Select แยกกัน) · ไม่ส่ง `view` ให้ /customers
 * เพราะใบจองต้องเลือกได้ทั้งลูกค้าและผู้สนใจ (ด่านเบอร์อยู่ฝั่ง API) · ลูกค้าที่เลือกไว้คงอยู่แม้การค้นหาครั้งถัดไปล้ม
 */
export default function CustomerCombobox({
  value, onChange, disabled, canCreate,
}: {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  disabled?: boolean;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const term = useDebounce(search.trim());
  const { data: options = [], isFetching, isError, refetch } = useQuery<CustomerOption[]>({
    queryKey: ['booking-customer-search', term],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get(`/customers?${new URLSearchParams({ limit: '20', search: term })}`);
      return (data.data ?? data ?? []) as CustomerOption[];
    },
  });

  const describe = (c: CustomerOption) =>
    c.chatPlaceholder ? 'จากแชท · ยังไม่มีเบอร์' : c.phone ? c.phone : '';

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="ลูกค้า" disabled={disabled}
            className="h-10 w-full justify-between font-normal">
            {value ? (
              <span className="truncate"><span className="font-medium">{value.name}</span>{describe(value) && <span className="text-muted-foreground"> · {describe(value)}</span>}</span>
            ) : (
              <span className="text-muted-foreground">ค้นหาชื่อหรือเบอร์โทรลูกค้า…</span>
            )}
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="พิมพ์ชื่อหรือเบอร์โทร" value={search} onValueChange={setSearch} />
            <CommandList>
              {isError && (
                <div className="p-3 text-sm">
                  <button type="button" className="text-destructive underline" onClick={() => refetch()}>โหลดลูกค้าไม่สำเร็จ ลองอีกครั้ง</button>
                </div>
              )}
              {isFetching && <p className="p-3 text-xs text-muted-foreground">กำลังค้นหาลูกค้า...</p>}
              {!isFetching && !isError && <CommandEmpty>ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น</CommandEmpty>}
              <CommandGroup>
                {options.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => { onChange(c); setOpen(false); }}>
                    <span className="flex min-w-0 flex-col leading-snug">
                      <span className="truncate font-medium">{c.name}</span>
                      {describe(c) && <span className="text-xs text-muted-foreground">{describe(c)}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {canCreate && (
                <div className="border-t border-border p-1">
                  <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setOpen(false); setCreateOpen(true); }}>
                    <Plus className="size-3.5" /> สร้างลูกค้าใหม่{search.trim() ? ` “${search.trim()}”` : ''}
                  </Button>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" aria-label="ล้างลูกค้า" onClick={() => onChange(null)}><X className="size-4" /></Button>
      )}
      <CustomerCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialValues={search.trim() ? splitDisplayName(search.trim()) : undefined}
        onCreated={(created: CreatedCustomer) => { onChange({ id: created.id, name: created.name, phone: created.phone ?? null }); setCreateOpen(false); }}
      />
    </div>
  );
}
```

- [ ] **Step 4: สร้าง `CreateBookingDialog.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, CalendarDays, ShieldCheck, Smartphone } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatThaiDateLong, toBangkokDateString, toBangkokExpiryInstant } from '@/lib/date';
import { cn } from '@/lib/utils';
import BookingProductPicker from '@/components/bookings/BookingProductPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Booking, BranchOption, CustomerOption } from '../types';
import { fmtMoneyShort, isDepositInRange } from '../utils';
import CustomerCombobox from './CustomerCombobox';

export interface CreateBookingDialogProps {
  open: boolean;
  onClose: () => void;
  /** บันทึกสำเร็จ · `collectDeposit` = ผู้ใช้กด "บันทึกและรับมัดจำเลย" (หน้าเปิดแผงรับเงินต่อ) */
  onSaved: (booking: Booking, opts: { collectDeposit: boolean }) => void;
  initialBooking?: Booking;
  initialCustomer?: CustomerOption | null;
}

interface SelectedProduct { productId: string; description: string; unitPrice: number }

const EXPIRY_PRESETS = [3, 7, 14] as const;
const DEPOSIT_PRESETS = [10, 20, 50] as const;
const plusDays = (days: number) => toBangkokDateString(new Date(Date.now() + days * 86_400_000));
/** วันไทยของเวลาหมดอายุเดิม (เก็บเป็นสิ้นวัน −1 ms ไว้ตรงตัว จึงถอย 1 ms ก่อนแปลง) */
const originalExpiryDateOnly = (b: Booking) => toBangkokDateString(new Date(new Date(b.expireDate).getTime() - 1));
const chipClass = (active: boolean) => cn(
  'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] leading-snug transition-colors',
  active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-muted',
);

function Step({ n, title, right, children }: { n: number; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2.5 text-sm font-semibold leading-snug">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{n}</span>{title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function CreateBookingDialog({ open, onClose, onSaved, initialBooking, initialCustomer }: CreateBookingDialogProps) {
  const { user } = useAuth();
  const paidEdit = initialBooking?.status === 'PAID';
  const canCreateCustomer = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const initialItem = initialBooking?.items[0];

  const [customer, setCustomer] = useState<CustomerOption | null>(initialBooking?.customer ?? initialCustomer ?? null);
  const [branchId, setBranchId] = useState(initialBooking?.branch.id ?? user?.branchId ?? '');
  const [product, setProduct] = useState<SelectedProduct | null>(
    initialItem?.productId ? { productId: initialItem.productId, description: initialItem.description, unitPrice: Number(initialItem.unitPrice) } : null,
  );
  const [agreedPrice, setAgreedPrice] = useState(initialItem ? Number(initialItem.unitPrice) : 0);
  const [deposit, setDeposit] = useState(Number(initialBooking?.depositAmount ?? 0));
  const [expireDate, setExpireDate] = useState(() => (initialBooking ? originalExpiryDateOnly(initialBooking) : plusDays(7)));
  const [customDate, setCustomDate] = useState(false);
  const [notes, setNotes] = useState(initialBooking?.notes ?? '');

  const { data: branches } = useQuery<BranchOption[]>({
    queryKey: ['booking-branches'],
    enabled: open,
    queryFn: async () => { const { data } = await api.get('/branches'); return (data.data ?? data ?? []) as BranchOption[]; },
  });

  const total = product ? agreedPrice : 0;
  const balance = Math.max(0, total - deposit);
  const depositValid = isDepositInRange(deposit, total);
  const isValid = paidEdit ? !!expireDate : !!customer && !!branchId && !!product && agreedPrice >= 0 && depositValid && !!expireDate;

  const save = useMutation({
    mutationFn: async (): Promise<Booking> => {
      const keepOriginal = !!initialBooking && expireDate === originalExpiryDateOnly(initialBooking);
      const expire = keepOriginal ? initialBooking!.expireDate : toBangkokExpiryInstant(expireDate);
      const items = product ? [{ productId: product.productId, description: product.description, quantity: 1, unitPrice: agreedPrice }] : [];
      if (initialBooking) {
        const body = paidEdit
          ? { notes, expireDate: expire }
          : { customerId: customer!.id, branchId, expireDate: expire, depositAmount: deposit, notes, items };
        return (await api.patch(`/bookings/${initialBooking.id}`, body)).data as Booking;
      }
      return (await api.post('/bookings', { customerId: customer!.id, branchId, expireDate: expire, depositAmount: deposit, notes: notes || undefined, items })).data as Booking;
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const submit = (collectDeposit: boolean) =>
    save.mutate(undefined, { onSuccess: (booking) => { toast.success(initialBooking ? 'แก้ไขใบจองแล้ว' : 'สร้างใบจองแล้ว'); onSaved(booking, { collectDeposit }); } });

  const pickProduct = (sel: { productId: string; description: string; unitPrice: number }) => { setProduct(sel); setAgreedPrice(sel.unitPrice); };
  const title = initialBooking ? (paidEdit ? 'แก้หมายเหตุ / วันหมดอายุ' : 'แก้ไขใบจอง') : 'สร้างใบจอง';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-snug">
            {paidEdit ? 'รับมัดจำแล้ว แก้ได้เฉพาะหมายเหตุและวันหมดอายุ สถานะรับมัดจำและยอดเงินคงเดิม'
              : 'ระบุลูกค้า เครื่อง มัดจำ และวันหมดอายุ — ยังไม่บันทึกการรับเงิน จนกว่าจะกดรับมัดจำ'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Step n={1} title="ลูกค้าและสาขา">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>ลูกค้า</Label>
                <CustomerCombobox value={customer} onChange={setCustomer} disabled={paidEdit} canCreate={canCreateCustomer && !paidEdit} />
                <p className="text-xs leading-snug text-muted-foreground">พิมพ์ชื่อหรือเบอร์เพื่อค้นหา · ไม่พบ กดสร้างลูกค้าใหม่ได้ในช่องเดียวกัน</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="booking-branch">สาขา</Label>
                <Select value={branchId} onValueChange={(v) => { setBranchId(v); setProduct(null); }} disabled={paidEdit || user?.role !== 'OWNER'}>
                  <SelectTrigger id="booking-branch"><SelectValue placeholder="เลือกสาขา" /></SelectTrigger>
                  <SelectContent>{(branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs leading-snug text-muted-foreground">ตามสาขาของผู้ใช้ · เจ้าของเลือกสาขาอื่นได้</p>
              </div>
            </div>
          </Step>

          <Step n={2} title="เครื่องที่จอง" right={<span className="text-xs text-muted-foreground">เลือกได้เฉพาะเครื่องที่อยู่ในสต็อกและพร้อมขาย</span>}>
            {product ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Smartphone className="size-5" /></span>
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="truncate font-semibold">{product.description}</div>
                  <div className="text-xs text-primary">พร้อมขาย · ผูกเครื่องในสต็อกแล้ว</div>
                </div>
                <div className="text-right leading-snug">
                  <div className="text-[11px] text-muted-foreground">ราคาเงินสด</div>
                  <div className="font-semibold tabular-nums">{fmtMoneyShort(product.unitPrice)}</div>
                </div>
                {!paidEdit && <Button type="button" variant="outline" size="sm" onClick={() => setProduct(null)}>เปลี่ยนเครื่อง</Button>}
              </div>
            ) : (
              <BookingProductPicker branchId={branchId} onSelect={pickProduct} onClear={() => setProduct(null)} />
            )}
            {product && !paidEdit && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="booking-price">ราคาตกลง (บาท)</Label>
                  <Input id="booking-price" type="number" min={0} step="0.01" value={agreedPrice} onChange={(e) => setAgreedPrice(Number(e.target.value) || 0)} className="text-right tabular-nums" />
                </div>
              </div>
            )}
            <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
              เครื่องจะถูกล็อกไว้ให้ลูกค้าทันทีที่รับมัดจำ (POS ขายไม่ได้จนกว่าจะยกเลิกหรือหมดอายุ) · ก่อนรับมัดจำยังขายได้ตามปกติ
            </p>
          </Step>

          <Step n={3} title="มัดจำและวันหมดอายุ">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="booking-deposit">{paidEdit ? 'มัดจำที่รับแล้ว (บาท)' : 'เงินมัดจำที่จะรับ (บาท)'}</Label>
                <Input id="booking-deposit" type="number" min={0} step="0.01" value={deposit} readOnly={paidEdit}
                  onChange={(e) => setDeposit(Number(e.target.value) || 0)} aria-invalid={!paidEdit && total > 0 && !depositValid}
                  className="h-10 text-right text-base font-medium tabular-nums" />
                {!paidEdit && (
                  <div className="flex flex-wrap gap-1.5">
                    {DEPOSIT_PRESETS.map((pct) => {
                      const amount = Math.round((total * pct) / 100);
                      return <button key={pct} type="button" disabled={!total} className={chipClass(!!total && deposit === amount)} onClick={() => setDeposit(amount)}>{pct}% · {fmtMoneyShort(amount)}</button>;
                    })}
                    <button type="button" disabled={!total} className={chipClass(!!total && deposit === total)} onClick={() => setDeposit(total)}>เต็มจำนวน</button>
                  </div>
                )}
                {!paidEdit && total > 0 && !depositValid && (
                  <p className="text-xs leading-snug text-destructive">มัดจำต้องมากกว่า 0 และไม่เกินยอดรวม ({fmtMoneyShort(total)})</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>ใช้ได้ถึง</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_PRESETS.map((days) => (
                    <button key={days} type="button" className={chipClass(!customDate && expireDate === plusDays(days))} onClick={() => { setCustomDate(false); setExpireDate(plusDays(days)); }}>{days} วัน</button>
                  ))}
                  <button type="button" className={chipClass(customDate)} onClick={() => setCustomDate(true)}>เลือกวันที่…</button>
                </div>
                {customDate && <Input type="date" aria-label="วันหมดอายุ" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} />}
                <p className="flex items-center gap-1.5 text-sm leading-snug"><CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />สิ้นวัน{formatThaiDateLong(`${expireDate}T12:00:00+07:00`)} (เวลาไทย)</p>
                <p className="text-xs leading-snug text-muted-foreground">เลยกำหนดแล้วมัดจำที่รับไว้จะถูกริบ — ลูกค้าต้องมารับก่อนวันนี้</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted px-4 py-3">
              <div><div className="text-xs text-muted-foreground">ยอดรวม</div><div className="font-medium tabular-nums">{fmtMoneyShort(total)}</div></div>
              <div><div className="text-xs text-muted-foreground">{paidEdit ? 'มัดจำรับแล้ว' : 'มัดจำที่จะรับ'}</div><div className="font-medium tabular-nums">{fmtMoneyShort(deposit)}</div></div>
              <div><div className="text-xs text-muted-foreground">คงเหลือตอนรับเครื่อง</div><div className="font-semibold tabular-nums">{fmtMoneyShort(balance)}</div></div>
            </div>
          </Step>

          <Step n={4} title="หมายเหตุ">
            <Textarea id="booking-notes" aria-label="หมายเหตุ" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น ลูกค้าจะมารับวันเสาร์ · ขอสีอื่นถ้ามี (ไม่บังคับ)" />
          </Step>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">ยังไม่บันทึกการรับเงิน จนกว่าจะกดรับมัดจำ</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>ยกเลิก</Button>
            <Button type="button" variant="outline" disabled={!isValid || save.isPending} onClick={() => submit(false)}>
              {save.isPending ? 'กำลังบันทึก...' : initialBooking ? 'บันทึกการแก้ไข' : 'บันทึกใบจอง'}
            </Button>
            {!paidEdit && (
              <Button type="button" disabled={!isValid || save.isPending} onClick={() => submit(true)}>
                <Banknote className="size-4" /> บันทึกและรับมัดจำเลย
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

หมายเหตุให้ผู้ทำ: `BookingProductPicker` แสดงปุ่มผลลัพธ์เป็น `<button>` ที่มีชื่อเครื่องเป็นข้อความ (เทส `findByRole('button', { name: /iPhone 16 Pro 256GB/ })` อาศัยข้อนี้) และช่องค้นหามี `aria-label="ค้นหาเครื่องในสาขา"` (ตรวจแล้ว 2026-10-05)

- [ ] **Step 5: รันเทส + typecheck**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/CreateBookingDialog.test.tsx`
Expected: PASS 7 เทส
Run: `./tools/check-types.sh web` → 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): ฟอร์มสร้างใบจอง 4 ขั้น — combobox ลูกค้า · เครื่องในสต็อกเท่านั้น · ชิป %/วัน · บันทึกและรับมัดจำเลย"
```

---

### Task 11: Web — `BookingTimeline` · `CancelBookingDialog` · `BookingDetailSheet` (แผง 3A/3B/4A/4B)

**Files:**
- Create: `apps/web/src/pages/BookingsPage/hooks/useBookingClock.ts`
- Create: `apps/web/src/pages/BookingsPage/components/BookingTimeline.tsx`
- Create: `apps/web/src/pages/BookingsPage/components/CancelBookingDialog.tsx`
- Create: `apps/web/src/pages/BookingsPage/components/BookingDetailSheet.tsx`
- Test: `apps/web/src/pages/BookingsPage/__tests__/BookingDetailSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription` (`@/components/ui/sheet`) · `ConfirmDialog` (named, `@/components/ui/ConfirmDialog` — props `open onOpenChange title description confirmLabel variant loading confirmDisabled closeOnConfirm onConfirm children`) · `DropdownMenu*` · `TenderInput, useTenders` (`@/components/tender/TenderInput`) + `TenderRow` (`@/components/tender/tender-utils`) · `Checkbox` · `invalidateSalesQueries` · `useCopyToClipboard`? **ไม่ใช้** — คัดลอกเบอร์ด้วย `navigator.clipboard.writeText` ใน try/catch + toast · `CreateBookingDialog` (Task 10) · utils/types
- Produces:
  ```ts
  export function useBookingClock(intervalMs = 30_000): number;        // hooks/useBookingClock.ts
  export function describeEvent(e: BookingEvent): { title: string; tone: 'muted' | 'success' | 'primary' | 'destructive' };
  export default function BookingTimeline({ events }: { events: BookingEvent[] }): JSX.Element;
  export default function CancelBookingDialog(props: { booking: Pick<Booking, 'id' | 'bookingNumber' | 'status' | 'depositAmount' | 'depositMethod'> | null; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (reason: string) => void; loading?: boolean }): JSX.Element;
  export interface BookingDetailSheetProps { bookingId: string; canMutate: boolean; canDelete: boolean; canAcknowledgeDamage: boolean; autoCollectDeposit?: boolean; onClose: () => void; onChanged: () => void }
  export default function BookingDetailSheet(props: BookingDetailSheetProps): JSX.Element;
  ```
  payload เดิมของ API: `POST /bookings/:id/pay-deposit { depositMethod, tenders }` · `POST /bookings/:id/convert { saleType: 'CASH', collectBalance?, paymentMethod?, tenders?, previouslyDamagedAcknowledged? }` → response `{ sale: { id }, bookingId }` · `POST /bookings/:id/cancel { cancelReason }` · `DELETE /bookings/:id` · ขายสำเร็จ → `navigate('/sales?saleId=<sale.id>')`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

```tsx
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BookingDetailSheet from '../components/BookingDetailSheet';
import { describeEvent } from '../components/BookingTimeline';
import type { Booking } from '../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), booking: {} as Record<string, unknown>, detailError: false, role: 'SALES' as string }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete }, getErrorMessage: (e: Error) => e.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }) }));

function LocationProbe() { const loc = useLocation(); return <output data-testid="loc">{loc.pathname + loc.search}</output>; }
function renderSheet(props: Partial<React.ComponentProps<typeof BookingDetailSheet>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn(); const onChanged = vi.fn();
  render(<MemoryRouter initialEntries={['/bookings?bookingId=bk-1']}><QueryClientProvider client={client}>
    <Routes><Route path="*" element={<><LocationProbe /><BookingDetailSheet bookingId="bk-1" canMutate canDelete={false} canAcknowledgeDamage={false} onClose={onClose} onChanged={onChanged} {...props} /></>} /></Routes>
  </QueryClientProvider></MemoryRouter>);
  return { onClose, onChanged };
}
const dialog = async () => screen.findByRole('dialog');
const convertBtn = () => screen.getByRole('button', { name: /รับส่วนต่าง .* และออกใบขาย|ออกใบขายโดยใช้มัดจำ/ });

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.detailError = false; mocks.role = 'SALES';
  mocks.booking = { id: 'bk-1', bookingNumber: 'BK-20261005-0002', status: 'PAID', depositAmount: '1000', totalAmount: '10000',
    expireDate: '2099-09-11T17:00:00.000Z', depositPaidAt: '2026-10-05T03:55:00Z', depositMethod: 'CASH', createdAt: '2026-10-05T03:42:00Z',
    customer: { id: 'c1', name: 'ลูกค้าตัวอย่าง', phone: '0800000000' },
    branch: { id: 'br-1', name: 'สาขาตัวอย่าง', shopCashAccountCode: 'S11-1101' },
    createdBy: { id: 'u1', name: 'พนักงานตัวอย่าง' },
    items: [{ id: 'i1', productId: 'p1', description: 'เครื่องตัวอย่าง', quantity: 1, unitPrice: '10000', amount: '10000',
      product: { id: 'p1', name: 'เครื่องตัวอย่าง', status: 'IN_STOCK', branchId: 'br-1', imeiSerial: 'SYNTHETIC-IMEI' } }],
    events: [
      { id: 'e1', kind: 'BOOKING_CREATED', at: '2026-10-05T03:42:00Z', actor: { id: 'u1', name: 'พนักงานตัวอย่าง' }, data: {} },
      { id: 'e2', kind: 'BOOKING_DEPOSIT_PAID', at: '2026-10-05T03:55:00Z', actor: { id: 'u1', name: 'พนักงานตัวอย่าง' }, data: { depositMethod: 'CASH' } },
    ] };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/bookings/bk-1') { if (mocks.detailError) throw new Error('Synthetic offline'); return { data: mocks.booking }; }
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'สาขาตัวอย่าง' }] };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: { sale: { id: 'sale-1' }, bookingId: 'bk-1' } });
  mocks.delete.mockResolvedValue({ data: { id: 'bk-1' } });
});

describe('BookingDetailSheet', () => {
  it('มัดจำบางส่วน: ต้องเลือกวิธี+เลขอ้างอิง+ติ๊กยืนยัน แล้วส่ง convert พร้อม tender · สำเร็จแล้วพาไปใบขาย', async () => {
    await dialog();
    expect(convertBtn()).toBeDisabled();
    expect(screen.getByText(/คงเหลือที่ต้องรับวันนี้/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงิน'), 'BANK_TRANSFER');
    await userEvent.click(screen.getByRole('checkbox', { name: /ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว/ }));
    expect(convertBtn()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เลขอ้างอิงการโอน/), 'SYNTHETIC-REF');
    await userEvent.click(convertBtn());
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/convert', expect.objectContaining({
      collectBalance: true, paymentMethod: 'BANK_TRANSFER', saleType: 'CASH',
      tenders: [{ method: 'BANK_TRANSFER', amount: 9000, reference: 'SYNTHETIC-REF' }],
    })));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/sales?saleId=sale-1'));
  });

  it('มัดจำเต็มจำนวน: ไม่ขอรับส่วนต่าง ปุ่ม "ออกใบขายโดยใช้มัดจำ" ส่ง collectBalance/paymentMethod เป็น undefined', async () => {
    mocks.booking.depositAmount = '10000'; await dialog();
    expect(screen.queryByLabelText('วิธีรับเงิน')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ออกใบขายโดยใช้มัดจำ' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/convert', expect.objectContaining({ paymentMethod: undefined, collectBalance: undefined })));
  });

  it('รอชำระมัดจำ: ช่องรับเงินบอกบัญชี SHOP ตามวิธี และส่ง pay-deposit พร้อม tender', async () => {
    Object.assign(mocks.booking, { status: 'PENDING_DEPOSIT', depositPaidAt: null, depositMethod: null }); await dialog();
    expect(screen.getByText(/รับเข้าบัญชี SHOP/)).toHaveTextContent('S11-1101');
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงิน'), 'BANK_TRANSFER');
    expect(screen.getByText(/รับเข้าบัญชี SHOP/)).toHaveTextContent('S11-1201');
    const pay = screen.getByRole('button', { name: /บันทึกรับมัดจำ/ });
    expect(pay).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เลขอ้างอิงการโอน/), 'SYNTHETIC-REF');
    await userEvent.click(pay);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/pay-deposit', {
      depositMethod: 'BANK_TRANSFER', tenders: [{ method: 'BANK_TRANSFER', amount: 1000, reference: 'SYNTHETIC-REF' }],
    }));
  });

  it('ยกเลิกจากเมนู ⋯ ต้องผ่านกล่องยืนยัน + เหตุผล ≥ 3 ตัวอักษร แล้วส่ง cancel', async () => {
    const { onChanged } = renderSheet(); await dialog();
    await userEvent.click(screen.getByRole('button', { name: 'การกระทำเพิ่มเติม' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /ยกเลิกใบจอง/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('คืนมัดจำ 1,000');
    const yes = within(confirm).getByRole('button', { name: /ยืนยันยกเลิกและคืนมัดจำ 1,000/ });
    expect(yes).toBeDisabled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'ลูกค้าเปลี่ยนใจ' }));
    expect(yes).toBeEnabled();
    await userEvent.click(yes);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/cancel', { cancelReason: 'ลูกค้าเปลี่ยนใจ' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('ใบเดิมที่มีหลายรายการ: บอกว่าแปลงขายไม่ได้ และปุ่มหลักปิด', async () => {
    mocks.booking.items = [{ id: 'i1', description: 'รายการเดิม', quantity: 2, productId: 'p1', unitPrice: 5000, amount: 10000 }];
    await dialog();
    expect(screen.getByRole('alert')).toHaveTextContent('1 รายการ จำนวน 1 ชิ้น');
    expect(convertBtn()).toBeDisabled();
  });

  it('เลยกำหนดแต่ cron ยังไม่ปิด: ป้าย "รอระบบปิด" ปุ่มเงินหาย มีปุ่มโหลดสถานะล่าสุด', async () => {
    mocks.booking.expireDate = '2000-01-01T17:00:00.000Z'; await dialog();
    expect(screen.getByRole('status')).toHaveTextContent('รอระบบปิด');
    expect(screen.queryByRole('button', { name: /ออกใบขาย|รับส่วนต่าง/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โหลดสถานะล่าสุด' })).toBeEnabled();
  });

  it('โหลดรายละเอียดล้ม → แจ้งพร้อมปุ่มลองใหม่ ไม่ค้าง "กำลังโหลด"', async () => {
    mocks.detailError = true; renderSheet();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดใบจองไม่สำเร็จ');
    expect(screen.queryByText('กำลังโหลด...')).not.toBeInTheDocument();
    mocks.detailError = false;
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByText('BK-20261005-0002')).toBeInTheDocument();
  });

  it('บทบาทอ่านอย่างเดียว: ไม่มีช่องรับเงิน ไม่มีเมนู ⋯ แต่เห็นไทม์ไลน์และเครื่อง', async () => {
    renderSheet({ canMutate: false }); await dialog();
    expect(screen.queryByLabelText('วิธีรับเงิน')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'การกระทำเพิ่มเติม' })).not.toBeInTheDocument();
    expect(screen.getByText('รับมัดจำ · เงินสด')).toBeInTheDocument();
    expect(screen.getByText(/พร้อมขาย · ยังอยู่ในสต็อก/)).toBeInTheDocument();
  });

  it('ขายแล้ว: แถบบอกเลขใบขาย + ปุ่มเปิดใบขาย และไม่มีเมนู ⋯', async () => {
    Object.assign(mocks.booking, { status: 'CONVERTED', convertedAt: '2026-10-01T07:20:00Z', convertedToSale: { id: 'sale-9', saleNumber: 'SL-20261001-0004' } });
    await dialog();
    await userEvent.click(screen.getByRole('button', { name: /เปิดใบขาย/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/sales?saleId=sale-9');
    expect(screen.queryByRole('button', { name: 'การกระทำเพิ่มเติม' })).not.toBeInTheDocument();
  });
});

describe('describeEvent', () => {
  it('แปลง AuditLog เป็นข้อความไทย', () => {
    expect(describeEvent({ id: '1', kind: 'BOOKING_CANCELED', at: '', actor: null, data: { refundAmount: '5000.00', cancelReason: 'ลูกค้าเปลี่ยนใจ' } }).title).toBe('ยกเลิกใบจอง · คืนมัดจำ 5,000 · ลูกค้าเปลี่ยนใจ');
    expect(describeEvent({ id: '2', kind: 'BOOKING_AUTO_EXPIRED', at: '', actor: null, data: { forfeitAmount: '3000.00' } }).title).toBe('หมดอายุ · ริบมัดจำ 3,000');
    expect(describeEvent({ id: '3', kind: 'BOOKING_UPDATED', at: '', actor: null, data: { changed: ['notes', 'expireDate'] } }).title).toBe('แก้ไข หมายเหตุ · วันหมดอายุ');
  });
});
```

(เทสแรก–สาม และเทส "อ่านอย่างเดียว" ต้องเรียก `renderSheet()` ก่อน `dialog()` — ใส่ `renderSheet();` เป็นบรรทัดแรกของเทสที่ยังไม่ได้เรียก)

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingDetailSheet.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: สร้าง `hooks/useBookingClock.ts` + `BookingTimeline.tsx` + `CancelBookingDialog.tsx`**

`hooks/useBookingClock.ts`:

```ts
import { useEffect, useState } from 'react';

/** เวลาปัจจุบัน (ms) รีเฟรชทุก 30 วิ และตอนกลับมาที่แท็บ — ให้ป้าย "วันนี้/รอระบบปิด" เปลี่ยนเองโดยไม่ต้องโหลดหน้า */
export function useBookingClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, intervalMs);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [intervalMs]);
  return now;
}
```

`components/BookingTimeline.tsx`:

```tsx
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { BookingEvent } from '../types';
import { fmtMoneyShort } from '../utils';

export const METHOD_LABEL: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', QR_EWALLET: 'QR / e-Wallet' };
const FIELD_LABEL: Record<string, string> = { notes: 'หมายเหตุ', expireDate: 'วันหมดอายุ', depositAmount: 'มัดจำ', items: 'เครื่อง', customerId: 'ลูกค้า', branchId: 'สาขา' };
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const money = (v: unknown): number => Number(str(v)) || 0;

export function describeEvent(e: BookingEvent): { title: string; tone: 'muted' | 'success' | 'primary' | 'destructive' } {
  const d = e.data ?? {};
  switch (e.kind) {
    case 'BOOKING_CREATED': return { title: 'สร้างใบจอง', tone: 'muted' };
    case 'BOOKING_UPDATED': {
      const changed = Array.isArray(d.changed) ? (d.changed as string[]).map((k) => FIELD_LABEL[k] ?? k) : [];
      return { title: changed.length ? `แก้ไข ${changed.join(' · ')}` : 'แก้ไขใบจอง', tone: 'muted' };
    }
    case 'BOOKING_DEPOSIT_PAID': {
      const method = METHOD_LABEL[str(d.depositMethod)] ?? str(d.depositMethod);
      return { title: method ? `รับมัดจำ · ${method}` : 'รับมัดจำ', tone: 'success' };
    }
    case 'BOOKING_CANCELED': {
      const parts = ['ยกเลิกใบจอง'];
      if (money(d.refundAmount) > 0) parts.push(`คืนมัดจำ ${fmtMoneyShort(money(d.refundAmount))}`);
      if (str(d.cancelReason)) parts.push(str(d.cancelReason));
      return { title: parts.join(' · '), tone: 'destructive' };
    }
    case 'BOOKING_CONVERTED': return { title: `ออกใบขาย ${str(d.saleNumber)}`.trim(), tone: 'primary' };
    case 'BOOKING_AUTO_EXPIRED': return { title: money(d.forfeitAmount) > 0 ? `หมดอายุ · ริบมัดจำ ${fmtMoneyShort(money(d.forfeitAmount))}` : 'หมดอายุ', tone: 'muted' };
    case 'BOOKING_DELETED': return { title: 'ลบใบจอง', tone: 'destructive' };
    default: return { title: e.kind, tone: 'muted' };
  }
}

const DOT: Record<string, string> = { muted: 'bg-muted-foreground', success: 'bg-success', primary: 'bg-primary', destructive: 'bg-destructive' };

export default function BookingTimeline({ events }: { events: BookingEvent[] }) {
  if (events.length === 0) return <p className="text-xs text-muted-foreground">ยังไม่มีเหตุการณ์</p>;
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const { title, tone } = describeEvent(e);
        const actor = e.kind === 'BOOKING_AUTO_EXPIRED' ? 'ระบบ' : e.actor?.name ?? '—';
        return (
          <li key={e.id} className={cn('flex gap-3', i < events.length - 1 && 'pb-3.5')}>
            <span className="flex w-3.5 flex-col items-center">
              <span className={cn('mt-1.5 size-2.5 rounded-full', DOT[tone])} />
              {i < events.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-border" />}
            </span>
            <span className="text-[13px] leading-snug">
              <span className="font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">{formatThaiDateShort(e.at)} {formatThaiTime(e.at)} · {actor}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

`components/CancelBookingDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Booking } from '../types';
import { fmtMoneyShort } from '../utils';
import { METHOD_LABEL } from './BookingTimeline';

const REASONS = ['ลูกค้าเปลี่ยนใจ', 'ไม่ผ่านเครดิต', 'เครื่องถูกขายไปก่อน', 'เปลี่ยนรุ่น/สี'] as const;
export const CANCEL_REASON_MIN = 3;

/** กล่อง 4B: บอกยอดคืน + ช่องทาง "ตามที่รับมา" + เหตุผลบังคับ (เดิมกดแล้วคืนเงินทันทีไม่มีถาม) */
export default function CancelBookingDialog({
  booking, open, onOpenChange, onConfirm, loading,
}: {
  booking: Pick<Booking, 'id' | 'bookingNumber' | 'status' | 'depositAmount' | 'depositMethod'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open, booking?.id]);
  const refund = booking?.status === 'PAID' ? Number(booking.depositAmount) : 0;
  const method = METHOD_LABEL[booking?.depositMethod ?? ''] ?? 'วิธีที่รับมา';
  const description = refund > 0
    ? `ระบบจะคืนมัดจำ ${fmtMoneyShort(refund)} บาท ให้ลูกค้าเต็มจำนวนตามวิธีที่รับมา (${method}) และบันทึกการคืนเงินในสมุดเงินหน้าร้านของวันนี้ ใบจองนี้จะปิดถาวร ถ้าลูกค้ากลับมาต้องออกใบจองใหม่`
    : 'ใบจองนี้ยังไม่ได้รับมัดจำ จะปิดใบโดยไม่มีการคืนเงิน ถ้าลูกค้ากลับมาต้องออกใบจองใหม่';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`ยกเลิกใบจอง ${booking?.bookingNumber ?? ''}?`}
      description={description}
      variant="destructive"
      confirmLabel={refund > 0 ? `ยืนยันยกเลิกและคืนมัดจำ ${fmtMoneyShort(refund)}` : 'ยืนยันยกเลิกใบจอง'}
      confirmDisabled={reason.trim().length < CANCEL_REASON_MIN}
      loading={loading}
      closeOnConfirm={false}
      onConfirm={() => onConfirm(reason.trim())}
    >
      <div className="space-y-2">
        <Label htmlFor="cancel-reason">เหตุผล (บังคับ)</Label>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={cn('inline-flex h-8 items-center rounded-full border px-3 text-[13px] leading-snug', reason === r ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-muted')}>
              {r}
            </button>
          ))}
        </div>
        <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="อย่างน้อย 3 ตัวอักษร" />
      </div>
    </ConfirmDialog>
  );
}
```

ก่อน commit เปิด `ConfirmDialog.tsx` ยืนยันว่า container เป็น `AlertDialog` (role `alertdialog`) และปุ่มยืนยันใส่ `confirmLabel` เป็นชื่อปุ่ม (เทสจับ `getByRole('alertdialog')`) — ถ้าเป็น `Dialog` ธรรมดา ให้เปลี่ยนเทสเป็น `getByRole('dialog', { name: /ยกเลิกใบจอง/ })`

- [ ] **Step 4: สร้าง `BookingDetailSheet.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Clock, Copy, ExternalLink, HandCoins, MoreHorizontal, Pencil, Phone, ShoppingCart, Smartphone, Trash2, AlertTriangle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import { cn } from '@/lib/utils';
import { Badge, BadgeDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TenderInput, useTenders } from '@/components/tender/TenderInput';
import type { TenderRow } from '@/components/tender/tender-utils';
import { useBookingClock } from '../hooks/useBookingClock';
import type { Booking, BookingItem } from '../types';
import { formatThaiDateShort } from '@/lib/date';
import { awaitingExpiry, describeExpiry, fmtDate, fmtMoney, fmtMoneyShort, isOpenStatus, lastValidMs, STATUS_LABEL, STATUS_VARIANT } from '../utils';
import BookingTimeline, { METHOD_LABEL } from './BookingTimeline';
import CancelBookingDialog from './CancelBookingDialog';
import CreateBookingDialog from './CreateBookingDialog';

export interface BookingDetailSheetProps {
  bookingId: string;
  canMutate: boolean;
  canDelete: boolean;
  canAcknowledgeDamage: boolean;
  /** เปิดมาจาก "บันทึกและรับมัดจำเลย" / เมนู "รับมัดจำ" — ไฮไลต์กล่องรับเงิน */
  autoCollectDeposit?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** บอกว่าเงินแต่ละวิธีของบิลนี้ลงบัญชีไหน — เงินสดเข้าลิ้นชักสาขา โอน/QR เข้าธนาคารรับเงินของร้าน (ย้ายมาจากหน้าเดิม) */
function ReceiptAccounts({ branch, rows }: { branch: Booking['branch']; rows: TenderRow[] }) {
  const cash = rows.some((r) => r.method === 'CASH');
  const bank = rows.some((r) => r.method !== 'CASH');
  return (
    <p className="text-xs leading-snug text-muted-foreground">รับเข้าบัญชี SHOP ·{' '}
      {[cash && `เงินสด ${branch.name} (${branch.shopCashAccountCode || 'ยังไม่ได้ตั้งบัญชีเงินสดสาขา'})`, bank && 'ธนาคารรับเงิน (S11-1201)'].filter(Boolean).join(' · ')}</p>
  );
}

function productState(booking: Booking, item?: BookingItem): { label: string; tone: 'ok' | 'muted' | 'bad' } {
  if (booking.status === 'CONVERTED') return { label: 'ส่งมอบแล้ว', tone: 'muted' };
  if (!item?.productId) return { label: 'ไม่ได้ผูกเครื่อง — แปลงขายไม่ได้', tone: 'bad' };
  const s = item.product?.status;
  if (!s) return { label: 'ไม่พบข้อมูลเครื่อง', tone: 'muted' };
  if (s === 'IN_STOCK') return { label: 'พร้อมขาย · ยังอยู่ในสต็อก', tone: 'ok' };
  if (s === 'RESERVED') return { label: 'จองไว้แล้ว', tone: 'ok' };
  if (s.startsWith('SOLD')) return { label: 'ถูกขายไปแล้ว — ต้องยกเลิกใบนี้แล้วออกใบใหม่', tone: 'bad' };
  return { label: `สถานะเครื่อง ${s}`, tone: 'muted' };
}

const usesCash = (rows: TenderRow[]) => rows.some((r) => r.method === 'CASH');

export default function BookingDetailSheet({ bookingId, canMutate, canDelete, canAcknowledgeDamage, autoCollectDeposit, onClose, onChanged }: BookingDetailSheetProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useBookingClock();
  const { data: booking, isLoading, isError, error, refetch } = useQuery<Booking>({
    queryKey: ['booking', bookingId],
    queryFn: async () => (await api.get(`/bookings/${bookingId}`)).data,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [collectBalance, setCollectBalance] = useState(false);
  const [damageAck, setDamageAck] = useState(false);

  const expired = !!booking && awaitingExpiry(booking, now);
  const item = booking?.items[0];
  const conversionBlocked = !!booking && (booking.items.length !== 1 || !item?.productId || item.quantity !== 1);
  const total = Number(booking?.totalAmount ?? 0);
  const deposit = Number(booking?.depositAmount ?? 0);
  const balance = total - deposit;
  const isPartial = !!booking && deposit < total;
  const depositTenders = useTenders(deposit);
  const balanceTenders = useTenders(isPartial ? balance : 0);

  const done = (event: 'booking-updated' | 'booking-converted', message: string) => {
    toast.success(message);
    void invalidateSalesQueries(qc, event);
    void qc.invalidateQueries({ queryKey: ['bookings-summary'] });
    onChanged();
  };
  const payMut = useMutation({
    mutationFn: () => api.post(`/bookings/${bookingId}/pay-deposit`, { depositMethod: depositTenders.payload[0]?.method ?? 'CASH', tenders: depositTenders.payload }),
    onSuccess: () => done('booking-updated', 'บันทึกการรับมัดจำแล้ว'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const convertMut = useMutation({
    mutationFn: async () => (await api.post(`/bookings/${bookingId}/convert`, {
      saleType: 'CASH',
      collectBalance: isPartial ? collectBalance : undefined,
      paymentMethod: isPartial ? balanceTenders.payload[0]?.method : undefined,
      tenders: isPartial ? balanceTenders.payload : undefined,
      previouslyDamagedAcknowledged: damageAck || undefined,
    })).data as { sale?: { id: string } },
    onSuccess: (data) => {
      done('booking-converted', 'บันทึกขายเงินสดแล้ว นำมัดจำมาหักยอดเรียบร้อย');
      if (data.sale?.id) navigate(`/sales?saleId=${encodeURIComponent(data.sale.id)}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const cancelMut = useMutation({
    mutationFn: (cancelReason: string) => api.post(`/bookings/${bookingId}/cancel`, { cancelReason }),
    onSuccess: () => { setCancelOpen(false); done('booking-updated', deposit > 0 && booking?.status === 'PAID' ? 'ยกเลิกใบจองและคืนมัดจำแล้ว' : 'ยกเลิกใบจองแล้ว'); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/bookings/${bookingId}`),
    onSuccess: () => { setDeleteOpen(false); done('booking-updated', 'ลบใบจองแล้ว'); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const pending = payMut.isPending || convertMut.isPending || cancelMut.isPending || deleteMut.isPending;

  const copyPhone = async (phone: string) => {
    try { await navigator.clipboard.writeText(phone); toast.success('คัดลอกเบอร์แล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); }
  };

  if (editOpen && booking) {
    return <CreateBookingDialog open initialBooking={booking} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void refetch(); onChanged(); }} />;
  }

  const expiry = booking ? describeExpiry(booking, now) : null;
  const canActOnOpen = canMutate && !!booking && isOpenStatus(booking.status) && !expired;
  const showMenu = canActOnOpen || (canDelete && booking?.status === 'PENDING_DEPOSIT' && !expired);
  const state = booking ? productState(booking, item) : null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" aria-label="รายละเอียดใบจอง" className="flex w-full flex-col gap-0 p-0 sm:max-w-[620px]">
        <SheetHeader className="space-y-1.5 border-b border-border px-5 py-4 pr-20 text-left">
          <SheetTitle className="flex flex-wrap items-center gap-2.5 font-mono text-base">
            {booking?.bookingNumber ?? 'กำลังโหลด...'}
            {booking && <Badge variant={STATUS_VARIANT[booking.status]} className="gap-1.5 font-sans"><BadgeDot />{STATUS_LABEL[booking.status]}</Badge>}
          </SheetTitle>
          {booking && (
            <SheetDescription className="leading-snug">
              สร้าง {fmtDate(booking.createdAt)} · โดย {booking.createdBy.name} · สาขา{booking.branch.name}
            </SheetDescription>
          )}
          {showMenu && (
            <div className="absolute right-12 top-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="การกระทำเพิ่มเติม"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {canActOnOpen && !conversionBlocked && (
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}><Pencil className="size-4" /> {booking!.status === 'PAID' ? 'แก้หมายเหตุ / วันหมดอายุ' : 'แก้ไขใบจอง'}</DropdownMenuItem>
                  )}
                  {canActOnOpen && (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setCancelOpen(true)}>
                      <Ban className="size-4" /> ยกเลิกใบจอง{booking!.status === 'PAID' ? ` · คืนมัดจำ ${fmtMoneyShort(deposit)}` : ''}
                    </DropdownMenuItem>
                  )}
                  {canDelete && booking?.status === 'PENDING_DEPOSIT' && !expired && (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}><Trash2 className="size-4" /> ลบใบจอง</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </SheetHeader>

        {isError ? (
          <div role="alert" className="space-y-3 p-5 text-sm">
            <p>โหลดใบจองไม่สำเร็จ: {getErrorMessage(error)}</p>
            <Button variant="outline" onClick={() => refetch()}>ลองใหม่</Button>
          </div>
        ) : isLoading || !booking ? (
          <div className="py-10 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <>
            {/* แถบใต้หัว: วันหมดอายุ / เหตุการณ์ปิด */}
            {expired ? (
              <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-5 py-2.5 text-[13px] leading-snug">
                <span className="flex items-center gap-2"><Clock className="size-4 text-destructive" />ถึงกำหนดหมดอายุแล้ว กำลังรอระบบปิด (00:30) จึงรับเงิน แก้ไข หรือแปลงขายต่อไม่ได้</span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>โหลดสถานะล่าสุด</Button>
              </div>
            ) : booking.status === 'CONVERTED' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/10 px-5 py-2.5 text-[13px] leading-snug">
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" />ขายแล้ว {booking.convertedAt ? fmtDate(booking.convertedAt) : ''} · ใบขาย <span className="font-mono font-semibold">{booking.convertedToSale?.saleNumber ?? '—'}</span></span>
                {booking.convertedToSale && <Button size="sm" variant="outline" onClick={() => navigate(`/sales?saleId=${encodeURIComponent(booking.convertedToSale!.id)}`)}><ExternalLink className="size-3.5" /> เปิดใบขาย / ใบเสร็จ</Button>}
              </div>
            ) : booking.status === 'CANCELED' ? (
              <div className="border-b border-border bg-destructive/10 px-5 py-2.5 text-[13px] leading-snug">
                ยกเลิก {booking.canceledAt ? fmtDate(booking.canceledAt) : ''}{booking.canceledBy ? ` · โดย ${booking.canceledBy.name}` : ''}{booking.cancelReason ? ` · เหตุผล: ${booking.cancelReason}` : ''}{booking.depositPaidAt ? ` · คืนมัดจำ ${fmtMoneyShort(deposit)} (${METHOD_LABEL[booking.depositMethod ?? ''] ?? 'ตามวิธีที่รับมา'})` : ''}
              </div>
            ) : booking.status === 'EXPIRED' ? (
              <div className="border-b border-border bg-muted px-5 py-2.5 text-[13px] leading-snug">
                หมดอายุสิ้นวัน {formatThaiDateShort(new Date(lastValidMs(booking.expireDate)))}{booking.depositPaidAt ? ` · ริบมัดจำ ${fmtMoneyShort(deposit)} เข้ารายได้` : ' · ยังไม่ได้รับมัดจำ'}
              </div>
            ) : (
              <div className="flex items-center gap-2 border-b border-border bg-muted px-5 py-2.5 text-[13px] leading-snug">
                <Clock className="size-4 text-muted-foreground" />
                <span>{booking.status === 'PAID' ? 'ลูกค้าต้องมารับภายในสิ้นวัน' : 'ใช้ได้ถึงสิ้นวัน'} <strong className="font-semibold">{expiry?.sub}</strong> (เวลาไทย) · {expiry?.label}</span>
              </div>
            )}

            <fieldset disabled={pending} className="min-w-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 text-sm">
              {booking.status === 'PAID' && conversionBlocked && (
                <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 leading-snug">ใบจองนี้ยังแปลงขายไม่ได้ ต้องมีเครื่องที่ผูกสต็อก 1 รายการ จำนวน 1 ชิ้น กรุณายกเลิกและคืนเงินก่อนออกใบจองใหม่</p>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">ลูกค้า</h3>
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">{booking.customer.name.slice(0, 1)}</span>
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="text-[15px] font-semibold">{booking.customer.name}</div>
                    <div className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted-foreground">
                      <Phone className="size-3.5" />{booking.customer.phone ?? 'ไม่มีเบอร์'}
                      {booking.customer.phone && <Button variant="ghost" size="icon" className="size-6" aria-label="คัดลอกเบอร์โทร" onClick={() => copyPhone(booking.customer.phone!)}><Copy className="size-3.5" /></Button>}
                    </div>
                  </div>
                  <Button variant="link" size="sm" onClick={() => navigate(`/customers/${booking.customer.id}`)}>ดูลูกค้า <ExternalLink className="size-3.5" /></Button>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">เครื่องที่จอง</h3>
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Smartphone className="size-5" /></span>
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="truncate font-semibold">{item?.description ?? '—'}</div>
                    <div className="truncate text-xs text-muted-foreground">{item?.product?.imeiSerial ? `IMEI ${item.product.imeiSerial}` : ''}{item?.product?.wasPreviouslyDamaged ? ' · มีประวัติเสียหาย' : ''}</div>
                    {state && (
                      <div className={cn('mt-1 flex items-center gap-1 text-xs', state.tone === 'ok' ? 'text-success' : state.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>
                        {state.tone === 'bad' ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}{state.label}
                      </div>
                    )}
                  </div>
                  <div className="text-right leading-snug"><div className="text-[11px] text-muted-foreground">ราคาตกลง</div><div className="font-semibold tabular-nums">{fmtMoneyShort(item?.unitPrice ?? 0)}</div></div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">ยอดเงิน</h3>
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span>ยอดรวม</span><span className="tabular-nums">{fmtMoney(booking.totalAmount)}</span></div>
                  <div className="flex items-start justify-between gap-3">
                    <span>{booking.depositPaidAt ? 'มัดจำรับแล้ว' : 'มัดจำที่ต้องรับ'}{booking.depositPaidAt && <span className="block text-xs text-muted-foreground">{METHOD_LABEL[booking.depositMethod ?? ''] ?? booking.depositMethod} · {fmtDate(booking.depositPaidAt)}</span>}</span>
                    <span className="tabular-nums">{fmtMoney(booking.depositAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                    <span>{booking.status === 'PENDING_DEPOSIT' ? 'ยอดที่ยังไม่ได้รับ' : booking.status === 'PAID' ? 'คงเหลือที่ต้องรับวันนี้' : 'คงเหลือ'}</span>
                    <span className="tabular-nums">{fmtMoney(booking.status === 'PENDING_DEPOSIT' ? total : booking.status === 'PAID' ? balance : 0)}</span>
                  </div>
                </div>
              </section>

              {canMutate && booking.status === 'PENDING_DEPOSIT' && !expired && (
                <section className={cn('space-y-3 rounded-xl border border-primary p-4', autoCollectDeposit && 'ring-2 ring-primary/30')}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold"><HandCoins className="size-4 text-primary" />รับมัดจำ</span>
                    <span className="text-[13px] text-muted-foreground">ยอดที่ต้องรับ <strong className="font-semibold text-foreground tabular-nums">{fmtMoneyShort(deposit)}</strong></span>
                  </div>
                  <TenderInput due={deposit} value={depositTenders.rows} onChange={depositTenders.setRows} dueLabel="มัดจำที่ต้องรับ" disabled={pending} />
                  <ReceiptAccounts branch={booking.branch} rows={depositTenders.rows} />
                  <Button size="lg" className="w-full" onClick={() => payMut.mutate()}
                    disabled={pending || !depositTenders.status.ready || (usesCash(depositTenders.rows) && !booking.branch.shopCashAccountCode)}>
                    <HandCoins className="size-4" /> บันทึกรับมัดจำ {fmtMoneyShort(deposit)} บาท
                  </Button>
                </section>
              )}

              {canMutate && booking.status === 'PAID' && !expired && !conversionBlocked && !booking.convertedToSale && (
                <section className="space-y-3 rounded-xl border border-primary p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold"><ShoppingCart className="size-4 text-primary" />{isPartial ? 'รับส่วนต่างและออกใบขาย' : 'ออกใบขายโดยใช้มัดจำ'}</span>
                    {isPartial && <span className="text-[13px] text-muted-foreground">ต้องรับ <strong className="font-semibold text-foreground tabular-nums">{fmtMoneyShort(balance)}</strong></span>}
                  </div>
                  {isPartial && (
                    <>
                      <TenderInput due={balance} value={balanceTenders.rows} onChange={balanceTenders.setRows} dueLabel="ส่วนต่างที่ต้องรับ" disabled={pending} />
                      <ReceiptAccounts branch={booking.branch} rows={balanceTenders.rows} />
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 leading-snug">
                        <Checkbox checked={collectBalance} onCheckedChange={(v) => setCollectBalance(v === true)} className="mt-0.5" aria-label="ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว และส่งมอบเครื่องให้ลูกค้า" />
                        <span>ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว และส่งมอบเครื่องให้ลูกค้า</span>
                      </label>
                    </>
                  )}
                  {canAcknowledgeDamage && item?.product?.wasPreviouslyDamaged && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 leading-snug">
                      <Checkbox checked={damageAck} onCheckedChange={(v) => setDamageAck(v === true)} className="mt-0.5" />
                      <span>เครื่องมีประวัติเสียหาย — ยืนยันว่าได้แจ้งลูกค้าและอนุมัติให้ขายแล้ว</span>
                    </label>
                  )}
                  <Button size="lg" className="w-full" onClick={() => convertMut.mutate()}
                    disabled={pending || (isPartial && (!collectBalance || !balanceTenders.status.ready || (usesCash(balanceTenders.rows) && !booking.branch.shopCashAccountCode)))}>
                    <ShoppingCart className="size-4" /> {isPartial ? `รับส่วนต่าง ${fmtMoneyShort(balance)} และออกใบขาย` : 'ออกใบขายโดยใช้มัดจำ'}
                  </Button>
                  <p className="text-center text-xs leading-snug text-muted-foreground">ออกใบขายเงินสด · นำมัดจำ {fmtMoneyShort(deposit)} มาหักยอด · เปิดใบขายให้ต่อทันที</p>
                </section>
              )}

              {booking.notes && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">หมายเหตุ</h3>
                  <p className="rounded-md bg-muted px-3 py-2 leading-snug">{booking.notes}</p>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">ประวัติ</h3>
                <BookingTimeline events={booking.events ?? []} />
              </section>
            </fieldset>
          </>
        )}

        <CancelBookingDialog booking={booking ?? null} open={cancelOpen} onOpenChange={setCancelOpen} onConfirm={(reason) => cancelMut.mutate(reason)} loading={cancelMut.isPending} />
        <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={`ลบใบจอง ${booking?.bookingNumber ?? ''}?`}
          description="ลบได้เฉพาะใบที่ยังไม่รับมัดจำ ใบจะหายจากรายการ (เก็บประวัติไว้ในระบบ)" variant="destructive" confirmLabel="ลบใบจอง"
          loading={deleteMut.isPending} closeOnConfirm={false} onConfirm={() => deleteMut.mutate()} />
      </SheetContent>
    </Sheet>
  );
}
```

หมายเหตุให้ผู้ทำ: `TenderInput` ภายในมี `<select aria-label="วิธีรับเงิน">` และช่อง `เลขอ้างอิงการโอน` (เทสเดิมพึ่งชื่อเหล่านี้ — ตรวจใน `apps/web/src/components/tender/TenderInput.tsx` ก่อนรันเทส ถ้าชื่อต่างให้แก้เทสให้ตรงของจริง ห้ามแก้ `TenderInput`)

- [ ] **Step 5: รันเทส + typecheck**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingDetailSheet.test.tsx`
Expected: PASS 10 เทส
Run: `./tools/check-types.sh web` → 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/BookingsPage
git commit -m "feat(bookings-web): แผงรายละเอียดด้านขวา ปุ่มหลักตามสถานะ · ไทม์ไลน์ · เมนู ⋯ · กล่องยืนยันยกเลิกบังคับเหตุผล"
```

---

### Task 12: Web — ประกอบหน้า `index.tsx` + หน้าว่าง 1B + ลบไฟล์เดิม

**Files:**
- Create: `apps/web/src/pages/BookingsPage/components/BookingEmptyState.tsx`
- Create: `apps/web/src/pages/BookingsPage/index.tsx`
- Delete: `apps/web/src/pages/BookingsPage.tsx`, `apps/web/src/pages/BookingsPage.test.tsx`, `apps/web/src/pages/BookingsPage.forms.test.tsx`
- Test: `apps/web/src/pages/BookingsPage/__tests__/BookingsPage.test.tsx`

**Interfaces:**
- Consumes: ทุกชิ้นจาก Task 5–11 · `PageHeader` (default, `@/components/ui/PageHeader`) · `QueryBoundary` (default, `@/components/QueryBoundary` — props `isLoading isError error errorTitle onRetry children`) · `Card, CardContent` · `useDocumentTitle` · `useLatestSearchParams` · `invalidateSalesQueries`
- Produces: `export default function BookingsPage(): JSX.Element` — route `/bookings` เดิมชี้มาเองเมื่อไฟล์เดิมถูกลบ · รองรับ `?bookingId=<id>` (ลิงก์จากใบเสร็จ `BookingSaleReceipt.tsx` ใช้อยู่)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

```tsx
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BookingsPage from '../index';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: 'SALES' as string, total: 1 }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: vi.fn(), delete: vi.fn() }, getErrorMessage: (e: Error) => e.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const booking = { id: 'bk-1', bookingNumber: 'BK-20261005-0002', status: 'PAID', depositAmount: '5000', totalAmount: '42900',
  expireDate: '2099-10-11T17:00:00.000Z', depositPaidAt: '2026-10-05T03:55:00Z', depositMethod: 'CASH', createdAt: '2026-10-05T03:42:00Z',
  customer: { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' }, branch: { id: 'br-1', name: 'ลาดพร้าว', shopCashAccountCode: 'S11-1101' },
  createdBy: { id: 'u1', name: 'น้ำ' }, items: [{ id: 'i1', productId: 'p1', description: 'iPhone 16 Pro 256GB', quantity: 1, unitPrice: '42900', amount: '42900', product: { id: 'p1', name: 'iPhone 16 Pro', status: 'IN_STOCK', branchId: 'br-1' } }], events: [] };
const summary = () => ({ total: mocks.total, open: mocks.total, pendingDeposit: 0, paid: mocks.total, paidDepositHeld: '5000.00', expiringWithin3Days: 0, closed: { converted: 0, canceled: 0, expired: 0, total: 0 }, forfeitedThisMonth: '0.00' });

function LocationProbe() { const loc = useLocation(); return <output data-testid="loc">{loc.search}</output>; }
function renderPage(url = '/bookings?zone=shop') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={client}>
    <Routes><Route path="/bookings" element={<><LocationProbe /><BookingsPage /></>} /><Route path="/sales" element={<p>หน้าขาย</p>} /></Routes>
  </QueryClientProvider></MemoryRouter>);
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'SALES'; mocks.total = 1;
  mocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/bookings/summary')) return { data: summary() };
    if (path === '/bookings/bk-1') return { data: booking };
    if (path.startsWith('/bookings?')) return { data: { data: mocks.total ? [booking] : [], total: mocks.total, page: 1, limit: 50 } };
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'ลาดพร้าว' }] };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: {} });
});

describe('BookingsPage', () => {
  it('หัว · การ์ด KPI · ตาราง และกดการ์ดเปลี่ยน URL', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /การจอง \/ มัดจำ/ })).toBeInTheDocument();
    expect(await screen.findByText('BK-20261005-0002')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /มัดจำแล้ว · รอรับเครื่อง/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('status=PAID');
    expect(screen.getByTestId('loc')).toHaveTextContent('zone=shop');
  });

  it('กดแถวเปิดแผงรายละเอียดและเขียน ?bookingId= · ปิดแล้วลบคีย์', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('สมชาย ใจดี'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('bookingId=bk-1');
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.getByTestId('loc')).not.toHaveTextContent('bookingId'));
  });

  it('ลิงก์ ?bookingId= จากใบเสร็จเปิดแผงทันที', async () => {
    renderPage('/bookings?bookingId=bk-1');
    expect(await screen.findByRole('dialog')).toHaveTextContent('BK-20261005-0002');
  });

  it('ปุ่มสร้างใบจองเปิดฟอร์ม (SALES) · บทบาทอ่านอย่างเดียวไม่มีปุ่ม', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /สร้างใบจอง/ }));
    expect(await screen.findByRole('heading', { name: 'สร้างใบจอง' })).toBeInTheDocument();
  });

  it('ACCOUNTANT: ไม่มีปุ่มสร้าง และเมนูแถวไม่มีรับมัดจำ/ยกเลิก', async () => {
    mocks.role = 'ACCOUNTANT'; renderPage();
    await screen.findByText('BK-20261005-0002');
    expect(screen.queryByRole('button', { name: /สร้างใบจอง/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /การกระทำ BK-20261005-0002/ }));
    expect(await screen.findByRole('menuitem', { name: 'เปิด' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /ยกเลิกใบจอง/ })).not.toBeInTheDocument();
  });

  it('ยังไม่มีใบจองเลยทั้งระบบ → หน้าว่าง 3 ขั้น ไม่มีการ์ด KPI/ตัวกรอง', async () => {
    mocks.total = 0; renderPage();
    expect(await screen.findByRole('heading', { name: 'ยังไม่มีใบจอง' })).toBeInTheDocument();
    expect(screen.getByText(/รับส่วนต่างและขาย/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ที่ยังเปิดอยู่/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ค้นหาใบจอง')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'สร้างใบจองแรก' }));
    expect(await screen.findByRole('heading', { name: 'สร้างใบจอง' })).toBeInTheDocument();
  });

  it('ยกเลิกจากเมนูแถว → กล่องยืนยัน → POST cancel พร้อมเหตุผล', async () => {
    renderPage();
    await screen.findByText('BK-20261005-0002');
    await userEvent.click(screen.getByRole('button', { name: /การกระทำ BK-20261005-0002/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /ยกเลิกใบจอง/ }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'ไม่ผ่านเครดิต' }));
    await userEvent.click(within(confirm).getByRole('button', { name: /ยืนยันยกเลิกและคืนมัดจำ 5,000/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/cancel', { cancelReason: 'ไม่ผ่านเครดิต' }));
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage/__tests__/BookingsPage.test.tsx`
Expected: FAIL — `../index` not found

- [ ] **Step 3: สร้าง `BookingEmptyState.tsx`**

```tsx
import { Banknote, CalendarDays, Clock, Pencil, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STEPS = [
  { icon: Pencil, title: 'สร้างใบจอง', text: 'เลือกลูกค้า เลือกเครื่องในสต็อก ระบุมัดจำและวันหมดอายุ' },
  { icon: Banknote, title: 'รับมัดจำ', text: 'บันทึกเงินสด/โอน/QR เงินเข้าสมุดเงินหน้าร้านของสาขา' },
  { icon: ShoppingCart, title: 'รับส่วนต่างและขาย', text: 'ลูกค้ามารับเครื่อง จ่ายส่วนที่เหลือ ออกใบขายโดยหักมัดจำ' },
] as const;

/** หน้าว่าง 1B — prod ยังไม่มีใบจองเลย นี่คือจอแรกที่ทีมเห็น */
export default function BookingEmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <section className="flex flex-col items-center gap-7 rounded-lg border border-border bg-card px-6 pb-10 pt-14 shadow-card">
      <div className="flex max-w-lg flex-col items-center gap-2.5 text-center">
        <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><CalendarDays className="size-7" /></span>
        <h2 className="mt-2 text-lg font-semibold">ยังไม่มีใบจอง</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">ใบจองใช้รับมัดจำเครื่องไว้ให้ลูกค้า เมื่อลูกค้ามารับและจ่ายส่วนที่เหลือ ระบบปิดเป็นใบขายให้โดยนำมัดจำมาหักยอดอัตโนมัติ</p>
        {canCreate && <Button size="lg" className="mt-1.5" onClick={onCreate}>สร้างใบจองแรก</Button>}
      </div>
      <ol className="grid w-full max-w-4xl gap-6 border-t border-border pt-7 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><s.icon className="size-4" /></span>
            <div className="leading-snug"><div className="text-sm font-semibold">{i + 1}. {s.title}</div><div className="mt-0.5 text-[13px] text-muted-foreground">{s.text}</div></div>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground"><Clock className="size-3.5" />ใบจองใช้ได้ 7 วันโดยค่าเริ่มต้น (แก้ได้ทุกใบ) · เลยกำหนดแล้วมัดจำที่รับไว้จะถูกริบ · ยกเลิกก่อนหมดอายุคืนมัดจำเต็มจำนวน</p>
    </section>
  );
}
```

(บรรทัดกติกาเรื่อง "ล็อกเครื่อง" และ "LINE เตือน" ตาม mockup จะเพิ่มใน PR 2 และ PR 6 เมื่อฟีเจอร์นั้นมีจริง — ห้ามโฆษณาสิ่งที่ยังไม่มี)

- [ ] **Step 4: สร้าง `index.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLatestSearchParams } from '@/hooks/useLatestSearchParams';
import api, { getErrorMessage } from '@/lib/api';
import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import BookingDetailSheet from './components/BookingDetailSheet';
import BookingEmptyState from './components/BookingEmptyState';
import BookingFilterBar from './components/BookingFilterBar';
import BookingKpiCards from './components/BookingKpiCards';
import BookingTable from './components/BookingTable';
import CancelBookingDialog from './components/CancelBookingDialog';
import CreateBookingDialog from './components/CreateBookingDialog';
import { useBookingClock } from './hooks/useBookingClock';
import { useBookingsQuery } from './hooks/useBookingsQuery';
import type { Booking } from './types';

export default function BookingsPage() {
  useDocumentTitle('การจอง / มัดจำ');
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role ?? '';
  const canCreate = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(role);
  const canMutate = canCreate;
  const canDelete = ['OWNER', 'BRANCH_MANAGER'].includes(role);
  const canAcknowledgeDamage = ['OWNER', 'FINANCE_MANAGER'].includes(role);

  const q = useBookingsQuery();
  const now = useBookingClock();
  const [searchParams, updateParams] = useLatestSearchParams();
  const detailId = searchParams.get('bookingId');
  const [autoCollect, setAutoCollect] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  const openDetail = (id: string, collect = false) => { setAutoCollect(collect); updateParams((next) => next.set('bookingId', id)); };
  const closeDetail = () => { setAutoCollect(false); updateParams((next) => next.delete('bookingId')); };
  const onChanged = () => {
    void invalidateSalesQueries(qc, 'booking-updated');
    void qc.invalidateQueries({ queryKey: ['bookings-summary'] });
  };

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/bookings/${id}/cancel`, { cancelReason: reason }),
    onSuccess: () => {
      toast.success(cancelTarget?.status === 'PAID' ? 'ยกเลิกใบจองและคืนมัดจำแล้ว' : 'ยกเลิกใบจองแล้ว');
      setCancelTarget(null);
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rows = q.listResult?.data ?? [];
  const isFirstUse = !!q.summary && q.summary.total === 0 && !q.hasActiveFilters;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="การจอง / มัดจำ"
        subtitle="รับมัดจำเครื่องไว้ให้ลูกค้า แล้วปิดเป็นใบขายเมื่อลูกค้ามารับ"
        action={canCreate && !isFirstUse ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> สร้างใบจอง</Button> : null}
      />

      {isFirstUse ? (
        <BookingEmptyState canCreate={canCreate} onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <BookingKpiCards summary={q.summary} activeKey={q.activeKpiKey} onPick={q.setFilters} />
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-border px-4 py-3">
                <BookingFilterBar search={q.search} setSearch={q.setSearch} view={q.view} status={q.status} branchId={q.branchId} from={q.from} to={q.to}
                  branches={q.branches} canFilterBranch={q.canFilterBranch} setFilters={q.setFilters} />
              </div>
              <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} errorTitle="โหลดรายการใบจองไม่สำเร็จ" onRetry={q.refetch}>
                <BookingTable
                  rows={rows}
                  total={q.listResult?.total ?? 0}
                  page={q.page}
                  onPageChange={q.setPage}
                  sort={q.sort}
                  onSortChange={q.setSort}
                  isLoading={q.isLoading}
                  nowMs={now}
                  actions={{ onOpen: (b) => openDetail(b.id), onCollectDeposit: (b) => openDetail(b.id, true), onCancel: setCancelTarget, canMutate }}
                  hasActiveFilters={q.hasActiveFilters}
                  onClearFilters={q.clearFilters}
                />
              </QueryBoundary>
            </CardContent>
          </Card>
        </>
      )}

      {createOpen && (
        <CreateBookingDialog open onClose={() => setCreateOpen(false)}
          onSaved={(booking, { collectDeposit }) => { onChanged(); setCreateOpen(false); if (collectDeposit) openDetail(booking.id, true); }} />
      )}
      {detailId && (
        <BookingDetailSheet bookingId={detailId} canMutate={canMutate} canDelete={canDelete} canAcknowledgeDamage={canAcknowledgeDamage}
          autoCollectDeposit={autoCollect} onClose={closeDetail} onChanged={onChanged} />
      )}
      <CancelBookingDialog booking={cancelTarget} open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={(reason) => cancelTarget && cancelMut.mutate({ id: cancelTarget.id, reason })} loading={cancelMut.isPending} />
    </div>
  );
}
```

- [ ] **Step 5: ลบไฟล์เดิม**

```bash
git rm apps/web/src/pages/BookingsPage.tsx apps/web/src/pages/BookingsPage.test.tsx apps/web/src/pages/BookingsPage.forms.test.tsx
grep -rn "pages/BookingsPage'" apps/web/src --include="*.ts*" | grep -v "pages/BookingsPage/"   # ต้องเหลือแค่ App.tsx (lazy import) ซึ่งชี้โฟลเดอร์ได้เอง
```

ถ้า `grep` พบไฟล์อื่น import `STATUS_LABEL`/`computeBookingTotal` จากพาธเดิม ให้เปลี่ยนเป็น `@/pages/BookingsPage/utils`

- [ ] **Step 6: รันเทสทั้งโฟลเดอร์ + typecheck + lint เฉพาะโฟลเดอร์**

Run: `npm --prefix apps/web test -- src/pages/BookingsPage`
Expected: PASS ทุกไฟล์ (utils · useBookingsQuery · KpiCards · Table · CreateBookingDialog · DetailSheet · BookingsPage)
Run: `./tools/check-types.sh web` → 0 errors
Run: `cd apps/web && npx eslint src/pages/BookingsPage` → 0 errors (eslint ของ web ไม่มี `--fix` — ต่างจาก api)

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/pages
git commit -m "feat(bookings-web): ประกอบหน้า /bookings ใหม่ + หน้าว่าง 3 ขั้น · ลบหน้าเดิมไฟล์เดียว"
```

---

### Task 13: e2e · เวอร์ชัน · ตรวจรอบสุดท้าย

**Files:**
- Modify: `apps/web/e2e/bookings.spec.ts`
- Modify: `apps/web/package.json` (`version`)

- [ ] **Step 1: แก้ e2e ให้ตรงหน้าใหม่**

ใน `apps/web/e2e/bookings.spec.ts`:
- เทส SALES: แทนบล็อก "Status filter shows our Thai labels" ด้วย

```ts
    // การ์ด KPI กดกรองได้ และเขียน URL
    await page.getByRole('button', { name: /มัดจำแล้ว · รอรับเครื่อง/ }).click();
    await expect(page).toHaveURL(/status=PAID/);
    await page.getByRole('button', { name: /ที่ยังเปิดอยู่/ }).click();
    await expect(page).not.toHaveURL(/status=/);
    // ดรอปดาวน์สถานะยังมีป้ายไทย
    await page.getByRole('combobox', { name: 'สถานะใบจอง' }).click();
    await expect(page.getByRole('option', { name: 'รอชำระมัดจำ' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'หมดอายุ' })).toBeVisible();
    await page.keyboard.press('Escape');
```

- แทนสองบรรทัด assert ช่องในฟอร์ม (`getByLabel(/ใช้ได้ถึงสิ้นวันที่/)` และ `getByText(/มัดจำ/)`) ด้วย

```ts
    await expect(page.getByRole('button', { name: '7 วัน' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'ลูกค้า' })).toBeVisible();
    await expect(page.getByLabel('ค้นหาเครื่องในสาขา')).toBeVisible();
```

- เทส OWNER: ท้ายเทสเพิ่ม

```ts
    await page.getByRole('button', { name: /ปิดแล้ว/ }).click();
    await expect(page).toHaveURL(/status=CLOSED/);
    await expect(page.getByRole('heading', { name: /การจอง.*มัดจำ/ }).first()).toBeVisible();
```

(ถ้าฐานทดสอบ e2e ยังไม่มีใบจองเลย หน้าจะเป็น "ยังไม่มีใบจอง" — ให้ครอบส่วนการ์ด KPI ด้วย `if (await page.getByRole('heading', { name: 'ยังไม่มีใบจอง' }).isVisible().catch(() => false)) return;` หลัง `hasErrorBoundary`)

- [ ] **Step 2: bump เวอร์ชัน**

`apps/web/package.json`: `"version": "26.10.6"` → `"version": "26.10.7"` (ตรวจ `git log origin/main -1 -- apps/web/package.json` ตอน merge — ถ้าเลขถูกใช้แล้วให้ขยับขึ้น)

- [ ] **Step 3: ตรวจรอบสุดท้ายทั้งก้อน**

Run: `npm --prefix apps/api test -- src/modules/bookings` → PASS
Run: `npm --prefix apps/web test` → PASS ทั้งชุด (ยืนยันว่าไม่มีไฟล์อื่น import หน้าเดิม)
Run: `./tools/check-types.sh all` → 0 errors
Run (ถ้ามี API local + ฐานทดสอบ — ดู memory `bestchoice-local-dev-gotchas`): `cd apps/web && npx playwright test e2e/bookings.spec.ts`
ตรวจภาพ: เปิด `/bookings?zone=shop` ที่ความกว้าง 1440 แล้ววัดด้วย DOM ว่าตารางไม่มี scrollbar แนวนอนและไม่มีคำโดนตัด (`document.querySelector('table')!.scrollWidth <= 1120`) · เปิดที่ 390 ต้องเห็นการ์ด

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/bookings.spec.ts apps/web/package.json
git commit -m "test(bookings): e2e ตามหน้าใหม่ · bump web 26.10.7"
```

- [ ] **Step 5: ส่งตรวจ**

ขอผู้ตรวจอิสระอ่านทั้งสาขา (`git diff origin/main...feat/bookings-redesign`) ตามกติกาเจ้าของ ก่อนถามเจ้าของว่าจะ push/เปิด PR

---

## ตรวจทานแผนกับ spec (ทำแล้ว 2026-10-05)

| spec | task |
|---|---|
| §3.1 KPI 6 ใบ · ตัวกรองใน URL · ค่าเริ่มต้น "ที่ยังเปิดอยู่" เรียงใกล้หมดอายุ · ตาราง 1,120 px · หมดอายุเป็นวันคงเหลือ · แถวกดได้ · เมนู ⋯ · หน้าว่าง · จอโทรศัพท์ | 1, 2, 5, 6, 7, 8, 9, 12 |
| §3.2 ฟอร์ม 4 ขั้น · combobox + สร้างลูกค้าใหม่ · เครื่องสต็อกเท่านั้น · ชิป % / วัน · แถบสรุป · บันทึกและรับมัดจำเลย | 4, 10 |
| §3.3 Sheet 620 · ปุ่มหลักตามสถานะ · เมนู ⋯ · ไทม์ไลน์ · เครื่องเช็คสด · ขายสำเร็จเปิดใบขาย · สถานะปิดอ่านอย่างเดียว · รอระบบปิด | 3, 11 |
| §3.4 กล่องยืนยันยกเลิก เหตุผลบังคับ บอกยอดคืน | 4, 11, 12 |
| §4 มัดจำ > 0 · cancelReason บังคับ · 1 เครื่อง | 4, 5 |
| §6.1 ตัวกรอง/ค้นหา/เรียง + product.status ติดรายการ · §6.2 summary · §6.3 events | 1, 2, 3 |
| §11 เทส API/web/e2e | ทุก task · 13 |
| **นอก PR นี้ (ตาม §12):** ล็อกเครื่อง/ข้อความล็อกในแผง (PR 2) · กล่องใบรับมัดจำ (PR 3) · แชท (PR 4–5) · LINE เตือน (PR 6) — ฟอร์มมีประโยค "เครื่องจะถูกล็อกเมื่อรับมัดจำ" ไว้ล่วงหน้าตาม mockup; ถ้าทีมเริ่มใช้งานก่อน PR 2 ขึ้น ให้ตัดประโยคนี้ออกชั่วคราวใน Task 10 | — |
