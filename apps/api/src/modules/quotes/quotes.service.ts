import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateQuoteNumber, generateSaleNumber } from '../../utils/sequence.util';
import { getBranchScope, hasCrossBranchAccess } from '../auth/branch-access.util';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { ConvertQuoteDto } from './dto/convert-quote.dto';
import { renderQuoteHtml, QuotePdfData } from './templates/quote-pdf.template';

type RequestUser = { id: string; role: string; branchId?: string | null };

const QUOTE_DEFAULT_INCLUDE = {
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
  convertedToSale: { select: { id: true, saleNumber: true, saleType: true } },
} as const;

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(private prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────
  // Branch scoping helpers
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Apply the caller's branch scope onto a quote `where` clause and refuse
   * an explicit branch filter that the caller cannot access. Returns null
   * when the caller is branch-scoped but has no branchId — caller should
   * surface this as an empty result rather than leaking other branches'
   * data.
   */
  private applyBranchScope(
    where: Prisma.QuoteWhereInput,
    user: RequestUser,
    requestedBranchId?: string,
  ): { where: Prisma.QuoteWhereInput; empty: boolean } {
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

  /**
   * Verify branch-scoped users can only act on a target branchId they own.
   * Cross-branch roles bypass.
   */
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
    },
    user: RequestUser,
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;

    const baseWhere: Prisma.QuoteWhereInput = { deletedAt: null };
    if (opts.status) baseWhere.status = opts.status as Prisma.QuoteWhereInput['status'];
    if (opts.customerId) baseWhere.customerId = opts.customerId;
    if (opts.search) {
      baseWhere.OR = [
        { quoteNumber: { contains: opts.search, mode: 'insensitive' } },
        { customer: { name: { contains: opts.search, mode: 'insensitive' } } },
      ];
    }

    const { where, empty } = this.applyBranchScope(baseWhere, user, opts.branchId);
    if (empty) return { data: [], total: 0, page, limit };

    const [data, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: QUOTE_DEFAULT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.quote.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, user: RequestUser) {
    const baseWhere: Prisma.QuoteWhereInput = { id, deletedAt: null };
    const { where, empty } = this.applyBranchScope(baseWhere, user);
    if (empty) throw new NotFoundException('ไม่พบใบเสนอราคา');
    const quote = await this.prisma.quote.findFirst({
      where,
      include: QUOTE_DEFAULT_INCLUDE,
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    return quote;
  }

  /**
   * Internal lookup without branch scoping — used inside lifecycle methods
   * that have already verified branch access by other means (e.g. by
   * loading the quote first via findOne).
   */
  private async loadQuoteScoped(
    id: string,
    user: RequestUser,
    select?: Prisma.QuoteSelect,
  ) {
    const baseWhere: Prisma.QuoteWhereInput = { id, deletedAt: null };
    const { where, empty } = this.applyBranchScope(baseWhere, user);
    if (empty) throw new NotFoundException('ไม่พบใบเสนอราคา');
    return this.prisma.quote.findFirst({
      where,
      select: select ?? { id: true, status: true, branchId: true },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Money math (Prisma.Decimal — never Number())
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Compute subtotal + total from line items using Prisma.Decimal arithmetic.
   * `discount` + `vatAmount` come from the dto (frontend lets sales enter
   * them explicitly).
   *
   * NOTE: VAT on this DTO is informational only — BESTCHOICE SHOP is not
   * VAT-registered per project policy (see .claude/CLAUDE.md "Business
   * Model"). FINANCE flows handle VAT through their own JE templates.
   */
  private computeTotals(
    items: { quantity: number; unitPrice: number | string | Prisma.Decimal }[],
    discount: number | string | Prisma.Decimal,
    vatAmount: number | string | Prisma.Decimal,
  ): { subtotal: Prisma.Decimal; discount: Prisma.Decimal; vatAmount: Prisma.Decimal; total: Prisma.Decimal } {
    const subtotal = items.reduce<Prisma.Decimal>(
      (sum, it) => sum.add(new Prisma.Decimal(it.unitPrice).mul(it.quantity)),
      ZERO,
    );
    const discountD = new Prisma.Decimal(discount);
    const vatD = new Prisma.Decimal(vatAmount);
    const totalRaw = subtotal.sub(discountD).add(vatD);
    const total = totalRaw.isNegative() ? ZERO : totalRaw;
    return { subtotal, discount: discountD, vatAmount: vatD, total };
  }

  private computeItemAmount(quantity: number, unitPrice: number | string | Prisma.Decimal): Prisma.Decimal {
    return new Prisma.Decimal(unitPrice).mul(quantity);
  }

  private assertDiscountInRange(discount: Prisma.Decimal, subtotal: Prisma.Decimal) {
    if (discount.lessThan(0)) {
      throw new BadRequestException('ส่วนลดต้องไม่ติดลบ');
    }
    if (discount.greaterThan(subtotal)) {
      throw new BadRequestException(
        `ส่วนลด (${discount.toFixed(2)}) ห้ามมากกว่ายอดรวมก่อนหักส่วนลด (${subtotal.toFixed(2)})`,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Write
  // ───────────────────────────────────────────────────────────────────────

  async create(dto: CreateQuoteDto, createdById: string, user: RequestUser) {
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('validUntil ไม่ใช่วันที่');
    }
    if (validUntil.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      throw new BadRequestException('validUntil ต้องไม่เลยมาแล้วเกิน 1 วัน');
    }

    // Branch-scoped users can only create against their own branchId
    this.assertCanWriteBranch(user, dto.branchId);

    // Sanity-check customer + branch exist + not soft-deleted
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

    const totals = this.computeTotals(dto.items, dto.discount ?? 0, dto.vatAmount ?? 0);
    this.assertDiscountInRange(totals.discount, totals.subtotal);

    return this.prisma.$transaction(async (tx) => {
      const quoteNumber = await generateQuoteNumber(tx as unknown as Parameters<typeof generateQuoteNumber>[0]);

      const quote = await tx.quote.create({
        data: {
          quoteNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          status: 'DRAFT',
          validUntil,
          subtotal: totals.subtotal,
          discount: totals.discount,
          vatAmount: totals.vatAmount,
          total: totals.total,
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
        include: QUOTE_DEFAULT_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          action: 'QUOTE_CREATED',
          entity: 'quote',
          entityId: quote.id,
          userId: createdById,
          newValue: {
            quoteNumber: quote.quoteNumber,
            status: quote.status,
            total: quote.total.toFixed(2),
            branchId: quote.branchId,
          },
        },
      });

      return quote;
    });
  }

  async update(id: string, dto: UpdateQuoteDto, user: RequestUser) {
    const existing = await this.loadQuoteScoped(id, user, {
      id: true,
      status: true,
      branchId: true,
    });
    if (!existing) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        `แก้ไขใบเสนอราคาได้เฉพาะสถานะ DRAFT (สถานะปัจจุบัน: ${existing.status})`,
      );
    }

    // If branch is being changed, verify caller can write to the new branch too
    if (dto.branchId) {
      this.assertCanWriteBranch(user, dto.branchId);
    }

    return this.prisma.$transaction(async (tx) => {
      const updates: Prisma.QuoteUpdateInput = {};

      if (dto.customerId) updates.customer = { connect: { id: dto.customerId } };
      if (dto.branchId) updates.branch = { connect: { id: dto.branchId } };
      if (dto.validUntil) {
        const v = new Date(dto.validUntil);
        if (Number.isNaN(v.getTime())) throw new BadRequestException('validUntil ไม่ใช่วันที่');
        updates.validUntil = v;
      }
      if (dto.notes !== undefined) updates.notes = dto.notes;

      // If items changed, recompute totals + rebuild items
      if (dto.items) {
        const totals = this.computeTotals(dto.items, dto.discount ?? 0, dto.vatAmount ?? 0);
        this.assertDiscountInRange(totals.discount, totals.subtotal);

        updates.subtotal = totals.subtotal;
        updates.discount = totals.discount;
        updates.vatAmount = totals.vatAmount;
        updates.total = totals.total;

        // Delete existing items + replace
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
        updates.items = {
          create: dto.items.map((item) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            amount: this.computeItemAmount(item.quantity, item.unitPrice),
          })),
        };
      } else if (dto.discount !== undefined || dto.vatAmount !== undefined) {
        // Items unchanged but totals shifted — re-fetch items to recompute
        const items = await tx.quoteItem.findMany({
          where: { quoteId: id },
          select: { quantity: true, unitPrice: true },
        });
        const totals = this.computeTotals(items, dto.discount ?? 0, dto.vatAmount ?? 0);
        this.assertDiscountInRange(totals.discount, totals.subtotal);

        updates.subtotal = totals.subtotal;
        updates.discount = totals.discount;
        updates.vatAmount = totals.vatAmount;
        updates.total = totals.total;
      }

      return tx.quote.update({
        where: { id },
        data: updates,
        include: QUOTE_DEFAULT_INCLUDE,
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Lifecycle transitions
  // ───────────────────────────────────────────────────────────────────────

  async send(id: string, user: RequestUser) {
    const quote = await this.loadQuoteScoped(id, user, { id: true, status: true });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException(
        `ส่งใบเสนอราคาได้เฉพาะสถานะ DRAFT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date() },
        include: QUOTE_DEFAULT_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          action: 'QUOTE_SENT',
          entity: 'quote',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'DRAFT' },
          newValue: { status: 'SENT' },
        },
      });
      return updated;
    });
  }

  async accept(id: string, user: RequestUser) {
    const quote = await this.loadQuoteScoped(id, user, {
      id: true,
      status: true,
      validUntil: true,
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'SENT') {
      throw new BadRequestException(
        `ลูกค้ายอมรับใบเสนอราคาได้เฉพาะสถานะ SENT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    if (quote.validUntil!.getTime() < Date.now()) {
      throw new BadRequestException('ใบเสนอราคานี้หมดอายุแล้ว — กรุณาออกใหม่');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
        include: QUOTE_DEFAULT_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          action: 'QUOTE_ACCEPTED',
          entity: 'quote',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'SENT' },
          newValue: { status: 'ACCEPTED' },
        },
      });
      return updated;
    });
  }

  async reject(id: string, user: RequestUser) {
    const quote = await this.loadQuoteScoped(id, user, { id: true, status: true });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'SENT') {
      throw new BadRequestException(
        `ปฏิเสธใบเสนอราคาได้เฉพาะสถานะ SENT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
        include: QUOTE_DEFAULT_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          action: 'QUOTE_REJECTED',
          entity: 'quote',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'SENT' },
          newValue: { status: 'REJECTED' },
        },
      });
      return updated;
    });
  }

  /**
   * Convert an ACCEPTED quote into a CASH Sale row.
   *
   * Race + double-convert protection:
   *  1. Initial guards filter on quote.status='ACCEPTED' + convertedToSaleId IS NULL.
   *  2. Inside the $transaction we run a composite-where `updateMany` that
   *     bumps a tombstone (`convertedToSaleId` left null but `status` flipped
   *     to CONVERTED) WHERE convertedToSaleId IS NULL AND status IN
   *     ('ACCEPTED','SENT'). If `count !== 1` the other side won — throw.
   *  3. After tx.sale.create() we update the sale link with a second
   *     `updateMany` filtered on the now-CONVERTED row. This pattern lets
   *     two concurrent /convert calls race fearlessly: exactly one wins,
   *     the other gets ConflictException with no orphan Sale.
   *
   * Phase 1 scope: takes the FIRST quote item's productId (if set) and uses
   * the quote's `total` as the sellingPrice. SP6 will extend with multi-item,
   * INSTALLMENT, and EXTERNAL_FINANCE conversions.
   */
  async convert(id: string, dto: ConvertQuoteDto, salespersonId: string, user: RequestUser) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');

    // Branch enforcement — branch-scoped roles can only convert quotes for
    // their own branch. Cross-branch roles bypass.
    this.assertCanWriteBranch(user, quote.branchId);

    if (quote.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `แปลงเป็นการขายได้เฉพาะสถานะ ACCEPTED (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    if (quote.convertedToSaleId) {
      throw new ConflictException('ใบเสนอราคานี้ถูกแปลงเป็นการขายแล้ว');
    }

    const firstItem = quote.items[0];
    if (!firstItem) throw new BadRequestException('ใบเสนอราคาไม่มีรายการสินค้า');
    if (!firstItem.productId) {
      throw new BadRequestException(
        'รายการแรกในใบเสนอราคาไม่ได้ผูกกับสินค้าในสต็อก — กรุณาผูกสินค้าก่อนแปลง',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Step 1: race-safe claim — flip status to CONVERTED iff still ACCEPTED + not linked.
      // updateMany returns { count } so two concurrent callers can't both succeed.
      const claim = await tx.quote.updateMany({
        where: {
          id,
          deletedAt: null,
          status: 'ACCEPTED',
          convertedToSaleId: null,
        },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('ใบเสนอราคานี้ถูกแปลงเป็นการขายแล้ว');
      }

      // Step 2: create the Sale row. If this throws, the surrounding tx
      // rolls back the claim — quote returns to ACCEPTED + convertedToSaleId
      // still null (atomic).
      const saleNumber = await generateSaleNumber(
        tx as unknown as Parameters<typeof generateSaleNumber>[0],
      );
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'CASH',
          customerId: quote.customerId,
          productId: firstItem.productId!,
          branchId: quote.branchId,
          salespersonId,
          sellingPrice: quote.total,
          discount: quote.discount,
          netAmount: quote.total,
          paymentMethod: (dto.paymentMethod as Prisma.SaleCreateInput['paymentMethod']) || null,
          amountReceived: quote.total,
          notes: dto.notes || `แปลงจากใบเสนอราคา ${quote.quoteNumber}`,
        },
      });

      // Step 3: link the sale back to the now-CONVERTED quote.
      await tx.quote.update({
        where: { id },
        data: { convertedToSaleId: sale.id },
      });

      await tx.auditLog.create({
        data: {
          action: 'QUOTE_CONVERTED',
          entity: 'quote',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'ACCEPTED' },
          newValue: { status: 'CONVERTED', saleId: sale.id, saleNumber: sale.saleNumber },
        },
      });

      return { sale, quoteId: id };
    });
  }

  async remove(id: string, user: RequestUser) {
    const quote = await this.loadQuoteScoped(id, user, { id: true, status: true });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException(
        `ลบใบเสนอราคาได้เฉพาะสถานะ DRAFT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: { id },
        data: { deletedAt },
      });
      await tx.auditLog.create({
        data: {
          action: 'QUOTE_DELETED',
          entity: 'quote',
          entityId: id,
          userId: user.id,
          oldValue: { status: 'DRAFT' },
          newValue: { deletedAt: deletedAt.toISOString() },
        },
      });
    });
    return { id, deletedAt };
  }

  // ───────────────────────────────────────────────────────────────────────
  // PDF
  // ───────────────────────────────────────────────────────────────────────

  /** Build PDF data and render HTML (caller decides puppeteer vs raw HTML). */
  async buildPdfData(id: string, user?: RequestUser): Promise<QuotePdfData> {
    const baseWhere: Prisma.QuoteWhereInput = { id, deletedAt: null };
    if (user) {
      const { where, empty } = this.applyBranchScope(baseWhere, user);
      if (empty) throw new NotFoundException('ไม่พบใบเสนอราคา');
      Object.assign(baseWhere, where);
    }
    const quote = await this.prisma.quote.findFirst({
      where: baseWhere,
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        customer: {
          select: { id: true, name: true, phone: true, addressCurrent: true, addressIdCard: true },
        },
        branch: {
          include: { company: { select: { nameTh: true, taxId: true, address: true, phone: true } } },
        },
        createdBy: { select: { name: true } },
      },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');

    return {
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      issueDate: quote.createdAt,
      validUntil: quote.validUntil,
      companyName: quote.branch.company?.nameTh ?? quote.branch.name,
      companyTaxId: quote.branch.company?.taxId ?? null,
      companyAddress: quote.branch.company?.address ?? null,
      companyPhone: quote.branch.company?.phone ?? null,
      branchName: quote.branch.name,
      customerName: quote.customer.name,
      customerPhone: quote.customer.phone,
      customerAddress: quote.customer.addressCurrent ?? quote.customer.addressIdCard ?? null,
      items: quote.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
      })),
      subtotal: Number(quote.subtotal),
      discount: Number(quote.discount),
      vatAmount: Number(quote.vatAmount),
      total: Number(quote.total),
      notes: quote.notes,
      createdByName: quote.createdBy.name,
    };
  }

  /**
   * Render the quote PDF as a Buffer via puppeteer. Defers `puppeteer` import
   * so the package isn't required at boot/test time — many test runners spin
   * up the service without the Chromium binary on disk.
   */
  async generatePdf(id: string, user?: RequestUser): Promise<Buffer> {
    const data = await this.buildPdfData(id, user);
    const html = renderQuoteHtml(data);

    // Lazy import to keep test environment lean.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await browser.close().catch((err: unknown) =>
        this.logger.warn(
          `puppeteer browser.close failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }
}
