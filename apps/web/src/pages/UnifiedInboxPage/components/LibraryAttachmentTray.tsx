import { Check, FileText, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { useLibraryDraft } from '../hooks/useLibraryDraft';
export default function LibraryAttachmentTray({
  draft,
}: {
  draft: ReturnType<typeof useLibraryDraft>;
}) {
  if (!draft.items.length) return null;
  const label = {
    STAGED: 'เตรียมไว้แล้ว',
    SENDING: 'กำลังดำเนินการ…',
    SENT: draft.purpose === 'credit' ? 'เพิ่มในตรวจเครดิตแล้ว' : 'ส่งสำเร็จ',
    FAILED: 'ไม่สำเร็จ · ลองใหม่ได้',
    VERIFY: 'รอตรวจผล · ใช้คำขอเดิมเพื่อป้องกันส่งซ้ำ',
    UNKNOWN: 'รอยืนยัน · ตรวจในช่องทางก่อน',
  };
  return (
    <div
      className="m-2 space-y-2 rounded-lg border border-border bg-background p-2 text-sm"
      data-library-staged
    >
      <p className="font-medium">
        {draft.purpose === 'credit' ? 'ไฟล์เตรียมตรวจเครดิต' : 'ไฟล์เตรียมส่ง'}
      </p>
      <ul className="max-h-44 space-y-1 overflow-y-auto">
        {draft.items.map((item) => (
          <li
            key={item.requestKey}
            className="flex min-w-0 items-center gap-2 rounded bg-muted/50 px-2"
          >
            {item.status === 'SENDING' ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : item.status === 'SENT' ? (
              <Check className="size-4 shrink-0 text-primary" />
            ) : (
              <FileText className="size-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1 py-1">
              <p className="truncate" title={item.file.name}>
                {item.file.name}
              </p>
              <p className="text-xs text-muted-foreground" role="status">
                {label[item.status]}
              </p>
              {item.error && <p className="break-words text-xs text-destructive">{item.error}</p>}
            </div>
            <button
              type="button"
              className="grid min-h-11 min-w-11 place-items-center rounded hover:bg-muted disabled:opacity-40"
              disabled={item.status === 'SENDING' || item.status === 'UNKNOWN' || item.status === 'VERIFY'}
              aria-label={`นำ ${item.file.name} ออก`}
              onClick={() => draft.remove(item.requestKey)}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {draft.purpose === 'chat' &&
        draft.items.some((i) => i.file.mimeType === 'application/pdf') && (
          <p className="text-xs text-muted-foreground">
            PDF ส่งเป็นลิงก์ดาวน์โหลดที่เปิดได้ภายใน 15 นาที
          </p>
        )}
      <Button
        type="button"
        className="min-h-11 w-full"
        disabled={!draft.canSend}
        onClick={() => void draft.send()}
      >
        {draft.purpose === 'credit' ? 'เพิ่มในตรวจเครดิต' : draft.items.some(i=>i.status==='VERIFY') ? 'ตรวจผลการส่ง' : 'ส่งไฟล์ที่เลือก'}
      </Button>
    </div>
  );
}
