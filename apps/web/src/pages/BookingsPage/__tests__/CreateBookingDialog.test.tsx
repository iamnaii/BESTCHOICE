import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { toBangkokDateString, toBangkokExpiryInstant } from '@/lib/date';
import CreateBookingDialog from '../components/CreateBookingDialog';
import type { Booking } from '../types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  role: 'SALES' as string,
  customersFail: false,
}));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch },
  getErrorMessage: (e: Error) => e.message,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }),
}));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({
  default: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (c: { id: string; name: string; phone?: string }) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => onCreated({ id: 'c-new', name: 'ลูกค้าใหม่', phone: '0899999999' })}
      >
        สร้างลูกค้าใหม่ (จำลอง)
      </button>
    ) : null,
  splitDisplayName: (s: string) => ({ firstName: s }),
}));

const customer = { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' };
const product = {
  id: 'p1',
  name: 'iPhone 16 Pro 256GB',
  imeiSerial: '354912070045218',
  branchId: 'br-1',
  status: 'IN_STOCK',
  cashPrice: '42900',
  installmentPrice: '45900',
  prices: [],
};
const paidBooking: Booking = {
  id: 'bk-1',
  bookingNumber: 'BK-20261005-0002',
  status: 'PAID',
  depositAmount: '5000',
  totalAmount: '42900',
  expireDate: '2026-10-11T17:00:00.000Z',
  depositPaidAt: '2026-10-05T03:55:00Z',
  notes: 'เดิม',
  createdAt: '2026-10-05T03:42:00Z',
  customer,
  branch: { id: 'br-1', name: 'ลาดพร้าว' },
  createdBy: { id: 'u1', name: 'น้ำ' },
  items: [
    {
      id: 'i1',
      productId: 'p1',
      description: 'iPhone 16 Pro 256GB · 354912070045218',
      quantity: 1,
      unitPrice: '42900',
      amount: '42900',
    },
  ],
};

function renderDialog(props: Partial<React.ComponentProps<typeof CreateBookingDialog>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CreateBookingDialog open onClose={onClose} onSaved={onSaved} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onSaved, onClose };
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'SALES';
  mocks.customersFail = false;
  mocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/customers')) {
      if (mocks.customersFail) throw new Error('ค้นหาล้ม');
      return { data: { data: [customer] } };
    }
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'ลาดพร้าว' }] };
    if (path === '/products') return { data: { data: [product] } };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({
    data: { ...paidBooking, id: 'bk-new', status: 'PENDING_DEPOSIT' },
  });
  mocks.patch.mockResolvedValue({ data: paidBooking });
});

describe('CreateBookingDialog', () => {
  it('ต้องมีลูกค้า + เครื่อง ก่อนปุ่มบันทึกจะเปิด · ส่ง 1 เครื่อง quantity 1 · วันหมดอายุ = สิ้นวันไทยของชิป 7 วัน', async () => {
    const { onSaved } = renderDialog({ initialCustomer: customer });
    const save = screen.getByRole('button', { name: 'บันทึกใบจอง' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
    await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
    expect(screen.getAllByText('42,900').length).toBeGreaterThan(0); // ราคาเงินสดจากเครื่อง (การ์ด + แถบสรุป)
    await userEvent.click(screen.getByRole('button', { name: /20%/ })); // มัดจำ 20% = 8,580
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [, body] = mocks.post.mock.calls[0];
    expect(body.items).toEqual([
      {
        productId: 'p1',
        description: expect.stringContaining('iPhone 16 Pro'),
        quantity: 1,
        unitPrice: 42900,
      },
    ]);
    expect(body.depositAmount).toBe(8580);
    expect(body.customerId).toBe('c1');
    expect(body.expireDate).toBe(
      toBangkokExpiryInstant(toBangkokDateString(new Date(Date.now() + 7 * 86_400_000))),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-new' }), {
      collectDeposit: false,
    });
  });

  it('ชิปวันหมดอายุ 3 วัน เปลี่ยนวันที่ และ "บันทึกและรับมัดจำเลย" ส่ง collectDeposit: true', async () => {
    const { onSaved } = renderDialog({ initialCustomer: customer });
    await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
    await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
    await userEvent.click(screen.getByRole('button', { name: 'เต็มจำนวน' }));
    await userEvent.click(screen.getByRole('button', { name: '3 วัน' }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกและรับมัดจำเลย' }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(expect.anything(), { collectDeposit: true }),
    );
    const body = mocks.post.mock.calls[0][1];
    expect(body.depositAmount).toBe(42900);
    expect(body.expireDate).toBe(
      toBangkokExpiryInstant(toBangkokDateString(new Date(Date.now() + 3 * 86_400_000))),
    );
  });

  it('มัดจำ 0 หรือเกินยอดรวม → บันทึกไม่ได้ และบอกเหตุผล', async () => {
    renderDialog({ initialCustomer: customer });
    await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
    await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
    const deposit = screen.getByLabelText('เงินมัดจำที่จะรับ (บาท)');
    await userEvent.clear(deposit);
    await userEvent.type(deposit, '0');
    expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeDisabled();
    expect(screen.getByText(/มัดจำต้องมากกว่า 0/)).toBeInTheDocument();
    await userEvent.clear(deposit);
    await userEvent.type(deposit, '50000');
    expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeDisabled();
  });

  it('เลือกลูกค้าจากช่องค้นหาช่องเดียว และสร้างลูกค้าใหม่ได้โดยไม่ออกจากฟอร์ม', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
    await userEvent.type(screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร'), 'สม');
    await userEvent.click(await screen.findByText('สมชาย ใจดี'));
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('สมชาย ใจดี');
    await userEvent.click(screen.getByRole('button', { name: 'ล้างลูกค้า' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
    await userEvent.click(await screen.findByRole('button', { name: /สร้างลูกค้าใหม่/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'สร้างลูกค้าใหม่ (จำลอง)' }));
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('ลูกค้าใหม่');
  });

  it('ลูกค้าที่เลือกไว้ยังอยู่เมื่อการค้นหาครั้งต่อไปล้ม', async () => {
    renderDialog({ initialCustomer: customer });
    mocks.customersFail = true;
    await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
    await userEvent.type(screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร'), 'x');
    expect(await screen.findByText(/โหลดลูกค้าไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('สมชาย ใจดี');
  });

  it('แก้ใบที่มัดจำแล้ว: แก้ได้เฉพาะหมายเหตุ/วันหมดอายุ · ล้างหมายเหตุได้ · ไม่ส่งเงิน/เครื่อง · คงเวลาหมดอายุเดิม', async () => {
    const { onSaved } = renderDialog({ initialBooking: paidBooking });
    expect(screen.getByRole('heading', { name: 'แก้หมายเหตุ / วันหมดอายุ' })).toBeInTheDocument();
    expect(screen.queryByLabelText('เงินมัดจำที่จะรับ (บาท)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกและรับมัดจำเลย' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('หมายเหตุ'));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/bookings/bk-1', {
        notes: '',
        expireDate: '2026-10-11T17:00:00.000Z',
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'bk-1' }), {
      collectDeposit: false,
    });
  });

  it('แก้ใบที่ยังไม่รับมัดจำ: เปลี่ยนมัดจำแต่ไม่แตะวัน → ส่งเวลาหมดอายุเดิมตรงตัว (ไม่ปัดเป็นสิ้นวัน)', async () => {
    renderDialog({
      initialBooking: {
        ...paidBooking,
        status: 'PENDING_DEPOSIT',
        depositPaidAt: null,
        expireDate: '2026-10-11T10:30:00.000Z',
      },
    });
    const deposit = screen.getByLabelText('เงินมัดจำที่จะรับ (บาท)');
    await userEvent.clear(deposit);
    await userEvent.type(deposit, '6000');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        '/bookings/bk-1',
        expect.objectContaining({
          depositAmount: 6000,
          expireDate: '2026-10-11T10:30:00.000Z',
          items: [
            { productId: 'p1', description: expect.any(String), quantity: 1, unitPrice: 42900 },
          ],
        }),
      ),
    );
  });
});
