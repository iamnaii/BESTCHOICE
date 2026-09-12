import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CustomerTier,
  CustomerTierResponse,
  TierReason,
} from './dto/tier.dto';

const tierContractSelect = {
  id: true,
  status: true,
  totalMonths: true,
  monthlyPayment: true,
  payments: {
    where: { deletedAt: null },
    select: { status: true, dueDate: true, paidAt: true },
  },
} satisfies Prisma.ContractSelect;
type TierContract = Prisma.ContractGetPayload<{ select: typeof tierContractSelect }>;

interface TierInputHistory {
  totalContracts: number;
  closedContracts: number;
  activeContracts: number;
  onTimePayments: number;
  latePayments: number;
  maxOverdueDays: number;
  currentOutstanding: number;
  hasBadDebt: boolean;
  hasRepossession: boolean;
  activeContractsAllOnTime: boolean;
  activeContractsPaidCount: number;
}

@Injectable()
export class CustomerTierService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pure tier computation — no DB calls. Given a normalized history snapshot,
   * returns the tier + machine-readable reasons.
   */
  computeTierFromHistory(history: TierInputHistory): {
    tier: CustomerTier;
    reasons: TierReason[];
  } {
    const reasons: TierReason[] = [];

    if (history.hasBadDebt) {
      reasons.push({ code: 'BAD_DEBT', message: 'เคยถูกตัดเป็นหนี้สูญ' });
      return { tier: 'BLACKLIST', reasons };
    }
    if (history.hasRepossession) {
      reasons.push({ code: 'REPOSSESSED', message: 'เคยถูกยึดเครื่อง' });
      return { tier: 'BLACKLIST', reasons };
    }

    if (history.maxOverdueDays > 30) {
      reasons.push({
        code: 'OVERDUE_OVER_30',
        message: `เคยค้างชำระเกิน 30 วัน (สูงสุด ${history.maxOverdueDays} วัน)`,
      });
      return { tier: 'RISKY', reasons };
    }

    const totalPayments = history.onTimePayments + history.latePayments;
    const onTimePct = totalPayments > 0 ? (history.onTimePayments / totalPayments) * 100 : 0;

    if (history.closedContracts >= 2 && history.latePayments === 0 && history.onTimePayments > 0) {
      reasons.push({
        code: 'GOLD',
        message: `ปิดสัญญา ${history.closedContracts} ครั้ง จ่ายตรงเวลา 100%`,
      });
      return { tier: 'GOLD', reasons };
    }

    if (onTimePct >= 90 && history.closedContracts >= 1) {
      reasons.push({
        code: 'GOOD_CLOSED',
        message: `เคยปิดสัญญา ${history.closedContracts} ครั้ง จ่ายตรงเวลา ${onTimePct.toFixed(0)}%`,
      });
      return { tier: 'GOOD', reasons };
    }

    if (
      history.activeContractsAllOnTime &&
      history.activeContractsPaidCount >= 3 &&
      history.activeContracts >= 1
    ) {
      reasons.push({
        code: 'GOOD_ACTIVE',
        message: `สัญญาปัจจุบันจ่ายตรงเวลา ${history.activeContractsPaidCount} งวดติด`,
      });
      return { tier: 'GOOD', reasons };
    }

    reasons.push({ code: 'NEW', message: 'ลูกค้าใหม่หรือยังไม่มีประวัติเพียงพอ' });
    return { tier: 'NEW', reasons };
  }

  async getCustomerTier(customerId: string): Promise<CustomerTierResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    const contracts = await this.prisma.contract.findMany({
      where: { customerId, deletedAt: null },
      select: tierContractSelect,
    });

    const repossessionCount = await this.prisma.repossession.count({
      where: { contract: { customerId }, deletedAt: null },
    });

    return this.summarize(customerId, contracts, repossessionCount);
  }

  /** Batched history reads for list filtering, using exactly the detail tier policy. */
  async getCustomerTiers(customerIds: string[], db: Prisma.TransactionClient = this.prisma, asOf = new Date()): Promise<Map<string, CustomerTierResponse>> {
    const result = new Map<string, CustomerTierResponse>();
    for (let offset = 0; offset < customerIds.length; offset += 200) {
      const ids = customerIds.slice(offset, offset + 200);
      const [contracts, repossessions] = await Promise.all([
        db.contract.findMany({ where: { customerId: { in: ids }, deletedAt: null },
          select: { ...tierContractSelect, customerId: true } }),
        db.repossession.findMany({ where: { deletedAt: null, contract: { customerId: { in: ids } } },
          select: { contract: { select: { customerId: true } } } }),
      ]);
      const byCustomer = new Map<string, TierContract[]>();
      const repoCounts = new Map<string, number>();
      for (const contract of contracts) {
        const group = byCustomer.get(contract.customerId) ?? [];
        group.push(contract); byCustomer.set(contract.customerId, group);
      }
      for (const row of repossessions) {
        const id = row.contract.customerId;
        repoCounts.set(id, (repoCounts.get(id) ?? 0) + 1);
      }
      for (const id of ids) result.set(id, this.summarize(id, byCustomer.get(id) ?? [], repoCounts.get(id) ?? 0, asOf));
    }
    return result;
  }

  private summarize(customerId: string, contracts: TierContract[], repossessionCount: number, asOf = new Date()): CustomerTierResponse {
    const totalContracts = contracts.length;
    const closedContracts = contracts.filter(
      (c) => c.status === 'COMPLETED' || c.status === 'EARLY_PAYOFF',
    ).length;
    const activeContracts = contracts.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'OVERDUE',
    ).length;

    const hasBadDebt = contracts.some(
      (c) => c.status === 'CLOSED_BAD_DEBT' || c.status === 'DEFAULT',
    );
    const hasRepossession = repossessionCount > 0;

    let onTimePayments = 0;
    let latePayments = 0;
    let maxOverdueDays = 0;
    let currentOutstanding = new Prisma.Decimal(0);
    let activeContractsPaidCount = 0;
    let activeAllOnTime = activeContracts > 0;

    for (const contract of contracts) {
      const isActive = contract.status === 'ACTIVE' || contract.status === 'OVERDUE';
      let contractActiveLate = 0;

      for (const p of contract.payments) {
        if (p.status === 'PAID') {
          onTimePayments++;
          if (isActive) activeContractsPaidCount++;
        } else if (p.status === 'OVERDUE') {
          latePayments++;
          if (isActive) contractActiveLate++;
          const due = new Date(p.dueDate).getTime();
          const end = p.paidAt ? new Date(p.paidAt).getTime() : asOf.getTime();
          const days = Math.max(0, Math.floor((end - due) / 86_400_000));
          if (days > maxOverdueDays) maxOverdueDays = days;
        }
      }

      if (isActive) {
        const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
        const remaining = contract.totalMonths - paidCount;
        currentOutstanding = currentOutstanding.add(
          new Prisma.Decimal(remaining).mul(contract.monthlyPayment),
        );
        if (contractActiveLate > 0) activeAllOnTime = false;
      }
    }

    const totalPayments = onTimePayments + latePayments;
    const onTimePct =
      totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 10000) / 100 : 0;

    const { tier, reasons } = this.computeTierFromHistory({
      totalContracts,
      closedContracts,
      activeContracts,
      onTimePayments,
      latePayments,
      maxOverdueDays,
      currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
      hasBadDebt,
      hasRepossession,
      activeContractsAllOnTime: activeAllOnTime,
      activeContractsPaidCount,
    });

    return {
      customerId,
      tier,
      reasons,
      history: {
        totalContracts,
        closedContracts,
        activeContracts,
        onTimePaymentPct: onTimePct,
        onTimePayments,
        latePayments,
        maxOverdueDays,
        currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
        hasBadDebt,
        hasRepossession,
      },
    };
  }
}
