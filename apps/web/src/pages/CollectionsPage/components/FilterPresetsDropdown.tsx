import { useState } from 'react';
import { Bookmark, ChevronDown, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/contexts/AuthContext';
import { SYSTEM_PRESETS } from '../constants/systemPresets';
import {
  useListPresets,
  useCreatePreset,
  useDeletePreset,
  type FilterPresetScope,
} from '../hooks/useFilterPresets';
import type { QueueFilterState } from '../hooks/useQueueFilter';

const PAGE_KEY = 'collections-queue';

interface Props {
  currentFilter: QueueFilterState;
  onApply: (filter: QueueFilterState) => void;
}

export function FilterPresetsDropdown({ currentFilter, onApply }: Props) {
  const { user } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<FilterPresetScope>('PRIVATE');

  const presetsQuery = useListPresets(PAGE_KEY);
  const create = useCreatePreset();
  const del = useDeletePreset(PAGE_KEY);

  const userPresets = presetsQuery.data ?? [];
  const role = user?.role ?? '';
  const canShareBranch = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(role);
  const canShareAll = role === 'OWNER';

  const handleSave = () => {
    if (!name.trim()) return;
    create.mutate(
      {
        name: name.trim(),
        scope,
        page: PAGE_KEY,
        filterJson: currentFilter,
      },
      {
        onSuccess: () => {
          setSaveOpen(false);
          setName('');
          setScope('PRIVATE');
        },
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bookmark className="size-3.5" />
            Presets
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>ระบบแนะนำ</DropdownMenuLabel>
          {SYSTEM_PRESETS.map((p) => (
            <DropdownMenuItem
              key={p.key}
              onSelect={() => onApply(p.filter)}
              className="cursor-pointer"
            >
              {p.name}
            </DropdownMenuItem>
          ))}

          {userPresets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>ของฉัน / ทีม</DropdownMenuLabel>
              {userPresets.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => onApply(p.filterJson)}
                  className="group flex cursor-pointer items-center justify-between gap-2"
                >
                  <span className="truncate">
                    {p.name}
                    {p.scope !== 'PRIVATE' && (
                      <span className="ml-1 text-2xs text-muted-foreground leading-snug">
                        {p.scope === 'SHARED_BRANCH' ? '· สาขา' : '· ทุกสาขา'}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      del.mutate(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    aria-label={`ลบ preset ${p.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)} className="cursor-pointer">
            <Save className="mr-2 size-4" />
            บันทึก filter ปัจจุบัน
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>บันทึก Filter Preset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="preset-name">ชื่อ preset</Label>
              <Input
                id="preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น เกินกำหนด LADPRAO"
                maxLength={50}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>ขอบเขต</Label>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as FilterPresetScope)}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="PRIVATE" id="sc-p" />
                  <Label htmlFor="sc-p" className="font-normal cursor-pointer">
                    ของฉันเท่านั้น
                  </Label>
                </div>
                {canShareBranch && (
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="SHARED_BRANCH" id="sc-b" />
                    <Label htmlFor="sc-b" className="font-normal cursor-pointer">
                      สาขาของฉัน
                    </Label>
                  </div>
                )}
                {canShareAll && (
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="SHARED_ALL" id="sc-a" />
                    <Label htmlFor="sc-a" className="font-normal cursor-pointer">
                      ทุกสาขา
                    </Label>
                  </div>
                )}
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default FilterPresetsDropdown;
