import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ adjustmentCodes: { overpay: '53-1503', underpay: '52-1104' } }),
}));

import { AdjustmentSection } from '../AdjustmentSection';

describe('AdjustmentSection — S3-05 กล่องค่าสองกล่องเป็นช่องอ่านอย่างเดียวหน้าตาเดียวกับช่องจริง', () => {
  it('ยอดสุทธิ + ผลต่าง เป็น ReadOnlyField ผูกป้าย', () => {
    render(
      <AdjustmentSection
        diff="1.50"
        amountPaid=""
        onAmountPaidChange={() => {}}
        adjustments={[]}
        onChange={() => {}}
        netExpected="1234.50"
      />,
    );
    const net = screen.getByLabelText('ยอดสุทธิหลังหักภาษี ณ ที่จ่าย');
    expect(net).toHaveAttribute('data-slot', 'readonly-field');
    expect(net).toHaveValue('1,234.50');
    const diff = screen.getByLabelText('ผลต่างที่ต้องปรับ');
    expect(diff).toHaveAttribute('data-slot', 'readonly-field');
    expect(diff).toHaveValue('+1.50 (จ่ายเกิน → Cr)');
  });
});
