import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface CollectorStatus {
  id: string;
  name: string;
  isActive: boolean;
  callsToday: number;
  assignmentsToday: number;
  collectedToday: number;
  lastCallAt: string | null;
  status: 'on-track' | 'behind' | 'idle' | 'inactive';
}

export interface TeamAlert {
  type: 'idle_collector' | 'broken_promise_added' | 'pending_settlement';
  message: string;
  count?: number;
  collectorId?: string;
}

export interface TeamDashboard {
  today: {
    totalCollected: number;
    callsMade: number;
    assignmentsTotal: number;
    promisesMade: number;
    brokenPromisesAdded: number;
  };
  collectors: CollectorStatus[];
  alerts: TeamAlert[];
}

export function useTeamDashboard() {
  return useQuery<TeamDashboard>({
    queryKey: ['collections', 'team-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/collections/session/team-dashboard');
      return data;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
