import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CHAT_WORK_FLAGS, type ChatWorkFlag } from '@installment/shared';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useChatWorkSettings } from '../UnifiedInboxPage/hooks/useChatWork';
const labels: Record<ChatWorkFlag, string> = {
  chat_work_queue_enabled: 'คิวงานแชท',
  chat_sla_alerts_enabled: 'แจ้งเตือนเวลารอ',
  chat_follow_up_enabled: 'ติดตามการขาย',
  chat_mentions_enabled: 'กล่าวถึงและส่งงาน',
  chat_facebook_comments_enabled: 'คอมเมนต์ Facebook',
  chat_service_requests_enabled: 'รับเรื่องหลังการขาย',
  chat_analytics_v2_enabled: 'รายงานงานแชท',
  chat_cloud_library_enabled: 'คลังไฟล์ในระบบ',
};
type Settings = {
  flags: Record<ChatWorkFlag, boolean>;
  policy: { ownerMinutes: number; managerMinutes: number };
};
export default function ChatWorkSettingsDialog({ onClose }: { onClose: () => void }) {
  const work = useChatWorkSettings();
  const query = useQuery({
    queryKey: [...work.key, 'settings'],
    queryFn: () =>
      api.get<Settings>('/staff-chat/work-settings', { params: work.scope }).then((r) => r.data),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>ตั้งค่างานแชท</DialogTitle>
        <DialogDescription>
          สำหรับเจ้าของ · การเปิดฟีเจอร์และเกณฑ์เตือนมีผลทั้งระบบ เกณฑ์ใหม่ใช้กับรอบใหม่
        </DialogDescription>
        <QueryBoundary
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && <SettingsForm initial={query.data} onClose={onClose} />}
        </QueryBoundary>
      </DialogContent>
    </Dialog>
  );
}
function SettingsForm({ initial, onClose }: { initial: Settings; onClose: () => void }) {
  const [owner, setOwner] = useState(initial.policy.ownerMinutes),
    [manager, setManager] = useState(initial.policy.managerMinutes),
    [flags, setFlags] = useState(initial.flags),
    [error, setError] = useState('');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api.patch('/staff-chat/work-settings', {
        ownerMinutes: owner,
        managerMinutes: manager,
        flags: CHAT_WORK_FLAGS.filter((key) => flags[key] !== initial.flags[key]).map((key) => ({
          key,
          enabled: flags[key],
        })),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      toast.success('บันทึกการตั้งค่างานแชทแล้ว');
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  return (
    <form
      className="space-y-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          เตือนผู้ดูแลเมื่อรอ (นาที)
          <input
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
            type="number"
            min={1}
            max={1440}
            required
            value={owner}
            onChange={(e) => setOwner(Number(e.target.value))}
          />
        </label>
        <label>
          เตือนหัวหน้าเมื่อรอ (นาที)
          <input
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3"
            type="number"
            min={owner}
            max={1440}
            required
            value={manager}
            onChange={(e) => setManager(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="text-muted-foreground">
        นับตามเวลาทำงาน กรุงเทพฯ · SHOP 10:00–19:00 · FINANCE 10:00–20:00
      </p>
      <div className="divide-y rounded-lg border px-3">
        {CHAT_WORK_FLAGS.map((key) => (
          <label key={key} className="flex min-h-11 items-center justify-between gap-3 py-2">
            <span>{labels[key]}</span>
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
              className="size-5 accent-primary"
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
      </Button>
    </form>
  );
}
