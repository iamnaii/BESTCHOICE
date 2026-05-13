import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { MakerCheckerConfirmDialog } from './MakerCheckerConfirmDialog';
import { otherIncomeApi } from '@/lib/otherIncome';

export function MakerCheckerToggle() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingNext, setPendingNext] = useState<boolean | null>(null);

  const enabledQuery = useQuery({
    queryKey: ['other-income', 'maker-checker', 'enabled'],
    queryFn: () => otherIncomeApi.isMakerCheckerEnabled(),
  });

  const pendingCountQuery = useQuery({
    queryKey: ['other-income', 'maker-checker', 'pending-ready-count'],
    queryFn: () => otherIncomeApi.getPendingReadyCount(),
    enabled: showConfirm && pendingNext === false, // only fetch when turning OFF
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => otherIncomeApi.setMakerCheckerEnabled(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other-income', 'maker-checker'] });
      queryClient.invalidateQueries({ queryKey: ['other-income-maker-checker-enabled'] });
      toast.success('บันทึกการตั้งค่าสำเร็จ');
    },
    onError: () => toast.error('ไม่สามารถบันทึกการตั้งค่าได้'),
  });

  const currentEnabled = enabledQuery.data ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>ระบบ Maker-Checker (ผู้สร้าง ≠ ผู้อนุมัติ)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={currentEnabled}
            onCheckedChange={(next) => {
              if (!isOwner) return;
              setPendingNext(next);
              setShowConfirm(true);
            }}
            disabled={!isOwner || mutation.isPending}
            aria-label="Toggle Maker-Checker"
          />
          <span className="text-sm font-medium">
            {currentEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </span>
        </div>

        {!isOwner && (
          <p className="text-xs text-muted-foreground">เฉพาะ OWNER เท่านั้นที่เปลี่ยนได้</p>
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted p-3">
          <Info className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            เมื่อเปิด — เอกสารทุกฉบับต้องผ่านผู้อนุมัติก่อน POST (segregation of duties)
          </p>
        </div>

        <MakerCheckerConfirmDialog
          open={showConfirm}
          nextValue={pendingNext}
          pendingReadyCount={pendingCountQuery.data ?? 0}
          onConfirm={() => {
            mutation.mutate(pendingNext!);
            setShowConfirm(false);
            setPendingNext(null);
          }}
          onCancel={() => {
            setShowConfirm(false);
            setPendingNext(null);
          }}
        />
      </CardContent>
    </Card>
  );
}
