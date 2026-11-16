import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: [] } }) }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ whtRates: [] }) }));
// ช่องอ่านอย่างเดียวอยู่ในการ์ดจอเล็ก — จอใหญ่เป็นตาราง ยอดอยู่ในเซลล์ (ItemLinesSection.layout.test.tsx)
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

import { ItemLinesSection } from '../ItemLinesSection';
import { newLine } from '../types';

// ป้ายเดิม "ก่อนภาษี" เปลี่ยนเป็น "จำนวนเงิน" ตามหน้า PEAK (แผน Task 5)
describe('ItemLinesSection — S3-04 ช่อง "จำนวนเงิน" ของการ์ดสูงเท่าช่องข้าง ๆ', () => {
  it('เป็น ReadOnlyField ผูกป้าย ค่าชิดขวา ข้ามด้วย Tab', () => {
    render(
      <ItemLinesSection
        lines={[newLine({ quantity: '2', unitPrice: '150', discount: '0' })]}
        onChange={() => {}}
        priceTypeLabel="ไม่รวม VAT"
      />,
    );
    const before = screen.getByLabelText('จำนวนเงิน');
    expect(before).toHaveAttribute('data-slot', 'readonly-field');
    expect(before).toHaveAttribute('readonly');
    expect(before).toHaveAttribute('tabindex', '-1');
    expect(before).toHaveValue('300.00');
    expect(before).toHaveClass('text-right', 'tabular-nums');
  });
});
