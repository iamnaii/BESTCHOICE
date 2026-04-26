import { useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { Loader2, RefreshCw, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import CollectorColumn from './CollectorColumn';
import PoolColumn from './PoolColumn';
import { useManagerBoard, useManageActions } from '../hooks/useManagerBoard';

export default function ManageDashboard() {
  useDocumentTitle('แบ่งคิวงาน');
  const { data, isLoading } = useManagerBoard();
  const { assign, lock, autoBalance } = useManageActions();
  const [, setTransferFrom] = useState<string | null>(null);
  const [, setCloseFor] = useState<string | null>(null);

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const assignmentId = String(e.active.id);
    const target = String(e.over.id);
    const toCollectorId = target === '__pool__' ? null : target;
    assign.mutate(
      { assignmentId, toCollectorId },
      {
        onSuccess: () => toast.success('ย้ายสำเร็จ'),
        onError: () => toast.error('ย้ายไม่สำเร็จ'),
      },
    );
  };

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="แบ่งคิวงาน" subtitle="กำหนดงานเก็บเงินรายวัน" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const lockedAt = data.lockedAt ? new Date(data.lockedAt) : null;

  return (
    <div>
      <PageHeader
        title="แบ่งคิวงาน"
        subtitle={
          lockedAt
            ? `Locked ตอน ${lockedAt.toLocaleTimeString('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : 'Auto-assigned 06:00 — Lock 09:00'
        }
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                autoBalance.mutate(undefined, {
                  onSuccess: () => toast.success('Re-balance เรียบร้อย'),
                })
              }
              disabled={autoBalance.isPending}
            >
              <RefreshCw className="size-4 mr-1.5" />
              Auto-balance ใหม่
            </Button>
            {!lockedAt && (
              <Button
                onClick={() =>
                  lock.mutate(undefined, {
                    onSuccess: () => toast.success('Lock & ส่งคิวเรียบร้อย'),
                  })
                }
                disabled={lock.isPending}
              >
                <Lock className="size-4 mr-1.5" />
                Lock & ส่งคิว
              </Button>
            )}
          </div>
        }
      />

      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {data.collectors.map((c: any) => (
            <CollectorColumn
              key={c.id}
              collector={c}
              locked={!!lockedAt}
              onTransferClick={lockedAt ? () => setTransferFrom(c.id) : undefined}
              onCloseSessionClick={lockedAt ? () => setCloseFor(c.id) : undefined}
            />
          ))}
          <PoolColumn items={data.pool.items} escalation={data.pool.escalation} />
        </div>
      </DndContext>

      {/* TODO Task 15: TransferDialog + CloseSessionDialog */}
    </div>
  );
}
