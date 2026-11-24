import { useId } from 'react';
import type { AccessScope, Company, EmployeeAccessContext } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { AccessPosition, Assignment } from './api';
import { branchOptions, canAssignPosition, SCOPES, SCOPE_NAMES, WORK_NAMES } from './preview';
import type { PositionLabel } from './AssignmentList';

export function AssignmentFields({
  row,
  index,
  positions,
  context,
  positionLabel,
  onChange,
  onRemove,
}: {
  row: Assignment;
  index: number;
  positions: AccessPosition[];
  context: EmployeeAccessContext;
  positionLabel: PositionLabel;
  onChange: (input: Assignment) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const { positionId, company, scope, branchIds } = row;
  const eligibleBranches = branchOptions(context, company);
  const eligiblePositions = positions.filter(canAssignPosition);
  const selectedUnavailable = branchIds.filter(
    (branchId) => !eligibleBranches.some((branch) => branch.id === branchId),
  );

  function selectWork(next: Company) {
    const allowed = new Set(branchOptions(context, next).map((branch) => branch.id));
    onChange({ ...row, company: next, branchIds: branchIds.filter((branchId) => allowed.has(branchId)) });
  }

  function toggleBranch(branchId: string, checked: boolean) {
    onChange({
      ...row,
      branchIds: checked ? [...branchIds, branchId] : branchIds.filter((id) => id !== branchId),
    });
  }

  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 font-medium">การมอบหมายที่ {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${id}-position`}>ตำแหน่ง</Label>
          <NativeSelect
            id={`${id}-position`}
            value={positionId}
            onChange={(event) => onChange({ ...row, positionId: event.target.value })}
          >
            <option value="">เลือกตำแหน่ง</option>
            {positionId && !eligiblePositions.some(({ id }) => id === positionId) && (
              <option value={positionId} disabled>
                {positionLabel(positionId)}
              </option>
            )}
            {eligiblePositions.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${id}-work`}>ส่วนงาน</Label>
          <NativeSelect
            id={`${id}-work`}
            value={company}
            onChange={(event) => selectWork(event.target.value as Company)}
          >
            {!context.companies.includes(company) && (
              <option value={company} disabled>
                {WORK_NAMES[company]} (ปิดใช้งาน)
              </option>
            )}
            {context.companies.map((work) => (
              <option key={work} value={work}>
                {WORK_NAMES[work]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${id}-scope`}>ขอบเขต</Label>
          <NativeSelect
            id={`${id}-scope`}
            value={scope}
            onChange={(event) => {
              const scope = event.target.value as AccessScope;
              onChange({ ...row, scope, branchIds: scope === 'COMPANY' ? [] : branchIds });
            }}
          >
            {SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {SCOPE_NAMES[scope]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {scope === 'ASSIGNED' && (
        <p className="text-muted-foreground">
          ต้องได้รับมอบหมายรายการนั้นจริง เลือกสาขาเพิ่มได้หากต้องการจำกัดพื้นที่
        </p>
      )}
      {scope === 'COMPANY' ? (
        <p className="rounded-md bg-warning/10 p-2 text-warning-strong">
          สิทธิ์นี้ครอบคลุมทุกสาขาในส่วนงานที่เลือก
        </p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="font-medium">
            {scope === 'ASSIGNED' ? 'จำกัดสาขา (ไม่บังคับ)' : 'สาขาที่อนุญาต'}
          </legend>
          <div className="max-h-40 overflow-y-auto overscroll-contain">
            {eligibleBranches.length === 0 && (
              <p className="text-muted-foreground">ไม่มีสาขาที่เปิดใช้งานในขอบเขตนี้</p>
            )}
            {eligibleBranches.map(({ id, name, companyCode }) => (
              <label key={id} className="flex min-h-10 items-center gap-2 break-words">
                <Checkbox
                  checked={branchIds.includes(id)}
                  onCheckedChange={(checked) => toggleBranch(id, checked === true)}
                />
                {name} <span className="text-muted-foreground">({WORK_NAMES[companyCode]})</span>
              </label>
            ))}
            {selectedUnavailable.map((branchId) => (
              <label
                key={branchId}
                className="flex min-h-10 items-center gap-2 break-words text-warning-strong"
              >
                <Checkbox checked onCheckedChange={() => toggleBranch(branchId, false)} />
                {context.branches.find(({ id }) => id === branchId)?.name ?? 'สาขาเดิม'} (ใช้ไม่ได้
                เลิกเลือกเพื่อนำออก)
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Button
        variant="ghost"
        className="text-destructive"
        aria-label={`นำการมอบหมายที่ ${index + 1} ออก`}
        onClick={onRemove}
      >
        นำการมอบหมายออก
      </Button>
    </fieldset>
  );
}
