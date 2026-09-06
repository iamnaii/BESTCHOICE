import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThaiDateInput from './ThaiDateInput';

/**
 * `min` / `max` are YYYY-MM-DD (CE). Days outside the range must not be
 * selectable from the calendar — the popover is the only way to pick a date
 * (the text input is readOnly), so this is the whole enforcement surface.
 */
function openCalendar(label: string) {
  fireEvent.click(screen.getByLabelText(label));
}

describe('ThaiDateInput — min / max', () => {
  afterEach(() => vi.useRealTimers());

  it('disables calendar days before `min` and ignores clicks on them', () => {
    const onChange = vi.fn();
    render(<ThaiDateInput value="2026-09-13" onChange={onChange} min="2026-09-13" aria-label="วันที่คาดรับ" />);
    openCalendar('วันที่คาดรับ');
    const day12 = screen.getByRole('button', { name: '12' });
    expect(day12).toBeDisabled();
    fireEvent.click(day12);
    expect(onChange).not.toHaveBeenCalled();

    const day14 = screen.getByRole('button', { name: '14' });
    expect(day14).toBeEnabled();
    fireEvent.click(day14);
    expect(onChange).toHaveBeenCalledWith({ target: { value: '2026-09-14' } });
  });

  it('disables calendar days after `max`', () => {
    const onChange = vi.fn();
    render(<ThaiDateInput value="2026-09-13" onChange={onChange} max="2026-09-13" aria-label="วันที่สั่ง" />);
    openCalendar('วันที่สั่ง');
    expect(screen.getByRole('button', { name: '14' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '12' })).toBeEnabled();
  });

  it('does not let the "วันนี้" shortcut pick a day before `min`', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 6, 10, 0, 0)); // 6 ก.ย. 2569
    const onChange = vi.fn();
    render(<ThaiDateInput value="" onChange={onChange} min="2026-09-13" aria-label="วันที่คาดรับ" />);
    openCalendar('วันที่คาดรับ');
    fireEvent.click(screen.getByRole('button', { name: 'วันนี้' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
