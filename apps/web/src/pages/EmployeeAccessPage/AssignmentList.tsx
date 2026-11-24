import type { AccessGrant, EmployeeAccessBranchOption, PermissionKey } from '@installment/shared';
import type { Assignment } from './api';
import { SCOPE_NAMES, WORK_NAMES } from './preview';

type DisplayAssignment = Assignment | AccessGrant;
export type PositionLabel = (id: string) => string;

export function AssignmentList({
  assignments,
  branches = [],
  positionLabel,
  permissionLabel,
  empty = 'ไม่มีการมอบหมาย',
}: {
  assignments: readonly DisplayAssignment[];
  branches?: EmployeeAccessBranchOption[];
  positionLabel: PositionLabel;
  permissionLabel: (key: PermissionKey) => string;
  empty?: string;
}) {
  const names = new Map(branches.map(({ id, name }) => [id, name]));
  if (!assignments.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="min-w-0 space-y-2 text-sm leading-snug">
      {assignments.map((assignment, index) => {
        const { positionId, company, scope, branchIds } = assignment;
        const position = positionLabel(positionId);
        const permissions = 'permissions' in assignment ? assignment.permissions : undefined;
        const scopeDetails = (
          <div className="mt-1 space-y-1 text-muted-foreground break-words">
            <p>
              {WORK_NAMES[company]} · {SCOPE_NAMES[scope]}
            </p>
            {branchIds.length > 0 && (
              <p>{branchIds.map((id) => names.get(id) ?? `สาขาที่ไม่พร้อมใช้ (${id})`).join(' · ')}</p>
            )}
            {scope === 'ASSIGNED' && (
              <p>ต้องได้รับมอบหมายรายการนั้นจริง{branchIds.length ? 'ในสาขาที่ระบุ' : ''}</p>
            )}
          </div>
        );
        return (
          <li
            key={`${positionId}-${company}-${scope}-${index}`}
            className="min-w-0 rounded-lg border border-border bg-card p-3"
          >
            {permissions ? (
              <details>
                <summary className="cursor-pointer break-words font-medium">
                  {position}{' '}
                  <span className="font-normal text-muted-foreground">· {permissions.length} สิทธิ์</span>
                </summary>
                {permissions.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {permissions.map((key) => (
                      <li key={key} className="break-words">
                        {permissionLabel(key)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">ไม่มีสิทธิ์ในตำแหน่งนี้</p>
                )}
              </details>
            ) : (
              <p className="font-medium break-words">{position}</p>
            )}
            {scopeDetails}
          </li>
        );
      })}
    </ul>
  );
}
