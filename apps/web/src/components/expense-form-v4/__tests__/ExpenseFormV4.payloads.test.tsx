// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseKind, fillExpenseLine, openAdjustments, saveDraft, type Kind } from './expense-form-driver';

/**
 * จับ body ที่ฟอร์มส่งไป API ของทุกประเภทเอกสาร (เงินเดือนอยู่ใน ExpenseFormV4.payroll.test.tsx)
 * งานเปลี่ยนหน้าตา (spec 2026-11-16) แก้ได้เฉพาะ expense-form-driver.ts — ห้ามแก้ body ที่คาดหวังในไฟล์นี้
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
// ค่าที่ฟอร์มอ่านจาก useUiFlags — ถ้าส่วนใดอ่าน flag อื่น ให้เติมค่าจาก DEFAULT_UI_FLAGS (hooks/useUiFlags.ts)
const flags = vi.hoisted(() => ({ smartDoctypeSwitchEnabled: false }));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
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
    ...flags,
  }),
}));
// ตัวเลือกผู้ขายจริงค้น server — แทนด้วยปุ่มที่เลือกผู้ขายคนเดียว
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ id, value, onSelectSupplier }: { id?: string; value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button id={id} type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
  // ตัวเลือกบัญชีจริงเป็น popover ค้นหาได้ (มีเทสต์ของตัวเอง) — แทนด้วยปุ่มที่เลือก 53-1101
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label'] ?? 'บัญชี'} onClick={() => props.onChange('53-1101')}>
      {props.value || '—'}
    </button>
  ),
}));
// ปฏิทินไทยเป็น popover — แทนด้วยช่องวันที่ธรรมดาที่ส่งค่า ISO เหมือนของจริง
vi.mock('@/components/ui/ThaiDateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (e: { target: { value: string } }) => void }) => (
    <input id={id} aria-label="วันที่ใบกำกับ (ทดสอบ)" value={value} onChange={(e) => onChange({ target: { value: e.target.value } })} />
  ),
}));

import { ExpenseFormV4 } from '../ExpenseFormV4';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const ACCRUAL_DOC = {
  id: 'acc-1', number: 'EX-009', vendorName: 'เจ้าหนี้ตัวอย่าง', totalAmount: '1000.00',
  documentDate: today, status: 'ACCRUAL', branch: { id: 'b1', name: 'สาขาทดสอบ' },
};
const ORIGINAL_DOC = {
  id: 'orig-1', number: 'EX-001', vendorName: 'ผู้ขายเดิม', totalAmount: '1070.00', status: 'POSTED',
  documentDate: '2026-11-01', expenseDetail: { lines: [{ category: '53-1101', amountBeforeVat: '1000' }] },
  branch: { id: 'b1', name: 'สาขาทดสอบ' },
};

beforeEach(() => {
  vi.clearAllMocks();
  flags.smartDoctypeSwitchEnabled = false;
  apiGet.mockImplementation((path: string) => {
    if (path === '/chart-of-accounts/grouped') {
      return Promise.resolve({ data: { groups: [{ accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }] }] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('status=ACCRUAL')) {
      return Promise.resolve({ data: { data: [ACCRUAL_DOC] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('search=')) {
      return Promise.resolve({ data: { data: [ORIGINAL_DOC] } });
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

const bodyOf = async (path: string) => {
  await waitFor(() => expect(apiPost.mock.calls.some((c) => c[0] === path)).toBe(true));
  return apiPost.mock.calls.find((c) => c[0] === path)![1];
};

const EXPENSE_LINE = { category: '53-1101', quantity: 1, unitPrice: 850, discount: 0, vatPercent: 7, whtPercent: 0 };

describe('ExpenseFormV4 — body ที่ส่งไป API', () => {
  it('รายจ่ายจ่ายทันที ส่งวิธีจ่ายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'EXPENSE_PAID');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', taxDisallowed: false,
      lines: [EXPENSE_LINE],
    });
  });

  it('รายจ่ายตั้งหนี้ ไม่ส่งวิธีจ่ายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'EXPENSE_UNPAID');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      taxDisallowed: false, lines: [EXPENSE_LINE],
    });
  });

  it('รายจ่ายจ่ายทันทีที่กรอกยอดจ่ายจริง ส่ง amountPaid', async () => {
    const user = mount();
    await chooseKind(user, 'EXPENSE_PAID');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await openAdjustments(user);
    await user.type(screen.getByLabelText('ยอดที่จ่ายจริง'), '910');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', taxDisallowed: false,
      lines: [EXPENSE_LINE], amountPaid: '910',
    });
  });

  it('วันที่ใบกำกับย้อนหลังเมื่อเปิดสลับอัตโนมัติ กลายเป็นตั้งหนี้', async () => {
    flags.smartDoctypeSwitchEnabled = true;
    const user = mount();
    fireEvent.change(screen.getByLabelText('วันที่ใบกำกับ (ทดสอบ)'), { target: { value: '2026-01-05' } });
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-01-05', priceType: 'EXCLUSIVE',
      taxDisallowed: false, lines: [EXPENSE_LINE],
    });
  });

  it('จ่ายเจ้าหนี้ ส่งเอกสารที่เลือกและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'VENDOR_SETTLEMENT');
    await screen.findByText('EX-009');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/settlement')).toEqual({
      branchId: 'b1', documentDate: today, depositAccountCode: '11-1101', paymentMethod: 'BANK_TRANSFER',
      lines: [{ clearedDocumentId: 'acc-1', amountSettled: 1000 }],
    });
  });

  it('ใบลดหนี้แบบอ้างอิงเอกสาร ส่งเอกสารต้นฉบับและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await user.type(screen.getByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)'), 'EX-0');
    await user.click(await screen.findByRole('button', { name: /EX-001/ }));
    await user.type(await screen.findByLabelText(/^เหตุผล/), 'คืนสินค้า');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/credit-note')).toEqual({
      mode: 'LINKED', branchId: 'b1', documentDate: today, originalDocumentId: 'orig-1',
      reason: 'คืนสินค้า', depositAccountCode: '11-1101',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 1000, discount: 0, vatPercent: 7, whtPercent: 0 }],
    });
  });

  it('ใบลดหนี้แบบไม่มีเอกสารต้นทาง ส่งชื่อผู้ขาย ไม่ส่งบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await user.click(screen.getByRole('button', { name: /^ไม่มีเอกสารต้นทาง/ }));
    await user.type(screen.getByLabelText(/^ชื่อผู้ขาย/), 'ร้านตัวอย่าง');
    await user.type(screen.getByLabelText(/^เหตุผล/), 'ส่วนลดพิเศษ');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '500' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/credit-note')).toEqual({
      mode: 'STANDALONE', branchId: 'b1', documentDate: today, vendorName: 'ร้านตัวอย่าง',
      reason: 'ส่วนลดพิเศษ',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 500, discount: 0, vatPercent: 7, whtPercent: 0 }],
    });
  });

  it('เงินสดย่อย ส่งบรรทัดพร้อมผู้ขายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'PETTY_CASH' as Kind);
    await user.click(screen.getByRole('button', { name: 'เลือกผู้ขาย' }));
    await user.click(screen.getByRole('button', { name: 'บัญชี' }));
    await user.type(screen.getByPlaceholderText('0.00'), '120');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/petty-cash')).toEqual({
      branchId: 'b1', documentDate: today, depositAccountCode: '11-1101',
      lines: [{ supplierName: 'ร้านตัวอย่าง', supplierId: 'sup-1', category: '53-1101', amount: 120, vatPercent: 0 }],
    });
  });
});
