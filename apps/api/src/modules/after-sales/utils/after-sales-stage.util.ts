import type { AfterSalesOutcome, AfterSalesStage, RepairStatus } from '@prisma/client';

export interface StageInput {
  outcome: AfterSalesOutcome | null;
  cancelledAt: Date | null;
  repairStatus: RepairStatus | null;
  repairDeleted?: boolean;
  // R7 (controller ruling): backfill ของ Task 1 map ใบซ่อม REPLACED → outcome
  // SAME_MODEL_EXCHANGE + replacementContractId ที่ตั้งไว้ — PR 2 จะเพิ่มกิ่ง
  // ยืนยัน/อนุมัติของ SAME_MODEL_EXCHANGE ที่ละเอียดกว่านี้แทนที่ branch นี้
  replacementContractId?: string | null;
}

const REPAIR_STAGE: Record<RepairStatus, AfterSalesStage> = {
  OPEN: 'RECEIVED',
  IN_PROGRESS: 'IN_REPAIR',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  CLOSED: 'CLOSED',
  REPLACED: 'CLOSED',
  CANCELLED: 'CANCELLED',
};

export const STALE_DAYS: Partial<Record<AfterSalesStage, number>> = {
  IN_REPAIR: 14,
  READY_FOR_PICKUP: 7,
  AWAITING_APPROVAL: 2,
};

/** stage คำนวณจากบันทึกของทางออก ไม่รับจาก client (spec ข้อ 5) — PR 2 เพิ่มกิ่ง SAME_MODEL/PRICED */
export function deriveStage(i: StageInput): AfterSalesStage {
  if (i.cancelledAt) return 'CANCELLED';
  if (i.outcome === 'REPAIR') {
    if (i.repairDeleted || !i.repairStatus) return 'CANCELLED';
    return REPAIR_STAGE[i.repairStatus];
  }
  if (i.outcome === 'SAME_MODEL_EXCHANGE') {
    return i.replacementContractId ? 'CLOSED' : 'AWAITING_APPROVAL';
  }
  return 'RECEIVED';
}

/** วันที่ใช้วัด "ค้างนาน" ของ stage นั้น */
export function stageSince(
  stage: AfterSalesStage,
  t: { sentToRepairAt: Date | null; repairedAt: Date | null } | null,
  receivedAt: Date,
): Date {
  if (stage === 'IN_REPAIR' && t?.sentToRepairAt) return t.sentToRepairAt;
  if (stage === 'READY_FOR_PICKUP' && t?.repairedAt) return t.repairedAt;
  return receivedAt;
}

export const isStale = (stage: AfterSalesStage, since: Date, now = new Date()) => {
  const d = STALE_DAYS[stage];
  return d != null && now.getTime() - since.getTime() > d * 86400000;
};
