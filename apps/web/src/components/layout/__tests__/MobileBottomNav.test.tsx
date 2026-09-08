import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import MobileBottomNav from '../MobileBottomNav';
import { LayoutProvider, useLayout } from '../LayoutContext';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'เจ้าของ', role } }) }));
vi.mock('@/hooks/useUnreadChat', () => ({ useUnreadChat: () => 0 }));
vi.mock('@/pages/CollectionsPage/hooks/useCollectionsFlag', () => ({
  useCollectionsFlag: () => ({ enabled: false }),
}));

function Probe() {
  const loc = useLocation();
  const { currentZone } = useLayout();
  return <div data-testid="probe">{`${loc.pathname}|${currentZone}`}</div>;
}

function renderBar(entry: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]}>
      <LayoutProvider>
        <MobileBottomNav />
        <Probe />
      </LayoutProvider>
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

describe('บาร์ล่างมือถือ โหมดตั้งค่า', () => {
  it('มีปุ่มออกจากตั้งค่าอยู่บนบาร์ ไม่ต้องเปิดลิ้นชักก่อน', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    renderBar('/settings/accounting');
    expect(screen.getByTestId('exit-settings-bottomnav')).toBeTruthy();
  });

  it('กดแล้วสลับโซนและเปลี่ยนหน้า ไม่ใช่แค่อย่างใดอย่างหนึ่ง', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    renderBar('/settings/accounting');
    fireEvent.click(screen.getByTestId('exit-settings-bottomnav'));
    expect(probe()).toBe('/|shop');
  });

  it('เป็นปุ่ม ไม่ใช่ลิงก์ (ลิงก์เปลี่ยน path อย่างเดียว โซนจะค้าง)', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    renderBar('/settings/accounting');
    const el = screen.getByTestId('exit-settings-bottomnav');
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('href')).toBeNull();
  });

  it('ไม่โผล่นอกโหมดตั้งค่า', () => {
    renderBar('/');
    expect(screen.queryByTestId('exit-settings-bottomnav')).toBeNull();
  });

  it('ไม่ไปแทนที่ปุ่ม "เพิ่มเติม" — หน้า full-bleed ใช้ปุ่มนั้นเปิดลิ้นชักทางเดียว', () => {
    window.history.replaceState({}, '', '/?zone=settings');
    renderBar('/settings/accounting');
    expect(screen.getByLabelText('เปิดเมนูเพิ่มเติม')).toBeTruthy();
  });
});
