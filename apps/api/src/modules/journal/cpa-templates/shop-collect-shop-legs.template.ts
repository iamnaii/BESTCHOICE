import { Prisma } from '@prisma/client';
import { resolveContractLabel } from '../contract-label.util';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { ShopAccountResolver } from '../shop-account-resolver.service';

/**
 * ขาคู่ฝั่ง SHOP ของ 11-2107 ที่เกิดจากการยึด/รับเครื่องคืน (JP5).
 *
 * ใบรับเครื่องคืน (`postRepossessionIntake`, spec 2026-09-20 §6.1) — mirror ของ A.4 `shop-exchange-return`:
 *   Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง            [ราคาประเมิน]
 *     Cr S21-1104 เจ้าหนี้ FINANCE                     [ราคาประเมิน]   ← FINANCE Dr 11-2107 typed DEVICE_RETURN
 *   ค้างจ่ายเสมอ — ค่าเครื่องหักจากยอดโอนในรอบจ่าย INTER-CO (แถวหักประเภทที่ 3) หรือรับเงินสด
 *   ผ่าน `POST /interco-settlement/device-returns/:contractId/settle-cash`. สาขา "โอนให้ FINANCE ทันที"
 *   (Cr S11-1202) ถูกลบ 2026-09-20: วันรับเครื่องไม่มีการโอนเงินจริง.
 *
 * ใบล้างเจ้าหนี้ (`postSettlement`) — คู่ของ `ShopCollectSettlementTemplate` (FINANCE Dr KBank / Cr 11-2107)
 * สำหรับแถวเก่าที่แท็ก SHOP_COLLECT (forward-only spec §6.6):
 *   Dr S21-1104 เจ้าหนี้ FINANCE                       [amount]
 *     Cr S11-1202 ธนาคาร SHOP (จ่าย)                   [amount]
 *
 * ทั้งสองใบ stamp `shopReceivableType` + `metadata.contractId` ให้เลนส์ S21-1104 (aging Query B /
 * drift / typed balances) จัดประเภทได้ — B2 รอบ 2 (ผู้สอบ 2026-08-25): S21-1104 รับทุกประเภท
 * แต่ต้องแยกแสดงด้วย metadata.
 *
 * ไม่ใช่ Nest provider โดยตั้งใจ — สร้างด้วย `new ShopCollectShopLegs(journalAuto)` ในผู้เรียก
 * (pattern เดียวกับ `TradeInValuationService` ใน RepossessionsService). Idempotency = `metadata.flow
 * + idempotencyKey` (DB partial unique index) — ผู้เรียกตรวจ dedupe ของใบ FINANCE ก่อนแล้วจึงเรียก.
 */
export const SHOP_REPOSSESSION_INTAKE_FLOW = 'shop-repossession-intake';
export const SHOP_COLLECT_SETTLEMENT_SHOP_FLOW = 'shop-collect-settlement-shop';

/** สินค้าคงคลัง-มือถือมือสอง — เครื่องยึดเป็นมือสองเสมอ (category ถูก flip เป็น PHONE_USED ตอนยึด) */
const SHOP_USED_INVENTORY = 'S11-2002';
const SHOP_FINANCE_PAYABLE = 'S21-1104';

export interface ShopRepossessionIntakeInput {
  contractId: string;
  contractNumber: string;
  productId: string;
  /** ราคาประเมิน = ยอดที่ JP5 ลง Dr 11-2107 ฝั่ง FINANCE (ราคาเดียว 2026-09-05) */
  appraisal: Decimal;
  shopCompanyId: string;
  /** ใบรับเครื่องคืนต้นทาง — stamp ลง metadata คู่กับ JP5 */
  deviceReturnId?: string;
  postedAt?: Date;
}

export interface ShopCollectSettlementShopInput {
  contractId: string;
  amount: Decimal;
  shopCompanyId: string;
  /** requestId ของใบ FINANCE — ใช้เป็น idempotency key คู่กัน */
  requestId?: string;
  postedAt?: Date;
}

export class ShopCollectShopLegs {
  constructor(private readonly journal: JournalAutoService) {}

  async postRepossessionIntake(
    input: ShopRepossessionIntakeInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const amount = new Decimal(input.appraisal.toString());
    if (amount.lte(0)) {
      throw new Error(`ShopCollectShopLegs: appraisal must be > 0 (received ${amount.toString()})`);
    }
    const zero = new Decimal(0);
    return this.journal.createAndPost(
      {
        description: `รับเครื่องคืนเข้าสต็อก SHOP — สัญญา ${input.contractNumber} (ค่าเครื่องค้างจ่าย FINANCE — หักในรอบจ่าย INTER-CO)`,
        reference: `contract:${input.contractId}:repossession-intake`,
        postedAt: input.postedAt,
        metadata: {
          flow: SHOP_REPOSSESSION_INTAKE_FLOW,
          idempotencyKey: `${SHOP_REPOSSESSION_INTAKE_FLOW}:${input.contractId}`,
          contractId: input.contractId,
          productId: input.productId,
          companyCode: 'SHOP',
          appraisal: amount.toFixed(2),
          // ขาคู่ของ 11-2107 DEVICE_RETURN — เลนส์ S21-1104 key ด้วย metadata.contractId (Phase 1)
          shopReceivableType: 'DEVICE_RETURN',
          ...(input.deviceReturnId ? { deviceReturnId: input.deviceReturnId } : {}),
        },
        companyId: input.shopCompanyId,
        lines: [
          {
            accountCode: SHOP_USED_INVENTORY,
            dr: amount,
            cr: zero,
            description: 'รับเครื่องคืนเข้าสต็อก SHOP (มือสอง — ราคาประเมิน)',
          },
          {
            accountCode: SHOP_FINANCE_PAYABLE,
            dr: zero,
            cr: amount,
            description: 'เจ้าหนี้-FINANCE ค่าเครื่องคืน (หักในรอบจ่าย INTER-CO)',
          },
        ],
      },
      tx,
    );
  }

  async postSettlement(
    input: ShopCollectSettlementShopInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const amount = new Decimal(input.amount.toString());
    if (amount.lte(0)) {
      throw new Error(`ShopCollectShopLegs: amount must be > 0 (received ${amount.toString()})`);
    }
    const zero = new Decimal(0);
    const key = input.requestId ?? amount.toFixed(2);
    // เลขสัญญาแทน UUID (เหมือนใบ FINANCE คู่กัน) — ไม่มี tx = ไม่มี client ให้ค้น ใช้ slice ตามเดิม
    const contractLabel = tx
      ? await resolveContractLabel(tx, input.contractId)
      : input.contractId.slice(0, 8);
    return this.journal.createAndPost(
      {
        description: `โอนเงินให้ FINANCE ล้างเจ้าหนี้ค่าเครื่องยึด/เงินที่รับแทน — สัญญา ${contractLabel}`,
        reference: `contract:${input.contractId}:shop-collect-settlement-shop:${key}`,
        postedAt: input.postedAt,
        metadata: {
          flow: SHOP_COLLECT_SETTLEMENT_SHOP_FLOW,
          idempotencyKey: `${SHOP_COLLECT_SETTLEMENT_SHOP_FLOW}:${input.contractId}:${key}`,
          contractId: input.contractId,
          companyCode: 'SHOP',
          amount: amount.toFixed(2),
          shopReceivableType: 'SHOP_COLLECT',
          ...(input.requestId ? { requestId: input.requestId } : {}),
        },
        companyId: input.shopCompanyId,
        lines: [
          {
            accountCode: SHOP_FINANCE_PAYABLE,
            dr: amount,
            cr: zero,
            description: 'ล้างเจ้าหนี้-FINANCE (โอนเงินแล้ว)',
          },
          {
            accountCode: ShopAccountResolver.SHOP_PAYING_BANK,
            dr: zero,
            cr: amount,
            description: 'โอนเงินให้ FINANCE',
          },
        ],
      },
      tx,
    );
  }
}
