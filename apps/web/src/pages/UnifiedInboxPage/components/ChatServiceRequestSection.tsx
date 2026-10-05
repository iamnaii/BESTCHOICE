import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { useChatServiceRequests } from '../hooks/useChatServiceRequests';
import ChatServiceRequestDialog from './ChatServiceRequestDialog';
import ChatServiceRequestCard from './ChatServiceRequestCard';
import { workDate } from './WorkQueue';
export default function ChatServiceRequestSection({ roomId }: { roomId: string }) {
  const work = useChatWorkSettings(),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const list = useChatServiceRequests(roomId, page);
  if (!work.settings.data?.flags.chat_service_requests_enabled || work.settings.isError)
    return null;
  return (
    <section className="space-y-3 border-b pb-4" aria-label="ติดตามหลังการขาย">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">ติดตามหลังการขาย</h3>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          รับเรื่องหลังการขาย
        </Button>
      </div>
      {list.isError ? (
        <p role="alert" className="text-sm">
          โหลดใบรับเรื่องไม่ได้{' '}
          <Button variant="ghost" size="sm" onClick={() => list.refetch()}>
            ลองใหม่
          </Button>
        </p>
      ) : list.isPending ? (
        <p role="status" className="text-xs">
          กำลังโหลด…
        </p>
      ) : list.data?.data.length ? (
        list.data.data.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className="block w-full min-w-0 rounded-lg border p-3 text-left text-sm leading-snug hover:bg-accent"
          >
            <span className="block break-words font-medium">{r.symptom}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {r.todo.assignee?.name || 'ไม่ระบุผู้ติดตาม'} ·{' '}
              {r.todo.dueDate ? workDate(r.todo.dueDate) : 'ยังไม่มีนัด'}
            </span>
            <span className="mt-1 block text-xs">
              {r.status === 'LINKED'
                ? 'เชื่อมเคสแล้ว'
                : r.status === 'RESOLVED'
                  ? 'แก้ปัญหาแล้ว'
                  : r.status === 'CANCELLED'
                    ? 'ยกเลิก'
                    : r.status === 'WAITING_CUSTOMER'
                      ? 'รอลูกค้า'
                      : 'รับเรื่องแล้ว'}
            </span>
          </button>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">ยังไม่มีใบรับเรื่องในห้องนี้</p>
      )}
      {(list.data?.total ?? 0) > 10 && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            ก่อนหน้า
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page * 10 >= (list.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            ถัดไป
          </Button>
        </div>
      )}
      {creating && (
        <ChatServiceRequestDialog
          roomId={roomId}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      )}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>ติดตามหลังการขาย</DialogTitle>
          <DialogDescription>ใบรับเรื่องและสถานะจากเคสจริง</DialogDescription>
          {selected && <ChatServiceRequestCard key={selected} requestId={selected} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
