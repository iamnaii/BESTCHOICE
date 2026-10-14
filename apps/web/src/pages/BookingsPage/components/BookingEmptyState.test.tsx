import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BookingEmptyState from './BookingEmptyState';

describe('Booking empty-state hierarchy', () => {
  it('keeps creation and money conditions visible while instructions can be expanded', async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    render(<BookingEmptyState canCreate onCreate={create} />);
    expect(screen.getByText(/7 วัน/)).toBeVisible();
    expect(screen.getByText(/ริบ/)).toBeVisible();
    expect(screen.getByText(/คืน.*เต็มจำนวน/)).toBeVisible();
    expect(screen.getByText('1. สร้างใบจอง')).not.toBeVisible();
    await user.click(screen.getByText('วิธีใช้งานใบจอง'));
    expect(screen.getByText('1. สร้างใบจอง')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'สร้างใบจองแรก' }));
    expect(create).toHaveBeenCalledOnce();
  });
});
