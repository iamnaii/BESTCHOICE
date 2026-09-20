/**
 * RepossessionOverlay โหมดยืนยันใบรับเครื่องคืน (spec 2026-09-20 §5.2, §7):
 *   - ข้อมูลใบ (เกรด/ราคาประเมิน/เหตุผล/สาขา/ไลน์) อ่านอย่างเดียวจาก GET /device-returns/:id
 *   - preview JP5 เรียกด้วย deviceReturnId + discountPct เท่านั้น (ไม่มี conditionGrade/appraisalPrice/collectedByShop)
 *   - แก้ได้เฉพาะ วันที่ลงบัญชี + ส่วนลดยอดปิด; ปุ่ม ยืนยัน = POST /device-returns/:id/confirm, ส่งกลับ = reject
 *   - ไม่มีบัญชีรับเงิน / ช่องติ๊กลูกหนี้-หน้าร้าน / ปุ่มรับโอนจากหน้าร้าน อีกต่อไป
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
type TestUser = { id: string; name: string; role: string; branchId: string | null };
let currentUser: TestUser = { id: 'u1', name: 'เจ้าของ', role: 'OWNER', branchId: null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser, isLoading: false }),
}));

import { RepossessionOverlay } from '../RepossessionOverlay';

let deviceReturnStatus = 'PENDING_CONFIRM';
let eligibilityOverride: { canRepossess: boolean; reason: string | null } | null = null;
let missingJournal = false;
let unbalancedJournal = false;

const deviceReturn = () => ({
  id: 'dr-1',
  docNumber: 'DR-20260920-0001',
  status: deviceReturnStatus,
  returnKind: 'VOLUNTARY',
  returnReason: 'UNAFFORDABLE',
  deviceReceivedAt: '2026-09-19T03:00:00.000Z',
  conditionGrade: 'B',
  appraisalPrice: '7000.00',
  tableBasePrice: '6500.00',
  repairCost: '0.00',
  notes: 'จอมีรอย',
  lineNotifyStatus: 'SENT',
  lineNotifiedAt: '2026-09-19T03:01:00.000Z',
  receivingBranch: { id: 'b1', name: 'ลาดพร้าว' },
  receivedBy: { id: 'u-bm', name: 'ผจก.ลาดพร้าว' },
  contract: {
    id: 'c-1',
    contractNumber: 'TEST-1',
    status: 'TERMINATED',
    customer: { id: 'cu1', name: 'ลูกค้า' },
    product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: null },
  },
  confirmedAt: null,
  confirmedBy: null,
  repossessionId: null,
  rejectReason: null,
  createdAt: '2026-09-19T03:00:00.000Z',
});

const preview = (url: string) => {
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  const discountPct = Number(q.get('discountPct') ?? 50);
  return {
    contract: {
      contractNumber: 'TEST-1',
      customer: { name: 'ลูกค้า' },
      product: { brand: 'Apple', model: 'iPhone 14' },
      totalMonths: 12,
      monthlyPayment: 1000,
      sellingPrice: 12000,
      financedAmount: 10000,
      storeCommission: 500,
    },
    calculation: {
      remainingMonths: 2,
      totalPaid: 10000,
      outstandingBalance: 2000,
      principalExVat: 1869.16,
      financeCost: 10500,
      remainingCost: 1750,
      grossProfit: 119.16,
      discountPct,
      discountAmount: 59.58,
      unpaidLateFees: 0,
      closingAmount: 1940.42,
      marketValue: 7000,
      marketValueSource: 'APPRAISAL',
      profitLoss: 5059.58,
      rescheduleAdvanceApplied: 0,
    },
    journalPreview: missingJournal
      ? null
      : {
          lines: [
            {
              accountCode: '11-2107',
              accountName: 'ลูกหนี้-หน้าร้าน',
              debit: '7000.00',
              credit: '0',
              description: 'ค่าเครื่องคืน',
            },
            {
              accountCode: '11-2101',
              accountName: 'ลูกหนี้ผ่อนชำระ',
              debit: '0',
              credit: '2000.00',
              description: '',
            },
            {
              accountCode: '41-1102',
              accountName: 'กำไรจากการยึด',
              debit: '0',
              credit: '5000.00',
              description: '',
            },
          ],
          totalDebit: '7000.00',
          totalCredit: '7000.00',
          isBalanced: !unbalancedJournal,
        },
    eligibility: eligibilityOverride ?? { canRepossess: true, reason: null },
  };
};

function routeApi() {
  apiGet.mockImplementation((url?: string) => {
    if (url === '/device-returns/dr-1') return Promise.resolve({ data: deviceReturn() });
    if (typeof url === 'string' && url.startsWith('/repossessions/preview/c-1?')) {
      return Promise.resolve({ data: preview(url) });
    }
    return Promise.reject(new Error('unexpected ' + String(url)));
  });
}

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderOverlay() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const view = render(
    <RepossessionOverlay
      deviceReturnId="dr-1"
      contractId="c-1"
      contractNumber="TEST-1"
      customerName="ลูกค้า"
      branchName="ลาดพร้าว"
      onClose={onClose}
      onSuccess={onSuccess}
    />,
    { wrapper },
  );
  return { onClose, onSuccess, ...view };
}

const confirmButton = () =>
  screen.getByRole('button', { name: 'ยืนยันรับเครื่องคืน' }) as HTMLButtonElement;
const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

it('locks conflicting actions and inputs during confirmation and ignores same-tick duplicate clicks', async () => {
  routeApi();
  let resolvePost!: (value: unknown) => void;
  apiPost.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
  );
  const { onClose, onSuccess } = renderOverlay();
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  const button = confirmButton();
  act(() => {
    button.click();
    button.click();
  });
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'ส่งกลับ' })).toBeDisabled();
  expect(screen.getByLabelText(/ส่วนลดยอดปิด/)).toBeDisabled();
  expect(screen.getByLabelText(/วันที่ลงบัญชี/)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
  fireEvent.click(screen.getByRole('button', { name: '← กลับ' }));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    resolvePost({ data: { id: 'dr-1', status: 'CONFIRMED' } });
  });
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
});

it('blocks confirmation while cached intake details are being refreshed', async () => {
  routeApi();
  renderOverlay();
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  apiGet.mockImplementation(() => new Promise(() => {}));
  act(() => {
    void qc.invalidateQueries({ queryKey: ['device-returns', 'detail', 'dr-1'] });
  });
  await waitFor(() => expect(confirmButton()).toBeDisabled());
  fireEvent.click(confirmButton());
  expect(apiPost).not.toHaveBeenCalled();
});

it('blocks cached preview during discount refetch and after its failure', async () => {
  routeApi();
  renderOverlay();
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  fireEvent.change(screen.getByLabelText(/ส่วนลดยอดปิด/), { target: { value: '30' } });
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  let rejectPreview!: (error: Error) => void;
  apiGet.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectPreview = reject;
      }),
  );
  fireEvent.change(screen.getByLabelText(/ส่วนลดยอดปิด/), { target: { value: '50' } });
  await waitFor(() => expect(confirmButton()).toBeDisabled());
  await act(async () => {
    rejectPreview(new Error('preview unavailable'));
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('preview unavailable');
  expect(confirmButton()).toBeDisabled();
  expect(apiPost).not.toHaveBeenCalled();
});

it('keeps the overlay open after a failed confirmation and permits a deliberate retry', async () => {
  routeApi();
  apiPost.mockRejectedValueOnce(new Error('confirmation unavailable'));
  const { onClose, onSuccess } = renderOverlay();
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  fireEvent.click(confirmButton());
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(confirmButton()).toBeEnabled());
  expect(onClose).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
  fireEvent.click(confirmButton());
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(apiPost).toHaveBeenCalledTimes(2);
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  currentUser = { id: 'u1', name: 'เจ้าของ', role: 'OWNER', branchId: null };
  deviceReturnStatus = 'PENDING_CONFIRM';
  eligibilityOverride = null;
  missingJournal = false;
  unbalancedJournal = false;
  // NOTE: block body on purpose — `mockReset()` returns the mock, and vitest would run a
  // returned function as the hook's cleanup.
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({ data: { id: 'dr-1', status: 'CONFIRMED' } });
});

describe('RepossessionOverlay — โหมดยืนยันใบรับเครื่องคืน', () => {
  it('แสดงข้อมูลใบอ่านอย่างเดียว + ไลน์ และเรียก preview ด้วย deviceReturnId + discountPct เท่านั้น', async () => {
    routeApi();
    renderOverlay();
    expect(await screen.findByText('DR-20260920-0001')).toBeInTheDocument();
    expect(screen.getByTestId('dr-appraisal')).toHaveTextContent('7,000.00 ฿');
    expect(screen.getByText(/ตารางรับซื้อ 6,500\.00 ฿ · ต่างจากตาราง \+8%/)).toBeInTheDocument();
    expect(screen.getByText('ส่งไลน์แล้ว')).toBeInTheDocument();
    expect(screen.getByText('จอมีรอย')).toBeInTheDocument();
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/repossessions/preview/c-1?deviceReturnId=dr-1&discountPct=50',
      ),
    );
    const previewUrls = apiGet.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/preview/'));
    expect(
      previewUrls.every(
        (u) => !/conditionGrade|appraisalPrice|collectedByShop|depositAccountCode/.test(u),
      ),
    ).toBe(true);
    // ถอดออกแล้ว
    expect(screen.queryByText(/บัญชีรับเงิน/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ตั้งลูกหนี้-หน้าร้าน/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /บันทึกรับโอนจากหน้าร้าน/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^A$/ })).not.toBeInTheDocument();
  });

  it('OWNER ยืนยัน → POST /device-returns/dr-1/confirm { paymentDate, discountPct } → onSuccess + onClose', async () => {
    routeApi();
    const { onClose, onSuccess } = renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/confirm', {
        paymentDate: bkkToday(),
        discountPct: 50,
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('FINANCE_MANAGER ยืนยันได้; BRANCH_MANAGER เห็นแจ้งเตือนและปุ่มปิด', async () => {
    currentUser = { id: 'u-fm', name: 'ผจก.การเงิน', role: 'FINANCE_MANAGER', branchId: null };
    routeApi();
    const first = renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    first.unmount();

    currentUser = { id: 'u-bm', name: 'ผจก.สาขา', role: 'BRANCH_MANAGER', branchId: 'b1' };
    routeApi();
    renderOverlay();
    expect(await screen.findAllByText(/เฉพาะเจ้าของ \/ ผจก.การเงิน/)).not.toHaveLength(0);
    const buttons = screen.getAllByRole('button', { name: 'ยืนยันรับเครื่องคืน' });
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });

  it('ใบที่ไม่ใช่ PENDING_CONFIRM → ปุ่มปิด + ข้อความ', async () => {
    deviceReturnStatus = 'REJECTED';
    routeApi();
    renderOverlay();
    await screen.findByText('DR-20260920-0001');
    await waitFor(() =>
      expect(confirmButton()).toHaveAttribute('title', 'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว'),
    );
    expect(confirmButton()).toBeDisabled();
  });

  it('eligibility ไม่ผ่าน → แบนเนอร์ + ปุ่มปิด + ลิงก์เปิดสัญญา', async () => {
    eligibilityOverride = {
      canRepossess: false,
      reason: 'ยอดค้างเป็น 0 — ลูกค้าจ่ายครบระหว่างรอ ให้ส่งกลับใบ',
    };
    routeApi();
    renderOverlay();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/ยอดค้างเป็น 0/);
    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(screen.getByRole('link', { name: /เปิดสัญญา/ })).toHaveAttribute(
      'href',
      '/contracts/c-1',
    );
    fireEvent.click(confirmButton());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ส่งกลับ → dialog เหตุผล → POST reject → onSuccess + onClose', async () => {
    routeApi();
    const { onClose, onSuccess } = renderOverlay();
    fireEvent.click(await screen.findByRole('button', { name: 'ส่งกลับ' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ส่งกลับ/), {
      target: { value: 'ราคาประเมินสูงเกินสภาพจริง' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยันส่งกลับ' }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/device-returns/dr-1/reject', {
        reason: 'ราคาประเมินสูงเกินสภาพจริง',
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('เปลี่ยนส่วนลด → preview refetch ด้วย discountPct ใหม่', async () => {
    routeApi();
    renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/ส่วนลดยอดปิด/), { target: { value: '30' } });
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/repossessions/preview/c-1?deviceReturnId=dr-1&discountPct=30',
      ),
    );
    await waitFor(() => expect(screen.getByText(/ส่วนลดลูกค้า \(30%\)/)).toBeInTheDocument());
  });

  it.each(['missing', 'unbalanced'])('blocks a %s JP5 preview', async (state) => {
    missingJournal = state === 'missing';
    unbalancedJournal = state === 'unbalanced';
    routeApi();
    renderOverlay();
    await screen.findByText('DR-20260920-0001');
    await waitFor(() => expect(confirmButton().title).toMatch(/JP5/));
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText('รายการบัญชีคืนเครื่อง (JP5)')).toBeInTheDocument();
  });

  it('separates ledger gain from management gain, deducts parked advances and makes no VAT credit-note promise without a reversal', async () => {
    // Retained display scenario from the former valuation suite: JP5 clears advances
    // without receivable relief or VAT reversal. Its ledger gain differs from closing P&L.
    apiGet.mockImplementation((url: string) => {
      if (url === '/device-returns/dr-1') return Promise.resolve({ data: deviceReturn() });
      if (url.startsWith('/repossessions/preview/c-1?')) {
        const data = preview(url);
        data.calculation.rescheduleAdvanceApplied = 1714;
        data.calculation.closingAmount = 226.42;
        data.calculation.profitLoss = 6773.58;
        data.journalPreview = {
          lines: [
            {
              accountCode: '11-2107',
              accountName: 'ลูกหนี้-หน้าร้าน',
              debit: '7000.00',
              credit: '0',
              description: 'ค่าเครื่องคืน',
            },
            {
              accountCode: '21-1103',
              accountName: 'เงินรับล่วงหน้า',
              debit: '1714.00',
              credit: '0',
              description: '',
            },
            {
              accountCode: '41-1102',
              accountName: 'กำไรจากการยึด',
              debit: '0',
              credit: '8714.00',
              description: '',
            },
          ],
          totalDebit: '8714.00',
          totalCredit: '8714.00',
          isBalanced: true,
        };
        return Promise.resolve({ data });
      }
      return Promise.reject(new Error('unexpected ' + url));
    });
    renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    expect(screen.getByText('หักเงินรับล่วงหน้าที่พักไว้').parentElement).toHaveTextContent(
      '- 1,714.00 ฿',
    );
    expect(screen.getByText('ยอดปิดสัญญาสุทธิ').parentElement).toHaveTextContent('226.42 ฿');
    expect(
      screen.getByText('ส่วนต่างราคาประเมินเทียบยอดปิด').parentElement?.parentElement,
    ).toHaveTextContent('+6,773.58 ฿');
    expect(screen.getByText('กำไร/ขาดทุนจากรายการยึดคืน').parentElement).toHaveTextContent(
      '+8,714.00 ฿',
    );
    expect(screen.getByText(/JP5 ชุดนี้ไม่มีบรรทัดตัดลูกหนี้/)).toBeInTheDocument();
    expect(
      screen.getByText(/ตัวเลขนี้ใช้ฐานบัญชี ส่วนต่างด้านบนใช้ยอดปิดสัญญาหลังส่วนลด/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ออกใบลดหนี้/)).not.toBeInTheDocument();
  });

  it('วันที่ลงบัญชีนอกเดือนปัจจุบัน → ปุ่มปิด', async () => {
    routeApi();
    renderOverlay();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/วันที่ลงบัญชี/), { target: { value: '2020-01-15' } });
    await waitFor(() =>
      expect(confirmButton()).toHaveAttribute(
        'title',
        'วันที่ลงบัญชีต้องอยู่ในเดือนปัจจุบันและไม่เป็นวันในอนาคต',
      ),
    );
  });
});
