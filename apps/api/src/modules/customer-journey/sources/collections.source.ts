import type { JourneyEvent } from '@installment/shared';
import { customerContractEvents } from './contract-timeline';
import { finalizeSource, pickMetadata, type JourneySource } from './journey-window';

const VIEWS: Record<string, { type: string; keys: readonly string[]; actorType: 'STAFF' | 'SYSTEM' }> = {
  CALL: { type: 'COLLECTION_CALL', keys: ['result'], actorType: 'STAFF' },
  DUNNING_ACTION: { type: 'COLLECTION_DUNNING', keys: ['status', 'channel'], actorType: 'SYSTEM' },
  STATUS_CHANGE: { type: 'CONTRACT_STATUS_CHANGE', keys: ['action'], actorType: 'SYSTEM' },
  MDM: { type: 'COLLECTION_MDM', keys: ['action'], actorType: 'STAFF' },
  LETTER: { type: 'COLLECTION_LETTER', keys: ['status', 'letterNumber'], actorType: 'STAFF' },
};

/** PDPA: ไม่คัด subtitle (DUNNING = messageContent) · metadata เฉพาะคีย์ใน VIEWS · ชนิดที่ไม่รู้จักถูกทิ้ง */
export const collectionsSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (actor.role === 'SALES') return [];
  const events: JourneyEvent[] = [];
  for (const { contract, actorUserId, event } of await customerContractEvents(prisma, customerIds, window)) {
    const view = VIEWS[event.type];
    if (!view) continue;
    const isCall = event.type === 'CALL';
    events.push({
      id: event.id, type: view.type, group: 'collections', stage: null, timestamp: event.timestamp,
      title: `${isCall ? `โทรติดตาม: ${event.title}` : event.title} · ${contract.contractNumber}`,
      // subtitle ของ CALL = ชื่อผู้โทร (ไม่ใช่ข้อความ) · id ผู้โทรมาจาก row.actorUserId
      actor: isCall && event.subtitle ? { type: 'STAFF', ...(actorUserId ? { id: actorUserId } : {}), name: event.subtitle } : { type: view.actorType },
      reliability: 'exact', origin: 'SOURCE', href: `/contracts/${contract.id}`, metadata: pickMetadata(event.metadata, view.keys),
    });
  }
  return finalizeSource(events, window);
};
