import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table';

function sample() {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>วันเริ่มงาน</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>1</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe('Table', () => {
  it('TableHead has whitespace-nowrap', () => {
    sample();
    expect(screen.getByRole('columnheader', { name: 'วันเริ่มงาน' })).toHaveClass('whitespace-nowrap');
  });

  it('Table wrapper keeps overflow-auto', () => {
    const { container } = sample();
    expect(container.querySelector('[data-slot="table-wrapper"]')).toHaveClass('overflow-auto');
  });
});
