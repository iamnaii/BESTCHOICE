import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure React Testing Library unmounts components between tests so
// timers/effects from one test don't leak into the next.
afterEach(() => {
  cleanup();
});

// jsdom does not implement ResizeObserver. @dnd-kit (DndContext / useSortable)
// probes for it and, when absent, falls back to a rAF-driven measuring loop that
// starves jsdom's event loop — any test rendering a dnd-kit component hangs
// indefinitely (testTimeout never fires because the loop never yields). A no-op
// observer lets dnd-kit take its observer path and render normally.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Polyfill Blob.arrayBuffer() for jsdom environment (jsdom's Blob lacks this method).
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
