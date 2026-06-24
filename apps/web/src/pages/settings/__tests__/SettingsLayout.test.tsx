import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';

let role = 'OWNER';
let mobile = false;
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));

function renderAt(path: string) {
  // Extract categoryId from path for the index child stub
  const match = path.match(/\/settings\/([^/]+)/);
  const catId = match?.[1] ?? '';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<div>cat:{catId}</div>} />
          <Route path=":itemId" element={<div>item-child</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsLayout', () => {
  beforeEach(() => { role = 'OWNER'; mobile = false; });

  it('desktop: ไม่มีเมนูซ้าย (sidebar หลักขับ category แล้ว) + Outlet content ยังแสดง', () => {
    renderAt('/settings/system');
    // The left category nav links must NOT be rendered on desktop
    expect(screen.queryByRole('link', { name: /ระบบ & ความปลอดภัย/ })).toBeNull();
    // Outlet content still renders
    expect(screen.getByText('cat:system')).toBeTruthy();
  });

  it('desktop: ช่องค้นหายังมีอยู่ + Outlet แสดงเนื้อหา', () => {
    renderAt('/settings/company');
    expect(screen.getByPlaceholderText(/ค้นหา/)).toBeTruthy();
    expect(screen.getByText('cat:company')).toBeTruthy();
  });

  it('mobile: render <select> หมวดแทน sidebar', () => {
    mobile = true;
    renderAt('/settings/company');
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('มีช่องค้นหา', () => {
    renderAt('/settings/company');
    expect(screen.getByPlaceholderText(/ค้นหา/)).toBeTruthy();
  });
});
