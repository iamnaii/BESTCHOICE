import { useEffect, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
/** Image height at 100% zoom, as vh — leaves room for the control bar. */
const BASE_VH = 80;

interface ImageLightboxProps {
  /** Image URL to show; null = closed. */
  src: string | null;
  alt?: string;
  onClose: () => void;
}

/**
 * Fullscreen image viewer (CHATCONE-style): dark overlay, − / % / + zoom bar,
 * close via X / ESC / backdrop click. Zoom changes the image's LAYOUT height
 * (not transform:scale — transforms don't grow the scroll area, so a scaled
 * image's edges become unreachable) and the flex + m-auto wrapper keeps it
 * centered while overflow-auto gives native scroll panning in both axes.
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);

  // A new image always starts at 100%.
  useEffect(() => {
    setScale(1);
  }, [src]);

  const zoomBy = (dir: 1 | -1) =>
    setScale((s) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s + dir * ZOOM_STEP)));

  return (
    <Dialog open={!!src} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-w-[96vw] w-[96vw] h-[92vh] p-0 border-0 bg-transparent shadow-none"
      >
        <DialogTitle className="sr-only">ดูรูปภาพ</DialogTitle>

        {src && (
          <div className="flex h-full w-full overflow-auto rounded-lg">
            <img
              src={src}
              alt={alt ?? 'รูปภาพ'}
              draggable={false}
              className="m-auto block select-none shrink-0"
              style={{ height: `${scale * BASE_VH}vh`, width: 'auto', maxWidth: 'none' }}
              onDoubleClick={() => setScale((s) => (s === 1 ? 2 : 1))}
            />
          </div>
        )}

        <button
          type="button"
          aria-label="ปิด"
          onClick={onClose}
          className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full bg-background/90 border border-border text-foreground shadow-lg hover:bg-accent"
        >
          <X className="size-5" />
        </button>

        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-background/90 border border-border px-2 py-1 shadow-lg">
          <button
            type="button"
            aria-label="ซูมออก"
            disabled={scale <= ZOOM_MIN}
            onClick={() => zoomBy(-1)}
            className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
          >
            <Minus className="size-5" />
          </button>
          <span className="w-14 text-center text-sm tabular-nums text-foreground">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            aria-label="ซูมเข้า"
            disabled={scale >= ZOOM_MAX}
            onClick={() => zoomBy(1)}
            className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
          >
            <Plus className="size-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
