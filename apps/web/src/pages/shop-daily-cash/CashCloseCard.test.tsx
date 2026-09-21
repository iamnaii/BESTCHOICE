import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
  sentBackBy: null, sentBackAt: null, sentBackReason: null, journalPosted: false,
  depositReference: null, hasDepositSlip: false, moneyState: 'AWAITING_CONFIRM', ...over,
});

const status = (over: Partial<CashCloseStatusResponse> = {}): CashCloseStatusResponse => ({
  date: '2026-09-20', asOf: '2026-09-20T13:00:00.000Z', branchId: 'br-1', branchName: 'สาขาตัวอย่าง',
  round: { periodStart: null, floatAmount: 2000, cashIn: 16500, cashOut: 5790, expectedAmount: 12710, movementCount: 9 },
  closes: [], awaitingConfirm: [], permissions: { canCount: true, canConfirm: false, viewerId: 'u-sales' },
  readiness: { hasDrawerAccount: true, floatAmount: 2000, counters: [{ id: 'u-bm', name: 'วิภา', role: 'BRANCH_MANAGER' }, { id: 'u-sales', name: 'ธนา', role: 'SALES' }] },
  holdings: [], ...over,
});

function renderCard(response: CashCloseStatusResponse) {
  mocks.get.mockResolvedValue({ data: response });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><CashCloseCard branchId="br-1" date="2026-09-20" isToday /></QueryClientProvider></MemoryRouter>);
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
    expect(await screen.findByRole('heading', { name: 'รอยืนยันรับเงิน' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'นับเงินแล้ว' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ยืนยันรับเงิน/ })).not.toBeInTheDocument();
    expect(screen.getByText(/คุณเป็นผู้นับ/)).toBeInTheDocument();
  });

  it('ยืนยันรับเงิน: ต้องเลือกปลายทางเอง · รับจริงไม่เท่ายอดแจ้งส่งต้องมีหมายเหตุ → ส่งยอด ปลายทาง และหมายเหตุ', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'CONFIRMED' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: { canCount: false, canConfirm: true, viewerId: 'u-owner', viewerRole: 'OWNER' } }));
    // ขั้นที่ 2 ถึงตาผู้ยืนยัน — ปุ่มบอกยอดที่พนักงานแจ้งส่ง
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรับเงิน 10,510.00' }));
    const dialog = await screen.findByRole('dialog');
    const received = within(dialog).getByLabelText(/เงินที่รับมาจริง/);
    expect(received).toHaveValue('10,510.00');
    const confirm = within(dialog).getByRole('button', { name: 'ยืนยันรับเงินและปิดยอด' });
    expect(confirm).toBeDisabled(); // ยังไม่ได้เลือกว่านำเงินไปไว้ที่ไหน
    await userEvent.click(within(dialog).getByRole('radio', { name: /เจ้าของเก็บไว้/ }));
    expect(confirm).toBeEnabled();
    await userEvent.clear(received); await userEvent.type(received, '10500');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/หมายเหตุ/), 'ขาดไป 10 บาท');
    await userEvent.click(confirm);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close/cl-1/confirm',
      { receivedAmount: 10500, destination: 'OWNER_HOLD', note: 'ขาดไป 10 บาท', depositReference: undefined }));
    expect(mocks.post).toHaveBeenCalledTimes(1); // ไม่ใช่นำฝากธนาคาร = ไม่มีการอัปโหลดสลิป
  });

  it('นำฝากธนาคาร: ต้องมีรูปสลิป + เลขอ้างอิงอย่างน้อย 6 ตัว → อัปโหลดสลิปก่อน แล้วจึงยืนยัน', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'CONFIRMED' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: { canCount: false, canConfirm: true, viewerId: 'u-bm2', viewerRole: 'BRANCH_MANAGER' } }));
    await userEvent.click(await screen.findByRole('button', { name: /^ยืนยันรับเงิน \d/ }));
    const dialog = await screen.findByRole('dialog');
    // ผู้จัดการสาขาเลือก "เจ้าของเก็บไว้" แทนเจ้าของไม่ได้
    expect(within(dialog).getByRole('radio', { name: /เจ้าของเก็บไว้/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: /นำฝากธนาคารของร้าน/ }));
    const confirm = within(dialog).getByRole('button', { name: 'ยืนยันรับเงินและปิดยอด' });
    expect(confirm).toBeDisabled();
    const slip = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'slip.jpg', { type: 'image/jpeg' });
    await userEvent.upload(within(dialog).getByLabelText(/^รูปสลิปฝากเงิน/), slip);
    await userEvent.type(within(dialog).getByLabelText(/เลขอ้างอิงในสลิป/), '12345');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/เลขอ้างอิงในสลิป/), '6789');
    await userEvent.click(confirm);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const [slipPath, form] = mocks.post.mock.calls[0];
    expect(slipPath).toBe('/shop-tenders/cash-close/cl-1/deposit-slip');
    expect((form as FormData).get('file')).toBe(slip);
    expect(mocks.post.mock.calls[1]).toEqual(['/shop-tenders/cash-close/cl-1/confirm',
      { receivedAmount: 10510, destination: 'BANK_DEPOSIT', note: undefined, depositReference: '123456789' }]);
  });

  it('ปิดยอดแล้ว: ตู้เซฟสาขา = เงินยังอยู่ที่สาขา · ฝากธนาคาร = ถึงบริษัทแล้ว พร้อมเลขอ้างอิงและลิงก์ดูสลิป', async () => {
    renderCard(status({ closes: [
      close({ id: 'safe', status: 'CONFIRMED', receivedAmount: 10510, destination: 'BRANCH_SAFE', moneyState: 'AT_BRANCH', confirmedAt: '2026-09-20T13:52:00.000Z', confirmedBy: { id: 'u-bm', name: 'สุรชัย' } }),
      close({ id: 'bank', status: 'CONFIRMED', receivedAmount: 10510, destination: 'BANK_DEPOSIT', moneyState: 'REACHED', depositReference: '2026092120521187', hasDepositSlip: true, confirmedAt: '2026-09-20T13:55:00.000Z', confirmedBy: { id: 'u-bm', name: 'สุรชัย' } }),
    ] }));
    expect(await screen.findByRole('heading', { name: 'เงินยังไม่ถึงบริษัท' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'เงินถึงบริษัทแล้ว' })).toBeInTheDocument();
    expect(screen.getByText(/รอเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาบันทึกนำฝาก/)).toBeInTheDocument(); // พนักงานขายเปิดดู = ไม่มีปุ่มนำฝาก
    expect(screen.getByText(/อ้างอิงสลิป 2026092120521187/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดูสลิป' })).toBeInTheDocument();
  });

  it('ตีกลับให้นับใหม่: ต้องมีเหตุผลก่อนยืนยัน', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'SENT_BACK' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: { canCount: false, canConfirm: true, viewerId: 'u-owner' } }));
    await userEvent.click(await screen.findByRole('button', { name: /^ยืนยันรับเงิน \d/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'ตีกลับให้นับใหม่' }));
    const submit = within(dialog).getByRole('button', { name: 'ยืนยันตีกลับ' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/เหตุผลที่ตีกลับ/), 'นับรวมแบงก์ปลอม');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close/cl-1/send-back', { reason: 'นับรวมแบงก์ปลอม' }));
  });
});

describe('CashCloseCard — บอกขั้นตอนและบอกว่ารอใคร (mockup กระดาน 12–13)', () => {
  const owner = { canCount: false, canConfirm: true, viewerId: 'u-owner', viewerRole: 'OWNER' };

  it('เจ้าของเปิดดู ยังไม่มีใครนับ: ขั้นที่ 1 บอกว่ารอพนักงาน พร้อมชื่อคนที่นับได้ — ไม่มีปุ่มนับ', async () => {
    renderCard(status({ permissions: owner }));
    expect(await screen.findByText('ตอนนี้รอขั้นนี้ — รอพนักงานนับเงิน')).toBeInTheDocument();
    expect(screen.getByText('ผู้ที่นับได้ของสาขานี้: วิภา (ผู้จัดการสาขา) · ธนา (พนักงานขาย)')).toBeInTheDocument();
    expect(screen.getByText(/คุณเป็นผู้ยืนยันรับเงินในขั้นที่ 2/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'นับเงินปิดยอดวันนี้' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual(['นับเงินและแจ้งยอดส่ง', 'ยืนยันรับเงิน', 'เงินถึงบริษัท']);
  });

  it('ยังไม่มีเงินสดในรอบนี้: ไม่ขึ้นว่า "รอพนักงาน" ให้ตามคนผิด', async () => {
    renderCard(status({ permissions: owner, round: { periodStart: null, floatAmount: 2000, cashIn: 0, cashOut: 0, expectedAmount: 2000, movementCount: 0 } }));
    expect(await screen.findByText(/ยังไม่มีรายการเงินสดในรอบนี้/)).toBeInTheDocument();
    expect(screen.queryByText(/รอพนักงานนับเงิน/)).not.toBeInTheDocument();
  });

  it('สาขายังไม่ตั้งลิ้นชักเงินสด: เจ้าของเห็นรายการสิ่งที่ขาด + ปุ่มไปตั้งค่า (แทนกล่องว่างที่ขึ้น 0.00)', async () => {
    renderCard(status({ permissions: owner, readiness: { hasDrawerAccount: false, floatAmount: 0, counters: [{ id: 'u-bm', name: 'วิภา', role: 'BRANCH_MANAGER' }] } }));
    expect(await screen.findByText('สาขานี้ยังปิดยอดไม่ได้ — เหลือ 1 อย่างที่ต้องตั้งก่อน')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ได้ตั้งลิ้นชักเงินสดของสาขา')).toBeInTheDocument();
    expect(screen.getByText('มีคนที่นับเงินได้ 1 คน: วิภา (ผู้จัดการสาขา)')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'ไปตั้งค่าสาขา' })[0]).toHaveAttribute('href', '/branches');
    expect(screen.getByRole('link', { name: 'เพิ่มพนักงาน' })).toHaveAttribute('href', '/users/new');
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument(); // ยังไม่ถึงขั้นตอนนับ
  });

  it('คนที่ไม่ใช่เจ้าของ: เห็นสิ่งที่ขาดแต่ไม่มีลิงก์ (หน้าตั้งค่าสาขา/ผู้ใช้เปิดได้เฉพาะเจ้าของ) · ไม่มีบัญชีที่นับได้ = นับเป็นสิ่งที่ขาด', async () => {
    renderCard(status({ permissions: { canCount: false, canConfirm: true, viewerId: 'u-fm', viewerRole: 'FINANCE_MANAGER' },
      readiness: { hasDrawerAccount: false, floatAmount: 0, counters: [] } }));
    expect(await screen.findByText('สาขานี้ยังปิดยอดไม่ได้ — เหลือ 2 อย่างที่ต้องตั้งก่อน · แจ้งเจ้าของให้ตั้งค่า')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีบัญชีที่นับเงินได้ของสาขานี้')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('ตู้เซฟสาขา: ขั้นที่ 3 ยังไม่จบ มีปุ่มบันทึกนำฝากในกล่องเดียวกัน', async () => {
    const holding = { branchId: 'br-1', branchName: 'สาขาตัวอย่าง', source: 'BRANCH_SAFE' as const, sourceLabel: 'ตู้เซฟสาขา', reachedCompany: false,
      outstanding: 10500, closeCount: 1, oldestConfirmedAt: '2026-09-20T13:52:00.000Z', openCloses: [{ id: 'safe', confirmedAt: '2026-09-20T13:52:00.000Z', outstanding: 10500 }], canDeposit: true };
    renderCard(status({ permissions: owner, holdings: [holding], closes: [close({ id: 'safe', status: 'CONFIRMED', receivedAmount: 10500, receiveVariance: -10, receiveNote: 'ขาดไป 10 บาท',
      destination: 'BRANCH_SAFE', moneyState: 'AT_BRANCH', confirmedAt: '2026-09-20T13:52:00.000Z', confirmedBy: { id: 'u-bm', name: 'วิภา' } })] }));
    expect(await screen.findByRole('heading', { name: 'เงินยังไม่ถึงบริษัท' })).toBeInTheDocument();
    expect(screen.getByText(/ต่างจากยอดที่แจ้งส่ง ขาด 10.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกนำฝาก' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/ยอดที่นำฝากครั้งนี้/)).toHaveValue('10,500.00');
  });
});
