import { Prisma, type InterCoItemType } from '@prisma/client';
import type { JeLineInput } from '../journal/journal-auto.service';

/** Pure journal construction from approved batch snapshots; posting stays in the service transaction. */
const ITEM_ROLE = {
  SETTLEMENT: 'PAYABLE',
  RECALL: 'DEDUCTION_ONLY',
  DEVICE_RETURN: 'DEDUCTION_ONLY',
} as const satisfies Record<InterCoItemType, 'PAYABLE' | 'DEDUCTION_ONLY'>;

export const DEDUCTION_ONLY_TYPES = (Object.keys(ITEM_ROLE) as InterCoItemType[]).filter(
  (t) => ITEM_ROLE[t] === 'DEDUCTION_ONLY',
);

export function isPayableRow(itemType: InterCoItemType): boolean {
  return ITEM_ROLE[itemType] === 'PAYABLE';
}

export type BatchWithItems = Prisma.InterCoSettlementBatchGetPayload<{
  include: {
    items: {
      include: { contract: { select: { contractNumber: true } } };
    };
  };
}>;

/**
 * ยอดหัก + คำอธิบายบรรทัดหัก (FINANCE `Cr 11-2107` / SHOP `Dr S21-1104`) ของ item หนึ่งแถว
 * ตามประเภท — แหล่งเดียวของ mapping itemType → คอลัมน์ snapshot/ข้อความ (ห้าม inline ternary
 * ซ้ำ): SETTLEMENT = เครดิตเปลี่ยนเครื่อง (swap), RECALL = เรียกคืนยกเลิก (C-2),
 * DEVICE_RETURN = ค่าเครื่องคืน (ใบรับเครื่องคืน 2026-09-20 §6.3).
 */
function deductionOf(item: BatchWithItems['items'][number]): {
  amount: Prisma.Decimal;
  financeDescription: string;
  shopDescription: string;
} {
  const no = item.contract.contractNumber;
  switch (item.itemType) {
    case 'RECALL':
      return {
        amount: item.recallAmount,
        financeDescription: `หักเรียกคืนจากยกเลิก ${no}`,
        shopDescription: `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก ${no}`,
      };
    case 'DEVICE_RETURN':
      return {
        amount: item.deviceReturnAmount,
        financeDescription: `หักค่าเครื่องคืน ${no}`,
        shopDescription: `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน ${no}`,
      };
    default:
      return {
        amount: item.swapCreditAmount,
        financeDescription: `หักเครดิตเปลี่ยนเครื่อง ${no}`,
        shopDescription: `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน ${no}`,
      };
  }
}

/**
 * Dr 21-1101 per SETTLEMENT contract (always) + Dr 21-1102 per contract
 * (skip zero) + Cr 11-2107 per deduction (swap credit / recall / device
 * return — Phase 2 หักกลบ workbook จุดที่ 3 + ใบรับเครื่องคืน 2026-09-20 §6.3)
 * + Cr bank = netTransferAmount (skip when 0 — รอบที่หักจนเงินโอนจริงเป็นศูนย์
 * ต้องไม่มีบรรทัดธนาคาร). Deduction-only rows (RECALL / DEVICE_RETURN) carry
 * no payable snapshot of their own — they contribute ONLY the Cr 11-2107 leg
 * (never a zero-amount Dr 21-1101 line).
 */
export function buildFinanceLines(batch: BatchWithItems, description: string): JeLineInput[] {
  const zero = new Prisma.Decimal(0);
  const lines: JeLineInput[] = [];
  for (const item of batch.items) {
    if (!isPayableRow(item.itemType)) continue;
    lines.push({
      accountCode: '21-1101',
      dr: item.financedGl,
      cr: zero,
      description: `ล้างเจ้าหนี้ยอดจัด ${item.contract.contractNumber}`,
    });
  }
  for (const item of batch.items) {
    if (item.commissionGl.gt(0)) {
      lines.push({
        accountCode: '21-1102',
        dr: item.commissionGl,
        cr: zero,
        description: `ล้างเจ้าหนี้ค่าคอม ${item.contract.contractNumber}`,
      });
    }
  }
  for (const item of batch.items) {
    const deduction = deductionOf(item);
    if (deduction.amount.gt(0)) {
      lines.push({
        accountCode: '11-2107',
        dr: zero,
        cr: deduction.amount,
        description: deduction.financeDescription,
      });
    }
  }
  // Pre-Phase 2 batches have no netTransferAmount snapshot — fall back to
  // the gross total (identical: their totalDeduction is definitionally 0).
  const netCash = batch.netTransferAmount ?? batch.totalAmount;
  if (netCash.gt(0)) {
    lines.push({
      accountCode: batch.financeBankCode,
      dr: zero,
      cr: netCash,
      description,
    });
  }
  return lines;
}

/**
 * Dr shopBankCode = shopNetAmount (skip when 0) + Dr S21-1104 per deduction
 * row (ล้างเจ้าหนี้ FINANCE ฝั่ง SHOP — Phase 2 หักกลบ: SWAP_CREDIT ของ
 * settlement items, RECALL rows และ DEVICE_RETURN rows) + Cr S11-3001
 * per-contract (always) + Cr S11-3002 per-contract (skip zero) — settlement
 * legs ONLY over SETTLEMENT items with `legacyNoShop=false`. Empty array = no
 * SHOP half at all (caller skips `postPaired` and posts FINANCE alone via
 * `JournalAutoService`).
 */
export function buildShopLines(batch: BatchWithItems): JeLineInput[] {
  const zero = new Prisma.Decimal(0);
  const shopItems = batch.items.filter((i) => i.itemType === 'SETTLEMENT' && !i.legacyNoShop);
  const deductionItems = batch.items.filter((i) => deductionOf(i).amount.gt(0));
  if (shopItems.length === 0 && deductionItems.length === 0) return [];

  const lines: JeLineInput[] = [];
  // Pre-Phase 2 batches have no shopNetAmount snapshot — fall back to the
  // gross posted amount (identical: their totalDeduction is definitionally 0).
  const shopNet = batch.shopNetAmount ?? batch.shopPostedAmount;
  if (shopNet.gt(0)) {
    lines.push({
      accountCode: batch.shopBankCode,
      dr: shopNet,
      cr: zero,
      description: `รับโอนจาก FINANCE รอบ ${batch.batchNumber}`,
    });
  }
  for (const item of deductionItems) {
    const deduction = deductionOf(item);
    lines.push({
      accountCode: 'S21-1104',
      dr: deduction.amount,
      cr: zero,
      description: deduction.shopDescription,
    });
  }
  for (const item of shopItems) {
    lines.push({
      accountCode: 'S11-3001',
      dr: zero,
      cr: item.shopFinancedGl,
      description: `ล้างลูกหนี้ FINANCE-ยอดจัด ${item.contract.contractNumber}`,
    });
  }
  for (const item of shopItems) {
    if (item.shopCommissionGl.gt(0)) {
      lines.push({
        accountCode: 'S11-3002',
        dr: zero,
        cr: item.shopCommissionGl,
        description: `ล้างลูกหนี้ FINANCE-ค่าคอม ${item.contract.contractNumber}`,
      });
    }
  }
  return lines;
}
