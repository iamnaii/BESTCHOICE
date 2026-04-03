const workflowLabels: Record<string, { label: string; className: string }> = {
  CREATING: { label: 'กำลังสร้าง', className: 'bg-muted text-foreground' },
  PENDING_REVIEW: { label: 'รอตรวจสอบ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  APPROVED: { label: 'อนุมัติแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  REJECTED: { label: 'ปฏิเสธ', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
};

export default function WorkflowStatusBadge({ status }: { status: string }) {
  const s = workflowLabels[status] || { label: status, className: 'bg-muted text-foreground' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
