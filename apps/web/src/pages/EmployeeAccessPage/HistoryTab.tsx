import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PERMISSION_CATALOG,
  type EmployeeAccessBranchOption,
  type EmployeeAccessHistoryAssignments,
  type EmployeeAccessHistoryItem,
  type EmployeeAccessHistoryPosition,
  type PermissionKey,
} from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { formatThaiDateTime } from '@/lib/date';
import { AssignmentList, type PositionLabel } from './AssignmentList';
import { accessQueries } from './api';

const ACTION_NAMES: Record<EmployeeAccessHistoryItem['action'], string> = {
  ACCESS_POSITION_CREATED: 'สร้างตำแหน่ง',
  ACCESS_POSITION_UPDATED: 'เปลี่ยนตำแหน่งหรือสิทธิ์',
  ACCESS_TEMPLATES_CREATED: 'เพิ่มตำแหน่งจากแม่แบบ',
  ACCESS_ASSIGNMENTS_REPLACED: 'เปลี่ยนการมอบหมาย',
};
const labels = new Map(PERMISSION_CATALOG.map(({ key, label }) => [key, label]));
const permissionLabel = (permission: PermissionKey) => labels.get(permission) ?? permission;

export function HistoryTab() {
  const [page, setPage] = useState(1);
  const history = useQuery(accessQueries.history(page));
  const employees = useQuery(accessQueries.employees);
  const positions = useQuery(accessQueries.positions);
  const context = useQuery(accessQueries.context);
  const details = history.data;
  const name = (id: string) =>
    positions.data?.find((position) => position.id === id)?.name ?? `ตำแหน่ง ${id}`;
  const branches = context.data?.branches ?? [];

  return (
    <QueryBoundary
      isLoading={history.isPending}
      isError={history.isError}
      error={history.error}
      onRetry={() => void history.refetch()}
    >
      {details && (
        <section className="space-y-3" aria-label="รายการประวัติการเปลี่ยนแปลง">
          {details.items.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {details.items.map((entry) => {
                const target =
                  entry.entity === 'user'
                    ? (employees.data?.find(({ id }) => id === entry.entityId)?.name ??
                      `พนักงาน ${entry.entityId}`)
                    : entry.action === 'ACCESS_TEMPLATES_CREATED'
                      ? 'แม่แบบตำแหน่ง'
                      : (entry.after?.name ?? entry.before?.name ?? name(entry.entityId));
                return (
                  <li key={entry.id} className="space-y-2 p-4 leading-snug">
                    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                      <p className="min-w-0 font-medium break-words">
                        {ACTION_NAMES[entry.action]} · {target}
                      </p>
                      <time dateTime={entry.createdAt} className="text-sm text-muted-foreground">
                        {formatThaiDateTime(entry.createdAt, 'Asia/Bangkok')}
                      </time>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {entry.actor?.name ?? 'ไม่ทราบผู้ดำเนินการ'}
                    </p>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-primary">
                        ดูรายละเอียด
                      </summary>
                      <HistoryDetails entry={entry} positionLabel={name} branches={branches} />
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              {details.total ? 'ไม่มีรายการในหน้านี้' : 'ยังไม่มีประวัติการเปลี่ยนแปลง'}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              หน้า {details.page} · ทั้งหมด {details.total} รายการ
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPage((current) => current - 1)}
                disabled={page === 1}
              >
                หน้าก่อนหน้า
              </Button>
              <Button
                variant="outline"
                onClick={() => setPage((current) => current + 1)}
                disabled={details.page * details.limit >= details.total}
              >
                หน้าถัดไป
              </Button>
            </div>
          </div>
        </section>
      )}
    </QueryBoundary>
  );
}

function HistoryDetails({
  entry,
  positionLabel,
  branches,
}: {
  entry: EmployeeAccessHistoryItem;
  positionLabel: PositionLabel;
  branches: EmployeeAccessBranchOption[];
}) {
  return (
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <section aria-label="ก่อนเปลี่ยน" className="min-w-0 space-y-2 rounded-lg bg-muted/50 p-3">
        <h3 className="font-medium">ก่อนเปลี่ยน</h3>
        {entry.entity === 'user' ? (
          <AssignmentState state={entry.before} positionLabel={positionLabel} branches={branches} />
        ) : (
          <PositionState state={entry.before} />
        )}
      </section>
      <section aria-label="หลังเปลี่ยน" className="min-w-0 space-y-2 rounded-lg bg-muted/50 p-3">
        <h3 className="font-medium">หลังเปลี่ยน</h3>
        {entry.entity === 'user' ? (
          <AssignmentState state={entry.after} positionLabel={positionLabel} branches={branches} />
        ) : entry.action === 'ACCESS_TEMPLATES_CREATED' ? (
          entry.after.length > 0 ? (
            <ul className="space-y-2">
              {entry.after.map((position, index) => (
                <li key={position.id ?? index}>
                  <PositionState state={position} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">ไม่มีข้อมูล</p>
          )
        ) : (
          <PositionState state={entry.after} />
        )}
      </section>
    </div>
  );
}

function AssignmentState({
  state,
  positionLabel,
  branches,
}: {
  state: EmployeeAccessHistoryAssignments | null;
  positionLabel: PositionLabel;
  branches: EmployeeAccessBranchOption[];
}) {
  if (!state) return <p className="text-muted-foreground">ไม่มีข้อมูล</p>;
  return (
    <>
      {state.managed !== undefined && <p>{state.managed ? 'สิทธิ์ตามตำแหน่ง' : 'สิทธิ์เดิม'}</p>}
      {state.revision !== undefined && <p className="text-muted-foreground">รุ่นข้อมูล {state.revision}</p>}
      <AssignmentList
        assignments={state.assignments}
        positionLabel={positionLabel}
        branches={branches}
        permissionLabel={permissionLabel}
      />
    </>
  );
}

function PositionState({ state }: { state: EmployeeAccessHistoryPosition | null }) {
  if (!state) return <p className="text-muted-foreground">ไม่มีข้อมูล</p>;
  return (
    <div className="space-y-1 break-words">
      {(state.name || state.code) && (
        <p className="font-medium">{[state.name, state.code].filter(Boolean).join(' · ')}</p>
      )}
      {state.isActive !== undefined && <p>{state.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</p>}
      {state.revision !== undefined && <p className="text-muted-foreground">รุ่นข้อมูล {state.revision}</p>}
      {state.permissions &&
        (state.permissions.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5">
            {state.permissions.map((permission) => (
              <li key={permission}>{permissionLabel(permission)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">ไม่มีสิทธิ์ในตำแหน่ง</p>
        ))}
    </div>
  );
}
