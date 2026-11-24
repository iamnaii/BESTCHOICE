import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSION_CATALOG, type AccessSnapshot, type PermissionKey } from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ROLE_LABELS } from '@/constants/user-roles';
import { useDebounce } from '@/hooks/useDebounce';
import { Lock } from '@/lib/icons';
import { AssignmentEditor } from './AssignmentEditor';
import { AssignmentList } from './AssignmentList';
import { accessQueries, type AccessEmployee } from './api';
import { savedAssignments } from './preview';

const labels = new Map(PERMISSION_CATALOG.map(({ key, label }) => [key, label]));
const permissionLabel = (permission: PermissionKey) => labels.get(permission) ?? permission;

function employeeStatus(employee: AccessEmployee) {
  if (!employee.isActive) return 'ปิดบัญชี';
  if (employee.role === 'OWNER') return 'เจ้าของ';
  return employee.accessManaged ? 'สิทธิ์ตามตำแหน่ง' : 'สิทธิ์เดิม';
}

export function EmployeesTab() {
  const employees = useQuery(accessQueries.employees);
  const positions = useQuery(accessQueries.positions);
  const context = useQuery(accessQueries.context);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const filter = useDebounce(search.trim().toLowerCase(), 150);
  const [editor, setEditor] = useState<{ employee: AccessEmployee; snapshot: AccessSnapshot } | null>(null);
  const selected = employees.data?.find(({ id }) => id === selectedId);
  const isEditable = selected?.isActive === true && selected.role !== 'OWNER';
  const snapshot = useQuery({ ...accessQueries.snapshot(selectedId), enabled: isEditable });
  const branches = context.data?.branches ?? [];
  const branchName = (id: string | null) =>
    branches.find((branch) => branch.id === id)?.name ?? (id ? 'สาขาไม่พร้อมใช้' : 'ไม่มีสาขาประจำ');
  const matching =
    employees.data?.filter(({ name, email, role, branchId }) =>
      [name, email, ROLE_LABELS[role], branchName(branchId)].some((part) =>
        part?.toLowerCase().includes(filter),
      ),
    ) ?? [];
  const positionLabel = (id: string) => {
    const position =
      positions.data?.find((row) => row.id === id) ??
      selected?.accessAssignments.find((row) => row.positionId === id)?.position;
    if (!position) return `ตำแหน่ง ${id}`;
    return position.isActive && !('deletedAt' in position && position.deletedAt)
      ? position.name
      : `${position.name} (ปิดใช้งาน)`;
  };

  async function reloadAccount() {
    const [employeeList, access] = await Promise.all([
      employees.refetch({ throwOnError: true }),
      snapshot.refetch({ throwOnError: true }),
      positions.refetch({ throwOnError: true }),
      context.refetch({ throwOnError: true }),
    ]);
    const employee = employeeList.data?.find(({ id }) => id === selectedId);
    if (!employee || !employee.isActive || employee.role === 'OWNER' || !access.data || access.data.isOwner) {
      throw { response: { status: 403, data: { message: 'บัญชีนี้ไม่สามารถแก้ไขการมอบหมายได้แล้ว' } } };
    }
    if (employee.accessRevision !== access.data.revision) {
      throw {
        response: {
          status: 409,
          data: { message: 'ข้อมูลพนักงานกำลังเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดอีกครั้ง' },
        },
      };
    }
    return { employee, snapshot: access.data };
  }

  return (
    <>
      <QueryBoundary
        isLoading={employees.isPending || context.isPending || positions.isPending}
        isError={employees.isError || context.isError || positions.isError}
        error={employees.error ?? context.error ?? positions.error}
        onRetry={() => {
          void employees.refetch();
          void context.refetch();
          void positions.refetch();
        }}
      >
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(14rem,2fr)_minmax(0,3fr)]">
          <section className="min-w-0 rounded-lg border border-border bg-card" aria-label="รายชื่อพนักงาน">
            <div className="space-y-1.5 border-b border-border p-4">
              <Label htmlFor="employee-access-search">ค้นหาพนักงาน</Label>
              <Input
                id="employee-access-search"
                type="search"
                placeholder="ชื่อ อีเมล บทบาท หรือสาขา"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto overscroll-contain xl:max-h-[34rem]">
              {matching.map((employee) => (
                <li key={employee.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === employee.id}
                    onClick={() => setSelectedId(employee.id)}
                    className="grid min-h-16 w-full cursor-pointer gap-1 px-4 py-3 text-start leading-snug hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-primary/10"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words font-medium">{employee.name}</span>
                      <Badge variant={employee.accessManaged && employee.isActive ? 'success' : 'secondary'}>
                        {employeeStatus(employee)}
                      </Badge>
                    </span>
                    <span className="min-w-0 break-words text-xs text-muted-foreground">
                      {employee.email}
                    </span>
                  </button>
                </li>
              ))}
              {!matching.length && (
                <li className="p-4 text-sm text-muted-foreground">
                  {filter ? 'ไม่พบพนักงานที่ตรงกับคำค้น' : 'ยังไม่มีพนักงาน'}
                </li>
              )}
            </ul>
          </section>

          <section
            aria-label="รายละเอียดสิทธิ์พนักงาน"
            className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 leading-snug sm:p-5"
          >
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <h2 className="break-words text-lg font-semibold">{selected.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {ROLE_LABELS[selected.role] ?? selected.role} · {branchName(selected.branchId)}
                    </p>
                  </div>
                  {isEditable &&
                    snapshot.data &&
                    !snapshot.data.isOwner &&
                    !snapshot.isError &&
                    selected.accessRevision === snapshot.data.revision && (
                      <Button
                        onClick={() => {
                          if (snapshot.data) setEditor({ employee: selected, snapshot: snapshot.data });
                        }}
                      >
                        แก้ไขการมอบหมาย
                      </Button>
                    )}
                </div>

                {!selected.isActive && (
                  <p className="flex gap-2 rounded-lg bg-muted p-3 text-sm">
                    <Lock className="size-4 shrink-0" aria-hidden="true" /> บัญชีปิดใช้งานอยู่
                    จัดการการมอบหมายได้เมื่อเปิดบัญชี
                  </p>
                )}
                {selected.role === 'OWNER' && (
                  <p className="flex gap-2 rounded-lg bg-muted p-3 text-sm">
                    <Lock className="size-4 shrink-0" aria-hidden="true" /> สิทธิ์เจ้าของมาจากประเภทบัญชี
                    จัดการบัญชีเจ้าของได้จากการตั้งค่าผู้ใช้
                  </p>
                )}

                {isEditable && (
                  <QueryBoundary
                    isLoading={snapshot.isPending}
                    isError={snapshot.isError}
                    error={snapshot.error}
                    onRetry={() => void snapshot.refetch()}
                  >
                    {snapshot.data && (
                      <div className="space-y-2">
                        <h3 className="font-medium">สิทธิ์ที่มีผลจากระบบตำแหน่ง</h3>
                        {selected.accessRevision !== snapshot.data.revision && (
                          <div role="alert" className="space-y-2 rounded-lg bg-warning/10 p-3 text-sm">
                            <p>ข้อมูลพนักงานมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข</p>
                            <Button
                              variant="outline"
                              onClick={() => {
                                void employees.refetch();
                                void snapshot.refetch();
                              }}
                            >
                              โหลดข้อมูลล่าสุด
                            </Button>
                          </div>
                        )}
                        {!snapshot.data.isOwner &&
                          (snapshot.data.managed ? (
                            <>
                              <p className="text-sm text-muted-foreground">
                                ข้อมูลปัจจุบันจากระบบ รวมการมอบหมายที่ยังใช้ได้
                              </p>
                              <AssignmentList
                                assignments={snapshot.data.grants}
                                positionLabel={positionLabel}
                                branches={branches}
                                permissionLabel={permissionLabel}
                                empty="ไม่มีสิทธิ์จากการมอบหมายที่มีผล"
                              />
                            </>
                          ) : (
                            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                              บัญชีนี้ยังใช้กติกาสิทธิ์เดิม หน้านี้ยังไม่ได้คำนวณสิทธิ์เดิมทั้งหมด
                            </p>
                          ))}
                      </div>
                    )}
                  </QueryBoundary>
                )}
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="font-medium">การมอบหมายที่บันทึกไว้</h3>
                  <p className="text-sm text-muted-foreground">รวมตำแหน่งและสาขาที่ปิดใช้งาน</p>
                  <AssignmentList
                    assignments={savedAssignments(selected)}
                    positionLabel={positionLabel}
                    branches={branches}
                    permissionLabel={permissionLabel}
                  />
                </div>
              </>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">เลือกพนักงานเพื่อดูสิทธิ์และการมอบหมาย</p>
            )}
          </section>
        </div>
      </QueryBoundary>
      {editor && context.data && (
        <AssignmentEditor
          initial={editor}
          positions={positions.data ?? []}
          context={context.data}
          reloadAccount={reloadAccount}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
