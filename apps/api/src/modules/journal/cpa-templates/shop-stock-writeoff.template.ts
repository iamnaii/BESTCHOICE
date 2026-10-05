import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * SHOP — ตัดสินค้า สูญหาย / ตัดจำหน่าย (ก้อน 3 · คำตอบฝ่ายบัญชี 2026-09-29 ข้อ ข6 · เจ้าของเคาะ 2026-10-05)
 *
 *   LOST / WRITE_OFF   Dr S53-1102 ขาดทุนสินค้าเสียหาย/สูญหายสาขา  [ต้นทุนเครื่อง ณ วันอนุมัติ]
 *                        Cr S11-2001 / S11-2002 / S11-2003 สินค้าคงคลัง (ตามประเภทเครื่อง)
 *
 * - DAMAGED ไม่ลงบัญชี (ข7 — เครื่องเสียหายที่ตัวเครื่องยังอยู่ คงในสต๊อกจนกว่าจะขายหรือตัดทิ้ง)
 * - FOUND = `reverse()` ใบเดิมทั้งใบ (สลับ Dr/Cr ลงวันที่อนุมัติพบของคืน) + stamp `reversed` บนใบเดิม
 * - CORRECTION / OTHER ไม่ลงบัญชี
 * - ผู้เรียก (StockAdjustmentsService.approve) ต้องตรวจ `resolveBookedInventory` ก่อน — เครื่องที่ไม่เคยลงบัญชี
 *   รับเข้า (ของยกมา / เพิ่มมือ / มือสองจาก PO ที่ยังรอถ่ายรูป) ห้ามเรียก template นี้ (เครดิตของที่ไม่เคยเดบิต)
 * - ห้าม stamp `contractId` / `saleId` — sweep ของยกเลิกสัญญา/ใบขายกวาดตาม key เหล่านั้น
 */
export const STOCK_WRITEOFF_LOSS_ACCOUNT = 'S53-1102';
export const STOCK_WRITEOFF_FLOW = 'shop-stock-writeoff';
export const STOCK_WRITEOFF_TAG = 'SHOP_STOCK_WRITEOFF';
export const STOCK_WRITEOFF_REVERSAL_TAG = 'SHOP_STOCK_WRITEOFF_REVERSAL';

export type StockWriteOffReason = 'LOST' | 'WRITE_OFF';
export type StockInventoryAccount = 'S11-2001' | 'S11-2002' | 'S11-2003';

const INVENTORY_ACCOUNTS: Record<StockInventoryAccount, string> = {
  'S11-2001': 'สินค้าคงคลัง - มือถือใหม่',
  'S11-2002': 'สินค้าคงคลัง - มือถือมือสอง',
  'S11-2003': 'สินค้าคงคลัง - อุปกรณ์เสริม',
};
const REASON_LABEL: Record<StockWriteOffReason, string> = {
  LOST: 'สินค้าสูญหาย',
  WRITE_OFF: 'ตัดจำหน่ายสินค้า',
};

export interface ShopStockWriteOffInput {
  /** `shop-stock-writeoff:<adjustmentId>` */
  idempotencyKey: string;
  adjustmentId: string;
  requestNumber: string;
  productId: string;
  productName: string;
  imeiSerial: string | null;
  reason: StockWriteOffReason;
  inventoryAccountCode: StockInventoryAccount;
  /** ต้นทุนเครื่อง (> 0) */
  amount: Decimal;
  branchId: string;
  postedAt?: Date;
}

export interface ShopStockWriteOffReverseInput {
  /** JE ตัดจำหน่ายเดิม (tag SHOP_STOCK_WRITEOFF) */
  journalEntryId: string;
  /** `shop-stock-writeoff-reversal:<foundAdjustmentId>` */
  idempotencyKey: string;
  foundAdjustmentId: string;
  reason: string;
  postedAt?: Date;
}

@Injectable()
export class ShopStockWriteOffTemplate {
  private readonly logger = new Logger(ShopStockWriteOffTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopStockWriteOffInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const lines = this.buildLines(input);
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await this.findExisting(tx, input.idempotencyKey);
      if (existing) return existing;
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description:
            `${REASON_LABEL[input.reason]} ${input.productName}` +
            (input.imeiSerial ? ` IMEI ${input.imeiSerial}` : '') +
            ` · คำขอ ${input.requestNumber} (SHOP)`,
          reference: `sa:${input.adjustmentId}`,
          metadata: {
            tag: STOCK_WRITEOFF_TAG,
            flow: STOCK_WRITEOFF_FLOW,
            idempotencyKey: input.idempotencyKey,
            adjustmentId: input.adjustmentId,
            requestNumber: input.requestNumber,
            productId: input.productId,
            reason: input.reason,
            branchId: input.branchId,
            inventoryAccountCode: input.inventoryAccountCode,
            companyCode: 'SHOP',
            amount: new Decimal(input.amount.toString()).toFixed(2),
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

  /** พบของคืน — กลับทุกบรรทัดของใบตัดจำหน่ายเดิม (สลับ Dr/Cr) ลงวันที่อนุมัติ และ stamp `reversed` บนใบเดิม */
  async reverse(
    input: ShopStockWriteOffReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await this.findExisting(tx, input.idempotencyKey);
      if (existing) return existing;
      const original = await tx.journalEntry.findUnique({
        where: { id: input.journalEntryId },
        include: { lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
      });
      const meta = (original?.metadata ?? null) as Record<string, unknown> | null;
      if (!original || !meta || meta.tag !== STOCK_WRITEOFF_TAG) {
        throw new BadRequestException('ไม่พบรายการบัญชีตัดจำหน่ายที่จะกลับรายการ');
      }
      if (meta.reversed === true) {
        throw new BadRequestException(`รายการบัญชี ${original.entryNumber} ถูกกลับรายการไปแล้ว — กลับซ้ำไม่ได้`);
      }
      if (original.lines.length === 0) {
        throw new BadRequestException(`รายการบัญชี ${original.entryNumber} ไม่มีบรรทัดให้กลับรายการ`);
      }
      const lines: JeLineInput[] = original.lines.map((line) => ({
        accountCode: line.accountCode,
        dr: new Decimal(line.credit.toString()),
        cr: new Decimal(line.debit.toString()),
        description: `กลับรายการ ${line.description ?? line.accountCode}`,
      }));
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `พบของคืน — กลับรายการ ${original.entryNumber} (${input.reason}) (SHOP)`,
          reference: `sa:${input.foundAdjustmentId}:found`,
          metadata: {
            tag: STOCK_WRITEOFF_REVERSAL_TAG,
            flow: STOCK_WRITEOFF_FLOW,
            idempotencyKey: input.idempotencyKey,
            reversesEntryId: original.id,
            reversesEntryNo: original.entryNumber,
            foundAdjustmentId: input.foundAdjustmentId,
            adjustmentId: meta.adjustmentId ?? null,
            requestNumber: meta.requestNumber ?? null,
            productId: meta.productId ?? null,
            reason: meta.reason ?? null,
            branchId: meta.branchId ?? null,
            inventoryAccountCode: meta.inventoryAccountCode ?? null,
            companyCode: 'SHOP',
            amount: meta.amount ?? null,
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          metadata: { ...meta, reversed: true, reversedByEntryNumber: result.entryNumber } as Prisma.InputJsonValue,
        },
      });
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };
    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }

  private async findExisting(tx: Prisma.TransactionClient, idempotencyKey: string) {
    const existing = await tx.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: STOCK_WRITEOFF_FLOW } as any },
          { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } as any },
        ],
        deletedAt: null,
      },
    });
    if (!existing) return null;
    this.logger.log(`ShopStockWriteOffTemplate idempotency — JE ${existing.entryNumber} for ${idempotencyKey}`);
    return { entryNo: existing.entryNumber, journalEntryId: existing.id };
  }

  private buildLines(input: ShopStockWriteOffInput): JeLineInput[] {
    const amount = new Decimal(input.amount.toString());
    if (!amount.gt(0)) {
      throw new BadRequestException(`ShopStockWriteOff: amount must be > 0; got ${amount.toFixed(2)}`);
    }
    if (!(input.inventoryAccountCode in INVENTORY_ACCOUNTS)) {
      throw new BadRequestException(
        `ShopStockWriteOff: inventoryAccountCode must be S11-2001 / S11-2002 / S11-2003; got ${input.inventoryAccountCode}`,
      );
    }
    const zero = new Decimal(0);
    return [
      {
        accountCode: STOCK_WRITEOFF_LOSS_ACCOUNT,
        dr: amount,
        cr: zero,
        description: `${REASON_LABEL[input.reason]} ${input.productName}`,
      },
      {
        accountCode: input.inventoryAccountCode,
        dr: zero,
        cr: amount,
        description: INVENTORY_ACCOUNTS[input.inventoryAccountCode],
      },
    ];
  }
}
