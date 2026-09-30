import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';

/**
 * วันที่ลงบัญชีรับสินค้าของใบรับของ — จุดเดียวที่ตัดสิน ใช้ทั้งหน่วยที่ลงตอนรับของและหน่วยที่ลงตอนผ่านเข้าคลัง.
 * วันนี้ = เวลาที่รับของเข้าคลัง. ฝ่ายบัญชีตอบข้อ ข3 (2026-09-29) ให้ใช้วันที่ในใบส่งของ/ใบกำกับภาษีของ
 * ผู้จัดจำหน่าย และเจ้าของเคาะตามนั้นแล้ว แต่ใบรับของยังไม่มีช่องเก็บวันที่เอกสาร — เมื่อเพิ่มช่องแล้วแก้ที่นี่ที่เดียว
 */
export function receivingPostingDate(receiving: { createdAt?: Date | null }): Date {
  return receiving.createdAt ?? new Date();
}

export interface ReceivingAcceptanceDeps {
  template: ShopGoodsReceivingTemplate;
  accounts: ShopAccountResolver;
  companies: CompanyResolverService;
}

export interface AcceptedUnitJournal {
  entryNo: string;
  journalEntryId: string;
  postedAt: Date;
  /** งวดของวันที่ใบรับของปิดไปแล้ว จึงลงวันที่รับเข้าคลังแทน */
  postedOnAcceptanceDate: boolean;
}

/**
 * ลงบัญชีรับสินค้าของหน่วยที่รับจากใบสั่งซื้อแต่ยังไม่รับเข้าคลังตอนรับของ (มือสองที่รอถ่ายรูป) —
 * คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8: "ลงสินค้าเข้าคลังและเจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง".
 *
 * ทุกทางที่พาเครื่องเข้า `IN_STOCK` เรียก `bookIfPending` ใน tx เดียวกับการเปลี่ยนสถานะ
 * (รายการบัญชีพัง = เครื่องไม่เข้าคลัง). ไม่ทำอะไรและคืน `null` เมื่อ:
 *   - เครื่องไม่ได้มาจากใบรับของ (รับซื้อมือสอง / ยึดเครื่อง / สร้างเอง)
 *   - รับก่อนระบบลงบัญชีรับของ (`receivedCost` ว่าง — ไม่ลงย้อนหลัง)
 *   - ลงไปแล้ว (`journalEntryId` มีค่า — ลงตอนรับของ หรือเคยผ่านเข้าคลังแล้ว)
 * เครื่องที่ถูกกด "ไม่รับเข้าคลัง" ไม่เคยผ่านที่นี่ จึงไม่มีรายการบัญชีเลย
 *
 * ยอด = `receivedCost` ที่ปันไว้ตอนรับของ (ไม่ใช่ `Product.costPrice` ปัจจุบัน ซึ่งแก้มือได้) —
 * เจ้าหนี้ต้องเท่ากับที่ใบสั่งซื้อตั้งไว้.
 *
 * สร้างด้วย `new ReceivingAcceptanceJournal(prisma)` ภายใน service ที่ต้องใช้ (แบบเดียวกับ
 * `ShopTenderRecorder`) — ไม่เพิ่ม dependency ให้ constructor ของ service เดิมที่มีผู้สร้างเองหลายสิบที่
 */
export class ReceivingAcceptanceJournal {
  private readonly logger = new Logger(ReceivingAcceptanceJournal.name);
  private readonly deps: ReceivingAcceptanceDeps;

  constructor(prisma: PrismaService, deps: Partial<ReceivingAcceptanceDeps> = {}) {
    const companies = deps.companies ?? new CompanyResolverService(prisma);
    this.deps = {
      companies,
      accounts: deps.accounts ?? new ShopAccountResolver(prisma),
      template: deps.template ?? new ShopGoodsReceivingTemplate(new JournalAutoService(prisma), prisma, companies),
    };
  }

  async bookIfPending(
    tx: Prisma.TransactionClient,
    productId: string,
    acceptedAt: Date = new Date(),
  ): Promise<AcceptedUnitJournal | null> {
    const item = await tx.goodsReceivingItem.findFirst({
      where: { productId, status: 'PASS', deletedAt: null },
      select: { id: true, receivedCost: true, journalEntryId: true },
    });
    if (!item || item.receivedCost === null || item.journalEntryId) return null;

    // กดยืนยันซ้ำพร้อมกัน: ล็อกแถวแล้วอ่านใหม่ — ผู้มาทีหลังเห็นว่าลงแล้วและจบเงียบ ๆ
    await tx.$queryRaw`SELECT id FROM goods_receiving_items WHERE id = ${item.id} FOR UPDATE`;
    const locked = await tx.goodsReceivingItem.findUnique({
      where: { id: item.id },
      select: {
        journalEntryId: true,
        receivedCost: true,
        receiving: { select: { id: true, grNumber: true, createdAt: true, po: { select: { id: true, poNumber: true } } } },
        product: { select: { category: true } },
      },
    });
    if (!locked || locked.journalEntryId || locked.receivedCost === null || !locked.product) return null;

    const category = locked.product.category as ProductCategory;
    const shopCompanyId = await this.deps.companies.getShopCompanyId(tx);
    const { postedAt, postedOnAcceptanceDate } = await this.resolvePostingDate(
      tx,
      receivingPostingDate(locked.receiving),
      acceptedAt,
      shopCompanyId,
    );

    const posted = await this.deps.template.execute(
      {
        idempotencyKey: `shop-goods-receiving-unit:${productId}`,
        receivingId: locked.receiving.id,
        grNumber: locked.receiving.grNumber,
        poId: locked.receiving.po.id,
        poNumber: locked.receiving.po.poNumber,
        units: [
          {
            productId,
            inventoryAccountCode: this.deps.accounts.resolveProductAccounts(category).inventoryAccountCode,
            payableAccountCode: this.deps.accounts.resolveSupplierPayableAccount(category),
            cost: locked.receivedCost,
          },
        ],
        acceptedProductId: productId,
        postedAt,
      },
      tx,
    );
    if (!posted) return null; // ต้นทุนศูนย์ (ของแถม) — ไม่มีรายการให้ลง

    await tx.goodsReceivingItem.update({
      where: { id: item.id },
      data: { journalEntryId: posted.journalEntryId },
    });
    if (postedOnAcceptanceDate) {
      this.logger.warn(
        `[receiving-acceptance] ${locked.receiving.grNumber} product=${productId}: งวดบัญชีของวันที่รับของปิดแล้ว ` +
          `— ลงวันที่รับเข้าคลัง ${postedAt.toISOString()} แทน (${posted.entryNo})`,
      );
    }
    return { ...posted, postedAt, postedOnAcceptanceDate };
  }

  /**
   * วันเดียวกับรายการของใบรับของนั้น (ตอนนี้ = วันรับของ · ต่อไป = วันที่ในเอกสารผู้จัดจำหน่าย) —
   * ถ้างวดของวันนั้นปิดไปแล้ว (เครื่องรอถ่ายรูปข้ามเดือนหลังปิดงวด) ลงวันที่รับเข้าคลังแทน
   * ไม่ปฏิเสธการเข้าคลังเพราะงวดบัญชี (พนักงานถ่ายรูปเปิดงวดเองไม่ได้). งวดของวันรับเข้าคลังปิด = ปฏิเสธตามปกติ
   */
  private async resolvePostingDate(
    tx: Prisma.TransactionClient,
    lotDate: Date,
    acceptedAt: Date,
    shopCompanyId: string,
  ): Promise<{ postedAt: Date; postedOnAcceptanceDate: boolean }> {
    try {
      await validatePeriodOpen(tx, lotDate, shopCompanyId);
      return { postedAt: lotDate, postedOnAcceptanceDate: false };
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      await validatePeriodOpen(tx, acceptedAt, shopCompanyId);
      return { postedAt: acceptedAt, postedOnAcceptanceDate: true };
    }
  }
}
