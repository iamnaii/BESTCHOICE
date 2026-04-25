import { useState } from 'react';
import { ExternalLink, Download, ZoomIn, ZoomOut, RotateCcw, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  pdfUrl: string | null;
  title?: string;
  subtitle?: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

/**
 * LetterPdfPreviewDialog — Inline PDF preview using iframe.
 *
 * Approach:
 *  - Uses native browser PDF viewer via <iframe> (no extra dependency).
 *  - Zoom is implemented via CSS transform on the iframe wrapper (works on all browsers).
 *  - Mobile fallback: most mobile browsers (iOS Safari especially) do NOT render PDFs in iframes
 *    reliably, so we always expose a prominent "เปิดในแท็บใหม่" link.
 */
export default function LetterPdfPreviewDialog({
  open,
  onClose,
  pdfUrl,
  title = 'ตัวอย่าง PDF',
  subtitle,
}: Props) {
  const [zoom, setZoom] = useState(1);

  const handleZoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  const handleZoomReset = () => setZoom(1);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setZoom(1);
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-4xl w-[calc(100vw-2rem)] h-[90vh] p-0 gap-0 flex flex-col"
        showCloseButton
      >
        <DialogHeader className="px-5 pt-5 pb-3 mb-0 border-b border-border space-y-1 text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-primary" />
            {title}
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="text-xs leading-snug">{subtitle}</DialogDescription>
          )}
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-5 py-2 border-b border-border bg-muted/40">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={!pdfUrl || zoom <= MIN_ZOOM}
              className="inline-flex items-center justify-center size-8 rounded-md hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="ซูมออก"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              disabled={!pdfUrl}
              className="px-2 h-8 rounded-md text-xs font-medium tabular-nums hover:bg-accent disabled:opacity-40 transition-colors min-w-[3.5rem]"
              aria-label="รีเซ็ตซูม"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={!pdfUrl || zoom >= MAX_ZOOM}
              className="inline-flex items-center justify-center size-8 rounded-md hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="ซูมเข้า"
            >
              <ZoomIn className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              disabled={!pdfUrl || zoom === 1}
              className="inline-flex items-center justify-center size-8 rounded-md hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="รีเซ็ต"
            >
              <RotateCcw className="size-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {pdfUrl && (
              <>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium border border-input hover:bg-accent transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  เปิดในแท็บใหม่
                </a>
                <a
                  href={pdfUrl}
                  download
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Download className="size-3.5" />
                  ดาวน์โหลด
                </a>
              </>
            )}
          </div>
        </div>

        {/* PDF body */}
        <div className="flex-1 overflow-auto bg-muted/20 min-h-0">
          {pdfUrl ? (
            <div
              className={cn(
                'mx-auto h-full transition-[width,height] origin-top',
                zoom !== 1 && 'origin-top-left',
              )}
              style={{
                width: `${zoom * 100}%`,
                minHeight: `${zoom * 100}%`,
              }}
            >
              <iframe
                src={`${pdfUrl}#view=FitH`}
                title={title}
                className="w-full h-full border-0 block"
                // sandbox intentionally omitted — must allow plugin/PDF rendering
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground leading-snug">
              ยังไม่มี PDF
            </div>
          )}
        </div>

        {/* Mobile fallback hint — visible only on small screens */}
        {pdfUrl && (
          <div className="md:hidden px-5 py-2 border-t border-border bg-warning/5 text-[11px] text-muted-foreground leading-snug">
            หากแสดงผลไม่ครบบนมือถือ กรุณากด{' '}
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium underline underline-offset-2"
            >
              เปิดในแท็บใหม่
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
