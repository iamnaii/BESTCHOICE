import { Check, Copy, MessageCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { Confirmation } from './types';

export default function ConfirmationMessage({
  confirmation,
  onRetry,
  retrying = false,
}: {
  confirmation?: Confirmation | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { copy, copied, error } = useCopyToClipboard();
  if (!confirmation) return null;
  const status = confirmation.status;
  const pending = status === 'PENDING' || status === 'SENDING';
  const saved =
    confirmation.kind === 'CANCELED' ? 'บันทึกการยกเลิกนัดเรียบร้อยแล้ว' : 'บันทึกนัดเรียบร้อยแล้ว';
  const sent = status === 'SENT';
  const label = sent
    ? 'ส่งข้อความยืนยันเข้าแชทแล้ว'
    : pending
      ? 'กำลังส่งข้อความยืนยันเข้าแชทเดิม'
      : status === 'UNKNOWN'
        ? 'ยังยืนยันผลการส่งข้อความไม่ได้'
        : status === 'BLOCKED'
          ? 'รอตรวจสอบผลข้อความก่อนหน้า'
          : status === 'NO_CHANNEL'
            ? 'ยังส่งข้อความเข้าแชทไม่ได้'
            : status === 'SUPERSEDED'
              ? 'ข้อความนี้ถูกแทนด้วยข้อมูลนัดล่าสุดแล้ว'
              : 'ส่งข้อความยืนยันไม่สำเร็จ';
  return (
    <section
      className="rounded-xl border border-border bg-background p-4"
      aria-label="ข้อความยืนยันนัด"
    >
      <div className="flex items-start gap-3" role="status">
        <MessageCircle
          aria-hidden="true"
          className={`mt-0.5 size-5 shrink-0 ${sent ? 'text-primary' : 'text-muted-foreground'}`}
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {sent
              ? 'เปิดดูรายละเอียดนัดในแชทที่คุยกับ BESTCHOICE ได้เลยครับ'
              : pending
                ? `${saved} รอสักครู่เพื่อดูผลการส่ง`
                : status === 'UNKNOWN'
                  ? `${saved} กรุณาตรวจแชทเดิมหรือติดต่อสาขา`
                  : `${saved} เก็บรายละเอียดด้านล่างไว้และติดต่อสาขาได้ครับ`}
          </p>
        </div>
      </div>
      {status === 'FAILED' && onRetry && (
        <Button className="mt-3 min-h-11" variant="outline" disabled={retrying} onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-4" />
          {retrying ? 'กำลังส่ง…' : 'ลองส่งข้อความอีกครั้ง'}
        </Button>
      )}
      <details className="mt-3 border-t border-border pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
          ดูข้อความยืนยัน
        </summary>
        <label className="block">
          <span className="sr-only">ข้อความยืนยันนัดหมาย</span>
          <textarea
            readOnly
            value={confirmation.text}
            rows={9}
            className="w-full resize-y rounded-lg border border-input bg-card p-3 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-primary"
          />
        </label>
        <Button
          variant="outline"
          className="mt-2 min-h-11 w-full"
          onClick={() => void copy(confirmation.text)}
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          {copied ? 'คัดลอกข้อความแล้ว' : 'คัดลอกข้อความยืนยัน'}
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            คัดลอกไม่ได้ กรุณาเลือกข้อความด้านบนแล้วคัดลอกเอง
          </p>
        )}
        <span className="sr-only" role="status">
          {copied ? 'คัดลอกข้อความแล้ว' : ''}
        </span>
      </details>
    </section>
  );
}
