import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Role union mirrors the Prisma `UserRole` enum.
 *
 * VIEWER is a read-only auditor role (CPA / สรรพากร). Owner Response Q4
 * (signed 2026-05-17) scoped its access to GET endpoints on
 * `/accounting/*`, `/audit-logs`, `/reports/*`. The role is gated at
 * runtime via SystemConfig `viewer_role_enabled`:
 *
 *   - 'true'  → VIEWER passes routes that include 'VIEWER' in @Roles()
 *   - 'false' → RolesGuard denies VIEWER everywhere (default; safe to
 *               leave the schema enum even if the role is unused)
 *
 * To grant a new endpoint to VIEWER: add `'VIEWER'` to its @Roles()
 * decorator. The activation gate happens in `RolesGuard` — no extra
 * decorator needed.
 */
type UserRole =
  | 'OWNER'
  | 'BRANCH_MANAGER'
  | 'FINANCE_MANAGER'
  | 'SALES'
  | 'ACCOUNTANT'
  | 'VIEWER';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
