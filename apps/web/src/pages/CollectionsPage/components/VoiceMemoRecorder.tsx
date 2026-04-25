import { useEffect, useMemo, useState } from 'react';
import { Mic, MicOff, Play, Pause, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useMediaRecorder } from '../hooks/useMediaRecorder';

const MAX_DURATION_SEC = 60;

interface Props {
  /** When set, recorder is disabled (e.g. while parent dialog is submitting). */
  disabled?: boolean;
  /**
   * Fires once the blob has been uploaded to S3 and we have a public URL.
   * Parent stores the URL on its form state and submits with the contact log.
   */
  onUploaded: (publicUrl: string) => void;
  /** Fires when user clears a previously-uploaded memo. */
  onCleared?: () => void;
  /** If a URL is already attached (e.g. parent re-render), show the cleared/saved state. */
  uploadedUrl?: string | null;
}

function formatSeconds(s: number): string {
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function pickExtension(mime: string | null): string {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  return 'webm';
}

/**
 * VoiceMemoRecorder (P2 Task 4 — Collections C3).
 *
 * Workflow:
 *  1. User taps Mic → permission prompt → recording starts (auto-stops at 60s).
 *  2. User taps Stop → preview player appears.
 *  3. User taps Save → blob is uploaded via presigned URL to S3 (kind=VOICE_MEMO).
 *  4. Parent receives `publicUrl` via `onUploaded` and stores it for submit.
 */
export default function VoiceMemoRecorder({
  disabled = false,
  onUploaded,
  onCleared,
  uploadedUrl,
}: Props) {
  const {
    startRecording,
    stopRecording,
    clearRecording,
    isRecording,
    audioBlob,
    duration,
    mimeType,
    isSupported,
  } = useMediaRecorder();

  const [isUploading, setIsUploading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewAudio] = useState<HTMLAudioElement | null>(() =>
    typeof Audio !== 'undefined' ? new Audio() : null,
  );

  const previewUrl = useMemo(
    () => (audioBlob ? URL.createObjectURL(audioBlob) : null),
    [audioBlob],
  );

  // Hook up preview audio + revoke object URL on change/unmount
  useEffect(() => {
    if (!previewAudio) return;
    if (previewUrl) {
      previewAudio.src = previewUrl;
    } else {
      previewAudio.removeAttribute('src');
    }
    const handleEnd = () => setIsPreviewPlaying(false);
    previewAudio.addEventListener('ended', handleEnd);
    return () => {
      previewAudio.removeEventListener('ended', handleEnd);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewAudio, previewUrl]);

  function handleTogglePreview() {
    if (!previewAudio || !previewUrl) return;
    if (isPreviewPlaying) {
      previewAudio.pause();
      setIsPreviewPlaying(false);
    } else {
      previewAudio.currentTime = 0;
      void previewAudio.play();
      setIsPreviewPlaying(true);
    }
  }

  async function handleStart() {
    try {
      await startRecording();
    } catch {
      // toast handled inside hook
    }
  }

  function handleClear() {
    if (previewAudio) {
      previewAudio.pause();
      setIsPreviewPlaying(false);
    }
    clearRecording();
    onCleared?.();
  }

  async function handleUpload() {
    if (!audioBlob) return;
    setIsUploading(true);
    try {
      const contentType = audioBlob.type || mimeType || 'audio/webm';
      const ext = pickExtension(contentType);
      const { data: presigned } = await api.post('/shop/upload/signed-url', {
        kind: 'VOICE_MEMO',
        contentType,
      });
      const up = await fetch(presigned.uploadUrl, {
        method: presigned.method ?? 'PUT',
        body: audioBlob,
        headers: { 'Content-Type': contentType },
      });
      if (!up.ok) throw new Error('อัปโหลดเสียงไม่สำเร็จ');
      onUploaded(presigned.publicUrl);
      toast.success(`บันทึกเสียงสำเร็จ (.${ext})`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsUploading(false);
    }
  }

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground leading-snug">
        เบราว์เซอร์นี้ไม่รองรับการอัดเสียง
      </div>
    );
  }

  // Already uploaded → compact saved state with clear option
  if (uploadedUrl) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2">
        <CheckCircle2 className="size-4 text-success shrink-0" />
        <span className="text-xs text-success leading-snug flex-1">
          แนบเสียงบันทึกแล้ว
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
        >
          ลบ
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        {!isRecording && !audioBlob && (
          <button
            type="button"
            onClick={handleStart}
            disabled={disabled}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/15 transition-colors disabled:opacity-50 leading-snug"
          >
            <Mic className="size-4" />
            อัดเสียงบันทึก
          </button>
        )}

        {isRecording && (
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/15 transition-colors leading-snug"
          >
            <MicOff className="size-4" />
            หยุดอัด
          </button>
        )}

        {isRecording && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums leading-snug">
            <span className="size-2 rounded-full bg-destructive animate-pulse" aria-hidden />
            {formatSeconds(duration)} / {formatSeconds(MAX_DURATION_SEC)}
          </div>
        )}

        {!isRecording && audioBlob && (
          <>
            <button
              type="button"
              onClick={handleTogglePreview}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors leading-snug"
            >
              {isPreviewPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              ฟังก่อนบันทึก
            </button>
            <span className="text-xs text-muted-foreground tabular-nums leading-snug">
              {formatSeconds(duration)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleClear}
                disabled={isUploading}
                className="p-2 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                aria-label="ลบเสียง"
              >
                <Trash2 className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={disabled || isUploading}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 leading-snug"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'บันทึกเสียง'
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {!isRecording && !audioBlob && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          อัดได้สูงสุด {MAX_DURATION_SEC} วินาที — เก็บเป็นหลักฐานการสนทนากับลูกค้า
        </p>
      )}
    </div>
  );
}
