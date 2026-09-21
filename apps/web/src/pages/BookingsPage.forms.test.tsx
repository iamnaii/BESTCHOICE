import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import BookingsPage from './BookingsPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(),
  booking: {} as Record<string, unknown>, role: 'SALES', detailError: false }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post, patch: mocks.patch }, getErrorMessage: (error: Error) => error.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role, branchId: 'br-1' } }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><BookingsPage /></QueryClientProvider></MemoryRouter>);
}
async function detail() {
  renderPage(); await userEvent.click(await screen.findByRole('button', { name: 'เปิด' }));
  return screen.findByRole('dialog');
}
async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
// jsdom has no pointer-capture or scroll layout; keep the actual Radix select behavior.
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  HTMLElement.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.detailError = false; mocks.role = 'SALES';
  mocks.booking = { id: 'bk-1', bookingNumber: 'BK-SYNTHETIC', status: 'PAID', depositAmount: '1000', totalAmount: '10000',
    expireDate: '2099-09-11T17:00:00.000Z', depositPaidAt: '2026-09-10T00:00:00.000Z', depositMethod: 'CASH',
    customer: { id: 'c1', name: 'ลูกค้าตัวอย่าง', phone: '0800000000' },
    branch: { id: 'br-1', name: 'สาขาตัวอย่าง', shopCashAccountCode: 'S11-1101' },
    createdBy: { id: 'u1', name: 'พนักงานตัวอย่าง' },
    items: [{ id: 'i1', productId: 'p1', description: 'เครื่องตัวอย่าง', quantity: 1, unitPrice: '10000', amount: '10000' }],
  };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/bookings/bk-1') { if (mocks.detailError) throw new Error('Synthetic offline'); return { data: mocks.booking }; }
    if (path.startsWith('/bookings?')) return { data: { data: [mocks.booking], total: 1, page: 1, limit: 50 } };
    if (path.startsWith('/customers')) return { data: { data: [{ id: 'c1', name: 'ลูกค้าตัวอย่าง', phone: '0800000000' }] } };
    if (path === '/branches') return { data: [{ id: 'br-1', name: 'สาขาตัวอย่าง' }] };
    if (path === '/products') return { data: { data: [{ id: 'p1', name: 'เครื่องตัวอย่าง', imeiSerial: 'SYNTHETIC-IMEI',
      branchId: 'br-1', status: 'IN_STOCK', cashPrice: '10000', installmentPrice: '12000', prices: [] }] } };
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ data: { id: 'sale-1' } }); mocks.patch.mockResolvedValue({ data: {} });
});

describe('Booking forms and actionable states', () => {
  it('requires a balance method and confirmation, then submits the selected tender', async () => {
    await detail(); const convert = screen.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/ });
    expect(convert).toBeDisabled();
    // ช่องรับเงินกลาง: โอน/QR บังคับเลขอ้างอิง (เจ้าของเคาะ 2026-09-20) — ติ๊กยืนยันแล้วแต่ยังไม่มีเลขอ้างอิง = ยังกดไม่ได้
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงิน'), 'BANK_TRANSFER');
    await userEvent.click(screen.getByRole('checkbox', { name: 'ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว' }));
    expect(convert).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เลขอ้างอิงการโอน/), 'SYNTHETIC-REF');
    await userEvent.click(convert);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/convert', expect.objectContaining({
      collectBalance: true, paymentMethod: 'BANK_TRANSFER', saleType: 'CASH',
      tenders: [{ method: 'BANK_TRANSFER', amount: 9000, reference: 'SYNTHETIC-REF' }],
    })));
  });
  it('does not request imaginary additional payment for a fully prepaid booking', async () => {
    mocks.booking.depositAmount = '10000'; await detail();
    expect(screen.queryByLabelText('วิธีรับเงิน')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/convert', expect.objectContaining({ paymentMethod: undefined, collectBalance: undefined })));
  });
  it('uses a read-only SHOP destination and omits the old FINANCE account input', async () => {
    Object.assign(mocks.booking, { status: 'PENDING_DEPOSIT', depositPaidAt: null }); await detail();
    expect(screen.getByText(/รับเข้าบัญชี SHOP/)).toHaveTextContent('S11-1101');
    await userEvent.selectOptions(screen.getByLabelText('วิธีรับเงิน'), 'BANK_TRANSFER');
    expect(screen.getByText(/รับเข้าบัญชี SHOP/)).toHaveTextContent('S11-1201');
    expect(screen.getByRole('button', { name: 'บันทึกรับมัดจำ' })).toBeDisabled(); // ยังไม่มีเลขอ้างอิง
    await userEvent.type(screen.getByLabelText(/เลขอ้างอิงการโอน/), 'SYNTHETIC-REF');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกรับมัดจำ' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings/bk-1/pay-deposit', {
      depositMethod: 'BANK_TRANSFER', tenders: [{ method: 'BANK_TRANSFER', amount: 1000, reference: 'SYNTHETIC-REF' }],
    }));
  });
  it('blocks a legacy booking whose additional items would be discarded', async () => {
    mocks.booking.items = [{ id: 'i1', description: 'รายการเดิม', quantity: 2, productId: 'p1', unitPrice: 5000, amount: 10000 }];
    await detail(); expect(screen.getByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('1 รายการ จำนวน 1 ชิ้น');
    expect(screen.queryByRole('button', { name: 'แก้ไขใบจอง' })).not.toBeInTheDocument();
  });
  it('blocks expired actions immediately while showing a way to refresh the server status', async () => {
    mocks.booking.expireDate = '2000-01-01T17:00:00.000Z'; await detail();
    expect(screen.getByRole('status')).toHaveTextContent('ถึงกำหนดหมดอายุแล้ว');
    expect(screen.queryByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โหลดสถานะล่าสุด' })).toBeEnabled();
  });
  it('recovers a detail error without displaying a perpetual loading state', async () => {
    mocks.detailError = true; await detail();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดใบจองไม่สำเร็จ');
    mocks.detailError = false; await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/ })).toBeVisible();
  });
  it('links a real branch product at its cash price and submits the end of the selected Thai day', async () => {
    renderPage(); await userEvent.click(screen.getByRole('button', { name: 'สร้างใบจอง' }));
    await choose('ลูกค้า', 'ลูกค้าตัวอย่าง — 0800000000');
    await userEvent.type(screen.getByRole('textbox', { name: 'ค้นหาเครื่องในสาขา' }), 'SYNTHETIC');
    await userEvent.click(await screen.findByRole('button', { name: /เครื่องตัวอย่าง.*SYNTHETIC-IMEI/ }));
    expect(screen.getByRole('spinbutton', { name: 'ราคาต่อหน่วยรายการที่ 1' })).toHaveValue(10000);
    const date = screen.getByLabelText('ใช้ได้ถึงสิ้นวันที่ (เวลาไทย)');
    await userEvent.clear(date); await userEvent.type(date, '2099-09-11');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกใบจอง' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings', expect.objectContaining({
      expireDate: '2099-09-11T17:00:00.000Z', branchId: 'br-1', items: [expect.objectContaining({ productId: 'p1', quantity: 1, unitPrice: 10000 })],
    })));
    expect(mocks.get).toHaveBeenCalledWith('/products', expect.objectContaining({ params: expect.objectContaining({ branchId: 'br-1', status: 'IN_STOCK' }) }));
  });
  it('keeps the selected customer visible while another customer search fails', async () => {
    const get = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path.startsWith('/customers?') && path.includes('search=missing')) throw new Error('search unavailable');
      return get(path, ...args);
    });
    renderPage(); await userEvent.click(screen.getByRole('button', { name: 'สร้างใบจอง' }));
    await choose('ลูกค้า', 'ลูกค้าตัวอย่าง — 0800000000');
    await userEvent.type(screen.getByRole('textbox', { name: 'ค้นหาลูกค้าสำหรับใบจอง' }), 'missing');
    await screen.findByRole('button', { name: 'โหลดลูกค้าไม่สำเร็จ ลองอีกครั้ง' });
    expect(screen.getByRole('combobox', { name: 'ลูกค้า' })).toHaveTextContent('ลูกค้าตัวอย่าง');
    await userEvent.type(screen.getByRole('textbox', { name: 'ค้นหาเครื่องในสาขา' }), 'SYNTHETIC');
    await userEvent.click(await screen.findByRole('button', { name: /เครื่องตัวอย่าง.*SYNTHETIC-IMEI/ }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกใบจอง' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/bookings', expect.objectContaining({ customerId: 'c1' })));
  });
  it('preserves the original non-midnight expiry when editing other unpaid fields', async () => {
    Object.assign(mocks.booking, { status: 'PENDING_DEPOSIT', depositPaidAt: null, expireDate: '2099-09-11T05:30:00.000Z' });
    await detail(); await userEvent.click(screen.getByRole('button', { name: 'แก้ไขใบจอง' }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/bookings/bk-1', expect.objectContaining({ expireDate: '2099-09-11T05:30:00.000Z' })));
  });
  it('allows clearing a received booking note without sending its money or product fields', async () => {
    mocks.booking.notes = 'ข้อความเดิม'; await detail();
    await userEvent.click(screen.getByRole('button', { name: 'แก้หมายเหตุ / วันหมดอายุ' }));
    expect(screen.getByRole('spinbutton', { name: 'มัดจำที่รับแล้ว (บาท)' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('textbox', { name: 'ค้นหาเครื่องในสาขา' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'หมายเหตุ' }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/bookings/bk-1', {
      notes: '', expireDate: '2099-09-11T17:00:00.000Z',
    }));
  });
  it('keeps money actions hidden for a read-only role', async () => {
    mocks.role = 'ACCOUNTANT'; const dialog = await detail();
    expect(within(dialog).queryByRole('button', { name: /รับส่วนต่างและขาย|ขายโดยใช้มัดจำที่รับแล้ว/ })).not.toBeInTheDocument();
  });
});
