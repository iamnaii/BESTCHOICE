import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/contexts/AuthContext';
import { shopInfo } from '@/lib/copy';
import AccountPage from './AccountPage';

function CurrentUrl() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="URL">{pathname}{search}{hash}</output>;
}

function renderAccount() {
  const logout = vi.fn();
  render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider
        value={{
          customer: { id: 'fixture', name: 'ลูกค้าทดสอบ', phone: null, lineId: null, loyaltyBalance: 0 },
          token: null,
          setAuth: vi.fn(),
          hydrating: false,
          logout,
        }}
      >
        <AccountPage />
        <CurrentUrl />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return logout;
}

function iconGeometry(control: HTMLElement) {
  const icon = control.querySelector('svg[data-icon-style="duotone"]');
  expect(icon, control.textContent ?? '').toBeInTheDocument();
  expect(icon).toHaveAttribute('fill', 'currentColor');
  return icon!.innerHTML;
}

describe('storefront navigation glyphs', () => {
  it('draws distinct destination glyphs in the header and account hubs', async () => {
    const logout = renderAccount();
    const destinations = [
      ['/account', 'บัญชี'],
      ['/orders', 'ออเดอร์'],
      ['/account/addresses', 'ที่อยู่'],
    ] as const;
    const usedGeometry = new Map<string, string>();
    for (const [path, name] of destinations) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', path);
      const shape = iconGeometry(link);
      expect(usedGeometry.get(shape), `${path} duplicates ${usedGeometry.get(shape)}`).toBeUndefined();
      usedGeometry.set(shape, path);
    }
    const logoutButton = screen.getByRole('button', { name: 'ออกจากระบบ' });
    expect(usedGeometry.has(iconGeometry(logoutButton))).toBe(false);
    await userEvent.click(logoutButton);
    expect(logout).toHaveBeenCalledOnce();
  });

  it('keeps plain menus text-only and uses consistent header and contact action glyphs', async () => {
    const user = userEvent.setup();
    renderAccount();
    const header = within(screen.getByRole('banner'));
    const footer = within(screen.getByRole('contentinfo'));
    const showMenu = header.getByRole('button', { name: 'เปิดเมนู' });
    expect(showMenu.querySelector('svg')).toHaveClass('app-icon-list');
    await user.click(showMenu);
    const mobileNav = header.getByRole('navigation', { name: 'เมนูหลัก' });
    for (const nav of header.getAllByRole('navigation')) {
      expect(within(nav).getAllByRole('link').every((link) => !link.querySelector('svg, img'))).toBe(true);
    }
    const closeMenu = header.getByRole('button', { name: 'ปิดเมนู' });
    expect(closeMenu.querySelector('svg')).toHaveClass('app-icon-x');
    expect(closeMenu).toHaveAttribute('aria-expanded', 'true');
    await user.click(closeMenu);
    expect(mobileNav).not.toBeInTheDocument();

    const search = header.getByRole('button', { name: 'ค้นหา' });
    expect(search.querySelector('svg')).toHaveClass('app-icon-magnifying-glass');
    await user.click(search);
    await user.type(header.getByRole('searchbox', { name: 'ค้นหาสินค้า' }), 'iPhone 15{enter}');
    expect(screen.getByLabelText('URL')).toHaveTextContent('/products?search=iPhone%2015#catalog');

    const internalLinks = footer.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/'));
    expect(internalLinks).toHaveLength(11);
    expect(internalLinks.every((link) => !link.querySelector('svg, img'))).toBe(true);
    const footerLine = footer.getByRole('link', { name: /^LINE$/ });
    const textLine = footer.getByRole('link', { name: `LINE ${shopInfo.lineHandle}` });
    const floatingLine = screen.getByRole('link', { name: 'ทักแชทหาร้าน' });
    for (const link of [footerLine, textLine, floatingLine]) {
      expect(link).toHaveAttribute('href', shopInfo.lineUrl);
    }
    expect(iconGeometry(floatingLine)).toBe(iconGeometry(footerLine));
    expect(iconGeometry(textLine.parentElement!)).toBe(iconGeometry(footerLine));
  });
});
