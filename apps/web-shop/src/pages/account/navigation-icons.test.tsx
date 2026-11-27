import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/contexts/AuthContext';
import { shopInfo } from '@/lib/copy';
import HowItWorksPage from '@/pages/HowItWorksPage';
import AccountPage from './AccountPage';

function CurrentUrl() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="URL">{pathname}{search}{hash}</output>;
}

function renderAccount() {
  const logout = vi.fn();
  // แถบโปรใน ShopLayout ถามยอดดาวน์ผ่าน React Query — เติมคำตอบไว้ก่อน ไม่ให้เทสนี้ยิงเครือข่าย
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['shop', 'down-floor'], null);
  render(
    <QueryClientProvider client={client}>
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
          <Routes>
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="*" element={<AccountPage />} />
          </Routes>
          <CurrentUrl />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
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
  it('draws distinct destination glyphs in the header, account hubs and installment guide', async () => {
    const logout = renderAccount();
    const usedGeometry = new Map<string, string>();
    function checkDestination(path: string, link: HTMLElement) {
      expect(link).toHaveAttribute('href', path);
      const shape = iconGeometry(link);
      expect(usedGeometry.get(shape), `${path} duplicates ${usedGeometry.get(shape)}`).toBeUndefined();
      usedGeometry.set(shape, path);
    }
    checkDestination('/account', screen.getByRole('link', { name: 'บัญชี' }));
    checkDestination('/orders', screen.getByRole('link', { name: 'ออเดอร์' }));
    checkDestination('/account/addresses', screen.getByRole('link', { name: 'ที่อยู่' }));

    const logoutButton = screen.getByRole('button', { name: 'ออกจากระบบ' });
    const logoutGeometry = iconGeometry(logoutButton);
    await userEvent.click(logoutButton);
    expect(logout).toHaveBeenCalledOnce();

    const header = within(screen.getByRole('banner'));
    await userEvent.click(header.getByRole('link', { name: /^วิธีผ่อน$/ }));
    expect(screen.getByLabelText('URL').textContent).toBe('/how-it-works');
    const terms = screen.getByRole('link', { name: /^อ่านเงื่อนไขการผ่อนแบบละเอียด/ });
    checkDestination('/installment-terms', terms);
    expect(terms.querySelector('svg.app-icon-shield-check')).toHaveAttribute('aria-hidden', 'true');
    expect(usedGeometry.has(logoutGeometry)).toBe(false);
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
    expect(screen.getByLabelText('URL').textContent).toBe('/products?search=iPhone%2015#catalog');

    const internalLinks = footer.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/'));
    expect(internalLinks).toHaveLength(12);
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
