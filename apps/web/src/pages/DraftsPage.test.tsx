import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DraftTable, type DraftRow } from './DraftsPage';

const SAMPLE_ROWS: DraftRow[] = [
  {
    type: 'QUOTE',
    id: 'q-1',
    number: 'QU-20260517-0001',
    customerName: 'นาย ก',
    branchName: 'สาขาลาดพร้าว',
    amount: 45980,
    createdBy: 'พนักงาน X',
    createdAt: '2026-05-17T10:00:00Z',
    link: '/quotes/q-1',
  },
  {
    type: 'CONTRACT',
    id: 'c-1',
    number: 'BCP2605-00010',
    customerName: 'นาย ข',
    branchName: 'สาขาลาดพร้าว',
    amount: 20000,
    createdBy: 'พนักงาน Y',
    createdAt: '2026-05-16T10:00:00Z',
    link: '/contracts/c-1',
  },
];

describe('DraftTable', () => {
  it('renders one row per draft + shows formatted amount + type badge', () => {
    render(<DraftTable rows={SAMPLE_ROWS} onOpen={() => {}} />);
    expect(screen.getByText('QU-20260517-0001')).toBeInTheDocument();
    expect(screen.getByText('BCP2605-00010')).toBeInTheDocument();
    expect(screen.getByText('45,980.00')).toBeInTheDocument();
    expect(screen.getByText('ใบเสนอราคา')).toBeInTheDocument();
    expect(screen.getByText('สัญญา')).toBeInTheDocument();
  });

  it('fires onOpen with the row link when a row is clicked', () => {
    const onOpen = vi.fn();
    render(<DraftTable rows={SAMPLE_ROWS} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('QU-20260517-0001').closest('tr')!);
    expect(onOpen).toHaveBeenCalledWith('/quotes/q-1');
  });

  it('shows an empty-state message when rows is empty', () => {
    render(<DraftTable rows={[]} onOpen={() => {}} />);
    expect(screen.getByText('ยังไม่มีเอกสารร่าง')).toBeInTheDocument();
  });
});
