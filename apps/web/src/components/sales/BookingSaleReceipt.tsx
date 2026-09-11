import { Link } from 'react-router';
import { formatThaiDateTime } from '@/lib/date';

export interface BookingSaleReceiptData {
  bookingId: string; bookingNumber: string; depositAmount: string | null;
  depositMethod: string | null; depositPaidAt: string | null;
  additionalAmount: string | null; additionalMethod: string | null;
  convertedAt: string | null; totalReceived: string | null; needsReview: boolean;
}

const methods: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', QR_EWALLET: 'QR/E-Wallet' };
const money = (value: string | null) => value == null ? 'ยังไม่ระบุ' : `${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;

export function BookingSaleReceipt({ receipt }: { receipt: BookingSaleReceiptData }) {
  return <section aria-label="การรับเงินจากใบจอง" className="rounded-lg border border-border p-4 space-y-3 leading-snug">
    <h3 className="font-semibold">การรับเงินจากใบจอง</h3>
    <Link className="inline-flex min-h-11 items-center text-primary underline break-all" to={`/bookings?bookingId=${encodeURIComponent(receipt.bookingId)}`}>เปิดใบจอง {receipt.bookingNumber}</Link>
    <dl className="space-y-3 tabular-nums">
      <div><div className="flex justify-between gap-3"><dt>มัดจำที่รับไว้แล้ว</dt><dd>{money(receipt.depositAmount)}</dd></div>
        <p className="text-xs text-muted-foreground mt-1">{methods[receipt.depositMethod ?? ''] ?? 'ยังไม่ระบุวิธีรับ'} · {receipt.depositPaidAt ? formatThaiDateTime(receipt.depositPaidAt, 'Asia/Bangkok') : 'ยังไม่ระบุวันรับ'}</p></div>
      <div><div className="flex justify-between gap-3"><dt>รับเพิ่มเมื่อขาย</dt><dd>{money(receipt.additionalAmount)}</dd></div>
        {receipt.additionalAmount != null && Number(receipt.additionalAmount) > 0 && <p className="text-xs text-muted-foreground mt-1">{methods[receipt.additionalMethod ?? ''] ?? 'ยังไม่ระบุวิธีรับ'} · {receipt.convertedAt ? formatThaiDateTime(receipt.convertedAt, 'Asia/Bangkok') : 'ยังไม่ระบุวันรับ'}</p>}
        {receipt.additionalAmount === '0.00' && <p className="text-xs text-muted-foreground mt-1">ชำระครบตั้งแต่ใบจอง</p>}</div>
      <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>รวมรับชำระ</dt><dd>{money(receipt.totalReceived)}</dd></div>
    </dl>
    {receipt.needsReview && <p className="border-l-2 border-warning pl-3 text-sm text-foreground">หลักฐานรับเงินเดิมไม่ครบหรือยอดไม่ตรงกัน กรุณาตรวจใบจองและหลักฐานรับเงินก่อนยืนยันยอด</p>}
  </section>;
}
