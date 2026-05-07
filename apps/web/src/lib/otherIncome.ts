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
      .post<OtherIncomeAttachment>(`/other-income/${id}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};
