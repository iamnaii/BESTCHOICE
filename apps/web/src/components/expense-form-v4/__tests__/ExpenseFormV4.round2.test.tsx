// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseCreditNoteStandalone, chooseKind, pickCreditNoteSource, waitForSettlementDoc } from './expense-form-driver';

/**
 * เนื้อในของ จ่ายเจ้าหนี้ / ใบลดหนี้ / เงินสดย่อย (แผนรอบ 2) — mock ชุดเดียวกับ ExpenseFormV4.page.test.tsx
 * ต่างกันสองจุด: บัญชีเงินเป็น <select> ธรรมดา (เลือกค่าได้ใน jsdom) และสลับจอมือถือได้ด้วย mobile.value
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: vi.fn(),
  },
  getErrorMessage: (e: { message?: string }) => e?.message ?? 'ผิดพลาด',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', name: 'ผู้ทดสอบ', role: 'OWNER', branchId: 'b1', defaultCashAccountCode: '11-1101' },
  }),
}));
vi.mock('@/hooks/useAccountingPermissions', () => ({
  useAccountingPermissions: () => ({ can: () => true, isError: false, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
    smartDoctypeSwitchEnabled: false,
    smartSwitchThresholdDays: 0,
    pettyCashEnabled: true,
    templatesEnabled: false,
    approvalEnabled: false,
    approvalThreshold: 1000,
    approvalRequiredDocTypes: [],
    taxExemptWarningEnabled: true,
    whtRates: [{ rate: 0, label: 'ไม่หัก' }, { rate: 3, label: '3% — ค่าบริการ' }],
    adjustmentCodes: { underpay: '52-1104', overpay: '53-1503' },
    settlementDefaultTick: 'all',
    settlementMaxBillsPerDoc: 100,
    settlementPartialPaymentEnabled: true,
  }),
}));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ id, value, onSelectSupplier }: { id?: string; value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button id={id} type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label'] ?? 'บัญชี'} onClick={() => props.onChange('53-1101')}>
      {props.value || '—'}
    </button>
  ),
}));
vi.mock('@/components/ui/ThaiDateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (e: { target: { value: string } }) => void }) => (
    <input id={id} aria-label="วันที่ใบกำกับ (ทดสอบ)" value={value} onChange={(e) => onChange({ target: { value: e.target.value } })} />
  ),
}));
// ตัวเลือกบัญชีเงินจริงเป็น Radix Select — แทนด้วย <select> ที่ส่งรหัสบัญชีเหมือนของจริง
vi.mock('@/components/CashAccountSelect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/CashAccountSelect')>();
  return {
    ...actual,
    CashAccountSelect: ({ id, value, onChange, codes = actual.CASH_ACCOUNT_CODES }: {
      id?: string; value?: string; onChange: (code: string) => void; codes?: readonly string[];
    }) => (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    ),
  };
});

import { ExpenseFormV4 } from '../ExpenseFormV4';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const ACCRUAL_DOC = {
  id: 'acc-1', number: 'EX-009', vendorName: 'เจ้าหนี้ตัวอย่าง', totalAmount: '1000.00',
  documentDate: today, status: 'ACCRUAL', branch: { id: 'b1', name: 'สาขาทดสอบ' },
};
/** สถานะของเอกสารต้นฉบับที่การค้นหาใบลดหนี้คืนมา — POSTED = จ่ายแล้ว · ACCRUAL = ยังตั้งหนี้อยู่ */
const source = vi.hoisted(() => ({ status: 'POSTED' }));
const originalDoc = () => ({
  id: 'orig-1', number: 'EX-001', vendorName: 'ผู้ขายเดิม', totalAmount: '1070.00', status: source.status,
  documentDate: '2026-11-01', expenseDetail: { lines: [{ category: '53-1101', amountBeforeVat: '1000' }] },
  branch: { id: 'b1', name: 'สาขาทดสอบ' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mobile.value = false;
  source.status = 'POSTED';
  apiGet.mockImplementation((path: string) => {
    if (path === '/chart-of-accounts/grouped') {
      return Promise.resolve({ data: { groups: [{ accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }] }] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('status=ACCRUAL')) {
      return Promise.resolve({ data: { data: [ACCRUAL_DOC] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('search=')) {
      return Promise.resolve({ data: { data: [originalDoc()] } });
    }
    if (path.endsWith('/cn-cap')) {
      return Promise.resolve({ data: { originalTotal: '1070.00', usedTotal: '0.00', remainingCap: '1070.00' } });
    }
    return Promise.resolve({ data: [] });
  });
  apiPost.mockImplementation((path: string) => {
    if (path === '/expense-documents/preview-je') {
      return Promise.resolve({
        data: {
          flow: 'expense-same-day', lines: [],
          totals: {
            subtotal: '850.00', vatAmount: '59.50', withholdingTax: '0.00', totalAmount: '909.50',
            netPayment: '909.50', drSum: '909.50', crSum: '909.50', balanced: true,
          },
        },
      });
    }
    return Promise.resolve({ data: { id: 'new-1' } });
  });
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ExpenseFormV4 branchId="b1" onSaved={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

// ใช้ใน Task 4 และ Task 8
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const bodyOf = async (path: string) => {
  await waitFor(() => expect(apiPost.mock.calls.some((c) => c[0] === path)).toBe(true));
  return apiPost.mock.calls.find((c) => c[0] === path)![1];
};

describe('จ่ายชำระเจ้าหนี้', () => {
  it('มีแถวข้อมูลผู้รับเงิน และกล่องสรุปคิดจากใบที่เลือกกับภาษีหัก ณ ที่จ่าย', async () => {
    const user = mount();
    await chooseKind(user, 'VENDOR_SETTLEMENT');
    await waitForSettlementDoc('EX-009');
    expect(screen.getByRole('region', { name: 'ข้อมูลผู้รับเงิน' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'สรุปข้อมูล' });
    await waitFor(() =>
      expect(within(summary).getByText('ตัดเงินสดสุทธิ').parentElement).toHaveTextContent('1,000.00'),
    );
    expect(within(summary).getByText('รวมยอดที่จ่าย').parentElement).toHaveTextContent('1,000.00');
    await user.type(screen.getByLabelText('ยอดภาษีหัก ณ ที่จ่าย'), '30');
    expect(within(summary).getByText('หัก ณ ที่จ่าย').parentElement).toHaveTextContent('30.00');
    expect(within(summary).getByText('ตัดเงินสดสุทธิ').parentElement).toHaveTextContent('970.00');
  });
});

describe('ใบลดหนี้', () => {
  it('แยกเป็นแถว อ้างอิงเอกสาร และ รายการที่จะลด — ตารางขึ้นหลังเลือกเอกสารต้นฉบับ', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    expect(screen.getByRole('region', { name: 'อ้างอิงเอกสาร' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'รายการที่จะลด' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /เอกสารต้นฉบับ \+ รายการ/ })).not.toBeInTheDocument();
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    expect(await screen.findByRole('region', { name: 'รายการที่จะลด' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^เหตุผล/)).toHaveLength(1);
  });

  it('โหมดไม่มีเอกสารต้นทาง มีช่องเหตุผลช่องเดียว และตารางรายการขึ้นทันที', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await chooseCreditNoteStandalone(user);
    expect(screen.getByRole('region', { name: 'รายการที่จะลด' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^เหตุผล/)).toHaveLength(1);
    expect(screen.getByLabelText(/^ชื่อผู้ขาย/)).toBeInTheDocument();
  });

  it('โหมดอ้างอิง: แถวข้อมูลผู้ขายครบเมื่อมีวันที่ · โหมดไม่มีเอกสารต้นทางต้องมีชื่อผู้ขายด้วย', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    const mark = () =>
      within(screen.getByRole('region', { name: 'ข้อมูลผู้ขาย' })).getByRole('heading').querySelector('svg');
    expect(mark()).toHaveClass('text-primary');
    await chooseCreditNoteStandalone(user);
    expect(mark()).toHaveClass('text-muted-foreground');
  });
});
