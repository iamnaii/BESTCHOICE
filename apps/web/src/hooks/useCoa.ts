import { useQuery } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import api from '@/lib/api';

export interface CoaAccountRow {
  code: string;
  name: string;
  normalBalance: string;
  vatApplicable: boolean;
  notes: string | null;
}

export interface CoaGroup {
  category: string;
  accounts: CoaAccountRow[];
}

export interface CoaGroupedResponse {
  groups: CoaGroup[];
}

export interface CoaByCodesRow {
  code: string;
  name: string;
}

export interface CoaGroupedFilter {
  type?: string;
  codePrefix?: string;
  category?: string;
}

export function useCoaGroups(filter: CoaGroupedFilter) {
  return useQuery<CoaGroupedResponse>({
    queryKey: ['coa', 'grouped', filter],
    queryFn: async () => {
      const { data } = await api.get<CoaGroupedResponse>('/chart-of-accounts/grouped', {
        params: filter,
      });
      return data;
    },
    staleTime: Infinity,
  });
}

export function useCoaByCodes(codes: string[]) {
  const sortedKey = [...codes].sort().join(',');
  return useQuery<CoaByCodesRow[]>({
    queryKey: ['coa', 'by-codes', sortedKey],
    queryFn: async () => {
      const { data } = await api.get<CoaByCodesRow[]>('/chart-of-accounts/by-codes', {
        params: { codes: codes.join(',') },
      });
      return data;
    },
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

/**
 * D1.1.6.2 — Resolves the `adj_underpay` / `adj_overpay` roles to their live
 * CoA codes. Used by AdjustmentSection so the picker suggestion stays in sync
 * with the server `account_role_map` instead of hard-coding `52-1104` /
 * `53-1503`.
 */
export interface AdjustmentRoleCodes {
  underpay: string;
  overpay: string;
}

export function useAdjustmentRoleCodes() {
  return useQuery<AdjustmentRoleCodes>({
    queryKey: ['coa', 'adjustment-roles'],
    queryFn: async () => {
      try {
        const { data } = await api.get<AdjustmentRoleCodes>('/chart-of-accounts/adjustment-roles');
        return data;
      } catch (error) {
        // D1.1.6.2 — silent UI fallback to FALLBACK_SUGGESTED would mask a
        // misconfigured account_role_map (R1/R4 PR #900 review). Emit a
        // warning to Sentry so operators see the picker is showing stale
        // defaults instead of the live role-map codes.
        Sentry.captureMessage('adjustment-roles fetch failed', {
          level: 'warning',
          extra: { error: error instanceof Error ? error.message : String(error) },
          tags: { component: 'useAdjustmentRoleCodes' },
        });
        throw error;
      }
    },
    staleTime: Infinity,
  });
}
