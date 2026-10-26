import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CalendarClock } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useUiFlags } from '@/hooks/useUiFlags';
import { useRecurringBillActions, useRecurringBills, type RecurringBillRow } from '@/hooks/useRecurringBills';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import { MonthHeader } from './components/MonthHeader';
import { SummaryChips } from './components/SummaryChips';
import { BillsTable } from './components/BillsTable';
import { MarkPaidDialog } from './components/MarkPaidDialog';
import { SkipDialog } from './components/SkipDialog';
import { currentMonthKey } from './components/labels';

/**
 * หน้า "บิลประจำ" (ก้อน 6 · D5) — หนึ่งเดือน ทุกสถานะในตารางเดียว (mockup กระดาน 1)
 * ระบบสร้างได้แค่ร่าง: คนเป็นผู้โพสต์/จ่าย · "จ่ายแล้ว" ด้วยมือ = จ่ายนอกระบบ ใบยังต้องลงบัญชี
 * ?month=YYYY-MM — การ์ดบนหน้ารายการโปรดลิงก์มาพร้อมเดือนของงวดถัดไป
 */
export default function RecurringBillsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { templatesEnabled } = useUiFlags();
  const { user } = useAuth();
  const isBranchManager = user?.role === 'BRANCH_MANAGER';
  const requested = searchParams.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentMonthKey();
  const [branchId, setBranchId] = useState('');
  const [markPaidRow, setMarkPaidRow] = useState<RecurringBillRow | null>(null);
  const [skipRow, setSkipRow] = useState<RecurringBillRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: templatesEnabled && !isBranchManager,
  });
  const { data, isLoading, isError, error, refetch } = useRecurringBills(month, branchId || undefined, templatesEnabled);
  const actions = useRecurringBillActions();

  if (!templatesEnabled) {
    return (
      <EmptyState
        icon={Ban}
        title="ระบบรายการโปรด/บิลประจำถูกปิดใช้งาน"
        description="ผู้ดูแลปิดระบบรายการโปรด (templates_enabled) ไว้ — บิลประจำใช้แม่แบบเดียวกัน เปิดใหม่ได้ที่หน้าตั้งค่า"
        actionLabel="กลับหน้าค่าใช้จ่าย"
        onAction={() => navigate('/expenses')}
      />
    );
  }

  const setMonth = (next: string) => setSearchParams({ month: next });
  // ตั้ง/แก้บิลประจำทำที่หน้ารายการโปรด (Task 10 จะเปิดกล่องตรงนี้แทน)
  const goCreate = () => navigate('/expenses/favorites');

  async function run(id: string, work: () => Promise<unknown>, done: string) {
    setBusyId(id);
    try {
      await work();
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err));
      return false;
    } finally {
      setBusyId(null);
    }
  }
  const confirmMarkPaid = async (value: { note?: string; paidAt: string }) => {
    const row = markPaidRow;
    if (!row?.occurrenceId) return;
    const ok = await run(
      row.occurrenceId,
      () => actions.markPaid.mutateAsync({ id: row.occurrenceId!, note: value.note, paidAt: value.paidAt, reopenFirst: row.status === 'SKIPPED' }),
      `บันทึกว่าจ่าย ${row.templateName} แล้ว`,
    );
    if (ok) setMarkPaidRow(null);
  };
  const confirmSkip = async (reason: string) => {
    const row = skipRow;
    if (!row?.occurrenceId) return;
    const ok = await run(row.occurrenceId, () => actions.skip.mutateAsync({ id: row.occurrenceId!, reason }), `ข้ามงวด ${row.periodLabel} ของ ${row.templateName} แล้ว`);
    if (ok) setSkipRow(null);
  };
  const reopen = (row: RecurringBillRow) => {
    if (row.occurrenceId) void run(row.occurrenceId, () => actions.reopen.mutateAsync(row.occurrenceId!), `เปิดงวด ${row.periodLabel} ของ ${row.templateName} ใหม่แล้ว`);
  };
  const createDraft = (row: RecurringBillRow) => {
    if (row.occurrenceId) void run(row.occurrenceId, () => actions.createDraft.mutateAsync(row.occurrenceId!), `สร้างร่างใหม่ให้ ${row.templateName} แล้ว`);
  };

  return (
    <div>
      <MonthHeader
        month={month}
        onMonthChange={setMonth}
        branchId={branchId}
        onBranchChange={setBranchId}
        branches={branches}
        showBranch={!isBranchManager}
        onCreate={goCreate}
      />
      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">กำลังโหลด…</p>}
      {isError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          โหลดบิลประจำไม่สำเร็จ — {getErrorMessage(error)}
          <Button variant="outline" size="sm" className="ml-3" onClick={() => void refetch()}>ลองใหม่</Button>
        </div>
      )}
      {data && (
        <>
          <SummaryChips summary={data.summary} />
          {data.rows.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="ยังไม่มีบิลประจำในเดือนนี้"
              description="ตั้งบิลประจำจากหน้ารายการโปรด แล้วระบบจะสร้างร่างใบรายจ่ายและเตือนให้ก่อนครบกำหนด"
              actionLabel="+ บิลประจำ"
              onAction={goCreate}
            />
          ) : (
            <BillsTable
              rows={data.rows}
              busyId={busyId}
              onMarkPaid={setMarkPaidRow}
              onSkip={setSkipRow}
              onReopen={reopen}
              onCreateDraft={createDraft}
              onEditBill={goCreate}
            />
          )}
        </>
      )}
      <MarkPaidDialog row={markPaidRow} pending={actions.markPaid.isPending} onClose={() => setMarkPaidRow(null)} onConfirm={confirmMarkPaid} />
      <SkipDialog row={skipRow} pending={actions.skip.isPending} onClose={() => setSkipRow(null)} onConfirm={confirmSkip} />
    </div>
  );
}
