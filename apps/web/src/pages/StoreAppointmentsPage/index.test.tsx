import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import StoreAppointmentsPage from './index';
import type { CustomerOption } from '@/pages/BookingsPage/types';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'โหลดข้อมูลไม่สำเร็จ',
}));
vi.mock('@/pages/BookingsPage/components/CustomerCombobox', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: CustomerOption | null;
    onChange: (value: CustomerOption | null) => void;
  }) => (
    <div>
      <button role="combobox" aria-label="ลูกค้า">
        {value?.name || 'เลือกลูกค้า'}
      </button>
      {value && <button onClick={() => onChange(null)}>ล้างลูกค้า</button>}
      <button onClick={() => onChange({ id: 'other', name: 'ลูกค้าอื่น', phone: null })}>
        เลือกลูกค้าอื่น
      </button>
    </div>
  ),
}));

function renderPage(path = '/appointments') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <StoreAppointmentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('appointment workspace availability', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['appointments', 'calendar', 'schedule'])(
    'explains missing branches instead of showing empty data in %s',
    async (view) => {
      vi.mocked(api.get).mockResolvedValue({ data: { branches: [], staff: [], canManage: true } });
      renderPage(`/appointments?view=${view}`);
      expect(
        await screen.findByRole('heading', { name: 'ยังไม่มีสาขาที่ใช้รับนัดได้' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/ผูกกับงานหน้าร้าน/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ยืนยันนัดหมาย' })).not.toBeInTheDocument();
      expect(screen.queryByText('ยังไม่มีนัดหมาย')).not.toBeInTheDocument();
      expect(screen.queryByText(/เดือนนี้ 0 คน/)).not.toBeInTheDocument();
      expect(api.get).toHaveBeenCalledTimes(1);
    },
  );

  it('recovers when branch configuration becomes available and the user reloads it', async () => {
    let ready = false;
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data:
        url === '/store-appointments/options'
          ? {
              branches: ready ? [{ id: 'branch', name: 'สาขาตัวอย่าง' }] : [],
              staff: [],
              canManage: true,
            }
          : [],
    }));
    renderPage();
    const reload = await screen.findByRole('button', { name: 'โหลดสาขาอีกครั้ง' });
    ready = true;
    fireEvent.click(reload);
    expect(await screen.findByRole('region', { name: 'ฟอร์มนัดหมาย' })).toBeInTheDocument();
    expect(screen.getByLabelText('สาขาที่ดู', { exact: true })).toHaveValue('branch');
    await waitFor(() => expect(screen.getByText('ยังไม่มีนัดหมาย')).toBeInTheDocument());
    expect(
      screen.queryByRole('heading', { name: 'ยังไม่มีสาขาที่ใช้รับนัดได้' }),
    ).not.toBeInTheDocument();
  });

  it('keeps load errors distinct from a successfully loaded empty branch list', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดข้อมูลไม่สำเร็จ');
    expect(
      screen.queryByRole('heading', { name: 'ยังไม่มีสาขาที่ใช้รับนัดได้' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลองใหม่' })).toBeInTheDocument();
  });

  it('clears a customer supplied by a deep link and returns to the daily appointment list', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data:
        url === '/store-appointments/options'
          ? { branches: [{ id: 'branch', name: 'สาขาตัวอย่าง' }], staff: [], canManage: true }
          : url === '/customers/customer'
            ? { id: 'customer', name: 'ลูกค้าจากแชท' }
            : url.includes('/eligibility/')
              ? { eligible: true, reason: null }
              : [],
    }));
    renderPage('/appointments?customerId=customer');
    expect(await screen.findByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent(
      'ลูกค้าจากแชท',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'ล้างลูกค้า' }));
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('เลือกลูกค้า');
    expect(screen.queryByRole('button', { name: 'ล้างลูกค้า' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'นัดประจำวัน' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยืนยันนัดหมาย' })).toBeDisabled();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/store-appointments', {
        params: { branchId: 'branch', day: expect.any(String) },
      }),
    );
  });

  it('retains the linked room only for its original customer when creating booking links', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data:
        url === '/store-appointments/options'
          ? { branches: [{ id: 'branch', name: 'สาขาตัวอย่าง' }], staff: [], canManage: true }
          : url === '/customers/customer'
            ? { id: 'customer', name: 'ลูกค้าจากแชท' }
            : url.includes('/eligibility/')
              ? { eligible: true, reason: null }
              : [],
    }));
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'link', token: 'test-token' } });
    renderPage('/appointments?customerId=customer&roomId=original-room');
    const createLink = await screen.findByRole('button', { name: 'สร้างลิงก์ให้ลูกค้าเลือกเวลา' });
    await waitFor(() => expect(createLink).toBeEnabled());
    fireEvent.click(createLink);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/store-appointment-links',
        expect.objectContaining({ customerId: 'customer', sourceRoomId: 'original-room' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'เลือกลูกค้าอื่น' }));
    await waitFor(() => expect(createLink).toBeEnabled());
    fireEvent.click(createLink);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/store-appointment-links',
        expect.objectContaining({ customerId: 'other', sourceRoomId: undefined }),
      ),
    );
  });
});
