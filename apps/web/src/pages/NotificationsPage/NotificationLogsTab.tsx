import DataTable from '@/components/ui/DataTable';
import { NotificationLog, channelLabels, statusLabels, statusColors } from './types';

interface Props {
  logs: NotificationLog[];
  isLoading: boolean;
  channelFilter: string;
  statusFilter: string;
  onChannelFilterChange: (v: string) => void;
  onStatusFilterChange: (v: string) => void;
}

const SELECT_CLS =
  'px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

export default function NotificationLogsTab({
  logs, isLoading, channelFilter, statusFilter, onChannelFilterChange, onStatusFilterChange,
}: Props) {
  const columns = [
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
      render: (l: NotificationLog) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[l.status]}`}>
          {statusLabels[l.status]}
        </span>
      ),
    },
    {
      key: 'sentAt',
      label: 'เวลาส่ง',
      render: (l: NotificationLog) => (
        <span className="text-xs text-muted-foreground">
          {l.sentAt ? new Date(l.sentAt).toLocaleString('th-TH') : '-'}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="flex gap-3 mb-4">
        <select value={channelFilter} onChange={(e) => onChannelFilterChange(e.target.value)} className={SELECT_CLS}>
          <option value="">ทุกช่องทาง</option>
          <option value="LINE">LINE</option>
          <option value="SMS">SMS</option>
          <option value="IN_APP">ในระบบ</option>
        </select>
        <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} className={SELECT_CLS}>
          <option value="">ทุกสถานะ</option>
          <option value="SENT">ส่งแล้ว</option>
          <option value="FAILED">ล้มเหลว</option>
          <option value="PENDING">รอส่ง</option>
        </select>
      </div>
      <DataTable columns={columns} data={logs} isLoading={isLoading} emptyMessage="ยังไม่มีประวัติ" />
    </>
  );
}
