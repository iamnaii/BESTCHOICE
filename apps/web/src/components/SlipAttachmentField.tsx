import { CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { SLIP_MIME_TYPES } from '@/hooks/useSlipUpload';
import type { useSlipAttachment } from '@/hooks/useSlipAttachment';

export function SlipAttachmentField({
  attachment,
}: {
  attachment: ReturnType<typeof useSlipAttachment>;
}) {
  const { slipUrl, slipFileName, fileInputRef, uploadMutation, handleFileChange, handleClearSlip } =
    attachment;
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={SLIP_MIME_TYPES.join(',')}
        className="hidden"
        aria-label="อัปโหลดสลิป"
        onChange={handleFileChange}
      />
      {slipUrl ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2.5">
          <CheckCircle2 className="size-4 text-success shrink-0" />
          <span className="text-sm text-foreground leading-snug truncate flex-1">
            {slipFileName || 'สลิปอัปโหลดแล้ว'}
          </span>
          <button
            type="button"
            onClick={handleClearSlip}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="ลบสลิป"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-accent transition-colors disabled:opacity-60 disabled:pointer-events-none"
        >
          {uploadMutation.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span className="leading-snug">กำลังอัปโหลด...</span>
            </>
          ) : (
            <>
              <Upload className="size-4" />
              <span className="leading-snug">คลิกเพื่ออัปโหลดสลิป (JPG/PNG/PDF)</span>
            </>
          )}
        </button>
      )}
    </>
  );
}
