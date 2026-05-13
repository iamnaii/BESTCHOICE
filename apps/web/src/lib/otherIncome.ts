import api from './api';
import type {
  AuditLogEntry,
  OtherIncome,
  OtherIncomeAttachment,
  ListResponse,
  DailySheet,
  OtherIncomeStatus,
  OtherIncomeReverseReason,
} from './otherIncome.types';
import type { OtherIncomeFormValues } from './otherIncome.schema';

export interface ListQuery {
  status?: OtherIncomeStatus;
  startDate?: string;
  endDate?: string;
  q?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export const otherIncomeApi = {
  list: (q: ListQuery = {}) =>
    api.get<ListResponse>('/other-income', { params: q }).then((r) => r.data),

  findOne: (id: string) =>
    api.get<OtherIncome>(`/other-income/${id}`).then((r) => r.data),

  create: (data: OtherIncomeFormValues) =>
    api.post<OtherIncome>('/other-income', data).then((r) => r.data),

  update: (id: string, data: Partial<OtherIncomeFormValues>) =>
    api.patch<OtherIncome>(`/other-income/${id}`, data).then((r) => r.data),

  softDelete: (id: string) =>
    api.delete(`/other-income/${id}`).then((r) => r.data),

  post: (
    id: string,
    override?: {
      lines: Array<{ accountCode: string; debit: number; credit: number; description?: string }>;
    },
  ) =>
    api
      .post<OtherIncome>(`/other-income/${id}/post`, {
        override: !!override,
        overrideLines: override?.lines,
      })
      .then((r) => r.data),

  reverse: (id: string, reason: OtherIncomeReverseReason, note: string) =>
    api
      .post<OtherIncome>(`/other-income/${id}/reverse`, { reason, note })
      .then((r) => r.data),

  copy: (id: string) =>
    api.post<OtherIncome>(`/other-income/${id}/copy`).then((r) => r.data),

  dailySheet: (date: string) =>
    api
      .get<DailySheet>('/other-income/daily-sheet', { params: { date } })
      .then((r) => r.data),

  getAuditTrail: (id: string) =>
    api.get<AuditLogEntry[]>(`/other-income/${id}/audit`).then((r) => r.data),

  uploadAttachment: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api
      .post<OtherIncomeAttachment>(`/other-income/${id}/attachments`, formData)
      .then((r) => r.data);
  },

  getAttachmentThreshold: () =>
    api
      .get<{ threshold: number }>('/other-income/config/attachment-threshold')
      .then((r) => r.data.threshold),

  isMakerCheckerEnabled: () =>
    api.get<{ enabled: boolean }>('/other-income/maker-checker-enabled').then((r) => r.data.enabled),

  setMakerCheckerEnabled: (enabled: boolean) =>
    api.put('/other-income/maker-checker', { enabled }).then((r) => r.data),

  getPendingReadyCount: () =>
    api.get<{ count: number }>('/other-income/maker-checker/pending-ready-count').then((r) => r.data.count),

  requestApproval: (id: string) =>
    api.post(`/other-income/${id}/request-approval`).then((r) => r.data),

  approve: (id: string, note?: string) =>
    api.post(`/other-income/${id}/approve`, { note }).then((r) => r.data),

  reject: (id: string, note: string) =>
    api.post(`/other-income/${id}/reject`, { note }).then((r) => r.data),

  // Templates (PR-3)
  templates: {
    list: (params?: { q?: string; favoritesOnly?: boolean }) =>
      api.get('/other-income/templates', { params }).then((r) => r.data),
    create: (data: {
      name: string;
      priceType: 'EXCLUSIVE' | 'INCLUSIVE';
      items: Array<{
        accountCode: string;
        description?: string;
        quantity: number | string;
        unitAmount: number | string;
        discountAmount: number | string;
        vatPct: number | string;
        whtPct: number | string;
      }>;
    }) => api.post('/other-income/templates', data).then((r) => r.data),
    saveAsFromDoc: (docId: string, name: string) =>
      api.post(`/other-income/from-doc/${docId}/save-template`, { name }).then((r) => r.data),
    update: (id: string, data: { name?: string; isFavorite?: boolean }) =>
      api.patch(`/other-income/templates/${id}`, data).then((r) => r.data),
    remove: (id: string) =>
      api.delete(`/other-income/templates/${id}`).then((r) => r.data),
    use: (id: string) =>
      api.post(`/other-income/templates/${id}/use`).then((r) => r.data),
  },
};
