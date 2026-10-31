import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Customer360Actions from './Customer360Actions';
import type { ContractRow } from '../types';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../hooks/useMdmLock', () => ({
  useUnlockContract: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./PaymentRecordDialog', () => ({ default: () => null }));
vi.mock('./LockDeviceDialog', () => ({ default: () => null }));

const base = {
  id: 'ctr-1',
  contractNumber: 'BC-2026-0001',
  customer: {
    id: 'cus-1',
    name: 'สมชาย ใจดี',
    phone: '0812345678',
    lineIdFinance: null,
    lineIdShop: null,
    hasVerifiedLine: false,
  },
  outstanding: 5500,
  daysOverdue: 12,
  deviceLocked: false,
  mdmState: 'NONE',
} as unknown as ContractRow;

/** Task 24 RR-M2 — ปุ่ม "ส่ง LINE" ในแผง 360 เปิดตามแถว OTP ที่ยังผูก (hasVerifiedLine) ไม่ใช่คอลัมน์ lineIdFinance */
describe('<Customer360Actions /> — ปุ่มส่ง LINE', () => {
  it('ปิดเมื่อยังไม่ยืนยัน OTP แม้มีค่า LINE ID ในระบบ · title บอกเหตุ', () => {
    const contract = {
      ...base,
      customer: { ...base.customer, lineIdFinance: 'U-typed', hasVerifiedLine: false },
    };
    render(<Customer360Actions contract={contract} onSendLine={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'ส่ง LINE' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      'title',
      'ลูกค้ายังไม่ได้ยืนยัน LINE การเงินด้วย OTP — ส่ง LINE ไม่ได้',
    );
  });

  it('เปิดเมื่อยืนยัน OTP แล้ว แม้คอลัมน์ LINE ID ว่าง', () => {
    const onSendLine = vi.fn();
    const contract = {
      ...base,
      customer: { ...base.customer, lineIdFinance: null, hasVerifiedLine: true },
    };
    render(<Customer360Actions contract={contract} onSendLine={onSendLine} />);
    const btn = screen.getByRole('button', { name: 'ส่ง LINE' });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('title');
    btn.click();
    expect(onSendLine).toHaveBeenCalledTimes(1);
  });

  it('ยืนยันแล้วแต่ไม่มีตัวจัดการส่ง → ปิด (คงพฤติกรรมเดิม)', () => {
    const contract = { ...base, customer: { ...base.customer, hasVerifiedLine: true } };
    render(<Customer360Actions contract={contract} />);
    expect(screen.getByRole('button', { name: 'ส่ง LINE' })).toBeDisabled();
  });
});
