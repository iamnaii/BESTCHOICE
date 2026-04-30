import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface SessionContract {
  id: string;
  contractId: string;
  escalationFlag: boolean;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  contract: {
    id: string;
    contractNumber: string;
    daysOverdue: number;
    customer: { id: string; name: string; phone: string | null; lineIdFinance: string | null; lineIdShop: string | null };
    branch: { id: string; name: string };
    assignedTo: { id: string; name: string } | null;
    outstanding?: number | null;
    brokenPromiseCount?: number;
    noAnswerCount?: number;
  };
}

export interface MySession {
  contracts: SessionContract[];
  target: { count: number; etaMinutes: number };
  breakdown: { calls: number; lines: number; severe: number; medium: number; light: number };
  summary?: {
    total: number;
    callsConnected: number;
    callsNoAnswer: number;
    lineSent: number;
    skipped: number;
    elapsedMinutes: number;
  };
}

export function useMySession() {
  return useQuery<MySession>({
    queryKey: ['collections-session', 'mine'],
    queryFn: async () => {
      const { data } = await api.get('/collections/session/mine');
      return data;
    },
    refetchOnWindowFocus: false,
  });
}
