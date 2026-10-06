import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { toBangkokDateString, toBangkokExpiryInstant } from '@/lib/date';
import CreateBookingDialog from '../components/CreateBookingDialog';
import type { Booking } from '../types';

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMocks }));

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
  it('บอกว่าเครื่องจะถูกล็อกทันทีที่รับมัดจำ และก่อนรับมัดจำยังขายได้ตามปกติ', () => {
    renderDialog({ initialCustomer: customer });
    expect(
      screen.getByText(
        'เครื่องจะถูกล็อกไว้ให้ลูกค้าทันทีที่รับมัดจำ · ก่อนรับมัดจำยังขายได้ตามปกติ',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/POS ขายไม่ได้/)).not.toBeInTheDocument();
  });
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

  describe('fix round 1', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function renderControlled(initial: Partial<React.ComponentProps<typeof CreateBookingDialog>>) {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const onSaved = vi.fn();
      const ui = (props: Partial<React.ComponentProps<typeof CreateBookingDialog>>) => (
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <CreateBookingDialog open onClose={vi.fn()} onSaved={onSaved} {...props} />
          </QueryClientProvider>
        </MemoryRouter>
      );
      const view = render(ui(initial));
      return {
        onSaved,
        rerender: (p: Partial<React.ComponentProps<typeof CreateBookingDialog>>) =>
          view.rerender(ui(p)),
      };
    }

    it('เปิดใหม่หลังปิด → ฟอร์มว่างเหมือนเดิม', async () => {
      const { rerender } = renderControlled({});
      await userEvent.click(screen.getByRole('combobox', { name: 'ลูกค้า' }));
      await userEvent.type(screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร'), 'สม');
      await userEvent.click(await screen.findByText('สมชาย ใจดี'));
      await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
      await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
      expect(screen.getByRole('button', { name: 'เปลี่ยนเครื่อง' })).toBeInTheDocument();
      rerender({ open: false });
      rerender({ open: true });
      expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent(
        'ค้นหาชื่อหรือเบอร์โทรลูกค้า',
      );
      expect(screen.queryByRole('button', { name: 'เปลี่ยนเครื่อง' })).not.toBeInTheDocument();
    });

    it('เปลี่ยนใบที่แก้ A → B ฟอร์มแสดงของ B', () => {
      const { rerender } = renderControlled({ initialBooking: paidBooking });
      expect(screen.getByLabelText('หมายเหตุ')).toHaveValue('เดิม');
      rerender({ initialBooking: { ...paidBooking, id: 'bk-2', notes: 'ใบอื่น' } });
      expect(screen.getByLabelText('หมายเหตุ')).toHaveValue('ใบอื่น');
    });

    it('วันหมดอายุย้อนหลัง → ขึ้นข้อความผิดและปุ่มบันทึกปิด', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-10T05:00:00Z'));
      renderDialog({ initialCustomer: customer });
      await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
      await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
      await userEvent.click(screen.getByRole('button', { name: /20%/ }));
      expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'เลือกวันที่…' }));
      const date = screen.getByLabelText('วันหมดอายุ');
      expect(date).toHaveAttribute('min', '2026-10-10');
      fireEvent.change(date, { target: { value: '2026-10-09' } });
      expect(screen.getByText('วันหมดอายุต้องไม่ย้อนหลัง')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'บันทึกและรับมัดจำเลย' })).toBeDisabled();
    });

    it('เซิร์ฟเวอร์ปฏิเสธ → toast.error ข้อความไทยของเซิร์ฟเวอร์ และไม่เรียก onSaved', async () => {
      const msg = 'สินค้านี้ไม่พร้อมจอง — เลือกเครื่องอื่น';
      mocks.post.mockRejectedValueOnce(new Error(msg));
      const { onSaved } = renderDialog({ initialCustomer: customer });
      await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
      await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
      await userEvent.click(screen.getByRole('button', { name: /20%/ }));
      await userEvent.click(screen.getByRole('button', { name: 'บันทึกใบจอง' }));
      await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith(msg));
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('ชิปที่เลือกอยู่มี aria-pressed=true และทศนิยมเกิน 2 ตำแหน่งบล็อกการบันทึก', async () => {
      renderDialog({ initialCustomer: customer });
      await userEvent.type(screen.getByLabelText('ค้นหาเครื่องในสาขา'), 'iphone');
      await userEvent.click(await screen.findByRole('button', { name: /iPhone 16 Pro 256GB/ }));
      const full = screen.getByRole('button', { name: 'เต็มจำนวน' });
      expect(full).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(full);
      expect(full).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(screen.getByRole('button', { name: '3 วัน' }));
      expect(screen.getByRole('button', { name: '3 วัน' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '7 วัน' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      fireEvent.change(screen.getByLabelText('เงินมัดจำที่จะรับ (บาท)'), {
        target: { value: '100.123' },
      });
      expect(screen.getByText('ทศนิยมไม่เกิน 2 ตำแหน่ง')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'บันทึกใบจอง' })).toBeDisabled();
    });
  });
});
