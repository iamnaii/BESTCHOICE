import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { getSidebarForRole } from '@/config/menu';
import { WorkNavigation } from '../WorkNavigation';

function view(role = 'OWNER', activePath = '/finance-portfolio', onNavigate = vi.fn()) {
  return (
    <MemoryRouter>
      <WorkNavigation
        zone="fin"
        sections={getSidebarForRole(role, 'fin')}
        activePath={activePath}
        onNavigate={onNavigate}
        mobile
        renderBadge={(key) => <span>{key}</span>}
      />
    </MemoryRouter>
  );
}

describe('FINANCE appearance preserves existing navigation', () => {
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'])(
    '%s retains every group and item in its original order',
    (role) => {
      const sections = getSidebarForRole(role, 'fin');
      const before = JSON.stringify(sections);
      render(view(role));
      const nav = within(screen.getByRole('navigation', { name: 'เมนูงานการเงิน' }));
      const groups = nav.getAllByRole('button');
      expect(groups.map((button) => button.textContent)).toEqual(
        sections.map((section) => section.label),
      );
      for (const button of groups) {
        if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
      }
      expect(
        nav
          .getAllByRole('link')
          .map((link) => ({ path: link.getAttribute('href'), label: link.textContent })),
      ).toEqual(
        sections
          .flatMap((section) => section.items.flatMap((item) => item.children ?? [item]))
          .map((item) => ({ path: item.path, label: item.label + (item.badgeKey ?? '') })),
      );
      expect(screen.queryByRole('link', { name: 'ขายสินค้า' })).not.toBeInTheDocument();
      expect(JSON.stringify(sections)).toBe(before);
    },
  );

  it('opens the current group, searches closed groups, and restores the prior state after clearing', async () => {
    render(view());
    expect(screen.getByRole('button', { name: 'ภาพรวม' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'บัญชี & งบการเงิน' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'ค้นหาเมนูการเงิน' }), {
      target: { value: 'งบทดลอง' },
    });
    expect(await screen.findByRole('link', { name: 'งบทดลอง' })).toHaveAttribute(
      'href',
      '/finance/trial-balance',
    );
    fireEvent.click(screen.getByRole('button', { name: 'ล้างคำค้นเมนู' }));
    await screen.findByRole('button', { name: 'ภาพรวม' });
    expect(screen.getByRole('button', { name: 'บัญชี & งบการเงิน' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'ภาพรวม' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('reveals the selected destination after navigation and closes the mobile drawer on selection', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(view('OWNER', '/finance-portfolio', onNavigate));
    rerender(view('OWNER', '/finance/general-ledger', onNavigate));
    const ledger = screen.getByRole('link', { name: 'บัญชีแยกประเภท' });
    expect(ledger).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'สมุดรายวัน' })).not.toHaveAttribute(
      'aria-current',
    );
    fireEvent.click(ledger);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
