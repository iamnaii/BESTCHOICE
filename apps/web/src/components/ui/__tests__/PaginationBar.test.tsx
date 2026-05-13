import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PaginationBar } from '../PaginationBar';

describe('PaginationBar', () => {
  const props = (overrides = {}) => ({
    total: 247,
    page: 3,
    size: 50,
    onPageChange: vi.fn(),
    onSizeChange: vi.fn(),
    ...overrides,
  });

  it('shows "แสดง X-Y จาก Z รายการ"', () => {
    render(<PaginationBar {...props()} />);
    expect(screen.getByText(/แสดง 101-150 จาก 247 รายการ/)).toBeInTheDocument();
  });

  it('shows last partial range correctly', () => {
    render(<PaginationBar {...props({ page: 5, size: 50, total: 247 })} />);
    expect(screen.getByText(/แสดง 201-247 จาก 247 รายการ/)).toBeInTheDocument();
  });

  it('disables Prev/First on page 1', () => {
    render(<PaginationBar {...props({ page: 1 })} />);
    expect(screen.getByRole('button', { name: /First/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Prev/i })).toBeDisabled();
  });

  it('disables Next/Last on final page', () => {
    render(<PaginationBar {...props({ page: 5, size: 50, total: 247 })} />);
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Last/i })).toBeDisabled();
  });

  it('calls onPageChange when numeric page clicked', () => {
    const onPageChange = vi.fn();
    render(<PaginationBar {...props({ onPageChange })} />);
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onSizeChange when page-size selector changes', () => {
    const onSizeChange = vi.fn();
    render(<PaginationBar {...props({ onSizeChange })} />);
    // shadcn Select uses role=combobox or similar — adapt to actual impl
    const select = screen.getByLabelText(/แสดงต่อหน้า/i);
    fireEvent.change(select, { target: { value: '100' } });
    expect(onSizeChange).toHaveBeenCalledWith(100);
  });

  it('jump-to-page input invokes onPageChange on Enter', () => {
    const onPageChange = vi.fn();
    render(<PaginationBar {...props({ onPageChange })} />);
    const input = screen.getByPlaceholderText(/ไปหน้า/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});
