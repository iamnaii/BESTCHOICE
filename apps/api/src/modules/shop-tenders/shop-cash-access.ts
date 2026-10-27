import { ForbiddenException } from '@nestjs/common';
import { procurementPreparation } from '../employee-access/access-preparation-context';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { currentDomainAccess } from '../employee-access/access-execution-context';
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

/** Writes join the actual owned client; the source-filtered read adapter never writes. */
export function cashTransaction<T>(base: PrismaService, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const ctx = currentDomainAccess();
  if (!ctx) return base.$transaction(work);
  const plan = tenderAccess.getStore();
  if (!plan || plan.tx !== ctx.client) throw new Error('Current tender source proof required');
  return work(ctx.client);
}

/** Managed callers cannot fall back to legacy role gates through a direct service call. */
export async function assertCashExecution(base: PrismaService, actorId: string, allowSlipPreparation = false) {
  const ctx = currentDomainAccess();
  if (ctx) {
    if (ctx.snapshot.userId !== actorId || tenderAccess.getStore()?.tx !== ctx.client)
      throw new ForbiddenException('ต้องตรวจสิทธิ์เงินหน้าร้านปัจจุบัน');
    return;
  }
  if (allowSlipPreparation && procurementPreparation.getStore()?.source === 'shop-cash-slip') return;
  const user = await base.user.findUnique({ where: { id: actorId }, select: { accessManaged: true } });
  if (user?.accessManaged) throw new ForbiddenException('ต้องตรวจสิทธิ์เงินหน้าร้านปัจจุบัน');
}
