import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InterestConfig } from '../types';
import { PlanDetailsStep, type PlanDetailsStepProps } from './PlanDetailsStep';

const config = (allowedMonths: number[]): InterestConfig => ({
  id: 'ic-1',
  name: 'มือถือมือ 1',
  productCategories: ['PHONE_NEW'],
  interestRate: allowedMonths.length > 0 ? '0' : '0.0417',
  minDownPaymentPct: '0.15',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  allowedMonths,
});

const props = (cfg: InterestConfig): PlanDetailsStepProps => ({
  selectedProduct: null,
  interestConfig: cfg,
  selectedCustomer: null,
  sellingPrice: 25900,
  downPayment: 3900,
  totalMonths: 12,
  notes: '',
  paymentDueDay: 5,
  minDownPct: 0.15,
  minMonths: 6,
  maxMonths: 12,
  // ค่าจากใบเสนอราคา: interestRate = ratePct ÷ งวด (contract-quote.service.ts:99) · ratePct = ดอกเบี้ยรวมทั้งสัญญา
  interestRate: 0.0417,
  contractRatePct: 0.5,
  storeCommPct: 0.1,
  vatPct: 0.07,
  principal: 22000,
  storeCommission: 2200,
  interestTotal: 11000,
  vatAmount: 2464,
  financedAmount: 37664,
  monthlyPayment: 3138.67,
  monthOptions: (cfg.allowedMonths ?? []).length > 0 ? cfg.allowedMonths! : [6, 7, 8, 9, 10, 11, 12],
  setDownPayment: vi.fn(),
  setDownPaymentTouched: vi.fn(),
  setTotalMonths: vi.fn(),
  setNotes: vi.fn(),
  setPaymentDueDay: vi.fn(),
});

describe('PlanDetailsStep — ป้ายดอกเบี้ย', () => {
  it('มีตารางรายงวด → ดอกเบี้ยรวมทั้งสัญญา + งวดที่เลือกได้ ไม่โชว์ต่อเดือน / ช่วงงวด', async () => {
    await act(async () => {
      render(<PlanDetailsStep {...props(config([10, 12]))} />);
    });
    expect(
      screen.getByText('(ดอกเบี้ย 50% ทั้งสัญญา | ดาวน์ขั้นต่ำ 15% | เลือกได้ 10, 12 เดือน)'),
    ).toBeInTheDocument();
    expect(screen.getByText('+ ดอกเบี้ย (50% ทั้งสัญญา 12 เดือน)')).toBeInTheDocument();
    expect(screen.queryByText(/6-12 เดือน/)).toBeNull();
    expect(screen.queryByText(/4\.17%/)).toBeNull();
  });

  it('ไม่มีตารางรายงวด → แบบเดิม (ต่อเดือน × งวด)', async () => {
    await act(async () => {
      render(<PlanDetailsStep {...props(config([]))} />);
    });
    expect(screen.getByText('(4.17% | ดาวน์ขั้นต่ำ 15% | 6-12 เดือน)')).toBeInTheDocument();
    expect(screen.getByText('+ ดอกเบี้ย (4.17% × 12 เดือน)')).toBeInTheDocument();
  });
  // final manual check B5 — จอ 375px: ป้ายต้องไม่ถูกบีบจนคำหักทีละพยางค์ ("มือ/ถือ/ใหม่")
  it('จอแคบ: ป้ายขึ้นบรรทัดใหม่ได้ · ชื่อตั้งค่าและคำนำไม่ตัดกลางคำ · รายละเอียดขึ้นบรรทัดของตัวเองบนมือถือ', async () => {
    await act(async () => {
      render(<PlanDetailsStep {...props(config([10, 12]))} />);
    });
    const label = screen.getByText('ใช้ดอกเบี้ยตาม:');
    const name = screen.getByText('มือถือมือ 1');
    const detail = screen.getByText('(ดอกเบี้ย 50% ทั้งสัญญา | ดาวน์ขั้นต่ำ 15% | เลือกได้ 10, 12 เดือน)');
    expect(label.parentElement).toHaveClass('flex-wrap');
    expect(label).toHaveClass('whitespace-nowrap');
    expect(name).toHaveClass('whitespace-nowrap');
    expect(detail).toHaveClass('basis-full', 'sm:basis-auto');
  });
});
