import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { AfterSalesStage } from '@/pages/after-sales/after-sales';
import { useChatWorkSettings } from './useChatWork';
export interface ServiceRequest {
  id: string;
  roomId: string;
  symptom: string;
  revision: number;
  status: 'OPEN' | 'WAITING_CUSTOMER' | 'LINKED' | 'RESOLVED' | 'CANCELLED';
  todo: {
    id: string;
    status: string;
    assigneeId: string | null;
    assignee: { name: string } | null;
    dueDate: string | null;
  };
  sourceMessages: { id: string; text: string | null; createdAt: string; role: string }[];
  currentCustomerId: string | null;
  canOpenCase: boolean;
  canLinkCase: boolean;
  linkedCase: { id: string; caseNumber: string; stage: AfterSalesStage; deviceImei: string } | null;
  linkedCaseUnavailable?: boolean;
}
export function useChatServiceRequests(roomId: string, page = 1) {
  const work = useChatWorkSettings();
  return useQuery({
    queryKey: [...work.key, 'service-requests', roomId, page],
    queryFn: () =>
      api
        .get<{
          data: ServiceRequest[];
          total: number;
        }>(`/staff-chat/rooms/${roomId}/service-requests`, { params: { ...work.scope, page, limit: 10 } })
        .then((r) => r.data),
    enabled: !!roomId && !!work.settings.data?.flags.chat_service_requests_enabled,
    refetchInterval: 30_000,
  });
}
export function useChatServiceRequest(id: string) {
  const work = useChatWorkSettings();
  return useQuery({
    queryKey: [...work.key, 'service-request', id],
    queryFn: () =>
      api
        .get<ServiceRequest>(`/staff-chat/service-requests/${id}`, { params: work.scope })
        .then((r) => r.data),
    enabled: !!id,
    refetchInterval: 15_000,
    retry: false,
  });
}
