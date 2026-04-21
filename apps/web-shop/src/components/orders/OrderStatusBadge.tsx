const LABELS: Record<string, { text: string; color: string }> = {
  DRAFT: { text: 'รอดำเนินการ', color: 'bg-muted text-muted-foreground' },
  PENDING_PAYMENT: { text: 'รอชำระเงิน', color: 'bg-amber-100 text-amber-800' },
  PENDING_BANK_REVIEW: { text: 'รอตรวจสลิป', color: 'bg-amber-100 text-amber-800' },
  PAID: { text: 'ชำระแล้ว', color: 'bg-emerald-100 text-emerald-800' },
  PACKING: { text: 'กำลังแพ็ค', color: 'bg-blue-100 text-blue-800' },
  SHIPPED: { text: 'จัดส่งแล้ว', color: 'bg-blue-100 text-blue-800' },
  DELIVERED: { text: 'ส่งถึงแล้ว', color: 'bg-emerald-100 text-emerald-800' },
  COMPLETED: { text: 'เสร็จสิ้น', color: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { text: 'ยกเลิก', color: 'bg-red-100 text-red-800' },
  REFUNDED: { text: 'คืนเงินแล้ว', color: 'bg-red-100 text-red-800' },
};

export default function OrderStatusBadge({ status }: { status: string }) {
  const l = LABELS[status] ?? LABELS.DRAFT;
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs ${l.color}`}>{l.text}</span>
  );
}
