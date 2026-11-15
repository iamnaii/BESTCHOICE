import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCoa', () => ({ useCoaGroups: () => ({ data: { groups: [] } }) }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ whtRates: [] }) }));

import { ItemLinesSection } from '../ItemLinesSection';
import { newLine } from '../types';

describe('ItemLinesSection — S3-04 "ก่อนภาษี" สูงเท่าช่องข้าง ๆ', () => {
  it('เป็น ReadOnlyField ผูกป้าย ค่าชิดขวา ข้ามด้วย Tab', () => {
    render(
      <ItemLinesSection
        lines={[newLine({ quantity: '2', unitPrice: '150', discount: '0' })]}
        onChange={() => {}}
        priceTypeLabel="ไม่รวม VAT"
      />,
    );
    const before = screen.getByLabelText('ก่อนภาษี');
    expect(before).toHaveAttribute('data-slot', 'readonly-field');
    expect(before).toHaveAttribute('readonly');
    expect(before).toHaveAttribute('tabindex', '-1');
    expect(before).toHaveValue('300.00');
    expect(before).toHaveClass('text-right', 'tabular-nums');
  });
});
