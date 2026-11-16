// Payroll employee picker. Searches the payroll registry (active employees only,
// server-side, debounced) via GET /employees/pickable. NO inline-create —
// employees are Users provisioned at /employees first (spec §3.2). On pick it
// hands the full PickableEmployee to the parent, which sets userId + pre-fills
// base salary / SSO. `value` is the display name (shows legacy snapshot too).
//
// R2-3b: a thin shell on the shared <Combobox>. Kept on purpose (pinned by
// __tests__/EmployeeCombobox*.test.tsx): fetches only while open · the payroll
// `period` is part of the cache key and the request · a row is ticked when its
// name equals `value`.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { employeeKeys, employeesApi, type PickableEmployee } from '@/lib/api/employees';

interface Props {
  value: string; // current display name (picked or legacy snapshot)
  onSelect: (employee: PickableEmployee) => void;
  invalid?: boolean;
  placeholder?: string;
  /** งวดใบเงินเดือน (YYYY-MM) — ให้เลือกคนที่ลาออกระหว่างงวดนั้นได้ */
  period?: string;
}

/** The server already matched name / nickname / employee code — keep its rows and order. */
const keepServerRows = (options: ComboOption<PickableEmployee>[]) => options;

function EmployeeRow({ employee, selected }: { employee: PickableEmployee; selected: boolean }) {
  return (
    <>
      <Check
        aria-hidden="true"
        className={cn('mr-2 size-4 shrink-0 text-primary!', selected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="flex-1 truncate leading-snug">{employee.name}</span>
      {employee.nickname && (
        <span className="ml-2 shrink-0 text-xs text-muted-foreground">{employee.nickname}</span>
      )}
      {employee.employeeId && (
        <Badge variant="secondary" className="ml-2 text-2xs">
          {employee.employeeId}
        </Badge>
      )}
    </>
  );
}

export default function EmployeeCombobox({
  value,
  onSelect,
  invalid,
  placeholder = 'เลือกพนักงาน',
  period,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: employeeKeys.pickable(debounced || '', period),
    queryFn: () => employeesApi.pickable(debounced || undefined, period),
    enabled: open,
    staleTime: 60 * 1000,
  });
  const employees = query.data ?? [];

  // value = display name: the option value is the employee name, so the tick compares names.
  const options: ComboOption<PickableEmployee>[] = employees.map((e) => ({
    value: e.name,
    label: e.name,
    group: 'พนักงาน',
    meta: e,
  }));
  const term = search.trim();

  return (
    <Combobox<PickableEmployee>
      aria-label="พนักงาน"
      value={value || null}
      selectedOption={value ? { value, label: value } : null}
      options={options}
      filter={keepServerRows}
      onSearchChange={setSearch}
      placeholder={placeholder}
      searchPlaceholder="ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)"
      searchLabel="ค้นหาพนักงาน"
      listLabel="รายชื่อพนักงาน"
      emptyText={
        term ? `ไม่พบพนักงาน "${term}" — เพิ่มที่หน้าทะเบียนพนักงาน` : 'พิมพ์เพื่อค้นหาพนักงาน'
      }
      loading={query.isLoading}
      error={query.isError ? 'โหลดข้อมูลไม่สำเร็จ' : false}
      onRetry={() => void query.refetch()}
      invalid={invalid}
      open={open}
      onOpenChange={setOpen}
      onChange={(_name, option) => {
        if (option?.meta) onSelect(option.meta);
      }}
      renderOption={(option, { selected }) =>
        option.meta ? <EmployeeRow employee={option.meta} selected={selected} /> : option.label
      }
    />
  );
}
