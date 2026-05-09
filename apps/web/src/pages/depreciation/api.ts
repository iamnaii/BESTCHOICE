// Depreciation module — REST API client wrappers (Phase 2)

import api from '@/lib/api';
import type { DepreciationRunSummary, DepreciationPreview } from './types';

export const depreciationApi = {
  list: async (): Promise<DepreciationRunSummary[]> => {
    const { data } = await api.get<DepreciationRunSummary[]>('/depreciation');
    return data;
  },
  preview: async (period: string): Promise<DepreciationPreview> => {
    const { data } = await api.get<DepreciationPreview>(`/depreciation/preview/${period}`);
    return data;
  },
  run: async (period: string): Promise<DepreciationRunSummary> => {
    const { data } = await api.post<DepreciationRunSummary>('/depreciation/run', { period });
    return data;
  },
  reverse: async (
    period: string,
    reason: string,
  ): Promise<{ reversedCount: number; entryNumbers: string[] }> => {
    const { data } = await api.post<{ reversedCount: number; entryNumbers: string[] }>(
      `/depreciation/${period}/reverse`,
      { period, reason },
    );
    return data;
  },
};
