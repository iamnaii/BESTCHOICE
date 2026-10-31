import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FocusContractCard from './FocusContractCard';
import type { SessionContract } from '../hooks/useMySession';

vi.mock('@/components/CallButton', () => ({
  CallButton: ({ phone }: { phone?: string }) => <button type="button">{phone ?? 'โทร'}</button>,
}));

const assignment = (
  customer: Partial<SessionContract['contract']['customer']>,
): SessionContract => ({
  id: 'a1',
  contractId: 'ctr-1',
  escalationFlag: false,
  status: 'PENDING',
  startedAt: null,
  completedAt: null,
  contract: {
    id: 'ctr-1',
    contractNumber: 'BC-2026-0001',
    daysOverdue: 12,
    customer: {
      id: 'cus-1',
      name: 'สมชาย ใจดี',
      phone: '0812345678',
      lineIdFinance: null,
      lineIdShop: null,
      hasVerifiedLine: false,
      ...customer,
    },
    branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
    assignedTo: null,
  },
});

const handlers = () => ({
  onCallEnded: vi.fn(),
  onLogContact: vi.fn(),
  onSendLine: vi.fn(),
  onSkip: vi.fn(),
  onOpen360: vi.fn(),
});

/** Task 24 RR-M2 — โหมดโฟกัส: ปุ่ม "ส่ง LINE" เปิดตามแถว OTP ที่ยังผูก (hasVerifiedLine) ไม่ใช่คอลัมน์ lineIdFinance */
describe('<FocusContractCard /> — ปุ่มส่ง LINE', () => {
  it('ปิดเมื่อยังไม่ยืนยัน OTP แม้มีค่า LINE ID ในระบบ', () => {
    render(
      <FocusContractCard
        assignment={assignment({ lineIdFinance: 'U-typed', hasVerifiedLine: false })}
        {...handlers()}
      />,
    );
    expect(screen.getByRole('button', { name: 'ส่ง LINE' })).toBeDisabled();
  });

  it('เปิดเมื่อยืนยัน OTP แล้ว แม้คอลัมน์ LINE ID ว่าง', () => {
    const h = handlers();
    render(
      <FocusContractCard
        assignment={assignment({ lineIdFinance: null, hasVerifiedLine: true })}
        {...h}
      />,
    );
    const btn = screen.getByRole('button', { name: 'ส่ง LINE' });
    expect(btn).toBeEnabled();
    btn.click();
    expect(h.onSendLine).toHaveBeenCalledTimes(1);
  });
});
