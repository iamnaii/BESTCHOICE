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
}

export default function CollectionsFilters({
  search,
  onSearchChange,
  branchId,
  onBranchChange,
  showBranchFilter,
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
    <div className="bg-card border border-border/50 shadow-sm rounded-xl p-4 mb-5">
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า, เบอร์โทร..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm min-w-[260px] focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent leading-snug"
        />
        {showBranchFilter && (
          <select
            value={branchId}
            onChange={(e) => onBranchChange(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm min-w-[160px] leading-snug"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
