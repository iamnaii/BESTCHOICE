import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

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
      <input
        type="text"
        placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า, เบอร์โทร..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="px-3 py-2 border border-input bg-card rounded-lg text-sm min-w-[260px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[2px] focus-visible:ring-offset-background focus-visible:border-transparent leading-snug"
      />
      {showBranchFilter && (
        <select
          value={branchId}
          onChange={(e) => onBranchChange(e.target.value)}
          className="px-3 py-2 border border-input bg-card rounded-lg text-sm min-w-[160px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
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
