import api from './api';

export type ReopenedPeriod = {
  id?: string;
  year: number;
  month: number;
  reopenedAt: string;
  reopenedBy: { id: string; name: string };
  reopenReason: string | null;
  taxFiled: boolean | null;
};

export const accountingApi = {
  listReopenedPeriods: () =>
    api.get<ReopenedPeriod[]>('/accounting/periods/reopened').then((r: { data: ReopenedPeriod[] }) => r.data),
};
