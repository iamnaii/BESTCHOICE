import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import BlacklistOverrideDialog from './BlacklistOverrideDialog';

const reasons = [{ code: 'REFERENCES_BLACKLISTED' as const, level: 'SOFT' as const, message: 'ผู้อ้างอิง "ก" คือ ข ที่ติด blacklist', related: { customerId: 'c9', name: 'ข' } }];

describe('BlacklistOverrideDialog (เปิดใช้สัญญาทั้งที่มีประวัติ SOFT)', () => {
  it('lists the reasons, disables confirm until the reason has 10 characters, and confirms with the trimmed reason', async () => {
    const onConfirm = vi.fn();
    render(<MemoryRouter><BlacklistOverrideDialog open reasons={reasons} pending={false} onClose={vi.fn()} onConfirm={onConfirm} /></MemoryRouter>);
    expect(screen.getByText(/ผู้อ้างอิง "ก"/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'อนุมัติและเปิดใช้สัญญา' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /เหตุผล/ }), '  ตรวจแล้วไม่ใช่คนเดียวกัน  ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('ตรวจแล้วไม่ใช่คนเดียวกัน');
  });

  it('renders nothing when closed', () => {
    const { container } = render(<MemoryRouter><BlacklistOverrideDialog open={false} reasons={reasons} pending={false} onClose={vi.fn()} onConfirm={vi.fn()} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
