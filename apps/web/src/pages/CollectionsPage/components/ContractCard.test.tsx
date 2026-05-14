import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContractCard from './ContractCard';
import type { ContractRow } from '../types';

// formatDateShort calls Intl under the hood — mock it so JSDOM doesn't vary
vi.mock('@/utils/formatters', () => ({
  formatDateShort: (d: Date) => d.toISOString().split('T')[0],
  formatNumber: (n: number) => n.toLocaleString(),
}));

// CallButton uses useMutation — mock to avoid QueryClientProvider requirement
vi.mock('@/components/CallButton', () => ({
  CallButton: ({ phone }: { phone?: string }) => (
    <button data-testid="call-button">{phone ?? 'โทร'}</button>
  ),
}));

const base: ContractRow = {
  id: 'ctr-1',
  contractNumber: 'BC-2026-0001',
  status: 'OVERDUE',
  dunningStage: 'NOTICE',
  customer: { id: 'cus-1', name: 'สมชาย ใจดี', phone: '0812345678', lineIdFinance: null, lineIdShop: null },
  branch: { id: 'br-1', name: 'สาขาลาดพร้าว' },
  assignedTo: null,
  outstanding: 5500,
  daysOverdue: 12,
  lastCallResult: null,
  lastCallAt: null,
  noAnswerCount: 0,
  settlementDate: null,
  settlementAmount: null,
  needsSkipTracing: false,
  deviceLocked: false,
  lastContactedAt: null,
  brokenPromiseCount: 0,
  mdmState: 'NONE',
  relatedContractsCount: 0,
  lastChannel: null,
  letterCount: 0,
  slipReviewPending: false,
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

  it('shows "ล็อคเครื่อง" chip when deviceLocked is true', () => {
    const c: ContractRow = { ...base, deviceLocked: true };
    render(<ContractCard contract={c} onLogContact={vi.fn()} />);
    expect(screen.getByText('ล็อคเครื่องอยู่')).toBeInTheDocument();
  });

  it('does not show "ล็อคเครื่อง" chip when deviceLocked is false', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.queryByText('ล็อคเครื่องอยู่')).not.toBeInTheDocument();
  });

  it('renders snooze badge when snoozedUntil is in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const c: ContractRow = { ...base, snoozedUntil: future };
    render(<ContractCard contract={c} onLogContact={vi.fn()} />);
    expect(screen.getByText(/^ถึง/)).toBeInTheDocument();
  });

  it('omits snooze badge when snoozedUntil is null', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.queryByText(/^ถึง/)).not.toBeInTheDocument();
  });

  it('renders trending-up arrow when trendingArrow=UP', () => {
    const c: ContractRow = { ...base, trendingArrow: 'UP' };
    render(<ContractCard contract={c} onLogContact={vi.fn()} />);
    expect(screen.getByTestId('trending-up')).toBeInTheDocument();
    expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();
  });

  it('renders trending-down arrow when trendingArrow=DOWN', () => {
    const c: ContractRow = { ...base, trendingArrow: 'DOWN' };
    render(<ContractCard contract={c} onLogContact={vi.fn()} />);
    expect(screen.getByTestId('trending-down')).toBeInTheDocument();
  });

  it('renders no arrow when trendingArrow is null (no historical data)', () => {
    render(<ContractCard contract={base} onLogContact={vi.fn()} />);
    expect(screen.queryByTestId('trending-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();
  });
});
