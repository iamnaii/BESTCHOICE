import type { JourneyEvent } from '@installment/shared';
import { finalizeSource, staffActor, type JourneySource } from './journey-window';

/** ชุดเดียวกับ apps/web/src/pages/insurance/components/RepairStatusBadge.tsx:11-18 */
const REPAIR_STATUS_LABELS: Record<string, string> = { OPEN: 'รับเข้า', IN_PROGRESS: 'กำลังซ่อม', READY_FOR_PICKUP: 'รอลูกค้ารับ', CLOSED: 'คืนแล้ว', REPLACED: 'เปลี่ยนแล้ว', CANCELLED: 'ยกเลิก' };

/** ไม่คัด defectDescription / notes / IMEI / serial */
export const serviceSource: JourneySource = async (prisma, customerIds, window) => {
  const who = { select: { id: true, name: true } };
  const tickets = await prisma.repairTicket.findMany({
    where: { customerId: { in: customerIds }, deletedAt: null },
    select: { id: true, ticketNumber: true, deviceBrand: true, deviceModel: true, createdAt: true, createdBy: who, statusLogs: { select: { id: true, toStatus: true, createdAt: true, changedBy: who } } },
  });
  const events: JourneyEvent[] = [];
  for (const t of tickets) {
    const device = [t.deviceBrand, t.deviceModel].filter(Boolean).join(' ');
    const common = { group: 'service', stage: null, reliability: 'exact', origin: 'SOURCE', href: `/insurance/${t.id}` } as const;
    events.push({ ...common, id: `repair-${t.id}`, type: 'REPAIR_TICKET', timestamp: t.createdAt.toISOString(), title: `เปิดใบซ่อม/เคลม ${t.ticketNumber}${device ? ` · ${device}` : ''}`, actor: staffActor(t.createdBy) });
    for (const log of t.statusLogs) events.push({ ...common, id: `repairlog-${log.id}`, type: 'REPAIR_STATUS', timestamp: log.createdAt.toISOString(), title: `ใบซ่อม ${t.ticketNumber}: ${REPAIR_STATUS_LABELS[log.toStatus] ?? log.toStatus}`, actor: staffActor(log.changedBy) });
  }
  return finalizeSource(events, window);
};
