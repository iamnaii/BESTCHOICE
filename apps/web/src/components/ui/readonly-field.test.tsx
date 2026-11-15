import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadOnlyField } from './readonly-field';

describe('ReadOnlyField', () => {
  it('renders a read-only, unfocusable input that a <label htmlFor> can name', () => {
    render(
      <>
        <label htmlFor="vat">VAT %</label>
        <ReadOnlyField id="vat" value={7} />
      </>,
    );
    const field = screen.getByLabelText('VAT %');
    expect(field.tagName).toBe('INPUT');
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('tabindex', '-1');
    expect(field).toHaveAttribute('data-slot', 'readonly-field');
    expect(field).toHaveValue('7');
  });

  it('uses the shared 44px form-control classes with the read-only surface', () => {
    render(<ReadOnlyField aria-label="ยอดสุทธิ" value="1,234.00" />);
    const field = screen.getByRole('textbox', { name: 'ยอดสุทธิ' });
    for (const cls of [
      'h-11',
      'min-h-11',
      'rounded-lg',
      'text-base',
      'lg:text-sm',
      'leading-normal',
      'border-input',
      'bg-muted/80',
      '[[readonly]]:bg-muted/80',
      '[[readonly]]:cursor-default',
      'text-foreground',
    ]) {
      expect(field).toHaveClass(cls);
    }
    expect(field).not.toHaveClass('[[readonly]]:cursor-not-allowed');
    expect(field).not.toHaveClass('text-right');
    expect(field).toHaveValue('1,234.00');
  });

  it('right-aligns numbers with tabular figures when align="end"', () => {
    render(<ReadOnlyField aria-label="ก่อนภาษี" value="500.00" align="end" />);
    expect(screen.getByRole('textbox', { name: 'ก่อนภาษี' })).toHaveClass('text-right', 'tabular-nums');
  });

  it('keeps status colours through tone, overriding the read-only background', () => {
    render(
      <>
        <ReadOnlyField aria-label="จ่ายเกิน" value="+10.00" tone="success" />
        <ReadOnlyField aria-label="จ่ายน้อย" value="-10.00" tone="warning" />
      </>,
    );
    const success = screen.getByRole('textbox', { name: 'จ่ายเกิน' });
    expect(success).toHaveClass('[[readonly]]:bg-success/10', 'text-success');
    expect(success).not.toHaveClass('[[readonly]]:bg-muted/80');
    expect(success).not.toHaveClass('text-foreground');

    const warning = screen.getByRole('textbox', { name: 'จ่ายน้อย' });
    expect(warning).toHaveClass('[[readonly]]:bg-warning/10', 'text-warning-strong');
    expect(warning).not.toHaveClass('text-warning');
    expect(warning).not.toHaveClass('[[readonly]]:bg-muted/80');
  });

  it('forwards ref and appends the caller className last', () => {
    const ref = createRef<HTMLInputElement>();
    render(<ReadOnlyField ref={ref} aria-label="VAT" value="7" className="w-28" />);
    const field = screen.getByRole('textbox', { name: 'VAT' });
    expect(ref.current).toBe(field);
    expect(field).toHaveClass('w-28');
  });
});
