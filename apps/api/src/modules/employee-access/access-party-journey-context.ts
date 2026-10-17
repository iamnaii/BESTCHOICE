import { AsyncLocalStorage } from 'node:async_hooks';
import type { PartyJourneyPlan } from './access-party-journey-plan';
import { isCurrentDomainClient } from './access-execution-context';
import { ForbiddenException } from '@nestjs/common';
export const journeyAccess = new AsyncLocalStorage<PartyJourneyPlan>();
export function currentJourney(client?: object) {
  const plan = journeyAccess.getStore();
  if (plan && client && !isCurrentDomainClient(client))
    throw new ForbiddenException('ไม่มีสิทธิ์อ่านข้อมูลนี้');
  return plan;
}
/** Fixed, typed source selectors. Never wrap Prisma or accept request predicates. */
export function journeyIds(key: keyof PartyJourneyPlan['ids']) {
  const plan = currentJourney();
  return plan ? { id: { in: [...plan.ids[key]] } } : {};
}
