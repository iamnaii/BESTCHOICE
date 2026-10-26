import { forwardRef, useImperativeHandle, useLayoutEffect, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { useTableLayout } from './use-table-layout';
import './screen-table.css';

/** Screen-only table. Keeps the original rows, controls, spans and event handlers. */
const ScreenTable = forwardRef<HTMLTableElement, ComponentProps<'table'>>(function ScreenTable(
  { children, className, ...props },
  ref,
) {
  const { frameRef, tableRef, sizeRef, layout, overflowing } = useTableLayout(true, [children, className]);
  useImperativeHandle(ref, () => tableRef.current!);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    // Labels come from the actual headers, so optional/dynamic columns stay aligned.
    // Only metadata is added: React continues to own every child and input node.
    const grid: string[][] = [];
    let hasHeaderControls = false;
    Array.from(table.tHead?.rows ?? []).forEach((row, rowIndex) => {
      grid[rowIndex] ??= [];
      let column = 0;
      Array.from(row.cells).forEach((cell) => {
        while (grid[rowIndex][column] !== undefined) column++;
        const text = cell.textContent?.trim() ?? '';
        for (let r = 0; r < cell.rowSpan; r++) {
          grid[rowIndex + r] ??= [];
          for (let c = 0; c < cell.colSpan; c++) grid[rowIndex + r][column + c] = text;
        }
        column += cell.colSpan;
        const interactive =
          !!cell.querySelector('button, input, select, a[href], [role="button"], [tabindex]') ||
          !!cell.onclick;
        cell.dataset.tableControl = String(interactive);
        cell.dataset.tableSelectAll = String(
          interactive && !text && !!cell.querySelector('input[type="checkbox"]'),
        );
        hasHeaderControls ||= interactive;
        if (!cell.hasAttribute('role')) cell.setAttribute('role', 'columnheader');
        if (!cell.hasAttribute('scope')) cell.setAttribute('scope', 'col');
      });
      if (!row.hasAttribute('role')) row.setAttribute('role', 'row');
    });
    const labels = (grid.at(-1) ?? []).map((_, column) =>
      [...new Set(grid.map((row) => row[column]).filter(Boolean))].join(' / '),
    );
    if (table.tHead) {
      table.tHead.dataset.tableControls = String(hasHeaderControls);
      if (!table.tHead.hasAttribute('role')) table.tHead.setAttribute('role', 'rowgroup');
    }
    for (const section of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
      if (!section.hasAttribute('role')) section.setAttribute('role', 'rowgroup');
      for (const row of Array.from(section.rows)) {
        if (!row.hasAttribute('role')) row.setAttribute('role', 'row');
        let column = 0;
        for (const cell of Array.from(row.cells)) {
          if (!cell.hasAttribute('role'))
            cell.setAttribute('role', cell.tagName === 'TH' ? 'rowheader' : 'cell');
          cell.dataset.tableLabel = cell.colSpan === 1 ? (labels[column] ?? '') : '';
          cell.dataset.tableSpan = String(cell.colSpan > 1);
          column += cell.colSpan;
        }
      }
    }
  }, [children, tableRef]);

  return (
    <div
      ref={frameRef}
      className="screen-table-responsive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      data-table-layout={layout}
      role={overflowing ? 'region' : undefined}
      aria-label={overflowing ? (props['aria-label'] ?? 'ตารางข้อมูล') : undefined}
      tabIndex={overflowing ? 0 : undefined}
      onKeyDown={overflowing ? (event) => {
        const viewport = event.currentTarget;
        if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          viewport.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160 });
        }
      } : undefined}
    >
      <span ref={sizeRef} className="table-size-probe" aria-hidden="true" />
      <table
        {...props}
        ref={tableRef}
        data-responsive-table=""
        role={props.role ?? 'table'}
        className={cn('w-full', className)}
      >
        {children}
      </table>
    </div>
  );
});

export default ScreenTable;
