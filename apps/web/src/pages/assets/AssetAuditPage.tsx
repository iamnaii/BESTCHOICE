import { useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateTime } from '@/utils/formatters';
import { assetsApi } from './api';
import type { AuditLogEntry } from './types';

const ACTION_LABEL: Record<string, string> = {
  ASSET_CREATE: 'สร้าง',
  ASSET_UPDATE: 'แก้ไข',
  ASSET_DELETE: 'ลบ',
  ASSET_POST: 'ลงบัญชี',
  ASSET_REVERSE: 'กลับรายการ',
  ASSET_DISPOSE: 'จำหน่าย',
  ASSET_REVERSE_DISPOSE: 'กลับการจำหน่าย',
  ASSET_TRANSFER: 'โอน',
  ASSET_POST_BLOCKED: 'ลงบัญชี (ปิดบัญชี)',
  ASSET_REVERSE_BLOCKED: 'กลับ (ปิดบัญชี)',
  ASSET_DISPOSE_BLOCKED: 'จำหน่าย (ปิดบัญชี)',
  ASSET_REVERSE_DISPOSE_BLOCKED: 'กลับจำหน่าย (ปิดบัญชี)',
};

export default function AssetAuditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [actionFilter, setActionFilter] = useState<string>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['asset-audit', id],
    queryFn: () => assetsApi.getAudit(id!),
    enabled: !!id,
  });

  const filtered = useMemo(() => {
    if (!query.data) return [];
    return query.data.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (fromDate && new Date(log.createdAt) < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate); end.setHours(23, 59, 59, 999);
        if (new Date(log.createdAt) > end) return false;
      }
      return true;
    });
  }, [query.data, actionFilter, fromDate, toDate]);

  const toggleExpand = (logId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId); else next.add(logId);
      return next;
    });
  };

  if (!id) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="ประวัติการเปลี่ยนแปลง (Audit Trail)"
        subtitle="แสดง 100 รายการล่าสุด"
        icon={<History className="h-5 w-5" />}
        onBack={() => navigate(`/assets/${id}`)}
      />

      <p className="text-sm text-muted-foreground mb-2">
        แสดงเฉพาะ 100 รายการล่าสุด · สำหรับประวัติเก่ากว่านี้ ใช้หน้า{' '}
        <Link to="/audit-logs" className="text-primary underline">
          Audit Logs (ทั้งระบบ)
        </Link>
      </p>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={actionFilter || 'ALL'} onValueChange={(v) => setActionFilter(v === 'ALL' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุก Action</SelectItem>
              {Object.entries(ACTION_LABEL).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ThaiDateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <ThaiDateInput value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </CardContent>
      </Card>

      <QueryBoundary isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} errorTitle="โหลดประวัติไม่สำเร็จ">
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {filtered.map((log: AuditLogEntry) => (
                <li key={log.id} className="p-4">
                  <button onClick={() => toggleExpand(log.id)} className="flex items-start gap-2 w-full text-left">
                    {expanded.has(log.id) ? <ChevronDown className="h-4 w-4 mt-1" /> : <ChevronRight className="h-4 w-4 mt-1" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={log.action.endsWith('_BLOCKED') ? 'destructive' : 'success'}>
                          {ACTION_LABEL[log.action] ?? log.action}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                        <span className="text-sm">— {log.user.name}</span>
                      </div>
                    </div>
                  </button>
                  {expanded.has(log.id) && (
                    <div className="mt-2 ml-6 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="font-semibold mb-1">ก่อน</div>
                        <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap">
                          {JSON.stringify(log.oldValue, null, 2) || '-'}
                        </pre>
                      </div>
                      <div>
                        <div className="font-semibold mb-1">หลัง</div>
                        <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap">
                          {JSON.stringify(log.newValue, null, 2) || '-'}
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="p-4 text-center text-muted-foreground">
                  ไม่พบรายการ
                  {(actionFilter || fromDate || toDate) && (
                    <span className="block text-xs mt-1">
                      (ไม่พบใน 100 รายการล่าสุด — ลองดู Audit Logs ของทั้งระบบ)
                    </span>
                  )}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
