import { describe, it, expect } from 'vitest';
import { callerSetsFontSize, withCallerFontSize } from './caller-font-size';
import { inputVariants } from './input';
import { formControlClass } from './form-styles';

// Input md is `text-base lg:text-sm`. tailwind-merge does not treat a bare caller size
// (`text-2xl`) and the responsive `lg:text-sm` as a conflict, so the variant's 14px
// would win at >= 1024px over the caller's own size. These helpers detect a caller size.
describe('callerSetsFontSize', () => {
  it.each([
    'text-2xs',
    'text-xs',
    'text-2sm',
    'text-sm',
    'text-base',
    'text-lg',
    'text-xl',
    'text-2xl',
    'text-5xl',
    'text-9xl',
    'text-lg/7',
    'text-xl!',
    '!text-xl',
    'tabular-nums text-right text-2xl font-bold',
  ])('ขนาดตัวอักษร "%s" = ผู้เรียกกำหนดขนาดเอง', (className) => {
    expect(callerSetsFontSize(className)).toBe(true);
  });

  it.each([
    'text-[13px]',
    'text-[0.8125rem]',
    'text-[1.5em]',
    'text-[length:var(--field-size)]',
    'text-[clamp(1rem,2vw,1.5rem)]',
  ])('ขนาดแบบ arbitrary length "%s" = ผู้เรียกกำหนดขนาดเอง', (className) => {
    expect(callerSetsFontSize(className)).toBe(true);
  });

  it.each([
    'text-muted-foreground',
    'text-primary',
    'text-foreground',
    'text-destructive',
    'text-warning-strong',
    'text-[hsl(var(--primary))]',
    'text-[#1e3a5f]',
    'text-[var(--brand)]',
    'text-[color:var(--brand)]',
    'text-right text-center text-left',
    'text-ellipsis text-nowrap text-wrap',
    'lg:text-2xl',
    'md:text-base sm:text-lg',
    'h-11 w-full rounded-lg',
    '',
  ])('สี/จัดแนว/ขนาดตามจอ "%s" ไม่นับเป็นขนาดของผู้เรียก', (className) => {
    expect(callerSetsFontSize(className)).toBe(false);
  });

  it('ไม่มี className = false', () => {
    expect(callerSetsFontSize(undefined)).toBe(false);
    expect(callerSetsFontSize(null)).toBe(false);
  });

  it('formControlClass มี text-base จึงนับเป็นขนาดของผู้เรียก', () => {
    expect(callerSetsFontSize(formControlClass)).toBe(true);
  });
});

describe('withCallerFontSize', () => {
  const md = inputVariants();

  it('ไม่มีขนาดของผู้เรียก = คืนคลาสของ variant เหมือนเดิมทุกตัวอักษร', () => {
    expect(withCallerFontSize(md, undefined)).toBe(md);
    expect(withCallerFontSize(md, 'text-muted-foreground')).toBe(md);
  });

  it('ผู้เรียกกำหนดขนาด = ตัด lg:text-sm ของ variant ออก (ส่วนอื่นคงเดิม)', () => {
    const out = withCallerFontSize(md, 'text-2xl');
    expect(out.split(/\s+/)).not.toContain('lg:text-sm');
    expect(out.split(/\s+/)).toEqual(md.split(/\s+/).filter((c) => c && c !== 'lg:text-sm'));
  });

  it('formControlClass: ผลลัพธ์รวมยังมี lg:text-sm ของ formControlClass เอง', () => {
    const merged = withCallerFontSize(md, formControlClass) + ' ' + formControlClass;
    expect(merged.split(/\s+/)).toContain('lg:text-sm');
  });
});
