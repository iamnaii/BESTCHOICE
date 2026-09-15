import type { PrismaService } from '../../../prisma/prisma.service';
import { contractEventSources, type TimelineEvent } from '../../overdue/contract-event-sources';
import { scanTake, type JourneyWindow } from './journey-window';

export interface CustomerContractEvent {
  contract: { id: string; contractNumber: string };
  /** ผู้โทร / ผู้บันทึกรับชำระ / ผู้ส่งหนังสือ — null เมื่อระบบทำเอง */
  actorUserId: string | null;
  /** รูปเดียวกับหน้า Collections — 🚨 ห้ามส่ง subtitle/metadata ดิบต่อ (มี callLog.notes / messageContent) */
  event: TimelineEvent;
}

/**
 * event ของทุกสัญญาที่ไม่ใช่ร่างของลูกค้าชุดนี้ — เรียก contractEventSources ครั้งเดียวด้วย contractIds ทั้งหมด + window
 * (cursor/from/to ลงไปถึง SQL และ limit = scanTake ต่อตารางต้นทาง) หน้าหลัง ๆ จึงไม่หยุดที่ 50 แถวต่อสัญญา และไม่มี N+1
 * แถวคืนมาไม่ได้เรียงข้ามตาราง — finalizeSource ของผู้เรียกเรียงเอง
 */
export async function customerContractEvents(prisma: PrismaService, customerIds: string[], window: JourneyWindow): Promise<CustomerContractEvent[]> {
  const contracts = await prisma.contract.findMany({ where: { customerId: { in: customerIds }, deletedAt: null, status: { not: 'DRAFT' } }, select: { id: true, contractNumber: true } });
  if (!contracts.length) return [];
  const byId = new Map(contracts.map((contract) => [contract.id, contract] as const));
  const rows = await contractEventSources(prisma, contracts.map((contract) => contract.id), {
    before: window.before,
    from: window.from,
    to: window.to,
    limit: scanTake(window),
  });
  return rows.flatMap((row) => {
    const contract = byId.get(row.contractId);
    return contract ? [{ contract, actorUserId: row.actorUserId, event: row.event }] : [];
  });
}
