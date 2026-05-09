// Asset module — REST API client wrappers (Phase 1)

import api from '@/lib/api';
import type {
  Asset,
  AssetCategory,
  AssetStatus,
  AssetSummary,
  AssetTransferRow,
  AuditLogEntry,
  ListResponse,
} from './types';

export interface ListFilters {
  page?: number;
  limit?: number;
  branchId?: string;
  category?: AssetCategory;
  status?: AssetStatus;
  search?: string;
}

export const assetsApi = {
  list: async (filters: ListFilters): Promise<ListResponse> => {
    const params: Record<string, string | number> = {};
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    if (filters.branchId) params.branchId = filters.branchId;
    if (filters.category) params.category = filters.category;
    if (filters.status) params.status = filters.status;
    if (filters.search) params.search = filters.search;
    const { data } = await api.get<ListResponse>('/assets', { params });
    return data;
  },

  getSummary: async (): Promise<AssetSummary> => {
    const { data } = await api.get<AssetSummary>('/assets/summary');
    return data;
  },

  generateCode: async (category?: AssetCategory): Promise<{ assetCode: string }> => {
    const { data } = await api.get<{ assetCode: string }>('/assets/generate-code', {
      params: category ? { category } : {},
    });
    return data;
  },

  getOne: async (id: string): Promise<Asset> => {
    const { data } = await api.get<Asset>(`/assets/${id}`);
    return data;
  },

  getAudit: async (id: string): Promise<AuditLogEntry[]> => {
    const { data } = await api.get<AuditLogEntry[]>(`/assets/${id}/audit`);
    return data;
  },

  create: async (payload: Record<string, unknown>): Promise<Asset> => {
    const { data } = await api.post<Asset>('/assets', payload);
    return data;
  },

  update: async (id: string, payload: Record<string, unknown>): Promise<Asset> => {
    const { data } = await api.patch<Asset>(`/assets/${id}`, payload);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/assets/${id}`);
  },

  post: async (id: string): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/post`);
    return data;
  },

  reverse: async (id: string, reason: string): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/reverse`, { reason });
    return data;
  },

  transfer: async (
    id: string,
    payload: {
      transferDate: string;
      toCustodian?: string;
      toLocation?: string;
      reason: string;
    },
  ): Promise<Asset> => {
    const { data } = await api.post<Asset>(`/assets/${id}/transfer`, payload);
    return data;
  },

  copy: async (id: string): Promise<Asset> => {
    const { data } = await api.post<Asset>(`/assets/${id}/copy`);
    return data;
  },

  dispose: async (
    id: string,
    payload: {
      disposalType: 'SALE' | 'WRITE_OFF';
      disposalDate: string;
      proceeds?: number;
      depositAccountCode?: string;
      reason: string;
    },
  ): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/dispose`, payload);
    return data;
  },

  reverseDispose: async (id: string, reason: string): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/reverse-dispose`, {
      reason,
    });
    return data;
  },

  listAllTransfers: async (filters: {
    page?: number;
    limit?: number;
    search?: string;
    custodianContains?: string;
    locationContains?: string;
    branchId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: AssetTransferRow[]; total: number; page: number; limit: number }> => {
    const params: Record<string, string | number> = {};
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    if (filters.search) params.search = filters.search;
    if (filters.custodianContains) params.custodianContains = filters.custodianContains;
    if (filters.locationContains) params.locationContains = filters.locationContains;
    if (filters.branchId) params.branchId = filters.branchId;
    if (filters.fromDate) params.fromDate = filters.fromDate;
    if (filters.toDate) params.toDate = filters.toDate;
    const { data } = await api.get<{
      data: AssetTransferRow[];
      total: number;
      page: number;
      limit: number;
    }>('/asset-transfers', { params });
    return data;
  },
};
