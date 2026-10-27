import { canAccess } from '@installment/shared';
import { currentDomainAccess } from '../../employee-access/access-execution-context';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';

export type SaleProductActor = { role: string; branchId?: string | null };
export type SaleProductState = {
  status: string; deletedAt: Date | null; branchId: string | null; wasPreviouslyDamaged: boolean;
};

export function assertSaleProductEligible(
  product: SaleProductState,
  branchId: string,
  actor: SaleProductActor,
  previouslyDamagedAcknowledged = false,
): void {
  if (product.deletedAt || product.status !== 'IN_STOCK') {
    throw new BadRequestException('สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว — กรุณาตรวจสอบสต็อก');
  }
  if (!currentDomainAccess() && !hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== branchId)) {
    throw new ForbiddenException('ไม่มีสิทธิ์ขายสินค้าของสาขานี้');
  }
  if (product.branchId !== branchId) {
    throw new ForbiddenException('สินค้าต้องอยู่สาขาเดียวกับใบขาย — กรุณาตรวจสอบสาขาของเครื่อง');
  }
  if (product.wasPreviouslyDamaged) {
    if (!previouslyDamagedAcknowledged) {
      throw new BadRequestException('สินค้านี้เคยมีสถานะ DAMAGED/LOST/WRITTEN_OFF — ต้องยืนยัน previouslyDamagedAcknowledged=true ว่าแจ้งลูกค้าแล้ว');
    }
    const ctx = currentDomainAccess();
    const preparation = ctx && ['contracts.create', 'contracts.update'].includes(ctx.scope.permission);
    const allowed = preparation ? canAccess(ctx.snapshot, 'products.sell-previously-damaged', { company: 'SHOP', branchId })
      : ['OWNER', 'FINANCE_MANAGER'].includes(actor.role);
    if (!allowed) {
      throw new ForbiddenException(preparation ? 'ไม่มีสิทธิ์ขายสินค้าที่เคยเสียหายในสาขานี้' : 'ขายสินค้าที่เคย DAMAGED ต้องทำโดย OWNER / FINANCE_MANAGER เท่านั้น');
    }
  }
}
