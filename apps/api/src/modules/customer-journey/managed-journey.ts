import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JOURNEY_DEFAULT_GROUPS,
  JOURNEY_EVENT_GROUPS,
  ManagedJourneyAcknowledgement,
  ManagedJourneyList,
  ManagedJourneySummary,
  JourneyRedirect,
  CUSTOMER_BOUGHT_CONTRACT_STATUSES,
  CUSTOMER_BOUGHT_SALE_TYPES,
  JourneyEvent,
} from '@installment/shared';
import { PartyJourneyPlan } from '../employee-access/access-party-journey-plan';
import { journeyAccess } from '../employee-access/access-party-journey-context';
import { onDomainCommit } from '../employee-access/access-execution-context';
import { JourneyListQueryDto } from './dto/journey-list-query.dto';
import { CreateJourneyEntryDto } from './dto/create-journey-entry.dto';
import {
  countJourneyGroups,
  sourcesForGroups,
  DEFAULT_JOURNEY_LIMIT,
  JOURNEY_COUNT_CAP,
  JOURNEY_NOT_RECORDED,
} from './customer-journey.service';
import { decodeJourneyCursor, mergeJourneyPage, JourneyWindow } from './sources/journey-window';
import { buildJourneySummary, postSaleBadges } from './journey-summary.builder';
import { readManagedJourneyState } from './journey-state-reader';
import { manualEntryDedupeKey } from './journey-manual-entry.service';
import { MANUAL_ENTRY_EVENT_SELECT, manualEntryToEvent } from './sources/manual-entry-event';
import { AuditService } from '../audit/audit.service';
import { JourneyStateService } from './journey-state.service';
import { Prisma, ContractStatus } from '@prisma/client';
import { CUSTOMER_DOCUMENT_FILE_FRAGMENT } from './chat-document-file';

const denied = () => new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับข้อมูลนี้');
/** Wire adapter for the four exact managed routes. Legacy/system callers retain
 * their original services; all managed producers share one owned party plan. */
export class ManagedJourney {
  constructor(
    readonly plan: PartyJourneyPlan,
    private readonly audit: AuditService,
    private readonly state: JourneyStateService,
  ) {}
  private actor() {
    return { id: this.plan.ctx.snapshot.userId, role: '' };
  }
  async summary(): Promise<ManagedJourneySummary> {
    const p = this.plan;
    if (
      ![
        'customer',
        'chatRoom',
        'sale',
        'contract',
        'booking',
        'creditCheck',
        'customerJourneyEntry',
        'onlineOrder',
        'onlineInstallmentApplication',
        'savingPlan',
        'tradeIn',
      ].some((key) => p.ids[key as keyof typeof p.ids].size > 0)
    )
      return { scope: 'authorized-sources', availability: 'unavailable', facts: null };
    const now = new Date(),
      state = await readManagedJourneyState(p, now);
    const cId = { in: [...p.family] };
    const [ad, contracts, sales, repair, checks, fileFacts, manual] = await Promise.all([
      state.firstAdCampaignId && p.ids.adsCampaign.has(state.firstAdCampaignId)
        ? p.db.adsCampaign.findUnique({
            where: { id: state.firstAdCampaignId },
            select: { id: true, campaignName: true },
          })
        : null,
      p.db.contract.findMany({
        where: {
          id: { in: [...p.ids.contract] },
          customerId: cId,
          deletedAt: null,
          status: { in: [...CUSTOMER_BOUGHT_CONTRACT_STATUSES] as ContractStatus[] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { status: true },
      }),
      p.db.sale.count({
        where: {
          id: { in: [...p.ids.sale] },
          customerId: cId,
          deletedAt: null,
          saleType: { in: [...CUSTOMER_BOUGHT_SALE_TYPES] },
        },
      }),
      p.db.repairTicket.count({
        where: { id: { in: [...p.ids.repairTicket] }, customerId: cId, deletedAt: null },
      }),
      p.ids.creditCheck.size
        ? p.db.auditLog.findFirst({
            where: {
              entity: 'credit_check',
              action: 'CREDIT_CHECK_OVERRIDE',
              entityId: { in: [...p.ids.creditCheck] },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { newValue: true },
          })
        : null,
      p.ids.chatFileRoom.size
        ? p.db.$queryRaw<
            { any: boolean; atCreditAt: boolean }[]
          >`SELECT COUNT(*)>0 AS "any",COALESCE(bool_or(m.created_at=${state.creditAt?.toISOString() ?? null}::timestamp),false) AS "atCreditAt" FROM chat_messages m WHERE m.room_id IN (${Prisma.join([...p.ids.chatFileRoom])}) AND ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}`
        : [],
      state.interestedAt
        ? p.db.customerJourneyEntry.count({
            where: {
              id: { in: [...p.ids.customerJourneyEntry] },
              kind: 'TOUCHPOINT',
              outcome: { in: ['APPOINTED', 'VISITED'] },
              deletedAt: null,
              occurredAt: state.interestedAt,
            },
          })
        : 0,
    ]);
    const creditValue = checks?.newValue;
    const creditRejected =
      !!creditValue &&
      typeof creditValue === 'object' &&
      !Array.isArray(creditValue) &&
      creditValue.status === 'REJECTED';
    const facts = buildJourneySummary(
      {
        ...state,
        contactedAt: state.contactedAt ?? state.stageEnteredAt ?? now,
        stageEnteredAt: state.stageEnteredAt ?? now,
      },
      {
        firstAd: ad ? { id: ad.id, name: ad.campaignName } : null,
        interestedByManualEntry: manual > 0,
        creditByChatFile: fileFacts[0]?.atCreditAt ?? false,
        hasCustomerChatFile: fileFacts[0]?.any ?? false,
        creditCheckStatus: p.ids.creditCheck.size ? 'PENDING' : 'NONE',
        purchaseCount: contracts.length + sales,
        creditRejected,
        postSaleBadges: postSaleBadges({
          latestContractStatus: contracts[0]?.status ?? null,
          purchaseCount: contracts.length + sales,
          hasRepairTicket: repair > 0,
          skipTracingLost: false,
        }),
      },
      now,
    );
    const availability = p.availability();
    const complete =
      Object.values(availability).every((v) => v === 'available') &&
      p.lossProven &&
      !!state.contactedAt &&
      !p.unproven.size &&
      [...p.party.live].every((company) =>
        (
          [
            'sensitive.customer-identity.read',
            'documents.read',
            'chat-ai.read',
            'chat-analytics.read',
          ] as const
        ).every((permission) => p.party.company(permission, company)),
      );
    const origin = p.customers.get(p.targetId);
    const knownWalkIn = p.ids.customer.has(p.targetId) && origin?.acquisitionSource === 'WALK_IN';
    const channelKnown =
      facts.firstChannel?.startsWith('CHAT_') ||
      (facts.firstChannel === 'REFERRAL' && p.referrerAllowed) ||
      knownWalkIn;
    const sourceKnown =
      !!ad ||
      facts.firstSource?.startsWith('CHAT_') ||
      (facts.firstSource === 'REFERRAL' && p.referrerAllowed) ||
      !!facts.heardFrom ||
      knownWalkIn;
    return {
      scope: 'authorized-sources',
      availability: complete ? 'available' : 'partial',
      facts: {
        ...facts,
        // Null is unknown where a global negative would require absent sources.
        contactedAt: state.contactedAt ? facts.contactedAt : null,
        stage: state.stageEnteredAt ? facts.stage : null,
        stageLabel: state.stageEnteredAt ? facts.stageLabel : null,
        stageEnteredAt: state.stageEnteredAt ? facts.stageEnteredAt : null,
        daysInStage: state.stageEnteredAt ? facts.daysInStage : null,
        lost: p.lossProven ? facts.lost : null,
        silentDays:
          p.lossProven && (state.contactedAt || state.lastCustomerAt || state.lastTouchAt)
            ? facts.silentDays
            : null,
        creditRejected: creditRejected ? true : complete ? false : null,
        creditFilePending: complete ? facts.creditFilePending : null,
        askHeardFrom: complete ? facts.askHeardFrom : null,
        firstChannel: channelKnown ? facts.firstChannel : null,
        firstSource: sourceKnown ? facts.firstSource : null,
        firstSourceLabel: sourceKnown ? facts.firstSourceLabel : null,
        steps: facts.steps.map((s) => {
          if (s.stage === 'CONTACTED' && !state.contactedAt)
            return { ...s, at: null, state: 'unknown' as const, evidence: null };
          return complete || s.at !== null
            ? s
            : { ...s, state: 'unknown' as const, evidence: null };
        }),
      },
    };
  }
  async list(query: JourneyListQueryDto): Promise<ManagedJourneyList | JourneyRedirect> {
    const p = this.plan;
    if (p.requestedId !== p.targetId) {
      if (!p.ids.customer.has(p.requestedId) || !p.ids.customer.has(p.targetId)) throw denied();
      return { redirectToCustomerId: p.targetId };
    }
    const before = query.cursor ? decodeJourneyCursor(query.cursor) : undefined;
    const date = (v?: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('ช่วงวันที่ไม่ถูกต้อง');
      return d;
    };
    const window: JourneyWindow = {
      limit: query.limit ?? DEFAULT_JOURNEY_LIMIT,
      before,
      from: date(query.from),
      to: date(query.to),
    };
    if (window.from && window.to && window.from > window.to)
      throw new BadRequestException('ช่วงวันที่ไม่ถูกต้อง');
    const include = new Set(before ? [] : (query.include ?? [])),
      groups = new Set(query.groups?.length ? query.groups : JOURNEY_DEFAULT_GROUPS);
    const countGroups = new Set(JOURNEY_EVENT_GROUPS);
    const selected = include.has('counts') ? countGroups : groups;
    const scan = {
      ...window,
      limit: include.has('counts') ? Math.max(window.limit, JOURNEY_COUNT_CAP) : window.limit,
    };
    // Per-group scans preserve the canonical cap; denied rows never consume take.
    const perGroup = await Promise.all(
      [...selected].map(async (group) => ({
        group,
        lists: await Promise.all(
          sourcesForGroups(new Set([group])).map((source) =>
            source(p.db as PrismaService, [...p.family], scan, this.actor()),
          ),
        ),
      })),
    );
    const pageLists = perGroup
      .filter((g) => groups.has(g.group))
      .flatMap((g) => g.lists.map((rows) => rows.slice(0, window.limit + 1)));
    const { events, nextCursor } = mergeJourneyPage(pageLists, window.limit, groups);
    const availability = p.availability();
    const counts = countJourneyGroups(
      perGroup.flatMap((g) => g.lists),
      countGroups,
    );
    return {
      scope: 'authorized-sources',
      customerId: p.targetId,
      mergedCustomerIds: [...p.ids.customer].filter((id) => id !== p.targetId),
      events,
      nextCursor,
      availability,
      notRecorded: [...JOURNEY_NOT_RECORDED],
      ...(include.has('counts')
        ? {
            counts: Object.fromEntries(
              JOURNEY_EVENT_GROUPS.map((g) => [
                g,
                availability[g] === 'unavailable' ? null : (counts[g] ?? 0),
              ]),
            ),
          }
        : {}),
      ...(include.has('summary') ? { summary: await this.summary() } : {}),
    };
  }
  async summaryRoute(): Promise<ManagedJourneySummary | JourneyRedirect> {
    const p = this.plan;
    if (p.requestedId !== p.targetId) {
      if (!p.ids.customer.has(p.requestedId) || !p.ids.customer.has(p.targetId)) throw denied();
      return { redirectToCustomerId: p.targetId };
    }
    return this.summary();
  }
  private async refresh() {
    return PartyJourneyPlan.create(this.plan.party, this.plan.sources, this.plan.targetId);
  }
  private async acknowledgement(
    entryId: string | null,
    withEvent: boolean,
  ): Promise<ManagedJourneyAcknowledgement> {
    const fresh = await this.refresh();
    if (
      !(fresh.identity.get(fresh.targetId) ?? []).some((source) =>
        fresh.party.allows('customer-journey.read', source),
      )
    )
      return { entryId, event: null, summary: null, availability: 'unavailable' };
    return journeyAccess.run(fresh, async () => {
      let event: JourneyEvent | null = null;
      if (withEvent && entryId && fresh.ids.customerJourneyEntry.has(entryId)) {
        const row = await fresh.db.customerJourneyEntry.findUniqueOrThrow({
          where: { id: entryId },
          select: MANUAL_ENTRY_EVENT_SELECT,
        });
        event = manualEntryToEvent(row, this.actor(), new Date());
      }
      return {
        entryId,
        event,
        summary: await new ManagedJourney(fresh, this.audit, this.state).summary(),
        availability: 'partial',
      };
    });
  }
  private kindColumns(dto: CreateJourneyEntryDto) {
    return {
      channel: dto.kind === 'TOUCHPOINT' ? (dto.channel ?? null) : null,
      outcome: dto.kind === 'TOUCHPOINT' ? (dto.outcome ?? null) : null,
      lostReason: dto.kind === 'MARKED_LOST' ? (dto.lostReason ?? null) : null,
      heardFrom: dto.kind === 'HEARD_FROM' ? (dto.heardFrom ?? null) : null,
    };
  }
  async create(dto: CreateJourneyEntryDto): Promise<ManagedJourneyAcknowledgement> {
    const p = this.plan;
    p.assertMutation();
    if (['MARKED_LOST', 'REOPENED'].includes(dto.kind)) p.assertLoss();
    const dedupeKey = dto.clientRequestId
      ? manualEntryDedupeKey(dto.kind, dto.clientRequestId)
      : null;
    const previous = dedupeKey
      ? await p.db.customerJourneyEntry.findUnique({ where: { dedupeKey } })
      : null;
    const columns = this.kindColumns(dto);
    if (previous) {
      if (
        previous.actorUserId !== p.ctx.snapshot.userId ||
        previous.kind !== dto.kind ||
        previous.deletedAt ||
        !p.family.has(previous.customerId) ||
        !p.family.has(previous.originCustomerId) ||
        Object.entries(columns).some(([k, v]) => previous[k as keyof typeof columns] !== v)
      )
        throw new ConflictException('คำขอนี้ถูกใช้แล้ว');
      p.assertReplay(previous);
      return this.acknowledgement(previous.id, true);
    }
    if (dto.kind === 'MARKED_LOST' || dto.kind === 'REOPENED') {
      const current = await readManagedJourneyState(p);
      if (dto.kind === 'MARKED_LOST' && current.bought)
        throw new ConflictException('ลูกค้ารายนี้ซื้อแล้ว ติดป้ายหลุดไม่ได้');
      if (dto.kind === 'REOPENED' && !current.lostAt) return this.acknowledgement(null, false);
    }
    const row = await p.db.customerJourneyEntry.create({
      data: {
        customerId: p.targetId,
        originCustomerId: p.targetId,
        origin: 'MANUAL',
        kind: dto.kind,
        occurredAt: new Date(),
        actorType: 'STAFF',
        actorUserId: p.ctx.snapshot.userId,
        roomId: null,
        refType: null,
        refId: null,
        note: null,
        ...columns,
        dedupeKey,
      },
      select: { id: true },
    });
    await this.audit.log(
      {
        userId: p.ctx.snapshot.userId,
        action: 'CUSTOMER_JOURNEY_ENTRY_CREATED',
        entity: 'customer_journey_entry',
        entityId: row.id,
        newValue: { kind: dto.kind },
      },
      p.db,
    );
    onDomainCommit(() => this.state.recompute([p.targetId]));
    return this.acknowledgement(row.id, true);
  }
  async remove(entryId: string): Promise<ManagedJourneyAcknowledgement> {
    const p = this.plan;
    p.assertMutation();
    await p.db.$queryRaw`SELECT id FROM customer_journey_entries WHERE id=${entryId} FOR UPDATE`;
    const row = await p.db.customerJourneyEntry.findUnique({ where: { id: entryId } });
    if (!row || !p.family.has(row.customerId) || !p.canUndo(row)) throw denied();
    if (['MARKED_LOST', 'REOPENED'].includes(row.kind)) p.assertLoss();
    if (!row.deletedAt) {
      const changed = await p.db.customerJourneyEntry.updateMany({
        where: {
          id: entryId,
          origin: 'MANUAL',
          roomId: null,
          deletedAt: null,
          customerId: { in: [...p.family] },
        },
        data: { deletedAt: new Date(), deletedById: p.ctx.snapshot.userId },
      });
      if (changed.count) {
        await this.audit.log(
          {
            userId: p.ctx.snapshot.userId,
            action: 'CUSTOMER_JOURNEY_ENTRY_UNDONE',
            entity: 'customer_journey_entry',
            entityId: row.id,
            newValue: { kind: row.kind },
          },
          p.db,
        );
        onDomainCommit(() => this.state.recompute([p.targetId]));
      }
    }
    return this.acknowledgement(entryId, false);
  }
}
