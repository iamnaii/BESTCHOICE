import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input, InputAddon, InputWrapper, inputVariants } from './input';
import { NumberInput } from './NumberInput';
import { Select, SelectTrigger, SelectValue } from './select';
import { Textarea } from './textarea';
import { formControlClass } from './form-styles';
import { cn } from '@/lib/utils';

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

// tailwind-merge keeps `lg:text-sm` next to a bare caller size (`text-2xl`), so on >= 1024px
// the variant's 14px would beat the caller's own size. admin-typography.css leaves
// .text-lg/.text-xl/.text-2xl… inputs alone, so inside the shell nothing else fixes it.
describe('Input md — caller font size wins at every width', () => {
  it('Input className="text-2xl" ไม่มี lg:text-sm ของ variant', () => {
    render(<Input aria-label="ยอดเงิน" className="text-2xl font-bold" />);
    const input = screen.getByRole('textbox', { name: 'ยอดเงิน' });
    expect(input).toHaveClass('text-2xl');
    expect(input).not.toHaveClass('lg:text-sm');
    expect(input).not.toHaveClass('text-base');
  });

  it('Input className="text-xs" ไม่ขยายเป็น 14px บนจอใหญ่', () => {
    render(<Input aria-label="รหัส" className="text-xs" />);
    expect(screen.getByRole('textbox', { name: 'รหัส' })).not.toHaveClass('lg:text-sm');
  });

  it('Input ค่าตั้งต้นยังเป็น text-base lg:text-sm', () => {
    render(<Input aria-label="อีเมล" />);
    expect(screen.getByRole('textbox', { name: 'อีเมล' })).toHaveClass('text-base', 'lg:text-sm');
  });

  it('className สี (text-muted-foreground) ไม่ตัด lg:text-sm', () => {
    render(<Input aria-label="หมายเหตุ" className="text-muted-foreground" />);
    expect(screen.getByRole('textbox', { name: 'หมายเหตุ' })).toHaveClass(
      'text-base',
      'lg:text-sm',
      'text-muted-foreground',
    );
  });

  it('Input className={formControlClass} ได้คลาสเท่าเดิมทุกตัวอักษร', () => {
    render(<Input aria-label="ชื่อร้าน" className={formControlClass} />);
    const input = screen.getByRole('textbox', { name: 'ชื่อร้าน' });
    expect(input.className).toBe(cn(inputVariants(), formControlClass));
    expect(input).toHaveClass('text-base', 'lg:text-sm');
  });

  it('NumberInput className="text-2xl" ไม่มี lg:text-sm ของ variant', () => {
    render(<NumberInput aria-label="รับเงิน" className="text-2xl" />);
    const input = screen.getByRole('spinbutton', { name: 'รับเงิน' });
    expect(input).toHaveClass('text-2xl');
    expect(input).not.toHaveClass('lg:text-sm');
  });

  it('NumberInput ค่าตั้งต้นยังเป็น text-base lg:text-sm', () => {
    render(<NumberInput aria-label="จำนวน" />);
    expect(screen.getByRole('spinbutton', { name: 'จำนวน' })).toHaveClass('text-base', 'lg:text-sm');
  });

  it('InputWrapper className="text-lg" ไม่มี lg:text-sm ของ variant', () => {
    render(<InputWrapper data-testid="wrapper" className="text-lg" />);
    const wrapper = screen.getByTestId('wrapper');
    expect(wrapper).toHaveClass('text-lg');
    expect(wrapper).not.toHaveClass('lg:text-sm');
  });
});
