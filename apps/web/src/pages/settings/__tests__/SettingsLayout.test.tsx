import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';

let role = 'OWNER';
let mobile = false;
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));
// CategoryPage ตัวจริงจะ render inline components — mock ให้เบา
vi.mock('../CategoryPage', () => ({ CategoryPage: ({ categoryId }: { categoryId: string }) => <div>cat:{categoryId}</div> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:categoryId" element={<SettingsLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsLayout', () => {
  beforeEach(() => { role = 'OWNER'; mobile = false; });

  it('desktop: เมนูซ้ายแสดงหมวดที่ role เห็น + render หมวดที่ active', () => {
    renderAt('/settings/system');
    expect(screen.getByRole('link', { name: /ระบบ & ความปลอดภัย/ })).toBeTruthy();
    expect(screen.getByText('cat:system')).toBeTruthy();
  });

  it('FM เห็นเฉพาะหมวดของตัวเอง (ไม่มี AI)', () => {
    role = 'FINANCE_MANAGER';
    renderAt('/settings/company');
    expect(screen.queryByRole('link', { name: /^AI$/ })).toBeNull();
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
