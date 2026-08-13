import api from '@/lib/api';
import type {
  DividendRegisterRow,
  EquityDocument,
  EquityFormValues,
  JournalPreview,
  Shareholder,
} from './equity.types';

export const equityApi = {
  list: (params: { txnType?: string; status?: string; page?: number; limit?: number } = {}) =>
    api
      .get<{
        data: EquityDocument[];
        total: number;
        page: number;
        limit: number;
      }>('/equity/documents', { params })
      .then((r) => r.data),
  findOne: (id: string) => api.get<EquityDocument>(`/equity/documents/${id}`).then((r) => r.data),
  create: (data: EquityFormValues) =>
    api.post<EquityDocument>('/equity/documents', data).then((r) => r.data),
  update: (id: string, data: Partial<EquityFormValues>) =>
    api.patch<EquityDocument>(`/equity/documents/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/equity/documents/${id}`).then((r) => r.data),
  submit: (id: string) =>
    api.post<EquityDocument>(`/equity/documents/${id}/submit`).then((r) => r.data),
  withdraw: (id: string) =>
    api.post<EquityDocument>(`/equity/documents/${id}/withdraw`).then((r) => r.data),
  post: (id: string) =>
    api.post<EquityDocument>(`/equity/documents/${id}/post`).then((r) => r.data),
  reverse: (id: string, reason: string) =>
    api.post<EquityDocument>(`/equity/documents/${id}/reverse`, { reason }).then((r) => r.data),
  preview: (data: EquityFormValues) =>
    api.post<JournalPreview>('/equity/journal-preview', data).then((r) => r.data),
  makerCheckerEnabled: () =>
    api.get<{ enabled: boolean }>('/equity/maker-checker-enabled').then((r) => r.data),
  uploadAttachment: (docId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/equity/documents/${docId}/attachments`, fd).then((r) => r.data);
  },
  attachmentUrl: (attId: string) =>
    api.get<{ url: string }>(`/equity/attachments/${attId}/signed-url`).then((r) => r.data),
  removeAttachment: (docId: string, attId: string) =>
    api.delete(`/equity/documents/${docId}/attachments/${attId}`).then((r) => r.data),
  shareholders: () => api.get<Shareholder[]>('/equity/shareholders').then((r) => r.data),
  createShareholder: (data: Partial<Shareholder>) =>
    api.post<Shareholder>('/equity/shareholders', data).then((r) => r.data),
  updateShareholder: (id: string, data: Partial<Shareholder>) =>
    api.patch<Shareholder>(`/equity/shareholders/${id}`, data).then((r) => r.data),
  dividendRegister: (year: number) =>
    api
      .get<{
        year: number;
        rows: DividendRegisterRow[];
        totals: { gross: string; wht: string; net: string };
      }>('/equity/dividend-register', { params: { year } })
      .then((r) => r.data),
};

export const TXN_TYPE_LABELS: Record<string, string> = {
  CAP_INIT: 'เริ่มลงทุนตั้งบริษัท',
  CAP_INC: 'เพิ่มทุน',
  CAP_DEC: 'ลดทุน',
  DRAW: 'กรรมการถอนเงิน',
  DIV_DEC: 'ประกาศจ่ายปันผล',
  DIV_PAY: 'จ่ายปันผล (หัก WHT)',
  PRIOR_ADJ: 'ปรับปรุงงบย้อนหลัง',
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ร่าง',
  READY: 'รออนุมัติ',
  POSTED: 'ลงบัญชีแล้ว',
  REVERSED: 'กลับรายการ',
};

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  READY: 'bg-warning/10 text-warning',
  POSTED: 'bg-success/10 text-success',
  REVERSED: 'bg-destructive/10 text-destructive',
};
