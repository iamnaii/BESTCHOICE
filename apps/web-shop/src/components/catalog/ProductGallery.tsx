import { useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox';
import { Product360Viewer } from './Product360Viewer';
import { GalleryImage } from './GalleryImage';
import { useGallerySwipe } from './useGallerySwipe';

const arrowClass =
  'absolute top-1/2 -translate-y-1/2 grid size-11 place-items-center rounded-full border border-border bg-card/95 text-foreground shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary';

export function ProductGallery({
  images,
  frames360 = [],
  alt,
}: {
  images: string[];
  frames360?: string[];
  alt: string;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [view360, setView360] = useState(false);
  const active = Math.min(index, Math.max(0, images.length - 1));
  const step = (direction: number) =>
    setIndex((active + direction + images.length) % images.length);
  const swipe = useGallerySwipe(step, images.length > 1 && !view360);

  return (
    <section
      aria-label="รูปสินค้า"
      className="space-y-3"
      onKeyDown={(event) => {
        if (view360 || images.length < 2 || open) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          step(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
    >
      {frames360.length > 0 && (
        <div className="flex gap-2">
          {[false, true].map((is360) => (
            <button
              key={String(is360)}
              type="button"
              aria-pressed={view360 === is360}
              onClick={() => setView360(is360)}
              className={`min-h-11 rounded-full border px-4 text-sm focus-visible:outline-2 focus-visible:outline-primary ${view360 === is360 ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground'}`}
            >
              {is360 ? '360°' : 'รูป'}
            </button>
          ))}
        </div>
      )}
      {view360 ? (
        <Product360Viewer frames={frames360} alt={alt} />
      ) : (
        <div
          className="relative aspect-square overflow-hidden rounded-2xl bg-muted"
          style={{ touchAction: 'pan-y pinch-zoom' }}
          {...swipe}
        >
          {images.length ? (
            <button
              type="button"
              aria-label="ดูรูปขยาย"
              onClick={() => setOpen(true)}
              className="relative flex size-full items-center justify-center cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary"
            >
              <GalleryImage
                key={images[active]}
                src={images[active]}
                alt={`${alt} รูปที่ ${active + 1}`}
              />
              <Expand
                className="absolute right-3 top-3 size-5 text-foreground"
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageOff className="size-10" aria-hidden="true" />
              <p>ยังไม่มีรูปเครื่องนี้</p>
            </div>
          )}
          {images.length > 1 && (
            <>
              <button
                data-gallery-control
                type="button"
                aria-label="รูปก่อนหน้า"
                onClick={() => step(-1)}
                className={`${arrowClass} left-2`}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <button
                data-gallery-control
                type="button"
                aria-label="รูปถัดไป"
                onClick={() => step(1)}
                className={`${arrowClass} right-2`}
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
      {!view360 && images.length > 0 && (
        <p className="flex items-center justify-between text-xs text-muted-foreground leading-snug">
          <span role="status" aria-live="polite">
            รูป {active + 1} / {images.length}
          </span>
          <span>{images.length > 1 ? 'ปัดเพื่อดูรูป · แตะเพื่อขยาย' : 'แตะรูปเพื่อขยาย'}</span>
        </p>
      )}
      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-2">
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => {
                setView360(false);
                setIndex(i);
              }}
              aria-label={`รูปที่ ${i + 1}`}
              aria-pressed={active === i && !view360}
              className={`aspect-square min-h-11 overflow-hidden rounded-xl border bg-muted p-1 transition-colors focus-visible:outline-2 focus-visible:outline-primary ${active === i && !view360 ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary'}`}
            >
              <img src={src} alt="" loading="lazy" className="size-full object-contain" />
            </button>
          ))}
        </div>
      )}
      <ImageLightbox
        images={images}
        open={open}
        index={active}
        onOpenChange={setOpen}
        onIndexChange={setIndex}
        alt={alt}
      />
    </section>
  );
}
