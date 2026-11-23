import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { getSidebarForRole } from '@/config/menu';
import { WorkNavigation } from '../WorkNavigation';

function view(role = 'OWNER', activePath: string | null = null, onNavigate = vi.fn()) {
  return (
    <MemoryRouter>
      <WorkNavigation
        zone="shop"
        sections={getSidebarForRole(role, 'shop')}
        activePath={activePath}
        mobile
        onNavigate={onNavigate}
        renderBadge={(key) => <span>{key}</span>}
      />
    </MemoryRouter>
  );
}

describe('SHOP task navigation', () => {
  it('has a single sale shortcut, opens customer/sales work and folds inventory', () => {
    render(view());
    expect(screen.getAllByRole('link', { name: 'ขายสินค้า' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'ลูกค้า' })).toHaveAttribute('href', '/customers');
    expect(screen.getByRole('link', { name: 'สัญญาผ่อนชำระ' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'คลังและจัดซื้อ' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('searches folded groups, preserves badges, and restores folded state when cleared', async () => {
    render(view());
    fireEvent.change(screen.getByRole('textbox', { name: 'ค้นหาเมนูหน้าร้าน' }), {
      target: { value: 'ตัดสินค้า' },
    });
    const result = await screen.findByRole('link', { name: /ตัดสินค้า/ });
    expect(result).toHaveAttribute('href', '/stock/adjustments');
    expect(result).toHaveTextContent('stock-adjustment-pending');
    fireEvent.click(screen.getByRole('button', { name: 'คลังและจัดซื้อ' }));
    expect(screen.getByRole('button', { name: 'คลังและจัดซื้อ' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('link', { name: 'ลูกค้า' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างคำค้นเมนู' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'คลังและจัดซื้อ' })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );
    expect(await screen.findByRole('link', { name: 'ลูกค้า' })).toBeVisible();
  });

  it('shows an empty search and clears it with Escape without closing the mobile drawer', async () => {
    render(view());
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'ไม่มีเมนูนี้' } });
    expect(await screen.findByRole('status')).toHaveTextContent('ไม่พบเมนู');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(input).toHaveValue('');
  });

  it('opens a newly active section and highlights only the exact selected destination', () => {
    const { rerender } = render(view('OWNER', '/customers'));
    rerender(view('OWNER', '/purchase-orders/qc'));
    expect(screen.getByRole('link', { name: /รอถ่ายรูป/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'สั่งซื้อ (PO)' })).not.toHaveAttribute('aria-current');
  });

  it('closes mobile navigation after choosing a destination', () => {
    const navigate = vi.fn();
    render(view('OWNER', null, navigate));
    fireEvent.click(screen.getByRole('link', { name: 'ขายสินค้า' }));
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(['ACCOUNTANT', 'FINANCE_MANAGER', 'VIEWER'])('does not offer selling to %s', (role) => {
    render(view(role));
    expect(screen.queryByRole('link', { name: 'ขายสินค้า' })).not.toBeInTheDocument();
  });
});
