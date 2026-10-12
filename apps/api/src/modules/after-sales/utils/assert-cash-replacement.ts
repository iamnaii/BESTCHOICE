import { BadRequestException } from '@nestjs/common';
import type { Prisma, ProductCategory, ProductStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { assertSameTestSide, TEST_SIDE_CUSTOMER_SELECT } from '../../../utils/test-data-markers';

/**
 * PR 5 §3.3 — ด่านเครื่องทดแทนของเปลี่ยนรุ่นเดิม **ขายสด** (ไม่มีสัญญา จึงใช้
 * `DefectExchangeService.checkEligibility` ไม่ได้). ฟังก์ชันเดียว เรียกสองจุด: ตอนแจ้งปัญหา
 * (`AfterSalesCaseService.createCase`) และตอน ผจก. ยืนยัน (`AfterSalesExchangeService.confirmCashSameModel`
 * — ใน tx ด้วยข้อมูลสด). ไม่มีข้อไหนข้ามได้ (คำตัดสินเจ้าของ ⑥ ไม่มี override)
 */
export const CASH_REPLACEMENT_MSG = {
  NOT_FOUND: 'ไม่พบเครื่องทดแทนในระบบ',
  SAME_DEVICE: 'เครื่องทดแทนต้องไม่ใช่เครื่องเดิมของใบขาย',
  NOT_USED: 'เปลี่ยนรุ่นเดิมขายสดใช้ได้เฉพาะเครื่องมือสอง (PHONE_USED)',
  NOT_IN_STOCK: 'เครื่องทดแทนต้องอยู่ในสต๊อกพร้อมขาย (IN_STOCK)',
  WRONG_BRANCH: 'เครื่องทดแทนต้องอยู่สาขาเดียวกับเคส',
  MODEL_MISMATCH: 'เครื่องทดแทนต้องเป็นยี่ห้อ/รุ่น/ความจุเดียวกับเครื่องเดิม',
} as const;

export interface CashReplacementInput {
  sale: { id: string; productId: string; customerId: string };
  caseBranchId: string;
}

export interface CashReplacementProduct {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  imeiSerial: string | null;
  costPrice: Prisma.Decimal;
  category: ProductCategory;
  status: ProductStatus;
  branchId: string | null;
}

export async function assertCashReplacement(
  client: Prisma.TransactionClient | PrismaService,
  input: CashReplacementInput,
  replacementProductId: string,
): Promise<CashReplacementProduct> {
  if (replacementProductId === input.sale.productId) {
    throw new BadRequestException(CASH_REPLACEMENT_MSG.SAME_DEVICE);
  }
  const [old, next, customer] = await Promise.all([
    client.product.findUnique({
      where: { id: input.sale.productId },
      select: { id: true, brand: true, model: true, storage: true },
    }),
    // รั้วข้อมูลทดสอบต้องเห็น PO ต้นทาง (ชนิดของ TestSideProduct บังคับ) — รูปเดียวกับ DefectExchangeService
    client.product.findUnique({
      where: { id: replacementProductId },
      include: { po: { select: { poNumber: true } } },
    }),
    client.customer.findUniqueOrThrow({
      where: { id: input.sale.customerId },
      select: TEST_SIDE_CUSTOMER_SELECT,
    }),
  ]);
  if (!old) throw new BadRequestException('ไม่พบเครื่องเดิมของใบขาย');
  if (!next || next.deletedAt) throw new BadRequestException(CASH_REPLACEMENT_MSG.NOT_FOUND);
  if (next.category !== 'PHONE_USED') throw new BadRequestException(CASH_REPLACEMENT_MSG.NOT_USED);
  if (next.status !== 'IN_STOCK') throw new BadRequestException(CASH_REPLACEMENT_MSG.NOT_IN_STOCK);
  if (next.branchId !== input.caseBranchId) {
    throw new BadRequestException(CASH_REPLACEMENT_MSG.WRONG_BRANCH);
  }
  if (
    next.brand !== old.brand ||
    next.model !== old.model ||
    (next.storage ?? null) !== (old.storage ?? null)
  ) {
    throw new BadRequestException(CASH_REPLACEMENT_MSG.MODEL_MISMATCH);
  }
  assertSameTestSide(customer, next);
  return {
    id: next.id,
    brand: next.brand,
    model: next.model,
    storage: next.storage,
    imeiSerial: next.imeiSerial,
    costPrice: next.costPrice,
    category: next.category,
    status: next.status,
    branchId: next.branchId,
  };
}
