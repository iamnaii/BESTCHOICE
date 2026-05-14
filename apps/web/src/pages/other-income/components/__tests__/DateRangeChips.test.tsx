import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateRangeChips } from '../DateRangeChips';

describe('DateRangeChips', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
    // Freeze "today" so date math is deterministic. 2026-05-14 BKK.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T05:00:00.000Z')); // 12:00 BKK
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders 4 chips', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'ทั้งหมด' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'เดือนที่แล้ว' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /ช่วงวันที่/ })).toBeInTheDocument();
  });

  it('clicking "เดือนนี้" emits 1st of current month → today', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-05-01', endDate: '2026-05-14' });
  });

  it('clicking "เดือนที่แล้ว" emits 1st → last day of last month', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนที่แล้ว' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-04-01', endDate: '2026-04-30' });
  });

  it('clicking "ทั้งหมด" clears both dates', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-14" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ทั้งหมด' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '', endDate: '' });
  });

  it('right-side label shows "ทั้งหมด" when both dates empty', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent('ทั้งหมด');
  });

  it('label shows "พฤษภาคม 2569 (01/05 - 14/05)" for current-month partial', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-14" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent(
      'พฤษภาคม 2569 (01/05 - 14/05)',
    );
  });

  it('label shows full month name when range exactly covers one calendar month', () => {
    render(<DateRangeChips startDate="2026-04-01" endDate="2026-04-30" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent('เมษายน 2569');
  });

  it('label shows cross-month format for ranges spanning two months', () => {
    render(<DateRangeChips startDate="2026-04-15" endDate="2026-05-14" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent('15 เม.ย. - 14 พ.ค. 2569');
  });

  it('label includes both years for cross-year range', () => {
    render(<DateRangeChips startDate="2025-12-15" endDate="2026-01-14" onChange={onChange} />);
    expect(screen.getByTestId('date-range-label')).toHaveTextContent(
      '15 ธ.ค. 2568 - 14 ม.ค. 2569',
    );
  });

  it('"เดือนนี้" chip has aria-checked=true when current month is selected', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-14" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
