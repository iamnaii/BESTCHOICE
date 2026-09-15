import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DataTable from '@/components/ui/DataTable';
import { contractStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import { formatDateTime } from '@/utils/formatters';
import type { AuditLog, CustomerDetail } from '../types';

const actionLabels: Record<string, string> = {
  CREATE: 'เพิ่มข้อมูล',
  UPDATE: 'แก้ไขข้อมูล',
  DELETE: 'ลบข้อมูล',
  EXCHANGE: 'เปลี่ยนเครื่อง',
  REPOSSESSION: 'ยึดคืน',
  'CREDIT_CHECK': 'ตรวจสอบเครดิต',
};

interface ContractsTabProps {
  customer: CustomerDetail;
  isOwner: boolean;
  activityLogs: { data: AuditLog[] };
}

export default function ContractsTab({ customer, isOwner, activityLogs }: ContractsTabProps) {
  const contractColumns = [
    { key: 'contractNumber', label: 'เลขสัญญา', render: (c: CustomerDetail['contracts'][0]) => <span className="whitespace-nowrap font-mono text-sm tabular-nums">{c.contractNumber}</span> },
    { key: 'product', label: 'สินค้า', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{c.product.brand} {c.product.model}</span> },
    { key: 'status', label: 'สถานะ', render: (c: CustomerDetail['contracts'][0]) => {
      const cfg = getStatusBadgeProps(c.status, contractStatusMap);
      return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
    }},
    { key: 'monthlyPayment', label: 'ค่างวด', render: (c: CustomerDetail['contracts'][0]) => <span className="whitespace-nowrap text-sm tabular-nums font-mono">{parseFloat(c.monthlyPayment).toLocaleString()} ฿/เดือน</span> },
    { key: 'branch', label: 'สาขา', render: (c: CustomerDetail['contracts'][0]) => <span className="text-xs">{c.branch.name}</span> },
  ];

  return (
    <>
      {/* Contracts */}
      <div className="mb-6">
        {/* ข้างคอลัมน์ขวา 360px ที่จอ 1280 ตารางเหลือ ~574px — บีบช่องไฟ ไม่ตัดคอลัมน์ (กติกาเจ้าของ "พอดีหน้า = บีบขนาด") · เลขสัญญา/ค่างวดไม่ตัดบรรทัด */}
        <DataTable columns={contractColumns} data={customer.contracts} emptyMessage="ยังไม่มีสัญญา" minWidth="560px" density="compact" />
      </div>

      {/* Activity Timeline (OWNER only) */}
      {isOwner && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ประวัติการดำเนินการ</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLogs.data && activityLogs.data.length > 0 ? (
              <div className="space-y-3">
                {activityLogs.data.map((log: AuditLog) => (
                  <div key={log.id} className="border-l-2 border-primary pl-4 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">
                            {actionLabels[log.action] || log.action}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <div className="text-sm text-foreground">โดย: {log.user.name}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">ยังไม่มีประวัติการดำเนินการ</div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
