import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContractCard from './ContractCard';
import type { ContractRow } from '../types';

// formatDateShort calls Intl under the hood — mock it so JSDOM doesn't vary
vi.mock('@/utils/formatters', () => ({
  formatDateShort: (d: Date) => d.toISOString().split('T')[0],
}));

const base: ContractRow = {
  id: 'ctr-1',
  contractNumber: 'BC-2026-0001',
  status: 'OVERDUE',
  dunningStage: 'NOTICE',
  customer: { id: 'cus-1', name: 'สมชาย ใจดี', phone: '0812345678', lineId: null },
  branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
  assignedTo: null,
  outstanding: 5500,
  daysOverdue: 12,
  lastCallResult: null,
  lastCallAt: null,
  noAnswerCount: 0,
  settlementDate: null,
  needsSkipTracing: false,
  deviceLocked: false,
  lastContactedAt: null,
  brokenPromiseCount: 0,
  mdmState: 'NONE',
  relatedContractsCount: 0,
  lastChannel: null,
};

describe('<ContractCard />', () => {
  it('renders the contract number', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.getByText('BC-2026-0001')).toBeInTheDocument();
  });

  it('renders the days-overdue hero number', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows "ยังไม่มอบหมาย" when assignedTo is null', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.getByText('ยังไม่มอบหมาย')).toBeInTheDocument();
  });

  it('shows assignee name when assignedTo is set', () => {
    const c: ContractRow = { ...base, assignedTo: { id: 'u1', name: 'นางสาวแนน' } };
    render(<ContractCard contract={c} onLogContact={vi.fn()} />);
    expect(screen.getByText('นางสาวแนน')).toBeInTheDocument();
  });

  it('shows "ล็อคแล้ว" chip when deviceLocked is true', () => {
    const c: ContractRow = { ...base, deviceLocked: true };
    render(<ContractCard contract={c} onLogContact={vi.fn()} />);
    expect(screen.getByText('ล็อคแล้ว')).toBeInTheDocument();
  });

  it('does not show "ล็อคแล้ว" chip when deviceLocked is false', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.queryByText('ล็อคแล้ว')).not.toBeInTheDocument();
  });
});
