const workflowLabels: Record<string, { label: string; className: string }> = {
  CREATING: { label: 'กำลังสร้าง', className: 'bg-gray-100 text-gray-700' },
  PENDING_REVIEW: { label: 'รอตรวจสอบ', className: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ปฏิเสธ', className: 'bg-red-100 text-red-700' },
};

export default function WorkflowStatusBadge({ status }: { status: string }) {
  const s = workflowLabels[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
