import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/InterestConfigPage', () => ({ default: () => <div>interest-page</div> }));
vi.mock('@/pages/GfinConfigPage', () => ({ default: () => <div>gfin-page</div> }));
vi.mock('@/pages/PaymentMethodSettingsPage', () => ({ default: () => <div>payment-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/interest-config" element={<Navigate to="/settings/finance/interest" replace />} />
        <Route path="/settings/gfin-rates" element={<Navigate to="/settings/finance/gfin" replace />} />
        <Route path="/settings/payment-methods" element={<Navigate to="/settings/finance/payment-methods" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('finance migration', () => {
  it('/settings/finance/interest → render หน้า interest ใน panel (sidebar ขับ category แล้ว — ไม่มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/finance/interest" />);
    expect(screen.getByText('interest-page')).toBeTruthy();
    // desktop left category nav is removed — sidebar drives category selection now
    expect(screen.queryByRole('link', { name: /การเงิน/ })).toBeNull();
  });

  it('old /settings/interest-config → redirect ไป /settings/finance/interest', async () => {
    render(<App entry="/settings/interest-config" />);
    await waitFor(() => expect(screen.getByText('interest-page')).toBeTruthy());
  });

  it('old /settings/gfin-rates → redirect ไป /settings/finance/gfin', async () => {
    render(<App entry="/settings/gfin-rates" />);
    await waitFor(() => expect(screen.getByText('gfin-page')).toBeTruthy());
  });

  it('old /settings/payment-methods → redirect ไป /settings/finance/payment-methods', async () => {
    render(<App entry="/settings/payment-methods" />);
    await waitFor(() => expect(screen.getByText('payment-page')).toBeTruthy());
  });
});
