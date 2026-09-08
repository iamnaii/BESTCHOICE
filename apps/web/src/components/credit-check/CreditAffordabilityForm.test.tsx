import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import CreditAffordabilityForm from './CreditAffordabilityForm';

vi.mock('@/lib/api', () => ({ default: { post: vi.fn() }, getErrorMessage: () => 'เกิดข้อผิดพลาด' }));
beforeEach(() => { vi.mocked(api.post).mockResolvedValue({ data: { internalMonthlyDebt: 3000,
  remainingIncome: 3000, maximumMonthlyPayment: 1500, contextToken: 'a'.repeat(64), commitments: [] } }); });

function fillBasis() {
  for (const [name, value] of [['รายได้ประจำที่ยืนยัน', '15000'], ['ค่าครองชีพ', '9000'],
    ['ค่างวดหนี้ภายนอก', '0'], ['หลักฐานและที่มาของตัวเลข', 'ยืนยันรายได้จากสลิป ค่าใช้จ่าย หนี้และวันเงินเดือนกับลูกค้าแล้ว']]) {
    fireEvent.change(screen.getByLabelText(new RegExp(name)), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText(/วันเงินเดือนออก/), { target: { value: '25' } });
}

it('requires explicit complete figures and confirmation; blank debt is not zero', async () => {
  const onChange = vi.fn();
  render(<CreditAffordabilityForm creditCheckId="check" onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'คำนวณเพดาน' })).toBeDisabled();
  fillBasis();
  fireEvent.click(screen.getByRole('button', { name: 'คำนวณเพดาน' }));
  expect(await screen.findByText(/ภาระ BESTCHOICE.*3,000/)).toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
    verifiedMonthlyIncome: 15000, livingExpenses: 9000, externalMonthlyDebt: 0,
    approvedMonthlyPayment: 1500, salaryPayDay: 25, confirmed: true, contextToken: 'a'.repeat(64),
  })));
  fireEvent.change(screen.getByLabelText(/อนุมัติค่างวดไม่เกิน/), { target: { value: '2000' } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(null));
});

it('invalidates the displayed calculation after any confirmed basis changes', async () => {
  const onChange = vi.fn();
  render(<CreditAffordabilityForm creditCheckId="check" onChange={onChange} />);
  fillBasis();
  fireEvent.click(screen.getByRole('button', { name: 'คำนวณเพดาน' }));
  await screen.findByText(/ภาระ BESTCHOICE/);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText(/ค่างวดหนี้ภายนอก/), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'คำนวณเพดาน' })).toBeDisabled();
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(null));
  expect(screen.queryByLabelText(/อนุมัติค่างวดไม่เกิน/)).not.toBeInTheDocument();
});

it('clears the old customer basis when selecting another credit record', () => {
  const onChange = vi.fn();
  const view = render(<CreditAffordabilityForm creditCheckId="first" onChange={onChange} />);
  fillBasis();
  view.rerender(<CreditAffordabilityForm creditCheckId="second" onChange={onChange} />);
  expect(screen.getByLabelText(/รายได้ประจำที่ยืนยัน/)).toHaveValue(null);
  expect(screen.getByRole('button', { name: 'คำนวณเพดาน' })).toBeDisabled();
});

it('rejects more than two decimal places before calculating', () => {
  render(<CreditAffordabilityForm creditCheckId="check" onChange={vi.fn()} />);
  fillBasis();
  fireEvent.change(screen.getByLabelText(/รายได้ประจำที่ยืนยัน/), { target: { value: '15000.001' } });
  expect(screen.getByRole('button', { name: 'คำนวณเพดาน' })).toBeDisabled();
});


it('explains a verified zero ceiling without asking for an impossible approval amount', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: { internalMonthlyDebt: 0, remainingIncome: 0,
    maximumMonthlyPayment: 0, contextToken: 'a'.repeat(64), commitments: [] } });
  const onChange = vi.fn();
  render(<CreditAffordabilityForm creditCheckId="check" onChange={onChange} />);
  fillBasis();
  fireEvent.click(screen.getByRole('button', { name: 'คำนวณเพดาน' }));
  expect(await screen.findByText(/ข้อมูลครบแล้ว.*0 บาท.*ยังอนุมัติค่างวดใหม่ไม่ได้/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/อนุมัติค่างวดไม่เกิน/)).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(null);
});
