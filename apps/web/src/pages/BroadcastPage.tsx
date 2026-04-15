import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, Users } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import QueryBoundary from '@/components/QueryBoundary';

export default function BroadcastPage() {
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const statsQuery = useQuery({
    queryKey: ['line-oa-broadcast-stats'],
    queryFn: async () => {
      const res = await api.get<{ followers: number }>('/line-oa/broadcast/stats');
      return res.data;
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await api.post<{ success: boolean; message: string }>('/line-oa/broadcast', {
        type: 'text',
        text,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        setMessage('');
      } else {
        toast.error(data.message);
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const handleSend = () => {
    if (!message.trim()) {
      toast.error('กรุณาพิมพ์ข้อความก่อนส่ง');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    broadcastMutation.mutate(message.trim());
  };

  return (
    <QueryBoundary
      isLoading={statsQuery.isLoading}
      isError={statsQuery.isError}
      error={statsQuery.error}
      onRetry={statsQuery.refetch}
    >
      <div className="space-y-6">
        <PageHeader
          title="LINE Broadcast"
          subtitle="ส่งข้อความหาผู้ติดตาม LINE OA ทั้งหมด"
          icon={<Send className="size-5" />}
        />

        {/* Stats card */}
        <div className="card">
          <div className="card-body flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
              <Users className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">ผู้ติดตาม LINE OA</p>
              <p className="text-2xl font-bold text-foreground">
                {(statsQuery.data?.followers ?? 0).toLocaleString()} คน
              </p>
            </div>
          </div>
        </div>

        {/* Compose card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">เขียนข้อความ</h3>
          </div>
          <div className="card-body space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                ข้อความที่ต้องการส่ง
              </label>
              <textarea
                className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="พิมพ์ข้อความที่ต้องการ broadcast..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={5000}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {message.length} / 5,000 ตัวอักษร
              </p>
            </div>

            {/* Preview */}
            {message.trim() && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-foreground">ตัวอย่างข้อความ</p>
                <div className="rounded-lg bg-muted p-4">
                  <div className="inline-block max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 shadow-sm">
                    <p className="whitespace-pre-wrap text-sm text-gray-800">{message}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleSend}
                disabled={broadcastMutation.isPending || !message.trim()}
                className="gap-2"
              >
                <Send className="size-4" />
                {broadcastMutation.isPending ? 'กำลังส่ง...' : 'ส่ง Broadcast'}
              </Button>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="ยืนยันการส่ง Broadcast"
          description={`ต้องการส่งข้อความนี้ไปยังผู้ติดตาม${statsQuery.data?.followers ? ` ${statsQuery.data.followers.toLocaleString()} คน` : ''}ทั้งหมดใช่หรือไม่?`}
          confirmLabel="ส่ง Broadcast"
          onConfirm={handleConfirm}
          loading={broadcastMutation.isPending}
        />
      </div>
    </QueryBoundary>
  );
}
