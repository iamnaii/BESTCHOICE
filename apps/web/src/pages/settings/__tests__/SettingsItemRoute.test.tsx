import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsItemRoute } from '../SettingsItemRoute';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/pages/InterestConfigPage', () => ({ default: () => <div>interest-page</div> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:categoryId/:itemId" element={<SettingsItemRoute />} />
        <Route path="/settings/:categoryId" element={<div>category-fallback</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsItemRoute', () => {
  it('render component ของ route-item (interest)', () => {
    role = 'OWNER';
    renderAt('/settings/finance/interest');
    expect(screen.getByText('interest-page')).toBeTruthy();
  });

  it('role ไม่มีสิทธิ์ → redirect ไปหน้าหมวด', () => {
    role = 'FINANCE_MANAGER'; // interest = OWNER-only
    renderAt('/settings/finance/interest');
    expect(screen.getByText('category-fallback')).toBeTruthy();
  });

  it('item ไม่รู้จัก → redirect ไปหน้าหมวด', () => {
    role = 'OWNER';
    renderAt('/settings/finance/nope');
    expect(screen.getByText('category-fallback')).toBeTruthy();
  });
});
