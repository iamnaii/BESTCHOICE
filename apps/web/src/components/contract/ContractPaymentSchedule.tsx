import DataTable from '@/components/ui/DataTable';
import PaymentProgressOverview from '@/components/contract/PaymentTimeline';
import { formatNumber, formatDateMedium } from '@/utils/formatters';

interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string | null;
  lateFee: string;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-secondary text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

interface ContractPaymentScheduleProps {
  payments: Payment[];
}

export default function ContractPaymentSchedule({ payments }: ContractPaymentScheduleProps) {
  const paymentColumns = [
    { key: 'installmentNo', label: 'งวดที่', render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: Payment) => <span className="text-sm">{formatDateMedium(p.dueDate)}</span> },
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: Payment) => <span className="text-sm">{formatNumber(p.amountDue)} บาท</span> },
    {
      key: 'amountPaid',
      label: 'ยอดที่ชำระ',
      render: (p: Payment) => p.amountPaid ? <span className="text-sm text-success">{formatNumber(p.amountPaid)} บาท</span> : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: Payment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? <span className="text-sm text-destructive">{formatNumber(fee)} บาท</span> : <span className="text-xs text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Payment) => {
        const ps = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-secondary' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ps.className}`}>{ps.label}</span>;
      },
    },
    {
      key: 'paidDate',
      label: 'วันที่ชำระ',
      render: (p: Payment) => p.paidDate ? <span className="text-xs">{formatDateMedium(p.paidDate)}</span> : <span className="text-xs text-muted-foreground">-</span>,
    },
  ];

  return (
    <>
      <PaymentProgressOverview payments={payments} />
      <DataTable columns={paymentColumns} data={payments} emptyMessage="ยังไม่มีตารางผ่อน" />
    </>
  );
}
