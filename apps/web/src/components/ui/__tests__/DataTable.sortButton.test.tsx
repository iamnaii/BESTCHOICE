import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable, { type Column } from '../DataTable';

interface Row {
  id: string;
  price: number;
}

const columns: Column<Row>[] = [{ key: 'price', label: 'ราคาเต็มจำนวน', sortable: true }];

describe('DataTable sort button', () => {
  it('has whitespace-nowrap and min height 32px on desktop', () => {
    render(<DataTable columns={columns} data={[{ id: '1', price: 1 }]} />);
    const button = screen.getByRole('button', { name: /ราคาเต็มจำนวน/ });
    expect(button).toHaveClass('whitespace-nowrap');
    expect(button).toHaveClass('lg:min-h-8');
  });
});
