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
    <section aria-label="สถานะรับแชทของฉัน" className="inbox-availability-card">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold leading-snug">คิวรับแชท</h2>
          <p className="font-semibold leading-snug">
            {query.isError ? 'เชื่อมต่อคิวไม่ได้' : ready ? 'กำลังรับแชท' : 'รับแชทตามคิว'}
          </p>
          <p className="mt-1 text-sm leading-snug text-muted-foreground" aria-live="polite">
            {query.isPending
              ? 'กำลังตรวจสอบสถานะ…'
              : query.isError
                ? 'ตรวจสอบการเชื่อมต่อ แล้วลองอีกครั้ง'
                : ready
                  ? `ลำดับที่ ${state?.position} · พร้อมรับ ${state?.readyCount} คน`
                  : `พร้อมรับ ${state?.readyCount ?? 0} คน · คุณยังไม่ได้เข้าคิว`}
          </p>
        </div>
        {query.isError ? (
          <Button variant="outline" className="min-h-11" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            ลองใหม่
          </Button>
        ) : (
          <Button
            size="sm"
            className="min-h-11 w-full"
            variant={ready ? 'outline' : 'primary'}
            disabled={query.isPending || readiness.isPending || !state?.enabled}
            onClick={() => readiness.mutate(!ready)}
          >
            {ready ? (
              <CirclePause className="size-4" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {readiness.isPending ? 'กำลังเปลี่ยน…' : ready ? 'พักรับแชท' : 'เข้าคิวรับแชท'}
          </Button>
        )}
      </div>
      {!query.isPending && !query.isError && state?.enabled && (
        <div className="mt-3">
          {state.members?.length ? (
            <ol tabIndex={0} aria-label="ลำดับคิวรับแชท" className="inbox-dispatch-roster">
              {state.members.map((member) => (
                <li key={member.position} className={member.position === 1 ? 'inbox-dispatch-next' : undefined}>
                  <span className="text-xs tabular-nums text-muted-foreground" aria-label={`ลำดับที่ ${member.position}`}>{member.position}</span>
                  <span className="inbox-dispatch-avatar" aria-hidden="true">{member.name?.charAt(0) || '–'}</span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-semibold leading-snug">{member.name || 'ทีมสาขาอื่น'}{member.isSelf && <span className="ml-1 font-normal text-muted-foreground">(คุณ)</span>}</span>
                    <span className="mt-1 block text-xs leading-snug text-muted-foreground">{member.position === 1 ? 'รับแชทถัดไป' : 'รอรับแชท'}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="rounded-lg bg-muted/40 p-3 text-sm leading-snug text-muted-foreground">{state.members ? 'ยังไม่มีคนเข้าคิว เริ่มรับแชทเป็นคนแรกได้เลย' : 'ยังโหลดรายชื่อคิวไม่ได้'}</p>}
          <p className="mt-3 text-xs leading-snug text-muted-foreground">เรียงคิวรวมบริษัท · แจกเฉพาะแชทที่มีสิทธิ์รับ</p>
        </div>
      )}
      <details className="text-xs text-muted-foreground">
      <summary className="min-h-11 cursor-pointer content-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring">วิธีรับแชทตามคิว</summary>
      <p className="leading-snug">
        รับแชทแล้วจะไปท้ายคิว · พักรับงานใหม่ได้ โดยห้องเดิมยังอยู่กับคุณ
      </p>
      <p className="mt-1 pb-3 leading-snug">
        เปิดหน้าแชทไว้ขณะทำงาน หากปิดหน้าหรือขาดการเชื่อมต่อเกิน 90 วินาที ระบบจะพักรับแชทอัตโนมัติ
      </p>
      </details>
      {readiness.isError && (
        <p role="alert" className="pb-3 text-sm text-destructive">
          {getErrorMessage(readiness.error)}
        </p>
      )}
    </section>
  );
}
