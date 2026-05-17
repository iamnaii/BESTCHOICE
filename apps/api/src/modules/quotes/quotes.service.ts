import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateQuoteNumber, generateSaleNumber } from '../../utils/sequence.util';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { ConvertQuoteDto } from './dto/convert-quote.dto';
import { renderQuoteHtml, QuotePdfData } from './templates/quote-pdf.template';

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

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(private prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────

  async findAll(opts: {
    page?: number;
    limit?: number;
    status?: string;
    branchId?: string;
    search?: string;
    customerId?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.QuoteWhereInput = { deletedAt: null };
    if (opts.status) where.status = opts.status as Prisma.QuoteWhereInput['status'];
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.search) {
      where.OR = [
        { quoteNumber: { contains: opts.search, mode: 'insensitive' } },
        { customer: { name: { contains: opts.search, mode: 'insensitive' } } },
      ];
    }

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

  async findOne(id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      include: QUOTE_DEFAULT_INCLUDE,
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    return quote;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Write
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Compute subtotal + total from line items. discount + vatAmount come from
   * the dto (frontend lets sales enter them explicitly).
   */
  private computeTotals(
    items: { quantity: number; unitPrice: number }[],
    discount: number,
    vatAmount: number,
  ) {
    const subtotal = items.reduce(
      (sum, it) => sum + Math.round(it.quantity * it.unitPrice * 100) / 100,
      0,
    );
    const total = Math.max(0, subtotal - discount + vatAmount);
    return { subtotal, total };
  }

  async create(dto: CreateQuoteDto, createdById: string) {
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('validUntil ไม่ใช่วันที่');
    }
    if (validUntil.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      throw new BadRequestException('validUntil ต้องไม่เลยมาแล้วเกิน 1 วัน');
    }

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

    const discount = dto.discount ?? 0;
    const vatAmount = dto.vatAmount ?? 0;
    const { subtotal, total } = this.computeTotals(dto.items, discount, vatAmount);

    return this.prisma.$transaction(async (tx) => {
      const quoteNumber = await generateQuoteNumber(tx as unknown as Parameters<typeof generateQuoteNumber>[0]);

      return tx.quote.create({
        data: {
          quoteNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          status: 'DRAFT',
          validUntil,
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          discount: new Prisma.Decimal(discount.toFixed(2)),
          vatAmount: new Prisma.Decimal(vatAmount.toFixed(2)),
          total: new Prisma.Decimal(total.toFixed(2)),
          notes: dto.notes,
          createdById,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2)),
              amount: new Prisma.Decimal(
                (Math.round(item.quantity * item.unitPrice * 100) / 100).toFixed(2),
              ),
            })),
          },
        },
        include: QUOTE_DEFAULT_INCLUDE,
      });
    });
  }

  async update(id: string, dto: UpdateQuoteDto) {
    const existing = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        `แก้ไขใบเสนอราคาได้เฉพาะสถานะ DRAFT (สถานะปัจจุบัน: ${existing.status})`,
      );
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
        const discount = dto.discount ?? 0;
        const vatAmount = dto.vatAmount ?? 0;
        const { subtotal, total } = this.computeTotals(dto.items, discount, vatAmount);

        updates.subtotal = new Prisma.Decimal(subtotal.toFixed(2));
        updates.discount = new Prisma.Decimal(discount.toFixed(2));
        updates.vatAmount = new Prisma.Decimal(vatAmount.toFixed(2));
        updates.total = new Prisma.Decimal(total.toFixed(2));

        // Delete existing items + replace
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
        updates.items = {
          create: dto.items.map((item) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2)),
            amount: new Prisma.Decimal(
              (Math.round(item.quantity * item.unitPrice * 100) / 100).toFixed(2),
            ),
          })),
        };
      } else if (dto.discount !== undefined || dto.vatAmount !== undefined) {
        // Items unchanged but totals shifted — re-fetch items to recompute
        const items = await tx.quoteItem.findMany({
          where: { quoteId: id },
          select: { quantity: true, unitPrice: true },
        });
        const itemsForCalc = items.map((it) => ({
          quantity: it.quantity,
          unitPrice: Number(it.unitPrice),
        }));
        const discount = dto.discount ?? 0;
        const vatAmount = dto.vatAmount ?? 0;
        const { subtotal, total } = this.computeTotals(itemsForCalc, discount, vatAmount);
        updates.subtotal = new Prisma.Decimal(subtotal.toFixed(2));
        updates.discount = new Prisma.Decimal(discount.toFixed(2));
        updates.vatAmount = new Prisma.Decimal(vatAmount.toFixed(2));
        updates.total = new Prisma.Decimal(total.toFixed(2));
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

  async send(id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException(
        `ส่งใบเสนอราคาได้เฉพาะสถานะ DRAFT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    return this.prisma.quote.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
      include: QUOTE_DEFAULT_INCLUDE,
    });
  }

  async accept(id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, validUntil: true },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'SENT') {
      throw new BadRequestException(
        `ลูกค้ายอมรับใบเสนอราคาได้เฉพาะสถานะ SENT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    if (quote.validUntil.getTime() < Date.now()) {
      throw new BadRequestException('ใบเสนอราคานี้หมดอายุแล้ว — กรุณาออกใหม่');
    }
    return this.prisma.quote.update({
      where: { id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
      include: QUOTE_DEFAULT_INCLUDE,
    });
  }

  async reject(id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'SENT') {
      throw new BadRequestException(
        `ปฏิเสธใบเสนอราคาได้เฉพาะสถานะ SENT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    return this.prisma.quote.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
      include: QUOTE_DEFAULT_INCLUDE,
    });
  }

  /**
   * Convert an ACCEPTED quote into a CASH Sale row.
   * Phase 1 scope: takes the FIRST quote item's productId (if set) and uses
   * the quote's `total` as the sellingPrice. SP6 will extend with multi-item,
   * INSTALLMENT, and EXTERNAL_FINANCE conversions.
   */
  async convert(id: string, dto: ConvertQuoteDto, salespersonId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
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
      // Re-check sale not yet linked under tx + lock semantics
      const fresh = await tx.quote.findFirst({
        where: { id, deletedAt: null },
        select: { convertedToSaleId: true },
      });
      if (fresh?.convertedToSaleId) {
        throw new ConflictException('ใบเสนอราคานี้ถูกแปลงเป็นการขายแล้ว');
      }

      const saleNumber = await generateSaleNumber(
        tx as unknown as Parameters<typeof generateSaleNumber>[0],
      );
      const totalNum = Number(quote.total);
      const discountNum = Number(quote.discount);

      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'CASH',
          customerId: quote.customerId,
          productId: firstItem.productId!,
          branchId: quote.branchId,
          salespersonId,
          sellingPrice: new Prisma.Decimal(totalNum.toFixed(2)),
          discount: new Prisma.Decimal(discountNum.toFixed(2)),
          netAmount: new Prisma.Decimal(totalNum.toFixed(2)),
          paymentMethod: (dto.paymentMethod as Prisma.SaleCreateInput['paymentMethod']) || null,
          amountReceived: new Prisma.Decimal(totalNum.toFixed(2)),
          notes: dto.notes || `แปลงจากใบเสนอราคา ${quote.quoteNumber}`,
        },
      });

      await tx.quote.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedToSaleId: sale.id,
        },
      });

      return { sale, quoteId: id };
    });
  }

  async remove(id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!quote) throw new NotFoundException('ไม่พบใบเสนอราคา');
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException(
        `ลบใบเสนอราคาได้เฉพาะสถานะ DRAFT (สถานะปัจจุบัน: ${quote.status})`,
      );
    }
    await this.prisma.quote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id, deletedAt: new Date() };
  }

  // ───────────────────────────────────────────────────────────────────────
  // PDF
  // ───────────────────────────────────────────────────────────────────────

  /** Build PDF data and render HTML (caller decides puppeteer vs raw HTML). */
  async buildPdfData(id: string): Promise<QuotePdfData> {
    const quote = await this.prisma.quote.findFirst({
      where: { id, deletedAt: null },
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
  async generatePdf(id: string): Promise<Buffer> {
    const data = await this.buildPdfData(id);
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
