import ScreenTable from '@/components/ui/ScreenTable';
import { NativeSelect } from '@/components/ui/native-select';
import { Fragment, useId as useUiFieldId, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { PaginationBar } from '@/components/ui/PaginationBar';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateTimeSeconds } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import { toast } from 'sonner';
import { exportToExcel } from '@/utils/excel.util';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, auditActionMap } from '@/lib/status-badges';
import { Card, CardHeader, CardTitle, CardToolbar, CardContent } from '@/components/ui/card';

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
  suppliers: 'ผู้จัดจำหน่าย',
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

// ── Collections quick-filter presets ────────────────────────────────────────
const COLLECTION_PRESET_ACTIONS: Record<string, string[]> = {
  all: [
    'STATUS_CHANGE',
    'DUNNING_ESCALATION_PENDING',
    'DUNNING_ESCALATION_APPROVED',
    'DUNNING_ESCALATION_REJECTED',
    'MDM_LOCK_APPROVED',
    'MDM_UNLOCK',
    'HOLD_AUTO_ESCALATION',
    'LETTER_PDF_GENERATED',
    'LETTER_DISPATCHED',
    'LETTER_DELIVERED',
    'LETTER_UNDELIVERABLE',
    'LETTER_EVIDENCE_UPDATED',
    'CONTRACT_STATUS_LEGAL',
    'BULK_ASSIGN',
    'CREATE_CALL_LOG',
  ],
  mdm: ['MDM_LOCK_APPROVED', 'MDM_UNLOCK', 'HOLD_AUTO_ESCALATION'],
  letters: [
    'LETTER_PDF_GENERATED',
    'LETTER_DISPATCHED',
    'LETTER_DELIVERED',
    'LETTER_UNDELIVERABLE',
    'LETTER_EVIDENCE_UPDATED',
    'CONTRACT_STATUS_LEGAL',
  ],
  dunning: [
    'DUNNING_ESCALATION_PENDING',
    'DUNNING_ESCALATION_APPROVED',
    'DUNNING_ESCALATION_REJECTED',
  ],
};

type CollectionPreset = keyof typeof COLLECTION_PRESET_ACTIONS | null;

const PRESET_LABELS: Record<string, string> = {
  all: 'ทั้งหมด (Collections)',
  mdm: 'MDM',
  letters: 'หนังสือ',
  dunning: 'Dunning escalation',
};

function presetBtnClass(active: boolean) {
  return `px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
    active
      ? 'bg-primary/10 border-primary/40 text-primary'
      : 'border-input text-muted-foreground hover:text-foreground hover:bg-muted'
  }`;
}

export default function AuditLogsPage() {
  const uiFieldId = useUiFieldId();
  useDocumentTitle('ประวัติการใช้งาน');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { page, size, setPage, setSize } = usePaginationParams({ defaultSize: 100 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collectionPreset, setCollectionPreset] = useState<CollectionPreset>(null);
  // Server-side filter for preset actions (multi-action filter, sent as `actions` query param)
  const [presetActions, setPresetActions] = useState<string[]>([]);

  const debouncedEntity = useDebounce(entity, 300);

  const { data: stats } = useQuery<AuditStats>({
    queryKey: ['audit-stats'],
    queryFn: async () => (await api.get('/audit/stats')).data,
  });

  const presetActionsKey = presetActions.join(',');

  const { data: result, isLoading, isError, error, refetch } = useQuery<{
    data: AuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ['audit-logs', debouncedEntity, action, dateFrom, dateTo, page, size, presetActionsKey],
    queryFn: async () => {
      const params: Record<string, string | string[]> = {
        page: String(page),
        limit: String(size),
      };
      if (debouncedEntity) params.entity = debouncedEntity;
      // `actions` (multi) takes precedence over `action` (single) — matches backend
      if (presetActions.length > 0) {
        params.actions = presetActions;
      } else if (action) {
        params.action = action;
      }
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      return (await api.get('/audit/logs', { params })).data;
    },
  });

  const logs = result?.data || [];
  const total = result?.total ?? 0;

  function applyPreset(key: string) {
    setCollectionPreset(key as CollectionPreset);
    setPresetActions(COLLECTION_PRESET_ACTIONS[key] ?? []);
    // Clear the manual action select so server doesn't double-filter
    setAction('');
    setPage(1);
  }

  function clearPreset() {
    setCollectionPreset(null);
    setPresetActions([]);
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="ประวัติการดำเนินการ"
        subtitle="ประวัติการทำงานทั้งหมดในระบบ"
        action={
          logs.length > 0 && (
            <button data-ui-control="button"
              onClick={async () => {
                try {
                  await exportToExcel({
                    columns: [
                      { header: 'วันที่', key: 'createdAt', width: 20 },
                      { header: 'ผู้ใช้', key: 'user', width: 20 },
                      { header: "จัดการ", key: 'action', width: 15 },
                      { header: "รายการ", key: 'entity', width: 15 },
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

      {/* Collections quick-filter presets */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] font-medium text-muted-foreground">รายการติดตามหนี้:</span>
        {Object.keys(COLLECTION_PRESET_ACTIONS).map((key) => (
          <button data-ui-control="button"
            key={key}
            onClick={() => applyPreset(key)}
            className={presetBtnClass(collectionPreset === key)}
          >
            {PRESET_LABELS[key] ?? key}
          </button>
        ))}
        {collectionPreset && (
          <button
            onClick={clearPreset}
            className="text-[10px] text-muted-foreground underline hover:text-foreground transition-colors"
          >
            เคลียร์
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 mb-6">
        <div className="mb-4">
          <DateRangeChips
            startDate={dateFrom}
            endDate={dateTo}
            onChange={({ startDate, endDate }) => {
              setDateFrom(startDate);
              setDateTo(endDate);
              setPage(1);
            }}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor={`${uiFieldId}-1`} className="block text-xs font-medium text-muted-foreground mb-1">รายการ</label>
            <input id={`${uiFieldId}-1`}
              type="text"
              value={entity}
              onChange={(e) => { setEntity(e.target.value); setPage(1); }}
              placeholder="เช่น products, contracts..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${uiFieldId}-2`} className="block text-xs font-medium text-muted-foreground mb-1">จัดการ</label>
            <NativeSelect wrapperClassName="max-w-full w-full" id={`${uiFieldId}-2`}
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">ทั้งหมด</option>
              <option value="POST">POST (สร้าง)</option>
              <option value="PUT">PUT (แก้ไข)</option>
              <option value="PATCH">PATCH (อัพเดท)</option>
              <option value="DELETE">DELETE (ลบ)</option>
              <option value="EXCHANGE">เปลี่ยนสินค้า</option>
              <option value="REPOSSESSION">รับคืนหรือยึดเครื่อง</option>
              <option value="STATUS_CHANGE">เปลี่ยนสถานะ</option>
              <option value="ERROR">ข้อผิดพลาด</option>
            </NativeSelect>
          </div>
          <div>
            <label htmlFor={`${uiFieldId}-3`} className="block text-xs font-medium text-muted-foreground mb-1">จากวันที่</label>
            <ThaiDateInput id={`${uiFieldId}-3`}
              data-date-range-custom-start="true"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${uiFieldId}-4`} className="block text-xs font-medium text-muted-foreground mb-1">ถึงวันที่</label>
            <ThaiDateInput id={`${uiFieldId}-4`}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <Card className="overflow-hidden">
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
            <ScreenTable className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">เวลา</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">ผู้ใช้</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">จัดการ</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">รายการ</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">รหัสรายการ</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">IP</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr className="group">
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <button
                          type="button"
                          aria-expanded={expandedId === log.id}
                          aria-label={`ดูรายละเอียดบันทึก ${formatDateTimeSeconds(log.createdAt)}`}
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                          className="min-h-11 text-left text-primary hover:underline"
                        >
                          {formatDateTimeSeconds(log.createdAt)}
                        </button>
                      </td>
                      <td className="px-4 py-3 break-words">{log.user?.name || '-'}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const cfg = getStatusBadgeProps(log.action, auditActionMap);
                          return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                            {actionLabels[log.action] || log.action}
                          </Badge>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-foreground">{entityLabels[log.entity] || log.entity}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {log.entityId ? log.entityId.substring(0, 8) + '...' : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{log.ipAddress || '-'}</td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">{log.duration ?? '-'}</td>
                    </tr>
                      {/* Expanded Detail */}
                      {expandedId === log.id && (
                        <tr><td colSpan={7}>
                        <div className="px-4 py-3 bg-muted border-t">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            {log.newValue && (
                              <div>
                                <p className="font-medium text-muted-foreground mb-1">ค่าใหม่:</p>
                                <pre className="bg-card border rounded p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-foreground">
                                  {JSON.stringify(log.newValue, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.oldValue && (
                              <div>
                                <p className="font-medium text-muted-foreground mb-1">ค่าเดิม:</p>
                                <pre className="bg-card border rounded p-2 whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-foreground">
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
                          <div className="mt-2 text-xs text-muted-foreground break-all">
                            รหัสรายการเต็ม: {log.entityId || '-'}
                          </div>
                        </div>
                        </td></tr>
                      )}
                  </Fragment>
                ))}
              </tbody>
            </ScreenTable>
          </div>
        )}

        {/* Pagination */}
        <PaginationBar
          total={total}
          page={page}
          size={size}
          onPageChange={setPage}
          onSizeChange={setSize}
        />
        </QueryBoundary>
      </Card>
    </div>
  );
}
