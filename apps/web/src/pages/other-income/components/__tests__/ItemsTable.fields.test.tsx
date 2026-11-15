import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

vi.mock('../AccountSearchDropdown', () => ({ AccountSearchDropdown: () => <div data-testid="account-dropdown" /> }));

import { ItemsTable } from '../ItemsTable';

function Harness() {
  const { control, register, watch, setValue } = useForm<OtherIncomeFormValues>({
    defaultValues: {
      priceType: 'EXCLUSIVE',
      items: [{ accountCode: '42-1102', quantity: 2, unitAmount: 100, discountAmount: 0, vatPct: 0, whtPct: 1, description: '' }],
    } as unknown as OtherIncomeFormValues,
  });
  return <ItemsTable control={control} register={register} watch={watch} setValue={setValue} />;
}

describe('ItemsTable — S2-07 แถวตัวเลขหน้าตาเดียวกัน', () => {
  it('"ก่อนภาษี" เป็น ReadOnlyField ผูกป้าย · ช่องตัวเลขและคำอธิบายใช้ formControlClass', () => {
    render(<Harness />);
    const before = screen.getByLabelText('ก่อนภาษี');
    expect(before).toHaveAttribute('data-slot', 'readonly-field');
    expect(before).toHaveAttribute('readonly');
    expect(before).toHaveValue('200.00');
    expect(before).toHaveClass('text-right', 'tabular-nums');
    for (const name of ['จำนวน', 'ราคา/หน่วย', 'ส่วนลด']) {
      expect(screen.getByLabelText(name)).toHaveClass('h-11', 'rounded-lg', 'border-input', 'bg-background', 'text-right');
    }
    expect(screen.getByLabelText('คำอธิบาย')).toHaveClass('rounded-lg', 'border-input');
  });
});
