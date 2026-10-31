import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Customer360Panel from './Customer360Panel';
import type { ContractRow } from '../types';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'OWNER' } }),
}));
vi.mock('../hooks/useCustomer360', () => ({
  useCustomer360: () => ({
    data: {
      detail: {
        id: 'k1',
        contractNumber: 'CT-1',
        status: 'OVERDUE',
        // คอลัมน์จาก GET /contracts/:id — ต้องไม่ใช่เกณฑ์
        customer: { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678', lineIdFinance: 'U-col' },
        branch: { id: 'b1', name: 'สาขา 1' },
        installmentCount: 12,
      },
      timeline: [],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('../hooks/useCustomerInsights', () => ({
  useCustomerInsights: () => ({ data: undefined }),
}));
vi.mock('../hooks/useCustomerTags', () => ({
  useCustomerTags: () => ({ data: [] }),
  useRecomputeCustomerTags: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useMdmLock', () => ({
  useUnlockContract: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./Customer360Timeline', () => ({ default: () => null }));
vi.mock('./Customer360Actions', () => ({ default: () => null }));
vi.mock('./SmartCustomerPanel', () => ({ default: () => null }));
vi.mock('./RelatedContractsTab', () => ({ default: () => null }));
vi.mock('./LegalCaseBanner', () => ({ default: () => null }));
vi.mock('./LegalCaseDialog', () => ({ default: () => null }));
vi.mock('./LateFeeWaiverDialog', () => ({ default: () => null }));
vi.mock('./LockDeviceDialog', () => ({ default: () => null }));
vi.mock('./CustomerTagChips', () => ({ default: () => null }));
vi.mock('./CustomerTagDialog', () => ({ default: () => null }));
vi.mock('./LineChatPanel', () => ({
  default: ({ canSend }: { canSend: boolean }) => (
    <div data-testid="line-chat" data-can-send={String(canSend)} />
  ),
}));
vi.mock('@/components/CallButton', () => ({ CallButton: () => null }));

function row(customer: Partial<ContractRow['customer']>): ContractRow {
  return {
    id: 'k1',
    contractNumber: 'CT-1',
    status: 'OVERDUE',
    daysOverdue: 12,
    outstanding: 5000,
    branch: { id: 'b1', name: 'สาขา 1' },
    customer: {
      id: 'c1',
      name: 'สมชาย ใจดี',
      phone: '0812345678',
      lineIdFinance: null,
      lineIdShop: null,
      hasVerifiedLine: false,
      ...customer,
    },
  } as unknown as ContractRow;
}

/**
 * Task 27 (Task 24 ข้อกังวล 3 + คำสั่งผู้คุมงาน) — ป้าย "LINE (งานการเงิน)" · แท็บ "แชท LINE" · ช่องพิมพ์ในแท็บ ใช้ hasVerifiedLine
 * (แถว OTP ที่ยังผูก) เกณฑ์เดียวกับปุ่ม "ส่ง LINE" — คอลัมน์ lineIdFinance (ทั้งของแถวคิวและของ GET /contracts/:id) ไม่ใช่เกณฑ์
 */
describe('Customer360Panel — LINE การเงินตาม hasVerifiedLine', () => {
  it('คอลัมน์มีค่าแต่ยังไม่ยืนยัน OTP → ไม่มีป้าย ไม่มีแท็บแชท LINE', () => {
    render(
      <Customer360Panel
        contract={row({ lineIdFinance: 'U-col', hasVerifiedLine: false })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('LINE (งานการเงิน)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แชท LINE' })).not.toBeInTheDocument();
  });

  it('ยืนยัน OTP แล้วแม้คอลัมน์ว่าง → มีป้าย + แท็บ · ช่องพิมพ์เปิด', async () => {
    render(
      <Customer360Panel
        contract={row({ lineIdFinance: null, hasVerifiedLine: true })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('LINE (งานการเงิน)')).toBeInTheDocument();
    screen.getByRole('button', { name: 'แชท LINE' }).click();
    expect(await screen.findByTestId('line-chat')).toHaveAttribute('data-can-send', 'true');
  });
});
