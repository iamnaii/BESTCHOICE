import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

interface CollectionsConfig {
  dailyCap: number;
  workloadFloor: number;
  etaPerContractMin: number;
  sessionTargetMin: number;
  selfClaimLockHours: number;
}

const FIELDS: Array<{
  key: keyof CollectionsConfig;
  label: string;
  description: string;
  min: number;
  max: number;
}> = [
  {
    key: 'dailyCap',
    label: 'คิวสูงสุดต่อพนักงาน/วัน',
    description: 'ระบบจะดันส่วนเกินเข้า pool กลาง',
    min: 5,
    max: 200,
  },
  {
    key: 'workloadFloor',
    label: 'คิวขั้นต่ำต่อพนักงาน/วัน',
    description: 'ดึงจาก pool มาเติมถ้าไม่ถึง',
    min: 0,
    max: 100,
  },
  {
    key: 'etaPerContractMin',
    label: 'ประมาณการเวลาต่อราย (นาที)',
    description: 'ใช้คำนวณ ETA ของ session',
    min: 1,
    max: 60,
  },
  {
    key: 'sessionTargetMin',
    label: 'เป้าเวลา session (นาที)',
    description: 'Timer เปลี่ยนสีเหลืองที่ 100% และแดงที่ 130%',
    min: 30,
    max: 480,
  },
  {
    key: 'selfClaimLockHours',
    label: 'Lock self-claim (ชั่วโมง)',
    description: 'หยิบจาก pool แล้วต้องทำภายในเวลานี้',
    min: 1,
    max: 24,
  },
];

export default function CollectionsConfigCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CollectionsConfig>({
    queryKey: ['settings', 'collections'],
    queryFn: async () => (await api.get('/settings/collections')).data,
  });

  const [draft, setDraft] = useState<CollectionsConfig | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (body: CollectionsConfig) => api.put('/settings/collections', body),
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าแล้ว');
      qc.invalidateQueries({ queryKey: ['settings', 'collections'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  if (isLoading || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ตั้งค่าระบบเก็บเงิน</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</div>
        </CardContent>
      </Card>
    );
  }

  const dirty = !!data && JSON.stringify(data) !== JSON.stringify(draft);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ตั้งค่าระบบเก็บเงิน</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label className="leading-snug">{f.label}</Label>
            <Input
              type="number"
              min={f.min}
              max={f.max}
              value={draft[f.key]}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                const clamped = Math.max(
                  f.min,
                  Math.min(f.max, Number.isFinite(n) ? n : f.min),
                );
                setDraft({ ...draft, [f.key]: clamped });
              }}
              className="font-mono tabular-nums"
            />
            <div className="text-xs text-muted-foreground leading-snug">{f.description}</div>
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button
            variant="ghost"
            onClick={() => data && setDraft(data)}
            disabled={!dirty || save.isPending}
          >
            รีเซ็ต
          </Button>
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
            บันทึก
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
