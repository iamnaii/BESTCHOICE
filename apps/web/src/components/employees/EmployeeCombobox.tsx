// Payroll employee picker. Searches the payroll registry (active employees only,
// server-side, debounced) via GET /employees/pickable. NO inline-create —
// employees are Users provisioned at /employees first (spec §3.2). On pick it
// hands the full PickableEmployee to the parent, which sets userId + pre-fills
// base salary / SSO. `value` is the display name (shows legacy snapshot too).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { employeeKeys, employeesApi, type PickableEmployee } from '@/lib/api/employees';

interface Props {
  value: string; // current display name (picked or legacy snapshot)
  onSelect: (employee: PickableEmployee) => void;
  invalid?: boolean;
  placeholder?: string;
}

export default function EmployeeCombobox({
  value,
  onSelect,
  invalid,
  placeholder = 'เลือกพนักงาน',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);

  const query = useQuery({
    queryKey: employeeKeys.pickable(debounced || ''),
    queryFn: () => employeesApi.pickable(debounced || undefined),
    enabled: open,
    staleTime: 60 * 1000,
  });
  const employees = query.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          <span className="truncate leading-snug" title={value || undefined}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {query.isLoading ? (
              <CommandEmpty>กำลังโหลด...</CommandEmpty>
            ) : query.isError ? (
              <CommandEmpty className="px-3 py-6 text-center leading-snug text-destructive">
                โหลดข้อมูลไม่สำเร็จ
              </CommandEmpty>
            ) : employees.length === 0 ? (
              <CommandEmpty className="px-3 py-6 text-center leading-snug text-muted-foreground">
                {search.trim()
                  ? `ไม่พบพนักงาน "${search.trim()}" — เพิ่มที่หน้าทะเบียนพนักงาน`
                  : 'พิมพ์เพื่อค้นหาพนักงาน'}
              </CommandEmpty>
            ) : (
              <CommandGroup heading="พนักงาน">
                {employees.map((e) => (
                  <CommandItem
                    key={e.userId}
                    value={e.userId}
                    onSelect={() => {
                      onSelect(e);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4 shrink-0',
                        value === e.name ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="flex-1 truncate leading-snug">{e.name}</span>
                    {e.nickname && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {e.nickname}
                      </span>
                    )}
                    {e.employeeId && (
                      <Badge variant="secondary" className="ml-2 text-2xs">
                        {e.employeeId}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
