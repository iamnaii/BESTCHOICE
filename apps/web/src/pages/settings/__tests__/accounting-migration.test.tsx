import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/ChartOfAccountsPage', () => ({ default: () => <div>chart-page</div> }));
vi.mock('@/pages/PeakSyncPage', () => ({ default: () => <div>peak-sync-page</div> }));
vi.mock('@/pages/ETaxConfigPage', () => ({ ETaxConfigPage: () => <div>e-tax-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/chart-of-accounts" element={<Navigate to="/settings/accounting/chart" replace />} />
        <Route path="/settings/peak-sync" element={<Navigate to="/settings/accounting/peak-sync" replace />} />
        <Route path="/settings/e-tax-config" element={<Navigate to="/settings/accounting/e-tax" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('accounting migration', () => {
  it('/settings/accounting/chart → render หน้า chart ใน panel (มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/accounting/chart" />);
    expect(screen.getByText('chart-page')).toBeTruthy();
    // panel nav ยังอยู่ (link หมวด accounting)
    expect(screen.getByRole('link', { name: /บัญชี/ })).toBeTruthy();
  });

  it('old /settings/chart-of-accounts → redirect ไป /settings/accounting/chart', async () => {
    render(<App entry="/settings/chart-of-accounts" />);
    await waitFor(() => expect(screen.getByText('chart-page')).toBeTruthy());
  });

  it('old /settings/peak-sync → redirect ไป /settings/accounting/peak-sync', async () => {
    render(<App entry="/settings/peak-sync" />);
    await waitFor(() => expect(screen.getByText('peak-sync-page')).toBeTruthy());
  });

  it('old /settings/e-tax-config → redirect ไป /settings/accounting/e-tax', async () => {
    render(<App entry="/settings/e-tax-config" />);
    await waitFor(() => expect(screen.getByText('e-tax-page')).toBeTruthy());
  });
});
