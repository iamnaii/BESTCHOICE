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

  it('ผลต่าง มี title เท่าค่าเต็ม — ที่ md ยอดใหญ่อาจตัดทิศ (จ่ายเกิน/จ่ายน้อย) ท้ายช่อง', () => {
    render(
      <AdjustmentSection
        diff="-1234567.89"
        amountPaid=""
        onAmountPaidChange={() => {}}
        adjustments={[]}
        onChange={() => {}}
        netExpected="1234.50"
      />,
    );
    const diff = screen.getByLabelText('ผลต่างที่ต้องปรับ');
    expect(diff).toHaveAttribute('title', (diff as HTMLInputElement).value);
    expect((diff as HTMLInputElement).value).toMatch(/จ่ายน้อย → Dr/);
  });

  it('หัวข้อเป็นระดับ 3 (อยู่ใต้หัวข้อ ชำระเงิน) และไม่มีเลขขั้นของฟอร์มแบบเดิม', () => {
    render(
      <AdjustmentSection
        diff="0.00"
        amountPaid=""
        onAmountPaidChange={() => {}}
        adjustments={[]}
        onChange={() => {}}
        netExpected="100.00"
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'บัญชีปรับผลต่าง' })).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });
});
