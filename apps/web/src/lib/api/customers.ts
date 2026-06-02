import api from '@/lib/api';

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  activeContracts: number;
  overdueCount: number;
  totalOutstandingThb: number;
}

export const customerKeys = {
  summary: (id: string) => ['customer-summary', id] as const,
};

export const customersApi = {
  summary: (id: string) =>
    api.get<CustomerSummary>(`/customers/${id}/summary`).then((r) => r.data),
};
