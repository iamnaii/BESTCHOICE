import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ContractDetail, EarlyPayoffQuote } from './types';

export function useContractDetail(id: string | undefined) {
  const { data: contract, isLoading } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  const { data: payoffQuote } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/early-payoff-quote`); return data; },
    enabled: !!contract && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status),
  });

  const { data: eDocuments = [] } = useQuery<{ id: string; documentType: string; fileUrl: string; fileHash: string; createdAt: string }[]>({
    queryKey: ['contract-edocuments', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/documents`); return data; },
  });

  const { data: docChecklist } = useQuery<{ complete: boolean; checklist: { type: string; label: string; present: boolean }[] }>({
    queryKey: ['contract-doc-checklist', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/documents/checklist`); return data; },
    enabled: !!contract && contract.workflowStatus === 'PENDING_REVIEW',
  });

  return { contract, isLoading, payoffQuote, eDocuments, docChecklist };
}
