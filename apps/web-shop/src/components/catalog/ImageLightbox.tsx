import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { GalleryImage } from './GalleryImage';
import { useGallerySwipe } from './useGallerySwipe';

export function ImageLightbox({
  images,
  open,
  index,
  onOpenChange,
  onIndexChange,
  alt,
}: {
  images: string[];
  open: boolean;
  index: number;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
  alt: string;
}) {
  const [zoom, setZoom] = useState(false);
  const go = (direction: number) => {
    if (images.length < 2) return;
    setZoom(false);
    onIndexChange((index + direction + images.length) % images.length);
  };
  const swipe = useGallerySwipe(go, !zoom && images.length > 1);
  useEffect(() => {
    setZoom(false);
  }, [open, index]);
  const src = images[index] ?? images[0];
  if (!src) return null;
  const control =
    'grid size-11 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="fullscreen"
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 p-0 bg-background/95"
        onKeyDown={(event) => {
          if (!zoom && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            event.stopPropagation();
            go(event.key === 'ArrowRight' ? 1 : -1);
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-3">
          <DialogTitle className="text-sm truncate">{alt}</DialogTitle>
          <DialogClose className={control} aria-label="ปิดรูปขยาย">
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
        </div>
        <div
          className={`relative flex min-h-0 flex-1 overflow-auto ${zoom ? 'items-start justify-start' : 'items-center justify-center'}`}
          style={{ touchAction: zoom ? 'auto' : 'pan-y pinch-zoom' }}
          {...swipe}
        >
          <button
            type="button"
            aria-label={zoom ? 'ย่อรูป' : 'ขยายรูป'}
            aria-pressed={zoom}
            onClick={() => setZoom(!zoom)}
            className={`relative flex items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary ${zoom ? 'h-[200%] min-w-[200%] self-start justify-start cursor-zoom-out' : 'h-full w-full cursor-zoom-in'}`}
          >
            <GalleryImage
              key={src}
              src={src}
              alt={`${alt} รูปที่ ${index + 1}`}
              className={zoom ? 'h-full w-full' : ''}
            />
          </button>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-4 border-t border-border p-3">
          <button
            type="button"
            aria-label="รูปก่อนหน้า"
            disabled={images.length < 2}
            onClick={() => go(-1)}
            className={`${control} disabled:opacity-40`}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <span role="status" aria-live="polite" className="min-w-14 text-center text-sm">
            {index + 1} / {images.length}
          </span>
          <button
            type="button"
            aria-label="รูปถัดไป"
            disabled={images.length < 2}
            onClick={() => go(1)}
            className={`${control} disabled:opacity-40`}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={zoom ? 'ย่อรูป' : 'ขยายรูป'}
            aria-pressed={zoom}
            onClick={() => setZoom(!zoom)}
            className={control}
          >
            {zoom ? (
              <ZoomOut className="size-5" aria-hidden="true" />
            ) : (
              <ZoomIn className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
