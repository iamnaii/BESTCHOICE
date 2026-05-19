import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
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
import { useDebounce } from '@/hooks/useDebounce';

interface Props {
  ticketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormVals {
  repairSupplierId: string;
  externalClaimNo: string;
  estimatedCost: string;
}

interface SupplierHit {
  id: string;
  name: string;
  isRepairCenter?: boolean;
}

export function SendDialog({ ticketId, onClose, onSuccess }: Props) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormVals>();

  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierHit | null>(null);
  const debouncedSearch = useDebounce(supplierSearch, 350);

  const { data: suppliers } = useQuery<SupplierHit[]>({
    queryKey: ['suppliers-repair-send', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 1) return [];
      // NOTE: The suppliers API does not yet filter on isRepairCenter server-side —
      // filter client-side until backend exposes the param (TODO: add isRepairCenter
      // query param to suppliers controller GET /suppliers).
      const res = await api.get(
        `/suppliers?search=${encodeURIComponent(debouncedSearch)}&limit=20`,
      );
      const all: SupplierHit[] = res.data?.data ?? [];
      return all.filter((s) => s.isRepairCenter === true);
    },
    enabled: debouncedSearch.length >= 1,
  });

  const mut = useMutation({
    mutationFn: async (v: FormVals) =>
      api.post(`/repair-tickets/${ticketId}/send`, {
        repairSupplierId: v.repairSupplierId || undefined,
        externalClaimNo: v.externalClaimNo || undefined,
        estimatedCost: v.estimatedCost ? Number(v.estimatedCost) : undefined,
      }),
    onSuccess: () => {
      toast.success('ส่งซ่อมแล้ว');
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ส่งซ่อม</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label>
              ที่ซ่อม <span className="text-destructive">*</span>
            </Label>
            {selectedSupplier ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm leading-snug">
                  {selectedSupplier.name}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedSupplier(null);
                    setValue('repairSupplierId', '');
                    setSupplierSearch('');
                  }}
                >
                  เปลี่ยน
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="ค้นหาศูนย์ซ่อม..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                />
                {suppliers && suppliers.length > 0 && supplierSearch.length >= 1 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md">
                    {suppliers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedSupplier(s);
                          setValue('repairSupplierId', s.id);
                          setSupplierSearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors leading-snug"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {errors.repairSupplierId && (
              <p className="text-xs text-destructive leading-snug">
                {errors.repairSupplierId.message}
              </p>
            )}
            <Input type="hidden" {...register('repairSupplierId', { required: 'กรุณาเลือกที่ซ่อม' })} />
          </div>

          <div className="space-y-1">
            <Label>เลข Claim ของศูนย์ (ถ้ามี)</Label>
            <Input {...register('externalClaimNo')} placeholder="เช่น CLM-2026-0001" />
          </div>

          <div className="space-y-1">
            <Label>ค่าซ่อมประมาณ (บาท)</Label>
            <Input type="number" min="0" step="0.01" {...register('estimatedCost')} placeholder="0" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'กำลังบันทึก...' : 'ส่งซ่อม'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
