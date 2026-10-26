import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DashboardPage from './index';

/**
 * หน้า `/` เลือกหน้าตามโซนที่สวิตช์เมนูอยู่ (spec §3): โซนหน้าร้าน → ShopHome ทุกบทบาท;
 * โซนการเงิน → ของเดิม (SALES → StaffHome, อื่น → ManagementDashboard)
 */
const state = vi.hoisted(() => ({ role: 'OWNER', zone: 'shop' }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', name: 'ผู้ใช้ทดสอบ', role: state.role } }),
}));
vi.mock('@/components/layout/LayoutContext', () => ({
  useLayout: () => ({ workZone: state.zone, currentZone: state.zone }),
}));
vi.mock('@/pages/ShopHomePage', () => ({ default: () => <main aria-label="shop-home" /> }));
vi.mock('./ManagementDashboard', () => ({ default: () => <main aria-label="management" /> }));
vi.mock('./components/StaffHome', () => ({ default: () => <main aria-label="staff-home" /> }));

beforeEach(() => {
  state.role = 'OWNER';
  state.zone = 'shop';
});

describe('DashboardPage เลือกหน้าตามโซน × บทบาท', () => {
  it.each([
    ['OWNER', 'shop', 'shop-home'],
    ['SALES', 'shop', 'shop-home'],
    ['FINANCE_MANAGER', 'shop', 'shop-home'],
    ['OWNER', 'fin', 'management'],
    ['SALES', 'fin', 'staff-home'],
  ])('%s ในโซน %s → %s', async (role, zone, expected) => {
    state.role = role;
    state.zone = zone;
    render(<DashboardPage />);
    expect(await screen.findByLabelText(expected)).toBeInTheDocument();
  });
});
