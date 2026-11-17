// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseCreditNoteStandalone, chooseKind, fillCreditNoteReason, fillExpenseLine, fillPettyCashLine, pickCreditNoteSource, saveDraft, waitForSettlementDoc,
} from './expense-form-driver';

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
vi.mock('@/components/accounting/AccountCombobox', () => ({
  AccountCombobox: (props: { value: string; onChange: (code: string) => void; id?: string; 'aria-label'?: string }) => (
    <button type="button" id={props.id} aria-label={props['aria-label'] ?? (props.id ? undefined : 'บัญชี')} onClick={() => props.onChange('53-1101')}>
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

describe('ใบลดหนี้ — รับเงินคืนเข้า', () => {
  it('เอกสารต้นฉบับจ่ายแล้ว: บัญชีที่เลือกในแถว รับเงินคืนเข้า คือค่าที่ส่งไป', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await fillCreditNoteReason(user, 'คืนสินค้า');
    const row = await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    const account = within(row).getByRole('combobox');
    expect(account).toHaveValue('11-1101');
    await user.selectOptions(account, '11-1201');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/credit-note')).toMatchObject({
      mode: 'LINKED', originalDocumentId: 'orig-1', reason: 'คืนสินค้า', depositAccountCode: '11-1201',
    });
  });

  it('เอกสารต้นฉบับยังตั้งหนี้อยู่: ไม่มีแถว รับเงินคืนเข้า', async () => {
    source.status = 'ACCRUAL';
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รายการที่จะลด' });
    expect(screen.queryByRole('region', { name: 'รับเงินคืนเข้า' })).not.toBeInTheDocument();
  });

  it('โหมดไม่มีเอกสารต้นทาง: ไม่มีแถว รับเงินคืนเข้า', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await chooseCreditNoteStandalone(user);
    expect(screen.queryByRole('region', { name: 'รับเงินคืนเข้า' })).not.toBeInTheDocument();
  });

  it('เลือกเอกสารต้นฉบับแล้วโฟกัสไปที่การ์ดเอกสารที่เลือก · กด เปลี่ยน แล้วโฟกัสกลับช่องค้นหา', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    const card = await screen.findByRole('group', { name: 'เอกสารต้นฉบับที่เลือก EX-001' });
    expect(card).toHaveFocus();
    await user.click(within(card).getByRole('button', { name: 'เปลี่ยน' }));
    expect(screen.getByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)')).toHaveFocus();
  });

  it('ผลค้นหาโหลดใหม่ (กลับมาที่หน้าต่าง) แล้วไม่มีเอกสารนั้น — การ์ดและแถว รับเงินคืนเข้า ยังอยู่', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    const searchCalls = () => apiGet.mock.calls.filter((c) => String(c[0]).includes('search=')).length;
    const before = searchCalls();
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path.startsWith('/expense-documents?') && path.includes('search=')
        ? Promise.resolve({ data: { data: [] } })
        : base(path),
    );
    try {
      act(() => focusManager.setFocused(false));
      act(() => focusManager.setFocused(true));
      await waitFor(() => expect(searchCalls()).toBeGreaterThan(before));
      expect(screen.getByRole('group', { name: 'เอกสารต้นฉบับที่เลือก EX-001' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'รับเงินคืนเข้า' })).toBeInTheDocument();
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('สลับไปประเภทอื่นแล้วกลับมาใบลดหนี้ — การ์ดเอกสารต้นฉบับและแถว รับเงินคืนเข้า กลับมาครบ', async () => {
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path === '/expense-documents/orig-1' ? Promise.resolve({ data: originalDoc() }) : base(path),
    );
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    await chooseKind(user, 'PETTY_CASH');
    await chooseKind(user, 'CREDIT_NOTE');
    expect(await screen.findByRole('group', { name: 'เอกสารต้นฉบับที่เลือก EX-001' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'รับเงินคืนเข้า' })).toBeInTheDocument();
    expect(screen.queryByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)')).not.toBeInTheDocument();
  });

  it('กลับมาใบลดหนี้แล้วโหลดเอกสารต้นฉบับไม่สำเร็จ — แสดงช่องค้นหาให้เลือกใหม่', async () => {
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path === '/expense-documents/orig-1' ? Promise.reject(new Error('ไม่พบเอกสาร')) : base(path),
    );
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    await chooseKind(user, 'PETTY_CASH');
    await chooseKind(user, 'CREDIT_NOTE');
    expect(await screen.findByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^เอกสารต้นฉบับที่เลือก/ })).not.toBeInTheDocument();
  });
});

describe('เงินสดย่อย', () => {
  it('มีแถวผู้ดูแลเงินสดย่อย และกล่องสรุปคิดจากรายการ', async () => {
    const user = mount();
    await chooseKind(user, 'PETTY_CASH');
    expect(screen.getByRole('region', { name: 'ผู้ดูแลเงินสดย่อย' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'สรุปข้อมูล' });
    expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('—');
    await fillPettyCashLine(user, { amount: '120' });
    expect(within(summary).getByText('มูลค่าก่อนภาษี').parentElement).toHaveTextContent('120.00');
    expect(within(summary).getByText('ภาษีมูลค่าเพิ่ม').parentElement).toHaveTextContent('0.00');
    expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('120.00');
  });
});

describe('ลำดับแถว', () => {
  const regionNames = () =>
    screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby')).map((id) => document.getElementById(id!)?.textContent?.trim());

  it.each([['VENDOR_SETTLEMENT'], ['PETTY_CASH']] as const)('%s: สรุปข้อมูลอยู่ก่อนชำระเงิน', async (kind) => {
    const user = mount();
    await chooseKind(user, kind);
    const names = regionNames();
    expect(names.indexOf('สรุปข้อมูล')).toBeGreaterThan(-1);
    expect(names.indexOf('สรุปข้อมูล')).toBeLessThan(names.indexOf('ชำระเงิน'));
  });
});

describe('จอมือถือ', () => {
  it('รายการเป็นการ์ด และ body ที่ส่งเหมือนจอใหญ่', async () => {
    mobile.value = true;
    const user = mount();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', taxDisallowed: false,
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 850, discount: 0, vatPercent: 7, whtPercent: 0 }],
    });
  });

  it('เงินสดย่อยเป็นการ์ด และ body ที่ส่งเหมือนจอใหญ่', async () => {
    mobile.value = true;
    const user = mount();
    await chooseKind(user, 'PETTY_CASH');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await fillPettyCashLine(user, { amount: '120' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/petty-cash')).toEqual({
      branchId: 'b1', documentDate: today, depositAccountCode: '11-1101',
      lines: [{ supplierName: 'ร้านตัวอย่าง', supplierId: 'sup-1', category: '53-1101', amount: 120, vatPercent: 0 }],
    });
  });
});
