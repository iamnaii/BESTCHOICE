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

  it('clicking "เดือนนี้" emits the FULL current month (owner 2026-07-02)', () => {
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-05-01', endDate: '2026-05-31' });
  });

  it('clicking "เดือนนี้" in December emits Dec 1 → Dec 31 (year-end month wrap)', () => {
    vi.setSystemTime(new Date('2026-12-10T05:00:00.000Z')); // 12:00 BKK
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });

  it('clicking "เดือนนี้" in leap-year February emits end 2028-02-29', () => {
    vi.setSystemTime(new Date('2028-02-10T05:00:00.000Z')); // 12:00 BKK
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2028-02-01', endDate: '2028-02-29' });
  });

  it('clicking "เดือนนี้" in non-leap February emits end 2026-02-28', () => {
    vi.setSystemTime(new Date('2026-02-10T05:00:00.000Z')); // 12:00 BKK
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-02-01', endDate: '2026-02-28' });
  });

  it('clicking "เดือนนี้" in a 30-day month emits end 2026-04-30', () => {
    vi.setSystemTime(new Date('2026-04-10T05:00:00.000Z')); // 12:00 BKK
    render(<DateRangeChips startDate="" endDate="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'เดือนนี้' }));
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-04-01', endDate: '2026-04-30' });
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

  it('"เดือนนี้" chip has aria-checked=true when the full current month is selected', () => {
    render(<DateRangeChips startDate="2026-05-01" endDate="2026-05-31" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('"เดือนนี้" chip has aria-checked=true when the full non-31-day month is selected', () => {
    vi.setSystemTime(new Date('2026-04-10T05:00:00.000Z')); // 12:00 BKK — April has 30 days
    render(<DateRangeChips startDate="2026-04-01" endDate="2026-04-30" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
