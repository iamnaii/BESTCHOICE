import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router';
import MainLayout from '../MainLayout';
import { useLayout } from '../LayoutContext';
import { ExitSettingsBar } from '../SettingsNav';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'เจ้าของ', role } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ showKeyboardShortcuts: false }) }));
vi.mock('@/hooks/useGlobalShortcuts', () => ({
  useGlobalShortcuts: () => ({ showShortcutsHelp: false, setShowShortcutsHelp: () => {} }),
}));
vi.mock('../Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock('../TopBar', () => ({ default: () => <div data-testid="topbar" /> }));
vi.mock('../MobileBottomNav', () => ({ default: () => null }));
vi.mock('../TestModeBanner', () => ({ default: () => null }));
vi.mock('@/components/CommandPalette', () => ({ default: () => null }));
vi.mock('@/components/InboundCallPopup', () => ({ InboundCallPopup: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function Probe() {
  const loc = useLocation();
  const { currentZone, settingsReturn } = useLayout();
  return (
    <div>
      <div data-testid="probe">
        {`${loc.pathname}${loc.search}${loc.hash}|${currentZone}|${settingsReturn ? settingsReturn.zone + ':' + settingsReturn.path : 'null'}`}
      </div>
      {/* ลิงก์ตั้งค่าแบบเดียวกับเมนูอวตารบน TopBar / Ctrl+K — ไม่ผ่านปุ่มเฟือง */}
      <Link to="/settings/accounting">ไปตั้งค่า</Link>
      <Link to="/">หน้าหลัก</Link>
      <Link to="/overdue?tab=late#row-9">งานติดตามหนี้</Link>
      <ExitSettingsBar />
    </div>
  );
}

function renderAt(entry: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Probe />} />
          <Route path="/overdue" element={<Probe />} />
          <Route path="/settings/:categoryId" element={<Probe />} />
        </Route>
      </Routes>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

const probe = () => screen.getByTestId('probe').textContent ?? '';

beforeEach(() => {
  role = 'OWNER';
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('เข้าตั้งค่าโดยไม่ผ่านปุ่มเฟือง', () => {
  it('จำโซน+หน้าที่จากมา แล้วปุ่มออกพากลับที่เดิม', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    renderAt('/overdue');
    expect(probe()).toContain('|fin|');

    fireEvent.click(screen.getByText('ไปตั้งค่า'));
    expect(probe()).toContain('/settings/accounting|settings|fin:/overdue');

    fireEvent.click(screen.getByTestId('exit-settings'));
    expect(probe()).toContain('/overdue?zone=fin|fin|');
  });

  it('จำ query string + hash ด้วย (หน้าที่เก็บสถานะไว้ใน URL)', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    renderAt('/overdue');
    fireEvent.click(screen.getByText('งานติดตามหนี้'));
    expect(probe()).toContain('/overdue?tab=late#row-9|fin|');

    fireEvent.click(screen.getByText('ไปตั้งค่า'));
    expect(probe()).toContain('fin:/overdue?tab=late#row-9');

    fireEvent.click(screen.getByTestId('exit-settings'));
    expect(probe()).toContain('/overdue?tab=late&zone=fin#row-9|fin|');
  });
});

describe('ค้างอยู่โหมดตั้งค่าแล้วไปหน้าหลัก', () => {
  it('รีเซ็ตโซนกลับ defaultZone — ไม่ค้างเมนูตั้งค่าบนหน้า Dashboard', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    renderAt('/settings/accounting');
    expect(probe()).toContain('|settings|');

    fireEvent.click(screen.getByText('หน้าหลัก'));
    expect(probe()).toContain('/|shop|');
  });

  it('ที่จำไว้ถูกล้างเมื่อออกทางอื่น — เข้าใหม่ต้องไม่ถูกพากลับหน้าเก่าที่เลิกทำแล้ว', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    renderAt('/overdue');
    fireEvent.click(screen.getByText('ไปตั้งค่า'));
    expect(probe()).toContain('fin:/overdue');

    // ออกทาง breadcrumb "หน้าหลัก" (ไม่ใช่ปุ่มออก) → ที่จำไว้ต้องหาย
    fireEvent.click(screen.getByText('หน้าหลัก'));
    expect(probe()).toContain('/|fin|null');

    // เข้าตั้งค่าอีกรอบจากหน้าหลัก แล้วออก → ต้องกลับ '/' ไม่ใช่ /overdue
    fireEvent.click(screen.getByText('ไปตั้งค่า'));
    expect(probe()).toContain('fin:/');
    fireEvent.click(screen.getByTestId('exit-settings'));
    expect(probe()).toContain('/?zone=fin|fin|');
  });
});
