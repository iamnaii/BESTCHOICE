import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { hasCrossBranchAccess } from '../branch-access.util';

/**
 * Enforces branch-level access control.
 *
 * Rules:
 *  - OWNER, FINANCE_MANAGER, ACCOUNTANT → always allowed (cross-branch reporting).
 *  - BRANCH_MANAGER, SALES → only allowed for their own branch.
 *
 * The guard only kicks in when the request explicitly carries a branchId
 * (path param, query string, or body property). If the client doesn't
 * specify one, the service layer is expected to scope by `user.branchId`
 * — this guard is the second line of defence against a malicious client
 * that tries to pass another branch's id.
 *
 * Must be applied AFTER JwtAuthGuard so `request.user` is populated.
 */
@Injectable()
export class BranchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Must be used after JwtAuthGuard
    if (!user) {
      throw new ForbiddenException('ไม่พบข้อมูลผู้ใช้');
    }

    // Cross-branch roles see everything
    if (hasCrossBranchAccess(user)) {
      return true;
    }

    // Pull branchId from the most common carriers
    const requestedBranchId: string | undefined =
      request.params?.branchId ??
      request.query?.branchId ??
      request.body?.branchId;

    // No explicit branchId → service layer handles scoping
    if (!requestedBranchId) {
      return true;
    }

    // Branch-scoped roles can only touch their own branch
    if (!user.branchId) {
      throw new ForbiddenException('บัญชีนี้ยังไม่มีสาขาที่รับผิดชอบ');
    }
    if (user.branchId !== requestedBranchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงข้อมูลของสาขาอื่นได้');
    }
    return true;
  }
}
