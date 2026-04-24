import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DateRangePicker } from '../DateRangePicker';

describe('DateRangePicker', () => {
  it('renders preset buttons', () => {
    render(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} />);
    expect(screen.getByText('วันนี้')).toBeInTheDocument();
    expect(screen.getByText('7 วัน')).toBeInTheDocument();
    expect(screen.getByText('30 วัน')).toBeInTheDocument();
  });

  it('calls onChange when preset clicked', () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ from: null, to: null }} onChange={onChange} />);
    fireEvent.click(screen.getByText('7 วัน'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(Date),
        to: expect.any(Date),
      }),
    );
  });

  it('displays Thai Buddhist year (พ.ศ.)', () => {
    const from = new Date(2026, 3, 25); // April 25, 2026 CE = 2569 BE
    render(<DateRangePicker value={{ from, to: from }} onChange={() => {}} />);
    expect(screen.getByText(/2569/)).toBeInTheDocument();
  });
});
