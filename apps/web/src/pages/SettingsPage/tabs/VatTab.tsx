import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConfigItem } from '../components/shared';

type PriceType = 'exclusive' | 'inclusive';

export function VatTab() {
  const queryClient = useQueryClient();
  const [rate, setRate] = useState('7');
  const [priceType, setPriceType] = useState<PriceType>('exclusive');
  const [editing, setEditing] = useState(false);

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length === 0 || editing) return;
    const r = configs.find((c) => c.key === 'VAT_RATE')?.value ?? '7';
    const p = (configs.find((c) => c.key === 'VAT_PRICE_TYPE_DEFAULT')?.value ?? 'exclusive') as PriceType;
    setRate(r);
    setPriceType(p);
  }, [configs, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = [
        { key: 'VAT_RATE', value: rate },
        { key: 'VAT_PRICE_TYPE_DEFAULT', value: priceType },
      ];
      return api.patch('/settings', { items });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึก VAT สำเร็จ');
      setEditing(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>VAT (ภ.พ.30)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vat-rate">อัตรา VAT (%)</Label>
          <Input
            id="vat-rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={rate}
            onChange={(e) => { setRate(e.target.value); setEditing(true); }}
            disabled={saveMutation.isPending}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">ประเภทราคาเริ่มต้น</legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="priceType"
              value="exclusive"
              checked={priceType === 'exclusive'}
              onChange={() => { setPriceType('exclusive'); setEditing(true); }}
              disabled={saveMutation.isPending}
            />
            <span>ราคา ไม่รวม VAT (exclusive)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="priceType"
              value="inclusive"
              checked={priceType === 'inclusive'}
              onChange={() => { setPriceType('inclusive'); setEditing(true); }}
              disabled={saveMutation.isPending}
            />
            <span>ราคา รวม VAT แล้ว (inclusive)</span>
          </label>
        </fieldset>

        {editing && (
          <div className="flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>บันทึก</Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>ยกเลิก</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
