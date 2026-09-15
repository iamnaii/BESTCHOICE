import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES, type JourneyRedirect, type JourneySummary } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { creditHistoryAccess } from '../credit-check/services/room-credit-access';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';
import { JourneyStateService } from './journey-state.service';
import {
  buildJourneySummary,
  postSaleBadges,
  STALE_AFTER_MS,
  withLiveBought,
  type JourneyStateRow,
  type JourneySummaryExtras,
} from './journey-summary.builder';

const BOUGHT_CONTRACT_STATUSES = [...CUSTOMER_BOUGHT_CONTRACT_STATUSES] as ContractStatus[];
const BOUGHT_SALE_TYPES = [...CUSTOMER_BOUGHT_SALE_TYPES];

function isRejectedOverride(value: Prisma.JsonValue | undefined): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.status === 'REJECTED';
}

/**
 * แถบขั้นของหัวหน้าลูกค้า — อ่านแคช แล้วบังคับให้ขั้นซื้อแล้วตรงกับ BOUGHT_WHERE สดเสมอ
 * คำนวณแคชใหม่ในคำขอเมื่อ: ไม่มีแคช · แคช PURCHASED ไม่ตรง BOUGHT สด · แคชเก่ากว่า 15 นาทีและครอบครัว (ลูกค้า + placeholder ที่รวมเข้ามา) ขยับหลัง computedAt
 */
@Injectable()
export class JourneySummaryService {
  private readonly logger = new Logger(JourneySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journeyState: JourneyStateService,
  ) {}

  /**
   * ไม่มียอดชำระ/ติดตามหนี้ · ธง creditRejected ใช้ใบตรวจเครดิตที่ actor เห็นเท่านั้น (creditHistoryAccess — กติกาเดียวกับ list)
   * ขั้น CREDIT บนแถบยังนับจากการวิเคราะห์สเตทเม้นในแชทได้ทุก role (Ruling FR-CREDIT-STAGE)
   */
  async summary(customerId: string, actor: { id: string; role: string }): Promise<JourneySummary | JourneyRedirect> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true, mergedIntoId: true, status: true },
    });
    if (customer?.deletedAt && customer.mergedIntoId) return { redirectToCustomerId: customer.mergedIntoId };
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

    const now = new Date();
    const [absorbed, cached, boughtCount] = await Promise.all([
      this.prisma.customer.findMany({ where: { mergedIntoId: customerId }, select: { id: true } }),
      this.prisma.customerJourneyState.findUnique({ where: { customerId } }),
      this.prisma.customer.count({ where: { AND: [{ id: customerId }, BOUGHT_WHERE] } }),
    ]);
    const familyIds = [customerId, ...absorbed.map((row) => row.id)];
    const bought = boughtCount > 0;

    let state: JourneyStateRow | null = cached;
    if (await this.needsRecompute(cached, bought, familyIds, now)) {
      try {
        await this.journeyState.recompute([customerId]);
        state = await this.prisma.customerJourneyState.findUnique({ where: { customerId } });
      } catch (err) {
        this.logger.warn(`journey summary recompute ล้ม customer=${customerId}: ${err instanceof Error ? err.message : err}`);
        Sentry.captureException(err, { tags: { kind: 'customer-journey', op: 'summary-recompute' } });
        if (!cached) throw err;
      }
    }
    if (!state) throw new NotFoundException('ไม่พบลูกค้า');

    const live = withLiveBought(state, bought, now);
    return buildJourneySummary(live, await this.extras(live, familyIds, customer.status, actor), now);
  }

  private async needsRecompute(cached: JourneyStateRow | null, bought: boolean, familyIds: string[], now: Date): Promise<boolean> {
    if (!cached) return true;
    if ((cached.stage === 'PURCHASED') !== bought) return true;
    if (now.getTime() - cached.computedAt.getTime() <= STALE_AFTER_MS) return false;
    return this.journeyState.hasActivitySince(familyIds, cached.computedAt);
  }

  private async extras(
    state: JourneyStateRow,
    familyIds: string[],
    customerStatus: string,
    actor: { id: string; role: string },
  ): Promise<JourneySummaryExtras> {
    const purchased = state.stage === 'PURCHASED';
    const [ad, manualInterest, creditChecks, latestContract, contractCount, saleCount, repairCount] = await Promise.all([
      state.firstAdCampaignId
        ? this.prisma.adsCampaign.findUnique({ where: { id: state.firstAdCampaignId }, select: { id: true, campaignName: true } })
        : Promise.resolve(null),
      state.interestedAt
        ? this.prisma.customerJourneyEntry.count({
            where: { customerId: { in: familyIds }, kind: 'TOUCHPOINT', outcome: { in: ['APPOINTED', 'VISITED'] }, deletedAt: null, occurredAt: state.interestedAt },
          })
        : Promise.resolve(0),
      purchased
        ? Promise.resolve([])
        : this.prisma.creditCheck.findMany({
            where: { customerId: { in: familyIds }, deletedAt: null, ...creditHistoryAccess(actor) },
            select: { id: true },
          }),
      purchased
        ? this.prisma.contract.findFirst({
            where: { customerId: { in: familyIds }, deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { status: true },
          })
        : Promise.resolve(null),
      purchased
        ? this.prisma.contract.count({ where: { customerId: { in: familyIds }, deletedAt: null, status: { in: BOUGHT_CONTRACT_STATUSES } } })
        : Promise.resolve(0),
      purchased
        ? this.prisma.sale.count({ where: { customerId: { in: familyIds }, deletedAt: null, saleType: { in: BOUGHT_SALE_TYPES } } })
        : Promise.resolve(0),
      purchased
        ? this.prisma.repairTicket.count({ where: { customerId: { in: familyIds }, deletedAt: null } })
        : Promise.resolve(0),
    ]);

    let creditRejected = false;
    if (creditChecks.length > 0) {
      const override = await this.prisma.auditLog.findFirst({
        where: { action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: { in: creditChecks.map((row) => row.id) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { newValue: true },
      });
      creditRejected = isRejectedOverride(override?.newValue);
    }

    return {
      firstAd: ad ? { id: ad.id, name: ad.campaignName } : null,
      interestedByManualEntry: manualInterest > 0,
      creditRejected,
      postSaleBadges: purchased
        ? postSaleBadges({
            latestContractStatus: latestContract?.status ?? null,
            purchaseCount: contractCount + saleCount,
            hasRepairTicket: repairCount > 0,
            skipTracingLost: customerStatus === 'LOST',
          })
        : [],
    };
  }
}
