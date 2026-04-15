import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import DataTable from '@/components/ui/DataTable';
import { formatDateTime } from '@/utils/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, webhookStatusMap } from '@/lib/status-badges';

interface NotificationLog {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  message: string;
  status: string;
  relatedId: string | null;
  errorMsg: string | null;
  sentAt: string | null;
  createdAt: string;
}

const channelLabels: Record<string, string> = {
  LINE: 'LINE',
  SMS: 'SMS',
  IN_APP: 'ในระบบ',
};

const statusLabels: Record<string, string> = {
  SENT: 'ส่งแล้ว',
  FAILED: 'ล้มเหลว',
  PENDING: 'รอส่ง',
};

interface NotificationLogTableProps {
  channelFilter: string;
  setChannelFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  activeTab: string;
}

export default function NotificationLogTable({
  channelFilter,
  setChannelFilter,
  statusFilter,
  setStatusFilter,
  activeTab,
}: NotificationLogTableProps) {
  const {
    data: logs = [],
    isLoading: logsLoading,
    isError: logsError,
    error: logsErrorObj,
    refetch: logsRefetch,
  } = useQuery<NotificationLog[]>({
    queryKey: ['notification-logs', channelFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (channelFilter) params.set('channel', channelFilter);
      if (statusFilter) params.set('status', statusFilter);
      return (await api.get(`/notifications/logs?${params}`)).data;
    },
    enabled: activeTab === 'logs',
  });

  const logColumns = [
    {
      key: 'channel',
      label: 'ช่องทาง',
      render: (l: NotificationLog) => (
        <span className="text-sm font-medium">{channelLabels[l.channel] || l.channel}</span>
      ),
    },
    {
      key: 'recipient',
      label: 'ผู้รับ',
      render: (l: NotificationLog) => <span className="text-sm">{l.recipient}</span>,
    },
    {
      key: 'message',
      label: 'ข้อความ',
      render: (l: NotificationLog) => (
        <div className="max-w-xs truncate text-sm text-muted-foreground">{l.message}</div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (l: NotificationLog) => {
        const cfg = getStatusBadgeProps(l.status, webhookStatusMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
            {statusLabels[l.status] || cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'sentAt',
      label: 'เวลาส่ง',
      render: (l: NotificationLog) => (
        <span className="text-xs text-muted-foreground">
          {l.sentAt ? formatDateTime(l.sentAt) : '-'}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="flex gap-3 mb-4">
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="">ทุกช่องทาง</option>
          <option value="LINE">LINE</option>
          <option value="SMS">SMS</option>
          <option value="IN_APP">ในระบบ</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="">ทุกสถานะ</option>
          <option value="SENT">ส่งแล้ว</option>
          <option value="FAILED">ล้มเหลว</option>
          <option value="PENDING">รอส่ง</option>
        </select>
      </div>
      <QueryBoundary
        isLoading={logsLoading && logs.length === 0}
        isError={logsError}
        error={logsErrorObj}
        onRetry={logsRefetch}
        errorTitle="ไม่สามารถโหลดประวัติการแจ้งเตือนได้"
      >
        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={logColumns}
              data={logs}
              isLoading={logsLoading}
              emptyMessage="ยังไม่มีประวัติ"
            />
          </CardContent>
        </Card>
      </QueryBoundary>
    </>
  );
}
