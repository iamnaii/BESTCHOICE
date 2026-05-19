import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import { generateBookingNumber, generateSaleNumber } from '../../utils/sequence.util';
import { readNumberFlag } from '../../utils/config.util';
import { getBranchScope, hasCrossBranchAccess } from '../auth/branch-access.util';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PayDepositDto } from './dto/pay-deposit.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { ConvertBookingDto } from './dto/convert-booking.dto';

type RequestUser = { id: string; role: string; branchId?: string | null };

const BOOKING_DEFAULT_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      addressCurrent: true,
      addressIdCard: true,
    },
  },
  branch: { select: { id: true, name: true, companyId: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  canceledBy: { select: { id: true, name: true } },
  convertedToSale: { select: { id: true, saleNumber: true, saleType: true } },
} as const;

const ZERO = new Prisma.Decimal(0);

const DEFAULT_EXPIRE_DAYS = 7;
const BOOKING_EXPIRE_DAYS_KEY = 'booking_expire_days';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(private prisma: PrismaService) {}

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

  async findAll(
    opts: {
      page?: number;
      limit?: number;
      status?: string;
      branchId?: string;
      search?: string;
      customerId?: string;
      from?: string;
      to?: string;
    },
    user: RequestUser,
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;

    const baseWhere: Prisma.BookingWhereInput = { deletedAt: null };
    if (opts.status) baseWhere.status = opts.status as Prisma.BookingWhereInput['status'];
    if (opts.customerId) baseWhere.customerId = opts.customerId;
    if (opts.search) {
      baseWhere.OR = [
        { bookingNumber: { contains: opts.search, mode: 'insensitive' } },
        { customer: { name: { contains: opts.search, mode: 'insensitive' } } },
      ];
    }
    if (opts.from || opts.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (opts.from) {
        const f = new Date(opts.from);
        if (!Number.isNaN(f.getTime())) createdAt.gte = f;
      }
      if (opts.to) {
        const t = new Date(opts.to);
        if (!Number.isNaN(t.getTime())) createdAt.lte = t;
      }
      if (createdAt.gte || createdAt.lte) baseWhere.createdAt = createdAt;
    }

    const { where, empty } = this.applyBranchScope(baseWhere, user, opts.branchId);
    if (empty) return { data: [], total: 0, page, limit };

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_DEFAULT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { data, total, page, limit };
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
    return booking;
  }

  private async loadBookingScoped(
    id: string,
    user: RequestUser,
    select?: Prisma.BookingSelect,
  ) {
    const baseWhere: Prisma.BookingWhereInput = { id, deletedAt: null };
    const { where, empty } = this.applyBranchScope(baseWhere, user);
    if (empty) throw new NotFoundException('ไม่พบใบจอง');
    return this.prisma.booking.findFirst({
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
        select: { id: true },
      }),
      this.prisma.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    if (!branch) throw new NotFoundException('ไม่พบสาขา');

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

  async update(id: string, dto: UpdateBookingDto, user: RequestUser) {
    const existing = await this.loadBookingScoped(id, user, {
      id: true,
      status: true,
      branchId: true,
      totalAmount: true,
    });
    if (!existing) throw new NotFoundException('ไม่พบใบจอง');
    if (existing.status !== 'PENDING_DEPOSIT' && existing.status !== 'PAID') {
      throw new BadRequestException(
        `แก้ไขใบจองได้เฉพาะสถานะ PENDING_DEPOSIT หรือ PAID (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    if (dto.branchId) this.assertCanWriteBranch(user, dto.branchId);

    return this.prisma.$transaction(async (tx) => {
      const updates: Prisma.BookingUpdateInput = {};

      if (dto.customerId) updates.customer = { connect: { id: dto.customerId } };
      if (dto.branchId) updates.branch = { connect: { id: dto.branchId } };
      if (dto.notes !== undefined) updates.notes = dto.notes;
      if (dto.expireDate) {
        const d = new Date(dto.expireDate);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('expireDate ไม่ใช่วันที่');
        updates.expireDate = d;
      }

      let total: Prisma.Decimal | null = null;
      if (dto.items) {
        total = this.computeTotal(dto.items);
        updates.totalAmount = total;

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
        const deposit = new Prisma.Decimal(dto.depositAmount);
        const compareTotal = total ?? (existing.totalAmount as Prisma.Decimal);
        this.assertDepositInRange(deposit, compareTotal);
        updates.depositAmount = deposit;
      }

      return tx.booking.update({
        where: { id },
        data: updates,
        include: BOOKING_DEFAULT_INCLUDE,
      });
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
  async payDeposit(id: string, dto: PayDepositDto, user: RequestUser) {
    const booking = await this.loadBookingScoped(id, user, {
      id: true,
      status: true,
      branchId: true,
      expireDate: true,
    });
    if (!booking) throw new NotFoundException('ไม่พบใบจอง');
    if (booking.status !== 'PENDING_DEPOSIT') {
      throw new BadRequestException(
        `บันทึกชำระมัดจำได้เฉพาะสถานะ PENDING_DEPOSIT (สถานะปัจจุบัน: ${booking.status})`,
      );
    }
    if (booking.expireDate && booking.expireDate.getTime() < Date.now()) {
      throw new BadRequestException(
        'ใบจองหมดอายุแล้ว — ไม่สามารถบันทึกมัดจำได้ กรุณาออกใบจองใหม่',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // C6 — expireDate enforced atomically in the updateMany filter so the
      // expire-cron can't flip status between the read above and this write.
      const now = new Date();
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
          depositMethod: dto.depositMethod,
          depositAccountCode: dto.depositAccountCode,
          depositReceivedById: user.id,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('ใบจองนี้หมดอายุ ถูกบันทึกมัดจำ หรือเปลี่ยนสถานะไปแล้ว');
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
            depositMethod: dto.depositMethod,
            depositAccountCode: dto.depositAccountCode,
            notes: dto.notes ?? null,
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
    const booking = await this.loadBookingScoped(id, user, {
      id: true,
      status: true,
      branchId: true,
      expireDate: true,
      depositAmount: true,
      depositPaidAt: true,
    });
    if (!booking) throw new NotFoundException('ไม่พบใบจอง');
    if (booking.status !== 'PENDING_DEPOSIT' && booking.status !== 'PAID') {
      throw new BadRequestException(
        `ยกเลิกใบจองได้เฉพาะสถานะ PENDING_DEPOSIT หรือ PAID (สถานะปัจจุบัน: ${booking.status})`,
      );
    }
    if (booking.expireDate && booking.expireDate.getTime() < Date.now()) {
      throw new BadRequestException(
        'ใบจองหมดอายุแล้ว — กรุณารอ cron บันทึกสถานะ EXPIRED (ลูกค้าเสียมัดจำ)',
      );
    }

    const fromStatus = booking.status;

    return this.prisma.$transaction(async (tx) => {
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
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('ใบจองนี้ถูกเปลี่ยนสถานะไปแล้ว');
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

      return updated;
    });
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
    const booking = await this.prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!booking) throw new NotFoundException('ไม่พบใบจอง');

    this.assertCanWriteBranch(user, booking.branchId);

    if (booking.status !== 'PAID') {
      throw new BadRequestException(
        `แปลงเป็นการขายได้เฉพาะสถานะ PAID (สถานะปัจจุบัน: ${booking.status})`,
      );
    }
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

    // C2 — guard amountReceived honesty. The cashier MUST tell us whether the
    // outstanding balance is being collected at convert time, so we don't lie
    // about cash-in on the Sale row (which feeds revenue + cash reports).
    const totalAmount = booking.totalAmount as Prisma.Decimal;
    const depositAmount = booking.depositAmount as Prisma.Decimal;
    const isFullPrepay = depositAmount.equals(totalAmount);

    if (!isFullPrepay && !dto.collectBalance) {
      throw new BadRequestException(
        `ต้องเรียกเก็บยอดส่วนต่าง ${totalAmount
          .sub(depositAmount)
          .toFixed(2)} บาท ก่อนแปลงเป็นการขาย (ส่ง collectBalance: true เมื่อรับเงินครบ)`,
      );
    }

    // C1 — inline the SalesService.createCashSale invariants the original
    // tx.sale.create skipped: verifyProductInStock, Product.status flip to
    // SOLD_CASH, SalesCommission row. Doing it inline (not by calling
    // SalesService) keeps the booking module self-contained and avoids
    // accidentally inheriting CASH-sale discount / loyalty branches that
    // don't apply here.
    return this.prisma.$transaction(async (tx) => {
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

      // 2. Verify the product is still IN_STOCK (race vs another POS sale).
      const product = await tx.product.findUnique({
        where: { id: firstItem.productId! },
      });
      if (!product || product.deletedAt || product.status !== 'IN_STOCK') {
        throw new BadRequestException(
          'สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว — กรุณาตรวจสอบสต็อก',
        );
      }

      const saleNumber = await generateSaleNumber(
        tx as unknown as Parameters<typeof generateSaleNumber>[0],
      );

      // 3. Create the Sale row. amountReceived = depositAmount when no balance
      // collected, totalAmount when fully prepaid OR balance collected now.
      const amountReceived = isFullPrepay || dto.collectBalance ? totalAmount : depositAmount;
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'CASH',
          customerId: booking.customerId,
          productId: firstItem.productId!,
          branchId: booking.branchId,
          salespersonId,
          sellingPrice: totalAmount,
          discount: ZERO,
          netAmount: totalAmount,
          paymentMethod:
            (dto.paymentMethod as Prisma.SaleCreateInput['paymentMethod']) ||
            booking.depositMethod ||
            null,
          amountReceived,
          downPaymentAmount: depositAmount,
          notes: dto.notes || `แปลงจากใบจอง ${booking.bookingNumber}`,
        },
      });

      // 4. Flip product → SOLD_CASH (mirrors SalesService.createCashSale).
      await tx.product.update({
        where: { id: firstItem.productId! },
        data: { status: 'SOLD_CASH' },
      });

      // 5. Auto-create sales commission (read from CommissionRule, fallback 3%).
      const nowCommission = new Date();
      const period = `${nowCommission.getFullYear()}-${String(
        nowCommission.getMonth() + 1,
      ).padStart(2, '0')}`;
      const rule = await tx.commissionRule.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'desc' },
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
        data: { convertedToSaleId: sale.id },
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
          },
        },
      });

      return { sale, bookingId: id };
    });
  }

  async remove(id: string, user: RequestUser) {
    const booking = await this.loadBookingScoped(id, user, {
      id: true,
      status: true,
      branchId: true,
    });
    if (!booking) throw new NotFoundException('ไม่พบใบจอง');
    if (booking.status !== 'PENDING_DEPOSIT') {
      throw new BadRequestException(
        `ลบใบจองได้เฉพาะสถานะ PENDING_DEPOSIT (สถานะปัจจุบัน: ${booking.status})`,
      );
    }
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
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
    });
    return { id, deletedAt };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cron: auto-expire PAID bookings whose expireDate has passed
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
   * Mark PAID bookings as EXPIRED (forfeit) once `expireDate` has passed.
   * Returns the number of rows flipped. Each transition writes an audit log
   * `BOOKING_AUTO_EXPIRED`. Called by `BookingExpireCron` daily at 00:30 BKK.
   */
  async autoExpire(now: Date = new Date()): Promise<number> {
    const candidates = await this.prisma.booking.findMany({
      where: {
        status: 'PAID',
        expireDate: { lt: now },
        deletedAt: null,
      },
      select: { id: true, depositAmount: true, bookingNumber: true },
      take: 500,
    });
    if (candidates.length === 0) return 0;

    const systemUserId = await this.resolveSystemUserId();

    let flipped = 0;
    for (const candidate of candidates) {
      // Per-row composite-where update so one stale candidate doesn't roll
      // back the whole batch. Each succeeds-or-skips atomically.
      try {
        await this.prisma.$transaction(async (tx) => {
          const claim = await tx.booking.updateMany({
            where: {
              id: candidate.id,
              status: 'PAID',
              deletedAt: null,
            },
            data: { status: 'EXPIRED' },
          });
          if (claim.count !== 1) return;
          await tx.auditLog.create({
            data: {
              action: 'BOOKING_AUTO_EXPIRED',
              entity: 'booking',
              entityId: candidate.id,
              userId: systemUserId,
              oldValue: { status: 'PAID' },
              newValue: {
                status: 'EXPIRED',
                forfeitAmount: candidate.depositAmount.toFixed(2),
                bookingNumber: candidate.bookingNumber,
              },
            },
          });
          flipped += 1;
        });
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
    return flipped;
  }
}
