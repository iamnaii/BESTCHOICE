import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input, InputAddon } from './input';
import { Select, SelectTrigger, SelectValue } from './select';
import { Textarea } from './textarea';
import { formControlClass } from './form-styles';

const SIZES = ['sm', 'md', 'lg'] as const;

// Spec 2026-11-14 §4.1: every form primitive uses the 8px radius (rounded-lg = var(--radius)).
describe('form primitives — 8px radius (§4.1)', () => {
  it.each(SIZES)('Input variant %s ใช้ rounded-lg', (variant) => {
    render(<Input aria-label="ชื่อ" variant={variant} />);
    const input = screen.getByRole('textbox', { name: 'ชื่อ' });
    expect(input).toHaveClass('rounded-lg');
    expect(input).not.toHaveClass('rounded-md');
  });

  it.each(SIZES)('InputAddon variant %s ใช้ rounded-lg', (variant) => {
    render(
      <InputAddon data-testid="addon" variant={variant}>
        บาท
      </InputAddon>,
    );
    const addon = screen.getByTestId('addon');
    expect(addon).toHaveClass('rounded-lg');
    expect(addon).not.toHaveClass('rounded-md');
  });

  it.each(SIZES)('SelectTrigger size %s ใช้ rounded-lg', (size) => {
    render(
      <Select>
        <SelectTrigger aria-label="สาขา" size={size}>
          <SelectValue placeholder="เลือกสาขา" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'สาขา' });
    expect(trigger).toHaveClass('rounded-lg');
    expect(trigger).not.toHaveClass('rounded-md');
  });

  it.each(SIZES)('Textarea variant %s ใช้ rounded-lg', (variant) => {
    render(<Textarea aria-label="หมายเหตุ" variant={variant} />);
    const textarea = screen.getByRole('textbox', { name: 'หมายเหตุ' });
    expect(textarea).toHaveClass('rounded-lg');
    expect(textarea).not.toHaveClass('rounded-md');
  });
});

// S3-23: outside .app-shell the global 14/16px rule does not apply, so the primitive itself
// must be 16px below lg (iOS Safari zooms into inputs smaller than 16px).
describe('Input md — 16px below lg outside the app shell (S3-23)', () => {
  it('Input ค่าตั้งต้นใช้ text-base และ lg:text-sm แทน 13px', () => {
    render(<Input aria-label="อีเมล" />);
    const input = screen.getByRole('textbox', { name: 'อีเมล' });
    expect(input).toHaveClass('text-base', 'lg:text-sm', 'leading-snug');
    expect(input).not.toHaveClass('text-[0.8125rem]');
  });

  it('formControlClass (สร้างจาก inputVariants) ยังมีมุมและตัวอักษรชุดเดียว', () => {
    const classes = formControlClass.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['rounded-lg', 'text-base', 'lg:text-sm', 'h-11']),
    );
    expect(classes).not.toContain('rounded-md');
    expect(classes.filter((c) => /^text-(base|sm|xs|\[)/.test(c))).toEqual(['text-base']);
  });
});
