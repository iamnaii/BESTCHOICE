import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PieChart, Wallet } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { BalanceHero } from './components/BalanceHero';
import { MonthSummaryCard } from './components/MonthSummaryCard';
import { MovementsTable } from './components/MovementsTable';
import { MovementDialog } from './components/MovementDialog';
import { LimitDialog } from './components/LimitDialog';
import { usePettyCashMovements, usePettyCashSummary, useRecordPettyCash, useSetPettyCashLimit } from './hooks/usePettyCash';
import type { PettyCashMovementKind, PettyCashMovementPayload } from './types';
import { money } from './petty-cash.util';

type OpenDialog = PettyCashMovementKind | 'LIMIT' | null;

const OPERATOR_ROLES = new Set(['OWNER', 'FINANCE_MANAGER']);

/**
 * เงินสดย่อยหน้าร้าน S11-1106 (ข้อ 20.2 · mockup Q9YhHKUhw7kkawVfcu6yZz เจ้าของเคาะ 18/10/2569) — routed at `/shop/petty-cash`
 * ยอดทุกช่องอ่านจากสมุดบัญชี SHOP · เติม/คืนลงบัญชีทันที · วงเงินเป็นค่าตั้งค่า (OWNER)
 */
export default function ShopPettyCashPage() {
  useDocumentTitle('เงินสดย่อยหน้าร้าน');
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canOperate = OPERATOR_ROLES.has(role);
  const canSetLimit = role === 'OWNER';

  const summaryQuery = usePettyCashSummary();
  const summary = summaryQuery.data;
  const [monthPick, setMonthPick] = useState<string | null>(null);
  const month = monthPick ?? summary?.month.key ?? '';
  const movementsQuery = usePettyCashMovements(month);

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const topUp = useRecordPettyCash('TOP_UP');
  const returnToBank = useRecordPettyCash('RETURN');
  const setLimit = useSetPettyCashLimit();

  const submitMovement = (kind: PettyCashMovementKind, payload: PettyCashMovementPayload) => {
    const mutation = kind === 'TOP_UP' ? topUp : returnToBank;
    mutation.mutate(payload, {
      onSuccess: (result) => {
        setDialog(null);
        const verb = kind === 'TOP_UP' ? 'เติม' : 'คืน';
        if (result.duplicate) toast.success(`คำขอนี้บันทึกไปแล้ว — ${verb}เงินสดย่อย ${money(result.movement.amount)} บาท (${result.movement.journalEntryNo ?? '-'})`);
        else toast.success(`${verb}เงินสดย่อย ${money(result.movement.amount)} บาท ลงบัญชีแล้ว · ${result.movement.journalEntryNo ?? '-'}`);
        if (result.periodClosed) {
          toast.error(`งวดบัญชีของวันที่ที่เลือกปิดแล้ว — ลงบัญชีด้วยวันที่บันทึกแทน${result.accountingNotified ? ' และแจ้งฝ่ายบัญชีแล้ว' : ''}`);
        }
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  const submitLimit = (limit: number) =>
    setLimit.mutate(limit, {
      onSuccess: (saved) => {
        setDialog(null);
        toast.success(`ตั้งวงเงินเงินสดย่อย ${money(saved.value)} บาท แล้ว`);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });

  return (
    <div className="min-w-0">
      <PageHeader
        title="เงินสดย่อยหน้าร้าน"
        subtitle="S11-1106 · เติม / คืนเงินสดย่อย · เมนูจ่ายเงินผู้จัดจำหน่ายจ่ายด้วยเงินสดย่อยได้ไม่เกินยอดคงเหลือในหน้านี้"
        icon={<Wallet className="size-5" aria-hidden />}
        action={
          <Button asChild variant="outline">
            <Link to="/shop/accounting"><PieChart className="size-4" aria-hidden />งบทดลอง (SHOP)</Link>
          </Button>
        }
      />

      <QueryBoundary isLoading={summaryQuery.isLoading} isError={summaryQuery.isError}>
        {summary && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-5">
              <BalanceHero
                summary={summary}
                canOperate={canOperate}
                canSetLimit={canSetLimit}
                onTopUp={() => setDialog('TOP_UP')}
                onReturn={() => setDialog('RETURN')}
                onSetLimit={() => setDialog('LIMIT')}
              />
              <MonthSummaryCard month={summary.month} />
            </div>
            <MovementsTable month={month} onMonthChange={setMonthPick} page={movementsQuery.data} loading={movementsQuery.isLoading} />

            {canOperate && (dialog === 'TOP_UP' || dialog === 'RETURN') && (
              <MovementDialog
                kind={dialog}
                open
                summary={summary}
                pending={dialog === 'TOP_UP' ? topUp.isPending : returnToBank.isPending}
                onClose={() => setDialog(null)}
                onSubmit={(payload) => submitMovement(dialog, payload)}
              />
            )}
            {canSetLimit && (
              <LimitDialog open={dialog === 'LIMIT'} limit={summary.limit} balance={summary.balance} pending={setLimit.isPending} onClose={() => setDialog(null)} onSubmit={submitLimit} />
            )}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
