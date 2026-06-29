import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, POPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePODto, UpdatePODto, UpdatePaymentDto, OrderPODto } from '../dto/create-po.dto';
import { generatePONumber } from '../../../utils/sequence.util';
import { d, dAdd, dSub, dSum } from '../../../utils/decimal.util';
import { loadVatRateDecimal } from '../../../utils/vat-rate.util';
import { PoQueryService } from './po-query.service';

/**
 * Lifecycle mutations for purchase orders: create (VAT/net Decimal math +
 * PO-number $transaction), update, approve, reject, cancel, updatePayment.
 *
 * The non-create mutations validate via this.query.findOne() — the shared
 * read-validate helper owned by PoQueryService (was this.findOne() in the
 * monolith).
 *
 * Plain class (not @Injectable) — constructed internally by the
 * PurchaseOrdersService facade.
 */
export class PoLifecycleService {
  constructor(
    private prisma: PrismaService,
    private query: PoQueryService,
  ) {}

  async create(dto: CreatePODto, userId: string) {
    // Validate supplier exists & get credit terms
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
      select: {
        deletedAt: true,
        hasVat: true,
        paymentMethods: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: {
            paymentMethod: true,
            creditTermDays: true,
            isDefault: true,
            bankName: true,
            bankAccountNumber: true,
          },
        },
      },
    });
    if (!supplier || supplier.deletedAt) throw new NotFoundException('ไม่พบ Supplier');

    // Calculate total with discount & VAT (only if supplier has VAT)
    // Money math in Prisma.Decimal end-to-end. VAT = subtotal × rate can land on a
    // half-satang that the old float `Math.round(subtotal * vatRate * 100) / 100`
    // dropped (same class as commission.util) — books a 1-satang-off VAT on the PO.
    const totalAmount = dSum(dto.items.map((item) => d(item.quantity).mul(item.unitPrice)));
    const discount = d(dto.discount || 0); // ส่วนลดก่อน VAT
    const discountAfterVat = supplier.hasVat ? d(dto.discountAfterVat || 0) : d(0); // ส่วนลดหลัง VAT (เฉพาะ supplier มี VAT)
    const subtotalAfterDiscount = dSub(totalAmount, discount);
    // D1.1.3.1 — resolve VAT via canonical-key-first helper. Reads VAT_RATE
    // (percent) first, falls back to legacy vat_pct/vat_rate (decimal), or
    // 0.07 if all are absent. Replaces the previous direct `vat_pct` lookup
    // that silently returned the default when admins saved through the new
    // VatTab UI (which writes VAT_RATE).
    const vatRate = await loadVatRateDecimal(this.prisma);
    const vatAmount = supplier.hasVat
      ? subtotalAfterDiscount.mul(vatRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : d(0);
    const netAmount = dSub(dAdd(subtotalAfterDiscount, vatAmount), discountAfterVat);

    // Calculate due date from supplier credit terms
    const orderDateObj = new Date(dto.orderDate);
    let dueDate: Date | null = null;
    const selectedPm = dto.paymentMethod
      ? supplier.paymentMethods.find((pm) => pm.paymentMethod === dto.paymentMethod)
      : supplier.paymentMethods.find((pm) => pm.isDefault) || supplier.paymentMethods[0];
    if (selectedPm?.creditTermDays) {
      dueDate = new Date(orderDateObj);
      dueDate.setDate(dueDate.getDate() + selectedPm.creditTermDays);
    }

    // T5-C18: Snapshot supplier's primary bank at create-time so edits to the
    // supplier record later cannot silently re-target historical POs. `selectedPm`
    // above already resolves the correct payment method (requested method or
    // supplier default).
    const bankAccountSnapshot = selectedPm?.bankAccountNumber ?? null;
    const bankNameSnapshot = selectedPm?.bankName ?? null;

    // Use transaction to prevent PO number race condition
    return this.prisma.$transaction(async (tx) => {
      // Generate PO number inside transaction: PO-YYYY-MM-NNN format (monthly sequence)
      const poNumber = await generatePONumber(tx);

      // PO now starts as DRAFT (requires Owner approval)
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: dto.supplierId,
          orderDate: orderDateObj,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          dueDate,
          totalAmount,
          discount,
          discountAfterVat,
          vatAmount,
          netAmount,
          notes: dto.notes,
          stockCheckRef: dto.stockCheckRef || null,
          bankAccountSnapshot,
          bankNameSnapshot,
          createdById: userId,
          status: 'DRAFT',
          paymentStatus: (dto.paymentStatus as POPaymentStatus) || 'UNPAID',
          paymentMethod: dto.paymentMethod || null,
          paidAmount: dto.paidAmount || 0,
          paymentNotes: dto.paymentNotes || null,
          attachments: dto.attachments || [],
          items: {
            create: dto.items.map((item) => ({
              brand: item.brand || null,
              model: item.model || null,
              color: item.color || null,
              storage: item.storage || null,
              category: item.category || null,
              accessoryType: item.accessoryType || null,
              accessoryBrand: item.accessoryBrand || null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true, hasVat: true } },
          items: true,
        },
      });
    });
  }

  async update(id: string, dto: UpdatePODto) {
    const po = await this.query.findOne(id);
    if (!['DRAFT', 'PENDING'].includes(po.status)) {
      throw new BadRequestException('แก้ไขได้เฉพาะ PO สถานะร่างหรือรอรับสินค้าเท่านั้น');
    }

    const data: Record<string, unknown> = {};
    if (dto.expectedDate) data.expectedDate = new Date(dto.expectedDate);
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.purchaseOrder.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  async approve(id: string, userId: string) {
    const po = await this.query.findOne(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('อนุมัติได้เฉพาะ PO สถานะ DRAFT เท่านั้น (ต้องรอ Owner อนุมัติ)');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async order(id: string, userId: string, dto: OrderPODto) {
    const po = await this.query.findOne(id);
    if (po.status !== 'APPROVED') {
      throw new BadRequestException('สั่งซื้อได้เฉพาะ PO ที่อนุมัติแล้ว (APPROVED) เท่านั้น');
    }
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'ORDERED',
        orderedAt: new Date(),
        ...(dto.expectedDate ? { expectedDate: new Date(dto.expectedDate) } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async reject(id: string, userId: string, reason: string) {
    const po = await this.query.findOne(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('ปฏิเสธได้เฉพาะ PO สถานะ DRAFT เท่านั้น');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        approvedById: userId,
        rejectReason: reason,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async cancel(id: string) {
    const po = await this.query.findOne(id);
    if (!['DRAFT', 'APPROVED', 'PENDING'].includes(po.status)) {
      throw new BadRequestException('ยกเลิกได้เฉพาะ PO ที่ยังไม่ได้รับสินค้าเท่านั้น');
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async updatePayment(id: string, dto: UpdatePaymentDto) {
    const po = await this.query.findOne(id);
    if (po.status === 'CANCELLED') {
      throw new BadRequestException('ไม่สามารถอัปเดตการจ่ายเงินของ PO ที่ยกเลิกแล้วได้');
    }
    if (dto.paidAmount !== undefined && dto.paidAmount > Number(po.netAmount)) {
      throw new BadRequestException(`ยอดจ่ายเกินกว่ายอดสุทธิ (${Number(po.netAmount).toLocaleString()} บาท)`);
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        paymentStatus: dto.paymentStatus as POPaymentStatus,
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod || null } : {}),
        paidAmount: dto.paidAmount,
        ...(dto.paymentNotes !== undefined ? { paymentNotes: dto.paymentNotes || null } : {}),
        ...(dto.attachments !== undefined ? { attachments: dto.attachments } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }
}
