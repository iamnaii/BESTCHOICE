import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { contractStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import { formatDateShort } from '@/utils/formatters';
import { formatTHB } from './calc/CalcRows';

/** shape ของ `activeContract` ใน GET /products/:id (products-active-contract.util.ts) */
export interface ActiveContractSummary {
  id: string;
  contractNumber: string;
  status: string;
  createdAt: string;
  customerName: string;
  salespersonName: string;
  sellingPrice: string;
  downPayment: string;
  totalMonths: number;
  monthlyPayment: string;
  paidInstallments: number;
  nextDueDate: string | null;
}

function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[13px] leading-snug ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={`font-mono tabular-nums ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

/**
 * การ์ดสัญญาผ่อน — แทนเครื่องคำนวณเมื่อเครื่องขายผ่อนไปแล้ว (หน้าเดิมยังโชว์เครื่องคำนวณ +
 * ปุ่มทำสัญญาทั้งที่มีสัญญาแล้ว — ปัญหาข้อ ⑦ ใน spec)
 */
export default function ContractSummaryCard({ contract }: { contract: ActiveContractSummary }) {
  const statusCfg = getStatusBadgeProps(contract.status, contractStatusMap);
  const pct =
    contract.totalMonths > 0
      ? Math.min(100, Math.round((contract.paidInstallments / contract.totalMonths) * 100))
      : 0;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>สัญญาผ่อน</CardTitle>
        <Badge variant={statusCfg.variant} appearance={statusCfg.appearance} size="sm">
          {statusCfg.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground leading-snug">เลขที่สัญญา</div>
            <div className="font-mono text-[15px] font-semibold tabular-nums">{contract.contractNumber}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground leading-snug">ลูกค้า</div>
            <div className="text-sm font-medium leading-snug">{contract.customerName || '—'}</div>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="space-y-2">
          <Row label="ขายเมื่อ" value={formatDateShort(contract.createdAt)} />
          <Row label="ราคาผ่อน" value={formatTHB(Number(contract.sellingPrice))} />
          <Row label="ดาวน์" value={formatTHB(Number(contract.downPayment))} />
          <Row label="งวด" value={`${contract.totalMonths} งวด`} />
          <Row label="งวดละ" value={formatTHB(Number(contract.monthlyPayment))} bold valueClass="text-primary" />
          <Row label="พนักงานขาย" value={contract.salespersonName || '—'} />
        </div>

        <div className="space-y-2 rounded-lg bg-muted/45 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3 text-[13px] leading-snug">
            <span>
              ชำระแล้ว {contract.paidInstallments} / {contract.totalMonths} งวด
            </span>
            <span className="text-muted-foreground">
              {contract.nextDueDate ? `งวดถัดไป ${formatDateShort(contract.nextDueDate)}` : 'ผ่อนครบแล้ว'}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <Link
          to={`/contracts/${contract.id}`}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-input text-sm font-medium text-primary hover:bg-muted/50 leading-snug"
        >
          ประวัติการชำระ / เปิดสัญญา
          <ExternalLink className="size-4" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
