import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { LayoutProvider, useLayout } from '../LayoutContext';
import { ExitSettingsBar, SettingsNavList, useSettingsZone } from '../SettingsNav';
import { getZoneEntryPathForRole, resolveZoneForPath, COMMON_PATHS } from '@/config/menu';
import { settingsNavEntries } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));

function Probe() {
  const loc = useLocation();
  const { currentZone } = useLayout();
  return <div data-testid="probe">{`${loc.pathname}|${currentZone}`}</div>;
}

function EnterButton() {
  const { enter } = useSettingsZone();
  return <button onClick={enter}>enter</button>;
}

function Harness({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <LayoutProvider>
        <EnterButton />
        <ExitSettingsBar />
        <SettingsNavList />
        <Probe />
      </LayoutProvider>
    </MemoryRouter>
  );
}

const probe = () => screen.getByTestId('probe').textContent;

beforeEach(() => {
  role = 'OWNER';
  localStorage.clear();
  // LayoutProvider อ่าน ?zone= จาก window.location ตอน init (ไม่ผ่าน router)
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('ออกจากโหมดตั้งค่า', () => {
  it('พากลับ "โซนที่จากมาจริง" ไม่ใช่ defaultZone ของ role', () => {
    // OWNER มี defaultZone = shop แต่กำลังทำงานอยู่ไฟแนนซ์
    window.history.replaceState({}, '', '/?zone=fin');
    render(<Harness entry="/finance-portfolio" />);

    fireEvent.click(screen.getByText('enter'));
    expect(probe()).toBe('/settings|settings');

    fireEvent.click(screen.getByTestId('exit-settings'));
    expect(probe()).toBe('/finance-portfolio|fin');
  });

  it('เปลี่ยน path ด้วย ไม่ใช่สลับโซนเฉย ๆ (ของเดิมค้างอยู่หน้า /settings)', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    render(<Harness entry="/settings/accounting" />);
    fireEvent.click(screen.getByTestId('exit-settings'));
    expect(probe()).not.toContain('/settings');
  });

  it('ป้ายบอกโซนปลายทางตามที่จากมา', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    render(<Harness entry="/finance-portfolio" />);
    fireEvent.click(screen.getByText('enter'));
    expect(screen.getByTestId('exit-settings').textContent).toContain('ไฟแนนซ์');
  });

  it('เข้าตรงด้วย ?zone=settings (ไม่มีที่จำ) → ตกไป landing ของ defaultZone', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    render(<Harness entry="/settings/accounting" />);
    expect(screen.getByTestId('exit-settings').textContent).toContain('หน้าร้าน');
    fireEvent.click(screen.getByTestId('exit-settings'));
    expect(probe()).toBe('/|shop');
  });

  it('ACCOUNTANT ไม่ถูกส่งไป /finance-portfolio (ไม่มีในเมนู ACC → โดน toast ไม่มีสิทธิ์ผี)', () => {
    role = 'ACCOUNTANT';
    window.history.replaceState({}, '', '/?zone=settings');
    render(<Harness entry="/settings/accounting" />);
    fireEvent.click(screen.getByTestId('exit-settings'));
    const [path] = (probe() ?? '').split('|');
    expect(path).not.toBe('/finance-portfolio');
    expect(resolveZoneForPath('ACCOUNTANT', path)).toBe('fin');
  });
});

describe('getZoneEntryPathForRole', () => {
  it.each([
    ['OWNER', 'shop'],
    ['OWNER', 'fin'],
    ['FINANCE_MANAGER', 'fin'],
    ['ACCOUNTANT', 'fin'],
  ] as const)('%s/%s: ปลายทางต้องไม่ทำให้ MainLayout เด้ง "ไม่มีสิทธิ์"', (r, zone) => {
    const path = getZoneEntryPathForRole(r, zone);
    expect(COMMON_PATHS.has(path) || resolveZoneForPath(r, path) !== null).toBe(true);
  });
});

describe('SettingsNavList', () => {
  it('เห็นครบทุกหมวดทันที ไม่ต้องกาง accordion ก่อน', () => {
    render(<Harness entry="/settings/accounting" />);
    for (const entry of settingsNavEntries('OWNER' as SettingsRole)) {
      expect(screen.getByTestId(`settings-nav-${entry.id}`)).toBeTruthy();
    }
  });

  it('หมวดที่เปิดอยู่มี aria-current="page" และมีตัวเดียว', () => {
    render(<Harness entry="/settings/accounting" />);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/settings/accounting');
  });

  it('หน้าย่อยชั้น 3 ยังไฮไลต์หมวดแม่', () => {
    render(<Harness entry="/settings/accounting/chart" />);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/settings/accounting');
  });

  it('ACCOUNTANT ไม่เห็นหมวด OWNER-only', () => {
    role = 'ACCOUNTANT';
    render(<Harness entry="/settings/accounting" />);
    expect(screen.queryByTestId('settings-nav-system')).toBeNull();
    expect(screen.getByTestId('settings-nav-integrations')).toBeTruthy();
  });
});
