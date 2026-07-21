import { useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';

export function Product360Viewer({ frames, alt }: { frames: string[]; alt: string }) {
  const [frame, setFrame] = useState(0);
  const dragRef = useRef<{ startX: number; startFrame: number } | null>(null);

  if (frames.length === 0) return null;

  const setFromDelta = (dx: number, startFrame: number) => {
    const step = Math.round(dx / 8); // 8px ต่อ 1 frame
    const next = (((startFrame + step) % frames.length) + frames.length) % frames.length;
    setFrame(next);
  };
  const onDown = (x: number) => (dragRef.current = { startX: x, startFrame: frame });
  const onMove = (x: number) => {
    if (dragRef.current) setFromDelta(x - dragRef.current.startX, dragRef.current.startFrame);
  };
  const onUp = () => (dragRef.current = null);

  return (
    <div
      className="relative aspect-square w-full rounded-2xl bg-zinc-50 overflow-hidden flex items-center justify-center touch-none select-none cursor-ew-resize"
      onMouseDown={(e) => onDown(e.clientX)}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchStart={(e) => onDown(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={onUp}
    >
      <img
        src={frames[frame]}
        alt={`${alt} 360° เฟรม ${frame + 1}`}
        className="max-h-full max-w-full object-contain pointer-events-none"
        draggable={false}
      />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 text-xs bg-background/80 border border-border rounded-full px-3 py-1 leading-snug">
        <RotateCw className="size-3.5" aria-hidden /> ลากเพื่อหมุน 360°
      </span>
    </div>
  );
}
