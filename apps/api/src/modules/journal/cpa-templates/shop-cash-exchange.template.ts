import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import type { ShopProductAccounts } from '../shop-account-resolver.service';

/**
 * PR 5 หลังการขาย — เปลี่ยนรุ่นเดิมบนใบขายสด (คำตอบฝ่ายบัญชีฉบับรวม ข้อ 10 · 30/09/2569):
 * ราคาขาย/รายได้/เงินสดไม่แตะ · เครื่องเดิมกลับเข้าคลังที่ต้นทุนเดิมที่ลงตอนขาย · ต้นทุนขายของบิลนี้
 * เปลี่ยนเป็นของเครื่องทดแทน
 *
 *   Dr S11-200x [oldCost]  / Cr S50-110x [oldCost]      ← เครื่องเดิมกลับคลัง (รอเคลม)
 *   Dr S50-110x [newCost]  / Cr S11-200x [newCost]      ← ต้นทุนขายใหม่
 *
 * รหัสบัญชีมาจาก `ShopAccountResolver.resolveProductAccounts(category)` ของแต่ละเครื่อง (ผู้เรียกส่งมา) —
 * template ไม่ hardcode · คู่ที่ยอด 0 ไม่ลง · ทั้งสองคู่ 0 = ไม่มีรายการ (คืน null) · idempotent ต่อเคส
 * · metadata **ไม่ stamp contractId** (sweep ยกเลิกสัญญาต้องมองไม่เห็น) แต่ stamp `saleId` (sweep ยกเลิกใบขาย
 * มองเห็น — ด่าน G9 ปิดการยกเลิกก่อนถึง)
 */
export interface ShopCashExchangeInput {
  afterSalesCaseId: string;
  caseNumber?: string;
  saleId: string;
  saleNumber?: string;
  oldProductId: string;
  newProductId: string;
  oldCost: Decimal;
  newCost: Decimal;
  oldAccounts: ShopProductAccounts;
  newAccounts: ShopProductAccounts;
  postedAt?: Date;
}

export const SHOP_CASH_EXCHANGE_FLOW = 'shop-cash-exchange';

@Injectable()
export class ShopCashExchangeTemplate {
  private readonly logger = new Logger(ShopCashExchangeTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopCashExchangeInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const oldCost = new Decimal(input.oldCost.toString());
    const newCost = new Decimal(input.newCost.toString());
    if (oldCost.lt(zero) || newCost.lt(zero)) {
      throw new BadRequestException('ShopCashExchange: ต้นทุนติดลบไม่ได้');
    }
    for (const code of [
      input.oldAccounts.inventoryAccountCode,
      input.oldAccounts.cogsAccountCode,
      input.newAccounts.inventoryAccountCode,
      input.newAccounts.cogsAccountCode,
    ]) {
      if (!code.startsWith('S')) {
        throw new BadRequestException(
          `ShopCashExchange: ต้องเป็นบัญชีฝั่ง SHOP (S-prefix) — ${code}`,
        );
      }
    }

    const lines: JeLineInput[] = [];
    if (oldCost.gt(zero)) {
      lines.push({
        accountCode: input.oldAccounts.inventoryAccountCode,
        dr: oldCost,
        cr: zero,
        description: 'รับคืนเครื่องเดิมเข้าคลัง (รอเคลม) — ต้นทุนเดิมที่ลงตอนขาย',
      });
      lines.push({
        accountCode: input.oldAccounts.cogsAccountCode,
        dr: zero,
        cr: oldCost,
        description: 'กลับต้นทุนขายของเครื่องเดิม',
      });
    }
    if (newCost.gt(zero)) {
      lines.push({
        accountCode: input.newAccounts.cogsAccountCode,
        dr: newCost,
        cr: zero,
        description: 'ต้นทุนขายของเครื่องทดแทน',
      });
      lines.push({
        accountCode: input.newAccounts.inventoryAccountCode,
        dr: zero,
        cr: newCost,
        description: 'ตัดสต็อกเครื่องทดแทน',
      });
    }
    if (!lines.length) return null;

    const idempotencyKey = `${SHOP_CASH_EXCHANGE_FLOW}:${input.afterSalesCaseId}`;
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: SHOP_CASH_EXCHANGE_FLOW } as any },
            { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopCashExchangeTemplate idempotency — JE ${existing.entryNumber} already exists for ${idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `เปลี่ยนรุ่นเดิมขายสด ${input.saleNumber ?? input.saleId} · เคส ${input.caseNumber ?? input.afterSalesCaseId} (SHOP)`,
          reference: `sale:${input.saleId}:exchange:${input.afterSalesCaseId}`,
          metadata: {
            tag: 'SHOP_CASH_EXCHANGE',
            flow: SHOP_CASH_EXCHANGE_FLOW,
            idempotencyKey,
            saleId: input.saleId,
            saleNumber: input.saleNumber ?? null,
            afterSalesCaseId: input.afterSalesCaseId,
            caseNumber: input.caseNumber ?? null,
            oldProductId: input.oldProductId,
            newProductId: input.newProductId,
            oldCost: oldCost.toFixed(2),
            newCost: newCost.toFixed(2),
            companyCode: 'SHOP',
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
