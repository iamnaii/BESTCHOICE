import api from '@/lib/api';

export interface BankAccount {
  id: string;
  accountCode: string;
  accountName: string;
  bankName: string;
  accountNumber: string | null;
  accountType: 'SAVINGS' | 'CURRENT' | 'FIXED' | 'CASH';
  currency: string;
  isActive: boolean;
  notes: string | null;
  balance: string;
}

export const bankAccountsApi = {
  list: (activeOnly = true) =>
    api
      .get<BankAccount[]>('/bank-accounts', {
        params: { active: activeOnly ? 'true' : undefined },
      })
      .then((r) => r.data),
};
