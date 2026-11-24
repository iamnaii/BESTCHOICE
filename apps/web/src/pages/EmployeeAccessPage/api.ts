import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AccessScope,
  AccessSnapshot,
  Company,
  DefaultAccessPosition,
  EmployeeAccessContext,
  EmployeeAccessHistoryAssignment,
  EmployeeAccessHistoryPage,
  PermissionDefinition,
  PermissionKey,
} from '@installment/shared';
import api from '@/lib/api';

export type Assignment = EmployeeAccessHistoryAssignment;

export interface AccessPosition {
  id: string;
  code: string;
  name: string;
  permissions: PermissionKey[];
  isActive: boolean;
  revision: number;
  affectedEmployeeCount: number;
}

interface StaffAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  accessManaged: boolean;
  accessRevision: number;
  accessibleCompanies: string[];
  primaryCompany: string | null;
  canReverseOverride: boolean | null;
}

export interface AccessEmployee extends StaffAccount {
  accessAssignments: {
    id: string;
    positionId: string;
    companyCode: Company;
    scope: AccessScope;
    branches: { branchId: string }[];
    position: Omit<AccessPosition, 'affectedEmployeeCount'> & { deletedAt?: string | null };
  }[];
}

export interface MigrationPreview extends StaffAccount {
  managed: boolean;
  isOwner: boolean;
  proposedPositionCode: string | null;
  proposedCompanies: Company[];
  proposedBranchIds: string[];
  proposedScope: AccessScope | null;
  personalGrants: Record<string, unknown>;
  warnings: string[];
  requiresReview: boolean;
  reservedRightsRemoved: PermissionKey[];
}

interface AccessCatalog {
  permissions: readonly PermissionDefinition[];
  templates: readonly DefaultAccessPosition[];
  scopes: AccessScope[];
  companies: Company[];
}

export interface PositionInput {
  code: string;
  name: string;
  permissions: PermissionKey[];
}

type PositionUpdate = Partial<Omit<PositionInput, 'code'>> & {
  isActive?: boolean;
  expectedRevision: number;
};

const prefix = ['employee-access'];
const endpoint = '/employee-access';

function read<T>(name: string) {
  return queryOptions({
    queryKey: [...prefix, name],
    queryFn: async () => (await api.get<T>(`${endpoint}/${name}`)).data,
  });
}

export const accessQueries = {
  catalog: read<AccessCatalog>('catalog'),
  context: read<EmployeeAccessContext>('context'),
  positions: read<AccessPosition[]>('positions'),
  employees: read<AccessEmployee[]>('employees'),
  migration: read<MigrationPreview[]>('migration-preview'),
  snapshot: (id: string) =>
    queryOptions({
      queryKey: [...prefix, 'effective-access', id],
      queryFn: async () =>
        (await api.get<AccessSnapshot>(`${endpoint}/employees/${id}/effective-access`)).data,
    }),
  history: (page: number) =>
    queryOptions({
      queryKey: [...prefix, 'history', page],
      queryFn: async () =>
        (
          await api.get<EmployeeAccessHistoryPage>(`${endpoint}/history`, {
            params: { page, limit: 20 },
          })
        ).data,
    }),
};

export const accessWrites = {
  createPosition: async (input: PositionInput) =>
    (await api.post<AccessPosition>(`${endpoint}/positions`, input)).data,
  updatePosition: async ({ id, input }: { id: string; input: PositionUpdate }) =>
    (await api.patch<AccessPosition>(`${endpoint}/positions/${id}`, input)).data,
  seedTemplates: async () =>
    (await api.post<{ createdCount: number }>(`${endpoint}/positions/seed-templates`)).data,
  replaceAssignments: async ({
    id,
    expectedRevision,
    assignments,
  }: {
    id: string;
    expectedRevision: number;
    assignments: Assignment[];
  }) =>
    (
      await api.put<AccessSnapshot>(`${endpoint}/employees/${id}/assignments`, {
        expectedRevision,
        assignments,
      })
    ).data,
};

export function useAccessWrite<T, V>(mutationFn: (input: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: prefix }),
  });
}

export function isAccessConflict(error: unknown) {
  return (error as { response?: { status?: number } } | undefined)?.response?.status === 409;
}
