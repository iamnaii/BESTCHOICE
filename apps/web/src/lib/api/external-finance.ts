import api from '@/lib/api';

export interface ExternalFinanceCompany {
  id: string;
  name: string;
  isActive: boolean;
}

export const externalFinanceKeys = {
  companies: ['external-finance-companies'] as const,
};

export const externalFinanceApi = {
  listCompanies: () =>
    api.get<ExternalFinanceCompany[]>('/external-finance/companies').then((r) => r.data),
};
