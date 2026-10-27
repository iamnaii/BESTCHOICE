import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { canAccess, ContractReadAvailability } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { payoffJournalReadable } from './access-payoff-journal-source';

export const CONTRACT_PAYMENT_READ_ROUTES = [
  'ContractsController.getSchedule',
  'ContractsController.getEarlyPayoffQuote',
] as const;

// Same finite contractual breakdown as the ordinary Contract detail. These are
// debt terms, not Product acquisition cost; R131 deliberately preserves them.
const scheduleSelect = {
  id: true,
  installmentNo: true,
  dueDate: true,
  amountDue: true,
  amountPaid: true,
  paidDate: true,
  paymentMethod: true,
  lateFee: true,
  lateFeeWaived: true,
  status: true,
  monthlyPrincipal: true,
  monthlyInterest: true,
  monthlyCommission: true,
  vatAmount: true,
} satisfies Prisma.PaymentSelect;

@Injectable()
export class AccessContractPaymentReadBoundaries implements OnModuleInit {
  constructor(
    private readonly modules: ModuleRef,
    private readonly resources: AccessResourceService,
    private readonly sources: AccessPartySourceService,
  ) {}

  onModuleInit() {
    for (const route of CONTRACT_PAYMENT_READ_ROUTES) {
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        if (requestedAccessCompany(req) !== 'FINANCE')
          throw new ForbiddenException('คำขอนี้อยู่ในงานการเงิน');
        const id = String(req.params?.id ?? '');
        return {
          kind: 'selection',
          company: 'FINANCE',
          execute: async () =>
            (
              await this.resources.execute(
                snapshot.userId,
                permission,
                'FINANCE',
                async (tx, current, lock) => {
                  const source = await this.sources.financeContract(tx, id, lock);
                  if (!canAccess(current, 'payments.read', source))
                    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
                  return { company: 'FINANCE', resources: [source], productIds: [] };
                },
                async () => {
                  const ctx = currentDomainAccess()!;
                  const tx = ctx.client;
                  // Re-read monetary rows after lock waits in this same owned
                  // Serializable attempt. No root-client cached money or grants.
                  await tx.$queryRaw`SELECT id FROM payments WHERE contract_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
                  await tx.$queryRaw`SELECT id FROM installment_schedules WHERE contract_id=${id} AND deleted_at IS NULL ORDER BY id FOR SHARE`;
                  if (route === 'ContractsController.getSchedule') {
                    return {
                      data: await tx.payment.findMany({
                        where: { contractId: id, deletedAt: null },
                        orderBy: [{ installmentNo: 'asc' }, { id: 'asc' }],
                        select: scheduleSelect,
                      }),
                      availability: {
                        payments: 'VISIBLE_CURRENT',
                      } satisfies Record<string, ContractReadAvailability>,
                    };
                  }
                  const query = req.query ?? {};
                  const allowed = [
                    'company',
                    'discountPct',
                    'depositAccountCode',
                    'collectedByShop',
                  ];
                  if (
                    Object.keys(query).some((key) => !allowed.includes(key)) ||
                    Object.values(query).some((value) => typeof value !== 'string')
                  )
                    throw new BadRequestException('คำขอไม่ถูกต้อง');
                  const pct = query.discountPct != null ? Number(query.discountPct) : undefined;
                  const effectiveDepositCode =
                    query.collectedByShop === 'true' ? '11-2107' : query.depositAccountCode;
                  const source = await this.sources.financeContract(tx, id);
                  const sensitive =
                    canAccess(ctx.snapshot, 'sensitive.cost.read', source) &&
                    canAccess(ctx.snapshot, 'sensitive.profit.read', source);
                  const journal = await payoffJournalReadable(id);
                  const service = this.modules.get(ContractPaymentService, { strict: false });
                  try {
                    const args = [
                      id,
                      Number.isFinite(pct) ? pct : undefined,
                      effectiveDepositCode,
                      tx,
                    ] as const;
                    const quote = journal
                      ? await service.getEarlyPayoffQuote(...args)
                      : await service.getEarlyPayoffQuote(...args, { skipJournalPreview: true });
                    const payoff = sensitive || quote.discountPct === 0;
                    return {
                      monthlyPayment: quote.monthlyPayment,
                      remainingMonths: quote.remainingMonths,
                      totalRemaining: quote.totalRemaining,
                      advancePayment: quote.advancePayment,
                      remainingBalance: quote.remainingBalance,
                      remainingExVat: quote.remainingExVat,
                      remainingCost: sensitive ? quote.remainingCost : null,
                      grossProfit: sensitive ? quote.grossProfit : null,
                      discountPct: quote.discountPct,
                      discountAmount: payoff ? quote.discountAmount : null,
                      unpaidLateFees: quote.unpaidLateFees,
                      totalPayoff: payoff ? quote.totalPayoff : null,
                      rescheduleAdvanceApplied: quote.rescheduleAdvanceApplied,
                      advanceBalanceApplied: quote.advanceBalanceApplied,
                      journalPreview: quote.journalPreview,
                      availability: {
                        payments: 'VISIBLE_CURRENT',
                        sensitive: sensitive ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
                        payoff: payoff ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
                        journal: journal ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
                      } satisfies Record<string, ContractReadAvailability>,
                      approvalRequirement: !payoff
                        ? 'UNKNOWN_REQUIRES_REVIEW'
                        : quote.discountAmount > 0
                          ? 'OWNER_APPROVAL_REQUIRED'
                          : 'NONE',
                    };
                  } catch (error) {
                    // Private canonical diagnostics never become an HTTP oracle.
                    if (error instanceof BadRequestException || error instanceof NotFoundException)
                      throw new BadRequestException('ไม่สามารถคำนวณรายการนี้ได้');
                    throw error;
                  }
                },
                false,
                { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result,
        };
      });
    }
  }
}
