/**
 * ฟอร์ม "บันทึกรับเครื่องคืน" (spec 2026-09-20 §5.1, §7) — สาขาบันทึก ไม่มีส่วนบัญชี:
 *   - ค้นสัญญาผ่าน GET /device-returns/lookup?q= แล้ว preview ผ่าน GET /device-returns/preview
 *   - ตารางรับซื้อเติมราคาประเมินให้ (autoPrice) — ค่าที่พิมพ์เองไม่ถูกทับเมื่อสลับเกรด
 *   - ต่างจากตารางเกิน ±15% → ต้องมีหมายเหตุ ไม่งั้นปุ่มบันทึกปิด
 *   - ประเภทระบบเลือก: TERMINATED = ยึดเครื่อง (เหตุผลล็อก AFTER_TERMINATION) / เดิน = คืนเอง
 *   - OWNER ต้องเลือกสาขาที่รับ; BM/SALES ใช้สาขาตัวเอง (ไม่ส่ง receivingBranchId)
 */
import type { ReactNode } from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

type TestUser = { id: string; name: string; role: string; branchId: string | null };
const OWNER: TestUser = { id: 'u-owner', name: 'เจ้าของ', role: 'OWNER', branchId: null };
const BM: TestUser = { id: 'u-bm', name: 'ผจก.ลาดพร้าว', role: 'BRANCH_MANAGER', branchId: 'b1' };
const FM: TestUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
let currentUser: TestUser = OWNER;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));
// ค้นทันที — ไม่รอ 300ms
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(v: T) => v }));

import { DeviceReturnIntakeDialog } from '../DeviceReturnIntakeDialog';

const lookupRows = [
  {
    id: 'c-1',
    contractNumber: 'TEST-20260920-001',
    status: 'ACTIVE',
    customer: { id: 'cu1', name: 'สมชาย ใจดี' },
    product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: '350000000000001' },
    branch: { id: 'b1', name: 'ลาดพร้าว' },
  },
];

let contractStatus = 'ACTIVE';
let eligibilityOverride: { canCreate: boolean; reason: string | null } | null = null;

/** Backend stand-in: เกรด A อยู่ในตาราง (6,500) เกรดอื่นไม่อยู่ */
function previewFor(url: string) {
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  const grade = q.get('conditionGrade') ?? 'A';
  const found = grade === 'A';
  const terminated = contractStatus === 'TERMINATED';
  return {
    contract: {
      id: q.get('contractId'),
      contractNumber: 'TEST-20260920-001',
      status: contractStatus,
      customer: { id: 'cu1', name: 'สมชาย ใจดี' },
      product: {
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 14',
        storage: '128GB',
        imeiSerial: '350000000000001',
      },
      branch: { id: 'b1', name: 'ลาดพร้าว' },
    },
    returnKind: terminated ? 'REPOSSESSION' : 'VOLUNTARY',
    eligibility: eligibilityOverride ?? { canCreate: true, reason: null },
    allowedReasons: terminated
      ? ['AFTER_TERMINATION']
      : ['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER'],
    valuation: { grade, found, suggestedPrice: found ? 6500 : null, note: null },
    deviationPct: null,
    outstandingBalance: '12126.64',
  };
}

function routeApi() {
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/device-returns/lookup?')) return Promise.resolve({ data: lookupRows });
    if (url.startsWith('/device-returns/preview?')) {
      return Promise.resolve({ data: previewFor(url) });
    }
    if (url === '/branches') {
      return Promise.resolve({
        data: [
          { id: 'b1', name: 'ลาดพร้าว', isActive: true },
          { id: 'b2', name: 'สาขาปิดแล้ว', isActive: false },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderDialog(props: { initialContractId?: string } = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<DeviceReturnIntakeDialog open onClose={onClose} onCreated={onCreated} {...props} />, {
    wrapper,
  });
  return { onClose, onCreated };
}

const appraisalInput = () => screen.getByLabelText(/ราคาประเมิน/) as HTMLInputElement;
const submitButton = () =>
  screen.getByRole('button', { name: 'บันทึกรับเครื่องคืน' }) as HTMLButtonElement;

async function pickContract() {
  fireEvent.change(screen.getByPlaceholderText(/เลขสัญญา \/ เบอร์โทร \/ IMEI/), {
    target: { value: 'TEST' },
  });
  fireEvent.click(await screen.findByRole('button', { name: /TEST-20260920-001/ }));
}

beforeEach(() => {
  contractStatus = 'ACTIVE';
  eligibilityOverride = null;
  currentUser = OWNER;
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({
    data: { id: 'dr-1', docNumber: 'DR-20260920-0001', contract: { id: 'c-1' } },
  });
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('DeviceReturnIntakeDialog — request and validation boundaries', () => {
  async function ready() {
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    await waitFor(() => expect(submitButton()).toBeEnabled());
  }

  it('requires three trimmed lookup characters', async () => {
    routeApi();
    renderDialog();
    const search = screen.getByPlaceholderText(/อย่างน้อย 3 ตัวอักษร/);
    fireEvent.change(search, { target: { value: ' AB ' } });
    expect(apiGet.mock.calls.some(([url]) => url.startsWith('/device-returns/lookup'))).toBe(false);
    fireEvent.change(search, { target: { value: ' ABC ' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/device-returns/lookup?q=ABC'));
  });

  it.each(['', '0', '-1'])(
    'blocks appraisal %j, negative repair and future date',
    async (price) => {
      currentUser = BM;
      routeApi();
      renderDialog({ initialContractId: 'c-1' });
      await ready();
      fireEvent.change(appraisalInput(), { target: { value: price } });
      await waitFor(() =>
        expect(submitButton()).toHaveAttribute('title', 'กรุณาระบุราคาประเมินมากกว่า 0'),
      );
      fireEvent.click(submitButton());
      expect(apiPost).not.toHaveBeenCalled();
      fireEvent.change(appraisalInput(), { target: { value: '6500' } });
      fireEvent.change(screen.getByLabelText(/ค่าซ่อม/), { target: { value: '-1' } });
      await waitFor(() => expect(submitButton()).toHaveAttribute('title', 'ค่าซ่อมต้องไม่ติดลบ'));
      fireEvent.change(screen.getByLabelText(/ค่าซ่อม/), { target: { value: '0' } });
      fireEvent.change(screen.getByLabelText(/วันที่รับเครื่อง/), {
        target: { value: '2999-01-01' },
      });
      expect(submitButton()).toBeDisabled();
    },
  );

  it('requires trimmed notes for OTHER and accepts the exact 15% boundary', async () => {
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await ready();
    fireEvent.change(appraisalInput(), { target: { value: '5525' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: '   ' } });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), {
      target: { value: '  จอเสีย  ' },
    });
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/device-returns',
        expect.objectContaining({ appraisalPrice: 5525, notes: 'จอเสีย' }),
      ),
    );
  });

  it('shows preview failure, blocks POST and supports retry', async () => {
    currentUser = BM;
    apiGet.mockRejectedValue(new Error('ตรวจสอบไม่ได้'));
    renderDialog({ initialContractId: 'c-1' });
    expect(await screen.findByRole('alert')).toHaveTextContent('ตรวจสอบไม่ได้');
    expect(submitButton()).toBeDisabled();
    routeApi();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await ready();
  });

  it('clears the prior contract appraisal, repair and notes when changing contracts', async () => {
    currentUser = BM;
    routeApi();
    renderDialog();
    await pickContract();
    await ready();
    fireEvent.change(appraisalInput(), { target: { value: '7000' } });
    fireEvent.change(screen.getByLabelText(/ค่าซ่อม/), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), {
      target: { value: 'เครื่องเก่า' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนสัญญา' }));
    await pickContract();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(screen.getByLabelText(/ค่าซ่อม/)).toHaveValue(0);
    expect(screen.getByLabelText(/รายละเอียดเพิ่มเติม/)).toHaveValue('');
    expect(screen.getByLabelText(/เหตุผลคืนเครื่อง/)).toHaveValue('');
  });

  it('shows branch failure with a retry rather than an empty owner selection', async () => {
    routeApi();
    const normalGet = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((url: string) =>
      url === '/branches' ? Promise.reject(new Error('สาขาโหลดไม่ได้')) : normalGet(url),
    );
    renderDialog({ initialContractId: 'c-1' });
    expect(await screen.findByRole('alert')).toHaveTextContent('สาขาโหลดไม่ได้');
    routeApi();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดสาขาอีกครั้ง' }));
    expect(await screen.findByRole('option', { name: 'ลาดพร้าว' })).toBeInTheDocument();
  });

  it('locks fields and dismissal during POST, deduplicates clicks and invalidates affected caches', async () => {
    currentUser = BM;
    routeApi();
    let resolve!: (value: unknown) => void;
    apiPost.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated = vi.spyOn(qc, 'invalidateQueries');
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <DeviceReturnIntakeDialog open initialContractId="c-1" onClose={onClose} />
      </QueryClientProvider>,
    );
    await ready();
    const submit = submitButton();
    act(() => {
      submit.click();
      submit.click();
    });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(appraisalInput()).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () =>
      resolve({ data: { id: 'dr-1', docNumber: 'DR-1', contract: { id: 'c-1' } } }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    for (const queryKey of [
      ['device-returns'],
      ['contracts'],
      ['contract', 'c-1'],
      ['repossessions'],
      ['customer-tags'],
    ]) {
      expect(invalidated).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('does not retry POST from global defaults and keeps failed form values', async () => {
    currentUser = BM;
    routeApi();
    apiPost.mockRejectedValue(new Error('บันทึกไม่ได้'));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: 2, retryDelay: 0 } },
    });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <DeviceReturnIntakeDialog open initialContractId="c-1" onClose={onClose} />
      </QueryClientProvider>,
    );
    await ready();
    fireEvent.click(submitButton());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(appraisalInput().value).toBe('6500');
    expect(submitButton()).toBeEnabled();
  });

  it('late success does not close a new contract session', async () => {
    currentUser = BM;
    routeApi();
    let resolve!: (value: unknown) => void;
    apiPost.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const dialog = (id: string) => (
      <QueryClientProvider client={qc}>
        <DeviceReturnIntakeDialog
          open
          initialContractId={id}
          onClose={onClose}
          onCreated={onCreated}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(dialog('c-1'));
    await ready();
    fireEvent.click(submitButton());
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    rerender(dialog('c-2'));
    await act(async () =>
      resolve({ data: { id: 'dr-1', docNumber: 'DR-1', contract: { id: 'c-1' } } }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('DeviceReturnIntakeDialog — ค้นสัญญา + preview', () => {
  it('explains that voluntary restoration depends on the stored and current contract status', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    expect(
      await screen.findByText(
        /คืนสถานะเดิมเฉพาะเมื่อมีสถานะเดิมบันทึกไว้และสัญญายังอยู่ในสถานะบอกเลิก/,
      ),
    ).toBeInTheDocument();
  });

  it('ค้นแล้วเลือกสัญญา → เรียก preview ด้วย contractId และแสดงสรุปสัญญา + ประเภทที่ระบบเลือก', async () => {
    routeApi();
    renderDialog();
    await pickContract();
    await waitFor(() =>
      expect(
        apiGet.mock.calls.some(([u]) =>
          String(u).startsWith('/device-returns/preview?contractId=c-1&conditionGrade=A'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByTestId('device-return-kind')).toHaveTextContent('ลูกค้าคืนเอง');
    expect(screen.getByText(/12,126\.64 ฿/)).toBeInTheDocument();
  });

  it('initialContractId: ไม่มีช่องค้นหา ไม่มีปุ่มเปลี่ยนสัญญา และ preview ทันที', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    expect(screen.queryByPlaceholderText(/เลขสัญญา/)).not.toBeInTheDocument();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(screen.queryByRole('button', { name: 'เปลี่ยนสัญญา' })).not.toBeInTheDocument();
  });
});

describe('DeviceReturnIntakeDialog — ราคาประเมิน + ตารางรับซื้อ (autoPrice ±15%)', () => {
  it('เติมราคาจากตารางเกรด A; สลับไปเกรดที่ไม่มีในตารางล้างค่าที่ระบบเติม; ค่าที่พิมพ์เองไม่ถูกทับ', async () => {
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(
      await screen.findByText(/ตารางรับซื้อ เกรด A: 6,500\.00 ฿ \(ค่าตั้งต้น/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^B$/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/ไม่มีรุ่นนี้ในตารางรับซื้อ \(เกรด B\) ตีราคาเอง/),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(appraisalInput().value).toBe(''));

    fireEvent.change(appraisalInput(), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('button', { name: /^A$/ }));
    await waitFor(() => expect(screen.getByText(/ตารางรับซื้อ เกรด A/)).toBeInTheDocument());
    expect(appraisalInput().value).toBe('7000');
    expect(screen.getByText(/ต่างจากตาราง \+8%/)).toBeInTheDocument();
  });

  it('ต่างจากตารางเกิน 15% → ปุ่มปิดจนกว่าจะมีหมายเหตุ', async () => {
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    await waitFor(() => expect(submitButton()).toBeEnabled());

    fireEvent.change(appraisalInput(), { target: { value: '5000' } }); // −23%
    await waitFor(() =>
      expect(screen.getByText(/ต่างจากตารางรับซื้อ -23% \(เกิน 15%\)/)).toBeInTheDocument(),
    );
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), {
      target: { value: 'จอแตก กระจกหลังร้าว' },
    });
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });
});

describe('DeviceReturnIntakeDialog — ประเภท / เหตุผล / สิ่งที่จะเกิดขึ้น', () => {
  it('สัญญา TERMINATED = ยึดเครื่อง: เหตุผลล็อก AFTER_TERMINATION และไม่มีข้อความสัญญาหยุด', async () => {
    contractStatus = 'TERMINATED';
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() =>
      expect(screen.getByTestId('device-return-kind')).toHaveTextContent('ยึดเครื่อง'),
    );
    const reason = screen.getByLabelText(/เหตุผลคืนเครื่อง/) as HTMLSelectElement;
    await waitFor(() => expect(reason.value).toBe('AFTER_TERMINATION'));
    expect(reason).toBeDisabled();
    expect(screen.getByText(/สัญญาบอกเลิกอยู่แล้ว/)).toBeInTheDocument();
    expect(screen.queryByText(/สัญญาหยุดนับค่างวด/)).not.toBeInTheDocument();
  });

  it('สัญญา ACTIVE = คืนเอง: กล่องผลลัพธ์ = สัญญาหยุดทันที / แจ้งไลน์ / รอ FINANCE / MDM ทำมือ และไม่มีส่วนบัญชี', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() =>
      expect(screen.getByTestId('device-return-kind')).toHaveTextContent('ลูกค้าคืนเอง'),
    );
    expect(screen.getByText(/สัญญาหยุดนับค่างวดและค่าปรับทันที/)).toBeInTheDocument();
    expect(screen.getByText(/แจ้งลูกค้าทางไลน์ทันที/)).toBeInTheDocument();
    expect(screen.getByText(/รอ FINANCE ยืนยันบัญชี/)).toBeInTheDocument();
    expect(screen.getByText(/ปลดล็อค MDM/)).toBeInTheDocument();
    expect(screen.queryByText(/บัญชีรับเงิน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ตั้งลูกหนี้-หน้าร้าน/)).not.toBeInTheDocument();
  });

  it('eligibility ไม่ผ่าน → แบนเนอร์ + ปุ่มปิด + ไม่ POST', async () => {
    eligibilityOverride = { canCreate: false, reason: 'เครื่องนี้เคยถูกยึดแล้ว — ยึดซ้ำไม่ได้' };
    currentUser = BM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/เคยถูกยึดแล้ว/);
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('DeviceReturnIntakeDialog — บันทึก', () => {
  it('BM: ส่ง body ตาม DTO (ไม่มี receivingBranchId) → toast + onCreated + onClose', async () => {
    currentUser = BM;
    routeApi();
    const { onClose, onCreated } = renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'NO_LONGER_NEEDED' },
    });
    fireEvent.change(screen.getByLabelText(/ค่าซ่อม/), { target: { value: '300' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns', {
        contractId: 'c-1',
        deviceReceivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        conditionGrade: 'A',
        appraisalPrice: 6500,
        repairCost: 300,
        returnReason: 'NO_LONGER_NEEDED',
        notes: undefined,
        receivingBranchId: undefined,
      }),
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ docNumber: 'DR-20260920-0001' }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('DR-20260920-0001'));
  });

  it('OWNER: ต้องเลือกสาขาที่รับก่อน (สาขาที่ปิดใช้ไม่โผล่) แล้ว body มี receivingBranchId', async () => {
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), {
      target: { value: 'UNAFFORDABLE' },
    });
    await waitFor(() =>
      expect(submitButton()).toHaveAttribute('title', 'กรุณาเลือกสาขาที่รับเครื่อง'),
    );
    const branch = await screen.findByLabelText(/สาขาที่รับเครื่อง/);
    expect(within(branch).queryByRole('option', { name: 'สาขาปิดแล้ว' })).not.toBeInTheDocument();
    fireEvent.change(branch, { target: { value: 'b1' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        '/device-returns',
        expect.objectContaining({ receivingBranchId: 'b1' }),
      ),
    );
  });

  it('FINANCE_MANAGER: แจ้งว่าบันทึกไม่ได้และปุ่มปิด', async () => {
    currentUser = FM;
    routeApi();
    renderDialog({ initialContractId: 'c-1' });
    expect(await screen.findByText(/บันทึกรับเครื่องคืนได้เฉพาะเจ้าของ/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});
