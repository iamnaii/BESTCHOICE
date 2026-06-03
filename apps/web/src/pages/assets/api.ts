// Asset module — REST API client wrappers (Phase 1)

import api from '@/lib/api';
import type {
  Asset,
  AssetCategory,
  AssetJournalRow,
  AssetRegisterResponse,
  AssetScheduleResponse,
  AssetStatus,
  AssetSummary,
  AssetTransferRow,
  AuditLogEntry,
  GlobalAuditListResponse,
  ListResponse,
  SummaryRow,
  SupplierLite,
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

  getGlobalAudit: async (filters?: {
    page?: number;
    limit?: number;
    action?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<GlobalAuditListResponse> => {
    const params: Record<string, string | number> = {};
    if (filters?.page) params.page = filters.page;
    if (filters?.limit) params.limit = filters.limit;
    if (filters?.action) params.action = filters.action;
    if (filters?.fromDate) params.fromDate = filters.fromDate;
    if (filters?.toDate) params.toDate = filters.toDate;
    const { data } = await api.get<GlobalAuditListResponse>('/assets/audit', { params });
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

  reverse: async (
    id: string,
    reason: string,
    extra?: { reasonLabel?: string; note?: string },
  ): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/reverse`, {
      reason,
      reasonLabel: extra?.reasonLabel,
      note: extra?.note,
    });
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

  reverseDispose: async (
    id: string,
    reason: string,
    extra?: { reasonLabel?: string; note?: string },
  ): Promise<{ entryNo: string }> => {
    const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/reverse-dispose`, {
      reason,
      reasonLabel: extra?.reasonLabel,
      note: extra?.note,
    });
    return data;
  },

  markInvoiceReceived: async (
    id: string,
  ): Promise<{ entryNo: string; invoiceReceivedAt: string }> => {
    const { data } = await api.post<{ entryNo: string; invoiceReceivedAt: string }>(
      `/assets/${id}/invoice-received`,
    );
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

  getRegister: async (filters: {
    asOfDate?: string;
    category?: AssetCategory;
    status?: AssetStatus;
    branchId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<AssetRegisterResponse> => {
    const params: Record<string, string | number> = {};
    if (filters.asOfDate) params.asOfDate = filters.asOfDate;
    if (filters.category) params.category = filters.category;
    if (filters.status) params.status = filters.status;
    if (filters.branchId) params.branchId = filters.branchId;
    if (filters.search) params.search = filters.search;
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    const { data } = await api.get<AssetRegisterResponse>('/assets/register', { params });
    return data;
  },

  getSchedule: async (id: string): Promise<AssetScheduleResponse> => {
    const { data } = await api.get<AssetScheduleResponse>(`/assets/${id}/schedule`);
    return data;
  },

  listJournal: async (filters: {
    page?: number;
    limit?: number;
    search?: string;
    flowType?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: AssetJournalRow[]; total: number; page: number; limit: number }> => {
    const params: Record<string, string | number> = {};
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    if (filters.search) params.search = filters.search;
    if (filters.flowType) params.flowType = filters.flowType;
    if (filters.fromDate) params.fromDate = filters.fromDate;
    if (filters.toDate) params.toDate = filters.toDate;
    const { data } = await api.get<{
      data: AssetJournalRow[];
      total: number;
      page: number;
      limit: number;
    }>('/assets/journal', { params });
    return data;
  },

  summaryReport: async (filters: {
    groupBy: 'category' | 'custodian' | 'location';
    asOfDate?: string;
    status?: AssetStatus;
    branchId?: string;
  }): Promise<SummaryRow[]> => {
    const params: Record<string, string> = { groupBy: filters.groupBy };
    if (filters.asOfDate) params.asOfDate = filters.asOfDate;
    if (filters.status) params.status = filters.status;
    if (filters.branchId) params.branchId = filters.branchId;
    const { data } = await api.get<SummaryRow[]>('/reports/asset-summary', { params });
    return data;
  },

  // P6 — Supplier master endpoints reused for vendor combobox + inline create.
  // The /suppliers controller returns either an array (when ?limit large) or a
  // paginated envelope ({ data, total, page, limit }); we accept both shapes.
  suppliersList: async (): Promise<SupplierLite[]> => {
    const { data } = await api.get<
      SupplierLite[] | { data: SupplierLite[]; total: number; page: number; limit: number }
    >('/suppliers', { params: { limit: 500 } });
    if (Array.isArray(data)) return data;
    return data?.data ?? [];
  },

  // Vendor master = สมุดผู้ติดต่อ (Contact) rows with the SUPPLIER role — the
  // canonical party book the owner maintains. The asset vendor combobox lists
  // these (NOT the separate legacy Supplier table) so a contact added in
  // สมุดผู้ติดต่อ shows up immediately.
  vendorContacts: async (): Promise<SupplierLite[]> => {
    const { data } = await api.get<{
      data: Array<{ id: string; name: string; taxId: string | null }>;
    }>('/contacts', { params: { role: 'SUPPLIER', limit: 200 } });
    const rows = data?.data ?? [];
    return rows.map((c) => ({ id: c.id, name: c.name, taxId: c.taxId }));
  },

  // Distinct free-text vendor names previously used on assets — "เคยใช้"
  // suggestions so a one-off name can be reused without registering a Supplier.
  vendorNames: async (): Promise<string[]> => {
    const { data } = await api.get<string[]>('/assets/vendor-names');
    return Array.isArray(data) ? data : [];
  },

  // POST /suppliers requires `phone` (NOT NULL in schema). Dialog form must
  // collect phone before submitting; taxId remains optional.
  suppliersCreate: async (input: {
    name: string;
    phone: string;
    taxId?: string;
  }): Promise<SupplierLite> => {
    const { data } = await api.post<SupplierLite>('/suppliers', input);
    return data;
  },
};
