import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import type { LettersListFilters, LetterType } from '../types';

interface Props {
  value: Omit<LettersListFilters, 'status' | 'page' | 'limit'>;
  onChange: (next: Omit<LettersListFilters, 'status' | 'page' | 'limit'>) => void;
  branches: Array<{ id: string; name: string }>;
  canSelectBranch: boolean;
}

export default function LetterFiltersBar({ value, onChange, branches, canSelectBranch }: Props) {
  const [searchInput, setSearchInput] = useState(value.q ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    if (debouncedSearch !== (value.q ?? '')) {
      onChange({ ...value, q: debouncedSearch || undefined });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="ค้นหา (เลขจดหมาย/เลขสัญญา/ชื่อลูกค้า)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </div>

      {canSelectBranch && (
        <Select
          value={value.branchId ?? 'all'}
          onValueChange={(v) => onChange({ ...value, branchId: v === 'all' ? undefined : v })}
        >
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="สาขา" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสาขา</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={value.letterType ?? 'all'}
        onValueChange={(v) =>
          onChange({ ...value, letterType: v === 'all' ? undefined : (v as LetterType) })
        }
      >
        <SelectTrigger className="w-[180px]"><SelectValue placeholder="ประเภท" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">ทุกประเภท</SelectItem>
          <SelectItem value="RETURN_DEVICE_45D">เก็บอุปกรณ์ 45 วัน</SelectItem>
          <SelectItem value="CONTRACT_TERMINATION_60D">บอกเลิกสัญญา 60 วัน</SelectItem>
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={value.from ?? ''}
        onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
        className="w-[150px]"
      />
      <span className="text-muted-foreground">ถึง</span>
      <Input
        type="date"
        value={value.to ?? ''}
        onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
        className="w-[150px]"
      />
    </div>
  );
}
