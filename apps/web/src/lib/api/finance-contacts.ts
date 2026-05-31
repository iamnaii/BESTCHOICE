import api from '@/lib/api';

export interface FinanceCompanyContact {
  id: string;
  name: string;
  position: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  lineId: string | null;
  notes: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export interface FinanceContactLog {
  id: string;
  contactedAt: string;
  channel: 'CALL' | 'EMAIL' | 'LINE' | 'MEETING' | 'OTHER';
  result: 'ANSWERED' | 'NO_ANSWER' | 'PROMISED' | 'DISPUTED' | 'REQUESTED_DOCS' | 'OTHER';
  notes: string | null;
  promisedDate: string | null;
  promisedAmount: string | null;
  promisedBrokenAt: string | null;
  promisedKeptAt: string | null;
  contact: { id: string; name: string; position: string | null; phone: string | null } | null;
  contactedBy: { id: string; name: string };
}

export interface CompanyContactSummary {
  receivableCount: number;
  totalOutstanding: number;
  lastContactedAt: string | null;
  brokenPromiseCount: number;
  keptPromiseCount: number;
}

export const financeContactKeys = {
  all: ['finance-contacts'] as const,
  companyContacts: (companyId: string) =>
    [...financeContactKeys.all, 'company', companyId, 'contacts'] as const,
  receivableLogs: (receivableId: string) =>
    [...financeContactKeys.all, 'receivable', receivableId, 'logs'] as const,
  companySummary: (companyId: string) =>
    [...financeContactKeys.all, 'company', companyId, 'summary'] as const,
  companyLogs: (companyId: string, page: number) =>
    [...financeContactKeys.all, 'company', companyId, 'logs', page] as const,
};

export const financeContactApi = {
  listContacts: (companyId: string) =>
    api.get<FinanceCompanyContact[]>(`/external-finance/companies/${companyId}/contacts`).then((r) => r.data),
  createContact: (companyId: string, payload: Partial<FinanceCompanyContact>) =>
    api.post(`/external-finance/companies/${companyId}/contacts`, payload).then((r) => r.data),
  updateContact: (companyId: string, contactId: string, payload: Partial<FinanceCompanyContact>) =>
    api.patch(`/external-finance/companies/${companyId}/contacts/${contactId}`, payload).then((r) => r.data),
  deleteContact: (companyId: string, contactId: string) =>
    api.delete(`/external-finance/companies/${companyId}/contacts/${contactId}`).then((r) => r.data),
  setPrimary: (companyId: string, contactId: string) =>
    api.post(`/external-finance/companies/${companyId}/contacts/${contactId}/set-primary`).then((r) => r.data),

  listLogs: (receivableId: string) =>
    api.get<FinanceContactLog[]>(`/finance-receivable/${receivableId}/contact-logs`).then((r) => r.data),
  recordLog: (
    receivableId: string,
    payload: {
      financeCompanyContactId?: string;
      result: FinanceContactLog['result'];
      channel?: FinanceContactLog['channel'];
      notes?: string;
      promisedDate?: string;
      promisedAmount?: number;
    },
  ) => api.post(`/finance-receivable/${receivableId}/contact-logs`, payload).then((r) => r.data),

  companySummary: (companyId: string) =>
    api.get<CompanyContactSummary>(`/external-finance/companies/${companyId}/contact-summary`).then((r) => r.data),
  companyLogs: (companyId: string, page = 1, limit = 20) =>
    api
      .get(`/external-finance/companies/${companyId}/contact-logs`, { params: { page, limit } })
      .then((r) => r.data),
};
