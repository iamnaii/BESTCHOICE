import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { CategoryPage } from '../CategoryPage';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
// mock inline components ของหมวด system ให้เบา
vi.mock('@/pages/SettingsPage/components/TestModeToggle', () => ({ TestModeToggle: () => <div>test-mode-body</div> }));
vi.mock('@/pages/SettingsPage/tabs/PdpaTab', () => ({ PdpaTab: () => <div>pdpa-body</div> }));
vi.mock('@/pages/SettingsPage/tabs/OffsiteBackupTab', () => ({ OffsiteBackupTab: () => <div>backup-body</div> }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

function renderCat(id: string, hash = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings/${id}${hash}`]}>
      <CategoryPage categoryId={id} />
    </MemoryRouter>,
  );
}

/** เรนเดอร์ตามเส้นทางจริง (SettingsLayout ห่อ CategoryPage) — ชื่อหมวดย้ายไปอยู่บน
 *  PageHeader ของ layout แล้ว จึงต้องทดสอบที่ระดับที่ผู้ใช้เห็นจริง */
function renderRoute(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings/${id}`]}>
      <Routes>
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('CategoryPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Capture console.error to detect React duplicate-key warnings
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('scrolls to the section matching the URL hash after forms load', async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
    role = 'OWNER';
    renderCat('system', '#test-mode');
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
  });

  it('แสดงชื่อหมวดเป็นหัวข้อหน้า และแสดงครั้งเดียว (ไม่ซ้ำกับ h2 เดิมใน CategoryPage)', () => {
    role = 'OWNER';
    renderRoute('system');
    expect(screen.getAllByRole('heading', { name: 'ระบบ & ความปลอดภัย' })).toHaveLength(1);
  });

  it('CategoryPage เดี่ยว ๆ ไม่วาดชื่อหมวดซ้ำ (เจ้าของหัวข้อคือ SettingsLayout)', () => {
    role = 'OWNER';
    renderCat('system');
    expect(screen.queryByRole('heading', { name: 'ระบบ & ความปลอดภัย' })).toBeNull();
  });

  it('breadcrumb บอกตำแหน่ง และมีทางกลับหน้าหลัก', () => {
    role = 'OWNER';
    renderRoute('system');
    const home = screen.getByRole('link', { name: 'หน้าหลัก' });
    expect(home.getAttribute('href')).toBe('/');
  });

  it('ชื่อแท็บเบราว์เซอร์บอกหมวด — เดิมทั้ง 10 หมวดใช้ชื่อเดียวกันหมด', () => {
    role = 'OWNER';
    renderRoute('system');
    expect(document.title).toContain('ระบบ & ความปลอดภัย');
  });

  it('ลำดับหัวข้อไม่ข้ามระดับ (h1 → h2 ไม่ใช่ h1 → h3)', () => {
    role = 'OWNER';
    renderRoute('system');
    const levels = screen
      .getAllByRole('heading')
      .map((h) => Number(h.tagName.slice(1)))
      .filter((n) => Number.isFinite(n));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('render inline component sections ของหมวด (system)', async () => {
    role = 'OWNER';
    renderCat('system');
    expect(await screen.findByText('test-mode-body')).toBeTruthy();
    expect(await screen.findByText('pdpa-body')).toBeTruthy();
    expect(await screen.findByText('backup-body')).toBeTruthy();
  });

  it('no duplicate-key warning on system category (ข้อมูล group contiguous after เชื่อมต่อ moved out)', () => {
    role = 'OWNER';
    renderCat('system');
    // Assert no console.error calls with "duplicate key" warning
    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes('Encountered two children with the same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it('render external item เป็นลิงก์', () => {
    role = 'OWNER';
    renderCat('system');
    const link = screen.getByRole('link', { name: /Audit Log/ });
    expect(link.getAttribute('href')).toBe('/audit-logs');
  });

  it('หมวดไม่รู้จัก → ข้อความว่าง ไม่ crash', () => {
    role = 'OWNER';
    renderCat('nope');
    expect(screen.getByText('ไม่พบหมวดนี้')).toBeTruthy();
  });

  it('valid → invalid category on same instance does not crash (hooks stable)', () => {
    role = 'OWNER';
    const { rerender } = render(<MemoryRouter><CategoryPage categoryId="system" /></MemoryRouter>);
    expect(() =>
      rerender(<MemoryRouter><CategoryPage categoryId="nope" /></MemoryRouter>),
    ).not.toThrow();
    expect(screen.getByText('ไม่พบหมวดนี้')).toBeTruthy();
  });
});
