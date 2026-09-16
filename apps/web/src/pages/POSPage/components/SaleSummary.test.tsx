import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Customer } from '../types';
import SaleSummary from './SaleSummary';

const copy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy, copied: false, error: null }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// แถวตามที่ GET /customers/search คืนจริง — ผู้สนใจจากแชทมี phone = null + ธง chatPlaceholder
const PROSPECT = { id: 'p1', name: 'สมชาย ใจดี', phone: null, nationalId: '', _count: { contracts: 0 }, chatPlaceholder: true } as Customer;
const REAL = { id: 'c1', name: 'สมชาย ใจงาม', phone: '0812345678', nationalId: '', _count: { contracts: 2 }, chatPlaceholder: false } as Customer;

function renderSummary(customer: Customer) {
  render(
    <SaleSummary
      saleType="CASH"
      selectedProduct={null}
      selectedCustomer={customer}
      bundleProducts={[]}
      sellingPrice=""
      discount=""
      netAmount={0}
      amountReceived=""
      changeAmount={0}
      transferAmount={0}
      downPayment=""
      financeCompany=""
      contractNumber=""
      isSubmitting={false}
      canSubmit={false}
      onSubmit={() => undefined}
      onReset={() => undefined}
    />,
  );
}

describe('SaleSummary — การ์ดลูกค้า', () => {
  beforeEach(() => { copy.mockReset(); });

  it('ผู้สนใจจากแชท: โชว์ "จากแชท · ยังไม่มีเบอร์" และไม่มีปุ่มคัดลอกเบอร์ (เดิมคัดลอกคำว่า "null")', () => {
    renderSummary(PROSPECT);
    expect(screen.getByText('จากแชท · ยังไม่มีเบอร์')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'คัดลอกเบอร์โทร' })).toBeNull();
  });

  it('ลูกค้าจริง: โชว์เบอร์ และปุ่มคัดลอกส่งเบอร์นั้น', () => {
    renderSummary(REAL);
    expect(screen.getByText('0812345678')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกเบอร์โทร' }));
    expect(copy).toHaveBeenCalledWith('0812345678');
  });
});
