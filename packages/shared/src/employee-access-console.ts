import type { Company } from './company-access';
import type { AccessScope, PermissionKey } from './employee-access';

export interface EmployeeAccessBranchOption {
  id: string;
  name: string;
  companyCode: Company;
}

export interface EmployeeAccessContext {
  companies: Company[];
  branches: EmployeeAccessBranchOption[];
}

export interface EmployeeAccessHistoryPosition {
  id?: string;
  code?: string;
  name?: string;
  permissions?: PermissionKey[];
  isActive?: boolean;
  revision?: number;
}

export interface EmployeeAccessHistoryAssignment {
  positionId: string;
  company: Company;
  scope: AccessScope;
  branchIds: string[];
}

export interface EmployeeAccessHistoryAssignments {
  managed?: boolean;
  revision?: number;
  assignments: EmployeeAccessHistoryAssignment[];
}

interface EmployeeAccessHistoryHeader {
  id: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  entityId: string;
}

export type EmployeeAccessHistoryItem = EmployeeAccessHistoryHeader &
  (
    | {
        action: 'ACCESS_POSITION_CREATED' | 'ACCESS_POSITION_UPDATED';
        entity: 'access_position';
        before: EmployeeAccessHistoryPosition | null;
        after: EmployeeAccessHistoryPosition | null;
      }
    | {
        action: 'ACCESS_TEMPLATES_CREATED';
        entity: 'access_position';
        before: null;
        after: EmployeeAccessHistoryPosition[];
      }
    | {
        action: 'ACCESS_ASSIGNMENTS_REPLACED';
        entity: 'user';
        before: EmployeeAccessHistoryAssignments | null;
        after: EmployeeAccessHistoryAssignments | null;
      }
  );

export interface EmployeeAccessHistoryPage {
  items: EmployeeAccessHistoryItem[];
  total: number;
  page: number;
  limit: number;
}
