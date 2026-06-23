import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopFinanceReceiptTemplate } from '../journal/cpa-templates/shop-finance-receipt.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { SettleFinanceDto } from './dto/finance-settlement.dto';

/** Contract statuses that count as "has been activated" for settlement purposes. */
const ACTIVATED_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'EARLY_PAYOFF', 'COMPLETED'] as const;

@Injectable()
export class ShopFinanceSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopFinanceReceiptTemplate: ShopFinanceReceiptTemplate,
  ) {}

  async settle(dto: SettleFinanceDto) {
    const bankAccountCode = dto.bankAccountCode ?? ShopAccountResolver.SHOP_RECEIVING_BANK;
    const postedAt = dto.postedAt ? new Date(dto.postedAt) : undefined;
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: dto.contractIds }, status: { in: [...ACTIVATED_STATUSES] }, deletedAt: null },
      select: { id: true, contractNumber: true, financedAmount: true, storeCommission: true },
    });
    const results: { contractId: string; entryNo: string }[] = [];
    for (const c of contracts) {
      const res = await this.shopFinanceReceiptTemplate.execute({
        idempotencyKey: `finance-receipt-${c.id}`,
        contractId: c.id,
        contractNumber: c.contractNumber,
        bankAccountCode,
        financedAmount: new Decimal(c.financedAmount.toString()),
        commission: c.storeCommission ? new Decimal(c.storeCommission.toString()) : new Decimal(0),
        postedAt,
      });
      results.push({ contractId: c.id, entryNo: res.entryNo });
    }
    return { settled: results.length, results };
  }

  /** Activated contracts that do not yet have a shop-finance-receipt JE. */
  async listPending() {
    const contracts = await this.prisma.contract.findMany({
      where: { status: { in: [...ACTIVATED_STATUSES] }, deletedAt: null },
      select: { id: true, contractNumber: true, financedAmount: true, storeCommission: true, branchId: true },
    });
    const settledJEs = await this.prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'shop-finance-receipt' } as any, deletedAt: null },
      select: { metadata: true },
    });
    const settledIds = new Set(
      settledJEs.map((j) => (j.metadata as any)?.contractId).filter(Boolean),
    );
    return contracts.filter((c) => !settledIds.has(c.id));
  }
}
