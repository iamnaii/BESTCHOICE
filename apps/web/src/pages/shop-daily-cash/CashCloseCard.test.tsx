import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CashCloseCard from './CashCloseCard';
import { latestEffectiveClose, parseAmount, varianceLabel, type CashClose, type CashCloseStatusResponse } from './cash-close';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post }, getErrorMessage: (error: Error) => error.message }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const close = (over: Partial<CashClose> = {}): CashClose => ({
  id: 'cl-1', branchId: 'br-1', branchName: 'สาขาตัวอย่าง', status: 'PENDING_CONFIRM', attemptNo: 1, periodStart: null,
  countedAt: '2026-09-20T13:40:00.000Z', floatAmount: 2000, cashIn: 16500, cashOut: 5790, expectedAmount: 12710, countedAmount: 12510,
  varianceAmount: -200, varianceReason: 'ทอนเงินลูกค้าผิด 200', sendAmount: 10510, countedBy: { id: 'u-sales', name: 'ธนา' },
  receivedAmount: null, receiveVariance: null, receiveNote: null, destination: null, confirmedBy: null, confirmedAt: null,
  sentBackBy: null, sentBackAt: null, sentBackReason: null, ...over,
});

const status = (over: Partial<CashCloseStatusResponse> = {}): CashCloseStatusResponse => ({
  date: '2026-09-20', asOf: '2026-09-20T13:00:00.000Z', branchId: 'br-1', branchName: 'สาขาตัวอย่าง',
  round: { periodStart: null, floatAmount: 2000, cashIn: 16500, cashOut: 5790, expectedAmount: 12710, movementCount: 9 },
  closes: [], awaitingConfirm: [], permissions: { canCount: true, canConfirm: false, viewerId: 'u-sales' }, ...over,
});

function renderCard(response: CashCloseStatusResponse) {
  mocks.get.mockResolvedValue({ data: response });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CashCloseCard branchId="br-1" date="2026-09-20" isToday /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('ตัวช่วยนับเงินปิดยอด', () => {
  it('ป้ายส่วนต่าง: ขาด / เกิน / ตรง (ทำงานเป็นสตางค์)', () => {
    expect(varianceLabel(-200)).toBe('ขาด 200.00');
    expect(varianceLabel(50)).toBe('เกิน 50.00');
    expect(varianceLabel(0.1 + 0.2 - 0.3)).toBe('ตรง');
  });
  it('แปลงยอดที่พิมพ์: รับลูกน้ำ · ปฏิเสธติดลบ/ตัวอักษร/ทศนิยมเกิน 2 ตำแหน่ง', () => {
    expect(parseAmount('12,510.00')).toBe(12510);
    expect(parseAmount('0')).toBe(0);
    for (const bad of ['', '-5', '12.345', 'abc', '1e3']) expect(parseAmount(bad)).toBeNull();
  });
  it('ขอบ "หลังปิดยอด" = การปิดยอดที่ยังมีผลครั้งล่าสุด ไม่นับแถวที่ถูกตีกลับ', () => {
    const rows = [close({ id: 'a', countedAt: '2026-09-20T10:00:00.000Z' }), close({ id: 'b', countedAt: '2026-09-20T12:00:00.000Z', status: 'SENT_BACK' })];
    expect(latestEffectiveClose(rows)?.id).toBe('a');
    expect(latestEffectiveClose([])).toBeNull();
  });
});

describe('CashCloseCard', () => {
  it('สถานะ 1: แสดงยอดที่ต้องมี → นับไม่ตรงต้องใส่เหตุผลก่อนบันทึก → ส่งยอดนับ + เหตุผล', async () => {
    mocks.post.mockResolvedValue({ data: close() });
    renderCard(status());
    expect(await screen.findByText('12,710.00 ฿')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'นับเงินปิดยอดวันนี้' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'บันทึกยอดนับ' });
    expect(save).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/เงินสดที่นับได้จริง/), '12510');
    expect(within(dialog).getByRole('status')).toHaveTextContent('ขาด 200.00');
    expect(within(dialog).getByText(/ส่งเงิน 10,510.00/)).toBeInTheDocument();
    expect(save).toBeDisabled(); // ยอดไม่ตรง ยังไม่มีเหตุผล
    await userEvent.type(within(dialog).getByLabelText(/เหตุผลของส่วนต่าง/), 'ทอนเงินผิด');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close',
      { branchId: 'br-1', countedAmount: 12510, varianceReason: 'ทอนเงินผิด' }));
  });

  it('นับตรง = ไม่ถามเหตุผล และไม่ส่ง varianceReason', async () => {
    mocks.post.mockResolvedValue({ data: close({ varianceAmount: 0, countedAmount: 12710, sendAmount: 10710, varianceReason: null }) });
    renderCard(status());
    await userEvent.click(await screen.findByRole('button', { name: 'นับเงินปิดยอดวันนี้' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/เงินสดที่นับได้จริง/), '12,710');
    expect(within(dialog).getByRole('status')).toHaveTextContent('ตรง');
    expect(within(dialog).queryByLabelText(/เหตุผลของส่วนต่าง/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'บันทึกยอดนับ' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close',
      { branchId: 'br-1', countedAmount: 12710, varianceReason: undefined }));
  });

  it('ไม่มีเงินสดใหม่ตั้งแต่ปิดยอดครั้งก่อน = ปุ่มนับถูกปิด · คนที่นับไม่ได้ไม่เห็นปุ่ม', async () => {
    const view = renderCard(status({ round: { periodStart: '2026-09-20T13:40:00.000Z', floatAmount: 2000, cashIn: 0, cashOut: 0, expectedAmount: 2000, movementCount: 0 } }));
    expect(await screen.findByRole('button', { name: 'นับเงินปิดยอดวันนี้' })).toBeDisabled();
    expect(screen.getByText(/ยังไม่มีรายการเงินสดใหม่ตั้งแต่ปิดยอดครั้งก่อน/)).toBeInTheDocument();
    view.unmount();
    renderCard(status({ permissions: { canCount: false, canConfirm: true, viewerId: 'u-owner' } }));
    expect(await screen.findByText('12,710.00 ฿')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'นับเงินปิดยอดวันนี้' })).not.toBeInTheDocument();
  });

  it('สถานะ 2: ผู้นับไม่เห็นปุ่มยืนยันของตัวเอง แม้มีสิทธิ์ยืนยัน', async () => {
    renderCard(status({ awaitingConfirm: [close({ countedBy: { id: 'u-bm', name: 'ผจก.' } })], closes: [close({ countedBy: { id: 'u-bm', name: 'ผจก.' } })],
      permissions: { canCount: true, canConfirm: true, viewerId: 'u-bm' } }));
    expect(await screen.findByText('นับแล้ว รอยืนยันรับเงิน')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยืนยันรับเงิน' })).not.toBeInTheDocument();
    expect(screen.getByText(/คุณเป็นผู้นับ/)).toBeInTheDocument();
  });

  it('ยืนยันรับเงิน: รับจริงไม่เท่ายอดแจ้งส่งต้องมีหมายเหตุ → ส่งยอด ปลายทาง และหมายเหตุ', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'CONFIRMED' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: { canCount: false, canConfirm: true, viewerId: 'u-owner' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรับเงิน' }));
    const dialog = await screen.findByRole('dialog');
    const received = within(dialog).getByLabelText(/เงินที่รับมาจริง/);
    expect(received).toHaveValue('10,510.00');
    await userEvent.clear(received); await userEvent.type(received, '10500');
    const confirm = within(dialog).getByRole('button', { name: 'ยืนยันรับเงินและปิดยอด' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/หมายเหตุ/), 'ขาดไป 10 บาท');
    await userEvent.selectOptions(within(dialog).getByLabelText('นำเงินไปไว้ที่'), 'BANK_DEPOSIT');
    await userEvent.click(confirm);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close/cl-1/confirm',
      { receivedAmount: 10500, destination: 'BANK_DEPOSIT', note: 'ขาดไป 10 บาท' }));
  });

  it('ตีกลับให้นับใหม่: ต้องมีเหตุผลก่อนยืนยัน', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'SENT_BACK' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: { canCount: false, canConfirm: true, viewerId: 'u-owner' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรับเงิน' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'ตีกลับให้นับใหม่' }));
    const submit = within(dialog).getByRole('button', { name: 'ยืนยันตีกลับ' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/เหตุผลที่ตีกลับ/), 'นับรวมแบงก์ปลอม');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close/cl-1/send-back', { reason: 'นับรวมแบงก์ปลอม' }));
  });
});
