import { CirclePause, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api';
import type { useChatDispatch } from '../hooks/useChatDispatch';

export default function ChatDispatchCard({
  dispatch,
}: {
  dispatch: ReturnType<typeof useChatDispatch>;
}) {
  const { query, readiness } = dispatch;
  const state = query.data;
  const ready = !query.isError && !!state?.ready;
  return (
    <section aria-label="สถานะรับแชทของฉัน" className="shrink-0 border-b bg-muted/30 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">
            {query.isError ? 'เชื่อมต่อคิวไม่ได้' : ready ? 'คุณพร้อมรับแชท' : 'เริ่มรับแชทตามคิว'}
          </p>
          <p className="mt-1 text-sm leading-snug text-muted-foreground" aria-live="polite">
            {query.isPending
              ? 'กำลังตรวจสอบสถานะ…'
              : query.isError
                ? 'ตรวจสอบการเชื่อมต่อ แล้วลองอีกครั้ง'
                : ready
                  ? `ลำดับที่ ${state?.position} · พร้อมรับ ${state?.readyCount} คน`
                  : 'กดพร้อมรับแชท เพื่อเข้าต่อท้ายคิวของทีม'}
          </p>
        </div>
        {query.isError ? (
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            ลองใหม่
          </Button>
        ) : (
          <Button
            size="sm"
            variant={ready ? 'outline' : 'primary'}
            disabled={query.isPending || readiness.isPending || !state?.enabled}
            onClick={() => readiness.mutate(!ready)}
          >
            {ready ? (
              <CirclePause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {readiness.isPending ? 'กำลังเปลี่ยน…' : ready ? 'พักรับแชท' : 'พร้อมรับแชท'}
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs leading-snug text-muted-foreground">
        รับแชทแล้วจะไปท้ายคิว · พักรับงานใหม่ได้ โดยห้องเดิมยังอยู่กับคุณ
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        เปิดหน้าแชทไว้ขณะทำงาน หากปิดหน้าหรือขาดการเชื่อมต่อเกิน 90 วินาที ระบบจะพักรับแชทอัตโนมัติ
      </p>
      {readiness.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {getErrorMessage(readiness.error)}
        </p>
      )}
    </section>
  );
}
