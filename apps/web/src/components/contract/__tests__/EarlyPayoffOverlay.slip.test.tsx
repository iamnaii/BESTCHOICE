import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EarlyPayoffOverlay, type SlipVerifyResult } from '../ContractEarlyPayoff';

/**
 * ปิดสัญญาด้วยสลิป (mockup 69ezDjY8 · เจ้าของ 2026-09-24 "ยอดตรงกับสลิป ปิดยอดได้เลย"):
 * แนบ → อ่าน → ตรง = ปิดเลย (กล่องยืนยัน) · ไม่ตรง = ส่งขออนุมัติพร้อมสลิป · เก็บที่หน้าร้าน = ไม่มีสลิป
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-bm', name: 'ผจก.ลพบุรี', role: 'BRANCH_MANAGER', branchId: 'b1' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));
// กล่องขออนุมัติของเดิม — ดูแค่ว่าถูกเปิดและได้ payload อะไร
const approvalDialogProps = vi.fn();
vi.mock('@/components/payment/PaymentApprovalRequestDialog', () => ({
  default: (p: { open: boolean; payload: Record<string, unknown> }) => {
    approvalDialogProps(p);
    return p.open ? <div data-testid="approval-dialog">approval</div> : null;
  },
}));

const QUOTE = {
  monthlyPayment: 3671,
  remainingMonths: 7,
  totalRemaining: 25697,
  advancePayment: 0,
  rescheduleAdvanceApplied: 1714,
  remainingBalance: 23983,
  remainingExVat: 22414.02,
  remainingCost: 10719.72,
  grossProfit: 11694.3,
  discountPct: 50,
  discountAmount: 5847.15,
  unpaidLateFees: 0,
  totalPayoff: 18135.85,
};

const matchedResult: SlipVerifyResult = {
  engine: 'OCR',
  available: true,
  imageKey: 'early-payoff-slips/ct-1/a.jpg',
  slipUrl: 'https://storage.example/early-payoff-slips/ct-1/a.jpg',
  reading: {
    amount: 18135.85,
    refNo: '2026092318425510',
    bankName: 'KBANK',
    date: '2026-09-23',
    time: '14:32',
    toAccount: '203-1-16520-5',
    confidence: 0.97,
  },
  expectedAmount: 18135.85,
  discountPct: 50,
  checks: [
    {
      code: 'READABLE',
      ok: true,
      label: 'อ่านสลิปได้ (ความมั่นใจ ≥ 90%)',
      detail: 'ความมั่นใจ 97%',
    },
    { code: 'AMOUNT_MATCH', ok: true, label: 'ยอดในสลิปตรงกับยอดปิด' },
    { code: 'COMPANY_ACCOUNT', ok: true, label: 'โอนเข้าบัญชีบริษัท' },
    { code: 'NOT_REUSED', ok: true, label: 'สลิปนี้ไม่เคยถูกใช้' },
    { code: 'DATE_VALID', ok: true, label: 'วันที่โอนไม่เป็นอนาคต' },
  ],
  matched: true,
  paymentDate: '2026-09-23',
  ticket: 'ticket-abc',
};
const mismatchResult: SlipVerifyResult = {
  ...matchedResult,
  reading: { ...matchedResult.reading!, amount: 18000 },
  checks: matchedResult.checks.map((c) =>
    c.code === 'AMOUNT_MATCH'
      ? { ...c, ok: false, detail: 'ขาดอีก 135.85 บาท จึงจะครบยอดปิด 18,135.85' }
      : c,
  ),
  matched: false,
  ticket: null,
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}
const renderOverlay = (onSuccess = vi.fn(), onClose = vi.fn()) => {
  render(
    wrap(
      <EarlyPayoffOverlay
        contractId="ct-1"
        contractNumber="TEST-20260827-017"
        customerName="ทดสอบ ค้าง 1 งวด 17"
        branchName="ลพบุรี"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    ),
  );
  return { onSuccess, onClose };
};
const slipFile = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], 'slip.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((url: string) =>
    url.includes('/early-payoff-quote')
      ? Promise.resolve({ data: QUOTE })
      : Promise.reject(new Error(`unexpected GET ${url}`)),
  );
});

describe('EarlyPayoffOverlay — ปิดสัญญาด้วยสลิป', () => {
  it('เริ่มต้น: โหมดโอนเข้าบัญชี ปุ่มปิดยอดล็อกจนกว่าจะแนบสลิป · มีปุ่มเลือกไฟล์/ถ่ายรูป · ยังส่งขออนุมัติได้', async () => {
    renderOverlay();
    await screen.findByText('18,135.85 บาท', { selector: 'span' });
    expect(screen.getByRole('radio', { name: 'โอนเข้าบัญชีบริษัท · แนบสลิป' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('button', { name: 'ปิดยอดด้วยสลิป' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'เลือกไฟล์' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ถ่ายรูป' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่งขออนุมัติปิดสัญญา' })).toBeEnabled();
  });

  it('สลิปตรง: ตรวจครบ 5 ข้อ → ปุ่ม "ปิดยอด 18,135.85 บาท" → กล่องยืนยัน (ติ๊กก่อน) → slip-confirm ด้วยตั๋ว → จอสำเร็จ + onSuccess', async () => {
    apiPost.mockImplementation((url: string) => {
      if (url.endsWith('/early-payoff/slip')) return Promise.resolve({ data: matchedResult });
      if (url.endsWith('/early-payoff/slip-confirm'))
        return Promise.resolve({
          data: { totalPayoff: 18135.85, paidDate: '2026-09-23T07:32:00.000Z' },
        });
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const { onSuccess } = renderOverlay();
    await screen.findByText('18,135.85 บาท', { selector: 'span' });

    fireEvent.change(screen.getByLabelText('เลือกไฟล์สลิป'), { target: { files: [slipFile()] } });
    expect(
      await screen.findByText('ยอดตรง — ปิดสัญญาได้เลย ไม่ต้องรอผู้อนุมัติ'),
    ).toBeInTheDocument();
    const [verifyUrl, form] = apiPost.mock.calls[0];
    expect(verifyUrl).toBe('/contracts/ct-1/early-payoff/slip');
    expect((form as FormData).get('discountPct')).toBe('50');
    expect((form as FormData).get('slip')).toBeInstanceOf(File);
    const card = within(screen.getByTestId('slip-card'));
    expect(card.getAllByLabelText('ผ่าน')).toHaveLength(5);
    expect(card.getByText('2026092318425510')).toBeInTheDocument();
    // ปุ่มขออนุมัติหายไป เหลือปุ่มปิดยอดเป็นทางเดียว
    expect(screen.queryByRole('button', { name: /ส่งขออนุมัติ/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ปิดยอด 18,135.85 บาท' }));
    const dialog = await screen.findByRole('dialog', { name: 'ยืนยันปิดสัญญาก่อนกำหนด' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'ยืนยันปิดสัญญา' });
    expect(confirmBtn).toBeDisabled(); // ต้องติ๊กก่อน
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/contracts/ct-1/early-payoff/slip-confirm', {
        ticket: 'ticket-abc',
        notes: undefined,
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'ปิดสัญญาแล้ว' })).toHaveTextContent(
      'ไม่ผ่านคิวอนุมัติ (สลิปตรง)',
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('สลิปไม่ตรง: โชว์ข้อที่ไม่ผ่าน + ปุ่มปิดยอดล็อก + "ส่งขออนุมัติ (แนบสลิปนี้)" เปิดกล่องขออนุมัติพร้อม slipUrl', async () => {
    apiPost.mockResolvedValue({ data: mismatchResult });
    renderOverlay();
    await screen.findByText('18,135.85 บาท', { selector: 'span' });
    fireEvent.change(screen.getByLabelText('เลือกไฟล์สลิป'), { target: { files: [slipFile()] } });
    expect(await screen.findByText('ต้องให้ผู้มีสิทธิ์อนุมัติก่อน')).toBeInTheDocument();
    const card = within(screen.getByTestId('slip-card'));
    expect(card.getAllByLabelText('ไม่ผ่าน')).toHaveLength(1);
    expect(card.getByText(/ขาดอีก 135.85 บาท/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ปิดยอดด้วยสลิป' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'ส่งขออนุมัติ (แนบสลิปนี้)' }));
    expect(await screen.findByTestId('approval-dialog')).toBeInTheDocument();
    const last = approvalDialogProps.mock.calls.at(-1)![0];
    expect(last.payload).toMatchObject({
      slipUrl: mismatchResult.slipUrl,
      collectedByShop: false,
      discountPct: 50,
    });
  });

  it('เปลี่ยนส่วนลดหลังตรวจแล้ว → ผลตรวจถูกล้าง ต้องแนบใหม่ (ยอดปิดเปลี่ยน)', async () => {
    apiPost.mockResolvedValue({ data: matchedResult });
    renderOverlay();
    await screen.findByText('18,135.85 บาท', { selector: 'span' });
    fireEvent.change(screen.getByLabelText('เลือกไฟล์สลิป'), { target: { files: [slipFile()] } });
    await screen.findByText('ยอดตรง — ปิดสัญญาได้เลย ไม่ต้องรอผู้อนุมัติ');
    fireEvent.click(screen.getByRole('button', { name: '40%' }));
    expect(
      screen.queryByText('ยอดตรง — ปิดสัญญาได้เลย ไม่ต้องรอผู้อนุมัติ'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เลือกไฟล์' })).toBeInTheDocument();
  });

  it('เก็บที่หน้าร้าน: ไม่มีการ์ดสลิป มีวันที่รับเงิน และปุ่มหลักคือส่งขออนุมัติ', async () => {
    renderOverlay();
    await screen.findByText('18,135.85 บาท', { selector: 'span' });
    fireEvent.click(screen.getByRole('radio', { name: 'เก็บที่หน้าร้าน' }));
    expect(screen.queryByTestId('slip-card')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ปิดยอดด้วยสลิป' })).not.toBeInTheDocument();
    // สลับโหมด = คิดยอดปิดใหม่ (collectedByShop) — ปุ่มเปิดเมื่อโหลดเสร็จ
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ส่งขออนุมัติปิดสัญญา' })).toBeEnabled(),
    );
    expect(screen.getByText(/Dr 11-2107/)).toBeInTheDocument();
  });
});
