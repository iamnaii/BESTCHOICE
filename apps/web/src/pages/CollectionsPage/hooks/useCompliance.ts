import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface DunningFrequencyResponse {
  threshold: number;
  rows: Array<{
    contractId: string;
    contractNumber: string | null;
    customerName: string | null;
    actionCount: number;
  }>;
}

export interface LegalPipelineResponse {
  windows: Array<{ days: number; count: number }>;
  rows: Array<{
    contractId: string;
    contractNumber: string | null;
    caseNumber: string;
    court: string;
    hearingDate: string;
    daysUntil: number;
  }>;
}

export interface AuditSummaryResponse {
  period: 'week' | 'month';
  since: string;
  actionsByUser: Array<{ userId: string; count: number }>;
  actionsByType: Array<{ entity: string; count: number }>;
  anomalyCount: number;
}

export interface VoiceMemoRetentionResponse {
  hotDays: number;
  deleteDays: number;
  eligibleForGlacier: { count: number; sample: string[] };
  eligibleForDelete: { count: number; sample: string[] };
}

export function useDunningFrequency() {
  return useQuery<DunningFrequencyResponse>({
    queryKey: ['compliance', 'dunning-frequency'],
    queryFn: async () => (await api.get('/reporting/compliance/dunning-frequency')).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLegalPipeline() {
  return useQuery<LegalPipelineResponse>({
    queryKey: ['compliance', 'legal-pipeline'],
    queryFn: async () => (await api.get('/reporting/compliance/legal-pipeline')).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAuditSummary(period: 'week' | 'month' = 'week') {
  return useQuery<AuditSummaryResponse>({
    queryKey: ['compliance', 'audit-summary', period],
    queryFn: async () =>
      (await api.get(`/reporting/compliance/audit-summary?period=${period}`)).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useVoiceMemoRetention() {
  return useQuery<VoiceMemoRetentionResponse>({
    queryKey: ['compliance', 'voice-memo-retention'],
    queryFn: async () => (await api.get('/reporting/compliance/voice-memo-retention')).data,
    staleTime: 5 * 60 * 1000,
  });
}
