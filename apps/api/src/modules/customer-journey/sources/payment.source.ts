import type { JourneyEvent } from '@installment/shared';
import { customerContractEvents } from './contract-timeline';
import { finalizeSource, pickMetadata, type JourneySource } from './journey-window';

/** SALES ไม่เห็น (รอเจ้าของเคาะ ข้อ 5) · เวลาอิง payments.updated_at จนกว่า PR paidDate */
export const paymentSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (actor.role === 'SALES') return [];
  const events: JourneyEvent[] = [];
  for (const { contract, actorUserId, event } of await customerContractEvents(prisma, customerIds, window)) {
    if (event.type !== 'PAYMENT') continue;
    events.push({
      id: event.id, type: 'PAYMENT_RECEIVED', group: 'payment', stage: null, timestamp: event.timestamp, title: `${event.title} · ${contract.contractNumber}`,
      actor: actorUserId ? { type: 'STAFF', id: actorUserId } : null, reliability: 'approximate', origin: 'SOURCE', href: `/contracts/${contract.id}`,
      metadata: pickMetadata(event.metadata, ['amount', 'method']),
    });
  }
  return finalizeSource(events, window);
};
