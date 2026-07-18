import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** โบนัสเทิร์น % — ราคาเทิร์นบนเว็บ = เงินสด × (1+โบนัส) มีผล quote ถัดไปทันที */
export default function SellConfigBox() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const { data } = useQuery<{ exchangeBonusPct: number }>({
    queryKey: ['sell-config'],
    queryFn: () => api.get('/trade-ins/sell-config').then((r) => r.data),
  });
  useEffect(() => {
    if (data) setValue(String(data.exchangeBonusPct));
  }, [data]);

  const save = useMutation({
    mutationFn: (exchangeBonusPct: number) =>
      api.put('/trade-ins/sell-config', { exchangeBonusPct }),
    onSuccess: () => {
      toast.success('บันทึกโบนัสเทิร์นแล้ว');
      queryClient.invalidateQueries({ queryKey: ['sell-config'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const dirty = data !== undefined && value !== String(data.exchangeBonusPct);

  return (
    <div className="rounded-lg border border-border p-3 flex flex-wrap items-end gap-3">
      <div>
        <Label>โบนัสเทิร์น (%)</Label>
        <Input
          className="mt-1 w-28"
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground leading-snug flex-1 min-w-48">
        ราคาเทิร์นบนเว็บ = ราคาเงินสด × (1 + โบนัส) — เครดิตใช้เป็นส่วนลดซื้อเครื่องในร้านเท่านั้น
      </p>
      {dirty && (
        <Button
          size="sm"
          onClick={() => {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
              toast.error('โบนัสต้องอยู่ระหว่าง 0–100');
              return;
            }
            save.mutate(n);
          }}
          disabled={save.isPending}
        >
          บันทึก
        </Button>
      )}
    </div>
  );
}
