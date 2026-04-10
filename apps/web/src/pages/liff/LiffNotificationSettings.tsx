import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, BellOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface NotifPrefs {
  paymentReminder: boolean;
  overdueNotice: boolean;
  receiptNotification: boolean;
}

const SETTINGS = [
  {
    key: 'paymentReminder' as const,
    label: 'แจ้งเตือนค่างวด',
    description: 'แจ้งก่อนครบกำหนดชำระ 5, 3, 1 วัน',
    emoji: '💰',
  },
  {
    key: 'overdueNotice' as const,
    label: 'แจ้งค้างชำระ',
    description: 'แจ้งเมื่อเลยกำหนดชำระ',
    emoji: '⚠️',
  },
  {
    key: 'receiptNotification' as const,
    label: 'ใบเสร็จ/ยืนยันชำระ',
    description: 'ส่งใบเสร็จหลังชำระเงินสำเร็จ',
    emoji: '🧾',
  },
];

export default function LiffNotificationSettings() {
  const { lineId, loading, error } = useLiffInit();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery<NotifPrefs>({
    queryKey: ['liff-notif-prefs', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get('/line-oa/liff/notification-preferences');
      return data;
    },
    enabled: !!lineId,
  });

  const updateMutation = useMutation({
    mutationFn: async (newPrefs: NotifPrefs) => {
      await liffApi.post('/line-oa/liff/notification-preferences', newPrefs);
      return newPrefs;
    },
    onSuccess: (newPrefs) => {
      queryClient.setQueryData(['liff-notif-prefs', lineId], newPrefs);
      toast.success('บันทึกการตั้งค่าแล้ว');
    },
    onError: () => {
      toast.error('ไม่สามารถบันทึกได้ กรุณาลองใหม่');
    },
  });

  function toggleSetting(key: keyof NotifPrefs) {
    if (!prefs) return;
    updateMutation.mutate({ ...prefs, [key]: !prefs[key] });
  }

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !prefs) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถโหลดข้อมูลได้</h2>
            <p className="text-muted-foreground text-sm">{error || 'กรุณาลงทะเบียนก่อน'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">ตั้งค่าการแจ้งเตือน</h1>
        <p className="text-xs opacity-80 mt-1">เลือกการแจ้งเตือนที่ต้องการรับผ่าน LINE</p>
      </div>

      {/* Settings */}
      <div className="space-y-3">
        {SETTINGS.map((setting) => {
          const enabled = prefs[setting.key];
          return (
            <Card key={setting.key}>
              <CardContent className="py-4">
                <button
                  className="w-full flex items-center gap-3 text-left"
                  onClick={() => toggleSetting(setting.key)}
                  disabled={updateMutation.isPending}
                >
                  <div className="text-2xl">{setting.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{setting.label}</p>
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                  <div className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info */}
      <Card className="mt-4">
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            {Object.values(prefs).every(Boolean) ? (
              <Bell className="size-4 text-primary mt-0.5" />
            ) : (
              <BellOff className="size-4 text-muted-foreground mt-0.5" />
            )}
            <p className="text-xs text-muted-foreground">
              การแจ้งเตือนจะส่งผ่าน LINE ตาม OA ที่คุณติดตาม
              สามารถเปลี่ยนได้ตลอดเวลา
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Back */}
      <div className="text-center mt-4">
        <Button variant="ghost" mode="link" className="text-primary" asChild>
          <a href={`/liff/profile${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
            ← กลับไปโปรไฟล์
          </a>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
