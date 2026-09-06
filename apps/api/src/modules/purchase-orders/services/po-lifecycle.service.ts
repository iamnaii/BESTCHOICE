import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, POPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePODto, UpdatePODto, UpdatePaymentDto, OrderPODto, ApprovePODto } from '../dto/create-po.dto';
import { generatePONumber } from '../../../utils/sequence.util';
import { loadVatRateDecimal } from '../../../utils/vat-rate.util';
import { PoQueryService } from './po-query.service';
import { SUPPLIER_TERMS_SELECT, computePoAmounts, resolvePaymentTerms } from './po-amounts.util';

/**
 * วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่งซื้อ — compared at day granularity (UTC).
 * `orderDate` is the DTO's ISO string on create, or the Date already stored on
 * the PO for update / order. A missing expectedDate is fine (nullable column).
 */
function assertExpectedNotBeforeOrder(expectedDate: string | undefined, orderDate: string | Date) {
  if (!expectedDate) return;
  const expected = new Date(expectedDate);
  const order = new Date(orderDate);
  if (Number.isNaN(expected.getTime()) || Number.isNaN(order.getTime())) return; // @IsDateString already rejects garbage
  if (expected.toISOString().slice(0, 10) < order.toISOString().slice(0, 10)) {
    throw new BadRequestException('วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่งซื้อ');
  }
}

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

  async create(dto: CreatePODto, userId: string, userRole?: string) {
    assertExpectedNotBeforeOrder(dto.expectedDate, dto.orderDate);
    // Owner decision 2026-09-06: the OWNER does not approve their own PO — it is ordered at
    // once. A BRANCH_MANAGER's PO still starts DRAFT and waits for the owner (branch spend gate).
    const ownerCreated = userRole === 'OWNER';

    // Validate supplier exists & get credit terms
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
      select: SUPPLIER_TERMS_SELECT,
    });
    if (!supplier || supplier.deletedAt) throw new NotFoundException('ไม่พบ Supplier');

    // Money math (Decimal end-to-end, VAT only for VAT suppliers) + credit terms + bank
    // snapshot (T5-C18) — shared with directReceive() via po-amounts.util so an auto-PO
    // books exactly what a normal PO does. VAT rate: D1.1.3.1 canonical-key-first loader
    // (VAT_RATE → legacy vat_pct/vat_rate → 0.07).
    const vatRate = await loadVatRateDecimal(this.prisma);
    const { totalAmount, discount, discountAfterVat, vatAmount, netAmount } = computePoAmounts(dto.items, {
      supplierHasVat: supplier.hasVat,
      vatRate,
      discount: dto.discount,
      discountAfterVat: dto.discountAfterVat,
    });
    const orderDateObj = new Date(dto.orderDate);
    const { dueDate, bankAccountSnapshot, bankNameSnapshot } = resolvePaymentTerms(supplier, dto.paymentMethod, orderDateObj);

    // Use transaction to prevent PO number race condition
    return this.prisma.$transaction(async (tx) => {
      // Generate PO number inside transaction: PO-YYYY-MM-NNN format (monthly sequence)
      const poNumber = await generatePONumber(tx);

      return tx.purchaseOrder.create({
        data: {
          ...(ownerCreated ? { approvedById: userId, orderedAt: new Date() } : {}),
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
          status: ownerCreated ? 'ORDERED' : 'DRAFT',
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
    assertExpectedNotBeforeOrder(dto.expectedDate, po.orderDate);

    const data: Record<string, unknown> = {};
    if (dto.expectedDate) data.expectedDate = new Date(dto.expectedDate);
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.purchaseOrder.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  /**
   * Approve = order (owner decision 2026-09-06): DRAFT → ORDERED in one step. The separate
   * "กดสั่งซื้อ" click added no information (receiving was already allowed from APPROVED);
   * the one thing it did — confirm the expected date — moves into the approval body.
   * order() stays for any legacy APPROVED row.
   */
  async approve(id: string, userId: string, dto?: ApprovePODto) {
    const po = await this.query.findOne(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException('อนุมัติได้เฉพาะ PO สถานะ DRAFT เท่านั้น (ต้องรอ Owner อนุมัติ)');
    }
    assertExpectedNotBeforeOrder(dto?.expectedDate, po.orderDate);

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'ORDERED',
        approvedById: userId,
        orderedAt: new Date(),
        ...(dto?.expectedDate ? { expectedDate: new Date(dto.expectedDate) } : {}),
      },
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
    assertExpectedNotBeforeOrder(dto.expectedDate, po.orderDate);
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
    // An ORDERED PO is still cancellable while nothing has been received — approve now
    // lands on ORDERED directly, so the old "cancellable APPROVED" window must not vanish.
    const nothingReceived = (po.items ?? []).every((i) => !i.receivedQty);
    const cancellable =
      ['DRAFT', 'APPROVED', 'PENDING'].includes(po.status) || (po.status === 'ORDERED' && nothingReceived);
    if (!cancellable) {
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
