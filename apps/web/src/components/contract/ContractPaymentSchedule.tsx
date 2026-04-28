import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Receipt } from 'lucide-react';
import api from '@/lib/api';
import PaymentProgressOverview from '@/components/contract/PaymentTimeline';
import { formatNumber, formatDateMedium, formatDateTime } from '@/utils/formatters';

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

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  installmentNo: number | null;
  paymentId: string | null;
  amount: string;
  paidDate: string;
  paymentMethod: string | null;
  receiptType: string;
}

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-secondary text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

const paymentMethodLabels: Record<string, string> = {
  TRANSFER: 'โอน',
  CASH: 'เงินสด',
  QR: 'QR',
  CREDIT_CARD: 'บัตรเครดิต',
  DEBIT_CARD: 'บัตรเดบิต',
};

interface ContractPaymentScheduleProps {
  contractId: string;
  payments: Payment[];
}

export default function ContractPaymentSchedule({ contractId, payments }: ContractPaymentScheduleProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: receipts = [] } = useQuery<ReceiptRow[]>({
    queryKey: ['contract-receipts', contractId],
    queryFn: () => api.get(`/receipts/contract/${contractId}`).then((r) => r.data),
    staleTime: 30_000,
  });

  // Group by installmentNo when available; fall back to paymentId matching (older receipts have installmentNo=null)
  const receiptsByPaymentId = receipts.reduce<Record<string, ReceiptRow[]>>((acc, r) => {
    if (r.paymentId) { (acc[r.paymentId] ??= []).push(r); }
    return acc;
  }, {});

  const receiptsByInstallment = receipts.reduce<Record<number, ReceiptRow[]>>((acc, r) => {
    if (r.installmentNo != null) {
      (acc[r.installmentNo] ??= []).push(r);
    }
    return acc;
  }, {});

  const toggle = (no: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(no)) { next.delete(no); } else { next.add(no); }
      return next;
    });

  return (
    <>
      <PaymentProgressOverview payments={payments} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">งวดที่</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">วันครบกำหนด</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">ยอดที่ต้องชำระ</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">ชำระแล้ว</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">ค่าปรับ</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">สถานะ</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">วันที่ชำระ</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const rows = receiptsByInstallment[p.installmentNo] ?? receiptsByPaymentId[p.id] ?? [];
              const isOpen = expanded.has(p.installmentNo);
              const hasReceipts = rows.length > 0;
              const amountDue = parseFloat(p.amountDue) + parseFloat(p.lateFee);
              const amountPaid = parseFloat(p.amountPaid ?? '0');
              const remaining = amountDue - amountPaid;
              const ps = paymentStatusLabels[p.status] ?? { label: p.status, className: 'bg-secondary' };
              const lateFee = parseFloat(p.lateFee);

              return (
                <>
                  <tr
                    key={p.id}
                    className={`border-b border-border transition-colors ${hasReceipts ? 'cursor-pointer hover:bg-muted/30' : ''} ${isOpen ? 'bg-muted/20' : ''}`}
                    onClick={() => hasReceipts && toggle(p.installmentNo)}
                  >
                    <td className="px-4 py-3 font-medium">{p.installmentNo}</td>
                    <td className="px-4 py-3 text-sm">{formatDateMedium(p.dueDate)}</td>
                    <td className="px-4 py-3 text-sm">{formatNumber(p.amountDue)} บาท</td>
                    <td className="px-4 py-3">
                      {p.amountPaid ? (
                        p.status === 'PARTIALLY_PAID' ? (
                          <div className="flex flex-col gap-1 min-w-[120px]">
                            <span className="text-sm font-medium text-warning">
                              {formatNumber(amountPaid)} / {formatNumber(amountDue)} บาท
                            </span>
                            <div className="h-1 rounded-full bg-border overflow-hidden">
                              <div
                                className="h-full rounded-full bg-warning transition-all"
                                style={{ width: `${Math.min(100, (amountPaid / amountDue) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-success">{formatNumber(p.amountPaid)} บาท</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {lateFee > 0 ? (
                        <span className="text-destructive">{formatNumber(lateFee)} บาท</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ps.className}`}>
                        {ps.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.paidDate ? formatDateMedium(p.paidDate) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {hasReceipts && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggle(p.installmentNo); }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/8 px-2 py-1 rounded transition-colors"
                        >
                          <Receipt className="h-3 w-3" />
                          {rows.length} รายการ
                          <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr key={`${p.id}-detail`} className="border-b border-border bg-muted/10">
                      <td colSpan={8} className="px-4 pb-3 pt-0">
                        <div className="ml-6 mt-2 rounded-md border border-border overflow-hidden">
                          <div className="grid grid-cols-[1fr_1fr_90px_80px] gap-0 bg-muted/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <span>เลขใบเสร็จ</span>
                            <span>วันที่ชำระ</span>
                            <span className="text-right">ยอด</span>
                            <span>ช่องทาง</span>
                          </div>
                          {rows.map((r, idx) => (
                            <div
                              key={r.id}
                              className={`grid grid-cols-[1fr_1fr_90px_80px] gap-0 px-3 py-2 items-center text-xs ${idx < rows.length - 1 ? 'border-b border-border' : ''} hover:bg-muted/20 transition-colors`}
                            >
                              <span className="font-mono text-[11px] text-primary">{r.receiptNumber}</span>
                              <span className="text-muted-foreground">{formatDateTime(r.paidDate)}</span>
                              <span className="text-right font-semibold">{formatNumber(r.amount)} บาท</span>
                              <span>
                                <span className="inline-block bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 rounded">
                                  {paymentMethodLabels[r.paymentMethod ?? ''] ?? r.paymentMethod ?? '—'}
                                </span>
                              </span>
                            </div>
                          ))}
                          {p.status === 'PARTIALLY_PAID' && (
                            <div className="flex items-center justify-between px-3 py-2 bg-warning/5 border-t border-border">
                              <span className="text-xs text-warning font-medium">
                                ยังขาดอีก {formatNumber(remaining)} บาท
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
