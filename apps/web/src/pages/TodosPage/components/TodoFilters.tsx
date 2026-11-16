import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { ListTodo, Clock, CalendarDays, AlertCircle, CheckCircle2, Search, User as UserIcon } from 'lucide-react';
import { type TodoView, type AssigneeRef } from '../types';

const tabs: { value: TodoView; label: string; icon: typeof ListTodo }[] = [
  { value: 'all', label: 'ทั้งหมด', icon: ListTodo },
  { value: 'today', label: 'วันนี้', icon: Clock },
  { value: 'upcoming', label: 'กำลังจะถึง', icon: CalendarDays },
  { value: 'priority', label: 'สำคัญ', icon: AlertCircle },
  { value: 'cancelled', label: 'ยกเลิก', icon: ListTodo },
  { value: 'completed', label: 'เสร็จแล้ว', icon: CheckCircle2 },
];

interface TodoFiltersProps {
  view: TodoView;
  onViewChange: (view: TodoView) => void;
  search: string;
  onSearchChange: (search: string) => void;
  tabCounts: Record<TodoView, number>;
  staffUsers?: AssigneeRef[];
  assigneeFilter?: string;
  onAssigneeFilterChange?: (assigneeId: string) => void;
}

export function TodoFilters({
  view,
  onViewChange,
  search,
  onSearchChange,
  tabCounts,
  staffUsers = [],
  assigneeFilter = '',
  onAssigneeFilterChange,
}: TodoFiltersProps) {
  const assigneeOptions: ComboOption[] = [
    { value: '', label: 'ผู้รับมอบหมายทั้งหมด' },
    { value: 'me', label: 'งานของฉัน' },
    ...staffUsers.map((u) => ({
      value: u.id,
      label: u.nickname || u.name,
      keywords: u.nickname ? [u.name] : undefined,
    })),
  ];
  return (
    <>
      {/* Tabs (pill style) */}
      <div className="flex gap-1.5 mb-5 p-1 bg-muted/50 rounded-xl w-fit max-w-full overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = view === t.value;
          return (
            <button data-ui-control="button"
              key={t.value}
              onClick={() => onViewChange(t.value)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
              {t.label}
              <span
                className={`px-1.5 min-w-[20px] text-center rounded-md text-2xs font-semibold ${
                  active ? 'bg-primary/10 text-primary' : 'bg-muted-foreground/10 text-muted-foreground'
                }`}
              >
                {tabCounts[t.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + Assignee filter row */}
      <div className="mb-5 flex flex-wrap gap-3 items-center">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input aria-label="ค้นหางาน"
            type="text"
            placeholder="ค้นหางาน..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-input bg-card rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors"
          />
        </div>

        {onAssigneeFilterChange && (
          <div className="min-w-0 w-full sm:w-56">
            <Combobox
              aria-label="ผู้รับมอบหมาย"
              value={assigneeFilter}
              onChange={(value) => onAssigneeFilterChange(value)}
              options={assigneeOptions}
              // An ?assigneeId outside the list: the native select showed its first option.
              placeholder="ผู้รับมอบหมายทั้งหมด"
              renderValue={(option) => (
                <span className="flex min-w-0 items-center gap-3">
                  <UserIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{option.label}</span>
                </span>
              )}
            />
          </div>
        )}
      </div>
    </>
  );
}
