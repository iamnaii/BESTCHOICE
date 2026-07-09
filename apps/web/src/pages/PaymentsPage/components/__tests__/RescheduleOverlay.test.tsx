import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RescheduleOverlay } from '../RescheduleOverlay';

// ── Mock @/lib/api ─────────────────────────────────────────────────────────

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
  getErrorMessage: (e: unknown) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    'เกิดข้อผิดพลาด',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Radix Select needs pointer-capture APIs jsdom lacks — stub with a native select.
vi.mock('@/components/CashAccountSelect', () => ({
  CashAccountSelect: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (code: string) => void;
  }) => (
    <select aria-label="บัญชีรับเงิน" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="11-1101">11-1101 เงินสด</option>
      <option value="11-1201">11-1201 ธนาคาร KBank</option>
    </select>
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────
// Owner correction 2026-07-09 (CPA ตารางก่อน/หลังปรับดิว):
//   6b (SINGLE) = จ่ายทั้งก้อนวันนี้ (ค่างวดคงเหลือ + ยอดปรับดิว + ค่าปรับ)
//   6a (SPLIT)  = แบ่ง 2 ครั้ง (วันนี้เก็บยอดปรับดิว + ค่าปรับ, ค่างวดตามดิวใหม่)

// Contrived zero-collect (component edge path — real quotes are never 0)
const QUOTE_NO_COLLECT = {
  rescheduleFee: '354.00',
  lateFee: '0.00',
  installmentOutstanding: '0.00',
  collectAmount: '0.00',
  variant: '6b' as const,
  newDueDate: '2026-07-17',
  currentDueDate: '2026-07-10',
};

// 6b (SINGLE) + ค่าปรับค้าง → เก็บทั้งก้อน: 1515.83 + 354 + 75.79 = 1945.62
// (monthlyPayment 1515.83 ÷ 30 × 7 วัน = 353.69 → ปัดขึ้นเต็มบาท = 354.00)
const QUOTE_SINGLE_BUNDLED = {
  rescheduleFee: '354.00',
  lateFee: '75.79',
  installmentOutstanding: '1515.83',
  collectAmount: '1945.62',
  variant: '6b' as const,
  newDueDate: '2026-07-17',
  currentDueDate: '2026-07-10',
};

// 6a (SPLIT) + ค่าปรับค้าง → เก็บยอดปรับดิว + ค่าปรับ
const QUOTE_SPLIT = {
  rescheduleFee: '354.00',
  lateFee: '75.79',
  installmentOutstanding: '1515.83',
  collectAmount: '429.79',
  variant: '6a' as const,
  newDueDate: '2026-07-17',
  currentDueDate: '2026-07-10',
};

function mockHappyApi({
  singleQuote = QUOTE_SINGLE_BUNDLED,
  splitQuote = QUOTE_SPLIT,
  qrResponse = { sentToLine: true, collectAmount: '429.79' },
} = {}) {
  apiGetMock.mockImplementation((url: string, config?: { params?: { splitMode?: string } }) => {
    if (url === '/payments/reschedule-quote') {
      const quote = config?.params?.splitMode === 'SPLIT' ? splitQuote : singleQuote;
      return Promise.resolve({ data: quote });
    }
    return Promise.resolve({ data: [] });
  });
  apiPostMock.mockImplementation((url: string) => {
    if (url === '/payments/preview-journal') {
      return Promise.resolve({
        data: {
          lines: [
            { accountCode: '11-1101', accountName: 'เงินสด', debit: '75.79', credit: '0.00', description: '' },
            { accountCode: '42-1103', accountName: 'ค่าปรับชำระล่าช้า', debit: '0.00', credit: '75.79', description: '' },
          ],
          isBalanced: true,
        },
      });
    }
    if (url.endsWith('/reschedule-qr')) {
      return Promise.resolve({ data: qrResponse });
    }
    if (url === '/shop/upload/signed-url') {
      return Promise.resolve({
        data: {
          uploadUrl: 'https://s3.test/put',
          method: 'PUT',
          key: 'slips/slip-1.jpg',
          publicUrl: 'https://cdn.test/slips/slip-1.jpg',
        },
      });
    }
    return Promise.resolve({ data: { id: 'payment-1' } });
  });
}

/** api.post calls to a specific endpoint (JE preview fires in parallel — filter it out). */
function postCallsTo(url: string) {
  return apiPostMock.mock.calls.filter(([calledUrl]) => calledUrl === url);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function renderOverlay(props: Partial<React.ComponentProps<typeof RescheduleOverlay>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();

  render(
    <QueryClientProvider client={qc}>
      <RescheduleOverlay
        contractId="contract-1"
        contractNumber="CT-2026-0001"
        customerName="สมชาย ใจดี"
        branchName="สาขาลาดพร้าว"
        paymentId="pay-1"
        installmentNo={3}
        currentDueDate="2026-07-10"
        monthlyPayment="1515.83"
        {...props}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );

  return { onClose, onSuccess };
}

beforeEach(() => {
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RescheduleOverlay', () => {
  it('renders the "ปรับดิว" title with contract info', async () => {
    mockHappyApi();
    renderOverlay();

    expect(screen.getByText('ปรับดิว — เลื่อนวันครบกำหนด')).toBeInTheDocument();
    expect(screen.getByText('CT-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument();
  });

  it('drives fee / late-fee / collect rows from the server quote (6a split)', async () => {
    mockHappyApi();
    const user = userEvent.setup();
    renderOverlay();

    // Switch to 6a (แบ่งชำระ 2 ครั้ง) — quote refetches with splitMode=SPLIT
    await user.click(screen.getByRole('button', { name: /แบ่งชำระ 2 ครั้ง \(6a\)/ }));

    // รวมต้องเก็บวันนี้ = collectAmount from the quote
    expect(await screen.findByText('429.79 บาท')).toBeInTheDocument();
    expect(screen.getByText('รวมต้องเก็บวันนี้')).toBeInTheDocument();

    // ค่าปรับค้างชำระ row
    expect(screen.getByText('ค่าปรับค้างชำระ')).toBeInTheDocument();
    expect(screen.getByText('75.79 บาท')).toBeInTheDocument();

    // ยอดปรับดิว appears in Section 2 AND as the 6a row in the payment section
    expect(screen.getByText('ยอดปรับดิว (6a)')).toBeInTheDocument();
    expect(screen.getAllByText('354.00 บาท')).toHaveLength(2);
  });

  it('6b shows ค่างวดงวดนี้ row and collects the full bundle', async () => {
    mockHappyApi();
    renderOverlay();

    // Bundled breakdown: installment + fee + late fee → total. The rows render
    // with 0.00 while the quote loads — await the QUOTED amounts, not the labels.
    expect(await screen.findByText('ค่างวดงวดนี้ (คงเหลือ)')).toBeInTheDocument();
    expect((await screen.findAllByText('1515.83 บาท')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ยอดปรับดิว (6b)')).toBeInTheDocument();
    expect(await screen.findByText('1945.62 บาท')).toBeInTheDocument();

    // QR is 6a-only — the method button must be hidden in 6b
    expect(screen.queryByRole('button', { name: 'QR ใน LINE' })).not.toBeInTheDocument();
  });

  it('hasCollect=false (contrived zero quote): label "ยืนยันปรับดิว" and POST /payments/record with amount 0.01', async () => {
    mockHappyApi({ singleQuote: QUOTE_NO_COLLECT });
    const user = userEvent.setup();
    const { onClose, onSuccess } = renderOverlay();

    // Zero-collect banner shows
    expect(await screen.findByText(/ไม่มียอดต้องเก็บวันนี้/)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: 'ยืนยันปรับดิว' });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await user.click(submitBtn);

    await waitFor(() => expect(postCallsTo('/payments/record')).toHaveLength(1));
    const [, payload] = postCallsTo('/payments/record')[0];
    expect(payload).toMatchObject({
      contractId: 'contract-1',
      installmentNo: 3,
      amount: 0.01, // zero-collect still needs the DTO's @Min(0.01)
      paymentMethod: 'CASH',
      case: 'RESCHEDULE',
      daysToShift: 7,
      splitMode: 'SINGLE',
    });
    expect(payload.transactionRef).toBeUndefined();

    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith('ปรับดิวสำเร็จ'));
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('hasCollect=true + CASH: button label includes เก็บเงิน + amount, POST amount=collectAmount with depositAccountCode', async () => {
    mockHappyApi();
    const user = userEvent.setup();
    const { onSuccess } = renderOverlay();

    // Button label carries the full bundled collect amount (6b)
    const submitBtn = await screen.findByRole('button', {
      name: 'เก็บเงิน 1945.62 + ยืนยันปรับดิว',
    });

    // JE preview box renders the lines the confirm will post
    expect(await screen.findByText('รายการบัญชี (ลงทันทีตอนยืนยัน)')).toBeInTheDocument();

    await waitFor(() => expect(submitBtn).toBeEnabled());
    await user.click(submitBtn);

    await waitFor(() => expect(postCallsTo('/payments/record')).toHaveLength(1));
    const [, payload] = postCallsTo('/payments/record')[0];
    expect(payload).toMatchObject({
      contractId: 'contract-1',
      installmentNo: 3,
      amount: 1945.62,
      paymentMethod: 'CASH',
      case: 'RESCHEDULE',
      daysToShift: 7,
      splitMode: 'SINGLE',
      depositAccountCode: '11-1101',
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      expect.stringContaining('เก็บเงิน 1,945.62'),
    );
  });

  it('CASH synthesizes transactionRef (CASH-<ts>) — orchestrator requires evidence on every payment (QA #1347 3.3)', async () => {
    mockHappyApi();
    const user = userEvent.setup();
    renderOverlay();

    const submitBtn = await screen.findByRole('button', {
      name: 'เก็บเงิน 1945.62 + ยืนยันปรับดิว',
    });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await user.click(submitBtn);

    await waitFor(() => expect(postCallsTo('/payments/record')).toHaveLength(1));
    const [, payload] = postCallsTo('/payments/record')[0];
    // Mirrors RecordPaymentWizard: `${paymentMethod}-${Date.now()}` when no manual ref
    expect(payload.transactionRef).toMatch(/^CASH-\d+$/);
  });

  it('TRANSFER: submit disabled until BOTH เลขอ้างอิง and slip are provided, then posts BANK_TRANSFER + transactionRef + slipUrl', async () => {
    mockHappyApi();
    // Presigned S3 PUT goes through raw fetch (not the api client).
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const user = userEvent.setup();
    renderOverlay();

    await user.click(await screen.findByRole('button', { name: 'โอนธนาคาร' }));

    const submitBtn = screen.getByRole('button', { name: 'เก็บเงิน 1945.62 + ยืนยันปรับดิว' });
    // needRef gating — เลขอ้างอิงการโอน is required for TRANSFER
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText('เลขอ้างอิงจากสลิปโอนเงิน'), 'TX-12345');
    // ref alone is not enough — แนบสลิป is also required (needSlip)
    expect(submitBtn).toBeDisabled();

    await user.upload(
      screen.getByLabelText('อัปโหลดสลิป'),
      new File(['slip'], 'slip.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await user.click(submitBtn);

    await waitFor(() => expect(postCallsTo('/payments/record')).toHaveLength(1));
    const [, payload] = postCallsTo('/payments/record')[0];
    expect(payload).toMatchObject({
      paymentMethod: 'BANK_TRANSFER',
      transactionRef: 'TX-12345',
      slipUrl: 'https://cdn.test/slips/slip-1.jpg',
      amount: 1945.62,
    });
    fetchSpy.mockRestore();
  });

  it('QR method (6a only) + collect: POSTs /payments/{paymentId}/reschedule-qr and shows ส่ง QR success toast', async () => {
    mockHappyApi();
    const user = userEvent.setup();
    const { onClose, onSuccess } = renderOverlay();

    // QR is 6a-only — switch to แบ่งชำระ 2 ครั้ง first
    await user.click(await screen.findByRole('button', { name: /แบ่งชำระ 2 ครั้ง \(6a\)/ }));
    await user.click(await screen.findByRole('button', { name: 'QR ใน LINE' }));

    const submitBtn = screen.getByRole('button', { name: 'ส่ง QR ให้ลูกค้า' });
    await waitFor(() => expect(submitBtn).toBeEnabled());
    await user.click(submitBtn);

    await waitFor(() => expect(postCallsTo('/payments/pay-1/reschedule-qr')).toHaveLength(1));
    const [, payload] = postCallsTo('/payments/pay-1/reschedule-qr')[0];
    expect(payload).toEqual({ daysToShift: 7, splitMode: 'SPLIT' });

    // QR is async — must NOT hit the synchronous record endpoint
    expect(postCallsTo('/payments/record')).toHaveLength(0);

    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        expect.stringContaining('ส่ง QR ปรับดิวให้ลูกค้าใน LINE แล้ว'),
      ),
    );
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('quote fetch error: shows the error message and keeps submit disabled', async () => {
    apiGetMock.mockRejectedValue({
      response: { data: { message: 'ไม่พบงวดที่ต้องการเลื่อน' } },
    });
    apiPostMock.mockResolvedValue({ data: {} });
    renderOverlay();

    expect(await screen.findByText('ไม่พบงวดที่ต้องการเลื่อน')).toBeInTheDocument();

    // No quote → canSubmit=false (hasCollect=false → label is ยืนยันปรับดิว)
    expect(screen.getByRole('button', { name: 'ยืนยันปรับดิว' })).toBeDisabled();
    expect(postCallsTo('/payments/record')).toHaveLength(0);
  });
});
