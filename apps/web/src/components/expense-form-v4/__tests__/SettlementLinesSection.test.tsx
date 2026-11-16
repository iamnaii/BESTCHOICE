import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ settlementPartialPaymentEnabled: true }));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ settlementDefaultTick: 'all', settlementMaxBillsPerDoc: 100, ...flags }),
}));
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({
        data: {
          data: [{
            id: 'acc-1', number: 'EX-009', vendorName: 'เจ้าหนี้ตัวอย่าง', totalAmount: '1000.00',
            documentDate: '2026-11-01', status: 'ACCRUAL', branch: { id: 'b1', name: 'สาขาทดสอบ' },
          }],
        },
      }),
    ),
  },
}));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ id, value }: { id?: string; value: string }) => (
    <button id={id} type="button">{value || 'เลือกผู้ขาย'}</button>
  ),
}));

import { SettlementLinesSection, SettlementPayeeFields } from '../SettlementLinesSection';
import type { SettlementFormFields } from '../types';

const empty = (): SettlementFormFields => ({
  selections: new Map(), vendorName: '', vendorSupplierId: '', whtAmount: '', whtFormType: '',
});

function Harness() {
  const [value, setValue] = useState(empty);
  return (
    <>
      <SettlementPayeeFields value={value} onChange={setValue} />
      <SettlementLinesSection branchId="b1" value={value} onChange={setValue} />
    </>
  );
}

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  );

beforeEach(() => { flags.settlementPartialPaymentEnabled = true; });

describe('SettlementLinesSection', () => {
  it('ช่องติ๊กและช่องจำนวนที่จ่ายมีชื่อของใบนั้น', async () => {
    mount();
    expect(await screen.findByRole('checkbox', { name: 'เลือก EX-009' })).toBeChecked();
    expect(await screen.findByLabelText('จำนวนที่จ่ายของ EX-009')).toHaveDisplayValue('1,000.00');
  });

  it('ไม่มีแถวรวมท้ายกล่อง — ยอดรวมอยู่ในกล่องสรุปของหน้า', async () => {
    mount();
    await screen.findByText('EX-009');
    expect(screen.queryByText('ตัดเงินสดสุทธิ')).not.toBeInTheDocument();
    expect(screen.queryByText('รวมยอดที่จ่าย')).not.toBeInTheDocument();
  });

  it('ปิดการชำระบางส่วน: คำเตือนใช้สี token และช่องยอดถูกล็อก', async () => {
    flags.settlementPartialPaymentEnabled = false;
    mount();
    const notice = screen.getByText('การชำระบางส่วนถูกปิดในการตั้งค่าระบบ — ทุกใบที่เลือกจะถูกล็อกที่ยอดเต็ม');
    expect(notice).toHaveClass('text-warning-strong');
    expect(notice.className).not.toMatch(/amber/);
    expect(await screen.findByLabelText('ยอดที่จ่ายของ EX-009 ล็อกที่ยอดเต็ม')).toBeDisabled();
  });

  it('ผู้รับเงินและภาษีหัก ณ ที่จ่ายมีป้ายผูกกับช่อง', () => {
    mount();
    expect(screen.getByLabelText('ผู้รับเงิน (ถ้ารวมเจ้าหนี้คนเดียว)')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'หัก ณ ที่จ่าย' })).toBeInTheDocument();
    expect(screen.getByLabelText('ประเภทภาษีหัก ณ ที่จ่าย')).toBeInTheDocument();
    expect(screen.getByLabelText('ยอดภาษีหัก ณ ที่จ่าย')).toBeInTheDocument();
  });
});
