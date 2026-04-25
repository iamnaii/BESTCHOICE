import { useState } from 'react';
import { Archive, Loader2, Snowflake } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

interface Props {
  /** Public S3 URL stored on CallLog.voiceMemoUrl. */
  voiceMemoUrl: string;
  /** Storage tier — 'HOT' (immediate) or 'GLACIER' (needs restore). */
  tier?: 'HOT' | 'GLACIER' | string | null;
  /** CallLog id used to request a restore (timeline event id format: `call-<id>`). */
  callLogId?: string;
  /** Optional restore ETA hint surfaced to the user. */
  restoreEta?: string;
}

/**
 * VoiceMemoPlayback (P2 Task 4 — Collections C3).
 *
 * - HOT tier → render `<audio controls>` for immediate playback.
 * - GLACIER tier → show retention notice + "ขอดึงไฟล์กลับ" button which calls
 *   `/upload/restore-voice-memo/:callLogId` (backend stub for now — see
 *   apps/api/src/modules/storage/voice-memo-restore.controller.ts).
 */
export default function VoiceMemoPlayback({
  voiceMemoUrl,
  tier,
  callLogId,
  restoreEta = 'ใช้เวลา ~4 ชม.',
}: Props) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  if (!voiceMemoUrl) return null;

  const isGlacier = tier === 'GLACIER';

  async function handleRestore() {
    if (!callLogId) {
      toast.error('ไม่พบรหัสการโทร');
      return;
    }
    setIsRequesting(true);
    try {
      await api.post(`/upload/restore-voice-memo/${callLogId}`);
      setRequested(true);
      toast.success('ส่งคำขอดึงไฟล์เรียบร้อย ระบบจะแจ้งเตือนเมื่อพร้อม');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsRequesting(false);
    }
  }

  if (isGlacier) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 space-y-2">
        <div className="flex items-start gap-2 text-xs text-muted-foreground leading-snug">
          <Snowflake className="size-3.5 shrink-0 mt-0.5" />
          <span>
            ไฟล์เสียงเก็บในคลัง {restoreEta} ดึงกลับ
          </span>
        </div>
        <button
          type="button"
          onClick={handleRestore}
          disabled={isRequesting || requested}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-primary/10 text-primary rounded-md hover:bg-primary/15 transition-colors disabled:opacity-60 leading-snug"
        >
          {isRequesting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              กำลังส่งคำขอ...
            </>
          ) : requested ? (
            <>
              <Archive className="size-3.5" />
              ส่งคำขอแล้ว
            </>
          ) : (
            <>
              <Archive className="size-3.5" />
              ขอดึงไฟล์กลับ
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <audio
      controls
      preload="none"
      src={voiceMemoUrl}
      className="w-full max-w-xs h-8 mt-1"
    >
      เบราว์เซอร์ไม่รองรับการเล่นเสียง
    </audio>
  );
}
