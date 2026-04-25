import { useMemo, useState } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { Shuffle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import QueryBoundary from '@/components/QueryBoundary';
import { useWorkloadGrid, type WorkloadContract } from '../hooks/useWorkloadGrid';

const UNASSIGNED_ID = '__unassigned__';

const bahtFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });

interface ColumnData {
  collectorId: string;
  name: string;
  contracts: WorkloadContract[];
}

/**
 * OWNER-only workload redistribution grid (P2 Task 9 / E5).
 *
 * Each column = a collector (plus a synthetic "Unassigned" column at the
 * left). Cards are draggable between columns; on drop we POST
 * /overdue/:id/assign with the new collector id. Shift+click selects a
 * range of cards within the same column for a multi-drop. The
 * Auto-balance button round-robins ALL contracts across the available
 * collectors for a quick reset.
 */
export default function WorkloadGrid() {
  const {
    contracts,
    collectors,
    isLoading,
    isError,
    error,
    refetch,
    reassignMany,
    autoBalance,
  } = useWorkloadGrid();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedByCol, setLastSelectedByCol] = useState<Record<string, string>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [autoBalanceConfirmOpen, setAutoBalanceConfirmOpen] = useState(false);

  const columns: ColumnData[] = useMemo(() => {
    const byId = new Map<string, ColumnData>();
    byId.set(UNASSIGNED_ID, {
      collectorId: UNASSIGNED_ID,
      name: 'ยังไม่มอบหมาย',
      contracts: [],
    });
    for (const c of collectors) {
      byId.set(c.id, { collectorId: c.id, name: c.name, contracts: [] });
    }
    for (const ct of contracts) {
      const col = ct.assignedTo?.id ?? UNASSIGNED_ID;
      const target = byId.get(col);
      if (target) target.contracts.push(ct);
      else byId.get(UNASSIGNED_ID)!.contracts.push(ct);
    }
    // Order: unassigned first, then collectors as fetched
    return [byId.get(UNASSIGNED_ID)!, ...collectors.map((c) => byId.get(c.id)!)];
  }, [collectors, contracts]);

  const colOfContract = useMemo(() => {
    const m = new Map<string, string>();
    for (const col of columns) {
      for (const ct of col.contracts) m.set(ct.id, col.collectorId);
    }
    return m;
  }, [columns]);

  const toggleSelect = (
    contractId: string,
    columnId: string,
    shiftKey: boolean,
  ) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedByCol[columnId]) {
        // Range select within this column
        const col = columns.find((c) => c.collectorId === columnId);
        if (col) {
          const ids = col.contracts.map((c) => c.id);
          const start = ids.indexOf(lastSelectedByCol[columnId]);
          const end = ids.indexOf(contractId);
          if (start >= 0 && end >= 0) {
            const [a, b] = start < end ? [start, end] : [end, start];
            for (let i = a; i <= b; i += 1) next.add(ids[i]);
          }
        }
      } else if (next.has(contractId)) {
        next.delete(contractId);
      } else {
        next.add(contractId);
      }
      return next;
    });
    setLastSelectedByCol((p) => ({ ...p, [columnId]: contractId }));
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }
    const targetCol = destination.droppableId;
    const newAssignedId = targetCol === UNASSIGNED_ID ? null : targetCol;
    if (newAssignedId === null) {
      // Backend assignCollector requires a non-null id. We do not POST;
      // instruct user how to truly unassign instead.
      // Future: add an /unassign endpoint. For now silently no-op.
      return;
    }

    // If the dragged card is part of selection, drop the whole selection;
    // otherwise drop just the dragged card.
    const draggedIsSelected = selected.has(draggableId);
    const idsToMove = draggedIsSelected ? Array.from(selected) : [draggableId];
    // Filter out cards already in destination
    const pairs = idsToMove
      .filter((id) => colOfContract.get(id) !== targetCol)
      .map((id) => ({ contractId: id, assignedToId: newAssignedId }));

    if (pairs.length === 0) return;
    setBusy(true);
    try {
      await reassignMany(pairs);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const runAutoBalance = async () => {
    setBusy(true);
    try {
      await autoBalance();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-semibold mb-0.5 leading-snug">
              กระจายงานติดตามหนี้
            </div>
            <div className="text-xs text-muted-foreground leading-snug">
              ลากการ์ดข้ามคอลัมน์เพื่อเปลี่ยนผู้รับผิดชอบ · Shift+คลิก
              เพื่อเลือกหลายรายการ
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || contracts.length === 0 || collectors.length === 0}
            onClick={() => setAutoBalanceConfirmOpen(true)}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Shuffle className="mr-1.5 h-3.5 w-3.5" />
            )}
            กระจายงานอัตโนมัติ
          </Button>
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดข้อมูลกระจายงานได้"
        >
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {columns.map((col) => (
                <Droppable droppableId={col.collectorId} key={col.collectorId}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`rounded-lg border border-border bg-muted/30 p-2 min-h-[200px] transition-colors ${
                        snapshot.isDraggingOver ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2 px-1">
                        <div className="text-xs font-semibold leading-snug truncate">
                          {col.name}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {col.contracts.length}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {col.contracts.map((ct, idx) => (
                          <Draggable draggableId={ct.id} index={idx} key={ct.id}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                onClick={(e) =>
                                  toggleSelect(ct.id, col.collectorId, e.shiftKey)
                                }
                                className={`rounded-md border bg-background px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing transition-shadow ${
                                  dragSnapshot.isDragging ? 'shadow-md' : ''
                                } ${
                                  selected.has(ct.id)
                                    ? 'border-primary ring-1 ring-primary'
                                    : 'border-border'
                                }`}
                              >
                                <div className="font-medium leading-snug truncate">
                                  {ct.contractNumber}
                                </div>
                                <div className="text-muted-foreground leading-snug truncate">
                                  {ct.customer?.name ?? '—'}
                                </div>
                                <div className="flex justify-between mt-0.5 tabular-nums text-muted-foreground">
                                  <span>{ct.daysOverdue}d</span>
                                  <span>{bahtFormat.format(ct.outstanding)} ฿</span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              ))}
            </div>
          </DragDropContext>
        </QueryBoundary>
      </CardContent>

      <AlertDialog
        open={autoBalanceConfirmOpen}
        onOpenChange={setAutoBalanceConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการกระจายงานอัตโนมัติ</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะกระจาย {contracts.length} สัญญา ให้พนักงาน{' '}
              {collectors.length} คน เท่าๆ กัน
              และจะเขียนทับการมอบหมายเดิมทั้งหมด ดำเนินการต่อหรือไม่?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void runAutoBalance();
              }}
            >
              กระจายงานอัตโนมัติ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
