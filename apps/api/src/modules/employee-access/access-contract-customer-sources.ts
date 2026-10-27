import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';
import { PartyQueryPlan } from './access-party-query-plan';
import { partyRoomReadWhere } from './access-party-scope';
import { FINANCE_CONTRACT_READ_LIMIT } from './access-party-source.service';

/** FINANCE identity evidence accepted by customerPartyWhere, plus the explicit
 * case/room alternatives in PartyQueryPlan. Identity assignment belongs to the
 * Customer, not its sibling Contract or room. No blanket read grant is added. */
export async function lockContractCustomerSources(plan: PartyQueryPlan, ids: string[]) {
  if (!ids.length) return;
  const db = plan.db;
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM customers WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
  );
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM branches WHERE id IN (SELECT access_branch_id FROM customers WHERE id IN (${Prisma.join(ids)})) ORDER BY id FOR SHARE`,
  );
  const scope = plan.scope('customers.read', 'FINANCE');
  const cases: Prisma.ContractWhereInput[] = [
    { AND: [plan.contract, plan.finance('customers.read')] },
  ];
  const rooms: Prisma.ChatRoomWhereInput[] = [
    { AND: [partyRoomReadWhere(plan.scope('chat.read', 'FINANCE')), partyRoomReadWhere(scope)] },
  ];
  for (const tuple of scope.tuples) {
    if (tuple.userId !== scope.userId || (tuple.scope === 'BRANCHES' && !tuple.branchIds.length))
      continue;
    const identity: Prisma.CustomerWhereInput =
      tuple.scope === 'ASSIGNED'
        ? {
            assignedToId: scope.userId,
            assignedTo: { isActive: true, deletedAt: null, isSystemUser: false },
          }
        : {};
    cases.push({
      deletedAt: null,
      branch: {
        isActive: true,
        deletedAt: null,
        company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
      },
      ...(tuple.scope !== 'COMPANY' && tuple.branchIds.length
        ? { branchId: { in: [...tuple.branchIds] } }
        : {}),
      customer: identity,
    });
    if (tuple.scope === 'COMPANY' || (tuple.scope === 'ASSIGNED' && !tuple.branchIds.length))
      rooms.push({ deletedAt: null, channel: { in: WORK_CHANNELS.FINANCE }, customer: identity });
  }
  const dependencies = await db.contract.findMany({
    where: { customerId: { in: ids }, OR: cases },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: FINANCE_CONTRACT_READ_LIMIT + 1,
  });
  // Complete aggregate candidates have already been registered on this attempt's
  // plan, so preview-only labels cannot reset the distinct contributor budget.
  await plan.lockContractContributors(dependencies.map((row) => row.id));
  const roomRows = await db.chatRoom.findMany({
    where: { customerId: { in: ids }, OR: rooms },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: FINANCE_CONTRACT_READ_LIMIT + 1,
  });
  if (roomRows.length > FINANCE_CONTRACT_READ_LIMIT)
    throw new BadRequestException('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
  if (roomRows.length)
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM chat_rooms WHERE id IN (${Prisma.join(roomRows.map((row) => row.id))}) ORDER BY id FOR SHARE`,
    );
  // The execution holds both live company rows and the current actor User row;
  // the Customer lock above protects its origin and identity-assignment fields.
}
