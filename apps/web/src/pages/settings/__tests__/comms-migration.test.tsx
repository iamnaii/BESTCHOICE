import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/LineOaSettingsPage', () => ({ default: () => <div>line-oa-page</div> }));
vi.mock('@/pages/LineGreetingPage', () => ({ default: () => <div>greeting-page</div> }));
vi.mock('@/pages/SmsTemplatesPage', () => ({ default: () => <div>sms-page</div> }));
vi.mock('@/pages/ChannelSettingsPage', () => ({ default: () => <div>channels-page</div> }));
vi.mock('@/pages/DunningSettingsPage', () => ({ default: () => <div>dunning-page</div> }));
vi.mock('@/pages/SettingsPage/CollectionsPage', () => ({ default: () => <div>collections-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/line-oa" element={<Navigate to="/settings/comms/line-oa" replace />} />
        <Route path="/settings/line-greeting" element={<Navigate to="/settings/comms/greeting" replace />} />
        <Route path="/settings/sms-templates" element={<Navigate to="/settings/comms/sms" replace />} />
        <Route path="/settings/channels" element={<Navigate to="/settings/comms/channels" replace />} />
        <Route path="/settings/dunning" element={<Navigate to="/settings/comms/dunning" replace />} />
        <Route path="/settings/collections" element={<Navigate to="/settings/comms/collections" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('comms migration', () => {
  it('/settings/comms/line-oa → render หน้า line-oa ใน panel (sidebar ขับ category แล้ว — ไม่มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/comms/line-oa" />);
    expect(screen.getByText('line-oa-page')).toBeTruthy();
    // desktop left category nav is removed — sidebar drives category selection now
    expect(screen.queryByRole('link', { name: /สื่อสาร/ })).toBeNull();
  });

  it('old /settings/line-oa → redirect ไป /settings/comms/line-oa', async () => {
    render(<App entry="/settings/line-oa" />);
    await waitFor(() => expect(screen.getByText('line-oa-page')).toBeTruthy());
  });

  it('old /settings/line-greeting → redirect ไป /settings/comms/greeting', async () => {
    render(<App entry="/settings/line-greeting" />);
    await waitFor(() => expect(screen.getByText('greeting-page')).toBeTruthy());
  });

  it('old /settings/sms-templates → redirect ไป /settings/comms/sms', async () => {
    render(<App entry="/settings/sms-templates" />);
    await waitFor(() => expect(screen.getByText('sms-page')).toBeTruthy());
  });

  it('old /settings/channels → redirect ไป /settings/comms/channels', async () => {
    render(<App entry="/settings/channels" />);
    await waitFor(() => expect(screen.getByText('channels-page')).toBeTruthy());
  });

  it('old /settings/dunning → redirect ไป /settings/comms/dunning', async () => {
    render(<App entry="/settings/dunning" />);
    await waitFor(() => expect(screen.getByText('dunning-page')).toBeTruthy());
  });

  it('old /settings/collections → redirect ไป /settings/comms/collections', async () => {
    render(<App entry="/settings/collections" />);
    await waitFor(() => expect(screen.getByText('collections-page')).toBeTruthy());
  });
});
