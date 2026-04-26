import { useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { Loader2, RefreshCw, Lock, AlertTriangle, Users, ListChecks, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import CollectorColumn from './CollectorColumn';
import PoolColumn from './PoolColumn';
import TransferDialog from './TransferDialog';
import CloseSessionDialog from './CloseSessionDialog';
import { useManagerBoard, useManageActions, useManagerOverview } from '../hooks/useManagerBoard';

export default function ManageDashboard() {
  useDocumentTitle('แบ่งคิวงาน');
  const { data, isLoading } = useManagerBoard();
  const { data: overview } = useManagerOverview();
  const { assign, lock, autoBalance } = useManageActions();
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [closeFor, setCloseFor] = useState<string | null>(null);

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
  const totalAssignments = data.collectors.reduce(
    (sum: number, c: any) => sum + c.assignments.length,
    0,
  );
  const poolTotal = data.pool.items.length + data.pool.escalation.length;
  const isEmpty = totalAssignments === 0 && poolTotal === 0;

  return (
    <div>
      <PageHeader
        title="แบ่งคิวงาน"
        subtitle={
          lockedAt
            ? `Locked ตอน ${lockedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
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
            {!lockedAt && totalAssignments > 0 && (
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

      {/* Portfolio strip */}
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          icon={ListChecks}
          label="ค้างทั้งหมด"
          value={overview?.totalOverdue ?? '-'}
          tone="text-foreground"
          sub="สัญญา"
        />
        <Stat
          icon={AlertTriangle}
          label="Escalation"
          value={overview?.escalationCount ?? '-'}
          tone="text-destructive"
          sub="90+ วัน · นัดผิดเยอะ"
        />
        <Stat
          icon={Users}
          label="พนง.พร้อม"
          value={overview?.activeCollectors ?? '-'}
          tone="text-success"
          sub={overview ? `แนะนำ ${overview.suggestedPerCollector} ราย/คน` : ''}
        />
        <Stat
          icon={Clock}
          label="คิววันนี้"
          value={data.collectors.reduce((s: number, c: any) => s + c.assignments.length, 0)}
          tone="text-primary"
          sub={lockedAt ? 'Locked' : `Pool ${poolTotal}`}
        />
      </div>

      {/* Timeline */}
      <Timeline lockedAt={lockedAt} hasAssignments={totalAssignments > 0} />

      {/* Body */}
      {isEmpty ? (
        <EmptyCTA
          overview={overview}
          onGenerate={() =>
            autoBalance.mutate(undefined, {
              onSuccess: () => toast.success('สร้างคิวแล้ว'),
            })
          }
          generating={autoBalance.isPending}
        />
      ) : (
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
      )}

      <TransferDialog
        fromCollectorId={transferFrom}
        collectors={data.collectors}
        onClose={() => setTransferFrom(null)}
      />
      <CloseSessionDialog collectorId={closeFor} onClose={() => setCloseFor(null)} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: any;
  label: string;
  value: number | string;
  tone: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm px-3 py-2.5 flex items-start gap-2.5">
      <Icon className={`size-4 shrink-0 mt-0.5 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">
          {label}
        </div>
        <div
          className={`font-mono text-base font-bold tabular-nums tracking-tight leading-snug ${tone}`}
        >
          {value}
        </div>
        {sub && (
          <div className="text-2xs text-muted-foreground/70 leading-snug truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}

function Timeline({
  lockedAt,
  hasAssignments,
}: {
  lockedAt: Date | null;
  hasAssignments: boolean;
}) {
  const now = new Date();
  const today6am = new Date();
  today6am.setHours(6, 0, 0, 0);
  const today9am = new Date();
  today9am.setHours(9, 0, 0, 0);

  const past6 = now >= today6am;
  const past9 = now >= today9am;

  const Step = ({
    label,
    sub,
    state,
  }: {
    label: string;
    sub?: string;
    state: 'done' | 'active' | 'pending';
  }) => {
    const dotColor =
      state === 'done'
        ? 'bg-success'
        : state === 'active'
          ? 'bg-primary animate-pulse'
          : 'bg-muted';
    const textColor = state === 'pending' ? 'text-muted-foreground/60' : 'text-foreground';
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className={`block size-2 rounded-full shrink-0 ${dotColor}`} />
        <div className="min-w-0">
          <div
            className={`text-2xs font-semibold uppercase tracking-wider leading-snug ${textColor}`}
          >
            {label}
          </div>
          {sub && (
            <div className="text-2xs text-muted-foreground/60 leading-snug truncate">{sub}</div>
          )}
        </div>
      </div>
    );
  };

  const assignState = past6 ? (hasAssignments ? 'done' : 'active') : 'pending';
  const lockState = lockedAt ? 'done' : past9 ? 'active' : 'pending';

  return (
    <div className="mb-4 rounded-xl border border-border/50 bg-card shadow-sm px-4 py-2.5">
      <div className="flex items-center gap-3 sm:gap-6 overflow-x-auto">
        <Step
          label="06:00 Auto-assign"
          sub={hasAssignments ? 'สร้างคิวแล้ว' : past6 ? 'ยังไม่รัน' : 'รออัตโนมัติ'}
          state={assignState as any}
        />
        <span className="block h-px flex-1 min-w-[20px] bg-border/60" />
        <Step
          label="09:00 Lock"
          sub={
            lockedAt
              ? `Locked ${lockedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
              : past9
                ? 'รอกด Lock'
                : 'ยังเปิดให้ปรับได้'
          }
          state={lockState as any}
        />
        <span className="block h-px flex-1 min-w-[20px] bg-border/60" />
        <Step
          label={now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
          sub="ตอนนี้"
          state="active"
        />
      </div>
    </div>
  );
}

function EmptyCTA({
  overview,
  onGenerate,
  generating,
}: {
  overview: any;
  onGenerate: () => void;
  generating: boolean;
}) {
  const total = overview?.totalOverdue ?? 0;
  const collectors = overview?.activeCollectors ?? 0;
  const perPerson = overview?.suggestedPerCollector ?? 0;
  const escalation = overview?.escalationCount ?? 0;

  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 sm:py-14 text-center">
      <div className="text-base font-semibold leading-snug mb-1">ยังไม่มีคิวงานวันนี้</div>
      <div className="text-sm text-muted-foreground leading-snug mb-6 max-w-md mx-auto">
        ระบบพบ <span className="font-mono font-bold text-foreground tabular-nums">{total}</span>{' '}
        สัญญาค้างชำระ
        {escalation > 0 && (
          <>
            {' '}
            · <span className="text-destructive">Escalation {escalation}</span>
          </>
        )}
        <br />
        พนักงานพร้อมรับงาน{' '}
        <span className="font-mono font-bold text-foreground tabular-nums">{collectors}</span> คน
      </div>

      <Button size="lg" onClick={onGenerate} disabled={generating || total === 0}>
        {generating ? (
          <Loader2 className="size-5 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="size-5 mr-2" />
        )}
        สร้างคิววันนี้ (auto-assign)
      </Button>

      {total === 0 && (
        <div className="text-2xs text-muted-foreground/60 leading-snug mt-3">
          ไม่มีสัญญาค้างชำระ — ไม่มีอะไรต้อง assign
        </div>
      )}

      {collectors > 0 && total > 0 && (
        <div className="text-2xs text-muted-foreground/70 leading-snug mt-3">
          ระบบจะแบ่ง ~{perPerson} ราย/คน ตามกฎ relationship → branch → round-robin
        </div>
      )}
    </div>
  );
}
