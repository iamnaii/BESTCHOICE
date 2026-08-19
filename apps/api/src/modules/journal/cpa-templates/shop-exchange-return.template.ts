import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

export interface ShopExchangeReturnInput {
  oldProductId: string;
  oldContractId: string;
  /**
   * ContractExchangeRequest.id — part of the idempotency key (C1b, final
   * review 2026-07-29): a canceled swap's still-POSTED A.4 must not block
   * the same product+contract's second exchange attempt.
   */
  requestId: string;
  /** ราคารับซื้อเครื่องเดิม (= ยอดที่ A.2/A.3 ใช้). Must be > 0. */
  buyback: Decimal;
}

/**
 * Exchange A.4 — SHOP ซื้อเครื่องเดิมคืนจาก FINANCE ที่ราคารับซื้อ
 * (workbook เจ้าของ 2026-08-19 Phase 1 — spec 2026-08-19-device-swap-netting-
 * cancel-workbook-design.md §3.2, คำตัดสินเจ้าของ D2)
 *
 *   Dr S11-2002 (used inventory)                    [buyback]
 *     Cr S21-3001 (เจ้าหนี้-FINANCE ค่าเครื่องรับคืน)  [buyback]
 *
 * เดิม (P3-SP5 → 2026-08-19): `Dr S11-2002 [costPrice] / Cr S50-1102 [costPrice]`
 * — กลับรายการต้นทุนที่ราคาทุนเดิม. เปลี่ยนเพราะ: (1) ต้นทุนจริงของ SHOP คือ
 * ราคาที่ซื้อคืนจาก FINANCE ไม่ใช่ costPrice เดิม (2) S21-3001 คือขาคู่ของ
 * 11-2107 SWAP_CREDIT ฝั่ง FINANCE — รอหักกลบในรอบจ่าย INTER-CO (Phase 2).
 * Forward-only: JE เก่ารูปแบบ costPrice/S50-1102 ปล่อยตามเดิม ไม่ backfill.
 *
 * Caller (`finalizeAfterActivation`) เป็นคน: set `product.costPrice = buyback`
 * + snapshot `request.previousCostPrice` (cancel restore ใช้) + flip
 * status/ownership — template นี้แตะเฉพาะ GL.
 *
 * Idempotency: `metadata.flow = 'shop-exchange-return'` (ชื่อเดิม — ห้ามเปลี่ยน)
 * + `idempotencyKey = <oldProductId>:<oldContractId>:<requestId>`.
 * `metadata.contractId = oldContractId` เดิม — ExchangeCancelReversalTemplate
 * sweep จับใบนี้ผ่าน je4Id ที่เก็บบน request row อยู่แล้ว.
 */
@Injectable()
export class ShopExchangeReturnTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopExchangeReturnInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const buyback = new Decimal(input.buyback.toString());
    if (buyback.lte(0)) {
      // Defense in depth — the caller should have already rejected this with
      // a clearer Thai message. If we reach this branch it's a programmer error.
      throw new InternalServerErrorException(
        'ShopExchangeReturn: buyback must be > 0 (received ' + buyback.toString() + ')',
      );
    }
    const zero = new Decimal(0);
    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
    const idempotencyKey = `${input.oldProductId}:${input.oldContractId}:${input.requestId}`;

    return this.journal.createAndPost(
      {
        description: `Exchange A.4 — SHOP ซื้อเครื่องเดิมคืนที่ราคารับซื้อ (product ${input.oldProductId})`,
        // requestId suffix (C1b): journal_entries has a unique (referenceType,
        // referenceId) constraint — the canceled lifecycle's still-POSTED A.4
        // keeps its reference slot, so round 2 must not reuse the same string.
        reference: `contract:${input.oldContractId}:exchange-return:${input.requestId}`,
        metadata: {
          flow: 'shop-exchange-return',
          idempotencyKey,
          oldProductId: input.oldProductId,
          oldContractId: input.oldContractId,
          contractId: input.oldContractId,
          companyCode: 'SHOP',
          buyback: buyback.toFixed(2),
          shopReceivableType: 'SWAP_CREDIT',
        },
        companyId: shopCompanyId,
        lines: [
          {
            accountCode: 'S11-2002',
            dr: buyback,
            cr: zero,
            description: 'รับเครื่องเก่ากลับเข้าสต็อก SHOP (มือสอง — ราคารับซื้อ)',
          },
          {
            accountCode: 'S21-3001',
            dr: zero,
            cr: buyback,
            description: 'เจ้าหนี้-FINANCE ค่าเครื่องรับคืน (รอหักกลบรอบจ่าย INTER-CO)',
          },
        ],
      },
      tx,
    );
  }
}
