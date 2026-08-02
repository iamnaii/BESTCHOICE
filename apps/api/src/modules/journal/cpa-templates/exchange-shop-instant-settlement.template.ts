import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import { ShopAccountResolver } from '../shop-account-resolver.service';

export interface ExchangeShopInstantSettlementInput {
  newContractId: string;
  contractNumber?: string;
  /** Same value ShopInventoryTransferTemplate booked to S11-3001 for this contract. */
  financedAmount: Decimal;
  /** Same value ShopInventoryTransferTemplate booked to S11-3002 (0 skips that line). */
  commission: Decimal;
  /** ShopInventoryTransferTemplate's returned batchId — traceability link, not an idempotency input. */
  batchId?: string;
  postedAt?: Date;
}

/**
 * Exchange F2 follow-up — D5 symmetry (2026-08-02).
 *
 * `ExchangeClearVendor21_1106Template` (A.3) already settles the FINANCE side
 * of an exchange's new contract INSTANTLY at finalize (buyback offset via
 * 21-1106 + an immediate cash top-up/refund — owner decision D5, "assume
 * same-day transfer"), instead of leaving 21-1101/21-1102 outstanding for the
 * later "จ่ายให้หน้าร้าน (INTER-CO)" batch a normal contract would wait for.
 *
 * `ShopInventoryTransferTemplate` (booked immediately before this template,
 * same finalize transaction) books S11-3001/S11-3002 exactly like a normal
 * activation — but for a normal contract those sit outstanding until the
 * INTER-CO batch clears them. For an exchange, that batch will never see this
 * contract (A.3 already zeroed the FINANCE-side lens it reads), so without a
 * symmetric SHOP-side receipt those two accounts would be a stuck balance
 * that no operational flow ever clears.
 *
 * This template posts that missing receipt LEG — the SHOP-side mirror of
 * A.3's cash movement, in the exact same finalize transaction:
 *
 *   Dr S11-1201 (ShopAccountResolver.SHOP_RECEIVING_BANK)   [financed + commission]
 *     Cr S11-3001 (clear FINANCE receivable — ยอดจัด)        [financed]
 *     Cr S11-3002 (clear FINANCE receivable — ค่าคอม)        [commission, skipped if 0]
 *
 * After this posts, S11-3001/S11-3002 net to exactly 0 for the contract
 * (booked then cleared in the same tx) — no stuck balance, no dependency on
 * the INTER-CO batch ever discovering this contract.
 *
 * Idempotency: `metadata.flow = 'exchange-shop-receipt'` +
 * `metadata.idempotencyKey = exchange-shop-receipt:<newContractId>` — one
 * receipt per new contract, enforced by the existing
 * `journal_entries_idempotency_idx` partial unique index (same convention as
 * the sibling A.1-A.5 exchange templates; no in-JS pre-check, matching
 * `ExchangeCloseOld21_1106Template`/`ExchangeClearVendor21_1106Template`
 * immediately either side of this call).
 *
 * `metadata.contractId = newContractId` (same tag every exchange template
 * uses) means `ExchangeCancelReversalTemplate`'s sweep picks this JE up
 * automatically at cancel — no schema change, no explicit id stored on the
 * request row, consistent with how the 2 ShopInventoryTransfer JEs are
 * already traced.
 */
@Injectable()
export class ExchangeShopInstantSettlementTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ExchangeShopInstantSettlementInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const financed = new Decimal(input.financedAmount.toString());
    const commission = new Decimal(input.commission.toString());
    const zero = new Decimal(0);

    if (financed.lte(zero)) {
      throw new BadRequestException(
        'ExchangeShopInstantSettlement: financedAmount must be > 0',
      );
    }
    if (commission.lt(zero)) {
      throw new BadRequestException(
        'ExchangeShopInstantSettlement: commission cannot be negative',
      );
    }
    const total = financed.plus(commission);

    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
    const contractLabel = input.contractNumber ?? input.newContractId;

    const lines: JeLineInput[] = [
      {
        accountCode: ShopAccountResolver.SHOP_RECEIVING_BANK,
        dr: total,
        cr: zero,
        description: `รับโอนจาก FINANCE ทันที (เปลี่ยนเครื่อง ${contractLabel} — D5)`,
      },
      {
        accountCode: 'S11-3001',
        dr: zero,
        cr: financed,
        description: 'ล้างลูกหนี้ FINANCE - ยอดจัด (รับทันทีตอน finalize)',
      },
    ];
    if (commission.gt(zero)) {
      lines.push({
        accountCode: 'S11-3002',
        dr: zero,
        cr: commission,
        description: 'ล้างลูกหนี้ FINANCE - ค่าคอม (รับทันทีตอน finalize)',
      });
    }

    return this.journal.createAndPost(
      {
        description: `Exchange SHOP instant settlement — รับโอนจาก FINANCE ทันที (สัญญา ${contractLabel})`,
        reference: `contract:${input.newContractId}:exchange-shop-receipt`,
        metadata: {
          flow: 'exchange-shop-receipt',
          idempotencyKey: `exchange-shop-receipt:${input.newContractId}`,
          contractId: input.newContractId,
          newContractId: input.newContractId,
          companyCode: 'SHOP',
          batchId: input.batchId ?? null,
          financedAmount: financed.toFixed(2),
          commission: commission.toFixed(2),
        },
        postedAt: input.postedAt,
        companyId: shopCompanyId,
        lines,
      },
      tx,
    );
  }
}
