import api from '@/lib/api';

export type ContactRole = 'CUSTOMER' | 'SUPPLIER' | 'TRADE_IN_SELLER' | 'FINANCE_COMPANY';

export interface Contact {
  id: string;
  contactCode: string;
  peakContactCode: string | null;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  lineId: string | null;
  roles: ContactRole[];
  isActive: boolean;
}

export interface ContactCustomerLink {
  id: string;
  name: string;
  prefix: string | null;
  phone: string | null;
}
export interface ContactSupplierLink {
  id: string;
  name: string;
  type: 'JURISTIC' | 'INDIVIDUAL';
  taxId: string | null;
  branchCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  phone: string | null;
  hasVat: boolean;
  address: string | null;
}
export interface ContactFinanceLink {
  id: string;
  name: string;
  taxId: string | null;
  contactPhone: string | null;
  email: string | null;
  creditTermDays: number | null;
}
export interface ContactTradeInLink {
  id: string;
  sellerName: string | null;
  sellerPhone: string | null;
  createdAt: string;
}
export interface ContactDetail extends Contact {
  customers: ContactCustomerLink[];
  suppliers: ContactSupplierLink[];
  tradeInsAsSeller: ContactTradeInLink[];
  externalFinanceCompany: ContactFinanceLink[];
}

export interface ContactListResult {
  data: Contact[];
  total: number;
  page: number;
  limit: number;
}

export interface EnsureRoleResult {
  contactId: string;
  role: ContactRole;
  supplierId?: string;
  customerId?: string;
  provisioned: boolean;
}

export const contactKeys = {
  all: ['contacts'] as const,
  list: (params: Record<string, unknown>) => [...contactKeys.all, 'list', params] as const,
  detail: (id: string) => [...contactKeys.all, 'detail', id] as const,
};

export const contactsApi = {
  list: (params: {
    search?: string;
    role?: ContactRole | 'ALL';
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const query: Record<string, unknown> = { page: params.page ?? 1, limit: params.limit ?? 50 };
    if (params.search) query.search = params.search;
    if (params.role && params.role !== 'ALL') query.role = params.role;
    if (params.isActive !== undefined) query.isActive = String(params.isActive);
    return api.get<ContactListResult>('/contacts', { params: query }).then((r) => r.data);
  },
  detail: (id: string) => api.get<ContactDetail>(`/contacts/${id}`).then((r) => r.data),
  merge: (primaryId: string, duplicateId: string) =>
    api.post('/contacts/merge', { primaryId, duplicateId }).then((r) => r.data),
  ensureRole: (id: string, role: 'SUPPLIER' | 'CUSTOMER' | 'TRADE_IN_SELLER') =>
    api.post<EnsureRoleResult>(`/contacts/${id}/ensure-role`, { role }).then((r) => r.data),
};
