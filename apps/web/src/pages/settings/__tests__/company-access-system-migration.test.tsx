import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/CompanySettingsPage', () => ({ default: () => <div>entities-page</div> }));
vi.mock('@/pages/AccountRolesPage', () => ({ default: () => <div>account-roles-page</div> }));
vi.mock('@/pages/IntegrationHubPage', () => ({ default: () => <div>integrations-page</div> }));
vi.mock('@/pages/MdmTestPage', () => ({ default: () => <div>mdm-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        {/* redirects from old paths */}
        <Route path="/settings/companies" element={<Navigate to="/settings/company/entities" replace />} />
        <Route path="/settings/account-roles" element={<Navigate to="/settings/access/account-roles" replace />} />
        <Route path="/settings/integrations" element={<Navigate to="/settings/system/integrations" replace />} />
        <Route path="/settings/mdm-test" element={<Navigate to="/settings/system/mdm" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('company/access/system migration', () => {
  it('/settings/company/entities → render หน้า entities ใน panel (sidebar ขับ category แล้ว — ไม่มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/company/entities" />);
    expect(screen.getByText('entities-page')).toBeTruthy();
    // desktop left category nav is removed — sidebar drives category selection now
    expect(screen.queryByRole('link', { name: /บริษัท/ })).toBeNull();
  });

  it('/settings/access/account-roles → render หน้า account-roles ใน panel', () => {
    render(<App entry="/settings/access/account-roles" />);
    expect(screen.getByText('account-roles-page')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /ผู้ใช้/ })).toBeNull();
  });

  it('/settings/system/integrations → render หน้า integrations ใน panel', () => {
    render(<App entry="/settings/system/integrations" />);
    expect(screen.getByText('integrations-page')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /ระบบ/ })).toBeNull();
  });

  it('/settings/system/mdm → render หน้า mdm ใน panel', () => {
    render(<App entry="/settings/system/mdm" />);
    expect(screen.getByText('mdm-page')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /ระบบ/ })).toBeNull();
  });

  it('old /settings/companies → redirect ไป /settings/company/entities', async () => {
    render(<App entry="/settings/companies" />);
    await waitFor(() => expect(screen.getByText('entities-page')).toBeTruthy());
  });

  it('old /settings/account-roles → redirect ไป /settings/access/account-roles', async () => {
    render(<App entry="/settings/account-roles" />);
    await waitFor(() => expect(screen.getByText('account-roles-page')).toBeTruthy());
  });

  it('old /settings/integrations → redirect ไป /settings/system/integrations', async () => {
    render(<App entry="/settings/integrations" />);
    await waitFor(() => expect(screen.getByText('integrations-page')).toBeTruthy());
  });

  it('old /settings/mdm-test → redirect ไป /settings/system/mdm', async () => {
    render(<App entry="/settings/mdm-test" />);
    await waitFor(() => expect(screen.getByText('mdm-page')).toBeTruthy());
  });
});
