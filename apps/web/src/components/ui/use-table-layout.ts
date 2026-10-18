import { useLayoutEffect, useRef, useState, type DependencyList } from 'react';
import './table-layout.css';

/** Measure the real table, including fixed columns and the sidebar's available space. */
export function useTableLayout(enabled: boolean, dependencies: DependencyList) {
  const frameRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const sizeRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<'table' | 'fit' | 'cards'>('table');
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const table = tableRef.current;
    if (!frame || !table || !enabled) {
      setLayout('table');
      setOverflowing(false);
      return;
    }
    let disposed = false;
    let pendingFrame = 0;
    let lastWidth = -1;
    let lastFontSize = -1;
    const measure = () => {
      if (disposed || !frame.clientWidth) return;
      // Measure the natural table without replacing rows, inputs or their focus.
      // Restore the current layout synchronously, before the next paint.
      const previous = frame.dataset.tableLayout;
      frame.dataset.tableMeasuring = '';
      frame.dataset.tableLayout = 'table';
      const width = frame.clientWidth;
      const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const cells = Array.from(table.rows).flatMap((row) => Array.from(row.cells));
      const overflows = () =>
        table.getBoundingClientRect().width > width + 1 ||
        table.scrollWidth > width + 1 ||
        cells.some((cell) => cell.scrollWidth > cell.clientWidth + 1);
      let next: typeof layout = 'table';
      if (overflows()) {
        // First keep comparable columns and remove excess minimum widths/padding.
        // A desktop table must not become a tall form merely because its author
        // specified a conservative min-width. On desktop, keep comparable rows
        // even for exceptionally wide reports; never split monetary values to fit.
        frame.dataset.tableLayout = 'fit';
        next = width >= 40 * rootSize ? 'fit' : 'cards';
      }
      const needsScroll = next === 'fit' && overflows();
      frame.dataset.tableLayout = previous;
      // Flush the restored layout before re-enabling transitions. Even the
      // reduced-motion 0.01ms duration otherwise returns an in-between width.
      void table.offsetWidth;
      delete frame.dataset.tableMeasuring;
      lastWidth = width;
      lastFontSize = rootSize;
      setLayout(next);
      setOverflowing(needsScroll);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
            if (frame.clientWidth !== lastWidth || rootSize !== lastFontSize) {
              cancelAnimationFrame(pendingFrame);
              pendingFrame = requestAnimationFrame(measure);
            }
          });
    // This probe has stable height; changing table/card height must not retrigger
    // ResizeObserver delivery (notably WebKit's undelivered-notifications loop).
    if (sizeRef.current) observer?.observe(sizeRef.current);
    document.fonts?.ready.then(measure);
    document.fonts?.addEventListener('loadingdone', measure);
    window.addEventListener('resize', measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(pendingFrame);
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
      window.removeEventListener('resize', measure);
    };
    // The caller supplies data/columns that change the natural table width.
  }, [enabled, ...dependencies]);

  return { frameRef, tableRef, sizeRef, layout: enabled ? layout : 'table', stacked: enabled && layout === 'cards', overflowing: enabled && overflowing };
}
