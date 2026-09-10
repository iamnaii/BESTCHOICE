import { useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { cn } from '@/lib/utils';

/** Callers key by src so an old device's photo never stands in for a new one. */
export function GalleryImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useGSAP(
    () => {
      if (!loaded || !window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          image.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.28, clearProps: 'opacity' },
        );
      });
      return () => media.revert();
    },
    { dependencies: [loaded], revertOnUpdate: true },
  );

  if (failed)
    return (
      <span className="flex flex-col items-center gap-2 p-6 text-muted-foreground leading-snug">
        <ImageOff className="size-8" aria-hidden="true" />
        <span className="text-sm">โหลดรูปนี้ไม่สำเร็จ ลองเลือกรูปอื่น</span>
      </span>
    );
  return (
    <>
      {!loaded && (
        <span
          role="status"
          className="absolute inset-0 grid place-items-center bg-muted text-sm text-muted-foreground"
        >
          กำลังโหลดรูป…
        </span>
      )}
      <img
        ref={image}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn('max-h-full max-w-full object-contain', !loaded && 'opacity-0', className)}
      />
    </>
  );
}
