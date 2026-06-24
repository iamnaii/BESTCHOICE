import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/AiAdminPage', () => ({ default: () => <div>admin-page</div> }));
vi.mock('@/pages/AiPersonaPage', () => ({ default: () => <div>persona-page</div> }));
vi.mock('@/pages/AiSettingsPage', () => ({ default: () => <div>assistant-page</div> }));
vi.mock('@/pages/AiTrainingPage', () => ({ default: () => <div>training-page</div> }));
vi.mock('@/pages/AiPerformancePage', () => ({ default: () => <div>performance-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/ai-admin" element={<Navigate to="/settings/ai/admin" replace />} />
        <Route path="/settings/ai-persona" element={<Navigate to="/settings/ai/persona" replace />} />
        <Route path="/settings/ai-chat" element={<Navigate to="/settings/ai/assistant" replace />} />
        <Route path="/settings/ai-training" element={<Navigate to="/settings/ai/training" replace />} />
        <Route path="/settings/ai-performance" element={<Navigate to="/settings/ai/performance" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('ai migration', () => {
  it('/settings/ai/admin → render หน้า admin ใน panel (sidebar ขับ category แล้ว — ไม่มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/ai/admin" />);
    expect(screen.getByText('admin-page')).toBeTruthy();
    // desktop left category nav is removed — sidebar drives category selection now
    expect(screen.queryByRole('link', { name: /AI/ })).toBeNull();
  });

  it('old /settings/ai-admin → redirect ไป /settings/ai/admin', async () => {
    render(<App entry="/settings/ai-admin" />);
    await waitFor(() => expect(screen.getByText('admin-page')).toBeTruthy());
  });

  it('old /settings/ai-persona → redirect ไป /settings/ai/persona', async () => {
    render(<App entry="/settings/ai-persona" />);
    await waitFor(() => expect(screen.getByText('persona-page')).toBeTruthy());
  });

  it('old /settings/ai-chat → redirect ไป /settings/ai/assistant', async () => {
    render(<App entry="/settings/ai-chat" />);
    await waitFor(() => expect(screen.getByText('assistant-page')).toBeTruthy());
  });

  it('old /settings/ai-training → redirect ไป /settings/ai/training', async () => {
    render(<App entry="/settings/ai-training" />);
    await waitFor(() => expect(screen.getByText('training-page')).toBeTruthy());
  });

  it('old /settings/ai-performance → redirect ไป /settings/ai/performance', async () => {
    render(<App entry="/settings/ai-performance" />);
    await waitFor(() => expect(screen.getByText('performance-page')).toBeTruthy());
  });
});
