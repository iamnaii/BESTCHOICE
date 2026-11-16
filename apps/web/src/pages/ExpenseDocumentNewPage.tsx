import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
import { PAYROLL_ROLE_NOTICE, canManagePayroll } from '@/components/expense-form-v4/payroll-system/payroll-roles';
import type { DocType } from '@/components/expense-form-v4/types';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';

// ?type= from the "สร้างเอกสารใหม่" dropdown on ExpensesPage. Previously the
// param was silently dropped and the form always opened on EXPENSE_SAMEDAY —
// the user had to click the doc-type chip a second time.
const TYPE_PARAM_MAP: Record<string, DocType> = {
  PR: 'PAYROLL',
  CN: 'CREDIT_NOTE',
  SE: 'VENDOR_SETTLEMENT',
};

export default function ExpenseDocumentNewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialDocType = TYPE_PARAM_MAP[searchParams.get('type') ?? ''];
  // R3-2 — ?edit=<docId> เปิดโหมดแก้ไขร่างใบเงินเดือน (PATCH แทน POST)
  const editDocId = searchParams.get('edit') ?? undefined;
  const branches = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  // ?branch= จากตัวกรองของหน้ารายการ — ใช้เฉพาะสาขาที่ผู้ใช้เห็นในรายการ
  const requestedBranch = searchParams.get('branch') ?? '';
  const waitingForBranches = !!requestedBranch && branches.isPending;
  const requestedIsVisible = !!requestedBranch && !!branches.data?.some((b) => b.id === requestedBranch);
  const branchId = waitingForBranches
    ? undefined
    : (requestedIsVisible ? requestedBranch : '') || user?.branchId || branches.data?.[0]?.id;
  const branchName = branches.data?.find((b) => b.id === branchId)?.name;
  // กลับหน้ารายการพร้อมตัวกรองที่ผู้ใช้ตั้งไว้ (หน้ารายการส่งมาใน router state)
  const location = useLocation();
  const listPath = `/expenses${(location.state as { listSearch?: string } | null)?.listSearch ?? ''}`;

  if (!branchId) {
    return (
      <div className="space-y-6">
        <PageHeader title="สร้างค่าใช้จ่าย" onBack={() => navigate(listPath)} />
        <QueryBoundary
          isLoading={branches.isPending}
          isError={branches.isError}
          error={branches.error}
          errorTitle="โหลดสาขาไม่สำเร็จ"
          onRetry={() => void branches.refetch()}
        >
          <div className="rounded-xl border border-border bg-card p-6 text-center" role="status">
            <p className="font-medium">ยังไม่มีสาขาที่ใช้สร้างค่าใช้จ่ายได้</p>
            <p className="mt-2 text-sm text-muted-foreground">ให้ผู้ดูแลตรวจสอบสาขาและสิทธิ์ของบัญชี แล้วลองโหลดใหม่</p>
            <Button className="mt-4 min-h-11" variant="outline" onClick={() => void branches.refetch()}>โหลดใหม่</Button>
          </div>
        </QueryBoundary>
      </div>
    );
  }

  // แก้ไขใบเงินเดือน (?edit=) — ผู้จัดการสาขาทำไม่ได้ (server ตอบ 403 อยู่แล้ว) บอกตรง ๆ แทนฟอร์มที่บันทึกไม่ได้
  if (editDocId && !canManagePayroll(user?.role)) {
    return (
      <div className="space-y-6">
        <PageHeader title="แก้ไขใบเงินเดือน" onBack={() => navigate(listPath)} />
        <div className="rounded-xl border border-border bg-card p-6 text-center" role="status">
          <p className="font-medium leading-snug">{PAYROLL_ROLE_NOTICE}</p>
          <p className="mt-2 text-sm text-muted-foreground leading-snug">เปิดดูใบและพิมพ์สลิปได้ที่หน้ารายละเอียดของใบ</p>
          <Button className="mt-4 min-h-11" variant="outline" onClick={() => navigate(`/expenses/${editDocId}`)}>เปิดใบ</Button>
        </div>
      </div>
    );
  }

  return (
    <ExpenseFormV4
      key={branchId}
      branchId={branchId}
      branchName={branchName}
      initialDocType={editDocId ? 'PAYROLL' : initialDocType}
      editDocId={editDocId}
      onClose={() => navigate(listPath)}
      onSaved={() => navigate(listPath)}
      // Payroll D4 — "บันทึกร่าง + คิดยอด" อยู่ในหน้าแก้ไขของร่างที่เพิ่งบันทึก (รีเฟรชแล้วไม่สร้างใบซ้ำ)
      // คงสาขาที่เลือกและ router state (ตัวกรองรายการ) ไว้ ไม่งั้นสาขาของหน้าเปลี่ยน → ฟอร์มรีเมานต์ แล้วข้อความแจ้งหาย
      onDraftSaved={(id) => {
        const next = new URLSearchParams(searchParams);
        next.delete('type');
        next.set('edit', id);
        navigate({ pathname: '/expenses/new', search: `?${next.toString()}` }, { replace: true, state: location.state });
      }}
    />
  );
}
