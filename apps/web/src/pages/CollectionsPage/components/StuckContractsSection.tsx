import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Clock } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import QueryBoundary from '@/components/QueryBoundary';
import { useStuckContracts } from '../hooks/useStuckContracts';

interface StaffUser {
  id: string;
  name: string;
  role: string;
}

const THRESHOLD_OPTIONS = [7, 14, 30] as const;

function formatBaht(n: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(n);
}

export default function StuckContractsSection() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(14);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string>('');

  const { data = [], isLoading, isError, error, refetch } = useStuckContracts(days);

  const { data: staff = [] } = useQuery<StaffUser[]>({
    queryKey: ['staff-users'],
    queryFn: async () => {
      const res = await api.get('/users');
      const list = res.data?.data || res.data || [];
      return Array.isArray(list) ? list : [];
    },
    enabled: reassignOpen,
  });

  const reassign = useMutation({
    mutationFn: async (vars: { contractIds: string[]; assignedToId: string }) =>
      api.post('/overdue/bulk/assign', vars),
    onSuccess: () => {
      toast.success('มอบหมายสำเร็จ');
      setSelected(new Set());
      setReassignOpen(false);
      setTargetUserId('');
      queryClient.invalidateQueries({ queryKey: ['collections-stuck-contracts'] });
    },
    onError: () => toast.error('มอบหมายไม่สำเร็จ'),
  });

  const allChecked = useMemo(
    () => data.length > 0 && data.every((r) => selected.has(r.contractId)),
    [data, selected],
  );
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(data.map((r) => r.contractId)));
  };
  const toggleOne = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleReassign = () => {
    if (!targetUserId || selected.size === 0) return;
    reassign.mutate({
      contractIds: Array.from(selected),
      assignedToId: targetUserId,
    });
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold mb-0.5 leading-snug inline-flex items-center gap-1.5">
              <Clock className="size-4 text-muted-foreground" />
              สัญญาที่ถูกค้าง
            </div>
            <div className="text-xs text-muted-foreground leading-snug">
              ไม่มี call log / dunning / ติดต่อ ใน {days} วันที่ผ่านมา
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">เกณฑ์:</span>
            {THRESHOLD_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDays(d);
                  setSelected(new Set());
                }}
                className={`px-2.5 py-1 rounded-md border transition-colors ${
                  days === d
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input hover:bg-accent'
                }`}
              >
                {d} วัน
              </button>
            ))}
            <button
              onClick={() => setReassignOpen(true)}
              disabled={selected.size === 0}
              className="ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-lg border border-input hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <UserPlus className="size-3.5" />
              มอบหมายใหม่ ({selected.size})
            </button>
          </div>
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดสัญญาที่ค้างได้"
        >
          {data.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground italic leading-snug">
              ไม่มีสัญญาที่ค้างเกินเกณฑ์
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-2 px-2 w-8">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={toggleAll}
                        aria-label="เลือกทั้งหมด"
                      />
                    </th>
                    <th className="text-left py-2 px-2 font-medium">สัญญา</th>
                    <th className="text-left py-2 px-2 font-medium">ลูกค้า</th>
                    <th className="text-left py-2 px-2 font-medium">สาขา</th>
                    <th className="text-left py-2 px-2 font-medium">ผู้รับผิดชอบ</th>
                    <th className="text-right py-2 px-2 font-medium">วันค้าง</th>
                    <th className="text-right py-2 px-2 font-medium">ยอดค้าง</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.contractId} className="border-b border-border/60">
                      <td className="py-2 px-2">
                        <Checkbox
                          checked={selected.has(row.contractId)}
                          onCheckedChange={() => toggleOne(row.contractId)}
                          aria-label={`เลือก ${row.contractNumber}`}
                        />
                      </td>
                      <td className="py-2 px-2 font-medium tabular-nums leading-snug">
                        {row.contractNumber}
                      </td>
                      <td className="py-2 px-2 leading-snug">
                        <div>{row.customerName}</div>
                        {row.customerPhone && (
                          <div className="text-xs text-muted-foreground">
                            {row.customerPhone}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground leading-snug">
                        {row.branchName}
                      </td>
                      <td className="py-2 px-2 leading-snug">
                        {row.assignedToName ?? (
                          <span className="text-muted-foreground italic">ไม่ได้มอบหมาย</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {row.daysIdle}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                        {formatBaht(row.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBoundary>
      </CardContent>

      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>มอบหมาย {selected.size} สัญญา</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground leading-snug">
              เลือกผู้รับผิดชอบใหม่
            </label>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background"
            >
              <option value="">— เลือก —</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <button
              onClick={() => setReassignOpen(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-input hover:bg-accent"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleReassign}
              disabled={!targetUserId || reassign.isPending}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              ยืนยัน
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
