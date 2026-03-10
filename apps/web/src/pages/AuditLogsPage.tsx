import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { useDebounce } from '@/hooks/useDebounce';

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
  POST: 'bg-green-100 text-green-700',
  PUT: 'bg-blue-100 text-blue-700',
  PATCH: 'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
  EXCHANGE: 'bg-blue-100 text-blue-700',
  REPOSSESSION: 'bg-orange-100 text-orange-700',
  CREATE_CALL_LOG: 'bg-teal-100 text-teal-700',
  STATUS_CHANGE: 'bg-indigo-100 text-indigo-700',
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

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AuditLogsPage() {
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

  const { data: result, isLoading } = useQuery<{
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
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">วันนี้</p>
            <p className="text-2xl font-bold text-gray-900">{stats.todayCount.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">7 วันล่าสุด</p>
            <p className="text-2xl font-bold text-gray-900">{stats.weekCount.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">ทั้งหมด</p>
            <p className="text-2xl font-bold text-gray-900">{stats.totalCount.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500">Error (7 วัน)</p>
            <p className={`text-2xl font-bold ${stats.recentErrors > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {stats.recentErrors}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Entity</label>
            <input
              type="text"
              value={entity}
              onChange={(e) => { setEntity(e.target.value); setPage(1); }}
              placeholder="เช่น products, contracts..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
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
            <label className="block text-xs font-medium text-gray-600 mb-1">จากวันที่</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ถึงวันที่</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">ไม่พบข้อมูล</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">เวลา</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">ผู้ใช้</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Action</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Entity</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Entity ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">IP</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="group">
                    <td colSpan={7} className="p-0">
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="w-full text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center">
                          <div className="px-4 py-3 w-44 shrink-0 text-gray-500 text-xs">
                            {formatDate(log.createdAt)}
                          </div>
                          <div className="px-4 py-3 w-36 shrink-0 truncate">
                            {log.user?.name || '-'}
                          </div>
                          <div className="px-4 py-3 w-32 shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              actionColors[log.action] ||
                              (log.action.endsWith('_ERROR') ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700')
                            }`}>
                              {actionLabels[log.action] || log.action}
                            </span>
                          </div>
                          <div className="px-4 py-3 w-28 shrink-0 text-gray-700">
                            {entityLabels[log.entity] || log.entity}
                          </div>
                          <div className="px-4 py-3 w-32 shrink-0 font-mono text-xs text-gray-400 truncate">
                            {log.entityId ? log.entityId.substring(0, 8) + '...' : '-'}
                          </div>
                          <div className="px-4 py-3 w-28 shrink-0 text-xs text-gray-400">
                            {log.ipAddress || '-'}
                          </div>
                          <div className="px-4 py-3 w-16 shrink-0 text-center text-xs text-gray-400">
                            {log.duration ?? '-'}
                          </div>
                        </div>
                      </button>

                      {/* Expanded Detail */}
                      {expandedId === log.id && (
                        <div className="px-4 py-3 bg-gray-50 border-t">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            {log.newValue && (
                              <div>
                                <p className="font-medium text-gray-600 mb-1">New Value:</p>
                                <pre className="bg-white border rounded p-2 overflow-x-auto max-h-48 text-gray-700">
                                  {JSON.stringify(log.newValue, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.oldValue && (
                              <div>
                                <p className="font-medium text-gray-600 mb-1">Old Value:</p>
                                <pre className="bg-white border rounded p-2 overflow-x-auto max-h-48 text-gray-700">
                                  {JSON.stringify(log.oldValue, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                          {log.userAgent && (
                            <div className="mt-2">
                              <p className="font-medium text-gray-600 mb-1 text-xs">User Agent:</p>
                              <p className="text-xs text-gray-500 break-all">{log.userAgent}</p>
                            </div>
                          )}
                          <div className="mt-2 text-xs text-gray-400">
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
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <p className="text-xs text-gray-500">
              แสดง {logs.length} จาก {result?.total?.toLocaleString()} รายการ
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-50 hover:bg-white"
              >
                ก่อนหน้า
              </button>
              <span className="text-xs text-gray-600">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-50 hover:bg-white"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
