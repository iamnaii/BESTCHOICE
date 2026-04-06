import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

type UserRole = 'OWNER' | 'BRANCH_MANAGER' | 'FINANCE_MANAGER' | 'SALES' | 'ACCOUNTANT';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
