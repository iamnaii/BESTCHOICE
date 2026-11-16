import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: () => ({
    isLoading: false,
    isError: false,
    data: {
      groups: [
        {
          category: 'รายได้อื่น',
          accounts: [
            { code: '42-1101', name: 'รายได้ค่าบริการ' },
            { code: '42-1102', name: 'ดอกเบี้ยเงินฝาก' },
            { code: '42-1104', name: 'รายได้หักเงินเดือน' },
          ],
        },
        { category: 'ค่าใช้จ่ายขาย', accounts: [{ code: '52-1104', name: 'ส่วนลดเศษสตางค์' }] },
        {
          category: 'OpEx-สถานที่',
          accounts: [
            { code: '53-1301', name: 'ค่าเช่า (สำนักงาน)' },
            { code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' },
          ],
        },
        { category: 'สินทรัพย์หมุนเวียน', accounts: [{ code: '11-4101', name: 'ภาษีซื้อ' }] },
      ],
    },
  }),
}));
// PettyCashLinesSection neighbours that would call the API.
vi.mock('@/components/expense-form-v4/VendorCombobox', () => ({ VendorCombobox: () => null }));
vi.mock('@/hooks/useUserNames', () => ({ useUserNames: () => [] }));

import { ItemsTable } from '@/pages/other-income/components/ItemsTable';
import { AdjustmentTable } from '@/pages/other-income/components/AdjustmentTable';
import {
  EditableJournalTable,
  type EditableJournalLine,
} from '@/pages/other-income/components/EditableJournalTable';
import { PettyCashLinesSection } from '@/components/expense-form-v4/PettyCashLinesSection';
import { newPettyCashLine, type PettyCashFormFields } from '@/components/expense-form-v4/types';

function ItemsHarness() {
  const { control, register, watch, setValue } = useForm<OtherIncomeFormValues>({
    defaultValues: {
      priceType: 'EXCLUSIVE',
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 100, discountAmount: 0, vatPct: 0, whtPct: 0, description: '' }],
    } as unknown as OtherIncomeFormValues,
  });
  return (
    <>
      <ItemsTable control={control} register={register} watch={watch} setValue={setValue} />
      <output data-testid="code">{watch('items.0.accountCode')}</output>
    </>
  );
}

function AdjustmentHarness() {
  const { control, register, watch, setValue } = useForm<OtherIncomeFormValues>({
    defaultValues: { adjustments: [{ amount: 50, accountCode: '', note: '' }] } as unknown as OtherIncomeFormValues,
  });
  const adjustments = watch('adjustments') ?? [];
  return (
    <>
      <AdjustmentTable
        control={control}
        register={register}
        setValue={setValue}
        totalDiff={50}
        diffSign="over"
        watchedAdjustments={adjustments}
      />
      <output data-testid="code">{adjustments[0]?.accountCode}</output>
    </>
  );
}

function PettyCashHarness({ onLines }: { onLines: (v: PettyCashFormFields) => void }) {
  const [value, setValue] = useState<PettyCashFormFields>({
    custodianName: '',
    lines: [newPettyCashLine({ uid: 'line-1' })],
  });
  return (
    <PettyCashLinesSection
      value={value}
      onChange={(v) => {
        setValue(v);
        onLines(v);
      }}
    />
  );
}

// The four other-income / petty-cash callers keep their filters, blocked code and the value they
// write (R2-3a characterization — passes on AccountSearchDropdown and on AccountCombobox).
// The expense lines (ItemLinesSection) are pinned by ItemLinesSection.layout.test.tsx.
describe('account picker callers — value written on pick', () => {
  it('รายได้อื่น › ItemsTable: 42- accounts only, 42-1104 blocked, pick writes items.N.accountCode', async () => {
    const user = userEvent.setup();
    render(<ItemsHarness />);
    const picker = screen.getByRole('combobox', { name: /^บัญชี/ });
    expect(picker).toHaveTextContent('42-1102 - ดอกเบี้ยเงินฝาก');
    await user.click(picker);
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(within(list).getByRole('option', { name: /รายได้หักเงินเดือน/ })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(list).getByRole('option', { name: '42-1101 - รายได้ค่าบริการ' }));
    expect(screen.getByTestId('code')).toHaveTextContent('42-1101');
  });

  it('รายได้อื่น › AdjustmentTable: 52-/53-/11-41 accounts, pick writes adjustments.N.accountCode', async () => {
    const user = userEvent.setup();
    render(<AdjustmentHarness />);
    await user.click(screen.getByRole('combobox', { name: 'บัญชี' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    expect(within(list).queryByRole('option', { name: '42-1102 - ดอกเบี้ยเงินฝาก' })).toBeNull();
    await user.click(within(list).getByRole('option', { name: '52-1104 - ส่วนลดเศษสตางค์' }));
    expect(screen.getByTestId('code')).toHaveTextContent('52-1104');
  });

  it('Override JV › EditableJournalTable: 41/42/51/52/53 accounts, pick sends the line with the new code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const lines: EditableJournalLine[] = [{ accountCode: '', debit: 100, credit: 0, description: 'x' }];
    render(<EditableJournalTable lines={lines} onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'บัญชี' }));
    const list = screen.getByRole('listbox');
    expect(within(list).queryByRole('option', { name: '11-4101 - ภาษีซื้อ' })).toBeNull();
    await user.click(within(list).getByRole('option', { name: '53-1302 - ค่าโทรศัพท์และอินเทอร์เน็ต' }));
    expect(onChange).toHaveBeenCalledWith([{ accountCode: '53-1302', debit: 100, credit: 0, description: 'x' }]);
  });

  it('เงินสดย่อย › PettyCashLinesSection: 53- accounts only, pick writes the line category', async () => {
    const user = userEvent.setup();
    const onLines = vi.fn();
    render(<PettyCashHarness onLines={onLines} />);
    await user.click(screen.getByRole('combobox', { name: 'หมวดบัญชี' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    await user.click(within(list).getByRole('option', { name: '53-1301 - ค่าเช่า' }));
    expect(onLines).toHaveBeenLastCalledWith({
      custodianName: '',
      lines: [expect.objectContaining({ uid: 'line-1', category: '53-1301' })],
    });
  });
});

describe('account picker callers — labels (R2-3a)', () => {
  it('รายได้อื่น › ItemsTable: the visible label "บัญชีรายได้" names the picker', () => {
    render(<ItemsHarness />);
    expect(screen.getByRole('combobox', { name: 'บัญชีรายได้' })).toHaveTextContent('42-1102 - ดอกเบี้ยเงินฝาก');
  });
});
