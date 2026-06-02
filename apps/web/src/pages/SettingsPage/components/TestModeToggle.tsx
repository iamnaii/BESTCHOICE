import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { testModeApi, testModeKeys } from '@/lib/api/test-mode';

export function TestModeToggle() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);

  const statusQuery = useQuery({
    queryKey: testModeKeys.status,
    queryFn: testModeApi.get,
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => testModeApi.set(enabled),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: testModeKeys.status });
      toast.success(data.enabled ? 'เปิดโหมดทดสอบแล้ว' : 'ปิดโหมดทดสอบแล้ว');
    },
    onError: () => toast.error('ไม่สามารถบันทึกการตั้งค่าได้'),
  });

  const currentEnabled = statusQuery.data?.enabled ?? false;

  const handleToggle = (next: boolean) => {
    if (!isOwner) return;
    if (next) {
      // Turning ON bypasses safety checks — require explicit confirmation.
      setShowConfirm(true);
    } else {
      // Turning OFF restores safety — no confirm needed.
      mutation.mutate(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>โหมดทดสอบ (ปิดเช็คเครดิต/OTP/2FA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={currentEnabled}
            onCheckedChange={handleToggle}
            disabled={!isOwner || mutation.isPending}
            aria-label="Toggle Test Mode"
          />
          <span className="text-sm font-medium">
            {currentEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </span>
        </div>

        {!isOwner && (
          <p className="text-xs text-muted-foreground leading-snug">
            เฉพาะ OWNER เท่านั้นที่เปลี่ยนได้
          </p>
        )}

        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive leading-snug">
            เมื่อเปิด — ระบบจะข้ามการเช็คเครดิต, OTP และ 2FA ใช้เฉพาะตอนทดสอบเท่านั้น
            ห้ามเปิดตอนมีลูกค้าจริง
          </p>
        </div>

        <ConfirmDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          title="เปิดโหมดทดสอบ?"
          description="จะปิดเช็คเครดิต/OTP/2FA — ใช้เฉพาะตอนทดสอบ ห้ามเปิดตอนมีลูกค้าจริง"
          confirmLabel="เปิดโหมดทดสอบ"
          variant="destructive"
          loading={mutation.isPending}
          onConfirm={() => mutation.mutate(true)}
        />
      </CardContent>
    </Card>
  );
}
