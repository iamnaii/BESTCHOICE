import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components';

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
  onOpenChange: (o: boolean) => void;
  onIndexChange: (i: number) => void;
  alt: string;
}) {
  const [zoom, setZoom] = useState(false);
  const src = images[index] ?? images[0];
  const go = (d: number) => {
    setZoom(false);
    onIndexChange((index + d + images.length) % images.length);
  };

  useEffect(() => {
    setZoom(false);
  }, [open, index]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="fullscreen"
        className="p-0 bg-background/95 items-center justify-center"
      >
        <DialogTitle className="sr-only">ดูรูปภาพ</DialogTitle>
        <div className="relative flex-1 w-full flex items-center justify-center overflow-auto">
          <img
            src={src}
            alt={alt}
            onClick={() => setZoom((z) => !z)}
            className={
              zoom
                ? 'max-w-none max-h-none w-auto h-auto cursor-zoom-out scale-[2] origin-center transition-transform'
                : 'max-h-full max-w-full object-contain cursor-zoom-in transition-transform'
            }
          />
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="รูปก่อนหน้า"
                onClick={() => go(-1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-background/80 border border-border flex items-center justify-center"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label="รูปถัดไป"
                onClick={() => go(1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-10 rounded-full bg-background/80 border border-border flex items-center justify-center"
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs bg-background/80 border border-border rounded-full px-3 py-1 leading-snug">
                {index + 1} / {images.length}
              </span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
