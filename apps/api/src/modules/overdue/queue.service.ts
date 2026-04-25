import { Injectable } from '@nestjs/common';
import { ContractStatus, Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LastContactedBucket,
  LineResponseState,
  MdmStateFilter,
  OverdueBucket,
  QueueSortBy,
} from './dto/queue-query.dto';
import { seededShuffle } from '../../utils/shuffle.util';

export type QueueTab = 'today' | 'followup' | 'promise';

export type MdmState = 'NONE' | 'PENDING' | 'LOCKED' | 'UNLOCKED';
export type LastChannel = 'LINE' | 'SMS' | 'CALL' | 'LETTER' | null;

const FETCH_CAP = 500;

// Z2: shape of the contract include used by getQueue → enrichRows. Kept as a
// const so we can derive a precise Prisma payload type instead of `any`.
const queueContractInclude = {
  customer: { select: { id: true, name: true, phone: true, lineId: true } },
  branch: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
  payments: {
    where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
    orderBy: { dueDate: 'asc' },
    take: 1,
  },
  callLogs: {
    orderBy: { calledAt: 'desc' },
    take: 1,
  },
  _count: {
    select: {
      callLogs: { where: { result: 'PROMISED', brokenAt: { not: null } } },
    },
  },
} satisfies Prisma.ContractInclude;

type QueueContract = Prisma.ContractGetPayload<{ include: typeof queueContractInclude }>;

export interface QueueFilterInput {
  // Pre-SQL filters
  search?: string;
  assignedToId?: string; // 'self' | 'unassigned' | UUID
  showSkipTracing?: boolean;
  overdueBuckets?: OverdueBucket[];
  minOutstanding?: number;
  maxOutstanding?: number;
  contractStatuses?: ContractStatus[];
  productTypes?: ProductCategory[];
  minLetterCount?: number;

  // Post-enrichment filters (apply to computed fields after fetch)
  lastContacted?: LastContactedBucket;
  lineResponse?: LineResponseState;
  minBrokenPromise?: number;
  hasActivePromise?: boolean;
  mdmState?: MdmStateFilter;
  slipReviewPending?: boolean;

  // Sort (post-enrichment)
  sortBy?: QueueSortBy;
}

@Injectable()
export class OverdueQueueService {
  constructor(private prisma: PrismaService) {}

  async getQueue(
    params: {
      tab: QueueTab;
      userRole: string;
      userBranchId: string | null;
      userId?: string;
      branchId?: string;
      page?: number;
      limit?: number;
    } & QueueFilterInput,
  ) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const now = new Date();

    const branchScope: Prisma.ContractWhereInput =
      params.userRole === 'SALES' || params.userRole === 'BRANCH_MANAGER'
        ? { branchId: params.userBranchId ?? undefined }
        : params.branchId
        ? { branchId: params.branchId }
        : {};

    const where = this.buildWhere(params.tab, now, branchScope);
    this.applyFilterWhere(where, params, params.userId);
    this.applySnoozeExclusion(where, params.userRole, params.userId, now);

    // Fetch all matching then sort by priority score in memory, then paginate.
    // We can't express the priority formula as a Prisma orderBy (it involves a
    // computed expression across payments + callLogs + counters). Acceptable
    // tradeoff: the overdue set is bounded by branch scope and status filter
    // to ~thousands at most in practice.
    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: queueContractInclude,
        take: FETCH_CAP, // cap the fetch — priority sort + pagination happens in memory
      }),
      this.prisma.contract.count({ where }),
    ]);

    const enriched = await this.enrichRows(contracts, now, params.userId);

    // Post-enrichment filters — computed fields can't go into Prisma where.
    const afterPostFilter = this.applyPostFilters(enriched, params, now);

    const rows = this.applySort(afterPostFilter, params.sortBy, params.userId, now);

    // If any post-filter fired, `total` must reflect filtered count so UI
    // pagination doesn't read "500 results" while showing 12. When no post-
    // filter active, fall back to the raw SQL count (authoritative for large sets).
    const hasPostFilter =
      params.lastContacted !== undefined ||
      params.lineResponse !== undefined ||
      params.minBrokenPromise !== undefined ||
      params.hasActivePromise !== undefined ||
      params.mdmState !== undefined ||
      params.slipReviewPending !== undefined ||
      params.minLetterCount !== undefined;

    const effectiveTotal = hasPostFilter ? afterPostFilter.length : total;

    const skip = (page - 1) * limit;
    const paged = rows.slice(skip, skip + limit).map(({ __priorityScore, ...rest }) => rest);

    const truncated = contracts.length >= FETCH_CAP;

    return { data: paged, total: effectiveTotal, page, limit, truncated };
  }

  /**
   * Mutate `where` to apply SQL-level filter constraints (branch overrides,
   * assignee, overdue buckets, outstanding range, contract/product type, skip
   * tracing, search). Callers pass the already-built tab-specific where.
   */
  private applyFilterWhere(
    where: Prisma.ContractWhereInput,
    f: QueueFilterInput,
    userId?: string,
  ): void {
    // Assignee override
    if (f.assignedToId === 'self') {
      where.assignedToId = userId ?? undefined;
    } else if (f.assignedToId === 'unassigned') {
      where.assignedToId = null;
    } else if (f.assignedToId) {
      where.assignedToId = f.assignedToId;
    }

    // Skip tracing
    if (f.showSkipTracing) {
      where.needsSkipTracing = true;
    }

    // Contract statuses — if provided, overrides any tab-defined status filter
    if (f.contractStatuses?.length) {
      where.status = { in: f.contractStatuses };
    }

    // Product types (via join)
    if (f.productTypes?.length) {
      where.product = { category: { in: f.productTypes } };
    }

    // Outstanding range — applied as a nested payment filter. We can't filter
    // directly on (amountDue - amountPaid + lateFee), so approximate with
    // amountDue; post-filter will tighten exact range on computed outstanding.
    // (Outstanding post-filter below handles exact bounds.)
    // No-op at SQL level — handled in applyPostFilters.

    // Search: customer name, contract#, phone
    if (f.search) {
      const q = f.search.trim();
      if (q) {
        const searchOr: Prisma.ContractWhereInput[] = [
          { contractNumber: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { customer: { phone: { contains: q.replace(/\D/g, '') } } },
        ];
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          { OR: searchOr },
        ];
      }
    }
  }

  /**
   * Hide contracts the current user has snoozed (active ContractSnooze rows
   * with `snoozedUntil > now`). OWNER bypasses the exclusion entirely so
   * they can audit what their team has parked. Anonymous calls (no userId)
   * also pass through unfiltered — there is nobody to exclude for.
   *
   * Implemented as a Prisma `NOT { snoozes: { some: { ... } } }` so the
   * filter happens in SQL (no in-memory gymnastics on large queues).
   */
  private applySnoozeExclusion(
    where: Prisma.ContractWhereInput,
    userRole: string,
    userId: string | undefined,
    now: Date,
  ): void {
    if (!userId) return;
    if (userRole === 'OWNER') return;

    const exclusion: Prisma.ContractWhereInput = {
      NOT: {
        snoozes: {
          some: {
            userId,
            snoozedUntil: { gt: now },
            deletedAt: null,
          },
        },
      },
    };
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      exclusion,
    ];
  }

  /**
   * Apply sort to enriched rows. Default (PRIORITY) uses the legacy in-memory
   * priority score (outstanding × daysOverdue × broken-promise multiplier).
   * Other sorts read directly from enriched fields. RANDOM uses a deterministic
   * Mulberry32 shuffle seeded by `${userId}-${YYYY-MM-DD}` so each collector
   * sees a stable order within a single day, but a different order than peers
   * — fair rotation without losing reload stability.
   */
  private applySort<
    T extends {
      outstanding: number;
      daysOverdue: number;
      lastContactedAt: Date | null;
      customer: { name: string };
      __priorityScore: number;
      id: string;
    },
  >(rows: T[], sortBy: QueueSortBy | undefined, userId: string | undefined, now: Date): T[] {
    const arr = rows.slice();
    switch (sortBy) {
      case QueueSortBy.OUTSTANDING_DESC:
        return arr.sort((a, b) => b.outstanding - a.outstanding);
      case QueueSortBy.OUTSTANDING_ASC:
        return arr.sort((a, b) => a.outstanding - b.outstanding);
      case QueueSortBy.DAYS_OVERDUE_DESC:
        return arr.sort((a, b) => b.daysOverdue - a.daysOverdue);
      case QueueSortBy.LAST_CONTACTED_ASC:
        // Never-contacted (null) ranks first — they're the most stale.
        return arr.sort((a, b) => {
          const at = a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : -Infinity;
          const bt = b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : -Infinity;
          return at - bt;
        });
      case QueueSortBy.NAME_ASC:
        return arr.sort((a, b) =>
          (a.customer.name ?? '').localeCompare(b.customer.name ?? '', 'th'),
        );
      case QueueSortBy.RANDOM: {
        const today = now.toISOString().slice(0, 10);
        const seed = `${userId ?? 'anon'}-${today}`;
        return seededShuffle(arr, seed);
      }
      case QueueSortBy.PRIORITY:
      default:
        return arr.sort((a, b) => b.__priorityScore - a.__priorityScore);
    }
  }

  /**
   * Apply filters that depend on enriched/computed fields. Runs after fetch,
   * so `rows` is bounded by FETCH_CAP.
   */
  private applyPostFilters<
    T extends {
      daysOverdue: number;
      outstanding: number;
      lastContactedAt: Date | null;
      brokenPromiseCount: number;
      mdmState: MdmState;
      settlementDate: Date | string | null;
      customer: { lineId: string | null };
      letterCount: number;
      slipReviewPending: boolean;
      latestLineDeliveryStatus?: string | null;
    },
  >(rows: T[], f: QueueFilterInput, now: Date): T[] {
    let filtered = rows;

    // Overdue buckets (computed on `daysOverdue`)
    if (f.overdueBuckets?.length) {
      const matchesBucket = (days: number, bucket: OverdueBucket) => {
        switch (bucket) {
          case OverdueBucket.B_1_7:
            return days >= 1 && days <= 7;
          case OverdueBucket.B_8_30:
            return days >= 8 && days <= 30;
          case OverdueBucket.B_31_60:
            return days >= 31 && days <= 60;
          case OverdueBucket.B_61_90:
            return days >= 61 && days <= 90;
          case OverdueBucket.B_90_PLUS:
            return days >= 91;
        }
      };
      filtered = filtered.filter((r) =>
        (f.overdueBuckets as OverdueBucket[]).some((b) => matchesBucket(r.daysOverdue, b)),
      );
    }

    // Outstanding range (exact)
    if (f.minOutstanding !== undefined) {
      filtered = filtered.filter((r) => r.outstanding >= (f.minOutstanding as number));
    }
    if (f.maxOutstanding !== undefined) {
      filtered = filtered.filter((r) => r.outstanding <= (f.maxOutstanding as number));
    }

    // Last contacted bucket
    if (f.lastContacted) {
      const nowMs = now.getTime();
      filtered = filtered.filter((r) => {
        const last = r.lastContactedAt ? new Date(r.lastContactedAt).getTime() : null;
        switch (f.lastContacted) {
          case LastContactedBucket.TODAY:
            return last !== null && nowMs - last < 86400000;
          case LastContactedBucket.THIS_WEEK:
            return last !== null && nowMs - last < 7 * 86400000;
          case LastContactedBucket.NEVER:
            return last === null;
          case LastContactedBucket.OVER_7_DAYS:
            return last === null || nowMs - last > 7 * 86400000;
          default:
            return true;
        }
      });
    }

    // Minimum broken-promise count
    if (f.minBrokenPromise !== undefined) {
      filtered = filtered.filter((r) => r.brokenPromiseCount >= (f.minBrokenPromise as number));
    }

    // MDM state
    if (f.mdmState) {
      filtered = filtered.filter((r) => {
        switch (f.mdmState) {
          case MdmStateFilter.NOT_LOCKED:
            return r.mdmState === 'NONE' || r.mdmState === 'UNLOCKED';
          case MdmStateFilter.LOCKED:
            return r.mdmState === 'LOCKED';
          case MdmStateFilter.PENDING:
            return r.mdmState === 'PENDING';
          default:
            return true;
        }
      });
    }

    // Has active promise — defined as settlementDate present and in the future
    // or within the last 3 days (aligns with promise-tab window).
    if (f.hasActivePromise !== undefined) {
      filtered = filtered.filter((r) => {
        if (!r.settlementDate) return !f.hasActivePromise;
        const sms = new Date(r.settlementDate).getTime();
        const active = sms >= now.getTime() - 3 * 86400000;
        return f.hasActivePromise ? active : !active;
      });
    }

    // Minimum letter count — count of ContractLetter rows per contract.
    if (f.minLetterCount !== undefined) {
      filtered = filtered.filter((r) => r.letterCount >= (f.minLetterCount as number));
    }

    // Slip review pending — rows with at least one PaymentEvidence in
    // PENDING_REVIEW. Useful for finance to clear pending-slip backlog.
    if (f.slipReviewPending !== undefined) {
      filtered = filtered.filter((r) =>
        f.slipReviewPending ? r.slipReviewPending : !r.slipReviewPending,
      );
    }

    // LINE response (Z10): now backed by `ChatMessage.deliveryStatus`. The
    // enrichment populates `latestLineDeliveryStatus` from the most recent
    // outbound LINE message per contract's customer. NO_LINE remains a
    // customer-attribute filter; the other three read the new column.
    //
    // Backfill caveat: outbound messages sent before the migration land with
    // NULL status — those rows fall through all status filters and remain
    // visible regardless of which filter is active.
    if (f.lineResponse === LineResponseState.NO_LINE) {
      filtered = filtered.filter((r) => !r.customer.lineId);
    } else if (f.lineResponse === LineResponseState.RESPONDED) {
      filtered = filtered.filter((r) => r.latestLineDeliveryStatus === 'RESPONDED');
    } else if (f.lineResponse === LineResponseState.IGNORED) {
      filtered = filtered.filter((r) => r.latestLineDeliveryStatus === 'IGNORED');
    } else if (f.lineResponse === LineResponseState.BLOCKED) {
      filtered = filtered.filter((r) => r.latestLineDeliveryStatus === 'BLOCKED');
    }

    return filtered;
  }

  /**
   * Enrich contracts with card indicator fields:
   * - lastContactedAt: max(CallLog.createdAt, DunningAction.executedAt)
   * - brokenPromiseCount: count of BROKEN_PROMISE audit events
   * - mdmState: NONE | PENDING | LOCKED | UNLOCKED (latest MdmLockRequest)
   * - relatedContractsCount: other active contracts for same customer
   * - lastChannel: channel of most recent DunningAction
   *
   * Uses batched groupBy + findMany(distinct) to avoid N+1 — one query per
   * aggregate regardless of how many contracts were fetched.
   */
  private async enrichRows(
    contracts: QueueContract[],
    now: Date,
    currentUserId: string | undefined,
  ) {
    if (contracts.length === 0) return [];

    const contractIds = contracts.map((c) => c.id);
    const customerIds = [...new Set(contracts.map((c) => c.customerId))];

    // For trending arrow: pull the snapshot closest to "7 days ago" within a
    // ±1 day window so we still get a comparison even when the cron skipped
    // a day (DB outage, deploy, etc.). `findMany({ distinct: contractId,
    // orderBy: date desc })` collapses to one row per contract — the most
    // recent snapshot in the window — which we then compare to today.
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoLow = new Date(sevenDaysAgo);
    sevenDaysAgoLow.setDate(sevenDaysAgoLow.getDate() - 1);
    const sevenDaysAgoHigh = new Date(sevenDaysAgo);
    sevenDaysAgoHigh.setDate(sevenDaysAgoHigh.getDate() + 1);

    const [
      lastCalls,
      lastActions,
      brokenPromises,
      latestMdms,
      customerContractCounts,
      lastChannels,
      letterCounts,
      pendingSlipEvidences,
      sevenDayAgoSnapshots,
      activeSnoozes,
      latestLineMessages,
    ] = await Promise.all([
      this.prisma.callLog.groupBy({
        by: ['contractId'],
        where: { contractId: { in: contractIds }, deletedAt: null },
        _max: { createdAt: true },
      }),
      this.prisma.dunningAction.groupBy({
        by: ['contractId'],
        where: {
          contractId: { in: contractIds },
          deletedAt: null,
          executedAt: { not: null },
        },
        _max: { executedAt: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['entityId'],
        where: {
          entityId: { in: contractIds },
          entity: 'Contract',
          action: 'BROKEN_PROMISE',
        },
        _count: { _all: true },
      }),
      this.prisma.mdmLockRequest.findMany({
        where: { contractId: { in: contractIds }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        distinct: ['contractId'],
        select: { contractId: true, status: true },
      }),
      this.prisma.contract.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: customerIds },
          status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      this.prisma.dunningAction.findMany({
        where: {
          contractId: { in: contractIds },
          deletedAt: null,
          executedAt: { not: null },
        },
        orderBy: { executedAt: 'desc' },
        distinct: ['contractId'],
        select: { contractId: true, channel: true },
      }),
      // Letters dispatched per contract — used by minLetterCount filter.
      this.prisma.contractLetter.groupBy({
        by: ['contractId'],
        where: { contractId: { in: contractIds }, deletedAt: null },
        _count: { _all: true },
      }),
      // Pending slip evidence per contract — used by slipReviewPending filter.
      // PaymentEvidence.status='PENDING_REVIEW' is the source of truth for
      // slips awaiting finance review (see slip-review module).
      this.prisma.paymentEvidence.groupBy({
        by: ['contractId'],
        where: {
          contractId: { in: contractIds },
          deletedAt: null,
          status: 'PENDING_REVIEW',
        },
        _count: { _all: true },
      }),
      // Trending arrow source — most recent snapshot within ±1d of 7 days
      // ago, one row per contract (Task 10).
      this.prisma.contractDailySnapshot.findMany({
        where: {
          contractId: { in: contractIds },
          date: { gte: sevenDaysAgoLow, lte: sevenDaysAgoHigh },
        },
        orderBy: { date: 'desc' },
        distinct: ['contractId'],
        select: { contractId: true, daysOverdue: true },
      }),
      // Active per-user snoozes for the rows we fetched. OWNER sees the
      // queue with snoozed cards retained (the SQL exclusion is bypassed for
      // OWNER) — surface the snoozedUntil so the UI can render the badge.
      // For non-OWNER callers this list is empty (their snoozed cards were
      // already filtered out at the SQL level).
      currentUserId
        ? this.prisma.contractSnooze.findMany({
            where: {
              contractId: { in: contractIds },
              userId: currentUserId,
              snoozedUntil: { gt: now },
              deletedAt: null,
            },
            orderBy: { snoozedUntil: 'desc' },
            distinct: ['contractId'],
            select: { contractId: true, snoozedUntil: true },
          })
        : Promise.resolve([] as { contractId: string; snoozedUntil: Date }[]),
      // Z10: latest outbound LINE message per customer with deliveryStatus.
      // Used by lineResponse post-filter (RESPONDED / IGNORED / BLOCKED).
      // Only BOT/STAFF/AUTO_TRIGGER roles count as "our outbound" — inbound
      // CUSTOMER messages are excluded. distinct on roomId then mapped to
      // customerId via the join.
      this.prisma.chatMessage.findMany({
        where: {
          deletedAt: null,
          role: { in: ['BOT', 'STAFF', 'AUTO_TRIGGER'] },
          deliveryStatus: { not: null },
          room: { customerId: { in: customerIds }, deletedAt: null },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['roomId'],
        select: {
          deliveryStatus: true,
          room: { select: { customerId: true } },
        },
      }),
    ]);

    const callMap = new Map<string, Date | null>(
      lastCalls.map((r) => [r.contractId, r._max.createdAt ?? null]),
    );
    const actionMap = new Map<string, Date | null>(
      lastActions.map((r) => [r.contractId, r._max.executedAt ?? null]),
    );
    const brokenMap = new Map<string, number>(
      brokenPromises.map((r) => [r.entityId, r._count._all]),
    );
    const mdmMap = new Map<string, string>(
      latestMdms.map((r) => [r.contractId, r.status]),
    );
    const customerCountMap = new Map<string, number>(
      customerContractCounts.map((r) => [r.customerId, r._count._all]),
    );
    const channelMap = new Map<string, string>(
      lastChannels.map((r) => [r.contractId, r.channel]),
    );
    const letterCountMap = new Map<string, number>(
      letterCounts.map((r) => [r.contractId, r._count._all]),
    );
    const slipPendingSet = new Set<string>(
      pendingSlipEvidences.filter((r) => r._count._all > 0).map((r) => r.contractId),
    );
    const sevenDayMap = new Map<string, number>(
      sevenDayAgoSnapshots.map((r) => [r.contractId, r.daysOverdue]),
    );
    const snoozeMap = new Map<string, Date>(
      activeSnoozes.map((r) => [r.contractId, r.snoozedUntil]),
    );
    // Z10: customerId → latest outbound LINE deliveryStatus.
    const lineStatusByCustomer = new Map<string, string>();
    for (const m of latestLineMessages) {
      const cid = m.room?.customerId;
      if (cid && m.deliveryStatus && !lineStatusByCustomer.has(cid)) {
        lineStatusByCustomer.set(cid, m.deliveryStatus);
      }
    }

    return contracts.map((c) => {
      const base = this.toRow(c, now);
      const call = callMap.get(c.id) ?? null;
      const action = actionMap.get(c.id) ?? null;
      const lastContactedAt =
        call && action ? (call > action ? call : action) : call ?? action ?? null;

      const trendingArrow = this.computeTrendingArrow(
        base.daysOverdue,
        sevenDayMap.get(c.id),
      );
      const snoozedUntil = snoozeMap.get(c.id) ?? null;

      return {
        ...base,
        lastContactedAt,
        brokenPromiseCount: brokenMap.get(c.id) ?? 0,
        mdmState: this.toMdmState(mdmMap.get(c.id)),
        relatedContractsCount: Math.max(0, (customerCountMap.get(c.customerId) ?? 1) - 1),
        lastChannel: this.toLastChannel(channelMap.get(c.id)),
        letterCount: letterCountMap.get(c.id) ?? 0,
        slipReviewPending: slipPendingSet.has(c.id),
        trendingArrow,
        snoozedUntil,
        // Z10: latest outbound LINE delivery status (RESPONDED/IGNORED/BLOCKED
        // /DELIVERED/READ) for the lineResponse post-filter.
        latestLineDeliveryStatus: lineStatusByCustomer.get(c.customerId) ?? null,
      };
    });
  }

  /**
   * Compare today's daysOverdue with the same contract's daysOverdue ~7
   * days ago. Returns:
   *  - 'UP'   delta > 0 → getting worse (overdue accumulating)
   *  - 'DOWN' delta < 0 → improving (customer paid down balance)
   *  - null   no historical snapshot OR delta === 0
   *
   * Important: zero-delta and missing-data both render as "no arrow" in
   * the UI. They are semantically different (no info vs no change) but
   * surfacing two distinct null states would clutter the badge — the UI
   * already shows the absolute daysOverdue prominently, so the trend chip
   * is purely additive.
   */
  private computeTrendingArrow(
    todayDays: number,
    sevenDayDays: number | undefined,
  ): 'UP' | 'DOWN' | null {
    if (sevenDayDays === undefined) return null;
    const delta = todayDays - sevenDayDays;
    if (delta > 0) return 'UP';
    if (delta < 0) return 'DOWN';
    return null;
  }

  private toMdmState(status: string | undefined): MdmState {
    if (!status) return 'NONE';
    if (status === 'PENDING') return 'PENDING';
    if (status === 'UNLOCKED') return 'UNLOCKED';
    if (
      status === 'APPROVED' ||
      status === 'EXECUTED_MANUAL' ||
      status === 'EXECUTED_API'
    ) {
      return 'LOCKED';
    }
    // REJECTED / FAILED → treat as no active lock
    return 'NONE';
  }

  private toLastChannel(channel: string | undefined): LastChannel {
    switch (channel) {
      case 'LINE':
        return 'LINE';
      case 'SMS':
        return 'SMS';
      case 'CALL_TASK':
        return 'CALL';
      default:
        return null;
    }
  }

  /**
   * Priority = outstanding × daysOverdue × (noAnswerCount+1) × brokenPromiseMultiplier.
   * Larger score = higher urgency. Broken promises weigh 2× per occurrence to
   * surface serial promise-breakers first.
   */
  private priorityScore(
    outstanding: number,
    daysOverdue: number,
    noAnswerCount: number,
    brokenPromiseCount: number,
  ): number {
    const brokenMul = 1 + brokenPromiseCount * 2;
    return Math.max(0, outstanding) * Math.max(0, daysOverdue) * (noAnswerCount + 1) * brokenMul;
  }

  private buildWhere(
    tab: QueueTab,
    now: Date,
    branchScope: Prisma.ContractWhereInput,
  ): Prisma.ContractWhereInput {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    if (tab === 'today') {
      return {
        ...branchScope,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
        OR: [{ blockAutoEscalation: null }, { blockAutoEscalation: { lt: now } }],
        payments: {
          some: {
            dueDate: { lte: now },
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          },
        },
        callLogs: {
          none: { calledAt: { gte: startOfDay } },
        },
      };
    }

    if (tab === 'followup') {
      return {
        ...branchScope,
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
        noAnswerCount: { gte: 1, lt: 3 },
      };
    }

    // promise
    const todayMinus3 = new Date(now.getTime() - 3 * 86400000);
    const todayPlus30 = new Date(now.getTime() + 30 * 86400000);
    return {
      ...branchScope,
      deletedAt: null,
      callLogs: {
        some: {
          result: { in: ['PROMISED', 'ANSWERED'] },
          settlementDate: { gte: todayMinus3, lte: todayPlus30 },
        },
      },
    };
  }

  private toRow(c: QueueContract, now: Date) {
    const payment = c.payments[0];
    const callLog = c.callLogs[0];
    const outstanding = payment
      ? new Prisma.Decimal(payment.amountDue)
          .sub(payment.amountPaid)
          .add(payment.lateFee)
          .toNumber()
      : 0;
    const daysOverdue = payment
      ? Math.max(0, Math.floor((now.getTime() - new Date(payment.dueDate).getTime()) / 86400000))
      : 0;
    const brokenPromiseCount = c._count?.callLogs ?? 0;
    const __priorityScore = this.priorityScore(outstanding, daysOverdue, c.noAnswerCount ?? 0, brokenPromiseCount);
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      status: c.status,
      dunningStage: c.dunningStage,
      customer: c.customer,
      branch: c.branch,
      assignedTo: c.assignedTo,
      outstanding,
      daysOverdue,
      lastCallResult: callLog?.result ?? null,
      lastCallAt: callLog?.calledAt ?? null,
      noAnswerCount: c.noAnswerCount,
      settlementDate: callLog?.settlementDate ?? null,
      needsSkipTracing: c.needsSkipTracing,
      deviceLocked: c.deviceLocked,
      __priorityScore,
    };
  }
}
