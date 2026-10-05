import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLatestSearchParams } from '@/hooks/useLatestSearchParams';
import api, { getErrorMessage } from '@/lib/api';
import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import BookingDetailSheet from './components/BookingDetailSheet';
import BookingEmptyState from './components/BookingEmptyState';
import BookingFilterBar from './components/BookingFilterBar';
import BookingKpiCards from './components/BookingKpiCards';
import BookingTable from './components/BookingTable';
import CancelBookingDialog from './components/CancelBookingDialog';
import CreateBookingDialog from './components/CreateBookingDialog';
import { useBookingClock } from './hooks/useBookingClock';
import { useBookingsQuery } from './hooks/useBookingsQuery';
import type { Booking } from './types';

export default function BookingsPage() {
  useDocumentTitle('การจอง / มัดจำ');
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role ?? '';
  const canCreate = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(role);
  const canMutate = canCreate;
  const canDelete = ['OWNER', 'BRANCH_MANAGER'].includes(role);
  const canAcknowledgeDamage = ['OWNER', 'FINANCE_MANAGER'].includes(role);

  const q = useBookingsQuery();
  const now = useBookingClock();
  const [searchParams, updateParams] = useLatestSearchParams();
  const detailId = searchParams.get('bookingId');
  const [autoCollect, setAutoCollect] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  const openDetail = (id: string, collect = false) => {
    setAutoCollect(collect);
    updateParams((next) => next.set('bookingId', id));
  };
  const closeDetail = () => {
    setAutoCollect(false);
    updateParams((next) => next.delete('bookingId'));
  };
  const onChanged = () => {
    void invalidateSalesQueries(qc, 'booking-updated');
    void qc.invalidateQueries({ queryKey: ['bookings-summary'] });
  };

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/bookings/${id}/cancel`, { cancelReason: reason }),
    onSuccess: () => {
      toast.success(
        cancelTarget?.status === 'PAID' ? 'ยกเลิกใบจองและคืนมัดจำแล้ว' : 'ยกเลิกใบจองแล้ว',
      );
      setCancelTarget(null);
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rows = q.listResult?.data ?? [];
  // สรุปยังไม่มา (หน้าแรกไม่มีตัวกรอง/ลิงก์ลึก) → ยังไม่รู้ว่าเป็นหน้าว่างหรือรายการ: แสดงโครงรอแทน ไม่กระพริบ
  const settling = q.summaryLoading && !q.hasActiveFilters && !detailId;
  const isFirstUse = !!q.summary && q.summary.total === 0 && !q.hasActiveFilters;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="การจอง / มัดจำ"
        subtitle="รับมัดจำเครื่องไว้ให้ลูกค้า แล้วปิดเป็นใบขายเมื่อลูกค้ามารับ"
        action={
          canCreate && !isFirstUse ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> สร้างใบจอง
            </Button>
          ) : null
        }
      />

      {settling ? (
        <div role="status" aria-busy="true" aria-label="กำลังโหลดข้อมูลใบจอง" className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isFirstUse ? (
        <BookingEmptyState canCreate={canCreate} onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <BookingKpiCards summary={q.summary} activeKey={q.activeKpiKey} onPick={q.setFilters} />
          <Card>
            <CardContent className="p-0">
              <div className="border-b border-border px-4 py-3">
                <BookingFilterBar
                  search={q.search}
                  setSearch={q.setSearch}
                  view={q.view}
                  status={q.status}
                  branchId={q.branchId}
                  from={q.from}
                  to={q.to}
                  branches={q.branches}
                  canFilterBranch={q.canFilterBranch}
                  setFilters={q.setFilters}
                />
              </div>
              <QueryBoundary
                isLoading={q.isLoading}
                isError={q.isError}
                error={q.error}
                errorTitle="โหลดรายการใบจองไม่สำเร็จ"
                onRetry={q.refetch}
              >
                <BookingTable
                  rows={rows}
                  total={q.listResult?.total ?? 0}
                  page={q.page}
                  onPageChange={q.setPage}
                  sort={q.sort}
                  onSortChange={q.setSort}
                  isLoading={q.isLoading}
                  nowMs={now}
                  actions={{
                    onOpen: (b) => openDetail(b.id),
                    onCollectDeposit: (b) => openDetail(b.id, true),
                    onCancel: setCancelTarget,
                    canMutate,
                  }}
                  hasActiveFilters={q.hasActiveFilters}
                  onClearFilters={q.clearFilters}
                />
              </QueryBoundary>
            </CardContent>
          </Card>
        </>
      )}

      {createOpen && (
        <CreateBookingDialog
          open
          onClose={() => setCreateOpen(false)}
          onSaved={(booking, { collectDeposit }) => {
            onChanged();
            setCreateOpen(false);
            if (collectDeposit) openDetail(booking.id, true);
          }}
        />
      )}
      {detailId && (
        <BookingDetailSheet
          bookingId={detailId}
          canMutate={canMutate}
          canDelete={canDelete}
          canAcknowledgeDamage={canAcknowledgeDamage}
          autoCollectDeposit={autoCollect}
          onClose={closeDetail}
          onChanged={onChanged}
        />
      )}
      <CancelBookingDialog
        booking={cancelTarget}
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={(reason) => cancelTarget && cancelMut.mutate({ id: cancelTarget.id, reason })}
        loading={cancelMut.isPending}
      />
    </div>
  );
}
