import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * SHOP — รับสินค้าเข้าจากใบสั่งซื้อ (goods receiving).
 *
 * คำตัดสินเจ้าของ 2026-09-29 + คำตอบฝ่ายบัญชี 2026-09-29 (ข้อ ข1 ข2 ข5):
 *
 *   Dr S11-2001 / S11-2002 / S11-2003 สินค้าคงคลัง (ตามประเภท)   [ต้นทุนของหน่วยที่รับ]
 *      Cr S21-1101 เจ้าหนี้ - ซัพพลายเออร์มือถือ (มือถือ แท็บเล็ต)
 *      Cr S21-1102 เจ้าหนี้ - อุปกรณ์เสริม
 *
 * หนึ่งใบรับของ (GoodsReceiving) = หนึ่งรายการบัญชี ของหน่วยที่เข้าคลังได้ทันที — ใบสั่งซื้อที่รับ
 * หลายครั้งลงตามจำนวนที่รับจริงแต่ละครั้ง. หน่วยที่ต้องรอถ่ายรูป (ยังไม่รับเข้าคลัง) ลงทีละหน่วย
 * ตอนผ่านเข้าคลัง (`acceptedProductId`) — คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8 "ลงสินค้าเข้าคลังและ
 * เจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง". ต้นทุนของแต่ละหน่วยเป็นราคารวม VAT หลังแบ่งส่วนลดท้ายบิลแล้ว
 * (ผู้เรียกคำนวณจาก `po-unit-cost.util` และเขียนค่าเดียวกันลง `Product.costPrice` —
 * ตอนขาย ต้นทุนขายเครดิตบัญชีสินค้าด้วย `costPrice` ตัวนั้น บัญชีจึงกลับเป็นศูนย์พอดี)
 *
 * SHOP ไม่จด VAT — ไม่มีบรรทัดภาษีซื้อในรายการนี้. การนำภาษีซื้อของเครื่องที่ขายผ่อน
 * ในเครือไปใช้เป็นเรื่องของสมุดไฟแนนซ์ (ยังรอคำตอบฝ่ายบัญชี — ไม่อยู่ใน template นี้)
 *
 * จงใจไม่ stamp `contractId` / `saleId` — ตัวกวาดยกเลิกสัญญาและยกเลิกใบขายเก็บตาม key
 * สองตัวนั้น รายการรับของต้องอยู่นอกการกวาด
 */
export interface ShopGoodsReceivingUnit {
  productId: string;
  /** S11-2001 (ใหม่/แท็บเล็ต) · S11-2002 (มือสอง) · S11-2003 (อุปกรณ์เสริม) */
  inventoryAccountCode: string;
  /** S21-1101 (มือถือ) · S21-1102 (อุปกรณ์เสริม) */
  payableAccountCode: string;
  cost: Decimal;
}

export interface ShopGoodsReceivingInput {
  /** `shop-goods-receiving:<receivingId>` · หน่วยที่ลงตอนผ่านเข้าคลัง `shop-goods-receiving-unit:<productId>` */
  idempotencyKey: string;
  receivingId: string;
  grNumber: string;
  poId: string;
  poNumber: string;
  /** หน่วยที่ตรวจผ่านและเข้าคลังในใบรับของนี้ — หน่วยที่ตรวจไม่ผ่านหรือยังรอถ่ายรูปไม่อยู่ในรายการ */
  units: ShopGoodsReceivingUnit[];
  /** ลงหน่วยเดียวตอนผ่านเข้าคลังหลังรับของ (เครื่องที่รอถ่ายรูป) — ต้องมีหน่วยเดียวและเป็นตัวนี้ */
  acceptedProductId?: string;
  /** หน่วยที่ลงตอนผ่านเข้าคลัง: งวดของวันที่ใบรับของปิดแล้ว จึงลงวันที่รับเข้าคลังแทน — stamp ให้ฝ่ายบัญชีเห็น */
  postedOnAcceptanceDate?: boolean;
  /** ข3 แบบ ข: งวดของวันที่ในเอกสารผู้จัดจำหน่ายปิดแล้ว จึงลงวันที่รับของแทน — stamp ให้ฝ่ายบัญชีเห็น */
  postedOnReceiveDate?: boolean;
  /** "ใบกำกับภาษี IV2610-0123" ต่อท้ายคำอธิบายรายการ · null/ไม่ส่ง = ไม่มีเลขที่เอกสาร */
  supplierDocRef?: string | null;
  /** `supplierDocType` / `supplierDocNumber` / `supplierDocDate` (YYYY-MM-DD) · ว่าง = ใบรับของที่ไม่มีข้อมูลเอกสาร */
  supplierDocMetadata?: Record<string, string | null>;
  /** ผู้จัดจำหน่ายของใบสั่งซื้อ — บัญชีย่อยเจ้าหนี้ตามผู้ติดต่อ (คำตอบฝ่ายบัญชี 2026-10-05 ข้อ 1) อ่านจาก metadata นี้ */
  supplierId?: string;
  supplierName?: string;
  postedAt?: Date;
}

const FLOW = 'shop-goods-receiving';

const INVENTORY_ACCOUNTS: Record<string, string> = {
  'S11-2001': 'รับสินค้าเข้าคลัง - มือถือใหม่',
  'S11-2002': 'รับสินค้าเข้าคลัง - มือถือมือสอง',
  'S11-2003': 'รับสินค้าเข้าคลัง - อุปกรณ์เสริม',
};

const PAYABLE_ACCOUNTS: Record<string, string> = {
  'S21-1101': 'ตั้งเจ้าหนี้ผู้จัดจำหน่าย - มือถือ',
  'S21-1102': 'ตั้งเจ้าหนี้ผู้จัดจำหน่าย - อุปกรณ์เสริม',
};

@Injectable()
export class ShopGoodsReceivingTemplate {
  private readonly logger = new Logger(ShopGoodsReceivingTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  /** คืน `null` เมื่อไม่มียอดให้ลง (ไม่มีหน่วย หรือทุกหน่วยต้นทุนศูนย์) — ไม่โพสต์ใบเปล่า */
  async execute(
    input: ShopGoodsReceivingInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    if (
      input.acceptedProductId !== undefined &&
      (input.units.length !== 1 || input.units[0].productId !== input.acceptedProductId)
    ) {
      throw new BadRequestException(
        'ShopGoodsReceiving: acceptedProductId requires exactly one unit for that product',
      );
    }
    const inventoryTotals = new Map<string, Decimal>();
    const payableTotals = new Map<string, Decimal>();
    let total = zero;

    for (const unit of input.units) {
      if (!(unit.inventoryAccountCode in INVENTORY_ACCOUNTS)) {
        throw new BadRequestException(
          `ShopGoodsReceiving: inventoryAccountCode must be S11-2001, S11-2002 or S11-2003; got ${unit.inventoryAccountCode}`,
        );
      }
      if (!(unit.payableAccountCode in PAYABLE_ACCOUNTS)) {
        throw new BadRequestException(
          `ShopGoodsReceiving: payableAccountCode must be S21-1101 or S21-1102; got ${unit.payableAccountCode}`,
        );
      }
      const cost = new Decimal(unit.cost.toString());
      if (cost.lt(zero)) {
        throw new BadRequestException(`ShopGoodsReceiving: cost must be >= 0; got ${cost.toFixed(2)}`);
      }
      inventoryTotals.set(unit.inventoryAccountCode, (inventoryTotals.get(unit.inventoryAccountCode) ?? zero).add(cost));
      payableTotals.set(unit.payableAccountCode, (payableTotals.get(unit.payableAccountCode) ?? zero).add(cost));
      total = total.add(cost);
    }

    if (!total.gt(zero)) {
      this.logger.log(`ShopGoodsReceivingTemplate — ${input.grNumber} has no cost to post; skipped`);
      return null;
    }

    const byCode = (totals: Map<string, Decimal>) =>
      [...totals.entries()].filter(([, amount]) => amount.gt(zero)).sort(([a], [b]) => a.localeCompare(b));

    const lines: JeLineInput[] = [
      ...byCode(inventoryTotals).map(([accountCode, amount]) => ({
        accountCode,
        dr: amount,
        cr: zero,
        description: INVENTORY_ACCOUNTS[accountCode],
      })),
      ...byCode(payableTotals).map(([accountCode, amount]) => ({
        accountCode,
        dr: zero,
        cr: amount,
        description: PAYABLE_ACCOUNTS[accountCode],
      })),
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: FLOW } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopGoodsReceivingTemplate idempotency — JE ${existing.entryNumber} for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const accepted = input.acceptedProductId;
      const result = await this.journal.createAndPost(
        {
          description:
            (accepted
              ? `รับสินค้าเข้าคลังหลังตรวจรับ ${input.grNumber} ใบสั่งซื้อ ${input.poNumber} (SHOP)`
              : `รับสินค้าเข้า ${input.grNumber} ใบสั่งซื้อ ${input.poNumber} (SHOP)`) +
            (input.supplierDocRef ? ` · ${input.supplierDocRef}` : ''),
          reference: accepted ? `gr:${input.receivingId}:${accepted}` : `gr:${input.receivingId}`,
          metadata: {
            tag: 'SHOP_GOODS_RECEIVING',
            flow: FLOW,
            idempotencyKey: input.idempotencyKey,
            receivingId: input.receivingId,
            grNumber: input.grNumber,
            poId: input.poId,
            poNumber: input.poNumber,
            ...(input.supplierId ? { supplierId: input.supplierId, supplierName: input.supplierName ?? null } : {}),
            companyCode: 'SHOP',
            unitCount: input.units.length,
            totalCost: total.toFixed(2),
            productIds: input.units.map((unit) => unit.productId),
            ...(accepted
              ? { acceptedProductId: accepted, postedOnAcceptanceDate: input.postedOnAcceptanceDate === true }
              : {}),
            ...(input.supplierDocMetadata && Object.keys(input.supplierDocMetadata).length > 0
              ? { ...input.supplierDocMetadata, postedOnReceiveDate: input.postedOnReceiveDate === true }
              : {}),
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
