import { Prisma } from '@prisma/client';
import { resolveContractLabel } from '../contract-label.util';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { ShopAccountResolver } from '../shop-account-resolver.service';

/**
 * ขาคู่ฝั่ง SHOP ของ 11-2107 ประเภท SHOP_COLLECT ที่เกิดจากการ **ยึดเครื่อง** (JP5) —
 * คำตัดสินเจ้าของ 2026-09-05 (ราคาเดียว + ไม่มีเงินคืน) ปิดช่อง "ASYMMETRY ที่รู้ตัว"
 * ใน accounting.md สำหรับต้นทาง JP5. (ต้นทาง JP4 ปิดยอดหน้าร้านรับแทน **ยังไม่ต่อ** —
 * ต้องเลือกบัญชีเงินสด SHOP ต่อสาขาซึ่งเป็นด่าน fail-closed ของ `resolveBranchCashAccount`;
 * ใบ settle ด้านล่างจึงโพสต์ขา SHOP เฉพาะเมื่อ S21-1104 typed SHOP_COLLECT ของสัญญานั้น
 * คุ้มยอด — แถวต้นทาง JP4 / แถวก่อนฟีเจอร์นี้จะถูกข้ามพร้อม flag ใน audit.)
 *
 * ใบรับเครื่องยึด (`postRepossessionIntake`) — mirror ของ A.4 `shop-exchange-return`:
 *   Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง            [ราคาประเมิน]
 *     Cr S21-1104 เจ้าหนี้ FINANCE                     [ราคาประเมิน]   ← collectedByShop (FINANCE Dr 11-2107)
 *     Cr S11-1202 ธนาคาร SHOP (จ่าย)                   [ราคาประเมิน]   ← หน้าร้านโอนให้ FINANCE ทันที (FINANCE Dr KBank)
 *
 * ใบล้างเจ้าหนี้ (`postSettlement`) — คู่ของ `ShopCollectSettlementTemplate` (FINANCE Dr KBank / Cr 11-2107):
 *   Dr S21-1104 เจ้าหนี้ FINANCE                       [amount]
 *     Cr S11-1202 ธนาคาร SHOP (จ่าย)                   [amount]
 *
 * ทั้งสองใบ stamp `shopReceivableType: 'SHOP_COLLECT'` + `metadata.contractId` ให้เลนส์
 * S21-1104 (aging Query B / drift / `shopCollectShopBalance`) จัดประเภทได้ — B2 รอบ 2
 * (ผู้สอบ 2026-08-25): S21-1104 รับทุกประเภท แต่ต้องแยกแสดงด้วย metadata.
 *
 * ไม่ใช่ Nest provider โดยตั้งใจ — สร้างด้วย `new ShopCollectShopLegs(journalAuto)` ในผู้เรียก
 * (pattern เดียวกับ `TradeInValuationService` ใน RepossessionsService) เพื่อไม่แตะ constructor
 * ที่มีจุดสร้างใน spec หลายแห่ง. Idempotency = `metadata.flow + idempotencyKey` (DB partial
 * unique index) — ผู้เรียมตรวจ dedupe ของใบ FINANCE ก่อนแล้วจึงเรียก.
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
  /** ราคาประเมิน = ยอดที่ JP5 ลง Dr ฝั่ง FINANCE (ราคาเดียว 2026-09-05) */
  appraisal: Decimal;
  /** true = FINANCE ตั้งลูกหนี้-หน้าร้าน 11-2107 (SHOP ค้างจ่าย) · false = FINANCE รับเงินเข้า KBank แล้ว (SHOP จ่ายทันที) */
  collectedByShop: boolean;
  shopCompanyId: string;
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
    const creditAccount = input.collectedByShop
      ? SHOP_FINANCE_PAYABLE
      : ShopAccountResolver.SHOP_PAYING_BANK;
    return this.journal.createAndPost(
      {
        description: `รับเครื่องยึดเข้าสต็อก SHOP — สัญญา ${input.contractNumber} (${
          input.collectedByShop ? 'ค้างจ่าย FINANCE' : 'โอนให้ FINANCE แล้ว'
        })`,
        reference: `contract:${input.contractId}:repossession-intake`,
        postedAt: input.postedAt,
        metadata: {
          flow: SHOP_REPOSSESSION_INTAKE_FLOW,
          idempotencyKey: `${SHOP_REPOSSESSION_INTAKE_FLOW}:${input.contractId}`,
          contractId: input.contractId,
          productId: input.productId,
          companyCode: 'SHOP',
          appraisal: amount.toFixed(2),
          collectedByShop: input.collectedByShop,
          // เฉพาะเคสค้างจ่าย — ใบที่จ่ายทันทีไม่มีหนี้ระหว่างกิจการให้เลนส์ตาม
          ...(input.collectedByShop ? { shopReceivableType: 'SHOP_COLLECT' } : {}),
        },
        companyId: input.shopCompanyId,
        lines: [
          {
            accountCode: SHOP_USED_INVENTORY,
            dr: amount,
            cr: zero,
            description: 'รับเครื่องยึดเข้าสต็อก SHOP (มือสอง — ราคาประเมิน)',
          },
          {
            accountCode: creditAccount,
            dr: zero,
            cr: amount,
            description: input.collectedByShop
              ? 'เจ้าหนี้-FINANCE ค่าเครื่องยึด (รอโอนให้ FINANCE)'
              : 'โอนค่าเครื่องยึดให้ FINANCE',
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
