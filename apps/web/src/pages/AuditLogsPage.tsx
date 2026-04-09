import { useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateTimeSeconds } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { toast } from 'sonner';
import { exportToExcel } from '@/utils/excel.util';
import { Download } from 'lucide-react';

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  duration: number | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

interface AuditStats {
  todayCount: number;
  weekCount: number;
  totalCount: number;
  recentErrors: number;
}

const actionColors: Record<string, string> = {
  POST: 'bg-success/10 text-success dark:bg-success/15',
  PUT: 'bg-primary/10 text-primary dark:bg-primary/15',
  PATCH: 'bg-warning/10 text-warning dark:bg-warning/15',
  DELETE: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  EXCHANGE: 'bg-primary/10 text-primary dark:bg-primary/15',
  REPOSSESSION: 'bg-warning/10 text-warning dark:bg-warning/15',
  CREATE_CALL_LOG: 'bg-success/10 text-success dark:bg-success/15',
  STATUS_CHANGE: 'bg-primary/10 text-primary dark:bg-primary/15',
};

const actionLabels: Record<string, string> = {
  POST: 'สร้าง',
  PUT: 'แก้ไข',
  PATCH: 'อัพเดท',
  DELETE: 'ลบ',
  EXCHANGE: 'เปลี่ยนเครื่อง',
  REPOSSESSION: 'ยึดคืน',
  CREATE_CALL_LOG: 'บันทึกการโทร',
  STATUS_CHANGE: 'เปลี่ยนสถานะ',
};

const entityLabels: Record<string, string> = {
  products: 'สินค้า',
  contracts: 'สัญญา',
  customers: 'ลูกค้า',
  suppliers: 'ผู้ขาย',
  payments: 'ชำระเงิน',
  branches: 'สาขา',
  users: 'ผู้ใช้',
  auth: 'เข้าสู่ระบบ',
  repossession: 'ยึดคืน',
  exchange: 'เปลี่ยนเครื่อง',
  contract: 'สัญญา',
  call_log: 'บันทึกโทร',
  settings: 'ตั้งค่า',
  inspections: 'ตรวจสอบ',
  stickers: 'สติ๊กเกอร์',
  documents: 'เอกสาร',
  notifications: 'แจ้งเตือน',
};

export default function AuditLogsPage() {
  useDocumentTitle('ประวัติการใช้งาน');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 25;

  const debouncedEntity = useDebounce(entity, 300);

  const { data: stats } = useQuery<AuditStats>({
    queryKey: ['audit-stats'],
    queryFn: async () => (await api.get('/audit/stats')).data,
  });

  const { data: result, isLoading, isError, error, refetch } = useQuery<{
    data: AuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ['audit-logs', debouncedEntity, action, dateFrom, dateTo, page],
    queryFn: async () => {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(limit),
      };
      if (debouncedEntity) params.entity = debouncedEntity;
      if (action) params.action = action;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      return (await api.get('/audit/logs', { params })).data;
    },
  });

  const logs = result?.data || [];
  const totalPages = result?.totalPages || 1;

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="ประวัติการทำงานทั้งหมดในระบบ"
        action={
          logs.length > 0 && (
            <button
              onClick={async () => {
                try {
                  await exportToExcel({
                    columns: [
                      { header: 'วันที่', key: 'createdAt', width: 20 },
                      { header: 'ผู้ใช้', key: 'user', width: 20 },
                      { header: 'Action', key: 'action', width: 15 },
                      { header: 'Entity', key: 'entity', width: 15 },
                      { header: 'รายละเอียด', key: 'detail', width: 30 },
                    ],
                    data: logs.map((log) => ({
                      createdAt: formatDateTimeSeconds(log.createdAt),
                      user: log.user?.name || '-',
                      action: actionLabels[log.action] || log.action,
                      entity: entityLabels[log.entity] || log.entity,
                      detail: log.entityId ? `${log.entity}/${log.entityId.substring(0, 8)}` : '-',
                    })),
                    sheetName: 'Audit Logs',
                    filename: `audit_logs_${new Date().toISOString().slice(0, 10)}.xlsx`,
                  });
                  toast.success('ส่งออก Excel สำเร็จ');
                } catch {
                  toast.error('ไม่สามารถส่งออก Excel ได้');
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              <Download className="size-4" />
              ส่งออก Excel
            </button>
          )
        }
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-6">
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full"><div className="w-1 shrink-0 bg-primary" /><div className="p-4 flex-1">
            <p className="text-xs text-muted-foreground">วันนี้</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{stats.todayCount.toLocaleString()}</p>
            </div></div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full"><div className="w-1 shrink-0 bg-success" /><div className="p-4 flex-1">
            <p className="text-xs text-muted-foreground">7 วันล่าสุด</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{stats.weekCount.toLocaleString()}</p>
            </div></div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full"><div className="w-1 shrink-0 bg-foreground/40" /><div className="p-4 flex-1">
            <p className="text-xs text-muted-foreground">ทั้งหมด</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{stats.totalCount.toLocaleString()}</p>
            </div></div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full"><div className="w-1 shrink-0 bg-destructive" /><div className="p-4 flex-1">
            <p className="text-xs text-muted-foreground">Error (7 วัน)</p>
            <p className={`text-2xl font-bold tabular-nums ${stats.recentErrors > 0 ? 'text-destructive' : 'text-success'}`}>
              {stats.recentErrors}
            </p>
            </div></div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Entity</label>
            <input
              type="text"
              value={entity}
              onChange={(e) => { setEntity(e.target.value); setPage(1); }}
              placeholder="เช่น products, contracts..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
            <select
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">ทั้งหมด</option>
              <option value="POST">POST (สร้าง)</option>
              <option value="PUT">PUT (แก้ไข)</option>
              <option value="PATCH">PATCH (อัพเดท)</option>
              <option value="DELETE">DELETE (ลบ)</option>
              <option value="EXCHANGE">EXCHANGE</option>
              <option value="REPOSSESSION">REPOSSESSION</option>
              <option value="STATUS_CHANGE">STATUS_CHANGE</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">จากวันที่</label>
            <ThaiDateInput
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">ถึงวันที่</label>
            <ThaiDateInput
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <QueryBoundary
          isLoading={isLoading && !result}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดบันทึกการตรวจสอบได้"
        >
        {logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">ไม่พบข้อมูล</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">เวลา</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">ผู้ใช้</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">IP</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="group">
                    <td colSpan={7} className="p-0">
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="w-full text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center">
                          <div className="px-4 py-3 w-44 shrink-0 text-muted-foreground text-xs">
                            {formatDateTimeSeconds(log.createdAt)}
                          </div>
                          <div className="px-4 py-3 w-36 shrink-0 truncate">
                            {log.user?.name || '-'}
                          </div>
                          <div className="px-4 py-3 w-32 shrink-0">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              actionColors[log.action] ||
                              (log.action.endsWith('_ERROR') ? 'bg-destructive/10 text-destructive dark:bg-destructive/15' : 'bg-muted text-foreground')
                            }`}>
                              {actionLabels[log.action] || log.action}
                            </span>
                          </div>
                          <div className="px-4 py-3 w-28 shrink-0 text-foreground">
                            {entityLabels[log.entity] || log.entity}
                          </div>
                          <div className="px-4 py-3 w-32 shrink-0 font-mono text-xs text-muted-foreground truncate">
                            {log.entityId ? log.entityId.substring(0, 8) + '...' : '-'}
                          </div>
                          <div className="px-4 py-3 w-28 shrink-0 text-xs text-muted-foreground">
                            {log.ipAddress || '-'}
                          </div>
                          <div className="px-4 py-3 w-16 shrink-0 text-center text-xs text-muted-foreground">
                            {log.duration ?? '-'}
                          </div>
                        </div>
                      </button>

                      {/* Expanded Detail */}
                      {expandedId === log.id && (
                        <div className="px-4 py-3 bg-muted border-t">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            {log.newValue && (
                              <div>
                                <p className="font-medium text-muted-foreground mb-1">New Value:</p>
                                <pre className="bg-card border rounded p-2 overflow-x-auto max-h-48 text-foreground">
                                  {JSON.stringify(log.newValue, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.oldValue && (
                              <div>
                                <p className="font-medium text-muted-foreground mb-1">Old Value:</p>
                                <pre className="bg-card border rounded p-2 overflow-x-auto max-h-48 text-foreground">
                                  {JSON.stringify(log.oldValue, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                          {log.userAgent && (
                            <div className="mt-2">
                              <p className="font-medium text-muted-foreground mb-1 text-xs">User Agent:</p>
                              <p className="text-xs text-muted-foreground break-all">{log.userAgent}</p>
                            </div>
                          )}
                          <div className="mt-2 text-xs text-muted-foreground">
                            Full Entity ID: {log.entityId || '-'}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted">
            <p className="text-xs text-muted-foreground">
              แสดง {logs.length} จาก {result?.total?.toLocaleString()} รายการ
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-50 hover:bg-muted/50"
              >
                ก่อนหน้า
              </button>
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-50 hover:bg-muted/50"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
        </QueryBoundary>
      </div>
    </div>
  );
}
