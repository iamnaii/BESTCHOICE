import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DataGridProvider } from './data-grid';
import { DataGridPagination } from './data-grid-pagination';

function Grid() {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: 15,
    initialState: { pagination: { pageIndex: 5, pageSize: 10 } },
  });
  return (
    <DataGridProvider table={table} recordCount={150}>
      <DataGridPagination />
    </DataGridProvider>
  );
}

it('renders named page-group controls with shared glyphs and keeps their page targets', () => {
  render(<Grid />);
  const previousName = 'ไปกลุ่มหน้าก่อน';
  const nextName = 'ไปกลุ่มหน้าถัดไป';
  const previous = screen.getByRole('button', { name: previousName });
  const next = screen.getByRole('button', { name: nextName });
  for (const control of [previous, next]) {
    expect(control.querySelector('svg.app-icon-dots-three')).toHaveAttribute('aria-hidden', 'true');
  }

  fireEvent.click(previous);
  expect(screen.getByText('41 - 50 จาก 150')).toBeVisible();
  expect(screen.queryByRole('button', { name: previousName })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: nextName }));
  expect(screen.getByText('51 - 60 จาก 150')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: nextName }));
  expect(screen.getByText('101 - 110 จาก 150')).toBeVisible();
  expect(screen.queryByRole('button', { name: nextName })).toBeNull();
});
