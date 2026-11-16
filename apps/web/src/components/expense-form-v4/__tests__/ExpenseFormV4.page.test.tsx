// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseKind, fillExpenseLine, openAdjustments, saveDraft, waitForSettlementDoc } from './expense-form-driver';

/**
 * พฤติกรรมของหน้าเต็มแบบ PEAK (แผน Task 6) — mock ชุดเดียวกับ ExpenseFormV4.payloads.test.tsx
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
import type { DocType } from '../types';

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

function mount(props: { branchName?: string; initialDocType?: DocType } = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ExpenseFormV4 branchId="b1" onSaved={vi.fn()} onClose={vi.fn()} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const bodyOf = async (path: string) => {
  await waitFor(() => expect(apiPost.mock.calls.some((c) => c[0] === path)).toBe(true));
  return apiPost.mock.calls.find((c) => c[0] === path)![1];
};

describe('ExpenseFormV4 — หน้าเต็ม', () => {
  it('ไม่เป็น dialog และแสดงชื่อสาขากับเลขที่เอกสารที่หัวการ์ด', () => {
    mount({ branchName: 'สาขาทดสอบ' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('สาขา: สาขาทดสอบ')).toBeInTheDocument();
    expect(screen.getByLabelText('เลขที่เอกสาร')).toHaveValue('ออกเลขเมื่อบันทึก');
  });

  it('สรุปข้อมูลแสดง — เมื่อยังไม่มีผลคำนวณ และแสดงยอดจาก server เมื่อมี', async () => {
    const user = mount();
    const summary = screen.getByRole('region', { name: 'สรุปข้อมูล' });
    expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('—');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await waitFor(() =>
      expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('909.50'),
    );
  });

  it('ตัวอย่างรายการบัญชีย่อไว้ และบอกว่าสมดุลที่หัวแถว', async () => {
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    const row = screen.getByRole('region', { name: 'ตัวอย่างรายการบัญชี' });
    await within(row).findByText(/สมดุล/);
    expect(within(row).queryByRole('table')).not.toBeInTheDocument();
    const toggle = within(row).getByRole('button', { name: 'ย่อ/ขยาย ตัวอย่างรายการบัญชี' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(await within(row).findByRole('table')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(within(row).getByRole('table'));
  });

  it('กดยังไม่ชำระเงินขณะมียอดจ่ายจริง ขึ้นคำเตือนและล้างได้', async () => {
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await openAdjustments(user);
    await user.type(screen.getByLabelText('ยอดที่จ่ายจริง'), '910');
    await chooseKind(user, 'EXPENSE_UNPAID');
    expect(screen.getByRole('status')).toHaveTextContent('มีรายการปรับปรุงที่กรอกไว้ ซึ่งจะถูกบันทึกไปด้วย');
    await user.click(screen.getByRole('button', { name: 'ล้างรายการปรับปรุง' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await saveDraft(user);
    expect((await bodyOf('/expense-documents')).amountPaid).toBeUndefined();
  });

  it('จ่ายทันที แสดงยอดชำระสุทธิหลังหัก ณ ที่จ่าย และหายไปเมื่อเลือกยังไม่ชำระ', async () => {
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    const net = await screen.findByText('ยอดชำระสุทธิ (หลังหัก ณ ที่จ่าย)');
    await waitFor(() => expect(net.parentElement).toHaveTextContent('909.50 บาท'));
    await chooseKind(user, 'EXPENSE_UNPAID');
    expect(screen.queryByText('ยอดชำระสุทธิ (หลังหัก ณ ที่จ่าย)')).not.toBeInTheDocument();
  });

  it('ตัวเลือกบัญชีจ่ายเงินมีชื่อที่เข้าถึงได้ตรงกับป้าย ชำระโดย', () => {
    mount();
    expect(screen.getByRole('combobox', { name: 'ชำระโดย' })).toBeInTheDocument();
  });

  it('ผูก beforeunload หลังผู้ใช้แก้ฟอร์ม', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const user = mount();
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(false);
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true);
    add.mockRestore();
  });

  it('เลือกบัญชีด้วยการคลิกอย่างเดียว ก็ผูก beforeunload', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const user = mount();
    await user.click(screen.getAllByRole('button', { name: 'บัญชีค่าใช้จ่าย' })[0]);
    await waitFor(() => expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true));
    add.mockRestore();
  });

  it('บันทึกสำเร็จแล้วถอด beforeunload', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    await bodyOf('/expense-documents');
    await waitFor(() => expect(remove.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true));
    remove.mockRestore();
  });

  it('เปิดจ่ายเจ้าหนี้แล้วระบบติ๊กใบให้เอง ไม่นับเป็นการแก้ (ไม่ผูก beforeunload)', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    mount({ initialDocType: 'VENDOR_SETTLEMENT' });
    await waitForSettlementDoc('EX-009');
    await new Promise((r) => setTimeout(r, 50));
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(false);
    add.mockRestore();
  });
});
