import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/ChartOfAccountsPage', () => ({ default: () => { const loc = useLocation(); return <div>chart-page{loc.search}</div>; } }));
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
  it.each(['/settings/accounting#peak-mapping', '/settings/accounting/peak-mapping'])('legacy mapping %s redirects into the chart tab', async (entry) => {
    render(<App entry={entry} />);
    expect(await screen.findByText('chart-page?tab=peak')).toBeTruthy();
  });

  it('/settings/accounting/chart → render หน้า chart ใน panel (sidebar ขับ category แล้ว — ไม่มี nav ข้างซ้าย)', async () => {
    render(<App entry="/settings/accounting/chart" />);
    expect(await screen.findByText('chart-page')).toBeTruthy();
    // desktop left category nav is removed — sidebar drives category selection now
    expect(screen.queryByRole('link', { name: /บัญชี/ })).toBeNull();
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
