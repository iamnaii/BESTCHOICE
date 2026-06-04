import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import {
  employeeKeys,
  employeesApi,
  type EmploymentType,
  type ProvisionableUser,
} from '@/lib/api/employees';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'MONTHLY', label: 'รายเดือน' },
  { value: 'DAILY', label: 'รายวัน' },
  { value: 'CONTRACT', label: 'สัญญาจ้าง' },
];

export default function ProvisionEmployeeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [picked, setPicked] = useState<ProvisionableUser | null>(null);
  const [position, setPosition] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('MONTHLY');
  const [baseSalary, setBaseSalary] = useState('');
  const [ssoEligible, setSsoEligible] = useState(true);

  const candidates = useQuery({
    queryKey: employeeKeys.provisionable(debounced),
    queryFn: () => employeesApi.provisionable(debounced || undefined),
    enabled: open && !picked,
  });

  function reset() {
    setSearch('');
    setPicked(null);
    setPosition('');
    setEmploymentType('MONTHLY');
    setBaseSalary('');
    setSsoEligible(true);
  }

  const mutation = useMutation({
    mutationFn: () =>
      employeesApi.provision({
        userId: picked!.userId,
        position: position.trim() || undefined,
        employmentType,
        baseSalary: baseSalary ? parseFloat(baseSalary) : undefined,
        ssoEligible,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('เพิ่มพนักงานแล้ว');
      reset();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'เพิ่มพนักงานไม่สำเร็จ');
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="leading-snug">เพิ่มพนักงาน</DialogTitle>
        </DialogHeader>

        {!picked ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาผู้ใช้ที่จะตั้งเป็นพนักงาน"
                className="pl-9"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
              {candidates.isLoading ? (
                <p className="text-sm text-muted-foreground py-2 leading-snug">กำลังค้นหา...</p>
              ) : (candidates.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 leading-snug">
                  ไม่พบผู้ใช้ที่ยังไม่เป็นพนักงาน
                </p>
              ) : (
                (candidates.data ?? []).map((u) => (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => setPicked(u)}
                    className="flex items-center gap-2 rounded-md border border-border p-2.5 text-left hover:bg-accent transition-colors"
                  >
                    <span className="text-sm font-medium text-foreground leading-snug">
                      {u.name}
                    </span>
                    {u.nickname && (
                      <span className="text-xs text-muted-foreground">({u.nickname})</span>
                    )}
                    {u.employeeId && (
                      <span className="text-xs text-muted-foreground ml-auto">{u.employeeId}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-muted px-3 py-2 text-sm leading-snug">
              ตั้ง <span className="font-medium">{picked.name}</span> เป็นพนักงาน{' '}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setPicked(null)}
              >
                เปลี่ยน
              </button>
            </div>
            <div>
              <Label>ตำแหน่ง</Label>
              <Input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="เช่น พนักงานขาย"
              />
            </div>
            <div>
              <Label>ประเภทการจ้าง</Label>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>ฐานเงินเดือน</Label>
              <Input
                type="number"
                step="0.01"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <label className="flex items-center gap-2 text-sm leading-snug">
              <input
                type="checkbox"
                checked={ssoEligible}
                onChange={(e) => setSsoEligible(e.target.checked)}
              />
              เข้าประกันสังคม
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button disabled={!picked || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
