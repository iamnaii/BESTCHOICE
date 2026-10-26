import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import DashboardAlerts from './DashboardAlerts';
import type { DashboardAlert } from '../types';

function LocationProbe() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
const alert: DashboardAlert = {
  type: 'recurring_bills_due',
  severity: 'warning',
  message: 'บิลประจำ 2 รายการครบกำหนดใน 3 วัน',
  link: '/expenses/recurring-bills',
  count: 2,
};

describe('DashboardAlerts — การ์ดบิลประจำ (ก้อน 6)', () => {
  it('ใช้ไอคอน CalendarClock (ไม่ใช่ไอคอนสำรอง) และกดแล้วไปหน้าบิลประจำ', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}><DashboardAlerts alerts={[alert]} /><LocationProbe /></MemoryRouter>,
    );
    const card = screen.getByRole('button', { name: 'บิลประจำ 2 รายการครบกำหนดใน 3 วัน (2 รายการ) — คลิกเพื่อดูรายละเอียด' });
    expect(container.querySelector('svg.lucide-calendar-clock')).not.toBeNull();
    expect(container.querySelector('svg.lucide-triangle-alert')).toBeNull();
    await userEvent.click(card);
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/recurring-bills');
  });
});
