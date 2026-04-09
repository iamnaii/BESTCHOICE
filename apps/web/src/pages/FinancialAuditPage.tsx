import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateShort } from '@/utils/formatters';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string };
}

const ACTION_LABELS: Record<string, string> = {
  PAYMENT_RECORDED: 'บันทึกชำระเงิน',
  PAYMENT_PARTIAL: 'ชำระบางส่วน',
  LATE_FEE_WAIVED: 'ยกเว้นค่าปรับ',
  CREDIT_APPLIED: 'ใช้เครดิต',
  RECEIPT_GENERATED: 'ออกใบเสร็จ',
  RECEIPT_VOIDED: 'ยกเลิกใบเสร็จ',
  CREDIT_NOTE_ISSUED: 'ออกใบลดหนี้',
  OVERPAYMENT_CREDITED: 'บันทึกเครดิตเกิน',
  CREDIT_BALANCE_APPLIED: 'ใช้ยอดเครดิต',
  CONTRACT_COMPLETED: 'ปิดสัญญา',
  DUNNING_ESCALATION: 'ยกระดับติดตามหนี้',
  STATUS_CHANGE: 'เปลี่ยนสถานะ',
};

const ACTION_COLORS: Record<string, string> = {
  PAYMENT_RECORDED: 'bg-success/10 text-success dark:bg-success/15',
  PAYMENT_PARTIAL: 'bg-blue-100 text-blue-800',
  LATE_FEE_WAIVED: 'bg-warning/10 text-warning dark:bg-warning/15',
  CREDIT_APPLIED: 'bg-info/10 text-info dark:bg-info/15',
  RECEIPT_GENERATED: 'bg-emerald-100 text-emerald-800',
  RECEIPT_VOIDED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  CREDIT_NOTE_ISSUED: 'bg-warning/10 text-warning dark:bg-warning/15',
  DUNNING_ESCALATION: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  STATUS_CHANGE: 'bg-gray-100 text-gray-800',
};

export default function FinancialAuditPage() {
  const [contractId, setContractId] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery<{ data: AuditEntry[]; total: number }>({
    queryKey: ['financial-audit', contractId],
    queryFn: async () => {
      if (!contractId) return { data: [], total: 0 };
      const { data } = await api.get(`/audit/financial/${contractId}`);
      return data;
    },
    enabled: !!contractId,
  });

  const handleSearch = () => {
    setContractId(searchInput.trim());
  };

  const columns = [
    {
      key: 'createdAt',
      label: 'วันที่',
      render: (e: AuditEntry) => (
        <div className="text-xs">
          <div>{formatDateShort(e.createdAt)}</div>
          <div className="text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString('th-TH')}</div>
        </div>
      ),
    },
    {
      key: 'action',
      label: 'เหตุการณ์',
      render: (e: AuditEntry) => (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTION_COLORS[e.action] || 'bg-muted text-muted-foreground'}`}>
          {ACTION_LABELS[e.action] || e.action}
        </span>
      ),
    },
    {
      key: 'user',
      label: 'ผู้ดำเนินการ',
      render: (e: AuditEntry) => (
        <div className="text-xs">
          <div className="font-medium">{e.user.name}</div>
          <div className="text-muted-foreground">{e.user.role}</div>
        </div>
      ),
    },
    {
      key: 'details',
      label: 'รายละเอียด',
      render: (e: AuditEntry) => {
        const val = e.newValue;
        if (!val) return '-';
        const amount = val.amount as number | undefined;
        const installmentNo = val.installmentNo as number | undefined;
        return (
          <div className="text-xs max-w-[300px]">
            {amount !== undefined && <span className="font-medium">{amount.toLocaleString()} ฿</span>}
            {installmentNo !== undefined && <span className="text-muted-foreground ml-1">งวด {installmentNo}</span>}
            {val.reason ? <div className="text-muted-foreground truncate">{String(val.reason)}</div> : null}
            {val.from && val.to ? <div className="text-muted-foreground">{String(val.from)} → {String(val.to)}</div> : null}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Financial Audit Trail"
        subtitle="ประวัติธุรกรรมการเงินของสัญญา"
      />

      <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-6">
        <CardContent className="p-5">
          <div className="flex gap-3">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="ค้นหาด้วย Contract ID..."
              className="flex-1 h-10 px-3.5 border border-input rounded-lg text-sm outline-none bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
            >
              ค้นหา
            </button>
          </div>
        </CardContent>
      </Card>

      {contractId && (
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-4">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                สัญญา: <span className="font-mono text-foreground">{contractId}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {data?.total || 0} รายการ
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <QueryBoundary
        isLoading={isLoading && !data}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดบันทึกการเงินได้"
      >
        {data?.data && data.data.length > 0 ? (
          <DataTable columns={columns} data={data.data} emptyMessage="ไม่พบรายการ" />
        ) : contractId ? (
          <div className="text-center py-12 text-muted-foreground text-sm">ไม่พบรายการธุรกรรมสำหรับสัญญานี้</div>
        ) : (
          <div className="text-center py-12 text-muted-foreground text-sm">กรอก Contract ID เพื่อดูประวัติธุรกรรมการเงิน</div>
        )}
      </QueryBoundary>
    </div>
  );
}
