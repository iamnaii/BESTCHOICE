import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConfigItem } from '../components/shared';

export function AttachmentTab() {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState('0');
  const [allowedTypes, setAllowedTypes] = useState('PDF, JPG, PNG');
  const [editing, setEditing] = useState(false);

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length === 0 || editing) return;
    setThreshold(configs.find((c) => c.key === 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT')?.value ?? '0');
    setAllowedTypes(configs.find((c) => c.key === 'ATTACHMENT_ALLOWED_TYPES')?.value ?? 'PDF, JPG, PNG');
  }, [configs, editing]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.patch('/settings', {
        items: [
          { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', value: threshold },
          { key: 'ATTACHMENT_ALLOWED_TYPES', value: allowedTypes },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกการตั้งค่าเอกสารแนบสำเร็จ');
      setEditing(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>เอกสารแนบ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="att-threshold">ยอดที่ต้องบังคับแนบเอกสาร (บาท)</Label>
          <Input
            id="att-threshold"
            type="number"
            step="0.01"
            min="0"
            value={threshold}
            onChange={(e) => { setThreshold(e.target.value); setEditing(true); }}
            disabled={saveMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">0 = ไม่บังคับแนบ. มากกว่า 0 = บังคับแนบเมื่อยอดเอกสารเกินค่านี้</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="att-types">ประเภทไฟล์ที่อนุญาต</Label>
          <Input
            id="att-types"
            value={allowedTypes}
            onChange={(e) => { setAllowedTypes(e.target.value); setEditing(true); }}
            placeholder="PDF, JPG, PNG"
            disabled={saveMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">คั่นด้วยจุลภาค (,) เช่น "PDF, JPG, PNG"</p>
        </div>

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
