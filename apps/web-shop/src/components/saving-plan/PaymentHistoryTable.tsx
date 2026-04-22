import type { SavingPlanPayment } from '../../types/saving-plan';

interface Props {
  payments: SavingPlanPayment[];
}

export default function PaymentHistoryTable({ payments }: Props) {
  if (payments.length === 0) {
    return <div className="text-muted-foreground text-sm leading-snug">ยังไม่มีการชำระ</div>;
  }
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm leading-snug">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3">วันที่</th>
            <th className="p-3">จำนวน</th>
            <th className="p-3">ช่องทาง</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="p-3">{new Date(p.paidAt).toLocaleDateString('th-TH')}</td>
              <td className="p-3 font-semibold">฿{Number(p.amount).toLocaleString()}</td>
              <td className="p-3 text-muted-foreground">{p.paymentMethod}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
