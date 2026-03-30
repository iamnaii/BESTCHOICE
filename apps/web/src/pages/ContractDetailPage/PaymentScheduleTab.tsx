import DataTable from '@/components/ui/DataTable';
import type { Payment } from './types';
import { paymentStatusLabels } from './types';

interface PaymentScheduleTabProps {
  payments: Payment[];
}

const paymentColumns = [
  { key: 'installmentNo', label: 'งวดที่', render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span> },
  { key: 'dueDate', label: 'วันครบกำหนด', render: (p: Payment) => <span className="text-sm">{new Date(p.dueDate).toLocaleDateString('th-TH')}</span> },
  { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: Payment) => <span className="text-sm">{parseFloat(p.amountDue).toLocaleString()} ฿</span> },
  {
    key: 'amountPaid',
    label: 'ยอดที่ชำระ',
    render: (p: Payment) => p.amountPaid ? <span className="text-sm text-green-600">{parseFloat(p.amountPaid).toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>,
  },
  {
    key: 'lateFee',
    label: 'ค่าปรับ',
    render: (p: Payment) => {
      const fee = parseFloat(p.lateFee);
      return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
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
    render: (p: Payment) => p.paidDate ? <span className="text-xs">{new Date(p.paidDate).toLocaleDateString('th-TH')}</span> : <span className="text-xs text-muted-foreground">-</span>,
  },
];

export default function PaymentScheduleTab({ payments }: PaymentScheduleTabProps) {
  return <DataTable columns={paymentColumns} data={payments} emptyMessage="ยังไม่มีตารางผ่อน" />;
}
