import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { contractPlanSchema } from '@/lib/schemas';
import { PlanDetailsStep, type PlanDetailsStepProps } from './PlanDetailsStep';

const plan = { downPayment: 3000, totalMonths: 6, notes: '' };
const props = (day: number): PlanDetailsStepProps => ({
  ...plan,
  selectedProduct: null,
  interestConfig: null,
  selectedCustomer: {
    id: 'test-customer', name: 'ลูกค้าทดสอบ', phone: '0000000000', nationalId: '',
    salary: '15000', occupation: null, salaryPayDay: day,
  },
  sellingPrice: 15000, minDownPct: 0.2, minMonths: 3, maxMonths: 12,
  paymentDueDay: day, interestRate: 0, storeCommPct: 0, vatPct: 0,
  principal: 12000, storeCommission: 0, interestTotal: 0, vatAmount: 0,
  financedAmount: 12000, monthlyPayment: 2000, monthOptions: [6, 12],
  setDownPayment: vi.fn(), setDownPaymentTouched: vi.fn(), setTotalMonths: vi.fn(),
  setNotes: vi.fn(), setPaymentDueDay: vi.fn(),
});

describe('contract due date follows the confirmed payday', () => {
  it.each([1, 25, 28, 29, 30, 31])('accepts payday %i in the contract form', (paymentDueDay) => {
    expect(contractPlanSchema.safeParse({ ...plan, paymentDueDay }).success).toBe(true);
  });

  it.each([0, 32, 25.5])('rejects invalid payday %s', (paymentDueDay) => {
    expect(contractPlanSchema.safeParse({ ...plan, paymentDueDay }).success).toBe(false);
  });

  it.each([29, 30, 31])('keeps the selected payday %i visible without a validation error', async (day) => {
    await act(async () => { render(<PlanDetailsStep {...props(day)} />); });
    const select = screen.getByRole('combobox', { name: /วันที่ครบกำหนดชำระ/ });
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'false'));
    expect(select).toHaveValue(String(day));
    expect(screen.getByRole('option', {
      name: day === 31 ? 'สิ้นเดือน (วันสุดท้ายของเดือน)' : `วันที่ ${day} ของทุกเดือน`,
    })).toBeInTheDocument();
  });

  it('lets staff select payday 30 and sends that exact day to the contract form', async () => {
    const values = props(25);
    await act(async () => { render(<PlanDetailsStep {...values} />); });
    fireEvent.change(screen.getByRole('combobox', { name: /วันที่ครบกำหนดชำระ/ }), { target: { value: '30' } });
    await waitFor(() => expect(values.setPaymentDueDay).toHaveBeenCalledWith(30));
  });
});
