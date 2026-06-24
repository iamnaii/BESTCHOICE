import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/PricingTemplatesPage', () => ({ default: () => <div>pricing-page</div> }));
vi.mock('@/pages/SettingsPage/StickersPage', () => ({ default: () => <div>stickers-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/pricing-templates" element={<Navigate to="/settings/products/pricing" replace />} />
        <Route path="/settings/stickers" element={<Navigate to="/settings/products/stickers" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('products migration', () => {
  it('/settings/products/pricing → render หน้า pricing ใน panel (sidebar ขับ category แล้ว — ไม่มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/products/pricing" />);
    expect(screen.getByText('pricing-page')).toBeTruthy();
    // desktop left category nav is removed — sidebar drives category selection now
    expect(screen.queryByRole('link', { name: /สินค้า/ })).toBeNull();
  });

  it('old /settings/pricing-templates → redirect ไป /settings/products/pricing', async () => {
    render(<App entry="/settings/pricing-templates" />);
    await waitFor(() => expect(screen.getByText('pricing-page')).toBeTruthy());
  });

  it('old /settings/stickers → redirect ไป /settings/products/stickers', async () => {
    render(<App entry="/settings/stickers" />);
    await waitFor(() => expect(screen.getByText('stickers-page')).toBeTruthy());
  });
});
