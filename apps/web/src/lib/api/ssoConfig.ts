import api from '@/lib/api';

export interface SsoEffectiveConfig {
  salaryCeiling: string; // Decimal → string
  maxContribution: string; // Decimal → string (875 in 2569+)
  effectiveFrom: string;
  rate: number; // 0.05
}

export const ssoConfigKeys = {
  effective: (date: string) => ['sso-config', 'effective', date] as const,
};

export const ssoConfigApi = {
  effective: (date?: string) =>
    api
      .get<SsoEffectiveConfig>('/sso-config/effective', { params: date ? { date } : {} })
      .then((r) => r.data),
};
