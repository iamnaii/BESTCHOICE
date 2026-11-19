import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContractSummaryPanel } from './ContractSummaryPanel';
import type { Product, Customer } from '../types';

const product = { id: 'p1', brand: 'Apple', model: 'iPhone 15' } as Product;
const customer = { id: 'c1', name: 'ลูกค้าทดสอบ' } as Customer;
const base = { selectedProduct: product, selectedCustomer: customer, sellingPrice: 26900, downPayment: 3000,
  totalMonths: 10, monthlyPayment: 2868, interestRate: 0.01, interestConfig: null };

describe('ContractSummaryPanel — ของแถม', () => {
  it('มีของแถม → สรุปก่อนยืนยันบอกจำนวนและชื่อ (ไม่คิดเงิน)', () => {
    render(<ContractSummaryPanel {...base} bundleProducts={[
      { id: 'a1', name: 'เคสใส iPhone 15', brand: 'B', model: 'Case', category: 'ACCESSORY' },
      { id: 'a2', name: 'ฟิล์มกระจก iPhone 15', brand: 'B', model: 'Film', category: 'ACCESSORY' },
    ]} />);
    expect(screen.getByText('ของแถม (2 รายการ · ไม่คิดเงิน)')).toBeInTheDocument();
    expect(screen.getByText('เคสใส iPhone 15 · ฟิล์มกระจก iPhone 15')).toBeInTheDocument();
  });

  it('ไม่มีของแถม → ไม่มีแถวของแถม (สรุปหน้าตาเดิม)', () => {
    render(<ContractSummaryPanel {...base} />);
    expect(screen.queryByText(/ของแถม/)).not.toBeInTheDocument();
  });
});

describe('ContractSummaryPanel — ดอกเบี้ย', () => {
  it('มีตารางรายงวด → ดอกเบี้ยรวมทั้งสัญญาของงวดที่เลือก', () => {
    render(
      <ContractSummaryPanel
        {...base}
        totalMonths={12}
        interestRate={0.0417}
        contractRatePct={0.5}
        interestConfig={{
          id: 'ic-1', name: 'มือถือมือ 1', productCategories: ['PHONE_NEW'], interestRate: '0',
          minDownPaymentPct: '0.15', storeCommissionPct: '0.10', vatPct: '0.07',
          minInstallmentMonths: 6, maxInstallmentMonths: 12, allowedMonths: [10, 12],
        }}
      />,
    );
    expect(screen.getByText('50% ทั้งสัญญา (12 เดือน) (มือถือมือ 1)')).toBeInTheDocument();
  });

  it('ไม่มีตาราง → ต่อเดือนแบบเดิม', () => {
    render(<ContractSummaryPanel {...base} />);
    expect(screen.getByText('1.00%')).toBeInTheDocument();
  });
});
