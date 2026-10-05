import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import { bangkokCalendarParts, bangkokDateRange, bangkokMidnight, bangkokStartOfDay } from '../../utils/date.util';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import { generateBookingNumber, generateSaleNumber } from '../../utils/sequence.util';
import { readNumberFlag, readStringFlag } from '../../utils/config.util';
import { captureProductDisclosure } from '../../utils/product-disclosure.util';
import { SHOP_WARRANTY_DAYS_CONFIG_KEY } from '../warranty/shop-warranty-policy';
import { addDays } from 'date-fns';
import { preemptReservationsInTx } from '../../utils/reservation-preempt.util';
import { getBranchScope, hasCrossBranchAccess } from '../auth/branch-access.util';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { BOOKING_PAYMENT_METHODS, DepositMethod, PayDepositDto } from './dto/pay-deposit.dto';
import { ShopTenderRecorder } from '../shop-tenders/shop-tender.recorder';
import { normalizeTenders } from '../shop-tenders/shop-tender.util';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { ConvertBookingDto } from './dto/convert-booking.dto';
import { ShopBookingDepositTemplate } from '../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../journal/cpa-templates/shop-booking-refund.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { assertSaleProductEligible } from '../sales/services/sale-product-policy';
import { assertCustomerHasPhone } from '../contracts/services/contract-create-policy';
import { PLACEHOLDER_FIELDS_SELECT } from '../chat-prospects/chat-placeholder';
import {
  assertSameTestSide,
  TEST_SIDE_CUSTOMER_SELECT,
  TEST_SIDE_PRODUCT_SELECT,
} from '../../utils/test-data-markers';

type RequestUser = { id: string; role: string; branchId?: string | null };

export const OPEN_BOOKING_STATUSES = ['PENDING_DEPOSIT', 'PAID'] as const;

/** spec §4 — ล็อกเครื่องตอนรับมัดจำไม่สำเร็จ (ถูกขาย/ย้ายสาขา/ถูกใบอื่นล็อก) */
export const LOCK_FAILED_MSG =
  'เครื่องนี้ถูกขายหรือย้ายสาขาไปแล้ว กรุณาแก้ใบจองเลือกเครื่องอื่นก่อนรับมัดจำ';

/** P2002 ของ unique index ล็อกเครื่อง (target เป็นชื่อคอลัมน์หรือชื่อ index ตาม adapter) — ตัวอื่นไม่ใช่ */
export function isLockedProductUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const t = err.meta?.target;
  return (Array.isArray(t) ? t.join(',') : String(t ?? '')).includes('locked_product');
}
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

export const BOOKING_EVENT_ACTIONS = [
  'BOOKING_CREATED',
  'BOOKING_UPDATED',
  'BOOKING_DEPOSIT_PAID',
  'BOOKING_CANCELED',
  'BOOKING_CONVERTED',
  'BOOKING_AUTO_EXPIRED',
  'BOOKING_DELETED',
  'BOOKING_UNLOCK_SKIPPED',
] as const;
export type BookingEventKind = (typeof BOOKING_EVENT_ACTIONS)[number];
export interface BookingEvent {
  id: string;
  kind: BookingEventKind;
  at: string;
  actor: { id: string; name: string } | null;
  data: Prisma.JsonValue | null;
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

const BOOKING_DEFAULT_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: {
        select: { id: true, name: true, status: true, branchId: true, imeiSerial: true, wasPreviouslyDamaged: true },
      },
    },
  },
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      addressCurrent: true,
      addressIdCard: true,
    },
  },
  branch: { select: { id: true, name: true, companyId: true, shopCashAccountCode: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  canceledBy: { select: { id: true, name: true } },
  convertedToSale: { select: { id: true, saleNumber: true, saleType: true } },
} as const;

const ZERO = new Prisma.Decimal(0);

export interface BookingSummary {
  total: number;
  open: number;
  pendingDeposit: number;
  paid: number;
  /** Σ มัดจำของใบ PAID — เงินที่ร้านถืออยู่ (string 2 ตำแหน่ง) */
  paidDepositHeld: string;
  expiringWithin3Days: number;
  closed: { converted: number; canceled: number; expired: number; total: number };
  /** Σ มัดจำที่ริบจากใบที่หมดอายุในเดือนไทยปัจจุบัน (ไม่สนช่วงวันที่ที่กรอง) */
  forfeitedThisMonth: string;
}

const EMPTY_SUMMARY: BookingSummary = {
  total: 0, open: 0, pendingDeposit: 0, paid: 0, paidDepositHeld: '0.00', expiringWithin3Days: 0,
  closed: { converted: 0, canceled: 0, expired: 0, total: 0 }, forfeitedThisMonth: '0.00',
};

const DEFAULT_EXPIRE_DAYS = 7;
const BOOKING_EXPIRE_DAYS_KEY = 'booking_expire_days';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly shopBookingDepositTemplate: ShopBookingDepositTemplate,
    private readonly shopBookingForfeitTemplate: ShopBookingForfeitTemplate,
    private readonly shopBookingDepositAppliedTemplate: ShopBookingDepositAppliedTemplate,
    private readonly shopCashSaleTemplate: ShopCashSaleTemplate,
    private readonly shopBookingRefundTemplate: ShopBookingRefundTemplate,
    private readonly shopAccountResolver: ShopAccountResolver,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Branch scoping helpers (mirror QuotesService pattern — keep them
  // in lockstep for consistency)
  // ───────────────────────────────────────────────────────────────────────

  private applyBranchScope(
    where: Prisma.BookingWhereInput,
    user: RequestUser,
    requestedBranchId?: string,
  ): { where: Prisma.BookingWhereInput; empty: boolean } {
    const scope = getBranchScope(user);
    if (scope.all) {
      if (requestedBranchId) where.branchId = requestedBranchId;
      return { where, empty: false };
    }
    if (!scope.branchId) return { where, empty: true };
    if (requestedBranchId && requestedBranchId !== scope.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงข้อมูลของสาขาอื่นได้');
    }
    where.branchId = scope.branchId;
    return { where, empty: false };
  }

  private assertCanWriteBranch(user: RequestUser, branchId: string) {
    if (hasCrossBranchAccess(user)) return;
    if (!user.branchId) {
      throw new ForbiddenException('บัญชีนี้ยังไม่มีสาขาที่รับผิดชอบ');
    }
    if (user.branchId !== branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงข้อมูลของสาขาอื่นได้');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────

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

  async findOne(id: string, user: RequestUser) {
    const baseWhere: Prisma.BookingWhereInput = { id, deletedAt: null };
    const { where, empty } = this.applyBranchScope(baseWhere, user);
    if (empty) throw new NotFoundException('ไม่พบใบจอง');
    const booking = await this.prisma.booking.findFirst({
      where,
      include: BOOKING_DEFAULT_INCLUDE,
    });
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

  private async loadBookingScoped(
    id: string,
    user: RequestUser,
    select?: Prisma.BookingSelect,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const baseWhere: Prisma.BookingWhereInput = { id, deletedAt: null };
    const { where, empty } = this.applyBranchScope(baseWhere, user);
    if (empty) throw new NotFoundException('ไม่พบใบจอง');
    return client.booking.findFirst({
      where,
      select: select ?? {
        id: true,
        status: true,
        branchId: true,
        expireDate: true,
        depositAmount: true,
      },
    });
  }

  private async lockBooking(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`;
  }

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

  // ───────────────────────────────────────────────────────────────────────
  // Money math (Prisma.Decimal — never Number())
  // ───────────────────────────────────────────────────────────────────────

  private computeItemAmount(
    quantity: number,
    unitPrice: number | string | Prisma.Decimal,
  ): Prisma.Decimal {
    return new Prisma.Decimal(unitPrice).mul(quantity);
  }

  private computeTotal(
    items: { quantity: number; unitPrice: number | string | Prisma.Decimal }[],
  ): Prisma.Decimal {
    return items.reduce<Prisma.Decimal>(
      (sum, it) => sum.add(new Prisma.Decimal(it.unitPrice).mul(it.quantity)),
      ZERO,
    );
  }

  private assertDepositInRange(deposit: Prisma.Decimal, total: Prisma.Decimal) {
    if (deposit.lessThan(0)) {
      throw new BadRequestException('depositAmount ต้องไม่ติดลบ');
    }
    if (deposit.greaterThan(total)) {
      throw new BadRequestException(
        `มัดจำ (${deposit.toFixed(2)}) ห้ามมากกว่ายอดรวม (${total.toFixed(2)})`,
      );
    }
  }

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
      select: { status: true, branchId: true, ...TEST_SIDE_PRODUCT_SELECT },
    });
    if (!product) throw new NotFoundException('ไม่พบเครื่องที่เลือก');
    if (product.branchId !== branchId) throw new BadRequestException('เครื่องที่เลือกอยู่คนละสาขากับใบจอง');
    if (product.status !== 'IN_STOCK') throw new BadRequestException('เครื่องนี้ไม่พร้อมขาย กรุณาเลือกเครื่องอื่น');
    assertSameTestSide(customer, product);
    return product;
  }

  private async resolveExpireDate(dto: { expireDate?: string }): Promise<Date> {
    if (dto.expireDate) {
      const d = new Date(dto.expireDate);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('expireDate ไม่ใช่วันที่');
      }
      if (d.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        throw new BadRequestException('expireDate ต้องไม่เลยมาแล้วเกิน 1 วัน');
      }
      return d;
    }
    const days = await readNumberFlag(this.prisma, BOOKING_EXPIRE_DAYS_KEY, DEFAULT_EXPIRE_DAYS);
    const safeDays = days > 0 && days <= 365 ? days : DEFAULT_EXPIRE_DAYS;
    const expire = new Date();
    expire.setDate(expire.getDate() + safeDays);
    return expire;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Write
  // ───────────────────────────────────────────────────────────────────────

  async create(dto: CreateBookingDto, createdById: string, user: RequestUser) {
    this.assertCanWriteBranch(user, dto.branchId);

    const [customer, branch] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        // PLACEHOLDER_FIELDS_SELECT — ด่านเบอร์แยกข้อความผู้สนใจ/ลูกค้าทั่วไป (A12)
        select: { ...TEST_SIDE_CUSTOMER_SELECT, ...PLACEHOLDER_FIELDS_SELECT },
      }),
      this.prisma.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    if (!branch) throw new NotFoundException('ไม่พบสาขา');
    assertCustomerHasPhone(customer, 'จองสินค้า');

    const productId = this.assertSingleDeviceItem(dto.items);
    await this.loadBookableProduct(productId, dto.branchId, customer);

    const total = this.computeTotal(dto.items);
    const deposit = new Prisma.Decimal(dto.depositAmount);
    this.assertDepositInRange(deposit, total);

    const expireDate = await this.resolveExpireDate(dto);

    return this.prisma.$transaction(async (tx) => {
      const bookingNumber = await generateBookingNumber(
        tx as unknown as Parameters<typeof generateBookingNumber>[0],
      );

      const booking = await tx.booking.create({
        data: {
          bookingNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          status: 'PENDING_DEPOSIT',
          depositAmount: deposit,
          totalAmount: total,
          expireDate,
          notes: dto.notes,
          createdById,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              amount: this.computeItemAmount(item.quantity, item.unitPrice),
            })),
          },
        },
        include: BOOKING_DEFAULT_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_CREATED',
          entity: 'booking',
          entityId: booking.id,
          userId: createdById,
          newValue: {
            bookingNumber: booking.bookingNumber,
            status: booking.status,
            depositAmount: booking.depositAmount.toFixed(2),
            totalAmount: booking.totalAmount.toFixed(2),
            expireDate: booking.expireDate.toISOString(),
            branchId: booking.branchId,
          },
        },
      });

      return booking;
    });
  }

  /** เทียบค่าที่ส่งมาแก้กับค่าเดิม — คืนเฉพาะช่องที่ต่างจริง พร้อมค่าเดิม→ใหม่ของช่องนั้น */
  private diffBookingUpdate(
    dto: UpdateBookingDto,
    existing: {
      customerId: string;
      branchId: string;
      notes: string | null;
      expireDate: Date;
      depositAmount: Prisma.Decimal | number | string;
      items?: { productId: string | null; description: string | null; quantity: number; unitPrice: Prisma.Decimal | number | string }[];
    },
    nextDeposit: Prisma.Decimal,
  ) {
    const changed: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const mark = (key: string, oldV: unknown, newV: unknown) => {
      changed.push(key);
      before[key] = oldV;
      after[key] = newV;
    };
    if (dto.customerId !== undefined && dto.customerId !== existing.customerId) {
      mark('customerId', existing.customerId, dto.customerId);
    }
    if (dto.branchId !== undefined && dto.branchId !== existing.branchId) {
      mark('branchId', existing.branchId, dto.branchId);
    }
    if (dto.notes !== undefined && (dto.notes ?? '') !== (existing.notes ?? '')) {
      mark('notes', existing.notes ?? null, dto.notes);
    }
    if (dto.expireDate !== undefined) {
      const next = new Date(dto.expireDate);
      if (next.getTime() !== existing.expireDate.getTime()) {
        mark('expireDate', existing.expireDate.toISOString(), next.toISOString());
      }
    }
    if (dto.depositAmount !== undefined && !nextDeposit.equals(new Prisma.Decimal(existing.depositAmount))) {
      mark('depositAmount', new Prisma.Decimal(existing.depositAmount).toFixed(2), nextDeposit.toFixed(2));
    }
    if (dto.items !== undefined) {
      const [oldItem] = existing.items ?? [];
      const [newItem] = dto.items;
      const same =
        (existing.items?.length ?? 0) === dto.items.length &&
        oldItem?.productId === newItem?.productId &&
        oldItem !== undefined &&
        newItem !== undefined &&
        new Prisma.Decimal(oldItem.unitPrice).equals(new Prisma.Decimal(newItem.unitPrice)) &&
        oldItem.quantity === newItem.quantity &&
        (oldItem.description ?? '') === (newItem.description ?? '');
      if (!same) {
        mark(
          'items',
          oldItem ? { productId: oldItem.productId, unitPrice: new Prisma.Decimal(oldItem.unitPrice).toFixed(2) } : null,
          newItem ? { productId: newItem.productId, unitPrice: new Prisma.Decimal(newItem.unitPrice).toFixed(2) } : null,
        );
      }
    }
    return { changed, before, after };
  }

  async update(id: string, dto: UpdateBookingDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBooking(tx, id);
      const existing = await this.loadBookingScoped(id, user, {
        id: true,
        status: true,
        branchId: true,
        customerId: true,
        notes: true,
        items: { select: { productId: true, description: true, quantity: true, unitPrice: true } },
        totalAmount: true,
        depositAmount: true,
        expireDate: true,
      }, tx);
      if (!existing) throw new NotFoundException('ไม่พบใบจอง');
      if (existing.status !== 'PENDING_DEPOSIT' && existing.status !== 'PAID') {
        throw new BadRequestException(
          `แก้ไขใบจองได้เฉพาะสถานะ PENDING_DEPOSIT หรือ PAID (สถานะปัจจุบัน: ${existing.status})`,
        );
      }
      this.assertNotExpired(existing.expireDate);
      const financialEdit = dto.customerId !== undefined || dto.branchId !== undefined ||
        dto.items !== undefined || dto.depositAmount !== undefined;
      if (existing.status === 'PAID' && financialEdit) {
        throw new BadRequestException('รับมัดจำแล้ว ไม่สามารถแก้ลูกค้า สาขา สินค้า หรือยอดเงินในใบจองนี้');
      }
      if (dto.branchId) this.assertCanWriteBranch(user, dto.branchId);
      // เครื่องที่ต้องตรวจซ้ำ: รายการใหม่ (ถ้าส่งมา) ไม่งั้นเครื่องเดิมของใบ เมื่อแก้สาขา/ลูกค้า
      const productIdToCheck = dto.items
        ? this.assertSingleDeviceItem(dto.items)
        : dto.branchId || dto.customerId
          ? existing.items?.find((i) => i.productId)?.productId
          : undefined;
      if (productIdToCheck) {
        const owner = await tx.customer.findFirst({
          where: { id: dto.customerId ?? existing.customerId, deletedAt: null },
          select: TEST_SIDE_CUSTOMER_SELECT,
        });
        if (!owner) throw new NotFoundException('ไม่พบลูกค้า');
        await this.loadBookableProduct(productIdToCheck, dto.branchId ?? existing.branchId, owner, tx);
      }
      if (dto.customerId) {
        // เปลี่ยนเจ้าของใบจอง = จองให้คนใหม่ ⇒ ด่านเบอร์เดียวกับตอนสร้าง (spec 2026-09-13-chat-prospects)
        const nextCustomer = await tx.customer.findFirst({
          where: { id: dto.customerId, deletedAt: null },
          select: PLACEHOLDER_FIELDS_SELECT,
        });
        if (!nextCustomer) throw new NotFoundException('ไม่พบลูกค้า');
        assertCustomerHasPhone(nextCustomer, 'จองสินค้า');
      }

      const updates: Prisma.BookingUpdateInput = {};
      const nextDeposit = new Prisma.Decimal(dto.depositAmount ?? existing.depositAmount);
      const nextTotal = dto.items ? this.computeTotal(dto.items) : new Prisma.Decimal(existing.totalAmount);
      if (financialEdit) this.assertDepositInRange(nextDeposit, nextTotal);

      if (dto.customerId) updates.customer = { connect: { id: dto.customerId } };
      if (dto.branchId) updates.branch = { connect: { id: dto.branchId } };
      if (dto.notes !== undefined) updates.notes = dto.notes;
      if (dto.expireDate) {
        const d = new Date(dto.expireDate);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('expireDate ไม่ใช่วันที่');
        this.assertNotExpired(d);
        updates.expireDate = d;
      }

      if (dto.items) {
        updates.totalAmount = nextTotal;

        await tx.bookingItem.deleteMany({ where: { bookingId: id } });
        updates.items = {
          create: dto.items.map((item) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            amount: this.computeItemAmount(item.quantity, item.unitPrice),
          })),
        };
      }

      if (dto.depositAmount !== undefined) {
        updates.depositAmount = nextDeposit;
      }

      const updated = await tx.booking.update({
        where: { id },
        data: updates,
        include: BOOKING_DEFAULT_INCLUDE,
      });
      // audit เฉพาะช่องที่เปลี่ยนจริง (เทียบค่าใหม่กับค่าเดิม) — ฟอร์มส่งทุกช่องมาทุกครั้ง การนับตาม key ที่ส่งจะโกหกไทม์ไลน์
      const { changed, before, after } = this.diffBookingUpdate(dto, existing, nextDeposit);
      if (changed.length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'BOOKING_UPDATED',
            entity: 'booking',
            entityId: id,
            userId: user.id,
            oldValue: { status: existing.status, ...before },
            newValue: {
              changed,
              ...after,
              expireDate: updated.expireDate.toISOString(),
              depositAmount: updated.depositAmount.toFixed(2),
              totalAmount: updated.totalAmount.toFixed(2),
            },
          },
        });
      }
      return updated;
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lifecycle transitions
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Record the deposit receipt and flip the booking PENDING_DEPOSIT → PAID.
   *
   * Race-safe via composite-where updateMany — two concurrent payDeposit
   * calls cannot both succeed. Status is filtered on PENDING_DEPOSIT inside
   * the same $transaction that writes deposit metadata.
   */
  private assertNotExpired(expireDate: Date | null | undefined, now = new Date()): void {
    if (expireDate && expireDate.getTime() <= now.getTime()) {
      throw new BadRequestException('ใบจองหมดอายุแล้ว กรุณาโหลดสถานะล่าสุดหรือออกใบจองใหม่');
    }
  }

  private assertReceiptMethod(method: string): void {
    if (!(BOOKING_PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException('กรุณาเลือกวิธีรับเงินสด โอนธนาคาร หรือ QR / e-Wallet');
    }
  }

  async payDeposit(id: string, dto: PayDepositDto, user: RequestUser) {
    try {
      return await this.payDepositInTx(id, dto, user);
    } catch (err) {
      // ตาข่าย: unique index bookings_locked_product_active_unique (ใบอื่นที่ยังเปิดอยู่ล็อกเครื่องเดียวกัน
      // ด้วยช่องทางที่ไม่ผ่าน CAS เช่นข้อมูลแก้มือ) → ข้อความเดียวกับ CAS แพ้
      if (isLockedProductUniqueViolation(err)) {
        throw new ConflictException(LOCK_FAILED_MSG);
      }
      throw err;
    }
  }

  private async payDepositInTx(id: string, dto: PayDepositDto, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBooking(tx, id);
      const booking = await this.loadBookingScoped(id, user, {
        id: true,
        status: true,
        branchId: true,
        expireDate: true,
        // A5 — ต้องใช้ลงบัญชีเงินมัดจำตอนรับเงิน
        depositAmount: true,
        bookingNumber: true,
        // ด่านเครื่อง ณ ตอนรับเงิน — เครื่องอาจถูกขาย/ย้ายสาขา/จองไปหลังออกใบจอง
        customerId: true,
        items: { select: { productId: true } },
      }, tx);
      if (!booking) throw new NotFoundException('ไม่พบใบจอง');
      if (booking.status !== 'PENDING_DEPOSIT') {
        throw new BadRequestException(
          `บันทึกชำระมัดจำได้เฉพาะสถานะ PENDING_DEPOSIT (สถานะปัจจุบัน: ${booking.status})`,
        );
      }
      const now = new Date();
      this.assertNotExpired(booking.expireDate, now);
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
      // ช่องรับเงินมัดจำ: จ่ายผสมได้ โอน/QR บังคับเลขอ้างอิง — tender แรก = primary ที่ JE มัดจำลงเต็มยอด
      const depositTenders = normalizeTenders(dto.tenders, (booking.depositAmount ?? 0).toString(), { method: dto.depositMethod });
      const depositMethod = (depositTenders[0]?.method ?? dto.depositMethod) as DepositMethod;
      this.assertReceiptMethod(depositMethod);
      const cashAccountCode = await this.shopAccountResolver.resolveInflowCashAccount(
        booking.branchId, depositMethod, tx,
      );
      if (dto.depositAccountCode && dto.depositAccountCode !== cashAccountCode) {
        throw new BadRequestException(`บัญชีรับเงินไม่ตรงกับสาขาและวิธีรับเงิน บัญชีที่ใช้คือ ${cashAccountCode}`);
      }
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

      // Receipt metadata and journal use the same resolved SHOP account.
      const deposit = new Prisma.Decimal((booking.depositAmount ?? 0).toString());
      if (deposit.gt(0)) {
        await this.shopBookingDepositTemplate.execute(
          {
            idempotencyKey: `booking-deposit:${id}`,
            bookingId: id,
            bookingNumber: booking.bookingNumber ?? undefined,
            cashAccountCode,
            depositAmount: deposit,
            postedAt: now,
          },
          tx,
        );
        // สมุดเงินหน้าร้าน + JE แยกยอดของมัดจำจ่ายผสม (ผู้รับ = ผู้กดรับมัดจำ)
        await new ShopTenderRecorder(this.prisma, { accounts: this.shopAccountResolver }).recordInflow(tx, { kind: 'BOOKING_DEPOSIT', branchId: booking.branchId,
          actorId: user.id, doc: { bookingId: id }, docNumber: booking.bookingNumber, tenders: depositTenders, occurredAt: now });
      }

      const updated = await tx.booking.findFirst({
        where: { id },
        include: BOOKING_DEFAULT_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_DEPOSIT_PAID',
          entity: 'booking',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'PENDING_DEPOSIT' },
          newValue: {
            status: 'PAID',
            // วิธีที่ resolve แล้ว (tender แรกเมื่อจ่ายผสม) ไม่ใช่ค่าที่ client ส่งมาดิบ ๆ
            depositMethod,
            depositAmount: deposit.toFixed(2),
            depositAccountCode: cashAccountCode,
            notes: dto.notes ?? null,
            lockedProductId: bookedProductId,
          },
        },
      });

      return updated;
    });
  }

  /**
   * Manual cancel — only callable for PENDING_DEPOSIT or PAID bookings, and
   * only when expireDate hasn't passed. Expired bookings are handled by the
   * autoExpire cron path which marks them EXPIRED (forfeit), not CANCELED.
   *
   * Refund policy:
   *   - cancel BEFORE expire → 100% refund of depositAmount (deposit was held
   *     by the SHOP; cancellation simply doesn't book the income)
   *   - cancel AFTER expire  → blocked here (use autoExpire instead)
   */
  async cancel(id: string, dto: CancelBookingDto, user: RequestUser) {
    const { updated, unlock, lockedProductIdBefore } = await this.prisma.$transaction(async (tx) => {
      await this.lockBooking(tx, id);
      const booking = await this.loadBookingScoped(id, user, {
        id: true,
        status: true,
        branchId: true,
        expireDate: true,
        depositAmount: true,
        depositPaidAt: true,
        // A5 — ต้องใช้ลงบัญชีคืนเงินมัดจำ
        depositMethod: true,
        bookingNumber: true,
        lockedProductId: true,
      }, tx);
      if (!booking) throw new NotFoundException('ไม่พบใบจอง');
      if (booking.status !== 'PENDING_DEPOSIT' && booking.status !== 'PAID') {
        throw new BadRequestException(
          `ยกเลิกใบจองได้เฉพาะสถานะ PENDING_DEPOSIT หรือ PAID (สถานะปัจจุบัน: ${booking.status})`,
        );
      }
      this.assertNotExpired(booking.expireDate);

      const fromStatus = booking.status;
      const now = new Date();

      const claim = await tx.booking.updateMany({
        where: {
          id,
          deletedAt: null,
          status: { in: ['PENDING_DEPOSIT', 'PAID'] },
        },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
          canceledById: user.id,
          cancelReason: dto.cancelReason,
          lockedProductId: null,
          unlockedAt: now,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('ใบจองนี้ถูกเปลี่ยนสถานะไปแล้ว');
      }

      // ปลดล็อกเครื่อง (PR 2) — อ่านค่าก่อนล้างจาก booking ที่โหลดไว้ก่อน claim
      const lockedProductIdBefore = booking.lockedProductId ?? null;
      const unlock = await this.unlockBookedDevice(tx, {
        id, lockedProductId: lockedProductIdBefore, bookingNumber: booking.bookingNumber ?? null,
      }, user.id, now);

      // ── คืนเงินมัดจำ (A5 ผู้สอบ 2026-08-25) ─────────────────────────────────
      // โพสต์เฉพาะใบที่ "รับมัดจำแล้วจริง" — PENDING_DEPOSIT ยังไม่มีเงินเข้า
      // จึงไม่มีอะไรให้คืน · template ข้ามเองถ้าไม่มี JE ตั้งหนี้ (ยุคก่อนฟีเจอร์)
      const refundAmount = new Prisma.Decimal((booking.depositAmount ?? 0).toString());
      if (fromStatus === 'PAID' && refundAmount.gt(0)) {
        const refundCashAccount = await this.shopAccountResolver.resolveInflowCashAccount(
          booking.branchId,
          (booking.depositMethod ?? 'CASH') as Parameters<
            typeof this.shopAccountResolver.resolveInflowCashAccount
          >[1],
          tx,
        );
        await this.shopBookingRefundTemplate.execute(
          {
            idempotencyKey: `booking-refund:${id}`,
            bookingId: id,
            bookingNumber: booking.bookingNumber ?? undefined,
            cashAccountCode: refundCashAccount,
            depositAmount: refundAmount,
            cancelReason: dto.cancelReason,
          },
          tx,
        );
        // คืนเงินตามวิธีที่รับมา: refund ข้างบนคืนเต็มยอดเข้าบัญชี primary (depositMethod) — มัดจำจ่ายผสม
        // ต้อง mirror JE แยกยอดด้วย ไม่งั้นบัญชี primary ติดลบเท่าส่วนของวิธีอื่น · แถว OUT = ผู้กดยกเลิก
        await new ShopTenderRecorder(this.prisma).recordRefund(tx, { doc: { bookingId: id }, kinds: ['BOOKING_DEPOSIT'],
          actorId: user.id, reverseSplitJe: true, descriptionPrefix: '[ยกเลิกใบจอง]' });
      }

      const updated = await tx.booking.findFirst({
        where: { id },
        include: BOOKING_DEFAULT_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_CANCELED',
          entity: 'booking',
          entityId: id,
          userId: user.id,
          oldValue: { status: fromStatus },
          newValue: {
            status: 'CANCELED',
            refundAmount:
              fromStatus === 'PAID' ? booking.depositAmount.toFixed(2) : '0.00',
            cancelReason: dto.cancelReason ?? null,
          },
        },
      });

      return { updated, unlock, lockedProductIdBefore };
    });
    if (unlock === 'SKIPPED') this.warnUnlockSkipped(id, lockedProductIdBefore, 'cancel');
    return updated;
  }

  /**
   * Convert a PAID booking into a CASH Sale row. Deposit transfers to
   * Sale.downPaymentAmount.
   *
   * Race protection mirrors QuotesService.convert:
   *   1. Composite-where `updateMany` flips status PAID → CONVERTED inside
   *      the transaction; only one concurrent caller wins.
   *   2. Sale row is created in the same tx — rollback on failure restores
   *      the booking atomically.
   *   3. Link-back update sets convertedToSaleId.
   */
  async convertToSale(
    id: string,
    dto: ConvertBookingDto,
    salespersonId: string,
    user: RequestUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBooking(tx, id);
      const booking = await tx.booking.findFirst({
        where: { id, deletedAt: null },
        include: { items: true, customer: { select: { ...TEST_SIDE_CUSTOMER_SELECT, ...PLACEHOLDER_FIELDS_SELECT } } },
      });
      if (!booking) throw new NotFoundException('ไม่พบใบจอง');

      this.assertCanWriteBranch(user, booking.branchId);

      if (booking.status !== 'PAID') {
        throw new BadRequestException(
          `แปลงเป็นการขายได้เฉพาะสถานะ PAID (สถานะปัจจุบัน: ${booking.status})`,
        );
      }
      this.assertNotExpired(booking.expireDate);
      if (booking.convertedToSaleId) {
        throw new ConflictException('ใบจองนี้ถูกแปลงเป็นการขายแล้ว');
      }

      const firstItem = booking.items[0];
      if (!firstItem) throw new BadRequestException('ใบจองไม่มีรายการสินค้า');
      if (!firstItem.productId) {
        throw new BadRequestException(
          'รายการแรกในใบจองไม่ได้ผูกกับสินค้าในสต็อก — กรุณาผูกสินค้าก่อนแปลง',
        );
      }
      if (booking.items.length !== 1 || firstItem.quantity !== 1) {
        throw new BadRequestException('แปลงขายได้เมื่อใบจองมีสินค้า 1 เครื่อง จำนวน 1 ชิ้น');
      }

      // C2 — guard amountReceived honesty. The cashier MUST tell us whether the
      // outstanding balance is being collected at convert time, so we don't lie
      // about cash-in on the Sale row (which feeds revenue + cash reports).
      const totalAmount = booking.totalAmount as Prisma.Decimal;
      const depositAmount = booking.depositAmount as Prisma.Decimal;
      this.assertDepositInRange(depositAmount, totalAmount);
      if (!new Prisma.Decimal(firstItem.amount).equals(totalAmount) ||
          !new Prisma.Decimal(firstItem.unitPrice).equals(totalAmount)) {
        throw new BadRequestException('ยอดรายการสินค้าไม่ตรงกับยอดใบจอง กรุณาตรวจสอบก่อนแปลงขาย');
      }
      const isFullPrepay = depositAmount.equals(totalAmount);

      if (!isFullPrepay && !dto.collectBalance) {
        throw new BadRequestException(
          `ต้องเรียกเก็บยอดส่วนต่าง ${totalAmount
            .sub(depositAmount)
            .toFixed(2)} บาท ก่อนแปลงเป็นการขาย (ส่ง collectBalance: true เมื่อรับเงินครบ)`,
        );
      }

      if (!isFullPrepay && !dto.paymentMethod && !dto.tenders?.length) {
        throw new BadRequestException('กรุณาเลือกวิธีรับยอดส่วนต่าง');
      }
      if (dto.paymentMethod) this.assertReceiptMethod(dto.paymentMethod);
      // ช่องรับเงินของส่วนที่เหลือ (จ่ายครบแล้ว = ไม่มีบรรทัด) — tender แรก = primary ที่ JE ขายลงเต็มยอด
      const balanceTenders = normalizeTenders(dto.tenders, totalAmount.sub(depositAmount).toString(), { method: dto.paymentMethod });
      const salePaymentMethod = isFullPrepay ? (booking.depositMethod ?? 'CASH') : (balanceTenders[0]?.method ?? dto.paymentMethod!);
      this.assertReceiptMethod(salePaymentMethod);

      // C1 — inline the SalesService.createCashSale invariants the original
      // tx.sale.create skipped: verifyProductInStock, Product.status flip to
      // SOLD_CASH, SalesCommission row. Doing it inline (not by calling
      // SalesService) keeps the booking module self-contained and avoids
      // accidentally inheriting CASH-sale discount / loyalty branches that
      // don't apply here.
      // 1. Claim the booking PAID → CONVERTED atomically.
      const claim = await tx.booking.updateMany({
        where: {
          id,
          deletedAt: null,
          status: 'PAID',
          convertedToSaleId: null,
        },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('ใบจองนี้ถูกแปลงเป็นการขายแล้ว');
      }

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
      // แปลงเป็นใบขาย — ด่านเบอร์เดียวกับ POS (spec 2026-09-13-chat-prospects); throw ใน tx นี้
      // ย้อน claim PAID → CONVERTED ด้านบนให้เอง และยังไม่ถึงการตัดสต็อก
      assertCustomerHasPhone(booking.customer, 'เปิดใบขาย');
      // test-data fence (spec 2026-09-05 §5.1) — ตอนแปลงเป็นใบขายคือจุดที่เครื่องพบลูกค้าจริง
      assertSameTestSide(booking.customer, product);

      const stockClaim = await tx.product.updateMany({
        where: { id: product.id, status: expectedStatus, branchId: booking.branchId, deletedAt: null },
        data: { status: 'SOLD_CASH' },
      });
      if (stockClaim.count !== 1) throw new ConflictException('สินค้าเพิ่งถูกขายหรือย้ายสาขา กรุณาตรวจสอบสต็อกอีกครั้ง');

      const saleNumber = await generateSaleNumber(
        tx as unknown as Parameters<typeof generateSaleNumber>[0],
      );

      // 3. Create the Sale row. amountReceived = depositAmount when no balance
      // collected, totalAmount when fully prepaid OR balance collected now.
      const amountReceived = isFullPrepay || dto.collectBalance ? totalAmount : depositAmount;
      const productDisclosure = captureProductDisclosure(product, await readStringFlag(tx, SHOP_WARRANTY_DAYS_CONFIG_KEY, ''));
      const soldAt = new Date();
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          productDisclosure,
          ...(productDisclosure.shopWarrantyDays > 0 ? {
            shopWarrantyStartDate: soldAt,
            shopWarrantyEndDate: addDays(soldAt, productDisclosure.shopWarrantyDays),
          } : {}),
          saleType: 'CASH',
          costSnapshot: { create: { mainProductCost: product.costPrice } },
          customerId: booking.customerId,
          productId: firstItem.productId!,
          branchId: booking.branchId,
          salespersonId,
          sellingPrice: totalAmount,
          discount: ZERO,
          netAmount: totalAmount,
          paymentMethod: salePaymentMethod,
          amountReceived,
          downPaymentAmount: depositAmount,
          notes: dto.notes || `แปลงจากใบจอง ${booking.bookingNumber}`,
        },
      });

      // 4. Flip product → SOLD_CASH (mirrors SalesService.createCashSale).
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (แปลงใบจองเป็นการขาย)
      await preemptReservationsInTx(tx, [firstItem.productId]);

      // ── ลงบัญชีการขาย + ล้างมัดจำ (A5 ผู้สอบ 2026-08-25) ────────────────────
      // เดิมเส้นทางนี้สร้าง Sale ด้วย tx.sale.create ตรง ๆ ไม่ผ่าน sale-writer
      // จึงไม่เคยโพสต์ JE เลย (ต่างจากขายสดหน้าร้านที่โพสต์ครบตั้งแต่ 2026-06-23)
      //
      // โพสต์สองใบ: (1) ใบขายตามปกติ เดบิตเงินสดเต็มยอด
      //             (2) ล้างมัดจำ Dr S21-2002 / Cr เงินสด — เพราะมัดจำเดบิตเงินสด
      //                 ไปแล้วตั้งแต่วันจอง ถ้าไม่ปรับจะนับเงินสดซ้ำ
      const saleCashAccount = await this.shopAccountResolver.resolveInflowCashAccount(
        booking.branchId,
        salePaymentMethod,
        tx,
      );
      const shopAcc = this.shopAccountResolver.resolveProductAccounts(product.category);
      await this.shopCashSaleTemplate.execute(
        {
          idempotencyKey: `shop-cash-sale:${sale.id}:${product.id}`,
          saleId: sale.id,
          saleNumber,
          productId: product.id,
          cashAccountCode: saleCashAccount,
          inventoryAccountCode: shopAcc.inventoryAccountCode,
          cogsAccountCode: shopAcc.cogsAccountCode,
          revenueAccountCode: shopAcc.revenueAccountCode,
          revenueAmount: totalAmount,
          inventoryCost: new Prisma.Decimal((product.costPrice ?? 0).toString()),
        },
        tx,
      );
      if (depositAmount.gt(0)) {
        await this.shopBookingDepositAppliedTemplate.execute(
          {
            idempotencyKey: `booking-deposit-applied:${booking.id}`,
            bookingId: booking.id,
            bookingNumber: booking.bookingNumber ?? undefined,
            saleId: sale.id,
            saleNumber,
            cashAccountCode: saleCashAccount,
            depositAmount,
          },
          tx,
        );
      }
      // สมุดเงินหน้าร้าน: นับเฉพาะเงินที่รับเพิ่มตอนแปลง (มัดจำมีแถวของตัวเองตั้งแต่วันรับ — ไม่นับซ้ำ)
      await new ShopTenderRecorder(this.prisma, { accounts: this.shopAccountResolver }).recordInflow(tx, { kind: 'CASH_SALE', branchId: booking.branchId,
        actorId: user.id, doc: { saleId: sale.id }, docNumber: saleNumber, tenders: balanceTenders });

      // 5. Auto-create sales commission (read from CommissionRule, fallback 3%).
      const nowCommission = new Date();
      const period = `${nowCommission.getFullYear()}-${String(
        nowCommission.getMonth() + 1,
      ).padStart(2, '0')}`;
      const rule = await tx.commissionRule.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const commissionRate = rule?.rate ? Number(rule.rate) : 0.03;
      const commissionAmount = totalAmount.mul(commissionRate).toDecimalPlaces(2);
      await tx.salesCommission.create({
        data: {
          salespersonId,
          // Cash sale has no contract — snapshot earner = current earner.
          snapshotSalespersonId: salespersonId,
          saleId: sale.id,
          period,
          saleAmount: totalAmount,
          commissionRate,
          commissionAmount,
          status: 'PENDING',
        },
      });

      // 6. Link booking → sale (FK on Booking side).
      await tx.booking.update({
        where: { id },
        data: { convertedToSaleId: sale.id, lockedProductId: null, unlockedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_CONVERTED',
          entity: 'booking',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'PAID' },
          newValue: {
            status: 'CONVERTED',
            saleId: sale.id,
            saleNumber: sale.saleNumber,
            depositTransferred: depositAmount.toFixed(2),
            amountReceived: amountReceived.toFixed(2),
            balanceCollectedAtConvert: !isFullPrepay && !!dto.collectBalance,
            lockedProductId: booking.lockedProductId ?? null,
          },
        },
      });

      return { sale, bookingId: id };
    });
  }

  async remove(id: string, user: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBooking(tx, id);
      const booking = await this.loadBookingScoped(id, user, {
        id: true,
        status: true,
        branchId: true,
      }, tx);
      if (!booking) throw new NotFoundException('ไม่พบใบจอง');
      if (booking.status !== 'PENDING_DEPOSIT') {
        throw new BadRequestException(
          `ลบใบจองได้เฉพาะสถานะ PENDING_DEPOSIT (สถานะปัจจุบัน: ${booking.status})`,
        );
      }
      const deletedAt = new Date();
      await tx.booking.update({
        where: { id },
        data: { deletedAt },
      });
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_DELETED',
          entity: 'booking',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'PENDING_DEPOSIT' },
          newValue: { deletedAt: deletedAt.toISOString() },
        },
      });
      return { id, deletedAt };
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cron: auto-expire unpaid and PAID bookings whose expireDate has passed
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Resolve the admin/system user for cron-triggered audit log writes. Cached
   * across calls. AuditLog.userId is NOT NULL string — we route system actions
   * to the OWNER admin account (matches journal-auto.service pattern).
   */
  private systemUserId: string | null = null;
  private async resolveSystemUserId(): Promise<string> {
    if (this.systemUserId) return this.systemUserId;
    const user = await this.prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      // Fall back to ANY OWNER if the seeded admin email isn't present
      // (e.g. fresh dev env or renamed admin).
      const owner = await this.prisma.user.findFirst({
        where: { role: 'OWNER', deletedAt: null },
        select: { id: true },
      });
      if (!owner) {
        throw new Error('No system OWNER user found for autoExpire audit log');
      }
      this.systemUserId = owner.id;
      return owner.id;
    }
    this.systemUserId = user.id;
    return user.id;
  }

  /**
   * Mark unpaid and PAID bookings as EXPIRED (forfeit only received deposits) once `expireDate` has passed.
   * Returns the number of rows flipped. Each transition writes an audit log
   * `BOOKING_AUTO_EXPIRED`. Called by `BookingExpireCron` daily at 00:30 BKK.
   */
  async autoExpire(now: Date = new Date()): Promise<number> {
    let flipped = 0;
    let afterId: string | undefined;
    for (;;) {
      const candidates = await this.prisma.booking.findMany({
        where: {
          status: { in: ['PENDING_DEPOSIT', 'PAID'] },
          expireDate: { lte: now }, deletedAt: null,
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        select: { id: true }, orderBy: { id: 'asc' }, take: 500,
      });
      if (candidates.length === 0) break;
      const systemUserId = await this.resolveSystemUserId();
      for (const candidate of candidates) {
        // Per-row composite-where update so one stale candidate doesn't roll
        // back the whole batch. Each succeeds-or-skips atomically.
        try {
          const result = await this.prisma.$transaction(async (tx) => {
            await this.lockBooking(tx, candidate.id);
            const booking = await tx.booking.findFirst({
              where: { id: candidate.id, deletedAt: null },
            });
            if (!booking || !['PENDING_DEPOSIT', 'PAID'].includes(booking.status) || booking.expireDate > now) return false;
            const claim = await tx.booking.updateMany({
              where: {
                id: candidate.id,
                status: booking.status,
                deletedAt: null,
                expireDate: { lte: now },
              },
              data: { status: 'EXPIRED', lockedProductId: null, unlockedAt: now },
            });
            if (claim.count !== 1) return false;

            // ปลดล็อกเครื่อง (PR 2) — ใน tx เดียวกับ EXPIRED + ริบมัดจำ
            const unlock = await this.unlockBookedDevice(tx, {
              id: candidate.id, lockedProductId: booking.lockedProductId ?? null,
              bookingNumber: booking.bookingNumber ?? null,
            }, systemUserId, now);

            // ── ริบมัดจำเข้ารายได้ (ผู้สอบอนุมัติ S41-1203 ไม่มี VAT, 2026-08-25) ──
            // Dr S21-2002 / Cr S41-1203 — ไม่แตะเงินสด เพราะเงินเข้าลิ้นชักไปแล้ว
            // ตอนวางมัดจำ · template ข้ามเองถ้าใบจองนั้นไม่มี JE ตั้งหนี้ (ยุคก่อนฟีเจอร์)
            const forfeitAmount = new Prisma.Decimal((booking.depositAmount ?? 0).toString());
            if (booking.status === 'PAID' && forfeitAmount.gt(0)) {
              await this.shopBookingForfeitTemplate.execute(
                {
                  idempotencyKey: `booking-forfeit:${candidate.id}`,
                  bookingId: candidate.id,
                  bookingNumber: booking.bookingNumber ?? undefined,
                  depositAmount: forfeitAmount,
                  postedAt: now,
                },
                tx,
              );
            }

            await tx.auditLog.create({
              data: {
                action: 'BOOKING_AUTO_EXPIRED',
                entity: 'booking',
                entityId: candidate.id,
                userId: systemUserId,
                oldValue: { status: booking.status },
                newValue: {
                  status: 'EXPIRED',
                  forfeitAmount: booking.status === 'PAID' ? forfeitAmount.toFixed(2) : '0.00',
                  bookingNumber: booking.bookingNumber,
                  unlockedProductId: unlock === 'UNLOCKED' ? booking.lockedProductId : null,
                },
              },
            });
            return { didExpire: true as const, unlock, lockedProductId: booking.lockedProductId ?? null };
          });
          if (result) {
            flipped += 1;
            if (result.unlock === 'SKIPPED') {
              this.warnUnlockSkipped(candidate.id, result.lockedProductId, 'auto-expire');
            }
          }
        } catch (err) {
          this.logger.error(
            `autoExpire failed for booking ${candidate.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          // C5 — per-row Sentry capture so one bad candidate doesn't disappear
          // into the log noise. Cron-level Sentry only fires on an overall throw,
          // and the per-row try/catch above swallows individual failures.
          Sentry.captureException(err, {
            tags: { module: 'booking-expire', bookingId: candidate.id },
          });
        }
      }
      afterId = candidates[candidates.length - 1].id;
      if (candidates.length < 500) break;
    }
    return flipped;
  }
}
