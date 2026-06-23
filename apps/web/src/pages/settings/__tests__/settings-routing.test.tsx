import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsIndexRedirect } from '../SettingsIndexRedirect';
import { SettingsLayout } from '../SettingsLayout';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../CategoryPage', () => ({ CategoryPage: ({ categoryId }: { categoryId: string }) => <div>cat:{categoryId}</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings" element={<SettingsIndexRedirect />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('settings routing', () => {
  beforeEach(() => { role = 'OWNER'; window.location.hash = ''; });

  it('/settings → redirect ไปหมวดแรก (company)', async () => {
    render(<App entry="/settings" />);
    await waitFor(() => expect(screen.getByText('cat:company')).toBeTruthy());
  });

  it('/settings/system → render หมวด system', () => {
    render(<App entry="/settings/system" />);
    expect(screen.getByText('cat:system')).toBeTruthy();
  });
});
