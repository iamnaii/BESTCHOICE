/**
 * InternalControlActionBar — backward-compat shim.
 *
 * The reverse-permission guard now lives at `auth/guards/reverse-permission.guard.ts`
 * because three modules share it (Other Income, Expense, Asset). This file
 * keeps existing imports (`./reverse-permission.guard`) working — feel free to
 * migrate import paths to the new location and delete this shim once all
 * callers are updated.
 */
export {
  REVERSE_PERMISSION_ROLE_SETS,
  ReversePermissionGuard,
  resolveReversePermissionMode,
  resolveReversePermissionRoles,
  canUserReverse,
  type ReversePermissionMode,
} from '../auth/guards/reverse-permission.guard';
