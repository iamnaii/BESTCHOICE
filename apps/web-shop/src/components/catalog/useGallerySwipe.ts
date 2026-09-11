import { useRef, type PointerEvent, type MouseEvent } from 'react';

/** Horizontal swipes leave vertical scrolling and pinch zoom to the browser. */
export function useGallerySwipe(onStep: (direction: number) => void, enabled = true) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      swiped.current = false;
      if (
        !enabled ||
        !event.isPrimary ||
        event.button !== 0 ||
        (event.target as HTMLElement).closest('[data-gallery-control]')
      )
        return;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const origin = start.current;
      start.current = null;
      if (!origin || origin.id !== event.pointerId) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        swiped.current = true;
        onStep(dx < 0 ? 1 : -1);
      }
    },
    onPointerCancel() {
      start.current = null;
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (swiped.current) {
        event.preventDefault();
        event.stopPropagation();
        swiped.current = false;
      }
    },
  };
}
