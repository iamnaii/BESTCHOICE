import { tenderAccess } from '../employee-access/access-tender-source';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

export interface CashCloseActor {
  id: string;
  role: string;
  branchId?: string | null;
}

/** ผู้นับ = พนักงานขาย/ผจก.สาขาของสาขานั้น · ผู้ยืนยัน = เจ้าของ/ผจก.การเงิน/ผจก.สาขา (คำตัดสินเจ้าของ 2026-09-20) */
export const COUNTER_ROLES = ['SALES', 'BRANCH_MANAGER'];
export const CONFIRMER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];

/** ดูข้อมูลปิดยอดของสาขา: ข้ามสาขาได้ = เจ้าของ/ผจก.การเงิน/บัญชี · ที่เหลือเฉพาะสาขาตัวเอง (ไม่มีสาขาติดตัว = ไม่ได้) */
export const canViewBranch = (actor: CashCloseActor, branchId: string) =>
  tenderAccess.getStore() ? tenderAccess.getStore()!.allows('shop-tenders.read', branchId) : hasCrossBranchAccess(actor) || (!!actor.branchId && actor.branchId === branchId);

export const canCountBranch = (actor: CashCloseActor, branchId: string) =>
  tenderAccess.getStore() ? tenderAccess.getStore()!.complete(branchId) && tenderAccess.getStore()!.allows('shop-tenders.count', branchId) : COUNTER_ROLES.includes(actor.role) && !!actor.branchId && actor.branchId === branchId;

export function canConfirmBranch(actor: CashCloseActor, branchId: string) {
  const plan = tenderAccess.getStore();
  if (plan) return plan.moneyVisible(branchId) && plan.allows('shop-tenders.confirm', branchId);
  if (!CONFIRMER_ROLES.includes(actor.role)) return false;
  if (actor.role === 'BRANCH_MANAGER') return !!actor.branchId && actor.branchId === branchId;
  return true;
}
