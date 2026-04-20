import api from '@/lib/api';
import type { CustomerTier } from '@/types/customer-tier';

export type PreCheckDecision = 'PASS' | 'FAIL' | 'REVIEW';

export interface PreCheckRequest {
  nationalId: string;
  phone: string;
  bankName?: string;
  statementFiles?: string[];
}

export interface PreCheckResponse {
  customerId: string;
  isNewCustomer: boolean;
  tier: CustomerTier;
  decision: PreCheckDecision;
  reasons: { code: string; message: string }[];
  aiScore?: number;
  creditCheckId?: string;
}

export async function postPreCheck(body: PreCheckRequest): Promise<PreCheckResponse> {
  const { data } = await api.post<PreCheckResponse>('/customers/pre-check', body);
  return data;
}
