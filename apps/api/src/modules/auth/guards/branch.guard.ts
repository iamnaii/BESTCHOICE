import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class BranchGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Guard must be used after JwtAuthGuard
    if (!user) return false;

    // OWNER and ACCOUNTANT can access all branches
    if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') {
      return true;
    }

    // Check if the request is trying to access a specific branch
    const branchId = request.params.branchId || request.query.branchId || request.body?.branchId;

    // If no branchId specified, let the service handle filtering
    if (!branchId) {
      return true;
    }

    // SALES and BRANCH_MANAGER can only access their own branch
    return user.branchId === branchId;
  }
}
