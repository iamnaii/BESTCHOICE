import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

/**
 * Branch scope for receipt reads/mutations addressed by receipt id, receipt
 * number or contract id.
 *
 * `BranchGuard` only inspects an explicit `branchId` param/query/body, so a
 * SALES or BRANCH_MANAGER account could fetch `GET /receipts/:id/pdf` (or the
 * receipt detail / contract listing) for any branch as long as it knew the id.
 * Found by the DOC-01 integration scenario (issue #1560). Contract documents
 * already resolve the owning contract before the handler runs
 * (ContractFileAccessGuard); this guard applies the same rule to receipts:
 * cross-branch roles pass, everyone else must own the contract's branch.
 *
 * Runs after JwtAuthGuard (class guard order), before any method guard.
 */
@Injectable()
export class ReceiptAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { role?: string; branchId?: string | null };
      params?: Record<string, string | undefined>;
    }>();
    const user = request.user;
    if (!user?.role) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงใบเสร็จ');
    if (hasCrossBranchAccess(user)) return true;

    const branchId = await this.resolveBranch(request.params ?? {});
    if (branchId === undefined) return true; // no receipt/contract addressed (list, credit-note issue)
    if (!user.branchId) throw new ForbiddenException('บัญชีนี้ยังไม่มีสาขาที่รับผิดชอบ');
    if (branchId !== user.branchId) throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงใบเสร็จของสาขาอื่น');
    return true;
  }

  /** Branch of the addressed resource, or undefined when the route addresses none. */
  private async resolveBranch(params: Record<string, string | undefined>): Promise<string | null | undefined> {
    if (params.contractId) {
      const contract = await this.prisma.contract.findUnique({ where: { id: params.contractId }, select: { branchId: true, deletedAt: true } });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      return contract.branchId;
    }
    const where = params.receiptNumber ? { receiptNumber: params.receiptNumber } : params.id ? { id: params.id } : null;
    if (!where) return undefined;
    const receipt = await this.prisma.receipt.findFirst({ where: { ...where, deletedAt: null }, select: { contract: { select: { branchId: true } } } });
    if (!receipt) throw new NotFoundException('ไม่พบใบเสร็จ');
    return receipt.contract.branchId;
  }
}
