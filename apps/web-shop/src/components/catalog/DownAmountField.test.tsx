import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DownAmountField, parseDownInput } from './DownAmountField';

describe('parseDownInput', () => {
  it('เหลือแต่ตัวเลข · ว่าง / ไม่มีตัวเลข = null · ไม่เกินเพดาน', () => {
    expect(parseDownInput('5000')).toBe(5000);
    expect(parseDownInput('5,000 บาท')).toBe(5000);
    expect(parseDownInput('0')).toBe(0);
    expect(parseDownInput('')).toBeNull();
    expect(parseDownInput('abc')).toBeNull();
    expect(parseDownInput('99999999999')).toBe(9_999_999);
  });

  it('ตัดที่จุดทศนิยมตัวแรก: "5,000.00" → 5000 · "5000.9" → 5000 · ".5" → null', () => {
    expect(parseDownInput('5,000.00')).toBe(5000);
    expect(parseDownInput('5000.9')).toBe(5000);
    expect(parseDownInput('.5')).toBeNull();
  });
});

describe('DownAmountField', () => {
  function show(over: Partial<Parameters<typeof DownAmountField>[0]> = {}) {
    const onCommit = vi.fn();
    render(<DownAmountField id="t-down" value={null} onCommit={onCommit} {...over} />);
    return { onCommit, input: screen.getByLabelText('เงินดาวน์') as HTMLInputElement };
  }

  it('มี label "เงินดาวน์" หน่วย "บาท" · ช่องตัวเลขสูง 44px · ไม่ใส่ = ว่าง', () => {
    const { input } = show();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input.className).toContain('h-11');
    expect(screen.getByText('บาท')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('ระหว่างพิมพ์ยังไม่แจ้ง · ออกจากช่องจึงแจ้ง และจัดรูปเป็น 5,000', () => {
    const { input, onCommit } = show();
    fireEvent.change(input, { target: { value: '5000' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5000);
    expect(input).toHaveValue('5,000');
  });

  it('กด Enter = ออกจากช่อง', () => {
    const { input, onCommit } = show();
    input.focus();
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(3000);
  });

  it('ค่าเดิม → ไม่แจ้งซ้ำ · ลบจนว่าง → แจ้ง null · พิมพ์ 0 → แจ้ง 0', () => {
    const { input, onCommit } = show({ value: 5000 });
    expect(input).toHaveValue('5,000');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(0);
  });

  it('disabled (ติ๊กฟรีดาวน์อยู่): ใช้ไม่ได้ และแสดง 0', () => {
    const { input } = show({ disabled: true });
    expect(input).toBeDisabled();
    expect(input).toHaveValue('0');
  });

  it('แบบ pill (แถวบนของมือถือ): label เดิม · แถวสูง 44px', () => {
    const { input } = show({ variant: 'pill' });
    expect(input.closest('div.rounded-full')?.className).toContain('min-h-11');
  });

  it('แสดงตัวเลขด้วยหลักสากล (5,000) ไม่ขึ้นกับ locale · โฟกัสแล้วออกโดยไม่แก้ → ไม่แจ้ง', () => {
    // จำลองเครื่องที่ locale ใช้เลขท้องถิ่น ถ้าไม่ระบุ locale
    const spy = vi
      .spyOn(Number.prototype, 'toLocaleString')
      .mockImplementation((locales?: Intl.LocalesArgument) =>
        locales === 'en-US' ? '5,000' : '๕,๐๐๐',
      );
    try {
      const { input, onCommit } = show({ value: 5000 });
      expect(input).toHaveValue('5,000');
      input.focus();
      fireEvent.blur(input);
      expect(onCommit).not.toHaveBeenCalled();
      expect(input).toHaveValue('5,000');
    } finally {
      spy.mockRestore();
    }
  });
});
