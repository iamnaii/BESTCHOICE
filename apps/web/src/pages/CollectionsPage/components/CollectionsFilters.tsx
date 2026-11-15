import { NativeSelect } from '@/components/ui/native-select';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';

interface Branch {
  id: string;
  name: string;
}

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  branchId: string;
  onBranchChange: (v: string) => void;
  showBranchFilter: boolean;
  hideContactedToday: boolean;
  onHideContactedTodayChange: (v: boolean) => void;
}

export default function CollectionsFilters({
  search,
  onSearchChange,
  branchId,
  onBranchChange,
  showBranchFilter,
  hideContactedToday,
  onHideContactedTodayChange,
}: Props) {
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data?.data ?? data ?? [];
    },
    enabled: showBranchFilter,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div data-collections-search className="flex gap-3 flex-wrap mb-4">
      <input aria-label="ค้นหาเลขสัญญา, ชื่อลูกค้า, เบอร์โทร"
        type="text"
        placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า, เบอร์โทร..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className={cn(formControlClass, 'min-w-[260px]')}
      />
      {showBranchFilter && (
        <NativeSelect wrapperClassName="max-w-full w-auto sm:min-w-[160px]" aria-label="สาขา"
          value={branchId}
          onChange={(e) => onBranchChange(e.target.value)}
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      )}
      <label className="inline-flex items-center gap-2 text-sm leading-snug cursor-pointer select-none">
        <input
          type="checkbox"
          checked={hideContactedToday}
          onChange={(e) => onHideContactedTodayChange(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <span>ซ่อนที่ทำแล้ววันนี้</span>
      </label>
    </div>
  );
}
