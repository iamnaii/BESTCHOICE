import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GoodsReceivingDto, DirectReceiveDto } from '../dto/create-po.dto';
import { buildProductName } from './po-product-naming.util';
import { generateGRNumber, generatePONumber } from '../../../utils/sequence.util';

/**
 * Inventory-mutating goods-receiving flows. Owns the 2 write transactions:
 *  - goodsReceiving() — Serializable $transaction (per-unit IMEI/photo flow)
 *  - confirmQC()      — $transaction (QC_PENDING → IN_STOCK / PHOTO_PENDING)
 *
 * Each $transaction callback lives WHOLE inside a single method — the tx client
 * is closure-bound and never crosses a service boundary, so the Serializable
 * isolation + re-read + ceiling-check + product-create + POItem.update +
 * PO-status-recompute pipeline stays intact.
 *
 * Plain class (not @Injectable) — constructed internally by the
 * PurchaseOrdersService facade.
 */
export class PoReceivingService {
  constructor(private prisma: PrismaService) {}

  /**
   * New goods receiving flow with IMEI/Serial/photos/pass-reject per unit
   *
   * T5-C16: wrapped in Serializable transaction — two concurrent GR batches
   * cannot both pass the `totalReceived > quantity` ceiling check against
   * stale in-memory receivedQty. Ceiling is recomputed from SUM() of all
   * POItem rows by id inside the tx so no cached copy is trusted.
   */
  async goodsReceiving(id: string, dto: GoodsReceivingDto, userId: string) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.runReceiveInTx(tx, id, dto, userId),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if ((code === 'P2002' || code === 'P2034') && attempt < MAX_ATTEMPTS) continue;
        throw e;
      }
    }
  }

  /**
   * Shared per-unit receiving pipeline. Runs INSIDE a caller-provided
   * Serializable tx (standard goodsReceiving OR direct-receive auto-PO).
   * Closure-bound tx — never crosses a service boundary. T5-C16 ceiling
   * re-read + IMEI dup guard + product create + POItem.update + status
   * recompute all live here, unchanged.
   */
  private async runReceiveInTx(
    tx: Prisma.TransactionClient,
    id: string,
    dto: GoodsReceivingDto,
    userId: string,
  ) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: true },
    });

    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    if (!['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new BadRequestException('PO นี้ไม่อยู่ในสถานะที่สามารถรับสินค้าได้ (ต้อง APPROVED, ORDERED หรือ PARTIALLY_RECEIVED)');
    }

    // Find main warehouse branch
    let mainWarehouse = await tx.branch.findFirst({
      where: { isMainWarehouse: true, isActive: true, deletedAt: null },
    });
    if (!mainWarehouse) {
      // Fallback: use first active branch
      mainWarehouse = await tx.branch.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!mainWarehouse) {
      throw new BadRequestException('ไม่พบคลังกลาง กรุณาตั้งค่าสาขาคลังกลางก่อน');
    }

    // Generate GR number inside the serializable tx; @unique is the backstop.
    const grNumber = await generateGRNumber(tx);
    const receiving = await tx.goodsReceiving.create({
      data: {
        grNumber,
        poId: id,
        receivedById: userId,
        notes: dto.notes,
      },
    });

    const passedProducts: Awaited<ReturnType<typeof tx.product.update>>[] = [];
    const rejectedItems: Awaited<ReturnType<typeof tx.goodsReceivingItem.create>>[] = [];

    // Group items by poItemId to count per PO item
    const countByPoItem: Record<string, number> = {};
    for (const item of dto.items) {
      if (item.status === 'PASS') {
        countByPoItem[item.poItemId] = (countByPoItem[item.poItemId] || 0) + 1;
      }
    }

    // T5-C16: Re-read POItem rows inside the serializable tx to get the
    // authoritative receivedQty at this instant. Any parallel GR batch
    // that committed before us will be visible here; any that commits
    // after us will be serialized and retry. `countByPoItem` inside this
    // batch is already aggregated to avoid double-counting when the same
    // poItemId appears twice in dto.items.
    const freshPoItems = await tx.pOItem.findMany({
      where: { id: { in: Object.keys(countByPoItem) } },
      select: { id: true, quantity: true, receivedQty: true, brand: true, model: true },
    });
    const freshByPoItem = new Map(freshPoItems.map((p) => [p.id, p]));

    // Validate quantities using fresh DB rows (not cached po.items)
    for (const [poItemId, passCount] of Object.entries(countByPoItem)) {
      const fresh = freshByPoItem.get(poItemId);
      if (!fresh) throw new NotFoundException(`ไม่พบรายการ PO: ${poItemId}`);

      const totalReceived = fresh.receivedQty + passCount;
      if (totalReceived > fresh.quantity) {
        throw new BadRequestException(
          `จำนวนรับเกิน: ${fresh.brand ?? ''} ${fresh.model ?? ''} (สั่ง ${fresh.quantity}, รับแล้ว ${fresh.receivedQty}, กำลังรับ ${passCount})`,
        );
      }
    }

    // Validate duplicate IMEI/Serial in this batch
    const imeiList = dto.items
      .filter((i) => i.status === 'PASS' && i.imeiSerial)
      .map((i) => i.imeiSerial!);
    const uniqueImeis = new Set(imeiList);
    if (uniqueImeis.size !== imeiList.length) {
      throw new BadRequestException('พบ IMEI ซ้ำกันในรายการที่กำลังรับเข้า');
    }

    // Validate IMEI not already exists in system (include soft-deleted due to DB unique constraint)
    if (imeiList.length > 0) {
      const existingProducts = await tx.product.findMany({
        where: { imeiSerial: { in: imeiList } },
        select: { imeiSerial: true, name: true, deletedAt: true },
      });
      if (existingProducts.length > 0) {
        const dupes = existingProducts.map((p) => {
          const suffix = p.deletedAt ? ' [ตัดจำหน่ายแล้ว]' : '';
          return `${p.imeiSerial} (${p.name}${suffix})`;
        }).join(', ');
        throw new BadRequestException(`IMEI ซ้ำกับสินค้าที่มีในระบบแล้ว: ${dupes}`);
      }
    }

    // Process each item
    for (const item of dto.items) {
      const poItem = po.items.find((i) => i.id === item.poItemId);
      if (!poItem) throw new NotFoundException(`ไม่พบรายการ PO: ${item.poItemId}`);

      if (item.status === 'PASS') {
        // Build product name from PO item details
        const productCategory = (poItem.category as ProductCategory) || 'PHONE_NEW';
        const productName = buildProductName(poItem, productCategory);

        // Create product for passed items
        // PHONE_USED → PHOTO_PENDING (ต้องถ่ายรูป 6 มุมก่อนเข้าคลัง)
        // PHONE_NEW / ACCESSORY → IN_STOCK (เข้าคลังได้เลย)
        const initialStatus = productCategory === 'PHONE_USED' ? 'PHOTO_PENDING' : 'IN_STOCK';
        const product = await tx.product.create({
          data: {
            name: productName,
            brand: poItem.brand || '',
            model: poItem.model || '',
            color: poItem.color || null,
            storage: poItem.storage || null,
            category: productCategory,
            costPrice: Number(poItem.unitPrice),
            supplierId: po.supplierId,
            poId: po.id,
            branchId: mainWarehouse!.id,
            status: initialStatus,
            imeiSerial: item.imeiSerial || null,
            serialNumber: item.serialNumber || null,
            photos: item.photos || [],
            batteryHealth: item.batteryHealth ?? null,
            warrantyExpired: item.warrantyExpired ?? null,
            warrantyExpireDate: item.warrantyExpireDate ? new Date(item.warrantyExpireDate) : null,
            hasBox: item.hasBox ?? null,
            checklistResults: item.checklistResults ? (item.checklistResults as unknown as Prisma.InputJsonValue) : undefined,
            accessoryType: poItem.accessoryType || null,
            accessoryBrand: poItem.accessoryBrand || null,
          },
        });

        // Create selling price if provided
        if (item.sellingPrice && item.sellingPrice > 0) {
          await tx.productPrice.create({
            data: {
              productId: product.id,
              label: 'ราคาขาย',
              amount: item.sellingPrice,
              isDefault: true,
            },
          });
        }

        // Create receiving item linked to product
        await tx.goodsReceivingItem.create({
          data: {
            receivingId: receiving.id,
            poItemId: item.poItemId,
            imeiSerial: item.imeiSerial,
            serialNumber: item.serialNumber,
            photos: item.photos || [],
            status: 'PASS',
            productId: product.id,
            batteryHealth: item.batteryHealth ?? null,
            warrantyExpired: item.warrantyExpired ?? null,
            warrantyExpireDate: item.warrantyExpireDate ? new Date(item.warrantyExpireDate) : null,
            hasBox: item.hasBox ?? null,
            checklistResults: item.checklistResults ? (item.checklistResults as unknown as Prisma.InputJsonValue) : undefined,
          },
        });

        passedProducts.push(product);
      } else {
        // Create receiving item for rejected items (no product created)
        const rejectedItem = await tx.goodsReceivingItem.create({
          data: {
            receivingId: receiving.id,
            poItemId: item.poItemId,
            imeiSerial: item.imeiSerial,
            serialNumber: item.serialNumber,
            photos: item.photos || [],
            status: 'REJECT',
            rejectReason: item.rejectReason,
            defectReason: item.defectReason ?? null,
          },
        });

        rejectedItems.push(rejectedItem);
      }
    }

    // T5-C16: Update PO item received quantities using fresh values
    // (not cached po.items which could be stale against a parallel tx).
    for (const [poItemId, passCount] of Object.entries(countByPoItem)) {
      const fresh = freshByPoItem.get(poItemId)!;
      await tx.pOItem.update({
        where: { id: poItemId },
        data: { receivedQty: fresh.receivedQty + passCount },
      });
    }

    // Check if all items fully received
    const updatedPO = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    const allReceived = updatedPO!.items.every((item) => item.receivedQty >= item.quantity);
    const newStatus = allReceived ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: newStatus },
    });

    return {
      receivingId: receiving.id,
      grNumber,
      poId: id,
      status: newStatus,
      passed: passedProducts.length,
      rejected: rejectedItems.length,
      products: passedProducts,
      mainWarehouse: mainWarehouse!.name,
    };
  }

  /**
   * B3 — Supplier-direct receive ("รับเข้าตรง") = auto-PO.
   *
   * Urgent buys from a vendor with no pre-made PO. Instead of threading a
   * nullable poId through the PO-centric read paths, we auto-create a REAL PO
   * (supplier + line items, unitPrice = costPrice) and advance it
   * APPROVED -> ORDERED in ONE Serializable $transaction, bypassing the OWNER
   * approval gate (audited), then run the existing receiving pipeline.
   * Net: GoodsReceiving.poId is never null; GR history / AP / progress / the
   * T5-C16 ceiling check all work unchanged. JE-FREE — no accounting touch.
   */
  async directReceive(dto: DirectReceiveDto, userId: string) {
    // Up-front guard: every line must carry a positive costPrice (COGS reads it).
    const badCost = dto.items.find((i) => !(Number(i.unitPrice) > 0));
    if (badCost) {
      throw new BadRequestException('กรุณาระบุราคาทุน (costPrice) มากกว่า 0 ให้ครบทุกรายการ');
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // 1) Validate supplier
            const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
            if (!supplier || supplier.deletedAt) throw new NotFoundException('ไม่พบ Supplier');

            // 2) Create the auto-PO (unitPrice = costPrice). Starts APPROVED so the
            //    OWNER approval gate is structurally bypassed (audited at step 4).
            const poNumber = await generatePONumber(tx);
            const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
            const po = await tx.purchaseOrder.create({
              data: {
                poNumber,
                supplierId: dto.supplierId,
                orderDate: new Date(dto.orderDate),
                totalAmount,
                netAmount: totalAmount, // direct receive: no VAT/discount math
                notes: dto.notes ?? null,
                createdById: userId,
                approvedById: userId,
                status: 'APPROVED',
                isDirectReceive: true,
                paymentStatus: 'UNPAID',
                items: {
                  create: dto.items.map((i) => ({
                    brand: i.brand || null,
                    model: i.model || null,
                    color: i.color || null,
                    storage: i.storage || null,
                    category: i.category || null,
                    accessoryType: i.accessoryType || null,
                    accessoryBrand: i.accessoryBrand || null,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                  })),
                },
              },
              include: { items: true, supplier: { select: { id: true, name: true } } },
            });

            // 3) Advance APPROVED -> ORDERED (mirrors PoLifecycleService.order from B0)
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { status: 'ORDERED', orderedAt: new Date() },
            });

            // 4) Audit the approval-bypass (no cross-module import — auditLog is on PrismaService)
            await tx.auditLog.create({
              data: {
                userId,
                action: 'PO_DIRECT_RECEIVE_APPROVAL_BYPASS',
                entity: 'purchase_order',
                entityId: po.id,
                newValue: {
                  poNumber: po.poNumber,
                  supplierId: dto.supplierId,
                  isDirectReceive: true,
                  reason: 'รับเข้าตรงจาก supplier (ไม่มี PO ล่วงหน้า) — ข้ามขั้นอนุมัติ',
                  itemCount: dto.items.length,
                },
              },
            });

            // 5) Map each DTO line onto the freshly-created POItem id, then run the
            //    SAME per-unit receiving pipeline (in this tx) the standard flow uses.
            const grItems = dto.items.map((line, idx) => ({
              poItemId: po.items[idx].id,
              imeiSerial: line.imeiSerial,
              serialNumber: line.serialNumber,
              photos: line.photos,
              status: line.status,
              rejectReason: line.rejectReason,
              defectReason: line.defectReason,
              batteryHealth: line.batteryHealth,
              warrantyExpired: line.warrantyExpired,
              warrantyExpireDate: line.warrantyExpireDate,
              hasBox: line.hasBox,
              checklistResults: line.checklistResults,
              sellingPrice: line.sellingPrice,
            }));

            const gr = await this.runReceiveInTx(tx, po.id, { items: grItems, notes: dto.notes }, userId);

            return { poNumber: po.poNumber, ...gr };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if ((code === 'P2002' || code === 'P2034') && attempt < MAX_ATTEMPTS) continue;
        throw e;
      }
    }
  }

  /**
   * Reject products at the post-receive QC stage (QC_PENDING / PHOTO_PENDING):
   * soft-delete the failed units and record the reason. JE-free, products-table
   * only — no accounting/finance touch.
   */
  async rejectQC(productIds: string[], reason: string) {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('กรุณาเลือกสินค้าที่ไม่ผ่าน QC อย่างน้อย 1 ชิ้น');
    }

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
      });

      const notFound = productIds.filter((id) => !products.find((p) => p.id === id));
      if (notFound.length > 0) {
        throw new BadRequestException(`ไม่พบสินค้า ID: ${notFound.join(', ')}`);
      }

      const invalid = products.filter((p) => !['QC_PENDING', 'PHOTO_PENDING'].includes(p.status));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `สินค้าต่อไปนี้ไม่ได้อยู่ในขั้นตอน QC: ${invalid.map((p) => p.name).join(', ')}`,
        );
      }

      await tx.product.updateMany({
        where: { id: { in: productIds } },
        data: { deletedAt: new Date() },
      });

      return {
        rejected: productIds.length,
        reason,
        message: `บันทึกไม่ผ่าน QC ${productIds.length} ชิ้น (ตัดออกจากคลังแล้ว): ${reason}`,
      };
    });
  }

  /**
   * Confirm QC for products - moves QC_PENDING → IN_STOCK (เข้าคลังหลัก)
   * Workflow Step 4: สินค้าเข้าคลัง
   */
  async confirmQC(productIds: string[]) {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('กรุณาระบุสินค้าที่ต้องการยืนยัน QC');
    }

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
      });

      // Validate all products are QC_PENDING
      const invalidProducts = products.filter((p) => p.status !== 'QC_PENDING');
      if (invalidProducts.length > 0) {
        throw new BadRequestException(
          `สินค้าต่อไปนี้ไม่ได้อยู่ในสถานะ QC_PENDING: ${invalidProducts.map((p) => p.name).join(', ')}`,
        );
      }

      const notFound = productIds.filter((id) => !products.find((p) => p.id === id));
      if (notFound.length > 0) {
        throw new BadRequestException(`ไม่พบสินค้า ID: ${notFound.join(', ')}`);
      }

      // PHONE_USED → PHOTO_PENDING (ต้องถ่ายรูป 6 มุมก่อนเข้าคลัง)
      const usedPhoneIds = products.filter((p) => p.category === 'PHONE_USED').map((p) => p.id);
      const otherIds = products.filter((p) => p.category !== 'PHONE_USED').map((p) => p.id);

      if (usedPhoneIds.length > 0) {
        await tx.product.updateMany({
          where: { id: { in: usedPhoneIds } },
          data: { status: 'PHOTO_PENDING' },
        });
      }

      // อื่นๆ → IN_STOCK ตรง (ไม่ต้องถ่ายรูป)
      if (otherIds.length > 0) {
        await tx.product.updateMany({
          where: { id: { in: otherIds } },
          data: { status: 'IN_STOCK', stockInDate: new Date() },
        });
      }

      return {
        confirmed: productIds.length,
        message: `ยืนยัน QC สำเร็จ ${productIds.length} ชิ้น`
          + (usedPhoneIds.length > 0 ? ` (มือสอง ${usedPhoneIds.length} ชิ้น → รอถ่ายรูป)` : '')
          + (otherIds.length > 0 ? ` (อื่นๆ ${otherIds.length} ชิ้น → เข้าคลัง)` : ''),
      };
    });
  }
}
