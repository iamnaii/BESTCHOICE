import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PERMISSION_CATALOG,
  type AccessSnapshot,
  type EmployeeAccessContext,
  type PermissionKey,
} from '@installment/shared';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus } from '@/lib/icons';
import { AccessEditorDialog } from './AccessEditorDialog';
import { AccessReviewDialog, PermissionChanges, SaveIssue } from './AccessReviewDialog';
import { AssignmentFields } from './AssignmentFields';
import { AssignmentList } from './AssignmentList';
import { MigrationReview } from './MigrationReview';
import {
  accessQueries,
  accessWrites,
  isAccessConflict,
  useAccessWrite,
  type AccessEmployee,
  type AccessPosition,
  type MigrationPreview,
} from './api';
import {
  assignmentKey,
  assignmentProblems,
  comparePermissions,
  proposedGrants,
  savedAssignments,
} from './preview';

interface EditorAccount {
  employee: AccessEmployee;
  snapshot: AccessSnapshot;
}

const permissionLabels = new Map(PERMISSION_CATALOG.map(({ key, label }) => [key, label]));
const permissionLabel = (key: PermissionKey) => permissionLabels.get(key) ?? key;

function legacyReviewKey(preview: MigrationPreview | undefined) {
  if (!preview) return null;
  const { canReverseOverride, accounting_permissions, payment_approval_permissions } = preview.personalGrants;
  return JSON.stringify([
    preview.accessRevision,
    preview.managed,
    preview.role,
    preview.branchId,
    preview.proposedCompanies,
    canReverseOverride,
    accounting_permissions,
    payment_approval_permissions,
    preview.warnings,
  ]);
}

export function AssignmentEditor({
  initial,
  positions,
  context,
  reloadAccount,
  onClose,
}: {
  initial: EditorAccount;
  positions: AccessPosition[];
  context: EmployeeAccessContext;
  reloadAccount: () => Promise<EditorAccount>;
  onClose: () => void;
}) {
  const [account, setAccount] = useState(initial);
  const [rows, setRows] = useState(() =>
    savedAssignments(initial.employee).map((input, key) => ({ key, input })),
  );
  const nextKey = useRef(rows.length);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [verifyingLegacy, setVerifyingLegacy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<unknown>(null);
  const replace = useAccessWrite(accessWrites.replaceAssignments);
  const { employee, snapshot } = account;
  const isLegacy = !snapshot.managed;
  const migration = useQuery({ ...accessQueries.migration, enabled: isLegacy });
  const legacy = migration.data?.find(({ id }) => employee.id === id);
  const migrationKey = legacyReviewKey(legacy);
  const assignments = rows.map(({ input }) => input);
  const proposed = proposedGrants(assignments, positions);
  const problems = assignmentProblems(assignments, positions, context);
  const conflict = isAccessConflict(replace.error);
  const proposalKey = JSON.stringify([proposed, problems]);
  const currentPermissions = snapshot.grants.flatMap((grant) => [...grant.permissions]);
  const proposedPermissions = proposed.flatMap((grant) => [...grant.permissions]);
  const activeKeys = new Set(snapshot.grants.map(assignmentKey));
  const currentAssignments = [
    ...snapshot.grants,
    ...savedAssignments(employee).filter((assignment) => !activeKeys.has(assignmentKey(assignment))),
  ];
  const delta = comparePermissions(currentPermissions, proposedPermissions);
  const label = (id: string) => {
    const active = positions.find((position) => position.id === id);
    if (active) return active.isActive ? active.name : `${active.name} (ปิดใช้งาน)`;
    const old = employee.accessAssignments.find((assignment) => assignment.positionId === id)?.position;
    return old ? `${old.name} (ใช้ไม่ได้)` : `ตำแหน่ง ${id}`;
  };

  async function reload() {
    setReloading(true);
    setReloadError(null);
    try {
      const latest = await reloadAccount();
      setAccount(latest);
      setRows(savedAssignments(latest.employee).map((input, key) => ({ key, input })));
      nextKey.current = latest.employee.accessAssignments.length;
      setReviewed(null);
      setShowErrors(false);
      replace.reset();
      if (!latest.snapshot.managed) void migration.refetch();
    } catch (error) {
      setReloadError(error);
    } finally {
      setReloading(false);
    }
  }

  function checkDraft() {
    setShowErrors(true);
    if (problems.length) return;
    replace.reset();
    setReviewed(proposalKey);
  }

  function addAssignment() {
    const key = nextKey.current++;
    const company = context.companies.includes('SHOP') ? 'SHOP' : context.companies[0];
    if (!company) return;
    setRows((current) => [
      ...current,
      { key, input: { positionId: '', company, scope: 'BRANCHES', branchIds: [] } },
    ]);
  }

  async function save() {
    try {
      if (isLegacy) {
        setVerifyingLegacy(true);
        const latest = await migration.refetch({ throwOnError: true });
        const current = latest.data?.find(({ id }) => id === employee.id);
        if (legacyReviewKey(current) !== migrationKey) return;
      }
      await replace.mutateAsync({ id: employee.id, expectedRevision: snapshot.revision, assignments });
      toast.success('บันทึกการมอบหมายแล้ว');
      onClose();
    } catch {
      // Query and mutation errors appear in the open review.
    } finally {
      setVerifyingLegacy(false);
    }
  }

  const freshLegacyPreview = legacy && legacy.accessRevision === snapshot.revision && !legacy.managed;
  return (
    <AccessEditorDialog busy={replace.isPending || verifyingLegacy || reloading} onClose={onClose}>
      {reviewed !== null ? (
        <AccessReviewDialog
          key={JSON.stringify([proposalKey, migrationKey])}
          description={`ตรวจสอบการมอบหมายของ ${employee.name} ก่อนบันทึก`}
          acknowledgement={
            isLegacy ? 'รับทราบว่าจะเริ่มใช้สิทธิ์ตามตำแหน่งทันทีและลบสิทธิ์รายบุคคลเดิม' : undefined
          }
          confirmDisabled={
            reviewed !== proposalKey ||
            (isLegacy && (migration.isFetching || migration.isError || !freshLegacyPreview))
          }
          pending={replace.isPending || verifyingLegacy}
          error={replace.error}
          reloading={reloading}
          onReload={reload}
          onBack={() => {
            setReviewed(null);
            if (!conflict) replace.reset();
          }}
          onConfirm={() => void save()}
        >
          {reviewed !== proposalKey && (
            <p role="alert" className="rounded-lg bg-warning/10 p-3 text-warning-strong">
              ตำแหน่งหรือสาขามีการเปลี่ยนแปลง กรุณากลับไปตรวจสอบร่างอีกครั้ง
            </p>
          )}
          {assignments.some(({ scope }) => scope === 'COMPANY') && (
            <p className="rounded-lg bg-warning/10 p-3 text-warning-strong">
              ขอบเขตทุกสาขาในส่วนงานให้สิทธิ์กับทุกสาขาของส่วนงานที่เลือก
            </p>
          )}
          {!proposedPermissions.length && (
            <p className="rounded-lg bg-warning/10 p-3 text-warning-strong">
              ร่างนี้ไม่มีสิทธิ์จากตำแหน่ง พนักงานอาจเข้าไม่ถึงงานที่ใช้ระบบสิทธิ์นี้
            </p>
          )}
          {isLegacy && (
            <QueryBoundary
              isLoading={migration.isPending}
              isError={migration.isError}
              error={migration.error}
              onRetry={() => void migration.refetch()}
            >
              {freshLegacyPreview ? (
                <MigrationReview preview={legacy} branches={context.branches} />
              ) : (
                <div role="alert" className="space-y-2">
                  <p>ข้อมูลสิทธิ์เดิมเปลี่ยนแปลงหรือไม่พบข้อมูล กรุณาโหลดข้อมูลล่าสุดเพื่อตรวจสอบอีกครั้ง</p>
                  <Button variant="outline" disabled={reloading} onClick={() => void reload()}>
                    โหลดข้อมูลล่าสุด
                  </Button>
                </div>
              )}
            </QueryBoundary>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <section aria-label="การมอบหมายปัจจุบัน" className="min-w-0 space-y-2">
              <h3 className="font-medium">การมอบหมายปัจจุบัน</h3>
              <AssignmentList
                assignments={currentAssignments}
                branches={context.branches}
                positionLabel={label}
                permissionLabel={permissionLabel}
              />
              {isLegacy && <p className="text-muted-foreground">ยังไม่ได้คำนวณสิทธิ์เดิมทั้งหมด</p>}
            </section>
            <section aria-label="การมอบหมายตามร่าง" className="min-w-0 space-y-2">
              <h3 className="font-medium">การมอบหมายตามร่าง</h3>
              <AssignmentList
                assignments={proposed}
                branches={context.branches}
                positionLabel={label}
                permissionLabel={permissionLabel}
              />
            </section>
          </div>
          {!isLegacy && <PermissionChanges changes={delta} label={permissionLabel} />}
          <SaveIssue error={reloadError} />
        </AccessReviewDialog>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle>แก้ไขการมอบหมาย</DialogTitle>
            <DialogDescription className="leading-snug">
              {employee.name} · แต่ละการมอบหมายมีตำแหน่ง ส่วนงาน และขอบเขตของตัวเอง
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-1 text-sm leading-snug">
            {!rows.length && <p className="text-muted-foreground">ยังไม่มีตำแหน่งในร่างนี้</p>}
            {rows.map(({ key, input }, index) => (
              <AssignmentFields
                key={key}
                row={input}
                index={index}
                positions={positions}
                context={context}
                positionLabel={label}
                onChange={(next) =>
                  setRows((current) => current.map((row) => (row.key === key ? { key, input: next } : row)))
                }
                onRemove={() => setRows((current) => current.filter((row) => row.key !== key))}
              />
            ))}
            <Button
              variant="outline"
              disabled={!context.companies.length || rows.length >= 100}
              onClick={addAssignment}
            >
              <Plus aria-hidden="true" /> เพิ่มตำแหน่งที่มอบหมาย
            </Button>
            {showErrors && problems.length > 0 && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-destructive">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            <SaveIssue error={replace.error} reloading={reloading} onReload={reload} />
            <SaveIssue error={reloadError} />
          </DialogBody>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={onClose} disabled={reloading}>
              ยกเลิก
            </Button>
            <Button disabled={conflict || reloading} onClick={checkDraft}>
              ตรวจสอบผลกระทบ
            </Button>
          </DialogFooter>
        </>
      )}
    </AccessEditorDialog>
  );
}
