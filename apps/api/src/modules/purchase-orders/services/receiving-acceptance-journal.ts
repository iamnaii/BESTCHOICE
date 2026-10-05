import { ConflictException, Logger } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopGoodsReceivingTemplate } from '../../journal/cpa-templates/shop-goods-receiving.template';
import { ShopSupplierPaymentTemplate } from '../../journal/cpa-templates/shop-supplier-payment.template';
import { SupplierPaymentService } from './supplier-payment.service';
import { isPeriodClosedForBackdating, supplierDocMetadata, supplierDocRef } from './supplier-doc.util';
import { formatDateShort, formatMonthName } from '../../../utils/thai-date.util';
import { bangkokCalendarParts } from '../../../utils/date.util';

/**
 * วันที่ลงบัญชีรับสินค้าของใบรับของ — จุดเดียวที่ตัดสิน ใช้ทั้งรายการตอนรับของและหน่วยที่ลงตอนผ่านเข้าคลัง.
 * ลำดับที่ลอง (วันแรกที่ใช้ได้ชนะ): **วันที่ในเอกสารของผู้จัดจำหน่าย** (คำตอบฝ่ายบัญชีข้อ ข3 2026-09-29 · แบบหน้าจอที่เจ้าของเคาะ
 * 2026-10-01) → **วันที่รับของ** (แบบ ข: งวดของวันที่ในเอกสารปิดแล้ว — ตัดสินด้วย `isPeriodClosedForBackdating` ไม่มีช่วงผ่อนผัน).
 * ไม่มีเอกสาร / ใบรับของก่อนมีช่องนี้ = วันที่รับของอย่างเดียว. หน่วยที่ผ่านเข้าคลังทีหลังต่อท้ายด้วยวันที่รับเข้าคลังเอง
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
  /** ก้อน 2 — หักมัดจำเข้าเจ้าหนี้ของหน่วยที่เพิ่งลง */
  payments: SupplierPaymentService;
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
    const accounts = deps.accounts ?? new ShopAccountResolver(prisma);
    const journal = new JournalAutoService(prisma);
    this.deps = {
      companies,
      accounts,
      template: deps.template ?? new ShopGoodsReceivingTemplate(journal, prisma, companies),
      payments:
        deps.payments ??
        new SupplierPaymentService(prisma, { template: new ShopSupplierPaymentTemplate(journal, prisma, companies), accounts, companies }),
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
            receivedById: true,
            supplierDocType: true,
            supplierDocNumber: true,
            supplierDocDate: true,
            po: { select: { id: true, poNumber: true, supplierId: true, supplier: { select: { name: true } } } },
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

    const payableAccountCode = this.deps.accounts.resolveSupplierPayableAccount(receivingCategory(locked.poItem.category));
    const posted = await this.deps.template.execute(
      {
        idempotencyKey: `shop-goods-receiving-unit:${productId}`,
        receivingId: locked.receiving.id,
        grNumber: locked.receiving.grNumber,
        poId: locked.receiving.po.id,
        poNumber: locked.receiving.po.poNumber,
        supplierId: locked.receiving.po.supplierId,
        supplierName: locked.receiving.po.supplier.name,
        units: [
          {
            productId,
            inventoryAccountCode: this.deps.accounts.resolveProductAccounts(
              locked.product.category as ProductCategory,
            ).inventoryAccountCode,
            payableAccountCode,
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
    // ก้อน 2 (ข้อสมมติ ค): มัดจำค้างของใบสั่งซื้อหักเข้าเจ้าหนี้ที่เพิ่งตั้งให้หน่วยนี้ วันเดียวกับรายการของหน่วย
    await this.deps.payments.applyDepositInTx(tx, locked.receiving.po.id, {
      receivingId: locked.receiving.id,
      grNumber: locked.receiving.grNumber,
      postedAt,
      userId: locked.receiving.receivedById,
    });
    if (chosen > 0) {
      this.logger.warn(
        `[receiving-acceptance] ${locked.receiving.grNumber} product=${productId}: งวดบัญชีของวันที่ใบรับของปิดแล้ว ` +
          `— ลงวันที่${postedOnAcceptanceDate ? 'รับเข้าคลัง' : 'รับของ'} ${postedAt.toISOString()} แทน (${posted.entryNo})`,
      );
      // ทุกวันที่ที่ถูกข้าม (เอกสาร · รับของ) — ปิดสองเดือนต้องบอกทั้งสองเดือน ไม่ใช่แค่เดือนล่าสุด
      const labels = lotCandidates.length === 2 ? ['วันที่ในเอกสาร', 'วันที่รับของ'] : ['วันที่รับของ'];
      const skipped = candidates.slice(0, chosen).map((date, i) => ({ label: labels[i], date }));
      await this.notifyAccounting(tx, locked.receiving, posted.entryNo, postedAt, skipped, postedOnAcceptanceDate);
    }
    return { ...posted, postedAt, postedOnAcceptanceDate, postedOnReceiveDate };
  }

  /**
   * วันแรกในลำดับที่งวดยังเปิด: วันที่ในเอกสาร → วันที่รับของ (วันเดียวกับรายการของใบรับของ) → วันที่รับเข้าคลัง —
   * เครื่องรอถ่ายรูปข้ามเดือนหลังปิดงวด ไม่ถูกปฏิเสธการเข้าคลังเพราะงวดบัญชี (พนักงานถ่ายรูปเปิดงวดเองไม่ได้).
   * ทุกวันก่อนวันสุดท้ายคือการลงย้อนหลัง ⇒ ตัดสินด้วย `isPeriodClosedForBackdating` (สถานะงวด ไม่มีช่วงผ่อนผัน — ไม่งั้น
   * เครื่องที่เข้าคลังต้นเดือนจะลงวันที่รับของกลับเข้าเดือนที่ฝ่ายบัญชีเพิ่งปิด). วันสุดท้าย (วันรับเข้าคลัง = วันนี้) ใช้
   * `validatePeriodOpen` ตามกติกาทั้งระบบ — เดือนปัจจุบันลงได้ตลอดช่วงผ่อนผัน จึงแทบไม่ถูกปฏิเสธ (ฝ่ายบัญชีปิดเดือนปัจจุบัน
   * ก่อนสิ้นเดือน = ลงในเดือนนั้นพร้อม stamp `postedOnAcceptanceDate` + งานแจ้ง) · ปิดและพ้นช่วงผ่อนผันแล้ว = ปฏิเสธ
   */
  private async firstOpenDate(tx: Prisma.TransactionClient, candidates: Date[], shopCompanyId: string): Promise<number> {
    const last = candidates.length - 1;
    for (const [index, date] of candidates.entries()) {
      if (index === last) {
        await validatePeriodOpen(tx, date, shopCompanyId);
        return index;
      }
      if (!(await isPeriodClosedForBackdating(tx, date, shopCompanyId))) return index;
    }
    throw new Error('receiving posting date candidates must not be empty');
  }

  /**
   * แจ้งฝ่ายบัญชีเมื่อหน่วยลงบัญชีไม่ตรงวันที่ของใบรับของ (งวดปิดระหว่างที่เครื่องรอถ่ายรูป) — งานในหน้า "งานของทีม" (`/todos`)
   * ใบเดียวต่อ (ใบรับของ, วันที่ที่ลงแทน) ด้วยแท็ก `receivingPeriodTodoKey` — งานตอนรับของใช้คีย์ "รับของ" เดียวกัน (มันบอกเรื่อง
   * เครื่องรอถ่ายรูปไว้แล้ว) ส่วนเครื่องที่ตกไปลงวันที่รับเข้าคลัง (คนละเดือน คนละรายการ) ได้งานของตัวเอง.
   * สร้างใน tx เดียวกับรายการบัญชี (มาด้วยกัน/ไม่มาทั้งคู่) — ผู้สร้าง = ผู้รับของ (ประตูเข้าคลังบางทางไม่มีผู้กดส่งมา)
   */
  private async notifyAccounting(
    tx: Prisma.TransactionClient,
    receiving: { grNumber: string; receivedById: string; po: { poNumber: string } },
    entryNo: string,
    postedAt: Date,
    skipped: { label: string; date: Date }[],
    onAcceptanceDate: boolean,
  ): Promise<void> {
    const key = receivingPeriodTodoKey(receiving.grNumber, onAcceptanceDate ? 'acceptance' : 'receive');
    const open = await tx.todo.findFirst({
      where: { tags: { hasEvery: [RECEIVING_PERIOD_TODO_TAG, key] }, status: { not: 'DONE' }, deletedAt: null },
      select: { id: true },
    });
    if (open) return;
    const which = onAcceptanceDate ? 'รับเข้าคลัง' : 'รับของ';
    const monthOf = (d: Date) => `${formatMonthName(d)} ${bangkokCalendarParts(d).year + 543}`;
    const months = [...new Set(skipped.map((s) => monthOf(s.date)))].join(' และ ');
    const skippedText = skipped.map((s) => `${s.label} (${formatDateShort(s.date)})`).join(' และ');
    await tx.todo.create({
      data: {
        title: `รับสินค้า ${receiving.grNumber} เครื่องที่เข้าคลังทีหลังลงบัญชีวันที่${which}แทน (งวด${months}ปิดแล้ว)`,
        description:
          `เครื่องจากใบรับของนี้ผ่านเข้าคลังหลังฝ่ายบัญชีปิดงวดของ${skippedText} — ระบบลงรายการ ` +
          `${entryNo} วันที่${which} ${formatDateShort(postedAt)} แทน · ใบสั่งซื้อ ${receiving.po.poNumber}\n` +
          `เครื่องอื่นของใบรับของเดียวกันที่ลงวันที่${which}แทนเหมือนกันจะไม่สร้างงานซ้ำจนกว่างานนี้เสร็จ — ` +
          'ตรวจว่าต้องปรับปรุงรายการหรือไม่ ระบบไม่ลงรายการปรับปรุงให้อัตโนมัติ',
        priority: 'MEDIUM',
        tags: [RECEIVING_PERIOD_TODO_TAG, key],
        createdById: receiving.receivedById,
      },
    });
  }
}

/** แท็กงานแจ้งฝ่ายบัญชีเรื่องวันที่ลงบัญชีรับสินค้าไม่ตรงเอกสาร (ข3) — ใช้ทั้งตอนรับของและตอนหน่วยเข้าคลังทีหลัง */
export const RECEIVING_PERIOD_TODO_TAG = 'goods-receiving-period';

/**
 * แท็กกันงานซ้ำ: ใบรับของ + วันที่ที่ลงแทน (`receive` = วันที่รับของ · `acceptance` = วันที่รับเข้าคลัง).
 * เทียบทั้งแท็ก ไม่ค้นจากชื่องาน — เลขใบรับของเติมศูนย์แค่ 3 หลัก (GR-…-100 เป็นส่วนหนึ่งของ GR-…-1000) และชื่องานแก้ได้
 */
export function receivingPeriodTodoKey(grNumber: string, postedOn: 'receive' | 'acceptance'): string {
  return `gr:${grNumber}:${postedOn}`;
}
