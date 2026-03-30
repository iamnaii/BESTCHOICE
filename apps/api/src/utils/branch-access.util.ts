import { ForbiddenException } from '@nestjs/common';

/** Minimal user context for branch-level access control */
export interface BranchAccessUser {
  id: string;
  role: string;
  branchId: string | null;
}

/** Roles that can access data across all branches */
const GLOBAL_ROLES = ['OWNER', 'ACCOUNTANT'];

/**
 * Check whether a user has access to a specific branch.
 * OWNER and ACCOUNTANT can access any branch; others must match.
 *
 * @throws ForbiddenException when the user's branch doesn't match
 */
export function assertBranchAccess(
  user: BranchAccessUser,
  entityBranchId: string | null,
  errorMessage = 'ไม่สามารถเข้าถึงข้อมูลข้ามสาขาได้',
): void {
  if (GLOBAL_ROLES.includes(user.role)) return;
  if (user.branchId && entityBranchId && user.branchId !== entityBranchId) {
    throw new ForbiddenException(errorMessage);
  }
}

/**
 * Determine the effective branchId for list queries.
 * - OWNER/ACCOUNTANT: use the explicitly requested branchId (or undefined for all)
 * - SALES/BRANCH_MANAGER: forced to their own branchId
 */
export function getEffectiveBranchId(
  requestedBranchId: string | undefined,
  user?: { role: string; branchId: string | null },
): string | undefined {
  if (!user) return requestedBranchId;
  if (GLOBAL_ROLES.includes(user.role)) return requestedBranchId;
  return user.branchId || requestedBranchId;
}
