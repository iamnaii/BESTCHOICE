import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import AppointmentCalendar, { monthCells } from './AppointmentCalendar';
vi.mock('@/lib/api', () => ({ default: { get: vi.fn() }, getErrorMessage: () => 'โหลดไม่ได้' }));
describe('monthly appointment calendar', () => {
  it('lays out leap February and December without losing a day', () => {
    const leap = monthCells('2028-02');
    expect(leap.filter(Boolean)).toHaveLength(29);
    expect(leap.indexOf('2028-02-01')).toBe(2);
    expect(monthCells('2026-12').filter(Boolean)).toHaveLength(31);
    expect(monthCells('2026-12')).toContain('2026-12-31');
  });
  it('uses server totals, selects dates and links a day appointment to its management page', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url.endsWith('/day')
        ? {
            rows: [
              {
                id: 'visit',
                reference: 'BC-1',
                customer: { id: 'customer', name: 'ลูกค้าตัวอย่าง' },
                staff: { name: 'ผู้รับนัด' },
                startsAt: '2026-10-11T11:30:00Z',
                endsAt: '2026-10-11T12:15:00Z',
                status: 'BOOKED',
              },
            ],
            total: 1,
            pageSize: 50,
          }
        : {
            customers: 230,
            appointments: 240,
            days: [
              {
                day: '2026-10-11',
                customers: 3,
                appointments: 4,
                booked: 2,
                checkedIn: 1,
                inService: 0,
                completed: 1,
              },
            ],
          },
    }));
    const onDay = vi.fn();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <AppointmentCalendar branchId="branch" day="2026-10-11" onDay={onDay} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('เดือนนี้ 230 คน · 240 นัด')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /11 ต.ค. 2569: 3 คน, 4 นัด/ }));
    expect(onDay).toHaveBeenCalledWith('2026-10-11');
    expect(screen.getByRole('link', { name: /ลูกค้าตัวอย่าง/ })).toHaveAttribute(
      'href',
      '/appointments?appointmentId=visit&customerId=customer',
    );
    fireEvent.click(screen.getByRole('button', { name: 'เดือนถัดไป' }));
    expect(onDay).toHaveBeenLastCalledWith('2026-11-01');
  });
});
