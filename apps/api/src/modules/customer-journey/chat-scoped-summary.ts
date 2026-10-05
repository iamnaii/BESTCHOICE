import type { ContractStatus, Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import {
  CUSTOMER_BOUGHT_CONTRACT_STATUSES,
  CUSTOMER_BOUGHT_SALE_TYPES,
  type ChatWorkActor,
  type WorkScope,
} from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { roomWorkWhere } from '../staff-chat/services/chat-work-access.service';
import { salesBranchWhere } from '../sales/services/sales-read-policy';
import { buildJourneySummary, postSaleBadges } from './journey-summary.builder';

/** Bounded canonical aliases, shared by the read projection and scoped disposition writer. */
export async function chatCustomerFamily(db: Prisma.TransactionClient, id: string) {
  const family = new Set([id]);
  let frontier = [id];
  for (let depth = 0; frontier.length; depth++) {
    if (depth >= 20) throw new ConflictException('ข้อมูลการรวมลูกค้าต้องได้รับการตรวจสอบ');
    const aliases = await db.customer.findMany({
      where: { mergedIntoId: { in: frontier } },
      select: { id: true },
    });
    frontier = aliases.map((a) => a.id).filter((id) => !family.has(id));
    frontier.forEach((id) => family.add(id));
  }
  return [...family];
}

/** Chat projections never read the global Journey cache or unscoped customer disposition. */
export async function chatScopedSummary(
  db: PrismaService,
  customer: { id: string; phone: string | null; nationalId: string | null; createdAt: Date },
  actor: ChatWorkActor,
  scope: WorkScope,
) {
  const customerId = { in: await chatCustomerFamily(db, customer.id) };
  const rooms = await db.chatRoom.findMany({
    where: { AND: [roomWorkWhere(actor, scope), { customerId }] },
    select: { id: true, channel: true },
  });
  const roomId = { in: rooms.map((r) => r.id) };
  const branch = salesBranchWhere(actor, scope.branchId);
  const now = new Date();
  const emptyContracts: Array<{ createdAt: Date; status: ContractStatus }> = [];
  const [inbound, lastInbound, staff, entries, appointment, credit, sales, contracts, repairs] =
    await Promise.all([
      db.chatMessage.findMany({
        where: { roomId, role: 'CUSTOMER', deletedAt: null, createdAt: { lte: now } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { createdAt: true, roomId: true },
        take: 1,
      }),
      db.chatMessage.findFirst({
        where: { roomId, role: 'CUSTOMER', deletedAt: null, createdAt: { lte: now } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      }),
      db.chatMessage.findFirst({
        where: { roomId, role: 'STAFF', deletedAt: null, outboundSentAt: { not: null } },
        orderBy: { outboundSentAt: 'asc' },
        select: { outboundSentAt: true },
      }),
      db.customerJourneyEntry.findMany({
        where: { customerId, roomId, deletedAt: null, occurredAt: { lte: now } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      db.todo.findFirst({
        where: { roomId, deletedAt: null, dueDate: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      db.roomCreditAnalysis.findFirst({
        where: { roomId, deletedAt: null, status: 'COMPLETED' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      scope.company === 'SHOP'
        ? db.sale.findMany({
            where: {
              ...branch,
              customerId,
              deletedAt: null,
              saleType: { in: [...CUSTOMER_BOUGHT_SALE_TYPES] },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { createdAt: true, saleType: true },
          })
        : [],
      scope.company === 'FINANCE'
        ? db.contract.findMany({
            where: { ...branch, customerId, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { createdAt: true, status: true },
          })
        : emptyContracts,
      // Repair tickets are SHOP documents; they carry an explicit branch.
      scope.company === 'SHOP'
        ? db.repairTicket.count({ where: { ...branch, customerId, deletedAt: null } })
        : 0,
    ]);
  const earliest = (...dates: (Date | null | undefined)[]) =>
    dates.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const identifiedEntry = entries.find((e) => e.kind === 'IDENTIFIED');
  const interestEntry = entries.find(
    (e) => e.kind === 'TOUCHPOINT' && ['APPOINTED', 'VISITED'].includes(e.outcome ?? ''),
  );
  const boughtContracts = contracts.filter((c) =>
    (CUSTOMER_BOUGHT_CONTRACT_STATUSES as readonly string[]).includes(c.status),
  );
  const contactedAt = inbound[0]?.createdAt ?? entries[0]?.occurredAt ?? customer.createdAt;
  const identifiedAt =
    identifiedEntry?.occurredAt ?? (customer.phone || customer.nationalId ? contactedAt : null);
  const interestedAt = earliest(interestEntry?.occurredAt, appointment?.createdAt);
  const creditAt = earliest(credit?.createdAt, contracts[0]?.createdAt);
  const firstPurchaseAt = earliest(sales[0]?.createdAt, boughtContracts[0]?.createdAt);
  const stage = firstPurchaseAt
    ? 'PURCHASED'
    : creditAt
      ? 'CREDIT'
      : interestedAt
        ? 'INTERESTED'
        : identifiedAt
          ? 'IDENTIFIED'
          : 'CONTACTED';
  const lastCustomerAt = lastInbound?.createdAt ?? null;
  const lastTouchAt = entries.filter((e) => e.kind === 'TOUCHPOINT').at(-1)?.occurredAt ?? null;
  const disposition = entries.filter((e) => ['MARKED_LOST', 'REOPENED'].includes(e.kind)).at(-1);
  const lost =
    !firstPurchaseAt &&
    disposition?.kind === 'MARKED_LOST' &&
    (!lastCustomerAt || lastCustomerAt <= disposition.occurredAt) &&
    (!lastTouchAt || lastTouchAt <= disposition.occurredAt)
      ? disposition
      : null;
  const firstChannel = `CHAT_${rooms.find((r) => r.id === inbound[0]?.roomId)?.channel ?? rooms[0]?.channel ?? 'UNKNOWN'}`;
  return buildJourneySummary(
    {
      stage,
      stageEnteredAt: firstPurchaseAt ?? creditAt ?? interestedAt ?? identifiedAt ?? contactedAt,
      path: boughtContracts.length
        ? 'INSTALLMENT'
        : sales[0]?.saleType === 'CASH'
          ? 'CASH'
          : sales.length
            ? 'EXTERNAL_FINANCE'
            : 'UNKNOWN',
      contactedAt,
      identifiedAt,
      interestedAt,
      creditAt,
      firstPurchaseAt,
      firstStaffReplyAt: staff?.outboundSentAt ?? null,
      firstChannel,
      firstSource: firstChannel,
      firstAdCampaignId: null,
      heardFrom: null,
      lastCustomerAt,
      lastTouchAt,
      lostAt: lost?.occurredAt ?? null,
      lostReason: lost?.lostReason ?? null,
      computedAt: now,
    },
    {
      firstAd: null,
      interestedByManualEntry:
        !!interestEntry && interestEntry.occurredAt.getTime() === interestedAt?.getTime(),
      creditRejected: false,
      postSaleBadges: postSaleBadges({
        latestContractStatus: boughtContracts.at(-1)?.status ?? null,
        purchaseCount: sales.length + boughtContracts.length,
        hasRepairTicket: repairs > 0,
        skipTracingLost: false,
      }),
    },
    now,
  );
}
