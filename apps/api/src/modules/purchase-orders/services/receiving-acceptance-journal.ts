import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';
import { supplierDocMetadata, supplierDocRef } from './supplier-doc.util';

/**
 * วันที่ลงบัญชีรับสินค้าที่ "ควรเป็น" ของใบรับของ — จุดเดียวที่ตัดสิน ใช้ทั้งหน่วยที่ลงตอนรับของและหน่วยที่ลงตอนผ่านเข้าคลัง.
 * = วันที่ในเอกสารของผู้จัดจำหน่าย (คำตอบฝ่ายบัญชีข้อ ข3 2026-09-29 · แบบหน้าจอที่เจ้าของเคาะ 2026-10-01) ·
 * ไม่มีเอกสาร / ใบรับของก่อนมีช่องนี้ = วันที่รับของ. งวดของวันนั้นปิดแล้ว ผู้เรียกข้ามไปวันถัดไปใน
 * `receivingPostingCandidates` (แบบ ข — รับได้ ลงวันที่รับของแทน)
 */
export function receivingPostingDate(receiving: { createdAt?: Date | null; supplierDocDate?: Date | null }): Date {
  return receiving.supplierDocDate ?? receiving.createdAt ?? new Date();
}

/**
 * ลำดับวันที่ที่ลองลงบัญชี — วันแรกที่งวดยังเปิดชนะ: วันที่ในเอกสาร → วันที่รับของ.
 * (หน่วยที่ผ่านเข้าคลังทีหลังต่อท้ายด้วยวันที่รับเข้าคลังเอง)
 */
export function receivingPostingCandidates(receiving: { createdAt: Date; supplierDocDate?: Date | null }): Date[] {
  return receiving.supplierDocDate ? [receiving.supplierDocDate, receiving.createdAt] : [receiving.createdAt];
}

/**
 * หมวดของรายการในใบสั่งซื้อ — ตัวตัดสินบัญชีเจ้าหนี้ (S21-1101 / S21-1102) ทั้งตอนรับของและตอนผ่านเข้าคลัง.
 * เจ้าหนี้ผูกกับสิ่งที่สั่งซื้อจากผู้จัดจำหน่าย ไม่ขยับตามการแก้หมวดสินค้าทีหลัง
 */
export function receivingCategory(poItemCategory: string | null | undefined): ProductCategory {
  return (poItemCategory as ProductCategory) || 'PHONE_NEW';
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
  /** งวดของวันที่ใบรับของ (วันที่ในเอกสาร และวันที่รับของ) ปิดไปแล้ว จึงลงวันที่รับเข้าคลังแทน (stamp ลง metadata ด้วย) */
  postedOnAcceptanceDate: boolean;
  /** งวดของวันที่ในเอกสารปิดแล้ว จึงลงวันที่รับของแทน — วันเดียวกับใบรับของ (แบบ ข) */
  postedOnReceiveDate: boolean;
}

/**
 * ลงบัญชีรับสินค้าของหน่วยที่รับจากใบสั่งซื้อแต่ยังไม่รับเข้าคลังตอนรับของ (มือสองที่รอถ่ายรูป) —
 * คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8: "ลงสินค้าเข้าคลังและเจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง".
 *
 * ประตูที่พาเครื่องจากสถานะก่อนเข้าคลังมา `IN_STOCK` (ยืนยันรูป 6 มุม · PATCH · "นำเข้าคลังพร้อมขาย" ·
 * ปรับสต๊อก "พบของ") เรียก `bookIfPending` ใน tx เดียวกับการเปลี่ยนสถานะ (รายการบัญชีพัง = เครื่องไม่เข้าคลัง) —
 * เส้นทางคืนสภาพ (ยกเลิกสัญญา/ใบขาย/เปลี่ยนเครื่อง · ปลดจอง · ปลดของแถม) ไม่ต้องเรียก เพราะเครื่องเคยผ่านประตู
 * และลงบัญชีมาแล้ว (รายชื่อครบที่หัวไฟล์ `products/product-enter-stock.util.ts`). ไม่ทำอะไรและคืน `null` เมื่อ:
 *   - เครื่องไม่ได้มาจากใบรับของ (รับซื้อมือสอง / ยึดเครื่อง / สร้างเอง)
 *   - รับก่อนระบบลงบัญชีรับของ (`receivedCost` ว่าง — ไม่ลงย้อนหลัง)
 *   - ลงไปแล้ว (`journalEntryId` มีค่า — ลงตอนรับของ หรือเคยผ่านเข้าคลังแล้ว)
 * เครื่องที่ถูกกด "ไม่รับเข้าคลัง" ไม่เคยผ่านที่นี่ จึงไม่มีรายการบัญชีเลย
 *
 * ยอด = `receivedCost` ที่ปันไว้ตอนรับของ (ไม่ใช่ `Product.costPrice` ปัจจุบัน ซึ่งแก้มือได้) —
 * เจ้าหนี้ต้องเท่ากับที่ใบสั่งซื้อตั้งไว้. บัญชีเจ้าหนี้ตามหมวดของรายการในใบสั่งซื้อ (`receivingCategory`)
 * ส่วนบัญชีสินค้าตามหมวดปัจจุบันของเครื่อง — ตอนขาย ต้นทุนขายเครดิตบัญชีสินค้าตามหมวดปัจจุบัน
 *
 * ผู้เรียกต้องเปลี่ยนเครื่องเป็น `IN_STOCK` ใน tx นี้ก่อนเรียก — หลังล็อกแถวแล้วตรวจซ้ำว่าเครื่องยัง
 * `IN_STOCK` และไม่ถูกลบ: กด "ไม่รับเข้าคลัง" ชนกับกดยืนยันรูป แล้วการตีกลับ commit ก่อน ผู้เรียกจะ update
 * สถานะทับเครื่องที่ถูกลบไปแล้ว — ปฏิเสธทั้งรายการแทนการลงสินค้าที่ไม่ได้รับเข้าคลัง
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
        receiving: {
          select: {
            id: true,
            grNumber: true,
            createdAt: true,
            supplierDocType: true,
            supplierDocNumber: true,
            supplierDocDate: true,
            po: { select: { id: true, poNumber: true } },
          },
        },
        poItem: { select: { category: true } },
        product: { select: { category: true, status: true, deletedAt: true } },
      },
    });
    if (!locked || locked.journalEntryId || locked.receivedCost === null || !locked.product) return null;
    if (locked.product.deletedAt || locked.product.status !== 'IN_STOCK') {
      throw new ConflictException(
        'เครื่องนี้เพิ่งถูกตีกลับจากคิวรอถ่ายรูปหรือถูกเปลี่ยนสถานะระหว่างทำรายการ — กรุณารีเฟรชหน้าจอแล้วตรวจสถานะเครื่องอีกครั้ง',
      );
    }

    const shopCompanyId = await this.deps.companies.getShopCompanyId(tx);
    const lotCandidates = receivingPostingCandidates(locked.receiving);
    const candidates = [...lotCandidates, acceptedAt];
    const chosen = await this.firstOpenDate(tx, candidates, shopCompanyId);
    const postedAt = candidates[chosen];
    const postedOnAcceptanceDate = chosen === candidates.length - 1;
    // มีวันที่ในเอกสาร (สองวันแรก = เอกสาร · รับของ) แล้วงวดของวันในเอกสารปิด = ลงวันที่รับของแบบเดียวกับใบรับของ
    const postedOnReceiveDate = lotCandidates.length === 2 && chosen === 1;
    const supplierDoc = {
      type: locked.receiving.supplierDocType,
      number: locked.receiving.supplierDocNumber,
      date: locked.receiving.supplierDocDate,
    };

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
            inventoryAccountCode: this.deps.accounts.resolveProductAccounts(
              locked.product.category as ProductCategory,
            ).inventoryAccountCode,
            payableAccountCode: this.deps.accounts.resolveSupplierPayableAccount(
              receivingCategory(locked.poItem.category),
            ),
            cost: locked.receivedCost,
          },
        ],
        acceptedProductId: productId,
        postedAt,
        postedOnAcceptanceDate,
        postedOnReceiveDate,
        supplierDocRef: supplierDocRef(supplierDoc),
        supplierDocMetadata: supplierDocMetadata(supplierDoc),
      },
      tx,
    );
    if (!posted) return null; // ต้นทุนศูนย์ (ของแถม) — ไม่มีรายการให้ลง

    await tx.goodsReceivingItem.update({
      where: { id: item.id },
      data: { journalEntryId: posted.journalEntryId },
    });
    if (chosen > 0) {
      this.logger.warn(
        `[receiving-acceptance] ${locked.receiving.grNumber} product=${productId}: งวดบัญชีของวันที่ใบรับของปิดแล้ว ` +
          `— ลงวันที่${postedOnAcceptanceDate ? 'รับเข้าคลัง' : 'รับของ'} ${postedAt.toISOString()} แทน (${posted.entryNo})`,
      );
    }
    return { ...posted, postedAt, postedOnAcceptanceDate, postedOnReceiveDate };
  }

  /**
   * วันแรกในลำดับที่งวดยังเปิด: วันที่ในเอกสาร → วันที่รับของ (วันเดียวกับรายการของใบรับของ) → วันที่รับเข้าคลัง —
   * เครื่องรอถ่ายรูปข้ามเดือนหลังปิดงวด ไม่ถูกปฏิเสธการเข้าคลังเพราะงวดบัญชี (พนักงานถ่ายรูปเปิดงวดเองไม่ได้).
   * วันสุดท้าย (วันรับเข้าคลัง) ปิดด้วย = ปฏิเสธตามปกติ
   */
  private async firstOpenDate(tx: Prisma.TransactionClient, candidates: Date[], shopCompanyId: string): Promise<number> {
    for (const [index, date] of candidates.entries()) {
      if (index === candidates.length - 1) {
        await validatePeriodOpen(tx, date, shopCompanyId);
        return index;
      }
      try {
        await validatePeriodOpen(tx, date, shopCompanyId);
        return index;
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e;
      }
    }
    throw new Error('receiving posting date candidates must not be empty');
  }
}
