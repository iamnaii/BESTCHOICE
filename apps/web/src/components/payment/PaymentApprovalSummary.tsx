import type { PaymentApprovalAction } from '@/hooks/usePaymentApprovalRequests';
import { formatNumberDecimal } from '@/utils/formatters';

/** Only show reviewable payment fields; do not dump arbitrary request metadata. */
export function paymentApprovalSummary(
  payload: Record<string, unknown>,
  action?: PaymentApprovalAction,
) {
  const rows: { label: string; value: string }[] = [];
  const money = (key: string, label: string) => {
    const value = payload[key];
    if (
      (typeof value === 'number' || typeof value === 'string') &&
      value !== '' &&
      Number.isFinite(Number(value))
    ) {
      rows.push({ label, value: `${formatNumberDecimal(Number(value))} ฿` });
    }
  };
  money('amount', action === 'VOID_RECEIPT' ? 'ยอดใบเสร็จที่ยกเลิก' : 'ยอดรับชำระ');
  money('lateFeeWaiverAmount', 'อนุโลมค่าปรับ');
  money('additionalLateFee', 'ค่าปรับเพิ่มครั้งนี้');
  money('totalPayoff', 'ยอดปิดสัญญา');
  money('discountAmount', 'ส่วนลดปิดสัญญา');
  money('unpaidLateFees', 'ค่าปรับคงเหลือ');
  if (typeof payload.remainingMonths === 'number')
    rows.push({ label: 'จำนวนงวดคงเหลือ', value: String(payload.remainingMonths) });
  if (Array.isArray(payload.receiptNumbers)) {
    const numbers = payload.receiptNumbers.filter(
      (value): value is string => typeof value === 'string',
    );
    if (numbers.length) rows.push({ label: 'ใบเสร็จที่ยกเลิก', value: numbers.join(', ') });
  }
  if (typeof payload.installmentNo === 'number')
    rows.push({ label: 'งวดที่', value: String(payload.installmentNo) });
  if (typeof payload.discountPct === 'number')
    rows.push({ label: 'ส่วนลดดอกเบี้ย', value: `${payload.discountPct}%` });
  const methods: Record<string, string> = {
    CASH: 'เงินสด',
    BANK_TRANSFER: 'โอนธนาคาร',
    QR_EWALLET: 'QR',
    CARD: 'บัตร',
  };
  if (typeof payload.paymentMethod === 'string')
    rows.push({ label: 'ช่องทาง', value: methods[payload.paymentMethod] ?? payload.paymentMethod });
  if (typeof payload.depositAccountCode === 'string')
    rows.push({ label: 'บัญชีรับเงิน', value: payload.depositAccountCode });
  const paidDate = payload.paidDate ?? payload.paymentDate;
  if (typeof paidDate === 'string' && paidDate)
    rows.push({ label: 'วันที่รับเงิน', value: paidDate });
  return rows;
}

export default function PaymentApprovalSummary({
  payload,
  action,
}: {
  payload: Record<string, unknown>;
  action?: PaymentApprovalAction;
}) {
  const rows = paymentApprovalSummary(payload, action);
  const evidence = payload.slipUrl ?? payload.evidenceUrl;
  const evidenceUrl = typeof evidence === 'string' && /^https:\/\//i.test(evidence) ? evidence : null;
  if (rows.length === 0 && !evidenceUrl) return null;
  return (
    <dl className="grid gap-1 text-sm leading-snug">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono text-right break-words min-w-0">{value}</dd>
        </div>
      ))}
      {evidenceUrl && (
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">หลักฐานรับเงิน</dt>
          <dd><a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">เปิดสลิป / หลักฐาน</a></dd>
        </div>
      )}
    </dl>
  );
}
