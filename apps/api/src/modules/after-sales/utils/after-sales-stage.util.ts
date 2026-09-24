import type { AfterSalesOutcome, AfterSalesStage, RepairStatus } from '@prisma/client';

export interface StageInput {
  outcome: AfterSalesOutcome | null;
  cancelledAt: Date | null;
  closedAt: Date | null; // ทางออกเปลี่ยนเครื่องปิดด้วยการส่งมอบ (เคสเป็นความจริง) — PR 2
  repairStatus: RepairStatus | null;
  repairDeleted?: boolean;
  replacementContractId?: string | null;
  // PR 2 — จาก ContractExchangeRequest ที่ผูกอยู่ (เฉพาะ outcome PRICED_EXCHANGE)
  exchange?: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
    mode: 'MEMO' | 'PRICED';
    memoAppliedAt: Date | null;
    newContractStatus: string | null; // สถานะสัญญาใหม่ (null = ยังไม่มี)
  } | null;
}

const REPAIR_STAGE: Record<RepairStatus, AfterSalesStage> = {
  OPEN: 'RECEIVED',
  IN_PROGRESS: 'IN_REPAIR',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  CLOSED: 'CLOSED',
  REPLACED: 'CLOSED', // ทับด้วยกิ่ง REPLACED ของ deriveStage เสมอ — ไม่มีทางไปถึง map นี้จริง
  CANCELLED: 'CANCELLED',
};

export const STALE_DAYS: Partial<Record<AfterSalesStage, number>> = {
  IN_REPAIR: 14,
  READY_FOR_PICKUP: 7,
  AWAITING_APPROVAL: 2,
};

/** ทางออกเปลี่ยนเครื่อง (SAME_MODEL_EXCHANGE / CASH_SAME_MODEL_EXCHANGE / REPAIR ที่ถูกเปลี่ยนรุ่นเดิม
 * เพราะซ่อมไม่ได้) ล้วนแขวนอยู่กับ "มีสัญญาใหม่ให้ลูกค้ารับเครื่องหรือยัง" + "ปิดจบด้วยการส่งมอบหรือยัง" —
 * กติกาเดียวกันทั้งสามทาง จึงแยกออกมาเป็นฟังก์ชันเดียว */
const OPEN_EXCHANGE_STAGE = (i: StageInput): AfterSalesStage => {
  if (i.closedAt) return 'CLOSED';
  if (i.replacementContractId) return 'READY_FOR_PICKUP';
  return 'AWAITING_APPROVAL';
};

/** stage คำนวณจากบันทึกของทางออก ไม่รับจาก client (spec ข้อ 5) —
 * PR 2: stage จากสถานะ engine ทั้ง 3 ทางออก (ใบซ่อม, ผลเปลี่ยนรุ่นเดิม, คำขอเปลี่ยนเครื่องมีราคา) */
export function deriveStage(i: StageInput): AfterSalesStage {
  if (i.cancelledAt) return 'CANCELLED';
  if (i.outcome === 'REPAIR') {
    if (i.repairDeleted || !i.repairStatus) return 'CANCELLED';
    // ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม (engine ตั้ง REPLACED + สัญญาใหม่) — รอส่งมอบเหมือน SAME_MODEL_EXCHANGE
    if (i.repairStatus === 'REPLACED') return OPEN_EXCHANGE_STAGE(i);
    return REPAIR_STAGE[i.repairStatus];
  }
  if (i.outcome === 'SAME_MODEL_EXCHANGE' || i.outcome === 'CASH_SAME_MODEL_EXCHANGE') {
    return OPEN_EXCHANGE_STAGE(i);
  }
  if (i.outcome === 'PRICED_EXCHANGE') {
    const x = i.exchange;
    if (!x || x.status === 'PENDING') return 'AWAITING_APPROVAL'; // ยื่นไม่สำเร็จ/รอผูก หรือรออนุมัติ
    if (x.status === 'REJECTED' || x.status === 'CANCELED') return 'CANCELLED';
    // APPROVED
    if (x.mode === 'MEMO') return x.memoAppliedAt ? 'CLOSED' : 'READY_FOR_PICKUP';
    return x.newContractStatus && x.newContractStatus !== 'DRAFT' ? 'CLOSED' : 'READY_FOR_PICKUP';
  }
  return 'RECEIVED';
}

/** วันที่ใช้วัด "ค้างนาน" ของ stage นั้น — READY_FOR_PICKUP ของทางออกเปลี่ยนเครื่อง (ไม่มี repair
 * ticket ให้ repairedAt) นับจากวันที่อนุมัติ/ยืนยันแทน */
export function stageSince(
  stage: AfterSalesStage,
  t: { sentToRepairAt: Date | null; repairedAt: Date | null } | null,
  receivedAt: Date,
  approvedAt: Date | null = null,
): Date {
  if (stage === 'IN_REPAIR' && t?.sentToRepairAt) return t.sentToRepairAt;
  if (stage === 'READY_FOR_PICKUP' && t?.repairedAt) return t.repairedAt;
  if (stage === 'READY_FOR_PICKUP' && !t?.repairedAt && approvedAt) return approvedAt;
  return receivedAt;
}

export const isStale = (stage: AfterSalesStage, since: Date, now = new Date()) => {
  const d = STALE_DAYS[stage];
  return d != null && now.getTime() - since.getTime() > d * 86400000;
};
