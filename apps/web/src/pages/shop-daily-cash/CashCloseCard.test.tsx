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

/** หลังส่งยอดแล้ว รอบปัจจุบันเริ่มใหม่ — ยังไม่มีเงินสดใหม่ */
const afterSend = { periodStart: '2026-09-20T13:40:00.000Z', floatAmount: 2000, cashIn: 0, cashOut: 0, expectedAmount: 2000, movementCount: 0 };

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

describe('CashCloseCard — กล่องสถานะเดียว: ปุ่ม "ส่งยอดรายวัน" + หน้าต่างบันทึก (mockup กระดาน 14 → 15–16)', () => {
  const owner = { canCount: false, canConfirm: true, viewerId: 'u-owner', viewerRole: 'OWNER' };

  it('พนักงาน: ถึงตาคุณส่งยอด — ปุ่มใหญ่ข้างยอดที่ต้องมี → เด้งหน้าต่าง → ยอดไม่ตรงต้องใส่เหตุผล → บันทึกส่งยอด', async () => {
    mocks.post.mockResolvedValue({ data: close() });
    renderCard(status());
    expect(await screen.findByRole('heading', { name: 'ถึงตาคุณส่งยอด' })).toBeInTheDocument();
    expect(screen.getByText('12,710.00 ฿')).toBeInTheDocument();
    expect(screen.getByText(/เงินทอนตั้งต้น 2,000.00 \+ รับเงินสด 16,500.00 − จ่ายเงินสดออก 5,790.00/)).toBeInTheDocument();
    expect(screen.getByText('ต้องมีในลิ้นชัก 12,710.00')).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'ขั้นตอนการปิดยอด' }));
    expect(steps.getAllByRole('listitem')).toHaveLength(3);
    for (const title of ['1 ส่งยอด — ถึงตาคุณ', '2 ยืนยันรับเงิน', '3 เงินถึงบริษัท']) expect(steps.getByText(title)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /ส่งยอดรายวัน|ยืนยันรับเงิน|บันทึกนำฝาก/ })).toHaveLength(1); // ปุ่มหลักปุ่มเดียว
    await userEvent.click(screen.getByRole('button', { name: 'ส่งยอดรายวัน' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'ส่งยอดรายวัน' })).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'บันทึกส่งยอด' });
    expect(save).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/เงินสดที่นับได้จริง/), '12510');
    expect(within(dialog).getByRole('status')).toHaveTextContent('ขาด 200.00');
    expect(within(dialog).getByText('ยอดที่ส่งวันนี้')).toBeInTheDocument();
    expect(within(dialog).getByText('10,510.00 ฿')).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: 'ส่งยอดรายวัน' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/เงินสดที่นับได้จริง/), '12,710');
    expect(within(dialog).getByRole('status')).toHaveTextContent('ตรง');
    expect(within(dialog).queryByLabelText(/เหตุผลของส่วนต่าง/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'บันทึกส่งยอด' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close',
      { branchId: 'br-1', countedAmount: 12710, varianceReason: undefined }));
  });

  it('ไม่มีเงินสดใหม่ตั้งแต่ส่งยอดครั้งก่อน = ไม่มีปุ่มส่งยอด (วันที่ไม่มีเงินสดไม่ต้องส่งยอด) · บอกว่าปุ่มจะขึ้นเองเมื่อรับเงินสด', async () => {
    renderCard(status({ round: { periodStart: '2026-09-20T13:40:00.000Z', floatAmount: 2000, cashIn: 0, cashOut: 0, expectedAmount: 2000, movementCount: 0 } }));
    expect(await screen.findByRole('heading', { name: 'ยังไม่มีเงินสดในรอบนี้' })).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีรายการเงินสดใหม่ตั้งแต่ส่งยอดครั้งก่อน')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ต้องส่งยอด — รับเงินสดเมื่อไรปุ่มส่งยอดจะขึ้นเอง')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่งยอดรายวัน' })).not.toBeInTheDocument();
  });

  it('เจ้าของเปิดดู ยังไม่มีใครส่งยอด: ไม่มีปุ่มส่งยอด — บอกว่ารอใคร พร้อมชื่อ · ขั้นของเจ้าของคือยืนยันรับเงิน', async () => {
    renderCard(status({ permissions: owner }));
    expect(await screen.findByRole('heading', { name: 'รอพนักงานส่งยอด' })).toBeInTheDocument();
    expect(screen.getByText('12,710.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ผู้ส่งยอดของสาขานี้: วิภา (ผู้จัดการสาขา) · ธนา (พนักงานขาย)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ส่งยอดรายวัน' })).not.toBeInTheDocument();
    expect(screen.getByText('1 ส่งยอด — รอพนักงาน')).toBeInTheDocument();
    expect(screen.getByText('2 ยืนยันรับเงิน — ขั้นของคุณ')).toBeInTheDocument();
  });

  it('ยังไม่มีเงินสดในรอบนี้: ไม่ขึ้นว่า "รอพนักงาน" ให้ตามคนผิด', async () => {
    renderCard(status({ permissions: owner, round: { periodStart: null, floatAmount: 1000, cashIn: 0, cashOut: 0, expectedAmount: 1000, movementCount: 0 } }));
    expect(await screen.findByRole('heading', { name: 'ยังไม่มีเงินสดในรอบนี้' })).toBeInTheDocument();
    expect(screen.getByText('ในลิ้นชักมีแต่เงินทอนตั้งต้น')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ต้องส่งยอด')).toBeInTheDocument();
    expect(screen.queryByText(/รอพนักงาน/)).not.toBeInTheDocument();
  });

  it('มีคนส่งยอดแล้ว: ผู้ส่งยอดเองไม่เห็นปุ่มยืนยัน แม้มีสิทธิ์ยืนยัน', async () => {
    renderCard(status({ awaitingConfirm: [close({ countedBy: { id: 'u-bm', name: 'ผจก.' } })], closes: [close({ countedBy: { id: 'u-bm', name: 'ผจก.' } })],
      permissions: { canCount: true, canConfirm: true, viewerId: 'u-bm' }, round: afterSend }));
    expect(await screen.findByRole('heading', { name: 'ส่งยอดแล้ว รอยืนยันรับเงิน' })).toBeInTheDocument();
    expect(screen.getByText('10,510.00 ฿')).toBeInTheDocument();
    expect(screen.getByText(/^ยอดที่ ผจก\. ส่ง .* · นับได้ 12,510\.00$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยืนยันรับเงิน' })).not.toBeInTheDocument();
    expect(screen.getByText(/คุณเป็นผู้ส่งยอด/)).toBeInTheDocument();
  });

  it('ยืนยันรับเงิน: ปุ่มใหญ่ → หน้าต่าง · ต้องเลือกปลายทางเอง · รับจริงไม่เท่ายอดที่ส่งต้องมีหมายเหตุ', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'CONFIRMED' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: owner }));
    expect(await screen.findByRole('heading', { name: 'รอคุณยืนยันรับเงิน' })).toBeInTheDocument();
    expect(screen.getByText('2 ยืนยันรับเงิน — ถึงตาคุณ')).toBeInTheDocument();
    expect(screen.getByText('เงินขาด 200.00 — “ทอนเงินลูกค้าผิด 200”')).toBeInTheDocument();
    expect(screen.getByText('ต้องมีในลิ้นชักตอนส่งยอด 12,710.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเงิน' }));
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
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรับเงิน' }));
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

  it('ตีกลับให้นับใหม่: ต้องมีเหตุผลก่อนยืนยัน', async () => {
    mocks.post.mockResolvedValue({ data: close({ status: 'SENT_BACK' }) });
    renderCard(status({ awaitingConfirm: [close()], closes: [close()], permissions: owner }));
    await userEvent.click(await screen.findByRole('button', { name: 'ยืนยันรับเงิน' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'ตีกลับให้นับใหม่' }));
    const submit = within(dialog).getByRole('button', { name: 'ยืนยันตีกลับ' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/เหตุผลที่ตีกลับ/), 'นับรวมแบงก์ปลอม');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/shop-tenders/cash-close/cl-1/send-back', { reason: 'นับรวมแบงก์ปลอม' }));
  });

  it('จบครบ = กล่องเขียว (เงินถึงบริษัทครบแล้ว + เลขอ้างอิง + ดูสลิป) ไม่มีปุ่มหลัก · "ดูรายละเอียดการส่งยอด" กาง 3 ขั้นแบบเต็ม', async () => {
    renderCard(status({ permissions: owner, round: afterSend, closes: [close({ id: 'bank', status: 'CONFIRMED', receivedAmount: 10500, receiveVariance: -10, receiveNote: 'ขาดไป 10 บาท',
      destination: 'BANK_DEPOSIT', moneyState: 'REACHED', depositReference: '2026092120521187', hasDepositSlip: true,
      confirmedAt: '2026-09-20T13:52:00.000Z', confirmedBy: { id: 'u-owner', name: 'เอกนรินทร์' } })] }));
    expect(await screen.findByRole('heading', { name: 'เงินถึงบริษัทครบแล้ว' })).toBeInTheDocument();
    expect(screen.getByText('10,500.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('3 ถึงบริษัทแล้ว')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ส่งยอดรายวัน|ยืนยันรับเงิน|บันทึกนำฝาก/ })).not.toBeInTheDocument();
    expect(screen.getByText(/อ้างอิงสลิป 2026092120521187/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดูสลิป' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument(); // ยังไม่กาง
    await userEvent.click(screen.getByRole('button', { name: 'ดูรายละเอียดการส่งยอด' }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual(['ส่งยอดแล้ว', 'ยืนยันรับเงินแล้ว', 'เงินถึงบริษัทแล้ว']);
    expect(screen.getByText(/ต่างจากยอดที่ส่ง ขาด 10.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ซ่อนรายละเอียด' }));
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('ตู้เซฟสาขา: เงินยังอยู่ที่ตู้เซฟสาขา — ปุ่มใหญ่ "บันทึกนำฝาก" ในกล่องเดียวกัน · คนไม่มีสิทธิ์เห็นว่ารอใคร', async () => {
    const safe = close({ id: 'safe', status: 'CONFIRMED', receivedAmount: 10500, destination: 'BRANCH_SAFE', moneyState: 'AT_BRANCH',
      confirmedAt: '2026-09-20T13:52:00.000Z', confirmedBy: { id: 'u-bm', name: 'วิภา' } });
    const holding = { branchId: 'br-1', branchName: 'สาขาตัวอย่าง', source: 'BRANCH_SAFE' as const, sourceLabel: 'ตู้เซฟสาขา', reachedCompany: false,
      outstanding: 10500, closeCount: 1, oldestConfirmedAt: '2026-09-20T13:52:00.000Z', openCloses: [{ id: 'safe', confirmedAt: '2026-09-20T13:52:00.000Z', outstanding: 10500 }], canDeposit: true };
    const view = renderCard(status({ permissions: owner, round: afterSend, holdings: [holding], closes: [safe] }));
    expect(await screen.findByRole('heading', { name: 'เงินยังอยู่ที่ตู้เซฟสาขา' })).toBeInTheDocument();
    expect(screen.getByText('3 เงินถึงบริษัท — รอนำฝาก')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกนำฝาก' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/ยอดที่นำฝากครั้งนี้/)).toHaveValue('10,500.00');
    view.unmount();
    renderCard(status({ round: afterSend, closes: [safe], holdings: [{ ...holding, canDeposit: false }] })); // พนักงานขายเปิดดู
    expect(await screen.findByText(/รอเจ้าของ ผู้จัดการการเงิน หรือผู้จัดการสาขาบันทึกนำฝาก/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'บันทึกนำฝาก' })).not.toBeInTheDocument();
  });

  it('สาขายังไม่ตั้งลิ้นชักเงินสด: เจ้าของเห็นรายการสิ่งที่ขาด + ปุ่มไปตั้งค่า (แทนกล่องว่างที่ขึ้น 0.00)', async () => {
    renderCard(status({ permissions: owner, readiness: { hasDrawerAccount: false, floatAmount: 0, counters: [{ id: 'u-bm', name: 'วิภา', role: 'BRANCH_MANAGER' }] } }));
    expect(await screen.findByText('สาขานี้ยังปิดยอดไม่ได้ — เหลือ 1 อย่างที่ต้องตั้งก่อน')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ได้ตั้งลิ้นชักเงินสดของสาขา')).toBeInTheDocument();
    expect(screen.getByText('มีคนที่ส่งยอดได้ 1 คน: วิภา (ผู้จัดการสาขา)')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'ไปตั้งค่าสาขา' })[0]).toHaveAttribute('href', '/branches');
    expect(screen.getByRole('link', { name: 'เพิ่มพนักงาน' })).toHaveAttribute('href', '/users/new');
    expect(screen.queryByRole('button', { name: 'ส่งยอดรายวัน' })).not.toBeInTheDocument();
  });

  it('คนที่ไม่ใช่เจ้าของ: เห็นสิ่งที่ขาดแต่ไม่มีลิงก์ (หน้าตั้งค่าสาขา/ผู้ใช้เปิดได้เฉพาะเจ้าของ) · ไม่มีบัญชีที่ส่งยอดได้ = นับเป็นสิ่งที่ขาด', async () => {
    renderCard(status({ permissions: { canCount: false, canConfirm: true, viewerId: 'u-fm', viewerRole: 'FINANCE_MANAGER' },
      readiness: { hasDrawerAccount: false, floatAmount: 0, counters: [] } }));
    expect(await screen.findByText('สาขานี้ยังปิดยอดไม่ได้ — เหลือ 2 อย่างที่ต้องตั้งก่อน · แจ้งเจ้าของให้ตั้งค่า')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่มีบัญชีที่ส่งยอดได้ของสาขานี้')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
