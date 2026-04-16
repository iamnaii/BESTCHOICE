import { useState } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LIFF_ERRORS } from '@/constants/liff-errors';

import type { LiffProfileResponse as ProfileData } from '@installment/shared';

export default function LiffProfile() {
  const { lineId, profile, loading, error } = useLiffInit();
  const [unlinked, setUnlinked] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const { data, isLoading: dataLoading, error: dataError } = useQuery<ProfileData>({
    queryKey: ['liff-profile', lineId],
    queryFn: async () => {
      const { data } = await liffApi
        .get(`/line-oa/liff/profile?lineId=${encodeURIComponent(lineId!)}`)
        .catch((err) => {
          if (err.response?.status === 404) throw new Error(LIFF_ERRORS.NOT_REGISTERED);
          throw new Error(LIFF_ERRORS.LOAD_FAILED);
        });
      return data;
    },
    enabled: !!lineId,
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      const { data: result } = await liffApi.post('/line-oa/liff/unlink', { lineId });
      return result;
    },
    onSuccess: () => {
      setUnlinked(true);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    },
  });

  function handleUnlink() {
    setConfirmDialog({
      open: true,
      message: 'ต้องการยกเลิกผูก LINE จริงหรือไม่?\n\nหลังจากยกเลิก จะไม่สามารถใช้งานผ่าน LINE ได้อีก ต้องลงทะเบียนใหม่',
      action: () => unlinkMutation.mutate(),
    });
  }

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error || dataError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{error || (dataError as Error)?.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (unlinked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-muted-foreground text-5xl mb-4">👋</div>
            <h2 className="text-lg font-bold mb-2">ยกเลิกผูก LINE แล้ว</h2>
            <p className="text-muted-foreground text-sm">
              บัญชี LINE ของคุณถูกยกเลิกการเชื่อมต่อกับระบบแล้ว
            </p>
            <Button variant="primary" size="lg" className="mt-6" asChild>
              <a href={`/liff/register${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                ลงทะเบียนใหม่
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#059669] rounded-xl p-5 text-white shadow-md mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">โปรไฟล์ของฉัน</h1>
      </div>

      {/* Profile Info */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">ข้อมูลส่วนตัว</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">ชื่อ</span>
              <span className="text-sm font-medium">{data.name}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">เบอร์โทร</span>
              <span className="text-sm font-medium">{data.phone}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">LINE</span>
              <span className="text-sm font-medium">{profile?.displayName || data.lineDisplayName || '-'}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">จำนวนสัญญา</span>
              <span className="text-sm font-medium">{data.contractCount} สัญญา</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loyalty Points */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">แต้มสะสม</h2>
          <div className="flex items-center justify-between bg-[#f0f5ff] rounded-lg p-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">แต้มสะสมของคุณ</p>
              <p className="text-2xl font-bold text-primary">
                {(data.totalPoints ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">แต้ม</p>
            </div>
            <div className="text-right text-xs text-muted-foreground space-y-1">
              <p>ชำระตรงเวลา = 1 แต้ม / 100 บาท</p>
              <p>ใช้แลกส่วนลดดาวน์เครื่องใหม่</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <Button variant="primary" size="md" className="w-full mb-2" asChild>
            <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ดูสัญญาของฉัน
            </a>
          </Button>
          <Button variant="outline" size="md" className="w-full mb-2" asChild>
            <a href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ประวัติชำระเงิน
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Unlink */}
      <div className="text-center mt-6">
        <Button
          variant="ghost"
          mode="link"
          className="text-destructive text-xs"
          onClick={handleUnlink}
          disabled={unlinkMutation.isPending}
        >
          {unlinkMutation.isPending ? 'กำลังดำเนินการ...' : 'ยกเลิกผูก LINE'}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} title="ยืนยันยกเลิก" description={confirmDialog.message} variant="destructive" onConfirm={confirmDialog.action} />
    </div>
  );
}
