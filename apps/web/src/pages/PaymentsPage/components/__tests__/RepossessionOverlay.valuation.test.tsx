/**
 * ราคาเดียว + ตารางรับซื้อเป็นตัวเทียบ บน overlay ยึดเครื่อง (คำตัดสินเจ้าของ 2026-09-05):
 *   - เลือกเกรด → backend คืน `valuation` → ราคาประเมินถูกเติมเป็นค่าตั้งต้น
 *   - ไม่พบในตาราง → เตือนให้ตีราคาเอง, ค่าที่ระบบเคยเติมถูกล้าง, กำไร/ขาดทุนยังคำนวณไม่ได้ ("—")
 *   - ค่าที่พนักงานพิมพ์เองต้องไม่ถูกทับเมื่อสลับเกรด
 *   - ต่างจากตารางเกิน ±15% → ต้องมีเหตุผลในหมายเหตุ ไม่งั้นปุ่มยืนยันปิด
 *   - ไม่มีช่องราคากลางและติ๊กคืนเงินอีกต่อไป
 */
import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'เจ้าของ', role: 'OWNER', branchId: null },
    isLoading: false,
  }),
}));
vi.mock('@/components/CashAccountSelect', () => ({
  KBANK_ONLY_CODES: ['11-1201'],
  CashAccountSelect: (p: { value: string; onChange: (v: string) => void }) => (
    <select data-testid="cash-select" value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      <option value="11-1201">KBank</option>
    </select>
  ),
}));

import { RepossessionOverlay } from '../RepossessionOverlay';

/** Backend stand-in: grade A is in the table (6,500), other grades are not. */
let eligibilityOverride: { canRepossess: boolean; reason: string | null } | null = null;
let missingJournal = false;
let unbalancedJournal = false;

function routePreview() {
  apiGet.mockImplementation((url?: string) => {
    if (typeof url !== 'string' || !url.startsWith('/repossessions/preview/')) {
      return Promise.reject(new Error('unexpected ' + String(url)));
    }
    const q = new URLSearchParams(url.split('?')[1] ?? '');
    const grade = q.get('conditionGrade') ?? '';
    const appraisal = q.get('appraisalPrice');
    const marketValue = Number(appraisal ?? 0);
    const found = grade === 'A';
    return Promise.resolve({
      data: {
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
          discountPct: 50,
          discountAmount: 59.58,
          unpaidLateFees: 0,
          closingAmount: 1940.42,
          marketValue,
          marketValueSource: appraisal ? 'APPRAISAL' : null,
          customerRefundEnabled: false,
          customerRefund: 0,
          profitLoss: marketValue - 1940.42,
          rescheduleAdvanceApplied: 1714,
        },
        journalPreview: missingJournal ? null : {
          lines: [
            { accountCode: '11-2107', accountName: 'ลูกหนี้หน้าร้าน', debit: '16717.97', credit: '0', description: '' },
            { accountCode: '21-1103', accountName: 'เงินรับล่วงหน้า', debit: '1714', credit: '0', description: '' },
            { accountCode: '41-1102', accountName: 'กำไรจากการยึด', debit: '0', credit: '18431.97', description: '' },
          ],
          totalDebit: '18431.97', totalCredit: '18431.97', isBalanced: !unbalancedJournal,
        },
        valuation: { grade, found, suggestedPrice: found ? 6500 : null, note: null },
        eligibility: eligibilityOverride ?? { canRepossess: true, reason: null },
      },
    });
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 180_000 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const renderOverlay = () =>
  render(
    <RepossessionOverlay
      contractId="c-1"
      contractNumber="TEST-1"
      customerName="ลูกค้า"
      onClose={() => {}}
      onSuccess={() => {}}
    />,
    { wrapper },
  );

const appraisalInput = () => screen.getAllByPlaceholderText('0.00')[0] as HTMLInputElement;
const submitButton = () =>
  screen.getByRole('button', { name: 'ยืนยันยึดคืน' }) as HTMLButtonElement;

beforeEach(() => {
  eligibilityOverride = null;
  missingJournal = false;
  unbalancedJournal = false;
  // NOTE: block body on purpose — `mockReset()` returns the mock, and vitest would run a
  // returned function as the hook's cleanup (= api.get() with no args after every test).
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({ data: { id: 'repo-1' } });
});

describe('RepossessionOverlay — ราคาเดียว + ตารางรับซื้อ', () => {
  it('prefills ราคาประเมิน from the valuation table for the default grade and shows the table hint', async () => {
    routePreview();
    renderOverlay();

    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    await waitFor(() =>
      expect(screen.getByText(/ตารางรับซื้อ เกรด A: 6,500\.00 ฿ \(ค่าตั้งต้น/)).toBeInTheDocument(),
    );
    expect(apiGet.mock.calls.some(([url]) => String(url).includes('conditionGrade=A'))).toBe(true);
    // ช่องราคากลางและติ๊กคืนเงินถูกถอดออก (นโยบายไม่มีเงินคืน 2026-09-05)
    expect(screen.queryByPlaceholderText('ใช้ราคาประเมินถ้าเว้นว่าง')).not.toBeInTheDocument();
    expect(screen.queryByText('คืนเงินส่วนต่างให้ลูกค้า')).not.toBeInTheDocument();
  });

  it('switching to a grade missing from the table clears the auto value and shows "—"', async () => {
    routePreview();
    renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));

    fireEvent.click(screen.getByRole('button', { name: /^B$/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/ไม่มีรุ่นนี้ในตารางรับซื้อ \(เกรด B\) ตีราคาเอง/),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(appraisalInput().value).toBe(''));
    await waitFor(() =>
      expect(screen.getByText(/กรอกราคาประเมินก่อน จึงจะคำนวณ/)).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
  });

  it('never overwrites a price the staff typed themselves', async () => {
    routePreview();
    renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));

    fireEvent.change(appraisalInput(), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('button', { name: /^B$/ }));
    await waitFor(() => expect(screen.getByText(/ไม่มีรุ่นนี้ในตารางรับซื้อ/)).toBeInTheDocument());
    expect(appraisalInput().value).toBe('7000');

    fireEvent.click(screen.getByRole('button', { name: /^A$/ }));
    await waitFor(() => expect(screen.getByText(/ตารางรับซื้อ เกรด A/)).toBeInTheDocument());
    expect(appraisalInput().value).toBe('7000');
    expect(screen.getByText(/ต่างจากตาราง \+8%/)).toBeInTheDocument();
  });

  it('blocks submit when the appraisal deviates >15% from the table until a note is given', async () => {
    routePreview();
    renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'UNAFFORDABLE' } });

    fireEvent.change(appraisalInput(), { target: { value: '5000' } }); // −23%
    await waitFor(() =>
      expect(screen.getByText(/ต่างจากตารางรับซื้อ -23% \(เกิน 15%\)/)).toBeInTheDocument(),
    );
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), {
      target: { value: 'จอแตก กระจกหลังร้าว' },
    });
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(screen.getByText(/ต่างจากตาราง -23%/)).toBeInTheDocument();
  });

  it('shows the eligibility banner and keeps submit disabled when the contract cannot be repossessed', async () => {
    eligibilityOverride = {
      canRepossess: false,
      reason: 'ต้องส่งหนังสือบอกเลิกสัญญาก่อนยึดเครื่อง — ให้กดยึดจากหน้ายึดคืน',
    };
    routePreview();
    renderOverlay();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/ต้องส่งหนังสือบอกเลิกสัญญาก่อน/);
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(submitButton().disabled).toBe(true);
    expect(submitButton()).toHaveAttribute('aria-describedby', 'repo-submit-block');
    expect(document.getElementById('repo-submit-block')).toHaveTextContent(/ต้องส่งหนังสือบอกเลิก/);
    expect(screen.getByRole('link', { name: /เปิดสัญญา/ })).toHaveAttribute('href', '/contracts/c-1');
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'UNAFFORDABLE' } });
    fireEvent.click(submitButton());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('requires a return reason, then sends it separately from valuation notes', async () => {
    routePreview(); renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    await waitFor(() => expect(submitButton()).toHaveAttribute('title', 'กรุณาเลือกเหตุผลคืนเครื่อง'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'UNAFFORDABLE' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/repossessions', expect.objectContaining({ returnReason: 'UNAFFORDABLE', notes: undefined })));
  });

  it('requires free-text detail for Other', async () => {
    routePreview(); renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'OTHER' } });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่มเติม/), { target: { value: 'รายละเอียดการคืน' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/repossessions', expect.objectContaining({ returnReason: 'OTHER', notes: 'รายละเอียดการคืน' })));
  });

  it('shows a retryable preview error and never enables submit without a preview', async () => {
    apiGet.mockRejectedValue(new Error('preview unavailable'));
    renderOverlay();
    expect(await screen.findByRole('alert')).toHaveTextContent('preview unavailable');
    fireEvent.change(appraisalInput(), { target: { value: '6500' } });
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'UNAFFORDABLE' } });
    expect(submitButton()).toBeDisabled();
    await screen.findByRole('button', { name: 'ลองคำนวณใหม่' });
    routePreview();
    fireEvent.click(screen.getByRole('button', { name: 'ลองคำนวณใหม่' }));
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it.each(['missing', 'unbalanced'])('blocks a %s JP5 preview', async (state) => {
    missingJournal = state === 'missing'; unbalancedJournal = state === 'unbalanced';
    routePreview(); renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'UNAFFORDABLE' } });
    await waitFor(() => expect(submitButton().title).toMatch(/JP5/));
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText('รายการบัญชีคืนเครื่อง (JP5)')).toBeInTheDocument();
  });

  it('explains the JP5-only gain, shows the park deduction and does not promise a VAT credit note with no VAT reversal', async () => {
    routePreview(); renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    expect(await screen.findByText('ส่วนต่างราคาประเมินเทียบยอดปิด')).toBeInTheDocument();
    expect(screen.getByText('กำไร/ขาดทุนจากรายการยึดคืน')).toBeInTheDocument();
    expect(screen.getByText(/\+18,431\.97/)).toBeInTheDocument();
    expect(screen.getByText('หักเงินรับล่วงหน้าที่พักไว้')).toBeInTheDocument();
    expect(screen.getByText(/JP5 ชุดนี้ไม่มีบรรทัดตัดลูกหนี้/)).toBeInTheDocument();
    expect(screen.queryByText(/พร้อมออกใบลดหนี้/)).not.toBeInTheDocument();
  });

  it('refreshes and disables confirmation even when returning to a cached appraisal', async () => {
    routePreview(); renderOverlay();
    await waitFor(() => expect(appraisalInput().value).toBe('6500'));
    fireEvent.change(screen.getByLabelText(/เหตุผลคืนเครื่อง/), { target: { value: 'UNAFFORDABLE' } });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    const successfulPreview = apiGet.getMockImplementation()!;
    let resolvePreview: (value: unknown) => void = () => {};
    apiGet.mockImplementation(() => new Promise((resolve) => { resolvePreview = resolve; }));
    fireEvent.change(appraisalInput(), { target: { value: '6501' } });
    await waitFor(() => expect(submitButton()).toHaveAttribute('title', 'กำลังตรวจสอบยอดและรายการ JP5'));
    expect(submitButton()).toBeDisabled();
    resolvePreview(await successfulPreview(apiGet.mock.calls[apiGet.mock.calls.length - 1][0]));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    const requestsBefore = apiGet.mock.calls.length;
    fireEvent.change(appraisalInput(), { target: { value: '6500' } });
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(requestsBefore));
    expect(submitButton()).toBeDisabled();
    resolvePreview(await successfulPreview(apiGet.mock.calls[apiGet.mock.calls.length - 1][0]));
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });
});
